"use server";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { exigerDroit } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { journaliser } from "@/lib/journal";
import { CHAMPS_SAISIE, type Saisies } from "@/lib/fiscal/etats";
import { chargerEtats, type NotesAnnexes } from "@/lib/fiscal/etats-donnees";
import { reglesDuPays } from "@/lib/fiscal/donnees";

type Etat = { ok?: string; erreur?: string } | null;
const anneeValide = (x: unknown) => {
  const a = Number(x);
  return Number.isInteger(a) && a >= 2000 && a <= 2100 ? a : null;
};

async function ecrire(annee: number, valeurs: Record<string, unknown>) {
  const supabase = await supabaseServeur();
  const { data } = await supabase.from("clotures_exercice").select("id").eq("annee", annee).maybeSingle();
  const { error } = data
    ? await supabase.from("clotures_exercice").update(valeurs).eq("id", data.id)
    : await supabase.from("clotures_exercice").insert({ annee, ...valeurs });
  return error?.message ?? null;
}

/** Enregistre les données de clôture saisies (capital, trésorerie, emprunts…). */
export async function enregistrerSaisies(_: Etat, f: FormData): Promise<Etat> {
  await exigerDroit("fisc.declarer");
  const annee = anneeValide(f.get("annee"));
  if (!annee) return { erreur: "Exercice invalide." };
  const saisies: Saisies = {};
  for (const c of CHAMPS_SAISIE) {
    const brut = String(f.get(c.cle) ?? "").replace(/\s/g, "").replace(",", ".");
    if (brut === "") continue;
    const n = Number(brut);
    if (!Number.isFinite(n)) return { erreur: `« ${c.libelle} » : saisissez un nombre.` };
    if (n < 0 && c.cle !== "report_a_nouveau") return { erreur: `« ${c.libelle} » ne peut pas être négatif.` };
    saisies[c.cle] = Math.round(n);
  }
  const e = await ecrire(annee, { saisies });
  if (e) return { erreur: e };
  await journaliser(`a mis à jour les données de clôture de l'exercice ${annee}`);
  revalidatePath("/fiscalite/etats");
  return { ok: "Données de clôture enregistrées : les états sont recalculés." };
}

/** Arrête les états : la version calculée est figée et devient la colonne N-1 de l'année suivante. */
export async function arreterEtats(f: FormData) {
  const s = await exigerDroit("fisc.declarer");
  const annee = anneeValide(f.get("annee"));
  if (!annee) throw new Error("Exercice invalide.");
  const { calcul } = await chargerEtats(s.pays.code, annee);
  const e = await ecrire(annee, { etats: calcul, statut: "Arrêté" });
  if (e) throw new Error(e);
  await journaliser(`a arrêté les états financiers de l'exercice ${annee}`);
  revalidatePath("/fiscalite/etats");
}

export async function rouvrirEtats(f: FormData) {
  await exigerDroit("fisc.declarer");
  const annee = anneeValide(f.get("annee"));
  if (!annee) throw new Error("Exercice invalide.");
  const e = await ecrire(annee, { statut: "Brouillon" });
  if (e) throw new Error(e);
  await journaliser(`a rouvert les états financiers de l'exercice ${annee}`);
  revalidatePath("/fiscalite/etats");
}

// ---------------------------------------------------------------------------
// Notes annexes rédigées par l'agent IA
// ---------------------------------------------------------------------------
const Notes = z.object({
  notes: z.array(z.object({
    numero: z.string().describe("Numéro de la note, par exemple « 1 », « 3A », « 8 »"),
    titre: z.string(),
    texte: z.string().describe("Contenu de la note en français, avec les montants en FCFA ; tableaux en lignes « libellé : montant »"),
  })),
  points_de_vigilance: z.array(z.string()).describe("Ce qui doit être corrigé, justifié ou complété avant l'arrêté et le dépôt"),
});

