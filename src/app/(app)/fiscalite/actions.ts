"use server";
import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { exigerDroit } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { journaliser } from "@/lib/journal";
import { chargerDonnees, etatDuMois, moisSuivis, reglesDuPays } from "@/lib/fiscal/donnees";
import { libelleMois } from "@/lib/fiscal/regles";
import { aujourdhui, fcfa } from "@/lib/format";

const txt = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const nombre = (f: FormData, k: string) => Number(txt(f, k).replace(/\s/g, "").replace(",", ".")) || 0;

/** Enregistre qu'une déclaration a été déposée (et éventuellement payée). */
export async function enregistrerDeclaration(_: unknown, f: FormData) {
  const s = await exigerDroit("fisc.declarer");
  const regles = reglesDuPays(s.pays.code);
  if (!regles) return { erreur: "Les règles fiscales de ce pays ne sont pas encore configurées." };
  const [annee, mois] = txt(f, "mois").split("-").map(Number);
  const code = txt(f, "obligation");
  const periode = txt(f, "periode");
  const d = await chargerDonnees(regles, [{ annee, mois }]);
  const o = regles.obligations(annee, mois, d).find((x) => x.code === code && x.periode === periode);
  if (!o) return { erreur: "Déclaration introuvable pour ce mois." };
  const payee = txt(f, "payee") === "1";
  const supabase = await supabaseServeur();
  const { error } = await supabase.from("declarations_fiscales").insert({
    obligation: o.code, periode: o.periode, echeance: o.echeance,
    montant_calcule: o.montant, montant_declare: f.has("montant") ? nombre(f, "montant") : o.montant,
    reference: txt(f, "reference") || null, note: txt(f, "note") || null, detail: o.detail,
    statut: payee ? "Payée" : "Déclarée", ...(payee ? { paye_par: s.profil.id, paye_le: new Date().toISOString() } : {}),
  });
  if (error) return { erreur: error.code === "23505" ? "Cette déclaration est déjà enregistrée." : error.message };
  await journaliser(`a enregistré la déclaration ${o.nom} (${o.libellePeriode})${payee ? " comme payée" : ""}`);
  revalidatePath("/fiscalite");
  return { ok: "Déclaration enregistrée." };
}

export async function marquerPayee(f: FormData) {
  const s = await exigerDroit("fisc.declarer");
  const supabase = await supabaseServeur();
  const { error } = await supabase.from("declarations_fiscales")
    .update({ statut: "Payée", paye_par: s.profil.id, paye_le: new Date().toISOString(), reference: txt(f, "reference") || undefined })
    .eq("obligation", txt(f, "obligation")).eq("periode", txt(f, "periode"));
  if (error) throw new Error(error.message);
  await journaliser(`a marqué payée la déclaration ${txt(f, "obligation")} (${txt(f, "periode")})`);
  revalidatePath("/fiscalite");
}

export async function annulerEnregistrement(f: FormData) {
  await exigerDroit("fisc.declarer");
  const supabase = await supabaseServeur();
  const { error } = await supabase.from("declarations_fiscales").delete()
    .eq("obligation", txt(f, "obligation")).eq("periode", txt(f, "periode"));
  if (error) throw new Error(error.message);
  await journaliser(`a annulé l'enregistrement de la déclaration ${txt(f, "obligation")} (${txt(f, "periode")})`);
  revalidatePath("/fiscalite");
}

// ---------------------------------------------------------------------------
// Assistant IA comptable
// ---------------------------------------------------------------------------
export type Echange = { role: "user" | "assistant"; texte: string };

const CONSIGNE = `Tu es l'agent comptable et fiscal de DGS (D General Solutions), entreprise de BTP, énergie et télécommunications.
Tu aides la direction, le RAF et le comptable à rester à jour vis-à-vis du fisc et de la CNSS.
Tu reçois le calendrier des déclarations calculé par l'application à partir de ses données (factures clients et fournisseurs, dépenses, frais généraux, salariés déclarés, paie) et le registre des déclarations déjà faites.
Règles de réponse :
- Réponds en français simple, en phrases complètes, pour un dirigeant qui n'est pas comptable.
- Appuie-toi d'abord sur les montants calculés par l'application ; explique d'où ils viennent. Ne les invente jamais et ne les recalcule pas autrement sans le dire.
- Signale les retards, les pénalités encourues et les anomalies (salariés non déclarés, paie non validée, factures non encaissées, paramètres manquants).
- Donne les étapes concrètes : quoi déclarer, où (e-services impots.bj, portail CNSS), avant quelle date, quelles pièces préparer.
- Si une règle est incertaine ou dépend d'un cas particulier, dis-le et recommande de faire valider par l'expert-comptable ; ne présente jamais une estimation comme définitive.
- Reste dans ton rôle fiscal et comptable ; tu ne déposes rien toi-même et tu ne modifies aucune donnée.`;

