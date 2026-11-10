"use client";
import { useActionState } from "react";
import { etablirPv } from "./actions";

type T = { id: string; nom: string };
export default function FormPv({ chantiers, clients, prestataires }: { chantiers: { id: string; code: string; nom: string }[]; clients: T[]; prestataires: T[] }) {
  const [etat, action, enCours] = useActionState(etablirPv, null);
  return (
    <form className="inline" action={action}>
      <label>Projet<select id="pv-ch" name="chantier_id" required>{chantiers.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.nom}</option>)}</select></label>
      <label>PV pour
        <select id="pv-tiers" name="tiers_id" required defaultValue="">
          <option value="" disabled>Choisir…</option>
          <optgroup label="Client (à facturer)">{clients.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}</optgroup>
          <optgroup label="Prestataire (à payer)">{prestataires.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}</optgroup>
        </select>
      </label>
      <label>Travaux exécutés<input id="pv-objet" name="objet" required placeholder="ex. Attachement n°2 : génie civil" /></label>
      <label>Date du PV<input id="pv-date" name="date_pv" type="date" /></label>
      <label>Avancement (%)<input id="pv-av" name="avancement" type="number" min="0" max="100" /></label>
      <button className="btn pri" type="submit" disabled={enCours}>Établir le PV</button>
      <p className="note" style={{ gridColumn: "1/-1" }}>Vous saisirez ensuite, ligne par ligne, les quantités réellement exécutées. Le montant du PV en découle, au prix du marché (client) ou du bordereau (prestataire).</p>
      {etat?.erreur && <p className="erreur" style={{ gridColumn: "1/-1" }}>{etat.erreur}</p>}
    </form>
  );
}
