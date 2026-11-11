"use server";
import { revalidatePath } from "next/cache";
import { exigerDroit, exigerSession } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { journaliser } from "@/lib/journal";

type Etat = { ok?: string; erreur?: string } | null;
const txt = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (f: FormData, k: string) => Number(txt(f, k).replace(",", ".").replace(/\s/g, ""));
/** Endroit codé « depot », « ch:<chantier> » ou « p:<personne> ». */
function endroit(v: string) {
  if (v.startsWith("ch:")) return { lieu: v.slice(3), detenteur: null };
  if (v.startsWith("p:")) return { lieu: null, detenteur: v.slice(2) };
  return { lieu: null, detenteur: null };
}

export async function creerArticle(_: Etat, f: FormData): Promise<Etat> {
  await exigerDroit("stock.gerer");
  const supabase = await supabaseServeur();
  const { error } = await supabase.from("articles").insert({
    code: txt(f, "code").toUpperCase(), designation: txt(f, "designation"), unite: txt(f, "unite"),
    categorie: txt(f, "categorie") || null, seuil_alerte: num(f, "seuil") || 0, client_id: txt(f, "client_id") || null,
  });
  if (error) return { erreur: error.code === "23505" ? "Ce code article existe déjà." : error.message };
  await journaliser(`a créé l'article ${txt(f, "code").toUpperCase()} « ${txt(f, "designation")} »`);
  revalidatePath("/stock");
  return { ok: "Article créé." };
}

/** Mouvement de stock enregistré par le gestionnaire (contrôles faits par la base). */
export async function mouvement(_: Etat, f: FormData): Promise<Etat> {
  await exigerDroit("stock.gerer");
  const supabase = await supabaseServeur();
  const type = txt(f, "type");
  const article = txt(f, "article_id");
  if (!article) return { erreur: "Choisissez un article." };
  const q = num(f, "quantite");
  if (!Number.isFinite(q) || txt(f, "quantite") === "") return { erreur: "Quantité invalide." };
  const motif = txt(f, "motif") || null;
  const de = endroit(txt(f, "de"));
  let r;
  let libelle = "";
  if (type === "entree") {
    r = await supabase.rpc("entree_stock", { p_article: article, p_lieu: de.lieu, p_quantite: q, p_prix: num(f, "prix") || 0,
      p_bon_commande: txt(f, "bc") || null, p_fournisseur: txt(f, "fournisseur") || null, p_motif: motif });
    libelle = "une entrée";
  } else if (type === "deplacer") {
    const vers = endroit(txt(f, "vers"));
    r = await supabase.rpc("deplacer_stock", { p_article: article, p_de_lieu: de.lieu, p_de_detenteur: de.detenteur,
      p_vers_lieu: vers.lieu, p_vers_detenteur: vers.detenteur, p_quantite: q, p_motif: motif });
    libelle = `un(e) ${String(r.data ?? "déplacement").toLowerCase()}`;
  } else if (type === "utilisation") {
    r = await supabase.rpc("utiliser_stock", { p_article: article, p_lieu: de.lieu, p_detenteur: de.detenteur, p_quantite: q,
      p_chantier: de.lieu ?? (txt(f, "chantier") || null), p_motif: motif });
    libelle = "une utilisation";
  } else if (type === "inventaire") {
    r = await supabase.rpc("inventaire_stock", { p_article: article, p_lieu: de.lieu, p_detenteur: de.detenteur, p_compte: q, p_motif: motif });
    libelle = "un inventaire";
  } else return { erreur: "Mouvement inconnu." };
  if (r.error) return { erreur: r.error.message };
  await journaliser(`a enregistré ${libelle} de stock (${txt(f, "article_libelle") || "article"}, ${q})`);
  revalidatePath("/stock");
  if (type === "inventaire") return { ok: `Inventaire enregistré (écart : ${Number(r.data) > 0 ? "+" : ""}${r.data}).` };
  return { ok: type === "deplacer" ? `${r.data} enregistré(e).` : "Mouvement enregistré." };
}

/** L'agent déclare le matériel qu'il a utilisé (sur le stock qu'il détient). */
export async function declarerUtilisation(_: Etat, f: FormData): Promise<Etat> {
  const s = await exigerSession();
  const supabase = await supabaseServeur();
  const q = num(f, "quantite");
  if (!txt(f, "article_id") || !(q > 0)) return { erreur: "Choisissez l'article et la quantité utilisée." };
  const { error } = await supabase.rpc("utiliser_stock", { p_article: txt(f, "article_id"), p_lieu: null, p_detenteur: s.profil.id,
    p_quantite: q, p_chantier: txt(f, "chantier") || null, p_motif: txt(f, "motif") || null });
  if (error) return { erreur: error.message };
  await journaliser(`a déclaré l'utilisation de ${q} × ${txt(f, "article_libelle")}`);
  revalidatePath("/stock");
  return { ok: "Utilisation enregistrée." };
}

export type LigneImport = { ligne: number; code: string; designation?: string; unite?: string; categorie?: string; provenance?: string;
  seuil?: string; quantite?: string; prix?: string; fournisseur?: string; reference?: string };

/** Import d'un fichier Excel : création des articles et entrées (ou inventaire) en une seule fois. */
export async function importerStock(mode: "entree" | "inventaire", ou: string, lignes: LigneImport[]): Promise<Etat> {
  await exigerDroit("stock.gerer");
  const supabase = await supabaseServeur();
  const e = endroit(ou);
  const { data, error } = await supabase.rpc("importer_stock", { p_mode: mode, p_lieu: e.lieu, p_detenteur: e.detenteur, p_lignes: lignes });
  if (error) return { erreur: error.message };
  const r = data as { lignes: number; articles_crees: number; mouvements: number };
  await journaliser(`a importé un fichier Excel de stock (${mode === "entree" ? "entrées" : "inventaire"} : ${r.lignes} lignes, ${r.articles_crees} articles créés, ${r.mouvements} mouvements)`);
  revalidatePath("/stock");
  return { ok: `Import terminé : ${r.lignes} lignes lues, ${r.articles_crees} article(s) créé(s), ${r.mouvements} mouvement(s) enregistré(s).` };
}
