"use client";
import { useActionState } from "react";
import { etablirPv } from "./actions";

export default function FormPv({ chantiers }: { chantiers: { id: string; code: string; nom: string }[] }) {
  const [etat, action, enCours] = useActionState(etablirPv, null);
  return (
    <form className="inline" action={action}>
      <label>Projet<select id="pv-ch" name="chantier_id" required>{chantiers.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.nom}</option>)}</select></label>
      <label>PV pour<select id="pv-type" name="type"><option value="client">Le client (à facturer)</option><option value="prestataire">Un prestataire (à payer)</option></select></label>
      <label>Client ou prestataire<input id="pv-tiers" name="tiers" required /></label>
      <label>Travaux exécutés<input id="pv-objet" name="objet" required placeholder="ex. Situation n°2 : génie civil" /></label>
      <label>Date du PV<input id="pv-date" name="date_pv" type="date" /></label>
      <label>Avancement (%)<input id="pv-av" name="avancement" type="number" min="0" max="100" /></label>
      <label>Montant HT (FCFA)<input id="pv-ht" name="montant_ht" type="number" min="1" required /></label>
      <button className="btn pri" type="submit" disabled={enCours}>Établir le PV</button>
      {etat?.erreur && <p className="erreur" style={{ gridColumn: "1/-1" }}>{etat.erreur}</p>}
      {etat?.ok && <p className="succes" style={{ gridColumn: "1/-1" }}>{etat.ok}</p>}
    </form>
  );
}
