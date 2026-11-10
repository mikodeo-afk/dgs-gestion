"use server";
import { revalidatePath } from "next/cache";
import { exigerDroit } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { journaliser } from "@/lib/journal";
import { POSTES, type Poste } from "@/lib/types";

const txt = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** Enregistre les cases cochées : seules les différences avec le poste sont gardées. */
export async function enregistrerDroits(_: unknown, f: FormData) {
  await exigerDroit("droits.gerer");
  const supabase = await supabaseServeur();
  const profilId = txt(f, "profil_id");
  const { data: profil } = await supabase.from("profils").select("nom,poste").eq("id", profilId).single();
  if (!profil) return { erreur: "Employé introuvable." };
  const [{ data: catalogue }, { data: defauts }] = await Promise.all([
    supabase.from("permissions").select("cle"),
    supabase.from("permissions_poste").select("cle").eq("poste", profil.poste),
  ]);
  const parDefaut = new Set((defauts ?? []).map((d) => d.cle));
  const coches = new Set(f.getAll("droit").map(String));
  const ecarts = (catalogue ?? []).map((p) => p.cle).filter((cle) => coches.has(cle) !== parDefaut.has(cle));
  const { error: e1 } = await supabase.from("droits_personne").delete().eq("profil_id", profilId);
  if (e1) return { erreur: e1.message };
  if (ecarts.length) {
    const { error } = await supabase.from("droits_personne").insert(ecarts.map((cle) => ({ profil_id: profilId, cle, accorde: coches.has(cle) })));
    if (error) return { erreur: error.message };
  }
  await journaliser(`a ajusté les droits de ${profil.nom} (${ecarts.length} différence${ecarts.length > 1 ? "s" : ""} avec son poste)`);
  revalidatePath("/droits");
  return { ok: ecarts.length ? `Droits de ${profil.nom} enregistrés.` : `${profil.nom} a les droits standards de son poste.` };
}

/** Le PDG et le DO accordent ou retirent l'accès groupe (travailler dans tous les pays). */
export async function definirAccesGroupe(f: FormData) {
  await exigerDroit("droits.gerer");
  const supabase = await supabaseServeur();
  const oui = txt(f, "oui") === "1";
  const { error } = await supabase.rpc("definir_acces_groupe", { p_profil: txt(f, "profil_id"), p_oui: oui });
  if (error) throw new Error(error.message);
  await journaliser(`a ${oui ? "accordé" : "retiré"} l'accès groupe à ${txt(f, "nom")}`);
  revalidatePath("/droits");
}

export async function changerPoste(f: FormData) {
  await exigerDroit("droits.gerer");
  const supabase = await supabaseServeur();
  const poste = txt(f, "poste") as Poste;
  const id = txt(f, "profil_id");
  const { error } = await supabase.from("profils").update({ poste }).eq("id", id);
  if (error) throw new Error(error.message);
  await supabase.from("droits_personne").delete().eq("profil_id", id);
  await journaliser(`a nommé ${txt(f, "nom")} ${POSTES[poste].nom}`);
  revalidatePath("/droits");
}
