"use server";
import { revalidatePath } from "next/cache";
import { exigerDroit } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { journaliser } from "@/lib/journal";

export type Resultat = { ok?: string; erreur?: string };

/** Enregistre l'arrivée de l'agent connecté : la base vérifie le rayon du chantier, le selfie et le pointage unique du jour. */
export async function pointer(p: { chantierId: string | null; lat: number; lon: number; precision: number; photo: string }): Promise<Resultat> {
  await exigerDroit("pointer");
  const supabase = await supabaseServeur();
  const { data, error } = await supabase.rpc("pointer", {
    p_chantier: p.chantierId, p_lat: p.lat, p_lon: p.lon, p_precision: Math.round(p.precision), p_photo: p.photo,
  });
  if (error) return { erreur: error.message };
  const r = data as { lieu: string; distance_m: number };
  await journaliser(`a pointé son arrivée sur ${r.lieu} (${r.distance_m} m)`);
  revalidatePath("/pointage");
  revalidatePath("/rh");
  return { ok: `Arrivée enregistrée (${r.lieu}, à ${r.distance_m} m). Les RH vont vérifier votre selfie.` };
}
