"use client";
import { useActionState } from "react";
import { deciderBonCommande, demanderAchat, initierBonCommande, rejeterDemande } from "./actions";

type Etat = { ok?: string; erreur?: string } | null;
function Retour({ etat }: { etat: Etat }) {
  if (etat?.erreur) return <p className="erreur" style={{ gridColumn: "1/-1" }}>{etat.erreur}</p>;
  if (etat?.ok) return <p className="succes" style={{ gridColumn: "1/-1" }}>{etat.ok}</p>;
  return null;
}

export function FormDemandeAchat({ chantiers }: { chantiers: { id: string; code: string; nom: string }[] }) {
  const [etat, action, enCours] = useActionState(demanderAchat, null);
  return (
    <form className="inline" action={action}>
      <label>Projet<select id="da-ch" name="chantier_id" required>{chantiers.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.nom}</option>)}</select></label>
      <label>Besoin<input id="da-objet" name="objet" required placeholder="ex. Câble solaire 6 mm²" /></label>
      <label>Quantité, précisions<input id="da-det" name="details" placeholder="ex. 500 m, marque X" /></label>
      <label>Coût estimé (FCFA)<input id="da-est" name="montant_estime" type="number" min="1" /></label>
      <label>Nécessaire le<input id="da-date" name="besoin_le" type="date" /></label>
      <button className="btn pri" type="submit" disabled={enCours}>Envoyer au RAF</button>
      <Retour etat={etat} />
    </form>
  );
}

export function EtudeDemande({ id, numero }: { id: string; numero: string }) {
  const [etatBc, actionBc, enCoursBc] = useActionState(initierBonCommande, null);
  const [etatRej, actionRej, enCoursRej] = useActionState(rejeterDemande, null);
  return (
    <details>
      <summary className="btn sm">Étudier</summary>
      <form className="inline" action={actionBc} style={{ marginTop: 8 }}>
        <input type="hidden" name="demande_id" value={id} /><input type="hidden" name="numero" value={numero} />
        <label>Fournisseur<input name="fournisseur" required /></label>
        <label>Montant HT (FCFA)<input name="montant_ht" type="number" min="1" required /></label>
        <label>TVA<select name="taux_tva" defaultValue="18"><option value="18">18 %</option><option value="0">Exonérée (0 %)</option></select></label>
        <label>Livraison prévue<input name="livraison_le" type="date" /></label>
        <button className="btn sm pri" type="submit" disabled={enCoursBc}>Initier le bon de commande</button>
        <Retour etat={etatBc} />
      </form>
      <form className="inline" action={actionRej} style={{ marginTop: 8 }}>
        <input type="hidden" name="id" value={id} /><input type="hidden" name="numero" value={numero} />
        <label>Motif du rejet<input name="motif" required /></label>
        <button className="btn sm bad" type="submit" disabled={enCoursRej}>Rejeter la demande</button>
        <Retour etat={etatRej} />
      </form>
    </details>
  );
}

export function DecisionBon({ id, numero }: { id: string; numero: string }) {
  const [etat, action, enCours] = useActionState(deciderBonCommande, null);
  return (
    <form action={action} className="statusline" style={{ flexWrap: "wrap" }}>
      <input type="hidden" name="id" value={id} /><input type="hidden" name="numero" value={numero} />
      <button className="btn sm ok" name="accepte" value="1" disabled={enCours}>Valider</button>
      <input name="motif" placeholder="Motif si rejet" aria-label="Motif du rejet" style={{ width: 140 }} />
      <button className="btn sm bad" name="accepte" value="0" disabled={enCours}>Rejeter</button>
      <Retour etat={etat} />
    </form>
  );
}
