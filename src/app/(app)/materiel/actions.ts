"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigerDroit, exigerSession } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { journaliser } from "@/lib/journal";

type Etat = { ok?: string; erreur?: string } | null;
const txt = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (f: FormData, k: string) => (txt(f, k) === "" ? null : Number(txt(f, k).replace(",", ".").replace(/\s/g, "")));

export async function creerEquipement(_: Etat, f: FormData): Promise<Etat> {
  await exigerDroit("mat.gerer");
  const supabase = await supabaseServeur();
  const roulant = txt(f, "categorie") === "Matériel roulant";
  const { data, error } = await supabase.from("equipements").insert({
    code: txt(f, "code").toUpperCase(), categorie: txt(f, "categorie"), type: txt(f, "type"), designation: txt(f, "designation"),
    marque: txt(f, "marque") || null, modele: txt(f, "modele") || null, numero_serie: txt(f, "numero_serie") || null,
    immatriculation: roulant ? txt(f, "immatriculation").toUpperCase() || null : null,
    annee: num(f, "annee"), date_acquisition: txt(f, "date_acquisition") || null, valeur_acquisition: num(f, "valeur"),
    compteur: num(f, "compteur"), unite_compteur: txt(f, "unite_compteur") === "h" ? "h" : "km",
  }).select("id").single();
  if (error) return { erreur: error.code === "23505" ? "Ce numéro d'inventaire ou cette immatriculation existe déjà." : error.message };
  if (txt(f, "chantier_id") || txt(f, "responsable_id")) {
    const { error: e2 } = await supabase.rpc("affecter_equipement", {
      p_id: data.id, p_chantier: txt(f, "chantier_id") || null, p_responsable: txt(f, "responsable_id") || null,
      p_etat: null, p_compteur: null, p_motif: "Affectation à l'enregistrement",
    });
    if (e2) return { erreur: `Matériel enregistré, mais l'affectation a échoué : ${e2.message}` };
  }
  await journaliser(`a enregistré le matériel ${txt(f, "code").toUpperCase()} « ${txt(f, "designation")} »`);
  redirect(`/materiel/${data.id}`);
}

export async function modifierEquipement(_: Etat, f: FormData): Promise<Etat> {
  await exigerDroit("mat.gerer");
  const supabase = await supabaseServeur();
  const id = txt(f, "id");
  const { error } = await supabase.from("equipements").update({
    designation: txt(f, "designation"), type: txt(f, "type"), marque: txt(f, "marque") || null, modele: txt(f, "modele") || null,
    numero_serie: txt(f, "numero_serie") || null, immatriculation: txt(f, "immatriculation").toUpperCase() || null,
    annee: num(f, "annee"), date_acquisition: txt(f, "date_acquisition") || null, valeur_acquisition: num(f, "valeur"), notes: txt(f, "notes") || null,
  }).eq("id", id);
  if (error) return { erreur: error.code === "23505" ? "Cette immatriculation existe déjà." : error.message };
  revalidatePath(`/materiel/${id}`);
  return { ok: "Fiche enregistrée." };
}

export async function affecter(_: Etat, f: FormData): Promise<Etat> {
  await exigerDroit("mat.gerer");
  const supabase = await supabaseServeur();
  const id = txt(f, "id");
  const { error } = await supabase.rpc("affecter_equipement", {
    p_id: id, p_chantier: txt(f, "chantier_id") || null, p_responsable: txt(f, "responsable_id") || null,
    p_etat: txt(f, "etat") || null, p_compteur: num(f, "compteur"), p_motif: txt(f, "motif") || null,
  });
  if (error) return { erreur: error.message };
  await journaliser(`a affecté le matériel ${txt(f, "code")} (${txt(f, "etat")})`);
  revalidatePath(`/materiel/${id}`);
  revalidatePath("/materiel");
  return { ok: "Affectation enregistrée." };
}

export async function ajouterEntretien(_: Etat, f: FormData): Promise<Etat> {
  await exigerDroit("mat.gerer");
  const supabase = await supabaseServeur();
  const id = txt(f, "equipement_id");
  const { error } = await supabase.from("entretiens").insert({
    equipement_id: id, le: txt(f, "le") || undefined, type: txt(f, "type"), description: txt(f, "description"),
    compteur: num(f, "compteur"), cout: num(f, "cout") ?? 0, prestataire: txt(f, "prestataire") || null,
    chantier_id: txt(f, "chantier_id") || null, prochain_le: txt(f, "prochain_le") || null, prochain_compteur: num(f, "prochain_compteur"),
  });
  if (error) return { erreur: error.message };
  await journaliser(`a enregistré un(e) ${txt(f, "type").toLowerCase()} sur ${txt(f, "code")}`);
  revalidatePath(`/materiel/${id}`);
  return { ok: "Intervention enregistrée." };
}

export async function ajouterPlein(_: Etat, f: FormData): Promise<Etat> {
  await exigerSession();
  const supabase = await supabaseServeur();
  const id = txt(f, "equipement_id");
  const { error } = await supabase.from("pleins").insert({
    equipement_id: id, le: txt(f, "le") || undefined, litres: num(f, "litres"), montant: num(f, "montant"),
    compteur: num(f, "compteur"), chantier_id: txt(f, "chantier_id") || null,
  });
  if (error) return { erreur: "Plein non enregistré : seul le gestionnaire du matériel ou le conducteur du véhicule le saisit." };
  await journaliser(`a enregistré un plein sur ${txt(f, "code")} (${txt(f, "litres")} L)`);
  revalidatePath(`/materiel/${id}`);
  return { ok: "Plein enregistré." };
}
