"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigerDroit } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { journaliser } from "@/lib/journal";
import { fcfa } from "@/lib/format";

type Etat = { ok?: string; erreur?: string } | null;
const txt = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const prix = (f: FormData, k: string) => Number(txt(f, k).replace(/\s/g, "").replace(",", "."));

export async function creerTiers(_: Etat, f: FormData): Promise<Etat> {
  await exigerDroit("tiers.gerer");
  const supabase = await supabaseServeur();
  const { data, error } = await supabase.from("tiers").insert({
    type: txt(f, "type"), nom: txt(f, "nom"), ifu: txt(f, "ifu") || null, rccm: txt(f, "rccm") || null,
    adresse: txt(f, "adresse") || null, telephone: txt(f, "telephone") || null, email: txt(f, "email") || null, contact: txt(f, "contact") || null,
  }).select("id").single();
  if (error) return { erreur: error.code === "23505" ? "Ce nom est déjà enregistré." : error.message };
  await journaliser(`a enregistré ${txt(f, "type") === "client" ? "le client" : txt(f, "type") === "prestataire" ? "le prestataire" : "le fournisseur"} ${txt(f, "nom")}`);
  revalidatePath("/tiers");
  redirect(`/tiers/${data.id}`);
}

export async function modifierTiers(_: Etat, f: FormData): Promise<Etat> {
  await exigerDroit("tiers.gerer");
  const supabase = await supabaseServeur();
  const id = txt(f, "id");
  const { error } = await supabase.from("tiers").update({
    nom: txt(f, "nom"), ifu: txt(f, "ifu") || null, rccm: txt(f, "rccm") || null, adresse: txt(f, "adresse") || null,
    telephone: txt(f, "telephone") || null, email: txt(f, "email") || null, contact: txt(f, "contact") || null, actif: f.get("actif") === "on",
  }).eq("id", id);
  if (error) return { erreur: error.code === "23505" ? "Ce nom est déjà enregistré." : error.message };
  await journaliser(`a modifié la fiche de ${txt(f, "nom")}`);
  revalidatePath(`/tiers/${id}`);
  return { ok: "Fiche enregistrée." };
}

export async function ajouterPrix(_: Etat, f: FormData): Promise<Etat> {
  await exigerDroit("tiers.gerer");
  const pu = prix(f, "prix_unitaire_ht");
  if (!Number.isFinite(pu) || pu < 0) return { erreur: "Prix unitaire invalide." };
  const supabase = await supabaseServeur();
  const { error } = await supabase.from("bordereau_prix").insert({
    tiers_id: txt(f, "tiers_id"), code: txt(f, "code") || null, designation: txt(f, "designation"), unite: txt(f, "unite"), prix_unitaire_ht: pu,
  });
  if (error) return { erreur: error.code === "23505" ? "Ce libellé existe déjà dans le bordereau." : error.message };
  await journaliser(`a ajouté « ${txt(f, "designation")} » (${fcfa(pu)} FCFA HT / ${txt(f, "unite")}) au bordereau de ${txt(f, "nom")}`);
  revalidatePath(`/tiers/${txt(f, "tiers_id")}`);
  return { ok: "Prix ajouté." };
}

export async function modifierPrix(_: Etat, f: FormData): Promise<Etat> {
  await exigerDroit("tiers.gerer");
  const pu = prix(f, "prix_unitaire_ht");
  if (!Number.isFinite(pu) || pu < 0) return { erreur: "Prix unitaire invalide." };
  const supabase = await supabaseServeur();
  const { error } = await supabase.from("bordereau_prix").update({ prix_unitaire_ht: pu, actif: f.get("actif") === "on" }).eq("id", txt(f, "id"));
  if (error) return { erreur: error.message };
  await journaliser(`a réglé le prix de « ${txt(f, "designation")} » à ${fcfa(pu)} FCFA HT (${txt(f, "nom")})`);
  revalidatePath(`/tiers/${txt(f, "tiers_id")}`);
  return { ok: "Enregistré." };
}
