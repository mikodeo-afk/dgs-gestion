"use client";
import { useActionState } from "react";

type Etat = { ok?: string; erreur?: string } | null;
type Act = (e: Etat, f: FormData) => Promise<Etat>;

function Retour({ etat }: { etat: Etat }) {
  if (etat?.erreur) return <p className="erreur">{etat.erreur}</p>;
  if (etat?.ok) return <p className="succes">{etat.ok}</p>;
  return null;
}

function Annulation({ action, id, numero, quoi }: { action: Act; id: string; numero: string; quoi: string }) {
  const [etat, act, enCours] = useActionState(action, null);
  return (
    <form action={act}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="numero" value={numero} />
      <label>Motif de l&apos;annulation<input name="motif" required placeholder="ex. montant erroné" /></label>
      <button className="btn sm bad" type="submit" disabled={enCours}>Annuler {quoi}</button>
      <Retour etat={etat} />
    </form>
  );
}

function Avoir({ action, id, numero, reste }: { action: Act; id: string; numero: string; reste: number }) {
  const [etat, act, enCours] = useActionState(action, null);
  return (
    <form action={act}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="numero" value={numero} />
      <label>Avoir : montant HT (FCFA)<input name="montant_ht" type="number" min="1" max={reste} required /></label>
      <label>Motif de l&apos;avoir<input name="motif" required placeholder="ex. erreur de quantité" /></label>
      <button className="btn sm" type="submit" disabled={enCours}>Émettre l&apos;avoir</button>
      <Retour etat={etat} />
    </form>
  );
}

/** Bouton « Corriger » : annulation avec motif et, pour une facture client, avoir. */
export function Correction({ id, numero, quoi, annuler, avoir, resteHt = 0 }: {
  id: string; numero: string; quoi: string; annuler?: Act; avoir?: Act; resteHt?: number;
}) {
  if (!annuler && !(avoir && resteHt > 0)) return null;
  return (
    <details className="corr">
      <summary className="btn sm">Corriger</summary>
      <div>
        {annuler && <Annulation action={annuler} id={id} numero={numero} quoi={quoi} />}
        {avoir && resteHt > 0 && <Avoir action={avoir} id={id} numero={numero} reste={resteHt} />}
      </div>
    </details>
  );
}
