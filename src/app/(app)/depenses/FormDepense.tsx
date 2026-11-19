"use client";
import { useActionState } from "react";
import { demanderDepense } from "./actions";

export default function FormDepense({ chantiers, fraisGeneraux, libelle }: { chantiers: { id: string; code: string; nom: string }[]; fraisGeneraux: boolean; libelle: string }) {
  const [etat, action, enCours] = useActionState(demanderDepense, null);
  return (
    <form className="inline" action={action}>
      <label>Objet<input id="d-objet" name="objet" required placeholder="ex. Location camion-grue" /></label>
      <label>Imputation
        <select id="d-ch" name="chantier_id" required defaultValue="">
          <option value="" disabled>— Choisir le projet ou les frais généraux —</option>
          {fraisGeneraux && <option value="FG">Frais généraux (hors projet)</option>}
          {chantiers.length > 0 && (
            <optgroup label="Projets">
              {chantiers.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.nom}</option>)}
            </optgroup>
          )}
        </select>
      </label>
      {!fraisGeneraux && !chantiers.length && (
        <p className="note" style={{ gridColumn: "1/-1" }}>Vous n&apos;êtes rattaché à aucun projet en cours : demandez à votre chef de projet de vous affecter une tâche sur le projet concerné.</p>
      )}
      <label>Montant (FCFA)<input id="d-montant" name="montant" type="number" min="1" step="1" required /></label>
      <label>Date<input id="d-date" name="date_depense" type="date" /></label>
      <button className="btn pri" type="submit" disabled={enCours}>{libelle}</button>
      {etat?.erreur && <p className="erreur" style={{ gridColumn: "1/-1" }}>{etat.erreur}</p>}
      {etat?.ok && <p className="succes" style={{ gridColumn: "1/-1" }}>{etat.ok}</p>}
    </form>
  );
}
