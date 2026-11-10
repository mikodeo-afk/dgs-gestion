"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigerDroit, exigerSession } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { journaliser } from "@/lib/journal";

const PREFIXE: Record<string, string> = { BTP: "BTP", "Énergie": "ENR", "Télécoms": "TEL" };
const txt = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (f: FormData, k: string) => Number(String(f.get(k) ?? "").replace(/\s/g, "")) || 0;

export async function creerChantier(_: unknown, f: FormData) {
  await exigerDroit("chantier.creer");
  const supabase = await supabaseServeur();
  const domaine = txt(f, "domaine");
  const { count } = await supabase.from("chantiers").select("id", { count: "exact", head: true }).eq("domaine", domaine);
  const code = `${PREFIXE[domaine] ?? "CH"}-${String((count ?? 0) + 1).padStart(3, "0")}`;
  const lat = txt(f, "latitude"), lon = txt(f, "longitude");
  const clientId = txt(f, "client_id") || null;
  const { data: cli } = clientId ? await supabase.from("tiers").select("nom").eq("id", clientId).maybeSingle() : { data: null };
  const { data, error } = await supabase
    .from("chantiers")
    .insert({
      code, nom: txt(f, "nom"), domaine, lieu: txt(f, "lieu") || null, client: cli?.nom ?? null, client_id: clientId,
      chef_projet_id: txt(f, "chef_projet_id") || null,
      latitude: lat ? Number(lat.replace(",", ".")) : null, longitude: lon ? Number(lon.replace(",", ".")) : null,
      rayon_pointage: num(f, "rayon") || 300,
    })
    .select("id")
    .single();
  if (error) return { erreur: "Le chantier n'a pas été créé : " + error.message };
  await supabase.from("chantiers_finance").insert({ chantier_id: data.id, montant_marche: num(f, "marche"), budget_depenses: num(f, "budget") });
  await journaliser(`a créé le chantier ${code} « ${txt(f, "nom")} »`);
  revalidatePath("/chantiers");
  redirect(`/chantiers/${data.id}`);
}

export async function modifierChantier(f: FormData) {
  await exigerDroit("chantier.creer");
  const supabase = await supabaseServeur();
  const id = txt(f, "id");
  const { error } = await supabase
    .from("chantiers")
    .update({
      statut: txt(f, "statut"), chef_projet_id: txt(f, "chef_projet_id") || null, rayon_pointage: num(f, "rayon") || 300,
      ...(txt(f, "client_id") ? { client_id: txt(f, "client_id"), client: (await supabase.from("tiers").select("nom").eq("id", txt(f, "client_id")).maybeSingle()).data?.nom ?? null } : {}),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  await journaliser(`a modifié le chantier ${txt(f, "code")}`);
  revalidatePath(`/chantiers/${id}`);
}

export async function creerTache(_: unknown, f: FormData) {
  await exigerDroit("tache.creer");
  const supabase = await supabaseServeur();
  const { error } = await supabase.from("taches").insert({
    chantier_id: txt(f, "chantier_id"), titre: txt(f, "titre"),
    assigne_id: txt(f, "assigne_id") || null, echeance: txt(f, "echeance") || null,
  });
  if (error) return { erreur: "La tâche n'a pas été créée. Vérifiez que ce chantier est dans votre périmètre." };
  await journaliser(`a ajouté la tâche « ${txt(f, "titre")} »`);
  revalidatePath(`/chantiers/${txt(f, "chantier_id")}`);
  revalidatePath("/taches");
  return { ok: "Tâche ajoutée." };
}

export async function majAvancement(f: FormData) {
  await exigerSession();
  const supabase = await supabaseServeur();
  const id = txt(f, "id"), avancement = Math.max(0, Math.min(100, num(f, "avancement")));
  const { data, error } = await supabase.from("taches").update({ avancement }).eq("id", id).select("titre,chantier_id").maybeSingle();
  if (error || !data) throw new Error("Vous ne pouvez pas mettre à jour cette tâche.");
  await journaliser(`a mis à jour « ${data.titre} » à ${avancement} %`);
  revalidatePath(`/chantiers/${data.chantier_id}`);
  revalidatePath("/taches");
  revalidatePath("/");
}

type Etat = { ok?: string; erreur?: string } | null;
export async function ajouterLigneChantier(_: Etat, f: FormData): Promise<Etat> {
  await exigerDroit("chantier.creer");
  const supabase = await supabaseServeur();
  const id = txt(f, "chantier_id");
  const q = Number(txt(f, "quantite_prevue").replace(/\s/g, "").replace(",", "."));
  if (!(q > 0)) return { erreur: "Quantité prévue invalide." };
  const bordereau = txt(f, "bordereau_id");
  const { count } = await supabase.from("chantier_lignes").select("id", { count: "exact", head: true }).eq("chantier_id", id);
  const { error } = await supabase.from("chantier_lignes").insert({
    chantier_id: id, ordre: (count ?? 0) + 1, bordereau_id: bordereau || null, quantite_prevue: q,
    designation: bordereau ? "-" : txt(f, "designation"), unite: bordereau ? "-" : txt(f, "unite"),
    prix_unitaire_ht: bordereau ? 0 : num(f, "prix_unitaire_ht"),
  });
  if (error) return { erreur: "La ligne n'a pas été ajoutée : " + error.message };
  await journaliser(`a ajouté une activité au quantitatif du chantier ${txt(f, "code")}`);
  revalidatePath(`/chantiers/${id}`);
  return { ok: "Activité ajoutée." };
}

export async function supprimerLigneChantier(f: FormData) {
  await exigerDroit("chantier.creer");
  const supabase = await supabaseServeur();
  const { error } = await supabase.from("chantier_lignes").delete().eq("id", txt(f, "id"));
  if (error) throw new Error("Cette activité figure déjà sur un PV : elle ne peut plus être supprimée.");
  await journaliser(`a retiré « ${txt(f, "designation")} » du quantitatif du chantier ${txt(f, "code")}`);
  revalidatePath(`/chantiers/${txt(f, "chantier_id")}`);
}

export async function validerChantier(_: Etat, f: FormData): Promise<Etat> {
  await exigerSession();
  const supabase = await supabaseServeur();
  const { error } = await supabase.rpc("valider_chantier", { p_id: txt(f, "id") });
  if (error) return { erreur: error.message };
  await journaliser(`a validé l'ouverture du chantier ${txt(f, "code")} sans bon de commande du client`);
  revalidatePath(`/chantiers/${txt(f, "id")}`);
  revalidatePath("/chantiers");
  return { ok: "Chantier ouvert." };
}