const CONSIGNE = `Tu es l'expert-comptable de DGS (D General Solutions), entreprise de BTP, énergie et télécommunications.
Tu rédiges les notes annexes des états financiers annuels selon l'Acte uniforme OHADA relatif au droit comptable et à l'information financière et le SYSCOHADA révisé (système normal), à partir du bilan, du compte de résultat et du tableau des flux de trésorerie calculés par l'application, de l'identité de l'entreprise et du détail des calculs.
Rédige au minimum : la déclaration de conformité et les règles et méthodes comptables (note 1 : référentiel SYSCOHADA révisé, coût historique, amortissement linéaire avec les taux appliqués, évaluation des stocks au coût moyen pondéré, reconnaissance du chiffre d'affaires sur facturation des travaux et services réceptionnés par PV, conversion, changements de méthode), les immobilisations et amortissements (note 3), les stocks (note 6), les clients et autres créances (notes 7 et 8), la trésorerie (note 11), le capital et les capitaux propres (note 13), les dettes fournisseurs, fiscales et sociales (notes 17 à 19), le chiffre d'affaires (note 21), les achats et services extérieurs (notes 22 à 25), les impôts et taxes (note 26), les charges de personnel et l'effectif (note 27), l'impôt sur le résultat (note 37), et les événements postérieurs à la clôture.
Règles :
- Utilise uniquement les montants fournis ; n'invente aucun chiffre ni aucun fait. Quand une information manque (effectif moyen exact, engagements hors bilan, litiges, événements postérieurs), écris « À compléter par la direction : … ».
- Signale dans les points de vigilance tout déséquilibre du bilan, tout écart du tableau des flux, toute donnée manquante, et rappelle que les états doivent être arrêtés par la gérance, visés par un expert-comptable inscrit à l'Ordre et déposés à la DGI avant le 30 avril.
- Écris en français clair et professionnel, sans markdown (pas d'astérisques ni de dièses).`;

export async function redigerNotes(annee: number): Promise<{ ok?: string; erreur?: string }> {
  const s = await exigerDroit("fisc.declarer");
  if (!anneeValide(annee)) return { erreur: "Exercice invalide." };
  const regles = reglesDuPays(s.pays.code);
  if (!regles) return { erreur: `Les règles de ${s.pays.nom} ne sont pas encore configurées.` };
  if (!process.env.ANTHROPIC_API_KEY) return { erreur: "L'agent IA n'est pas encore activé : la clé ANTHROPIC_API_KEY manque dans les réglages Vercel." };

  const { etats, cloture } = await chargerEtats(s.pays.code, annee);
  if (cloture?.statut === "Arrêté") return { erreur: "Ces états sont arrêtés : rouvrez-les pour réécrire les notes." };
  const supabase = await supabaseServeur();
  const { data: ident } = await supabase.from("pays").select("*").eq("code", s.pays.code).maybeSingle();
  const ligne = (l: { ref: string; libelle: string; n: number; n1?: number }) => `${l.ref} ${l.libelle} : N ${l.n} ; N-1 ${l.n1 ?? "—"}`;
  const contenu = `Entreprise : ${JSON.stringify({ raison_sociale: ident?.raison_sociale, rccm: ident?.rccm, ifu: ident?.ifu, adresse: ident?.adresse, pays: s.pays.nom, devise: "FCFA" })}
Exercice : du 01/01/${annee} au 31/12/${annee} (12 mois).
Données saisies à la clôture : ${JSON.stringify(cloture?.saisies ?? {})}

BILAN ACTIF (brut ; amortissements ; net N ; net N-1)
${etats.actif.map((l) => `${l.ref} ${l.libelle} : ${l.brut} ; ${l.amort} ; ${l.net} ; ${l.n1 ?? "—"}`).join("\n")}

BILAN PASSIF
${etats.passif.map(ligne).join("\n")}

COMPTE DE RÉSULTAT
${etats.compteResultat.map(ligne).join("\n")}

TABLEAU DES FLUX DE TRÉSORERIE
${etats.tft.map(ligne).join("\n")}

Écart du bilan (actif − passif) : ${etats.ecart}
Contrôles de l'application : ${JSON.stringify(etats.controles)}
Détail des calculs : ${JSON.stringify(etats.detail)}

Rédige les notes annexes de l'exercice ${annee}.`;

  try {
    const client = new Anthropic();
    const rep = await client.beta.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 20000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(Notes) },
      system: CONSIGNE,
      messages: [{ role: "user", content: contenu }],
    }, { timeout: 280_000 });
    if (rep.stop_reason === "refusal") return { erreur: "L'agent n'a pas pu rédiger les notes. Réessayez." };
    if (rep.stop_reason === "max_tokens" || !rep.parsed_output) return { erreur: "Rédaction incomplète : réessayez." };
    const notes: NotesAnnexes = { redige_le: new Date().toISOString(), ...rep.parsed_output };
    const e = await ecrire(annee, { notes });
    if (e) return { erreur: e };
    await journaliser(`a fait rédiger par l'agent IA les notes annexes de l'exercice ${annee}`);
    revalidatePath("/fiscalite/etats");
    return { ok: "Notes annexes rédigées : relisez-les et complétez ce qui est signalé." };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { erreur: "La clé ANTHROPIC_API_KEY est refusée : vérifiez-la dans les réglages Vercel." };
    if (e instanceof Anthropic.RateLimitError) return { erreur: "Agent saturé : réessayez dans une minute." };
    if (e instanceof Anthropic.APIError) return { erreur: `Agent indisponible (erreur ${e.status ?? "réseau"}). Réessayez.` };
    return { erreur: "Agent indisponible : vérifiez la connexion et réessayez." };
  }
}
