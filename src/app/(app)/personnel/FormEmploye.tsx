"use client";
import { useActionState } from "react";
import { creerEmploye } from "./actions";
import { ORDRE_POSTES, POSTES, type Poste } from "@/lib/types";

export default function FormEmploye({ responsables, postes }: { responsables: { id: string; nom: string }[]; postes: Poste[] }) {
  const [etat, action, enCours] = useActionState(creerEmploye, null);
  return (
    <form className="inline" action={action}>
      <label>Nom complet<input id="e-nom" name="nom" required /></label>
      <label>E-mail (identifiant)<input id="e-email" name="email" type="email" required /></label>
      <label>Mot de passe provisoire<input id="e-mdp" name="motdepasse" type="text" minLength={8} required /></label>
      <label>Poste
        <select id="e-poste" name="poste" defaultValue="tech">
          {ORDRE_POSTES.filter((p) => postes.includes(p)).map((p) => <option key={p} value={p}>{POSTES[p].nom}</option>)}
        </select>
      </label>
      <label>Responsable
        <select id="e-resp" name="responsable_id">
          <option value="">Aucun</option>
          {responsables.map((r) => <option key={r.id} value={r.id}>{r.nom}</option>)}
        </select>
      </label>
      <label>Téléphone<input id="e-tel" name="telephone" placeholder="+223 …" /></label>
      <label>Contrat
        <select id="e-contrat" name="contrat"><option>CDD</option><option>CDI</option><option>Stage</option><option>Journalier</option></select>
      </label>
      <label>Date d&apos;embauche<input id="e-emb" name="date_embauche" type="date" /></label>
      <label>Fin de contrat<input id="e-fin" name="date_fin" type="date" /></label>
      <label>Salaire mensuel (FCFA)<input id="e-sal" name="salaire" type="number" min="0" step="1000" /></label>
      <button className="btn pri" type="submit" disabled={enCours}>{enCours ? "Création…" : "Créer le compte"}</button>
      {etat?.erreur && <p className="erreur" style={{ gridColumn: "1/-1" }}>{etat.erreur}</p>}
      {etat?.ok && <p className="succes" style={{ gridColumn: "1/-1" }}>{etat.ok}</p>}
    </form>
  );
}
