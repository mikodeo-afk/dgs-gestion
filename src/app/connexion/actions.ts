"use server";
import { redirect } from "next/navigation";
import { supabaseServeur } from "@/lib/supabase/server";
import { identifiantVersEmail } from "@/lib/identifiant";

export async function seConnecter(_: unknown, form: FormData) {
  const pays = String(form.get("pays") ?? "");
  if (!pays) return { erreur: "Choisissez le pays où vous travaillez." };
  const supabase = await supabaseServeur();
  const { error } = await supabase.auth.signInWithPassword({
    email: identifiantVersEmail(String(form.get("email") ?? "")),
    password: String(form.get("motdepasse") ?? ""),
  });
  if (error) return { erreur: "Identifiant ou mot de passe incorrect." };
  // Les identifiants ne fonctionnent que dans le pays où le compte a été créé (sauf accès groupe).
  const { error: e2 } = await supabase.rpc("choisir_pays", { p_code: pays });
  if (e2) {
    await supabase.auth.signOut({ scope: "local" });
    return { erreur: e2.message.includes("pays") ? "Ces identifiants ne sont pas valables pour ce pays." : "Votre compte n'est pas encore activé. Contactez le service RH." };
  }
  redirect("/");
}
