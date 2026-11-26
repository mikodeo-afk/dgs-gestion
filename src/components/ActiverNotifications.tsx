"use client";
import { useEffect, useState } from "react";
import { clePush, enregistrerAppareil, retirerAppareil } from "@/app/(app)/notifications/actions";

const versOctets = (b64: string) => {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const brut = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(brut, (c) => c.charCodeAt(0));
};

const nomAppareil = () => {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return "iPhone / iPad";
  if (/Android/i.test(ua)) return "Téléphone Android";
  if (/Windows/i.test(ua)) return "Ordinateur Windows";
  if (/Mac/i.test(ua)) return "Mac";
  return "Navigateur";
};

/** Active (ou coupe) les notifications sur ce téléphone ou cet ordinateur. */
export default function ActiverNotifications() {
  const [etat, setEtat] = useState<"" | "indispo" | "ios" | "refuse" | "off" | "on" | "encours">("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
      const installee = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setEtat(ios && !installee ? "ios" : "indispo");
        return;
      }
      if (Notification.permission === "denied") { setEtat("refuse"); return; }
      const reg = await navigator.serviceWorker.getRegistration();
      const abo = await reg?.pushManager.getSubscription();
      setEtat(abo && Notification.permission === "granted" ? "on" : "off");
    })().catch(() => setEtat("indispo"));
  }, []);

  async function activer() {
    setEtat("encours"); setMsg("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setEtat(permission === "denied" ? "refuse" : "off"); return; }
      const { cle, erreur } = await clePush();
      if (!cle) { setMsg(erreur ?? "Activation impossible."); setEtat("off"); return; }
      await navigator.serviceWorker.register("/sw.js");
      const reg = await navigator.serviceWorker.ready;
      let abo = await reg.pushManager.getSubscription();
      if (!abo) abo = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: versOctets(cle) });
      const j = abo.toJSON();
      const r = await enregistrerAppareil({ endpoint: abo.endpoint, p256dh: j.keys?.p256dh ?? "", auth: j.keys?.auth ?? "", appareil: nomAppareil() });
      if (r.erreur) { setMsg(r.erreur); setEtat("off"); return; }
      setEtat("on"); setMsg("Notifications activées sur cet appareil.");
    } catch {
      setMsg("Activation impossible sur cet appareil."); setEtat("off");
    }
  }

  async function couper() {
    setEtat("encours");
    const reg = await navigator.serviceWorker.getRegistration();
    const abo = await reg?.pushManager.getSubscription();
    if (abo) { await retirerAppareil(abo.endpoint); await abo.unsubscribe().catch(() => {}); }
    setEtat("off"); setMsg("Notifications coupées sur cet appareil.");
  }

  if (!etat) return null;
  return (
    <section className="panel notif-appareil">
      <div>
        <b>Notifications sur cet appareil</b>
        {etat === "on" && <span>Activées : vous êtes prévenu ici même quand l&apos;application est fermée.</span>}
        {etat === "off" && <span>Soyez prévenu sur ce téléphone ou cet ordinateur dès qu&apos;une opération attend votre validation.</span>}
        {etat === "encours" && <span>Un instant…</span>}
        {etat === "refuse" && <span>Les notifications sont bloquées pour ce site. Autorisez-les dans les réglages du navigateur (icône à gauche de l&apos;adresse), puis revenez ici.</span>}
        {etat === "ios" && <span>Sur iPhone, ajoutez d&apos;abord DGS Gestion à l&apos;écran d&apos;accueil (Safari : Partager, puis « Sur l&apos;écran d&apos;accueil »), ouvrez-la depuis l&apos;icône, puis revenez ici.</span>}
        {etat === "indispo" && <span>Ce navigateur ne reçoit pas de notifications. Les opérations à valider restent visibles ici, avec la cloche.</span>}
        {msg && <span className="note">{msg}</span>}
      </div>
      {etat === "off" && <button type="button" className="btn pri sm" onClick={activer}>Activer</button>}
      {etat === "on" && <button type="button" className="btn sm" onClick={couper}>Couper</button>}
    </section>
  );
}
