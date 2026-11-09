"use server";
import { redirect } from "next/navigation";
import { supabaseServeur } from "@/lib/supabase/server";

export async function seConnecter(_: unknown, form: FormData) {
  const supabase = await supabaseServeur();
  const { error } = await supabase.auth.signInWithPassword({
    email: String(form.get("email") ?? "").trim(),
    password: String(form.get("motdepasse") ?? ""),
  });
  if (error) return { erreur: "E-mail ou mot de passe incorrect." };
  redirect("/");
}
