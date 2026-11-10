"use server";
import { revalidatePath } from "next/cache";
import { exigerDroit, exigerSession } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { journaliser } from "@/lib/journal";
import { fcfa } from "@/lib/format";
import { tauxDuPays } from "@/lib/parametres";

type Etat = { ok?: string; erreur?: string } | null;
const txt = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function initierProforma(_: Etat, f: FormData): Promise<Etat> {
  await exigerDroit("pf.initier");
  const supabase = await supabaseServeur();
  const ht = Number(txt(f, "montant_ht"));
  const { data, error } = await supabase.from("proformas").insert({
    client: txt(f, "client"), objet: txt(f, "objet"), domaine: txt(f, "domaine"), details: txt(f, "details") || null,
    montant_ht: ht, taux_tva: txt(f, "taux_tva") === "0" ? 0 : (await tauxDuPays()).tva, date_limite: txt(f, "date_limite") || null,
  }).select("numero").single();
  if (error) return { erreur: "La proforma n'a pas été enregistrée : " + error.message };
  await journaliser(`a initié la proforma ${data.numero} pour ${txt(f, "client")} (${fcfa(ht)} FCFA HT)`);
  revalidatePath("/soumissions");
  return { ok: `Proforma ${data.numero} envoyée au DG et au DO pour visa.` };
}

export async function viserProforma(_: Etat, f: FormData): Promise<Etat> {
  await exigerDroit("pf.valider");
  const supabase = await supabaseServeur();
  const accepte = txt(f, "accepte") === "1";
  const { data, error } = await supabase.rpc("viser_proforma", { p_id: txt(f, "id"), p_accepte: accepte, p_motif: txt(f, "motif") || null });
  if (error) return { erreur: error.message };
  await journaliser(`a ${accepte ? "visé" : "refusé"} la proforma ${txt(f, "numero")}`);
  revalidatePath("/soumissions");
  return { ok: data === "Validée" ? "Proforma validée par le DG et le DO." : data === "Rejetée" ? "Proforma rejetée." : "Visa enregistré : en attente du second visa." };
}

export async function resultatProforma(f: FormData) {
  await exigerSession();
  const supabase = await supabaseServeur();
  const gagnee = txt(f, "gagnee") === "1";
  const { error } = await supabase.rpc("resultat_proforma", { p_id: txt(f, "id"), p_gagnee: gagnee });
  if (error) throw new Error(error.message);
  await journaliser(`a marqué la soumission ${txt(f, "numero")} ${gagnee ? "gagnée" : "perdue"}`);
  revalidatePath("/soumissions");
}
