"use client";
import { useEffect } from "react";

const CLE = "dgs-rechargement-auto";
// Après une mise à jour de l'application, une page restée ouverte peut réclamer des fichiers qui n'existent plus.
const PERIMEE = /ChunkLoadError|Loading chunk|Loading CSS chunk|Failed to fetch dynamically imported module|Failed to find Server Action|importing a module script failed/i;

/** Écran d'erreur : recharge seul une page devenue obsolète après une mise à jour, sinon propose de recharger. */
export default function ErreurPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
    if (!PERIMEE.test(`${error?.name} ${error?.message}`)) return;
    let deja = 0;
    try { deja = Number(sessionStorage.getItem(CLE) ?? 0); } catch {}
    if (Date.now() - deja > 60000) {
      try { sessionStorage.setItem(CLE, String(Date.now())); } catch {}
      window.location.reload();
    }
  }, [error]);

  return (
    <div className="panel" style={{ maxWidth: 520, margin: "40px auto", textAlign: "center" }}>
      <h2>Un problème est survenu sur cette page</h2>
      <p className="note">L&apos;application vient peut-être d&apos;être mise à jour. Rechargez la page ; si l&apos;erreur revient, envoyez une capture au responsable.</p>
      <p style={{ display: "flex", gap: 8, justifyContent: "center" }}>
        <button type="button" className="btn pri" onClick={() => window.location.reload()}>Recharger la page</button>
        <button type="button" className="btn" onClick={() => reset()}>Réessayer</button>
      </p>
      {error?.digest && <p className="note">Code : {error.digest}</p>}
      <p className="note" style={{ fontSize: 11 }}>{String(error?.message ?? "").slice(0, 200)}</p>
    </div>
  );
}
