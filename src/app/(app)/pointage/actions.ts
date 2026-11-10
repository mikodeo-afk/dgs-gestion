"use server";
import { revalidatePath } from "next/cache";
import { exigerDroit } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { journaliser } from "@/lib/journal";

export type Resultat = { ok?: string; erreur?: string };

/** Enregistre l'arrivée de l'agent connecté : la base vérifie le rayon du chantier, le selfie et le pointage unique du jour. */
export async function pointer(p: { chantierId: string; lat: number; lon: number; precision: number; photo: string }): Promise<Resultat> {
  await exigerDroit("pointer");
  const supabase = await supabaseServeur();
  const { data, error } = await supabase.rpc("pointer", {
    p_chantier: p.chantierId, p_lat: p.lat, p_lon: p.lon, p_precision: Math.round(p.precision), p_photo: p.photo,
  });
  if (error) return { erreur: error.message };
  const r = data as { chantier: string; distance_m: number };
  await journaliser(`a pointé son arrivée sur ${r.chantier} (${r.distance_m} m du site)`);
  revalidatePath("/pointage");
  revalidatePath("/rh");
  return { ok: `Arrivée enregistrée sur ${r.chantier}, à ${r.distance_m} m du site. Les RH vont vérifier votre selfie.` };
}
