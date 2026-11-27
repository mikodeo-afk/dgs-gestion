import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import webpush from "web-push";
import { supabaseAdmin } from "./supabase/admin";

type Config = { url: string; secret: string; vapid_publique: string; vapid_privee: string };

/**
 * Réglages de l'envoi des notifications sur les appareils. À la toute première activation,
 * l'application crée elle-même ses clés (VAPID) et le secret partagé avec la base :
 * rien à configurer dans Vercel. L'adresse est celle du site (URL_APPLICATION si elle est définie).
 */
export async function configPush(origine: string): Promise<Config> {
  const admin = supabaseAdmin();
  const { data } = await admin.from("push_config").select("*").eq("id", 1).maybeSingle();
  if (data) return data as Config;
  const cles = webpush.generateVAPIDKeys();
  const base = (process.env.URL_APPLICATION || origine).replace(/\/$/, "");
  const nouvelle: Config = {
    url: `${base}/api/push`,
    secret: randomBytes(32).toString("hex"),
    vapid_publique: cles.publicKey,
    vapid_privee: cles.privateKey,
  };
  // Si deux personnes activent en même temps, la première configuration est gardée.
  await admin.from("push_config").upsert({ id: 1, ...nouvelle }, { onConflict: "id", ignoreDuplicates: true });
  const { data: finale } = await admin.from("push_config").select("*").eq("id", 1).single();
  return finale as Config;
}

const egal = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Envoie une notification sur tous les appareils de son destinataire. Appelé par la base (pg_net). */
export async function envoyerNotification(id: string, secret: string) {
  const admin = supabaseAdmin();
  const { data: c } = await admin.from("push_config").select("*").eq("id", 1).maybeSingle();
  if (!c || !egal(secret, (c as Config).secret)) return { statut: 401 };
  const config = c as Config;
  const { data: n } = await admin.from("notifications").select("id,destinataire_id,titre,message,objet,objet_id").eq("id", id).maybeSingle();
  if (!n) return { statut: 404 };
  const { data: appareils } = await admin.from("push_abonnements").select("id,endpoint,p256dh,auth").eq("profil_id", n.destinataire_id);
  const { count } = await admin.from("notifications").select("id", { count: "exact", head: true })
    .eq("destinataire_id", n.destinataire_id).is("lue_le", null).is("traitee_le", null);
  const corps = JSON.stringify({
    titre: n.titre,
    message: n.message ?? "",
    lien: `/notifications/ouvrir/${n.id}`,
    tag: `${n.objet}-${n.objet_id}`,
    compteur: count ?? 0,
  });
  const sujet = new URL(config.url).origin;
  let envoyes = 0;
  await Promise.all((appareils ?? []).map(async (a) => {
    try {
      await webpush.sendNotification(
        { endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } },
        corps,
        { vapidDetails: { subject: sujet, publicKey: config.vapid_publique, privateKey: config.vapid_privee }, TTL: 86400, urgency: "high" },
      );
      envoyes++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      // Appareil désabonné ou application désinstallée : on l'oublie.
      if (code === 404 || code === 410) await admin.from("push_abonnements").delete().eq("id", a.id);
    }
  }));
  return { statut: 200, envoyes };
}
