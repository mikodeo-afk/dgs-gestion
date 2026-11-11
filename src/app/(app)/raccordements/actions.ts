"use server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { revalidatePath } from "next/cache";
import { exigerDroit, exigerSession } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { journaliser } from "@/lib/journal";
import type { Dossier, Rapport } from "@/lib/raccordement";

type Etat = { ok?: string; erreur?: string } | null;
const txt = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

// --- Rapports d'installation -------------------------------------------------
export type ResultatRapport = { ligne: string; ok?: string; erreur?: string };

export async function enregistrerRapports(equipe: string, rapports: Rapport[]): Promise<ResultatRapport[]> {
  await exigerSession();
  const supabase = await supabaseServeur();
  const out: ResultatRapport[] = [];
  for (const r of rapports) {
    const { data, error } = await supabase.rpc("enregistrer_rapport", {
      p_equipe: equipe,
      p_donnees: { ligne: r.ligne, client: r.client, mobile: r.mobile, date: r.date || null, cable: r.cable,
                   latitude: r.latitude, longitude: r.longitude, champs: r.champs, materiel: r.materiel },
      p_brut: r.brut,
    });
    if (error) { out.push({ ligne: r.ligne, erreur: error.message }); continue; }
    const d = data as { deduits: number; a_regulariser: number; non_relies: number; dossier_cree: boolean };
    const morceaux = [`${d.deduits} article(s) déduit(s) du stock`];
    if (d.a_regulariser) morceaux.push(`${d.a_regulariser} à régulariser (stock du chef insuffisant)`);
    if (d.non_relies) morceaux.push(`${d.non_relies} rubrique(s) sans article relié`);
    if (d.dossier_cree) morceaux.push("dossier créé (non reçu)");
    out.push({ ligne: r.ligne, ok: morceaux.join(", ") });
  }
  const n = out.filter((o) => o.ok).length;
  if (n) await journaliser(`a enregistré ${n} rapport(s) de raccordement`);
  revalidatePath("/raccordements");
  return out;
}

export async function signalerEchec(_: Etat, f: FormData): Promise<Etat> {
  await exigerSession();
  const supabase = await supabaseServeur();
  const { error } = await supabase.rpc("signaler_echec", { p_id: txt(f, "id"), p_motif: txt(f, "motif") });
  if (error) return { erreur: error.message };
  revalidatePath("/raccordements");
  return { ok: "Échec enregistré." };
}

export async function rouvrir(id: string): Promise<Etat> {
  await exigerDroit("racc.gerer");
  const supabase = await supabaseServeur();
  const { error } = await supabase.rpc("rouvrir_raccordement", { p_id: id });
  if (error) return { erreur: error.message };
  revalidatePath("/raccordements");
  return { ok: "Dossier remis en attente." };
}

// --- Dossiers -----------------------------------------------------------------
export async function importerDossiers(chantier: string, dossiers: Dossier[]): Promise<Etat> {
  await exigerDroit("racc.gerer");
  const supabase = await supabaseServeur();
  const { data, error } = await supabase.rpc("importer_dossiers", { p_chantier: chantier, p_lignes: dossiers });
  if (error) return { erreur: error.message };
  const r = data as { crees: number; doublons: number };
  await journaliser(`a importé ${r.crees} dossier(s) de raccordement`);
  revalidatePath("/raccordements");
  return { ok: `${r.crees} dossier(s) importé(s)${r.doublons ? `, ${r.doublons} déjà connu(s) ignoré(s)` : ""}.` };
}

export async function affecter(ids: string[], equipe: string): Promise<Etat> {
  await exigerDroit("racc.gerer");
  if (!ids.length) return { erreur: "Cochez au moins un dossier." };
  const supabase = await supabaseServeur();
  const { data, error } = await supabase.rpc("affecter_raccordements", { p_ids: ids, p_equipe: equipe || null });
  if (error) return { erreur: error.message };
  revalidatePath("/raccordements");
  return { ok: equipe ? `${data} dossier(s) affecté(s).` : `${data} dossier(s) remis à affecter.` };
}

const Tableau = z.object({
  dossiers: z.array(z.object({
    client: z.string(), ligne: z.string(), mobile: z.string(), msan: z.string().describe("MSAN / point FAT, ex. AKP-PL72 FAT293"),
    latitude: z.number().nullable(), longitude: z.number().nullable(),
    date_demande: z.string().describe("Première date de la ligne, AAAA-MM-JJ, vide si absente"),
    date_affectation: z.string().describe("Seconde date de la ligne (affectation du dossier), AAAA-MM-JJ, vide si absente"),
    offre: z.string(),
  })),
});

