export function Barre({ valeur }: { valeur: number }) {
  const v = Math.max(0, Math.min(100, Math.round(valeur)));
  return (
    <div className="prog">
      <div className="bar" style={{ flex: 1 }}>
        <i style={{ width: `${v}%` }} />
      </div>
      <span>{v} %</span>
    </div>
  );
}

const PILL: Record<string, string> = {
  "En cours": "p-ok", Terminé: "p-info", Terminée: "p-ok", Démarrage: "p-info", Suspendu: "p-warn",
  "En retard": "p-bad", "À faire": "p-info",
};
export function Pastille({ texte, ton }: { texte: string; ton?: "ok" | "warn" | "bad" | "info" }) {
  return <span className={`pill ${ton ? "p-" + ton : PILL[texte] ?? "p-info"}`}>{texte}</span>;
}

export function Kpi({ libelle, valeur, unite, ton }: { libelle: string; valeur: React.ReactNode; unite?: string; ton?: "neg" | "pos" | "hl" }) {
  return (
    <div className={`kpi ${ton ?? ""}`}>
      <div className="l">{libelle}</div>
      <div className="v">
        {valeur} {unite && <small>{unite}</small>}
      </div>
    </div>
  );
}

export function Verrou({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <div className="lock">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <rect x="4" y="11" width="16" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
      <div>
        <b>{titre}</b>
        <br />
        {children}
      </div>
    </div>
  );
}

export function etatTache(t: { avancement: number; echeance: string | null }, auj: string) {
  if (t.avancement >= 100) return <Pastille texte="Terminée" />;
  if (t.echeance && t.echeance < auj) return <Pastille texte="En retard" />;
  if (t.avancement > 0) return <Pastille texte="En cours" ton="warn" />;
  return <Pastille texte="À faire" />;
}
