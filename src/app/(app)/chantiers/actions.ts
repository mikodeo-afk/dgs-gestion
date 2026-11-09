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
  const { data, error } = await supabase
    .from("chantiers")
    .insert({
      code, nom: txt(f, "nom"), domaine, lieu: txt(f, "lieu") || null, client: txt(f, "client") || null,
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
    .update({ statut: txt(f, "statut"), chef_projet_id: txt(f, "chef_projet_id") || null, rayon_pointage: num(f, "rayon") || 300 })
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