/** Lit la photo d'un tableau de dossiers (rien n'est enregistré). */
export async function lirePhotoDossiers(image: string): Promise<{ dossiers?: Dossier[]; erreur?: string }> {
  await exigerDroit("racc.gerer");
  if (!process.env.ANTHROPIC_API_KEY) return { erreur: "La lecture des photos n'est pas encore activée : la clé ANTHROPIC_API_KEY manque dans Vercel." };
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(image);
  if (!m) return { erreur: "Image illisible : reprenez la photo." };
  try {
    const rep = await new Anthropic().messages.parse({
      model: "claude-haiku-5-5",
      max_tokens: 16000,
      output_config: { effort: "low", format: zodOutputFormat(Tableau) },
      system: `Tu lis la photo d'un tableau de dossiers de raccordement fibre reçus d'un opérateur télécom (Bénin, Mali).
Chaque ligne du tableau est un dossier : nom du client, numéro de ligne (9 chiffres environ), numéro mobile, MSAN/FAT, coordonnées GPS (latitude puis longitude, parfois coupées sur plusieurs lignes ou séparées par « : »), deux dates (demande puis affectation, JJ/MM/AAAA à convertir en AAAA-MM-JJ) et l'offre.
Recopie exactement, sans rien inventer ; laisse vide ce qui est illisible. Ignore la ligne d'en-têtes.`,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: m[1] as "image/jpeg" | "image/png" | "image/webp", data: m[2] } },
        { type: "text", text: "Relève tous les dossiers de ce tableau." },
      ] }],
    });
    if (rep.stop_reason === "refusal") return { erreur: "Cette photo n'a pas pu être lue." };
    if (rep.stop_reason === "max_tokens" || !rep.parsed_output) return { erreur: "Tableau trop long pour une seule photo : photographiez-le en plusieurs fois." };
    const dossiers = rep.parsed_output.dossiers.map((d) => ({ ...d, ligne: d.ligne.replace(/\D/g, ""), mobile: d.mobile.replace(/\D/g, "") }));
    if (!dossiers.length) return { erreur: "Aucun dossier trouvé sur cette photo." };
    return { dossiers };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { erreur: "La clé ANTHROPIC_API_KEY est refusée : vérifiez-la dans Vercel." };
    if (e instanceof Anthropic.APIError) return { erreur: `Lecture impossible (erreur ${e.status ?? "réseau"}). Réessayez.` };
    return { erreur: "Lecture impossible : vérifiez la connexion et réessayez." };
  }
}

// --- Équipes et matériel ----------------------------------------------------------
export async function creerEquipe(_: Etat, f: FormData): Promise<Etat> {
  await exigerDroit("racc.gerer");
  const supabase = await supabaseServeur();
  const { error } = await supabase.from("equipes").insert({ nom: txt(f, "nom"), chef_id: txt(f, "chef_id"), chantier_id: txt(f, "chantier_id") });
  if (error) return { erreur: error.code === "23505" ? "Une équipe porte déjà ce nom." : error.message };
  await journaliser(`a créé l'équipe de raccordement « ${txt(f, "nom")} »`);
  revalidatePath("/raccordements");
  return { ok: "Équipe créée." };
}

export async function modifierEquipe(_: Etat, f: FormData): Promise<Etat> {
  await exigerDroit("racc.gerer");
  const supabase = await supabaseServeur();
  const { error } = await supabase.from("equipes").update({
    nom: txt(f, "nom"), chef_id: txt(f, "chef_id"), chantier_id: txt(f, "chantier_id"), actif: f.get("actif") === "on",
  }).eq("id", txt(f, "id"));
  if (error) return { erreur: error.code === "23505" ? "Une équipe porte déjà ce nom." : error.message };
  revalidatePath("/raccordements");
  return { ok: "Équipe enregistrée." };
}

export async function ajouterMembre(_: Etat, f: FormData): Promise<Etat> {
  await exigerDroit("racc.gerer");
  const supabase = await supabaseServeur();
  const { error } = await supabase.from("equipe_membres").insert({ equipe_id: txt(f, "equipe_id"), profil_id: txt(f, "profil_id") });
  if (error) return { erreur: error.code === "23505" ? "Déjà membre de l'équipe." : error.message };
  revalidatePath("/raccordements");
  return { ok: "Membre ajouté." };
}

export async function retirerMembre(equipe: string, profil: string): Promise<Etat> {
  await exigerDroit("racc.gerer");
  const supabase = await supabaseServeur();
  const { error } = await supabase.from("equipe_membres").delete().eq("equipe_id", equipe).eq("profil_id", profil);
  if (error) return { erreur: error.message };
  revalidatePath("/raccordements");
  return { ok: "Membre retiré." };
}

export async function relierRubrique(rubrique: string, article: string): Promise<Etat> {
  const s = await exigerSession();
  if (!s.peut("stock.gerer") && !s.peut("racc.gerer")) return { erreur: "Vous n'avez pas le droit de faire cette action." };
  if (!/^[a-z0-9_]+(:[A-Z0-9_ -]+)?$/.test(rubrique)) return { erreur: "Rubrique invalide." };
  const supabase = await supabaseServeur();
  const { error } = article
    ? await supabase.from("materiel_raccordement").upsert({ pays: s.pays.code, rubrique, article_id: article })
    : await supabase.from("materiel_raccordement").delete().eq("rubrique", rubrique);
  if (error) return { erreur: error.message };
  revalidatePath("/raccordements");
  return { ok: "Enregistré." };
}

export async function regulariser(id: string, ignorer: boolean): Promise<Etat> {
  await exigerDroit("stock.gerer");
  const supabase = await supabaseServeur();
  const { error } = await supabase.rpc("regulariser_consommation", { p_conso: id, p_ignorer: ignorer });
  if (error) return { erreur: error.message };
  revalidatePath("/raccordements");
  return { ok: ignorer ? "Ligne ignorée." : "Matériel déduit du stock." };
}
