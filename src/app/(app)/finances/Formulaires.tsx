"use client";
import { useActionState } from "react";
import { ajouterFraisGeneral, emettreFacture, enregistrerFactureFournisseur } from "./actions";

type Ch = { id: string; code: string; nom: string };
type Etat = { ok?: string; erreur?: string } | null;
function Retour({ etat }: { etat: Etat }) {
  if (etat?.erreur) return <p className="erreur" style={{ gridColumn: "1/-1" }}>{etat.erreur}</p>;
  if (etat?.ok) return <p className="succes" style={{ gridColumn: "1/-1" }}>{etat.ok}</p>;
  return null;
}

export function FormFactureClient({ chantiers }: { chantiers: Ch[] }) {
  const [etat, action, enCours] = useActionState(emettreFacture, null);
  return (
    <form className="inline" action={action}>
      <label>Projet<select id="fc-ch" name="chantier_id" required>{chantiers.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.nom}</option>)}</select></label>
      <label>Objet<input id="fc-objet" name="objet" required placeholder="ex. Situation n°2" /></label>
      <label>Montant HT (FCFA)<input id="fc-ht" name="montant_ht" type="number" min="1" required /></label>
      <label>Échéance<input id="fc-ech" name="echeance" type="date" required /></label>
      <button className="btn pri" type="submit" disabled={enCours}>Émettre la facture</button>
      <Retour etat={etat} />
    </form>
  );
}

export function FormFactureFournisseur({ chantiers }: { chantiers: Ch[] }) {
  const [etat, action, enCours] = useActionState(enregistrerFactureFournisseur, null);
  return (
    <form className="inline" action={action}>
      <label>Fournisseur<input id="ff-fou" name="fournisseur" required /></label>
      <label>N° de facture<input id="ff-num" name="numero" required /></label>
      <label>Objet<input id="ff-objet" name="objet" required /></label>
      <label>Imputation
        <select id="ff-ch" name="chantier_id" required>
          <option value="FG">Frais généraux (hors projet)</option>
          {chantiers.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.nom}</option>)}
        </select>
      </label>
      <label>Montant HT (FCFA)<input id="ff-ht" name="montant_ht" type="number" min="1" required /></label>
      <label>Échéance<input id="ff-ech" name="echeance" type="date" /></label>
      <button className="btn pri" type="submit" disabled={enCours}>Enregistrer la facture</button>
      <Retour etat={etat} />
    </form>
  );
}

export function FormFraisGeneral({ mois }: { mois: string }) {
  const [etat, action, enCours] = useActionState(ajouterFraisGeneral, null);
  return (
    <form className="inline" action={action}>
      <input type="hidden" name="mois" value={mois} />
      <label>Catégorie
        <select id="fg-cat" name="categorie">
          {["Loyer", "Électricité et eau", "Télécoms", "Véhicules", "Administration", "Divers"].map((c) => <option key={c}>{c}</option>)}
        </select>
      </label>
      <label>Libellé<input id="fg-lib" name="libelle" required /></label>
      <label>Montant (FCFA)<input id="fg-mon" name="montant" type="number" min="1" required /></label>
      <button className="btn pri" type="submit" disabled={enCours}>Ajouter au mois</button>
      <Retour etat={etat} />
    </form>
  );
}
