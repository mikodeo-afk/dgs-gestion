"use client";
import { useActionState, useState } from "react";
import { fcfa } from "@/lib/format";
import { ajouterLigneChantier } from "./actions";

type Prix = { id: string; code: string | null; designation: string; unite: string; prix_unitaire_ht: number };

export default function FormLigne({ chantierId, code, bordereau }: { chantierId: string; code: string; bordereau: Prix[] }) {
  const [etat, action, enCours] = useActionState(ajouterLigneChantier, null);
  const [choix, setChoix] = useState(bordereau[0]?.id ?? "");
  return (
    <form className="inline" action={action}>
      <input type="hidden" name="chantier_id" value={chantierId} />
      <input type="hidden" name="code" value={code} />
      <label style={{ gridColumn: "span 2" }}>Activité
        <select id="cl-bp" name="bordereau_id" value={choix} onChange={(e) => setChoix(e.target.value)}>
          {bordereau.map((b) => <option key={b.id} value={b.id}>{b.code ? `${b.code} · ` : ""}{b.designation} ({fcfa(b.prix_unitaire_ht)} FCFA / {b.unite})</option>)}
          <option value="">Autre activité (hors bordereau)</option>
        </select>
      </label>
      {!choix && (
        <>
          <label>Libellé<input id="cl-des" name="designation" required /></label>
          <label>Unité<input id="cl-unite" name="unite" required placeholder="ml, m³, u…" /></label>
          <label>Prix unitaire HT<input id="cl-pu" name="prix_unitaire_ht" type="number" min="0" /></label>
        </>
      )}
      <label>Quantité prévue<input id="cl-q" name="quantite_prevue" type="number" min="0" step="any" required /></label>
      <button className="btn pri" type="submit" disabled={enCours}>Ajouter l&apos;activité</button>
      {etat?.erreur && <p className="erreur" style={{ gridColumn: "1/-1" }}>{etat.erreur}</p>}
      {etat?.ok && <p className="succes" style={{ gridColumn: "1/-1" }}>{etat.ok}</p>}
    </form>
  );
}
