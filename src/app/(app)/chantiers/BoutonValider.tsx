"use client";
import { useActionState } from "react";
import { validerChantier } from "./actions";

export default function BoutonValider({ id, code }: { id: string; code: string }) {
  const [etat, action, enCours] = useActionState(validerChantier, null);
  return (
    <form action={action} className="statusline">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="code" value={code} />
      <button className="btn ok" type="submit" disabled={enCours}>Valider l&apos;ouverture sans bon de commande</button>
      {etat?.erreur && <span className="erreur">{etat.erreur}</span>}
    </form>
  );
}
