"use server";
import { revalidatePath } from "next/cache";
import { exigerDroit, exigerSession } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { journaliser } from "@/lib/journal";
import { fcfa } from "@/lib/format";

const txt = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function demanderDepense(_: unknown, f: FormData) {
  await exigerDroit("dep.demander");
  const supabase = await supabaseServeur();
  const montant = Number(txt(f, "montant"));
  const chantier = txt(f, "chantier_id");
  const { error } = await supabase.from("depenses").insert({
    chantier_id: chantier === "FG" ? null : chantier, objet: txt(f, "objet"), montant,
    date_depense: txt(f, "date_depense") || undefined,
  });
  if (error) return { erreur: "La demande n'a pas été enregistrée. Vérifiez l'imputation : elle doit être dans votre périmètre." };
  await journaliser(`a demandé ${fcfa(montant)} FCFA pour « ${txt(f, "objet")} »`);
  revalidatePath("/depenses");
  return { ok: "Demande envoyée." };
}

async function appel(nom: string, args: Record<string, unknown>, message: string) {
  await exigerSession();
  const supabase = await supabaseServeur();
  const { error } = await supabase.rpc(nom, args);
  if (error) throw new Error(error.message);
  await journaliser(message);
  revalidatePath("/depenses");
  revalidatePath("/finances");
}

export async function deciderDepense(f: FormData) {
  const accepte = txt(f, "accepte") === "1";
  await appel("decider_depense", { p_id: txt(f, "id"), p_accepte: accepte }, `a ${accepte ? "validé" : "rejeté"} la dépense « ${txt(f, "objet")} »`);
}

export async function payerDepense(f: FormData) {
  await appel("payer_depense", { p_id: txt(f, "id") }, `a payé la dépense « ${txt(f, "objet")} »`);
}
