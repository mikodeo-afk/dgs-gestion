"use server";
import { revalidatePath } from "next/cache";
import { exigerDroit, exigerSession } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { journaliser } from "@/lib/journal";

type Etat = { ok?: string; erreur?: string } | null;
const txt = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function etablirPv(_: Etat, f: FormData): Promise<Etat> {
  await exigerDroit("pv.initier");
  const supabase = await supabaseServeur();
  const av = txt(f, "avancement");
  const { data, error } = await supabase.from("pv_execution").insert({
    chantier_id: txt(f, "chantier_id"), type: txt(f, "type"), tiers: txt(f, "tiers"), objet: txt(f, "objet"),
    date_pv: txt(f, "date_pv") || undefined, avancement: av ? Number(av) : null, montant_ht: Number(txt(f, "montant_ht")),
  }).select("numero").single();
  if (error) return { erreur: "Le PV n'a pas été enregistré : " + error.message };
  await journaliser(`a établi le PV d'exécution ${data.numero} (${txt(f, "type")} : ${txt(f, "tiers")})`);
  revalidatePath("/pv");
  return { ok: `PV ${data.numero} établi. Marquez-le signé dès que ${txt(f, "type") === "client" ? "le client" : "le prestataire"} l'a signé.` };
}

export async function signerPv(f: FormData) {
  await exigerDroit("pv.initier");
  const supabase = await supabaseServeur();
  const { error } = await supabase.rpc("signer_pv", { p_id: txt(f, "id") });
  if (error) throw new Error(error.message);
  await journaliser(`a enregistré la signature du PV ${txt(f, "numero")}`);
  revalidatePath("/pv");
  revalidatePath("/finances");
}

export async function annulerPv(_: Etat, f: FormData): Promise<Etat> {
  await exigerSession();
  const supabase = await supabaseServeur();
  const { error } = await supabase.rpc("annuler_pv", { p_id: txt(f, "id"), p_motif: txt(f, "motif") });
  if (error) return { erreur: error.message };
  await journaliser(`a annulé le PV ${txt(f, "numero")} (motif : ${txt(f, "motif")})`);
  revalidatePath("/pv");
  revalidatePath("/finances");
  return { ok: `PV ${txt(f, "numero")} annulé.` };
}
