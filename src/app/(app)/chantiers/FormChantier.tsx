"use client";
import { useActionState } from "react";
import { creerChantier } from "./actions";
import BoutonPosition from "@/components/BoutonPosition";

export default function FormChantier({ chefs, clients }: { chefs: { id: string; nom: string }[]; clients: { id: string; nom: string }[] }) {
  const [etat, action, enCours] = useActionState(creerChantier, null);
  return (
    <form className="inline" action={action}>
      <label>Nom du chantier<input id="nom" name="nom" required placeholder="ex. Pylône 30 m – Kati" /></label>
      <label>Domaine
        <select id="domaine" name="domaine"><option>BTP</option><option>Énergie</option><option>Télécoms</option></select>
      </label>
      <label>Client
        <select id="client_id" name="client_id" defaultValue="">
          <option value="">— Choisir —</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
        </select>
      </label>
      <label>Lieu<input id="lieu" name="lieu" placeholder="ex. Commune IV, Bamako" /></label>
      <label>Chef de projet
        <select id="chef_projet_id" name="chef_projet_id">
          <option value="">À désigner</option>
          {chefs.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
        </select>
      </label>
      <label>Montant du marché HT (FCFA)<input id="marche" name="marche" type="number" min="0" step="1000" /></label>
      <label>Budget de dépenses (FCFA)<input id="budget" name="budget" type="number" min="0" step="1000" /></label>
      <label>Latitude du site<input id="latitude" name="latitude" placeholder="ex. 12.6360" inputMode="decimal" /></label>
      <label>Longitude du site<input id="longitude" name="longitude" placeholder="ex. -8.0250" inputMode="decimal" /></label>
      <label>Rayon de pointage (m)<input id="rayon" name="rayon" type="number" min="50" max="2000" step="50" defaultValue={300} /></label>
      <span style={{ alignSelf: "end" }}><BoutonPosition /></span>
      <button className="btn pri" type="submit" disabled={enCours}>{enCours ? "Création…" : "Créer le chantier"}</button>
      <p className="note" style={{ gridColumn: "1/-1" }}>Le client se choisit parmi les clients enregistrés (menu Clients et fournisseurs). Après la création, sur la fiche du chantier : déposez le bon de commande du client (le chantier s&apos;ouvre aussitôt ; sinon le DG ou le DO valide son ouverture), puis ajoutez les activités à mener et leurs quantitatifs prévisionnels.</p>
      {etat?.erreur && <p className="erreur" style={{ gridColumn: "1/-1" }}>{etat.erreur}</p>}
    </form>
  );
}
