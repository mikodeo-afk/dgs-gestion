"use server";
import { revalidatePath } from "next/cache";
import { exigerDroit, exigerSession } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { journaliser } from "@/lib/journal";

const txt = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** Enregistre les présences d'un jour pour plusieurs employés (champs « p_<id> »). */
export async function enregistrerPresences(_: unknown, f: FormData) {
  await exigerDroit("pres.saisir");
  const supabase = await supabaseServeur();
  const jour = txt(f, "jour");
  const lignes = [...f.entries()]
    .filter(([k, v]) => k.startsWith("p_") && ["P", "A", "C"].includes(String(v)))
    .map(([k, v]) => ({ profil_id: k.slice(2), jour, statut: String(v) }));
  if (!lignes.length) return { erreur: "Aucune présence à enregistrer." };
  const { error } = await supabase.from("presences").upsert(lignes, { onConflict: "profil_id,jour" });
  if (error) return { erreur: "Présences non enregistrées : vous ne pouvez saisir que votre équipe, le jour même." };
  await journaliser(`a saisi les présences du ${jour.split("-").reverse().join("/")} (${lignes.length} personnes)`);
  revalidatePath("/rh");
  return { ok: `${lignes.length} présence${lignes.length > 1 ? "s" : ""} enregistrée${lignes.length > 1 ? "s" : ""}.` };
}

export async function ouvrirPaie(f: FormData) {
  await exigerDroit("paie.preparer");
  const supabase = await supabaseServeur();
  const { error } = await supabase.rpc("ouvrir_paie", { p_mois: txt(f, "mois") + "-01" });
  if (error) throw new Error(error.message);
  revalidatePath("/rh");
}

export async function enregistrerLignesPaie(_: unknown, f: FormData) {
  await exigerDroit("paie.preparer");
  const supabase = await supabaseServeur();
  const mois = txt(f, "mois") + "-01";
  const ids = new Set([...f.keys()].filter((k) => k.startsWith("primes_")).map((k) => k.slice(7)));
  const lignes = [...ids].map((id) => ({
    mois, profil_id: id, primes: Number(txt(f, "primes_" + id)) || 0, avances: Number(txt(f, "avances_" + id)) || 0,
  }));
  const { error } = await supabase.from("lignes_paie").upsert(lignes, { onConflict: "mois,profil_id" });
  if (error) return { erreur: "Paie non enregistrée : elle n'est peut-être plus en préparation." };
  revalidatePath("/rh");
  return { ok: "Primes et avances enregistrées." };
}

export async function avancerPaie(f: FormData) {
  await exigerSession();
  const supabase = await supabaseServeur();
  const { error } = await supabase.rpc("avancer_paie", { p_mois: txt(f, "mois") + "-01", p_statut: txt(f, "statut") });
  if (error) throw new Error(error.message);
  await journaliser(`a passé la paie de ${txt(f, "libelle")} à « ${txt(f, "statut")} »`);
  revalidatePath("/rh");
}
