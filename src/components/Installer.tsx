"use client";
import { useEffect, useState } from "react";

type Invite = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
const CLE = "dgs-installer-masque";

/**
 * Propose d'ajouter DGS Gestion à l'écran d'accueil du téléphone, pour l'ouvrir ensuite
 * dans le vrai navigateur (où la connexion est gardée) et non depuis WhatsApp ou Facebook.
 */
export default function Installer({ connexion = false }: { connexion?: boolean }) {
  const [mode, setMode] = useState<"" | "bouton" | "ios" | "android" | "integre">("");
  const [invite, setInvite] = useState<Invite | null>(null);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    const installee = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone;
    if (installee) return;
    const ua = navigator.userAgent;
    const mobile = /Android|iPhone|iPad|iPod/i.test(ua);
    if (!mobile) return;
    // Navigateur intégré d'une application (WhatsApp, Facebook, Instagram…) : la connexion n'y est pas gardée.
    if (/FBAN|FBAV|FB_IAB|Instagram|WhatsApp|Line\/|; wv\)/i.test(ua)) { setMode("integre"); return; }
    if (connexion) return;
    let masque = 0;
    try { masque = Number(localStorage.getItem(CLE) ?? 0); } catch {}
    if (Date.now() - masque < 7 * 86400000) return;
    if (/iPhone|iPad|iPod/i.test(ua)) { setMode("ios"); return; }
    setMode("android");
    const surInvite = (e: Event) => { e.preventDefault(); setInvite(e as Invite); setMode("bouton"); };
    window.addEventListener("beforeinstallprompt", surInvite);
    const surInstalle = () => setMode("");
    window.addEventListener("appinstalled", surInstalle);
    return () => { window.removeEventListener("beforeinstallprompt", surInvite); window.removeEventListener("appinstalled", surInstalle); };
  }, [connexion]);

  if (!mode) return null;
  const masquer = () => { try { localStorage.setItem(CLE, String(Date.now())); } catch {} setMode(""); };

  if (mode === "integre") {
    return (
      <div className="installer alerte">
        <b>Ouvrez cette page dans Chrome (ou Safari sur iPhone).</b>
        <span>Ici, dans WhatsApp ou Facebook, votre connexion n&apos;est pas gardée et vous reviendrez sans cesse à la page de connexion. Touchez le menu <b>⋮</b> ou <b>…</b> en haut, puis « Ouvrir dans le navigateur ».</span>
      </div>
    );
  }
  return (
    <div className="installer">
      <img src="/icone-192.png" alt="" width={44} height={44} />
      <div>
        <b>Installez DGS Gestion sur votre téléphone</b>
        {mode === "bouton" && <span>Une icône sera ajoutée à votre écran d&apos;accueil pour ouvrir l&apos;application directement.</span>}
        {mode === "ios" && <span>Dans Safari, touchez <b>Partager</b> (carré avec une flèche) puis <b>« Sur l&apos;écran d&apos;accueil »</b>.</span>}
        {mode === "android" && <span>Dans Chrome, touchez le menu <b>⋮</b> puis <b>« Ajouter à l&apos;écran d&apos;accueil »</b> ou <b>« Installer l&apos;application »</b>.</span>}
        <div className="actions">
          {mode === "bouton" && invite && (
            <button type="button" className="btn pri sm" onClick={async () => { await invite.prompt(); const r = await invite.userChoice; if (r.outcome === "accepted") setMode(""); }}>
              Installer
            </button>
          )}
          <button type="button" className="btn sm" onClick={masquer}>Plus tard</button>
        </div>
      </div>
    </div>
  );
}
