import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Client avec la clé de service : contourne les règles de la base.
 * À n'utiliser qu'après avoir vérifié le droit de l'utilisateur (voir exigerDroit).
 */
export function supabaseAdmin() {
  const cle = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!cle) throw new Error("SUPABASE_SERVICE_ROLE_KEY manquante dans la configuration du serveur.");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, cle, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
