"use server";
import { revalidatePath } from "next/cache";
import { exigerSession } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { journaliser } from "@/lib/journal";

export type Objet = "pv" | "bon_commande" | "facture_client" | "facture_fournisseur" | "proforma" | "depense" | "tiers" | "bc_client";
const LIBELLE: Record<Objet, string> = {
  pv: "du PV", bon_commande: "du bon de commande", facture_client: "de la facture", facture_fournisseur: "de la facture fournisseur",
  proforma: "de la proforma", depense: "de la dépense", tiers: "de la société", bc_client: "(bon de commande du client) du chantier",
};

/** Enregistre le fichier déposé dans le stockage comme justificatif de la pièce. */
export async function enregistrerJustificatif(d: {
  objet: Objet; objetId: string; chemin: string; nom: string; taille: number; type: string; numero: string; page: string;
  typeDocument?: string; valideJusquau?: string;
}) {
  await exigerSession();
  const supabase = await supabaseServeur();
  const { error } = await supabase.from("justificatifs").insert({
    objet: d.objet, objet_id: d.objetId, chemin: d.chemin, nom_fichier: d.nom, taille: d.taille, type_mime: d.type,
    type_document: d.typeDocument || null, valide_jusquau: d.valideJusquau || null,
  });
  if (error) return { erreur: "Le document n'a pas été enregistré : " + error.message };
  await journaliser(d.typeDocument ? `a déposé « ${d.typeDocument} » de ${d.numero}` : `a déposé le document signé ${LIBELLE[d.objet]} ${d.numero} (${d.nom})`);
  revalidatePath(d.page);
  if (d.objet === "bc_client") revalidatePath("/chantiers");
  return { ok: "Document déposé." };
}

/** Lien temporaire (10 minutes) pour ouvrir un justificatif. */
export async function lienJustificatif(id: string) {
  await exigerSession();
  const supabase = await supabaseServeur();
  const { data } = await supabase.from("justificatifs").select("chemin").eq("id", id).maybeSingle();
  if (!data) return { erreur: "Document introuvable." };
  const { data: lien, error } = await supabase.storage.from("justificatifs").createSignedUrl(data.chemin, 600);
  if (error || !lien) return { erreur: "Le document n'a pas pu être ouvert." };
  return { url: lien.signedUrl };
}
