"use client";
import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CHAMPS_SAISIE, type Saisies } from "@/lib/fiscal/etats";
import { enregistrerSaisies, redigerNotes } from "./actions";

export function FormSaisies({ annee, saisies, verrouille, premier }: { annee: number; saisies: Saisies; verrouille: boolean; premier: boolean }) {
  const [etat, action, enCours] = useActionState(enregistrerSaisies, null);
  const champs = CHAMPS_SAISIE.filter((c) => c.cle !== "tresorerie_debut" || premier);
  return (
    <form className="inline" action={action}>
      <input type="hidden" name="annee" value={annee} />
      {champs.map((c) => (
        <label key={c.cle} htmlFor={`s-${c.cle}`} title={"aide" in c ? c.aide : undefined}>
          {c.libelle}
          <input id={`s-${c.cle}`} name={c.cle} type="number" step="1" defaultValue={saisies[c.cle] ?? ""} disabled={verrouille}
            placeholder={c.cle === "impot_resultat" ? "Automatique" : "0"} />
          {"aide" in c && <span className="note">{c.aide}</span>}
        </label>
      ))}
      {!verrouille && <button className="btn pri" type="submit" disabled={enCours}>{enCours ? "Enregistrement…" : "Enregistrer et recalculer"}</button>}
      {etat?.erreur && <p className="erreur" style={{ gridColumn: "1/-1" }}>{etat.erreur}</p>}
      {etat?.ok && <p className="succes" style={{ gridColumn: "1/-1" }}>{etat.ok}</p>}
    </form>
  );
}

export function BoutonNotes({ annee, deja, active }: { annee: number; deja: boolean; active: boolean }) {
  const [enCours, demarrer] = useTransition();
  const [msg, setMsg] = useState<{ ok?: string; erreur?: string } | null>(null);
  const router = useRouter();
  if (!active) return <p className="note">L&apos;agent IA s&apos;active dès que la clé ANTHROPIC_API_KEY est ajoutée dans les réglages Vercel.</p>;
  return (
    <div className="statusline">
      <button className="btn pri" type="button" disabled={enCours}
        onClick={() => demarrer(async () => { setMsg(null); const r = await redigerNotes(annee); setMsg(r); if (r.ok) router.refresh(); })}>
        {enCours ? "L'agent rédige les notes (1 à 3 minutes)…" : deja ? "Réécrire les notes avec l'agent IA" : "Rédiger les notes annexes avec l'agent IA"}
      </button>
      {msg?.erreur && <span className="erreur">{msg.erreur}</span>}
      {msg?.ok && <span className="succes">{msg.ok}</span>}
    </div>
  );
}
