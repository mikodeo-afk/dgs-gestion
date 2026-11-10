"use client";
import { useActionState } from "react";
import { creerTache } from "./actions";

export default function FormTache({ chantierId, agents }: { chantierId: string; agents: { id: string; nom: string }[] }) {
  const [etat, action, enCours] = useActionState(creerTache, null);
  return (
    <form className="inline" action={action}>
      <input type="hidden" name="chantier_id" value={chantierId} />
      <label>Tâche<input id="titre" name="titre" required placeholder="ex. Pose chambres de tirage" /></label>
      <label>Assignée à
        <select id="assigne_id" name="assigne_id">
          <option value="">Personne pour l&apos;instant</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.nom}</option>)}
        </select>
      </label>
      <label>Échéance<input id="echeance" name="echeance" type="date" /></label>
      <button className="btn pri" type="submit" disabled={enCours}>Ajouter la tâche</button>
      {etat?.erreur && <p className="erreur" style={{ gridColumn: "1/-1" }}>{etat.erreur}</p>}
      {etat?.ok && <p className="succes" style={{ gridColumn: "1/-1" }}>{etat.ok}</p>}
    </form>
  );
}
