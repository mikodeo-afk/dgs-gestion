import "server-only";
import { supabaseServeur } from "./supabase/server";
import type { Fichier } from "@/components/Justificatifs";

/** Documents déposés pour un type de pièce, regroupés par pièce. */
export async function documentsPar(objet: string) {
  const supabase = await supabaseServeur();
  const { data } = await supabase.from("justificatifs").select("id,objet_id,nom_fichier,depose_le").eq("objet", objet).order("depose_le");
  const m = new Map<string, Fichier[]>();
  for (const d of data ?? []) m.set(d.objet_id, [...(m.get(d.objet_id) ?? []), d]);
  return (id: string) => m.get(id) ?? [];
}
