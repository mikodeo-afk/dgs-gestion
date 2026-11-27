import { NextResponse, type NextRequest } from "next/server";
import { supabaseServeur } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Ouvre l'opération d'une notification (depuis la cloche ou depuis la notification du téléphone) :
 * la marque comme lue et, pour l'accès groupe, passe dans le pays de l'opération.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServeur();
  const vers = (chemin: string) => NextResponse.redirect(new URL(chemin, request.url));
  const { data: n } = await supabase.from("notifications").select("id,pays,lien").eq("id", id).maybeSingle();
  if (!n) return vers("/notifications");
  await supabase.rpc("marquer_notification_lue", { p_id: n.id });
  const [{ data: courant }, { data: groupe }] = await Promise.all([supabase.rpc("pays_courant"), supabase.rpc("acces_groupe")]);
  if (courant !== n.pays && groupe) await supabase.rpc("choisir_pays", { p_code: n.pays });
  const lien = typeof n.lien === "string" && n.lien.startsWith("/") && !n.lien.startsWith("//") ? n.lien : "/notifications";
  return vers(lien);
}
