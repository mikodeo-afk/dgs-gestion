"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigerSession } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";

/** Accès groupe : passe d'une filiale à l'autre. La base refuse si l'accès groupe n'est pas accordé. */
export async function changerPays(f: FormData) {
  const s = await exigerSession();
  if (!s.groupe) throw new Error("Vous n'avez pas l'accès groupe.");
  const supabase = await supabaseServeur();
  const { error } = await supabase.rpc("choisir_pays", { p_code: String(f.get("pays") ?? "") });
  if (error) throw new Error(error.message);
  revalidatePath("/", "layout");
  redirect("/");
}