function resume(etats: ReturnType<typeof etatDuMois>) {
  return etats.map((o) => ({
    declaration: o.nom, organisme: o.organisme, periode: o.libellePeriode, echeance: o.echeance,
    montant_calcule_fcfa: o.montant, etat: o.etat,
    enregistree: o.enregistree ? { statut: o.enregistree.statut, montant_declare: o.enregistree.montant_declare, reference: o.enregistree.reference } : null,
    calcul: o.lignes.map((l) => `${l.libelle}${l.montant !== undefined ? ` : ${fcfa(l.montant)} FCFA` : ""}${l.note ? ` (${l.note})` : ""}`),
    alertes: o.alertes,
  }));
}

/** Pose une question à l'agent comptable (avec l'historique de la conversation). */
export async function demanderAgent(moisCle: string, historique: Echange[]): Promise<{ reponse?: string; erreur?: string }> {
  const s = await exigerDroit("fisc.voir");
  const regles = reglesDuPays(s.pays.code);
  if (!regles) return { erreur: `L'agent comptable n'est pas encore configuré pour ${s.pays.nom}.` };
  if (!process.env.ANTHROPIC_API_KEY) {
    return { erreur: "L'agent IA n'est pas encore activé : la clé ANTHROPIC_API_KEY manque dans les réglages Vercel." };
  }
  const dernier = historique.at(-1);
  if (!dernier || dernier.role !== "user" || !dernier.texte.trim()) return { erreur: "Écrivez votre question." };
  if (historique.length > 30) return { erreur: "Conversation trop longue : effacez-la pour repartir de zéro." };

  const [annee, mois] = moisCle.split("-").map(Number);
  const auj = aujourdhui();
  const [aa, mm] = auj.split("-").map(Number);
  const suivis = moisSuivis(aa, mm);
  if (!suivis.some((x) => x.annee === annee && x.mois === mois)) suivis.push({ annee, mois });
  const d = await chargerDonnees(regles, suivis);
  const calendrier = suivis.map((x) => ({
    mois_echeance: libelleMois(`${x.annee}-${String(x.mois).padStart(2, "0")}`),
    declarations: resume(etatDuMois(regles, x.annee, x.mois, d, auj)),
  }));
  const contexte = `Pays : ${regles.nom}. Aujourd'hui : ${auj}. Mois consulté à l'écran : ${libelleMois(moisCle)}.
Paramètres fiscaux du pays (Paramètres de l'application) : ${JSON.stringify(d.params)}
Calendrier des déclarations (3 mois passés, mois en cours, mois suivant) :
${JSON.stringify(calendrier, null, 1)}`;

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: `${contexte}\n\nQuestion : ${historique[0].texte}` },
    ...historique.slice(1).map((e) => ({ role: e.role, content: e.texte })),
  ];

  try {
    const client = new Anthropic();
    const rep = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      system: [
        { type: "text", text: CONSIGNE },
        { type: "text", text: regles.memo, cache_control: { type: "ephemeral" } },
      ],
      messages,
    });
    if (rep.stop_reason === "refusal") return { erreur: "L'agent n'a pas pu répondre à cette question. Reformulez-la." };
    const texte = rep.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
    if (!texte) return { erreur: "Réponse vide : réessayez." };
    return { reponse: texte + (rep.stop_reason === "max_tokens" ? "\n\n(Réponse coupée : posez une question plus précise.)" : "") };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { erreur: "La clé ANTHROPIC_API_KEY est refusée : vérifiez-la dans les réglages Vercel." };
    if (e instanceof Anthropic.RateLimitError) return { erreur: "Agent saturé : réessayez dans une minute." };
    if (e instanceof Anthropic.APIError) return { erreur: `Agent indisponible (erreur ${e.status ?? "réseau"}). Réessayez.` };
    return { erreur: "Agent indisponible : vérifiez la connexion et réessayez." };
  }
}
