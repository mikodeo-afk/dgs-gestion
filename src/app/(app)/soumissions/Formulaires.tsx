"use client";
import { useActionState } from "react";
import { initierProforma, viserProforma } from "./actions";

type Etat = { ok?: string; erreur?: string } | null;
function Retour({ etat }: { etat: Etat }) {
  if (etat?.erreur) return <p className="erreur" style={{ gridColumn: "1/-1" }}>{etat.erreur}</p>;
  if (etat?.ok) return <p className="succes" style={{ gridColumn: "1/-1" }}>{etat.ok}</p>;
  return null;
}

export function FormProforma() {
  const [etat, action, enCours] = useActionState(initierProforma, null);
  return (
    <form className="inline" action={action}>
      <label>Client<input id="pf-client" name="client" required /></label>
      <label>Objet de la soumission<input id="pf-objet" name="objet" required placeholder="ex. AO pose fibre lot 2" /></label>
      <label>Domaine<select id="pf-dom" name="domaine">{["BTP", "Énergie", "Télécoms"].map((d) => <option key={d}>{d}</option>)}</select></label>
      <label>Montant HT (FCFA)<input id="pf-ht" name="montant_ht" type="number" min="1" required /></label>
      <label>TVA<select id="pf-tva" name="taux_tva" defaultValue="18"><option value="18">Taux du pays</option><option value="0">Exonérée (0 %)</option></select></label>
      <label>Date limite de dépôt<input id="pf-date" name="date_limite" type="date" /></label>
      <label style={{ gridColumn: "1/-1" }}>Précisions<input id="pf-det" name="details" /></label>
      <button className="btn pri" type="submit" disabled={enCours}>Envoyer pour visa (DG et DO)</button>
      <Retour etat={etat} />
    </form>
  );
}

export function VisaProforma({ id, numero }: { id: string; numero: string }) {
  const [etat, action, enCours] = useActionState(viserProforma, null);
  return (
    <form action={action} className="statusline" style={{ flexWrap: "wrap" }}>
      <input type="hidden" name="id" value={id} /><input type="hidden" name="numero" value={numero} />
      <button className="btn sm ok" name="accepte" value="1" disabled={enCours}>Viser</button>
      <input name="motif" placeholder="Motif si refus" aria-label="Motif du refus" style={{ width: 140 }} />
      <button className="btn sm bad" name="accepte" value="0" disabled={enCours}>Refuser</button>
      <Retour etat={etat} />
    </form>
  );
}
