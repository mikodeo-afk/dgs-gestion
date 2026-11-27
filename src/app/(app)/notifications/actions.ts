"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { exigerSession } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { configPush } from "@/lib/push";

export async function toutMarquerLu() {
  await exigerSession();
  const supabase = await supabaseServeur();
  await supabase.rpc("marquer_notifications_lues");
  revalidatePath("/", "layout");
}

/** Clé publique pour abonner cet appareil (créée à la première activation). */
export async function clePush(): Promise<{ cle?: string; erreur?: string }> {
  await exigerSession();
  try {
    const h = await headers();
    const hote = h.get("x-forwarded-host") ?? h.get("host") ?? "";
    const proto = h.get("x-forwarded-proto") ?? "https";
    const c = await configPush(`${proto}://${hote}`);
    return { cle: c.vapid_publique };
  } catch {
    return { erreur: "Les notifications sur l'appareil ne sont pas encore installées sur le serveur (fichier SQL 23)." };
  }
}

export async function enregistrerAppareil(a: { endpoint: string; p256dh: string; auth: string; appareil: string }) {
  await exigerSession();
  const supabase = await supabaseServeur();
  const { error } = await supabase.rpc("enregistrer_appareil_push", {
    p_endpoint: a.endpoint, p_p256dh: a.p256dh, p_auth: a.auth, p_appareil: a.appareil,
  });
  if (error) return { erreur: error.message };
  revalidatePath("/notifications");
  return { ok: true };
}

export async function retirerAppareil(endpoint: string) {
  await exigerSession();
  const supabase = await supabaseServeur();
  await supabase.from("push_abonnements").delete().eq("endpoint", endpoint);
  revalidatePath("/notifications");
}

/** Compteur de la cloche (rafraîchi à chaque page et toutes les minutes). */
export async function compteurNotifications(): Promise<number> {
  const supabase = await supabaseServeur();
  const { data } = await supabase.rpc("notifications_non_lues");
  return Number(data ?? 0);
}
