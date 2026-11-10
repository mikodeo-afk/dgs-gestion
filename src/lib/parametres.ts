import "server-only";
import { supabaseServeur } from "./supabase/server";

/** Taux de TVA et d'AIB par défaut du pays courant (réglés dans Paramètres). */
export async function tauxDuPays() {
  const supabase = await supabaseServeur();
  const [{ data: tva }, { data: aib }] = await Promise.all([
    supabase.rpc("parametre", { p_cle: "tva" }),
    supabase.rpc("parametre", { p_cle: "aib" }),
  ]);
  return { tva: Number(tva ?? 18), aib: Number(aib ?? 0) };
}

/** Taux AIB proposés sur les factures : les taux usuels et celui du pays. */
export const TAUX_AIB = (defaut: number) => Array.from(new Set([0, 1, 3, 5, defaut])).sort((a, b) => a - b);
