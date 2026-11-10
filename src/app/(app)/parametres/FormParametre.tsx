"use client";
import { useActionState } from "react";
import { modifierParametre } from "./actions";

export default function FormParametre({ cle, valeur, unite }: { cle: string; valeur: number; unite: string }) {
  const [etat, action, enCours] = useActionState(modifierParametre, null);
  return (
    <form action={action} className="statusline">
      <input type="hidden" name="cle" value={cle} />
      <input id={`p-${cle}`} name="valeur" type="number" step="any" min="0" defaultValue={valeur} aria-label="Nouvelle valeur" style={{ width: 130 }} />
      <span className="note">{unite}</span>
      <button className="btn sm pri" type="submit" disabled={enCours}>Enregistrer</button>
      {etat?.erreur && <span className="erreur">{etat.erreur}</span>}
      {etat?.ok && <span className="succes">{etat.ok}</span>}
    </form>
  );
}
