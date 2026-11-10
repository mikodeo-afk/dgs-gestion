"use client";
import { useActionState } from "react";
import { saisirQuantites, signerPv } from "../actions";

export type LigneSaisie = { cle: string; designation: string; unite: string; pu: number; prevue: number | null; deja: number; saisie: number };
const qf = (n: number) => Number(n).toLocaleString("fr-FR", { maximumFractionDigits: 3 });
const fc = (n: number) => Math.round(n).toLocaleString("fr-FR");

export type LigneLibre = { id: string; designation: string; unite: string; quantite: number; prix_unitaire_ht: number };

export function FormQuantites({ pvId, lignes, libres, modifiable }: { pvId: string; lignes: LigneSaisie[]; libres: LigneLibre[]; modifiable: boolean }) {
  const [etat, action, enCours] = useActionState(saisirQuantites, null);
  return (
    <form action={action}>
      <input type="hidden" name="pv_id" value={pvId} />
      <div className="tbl">
        <table>
          <thead><tr><th>Activité</th><th>Unité</th><th className="num">Prévu</th><th className="num">Déjà exécuté</th><th className="num">PU HT</th><th className="num">Quantité de ce PV</th></tr></thead>
          <tbody>
            {lignes.map((l) => (
              <tr key={l.cle}>
                <td>{l.designation}</td>
                <td>{l.unite}</td>
                <td className="num">{l.prevue != null ? qf(l.prevue) : "—"}</td>
                <td className="num">{qf(l.deja)}</td>
                <td className="num">{fc(l.pu)}</td>
                <td className="num qte">
                  {modifiable ? <input name={`q:${l.cle}`} type="number" min="0" step="any" defaultValue={l.saisie || ""} aria-label={`Quantité ${l.designation}`} /> : qf(l.saisie)}
                </td>
              </tr>
            ))}
            {libres.map((l) => (
              <tr key={l.id}>
                <td>{l.designation} <span className="note">(hors bordereau)</span></td>
                <td>{l.unite}</td><td className="num">—</td><td className="num">—</td>
                <td className="num">{fc(l.prix_unitaire_ht)}</td>
                <td className="num">{qf(l.quantite)}{modifiable && <label className="note" style={{ display: "inline-flex", gap: 4, marginLeft: 8 }}><input type="checkbox" name={`x:${l.id}`} /> retirer</label>}</td>
              </tr>
            ))}
            {!lignes.length && !libres.length && <tr><td colSpan={6} className="note">Aucune activité : renseignez les quantitatifs du chantier, ou le bordereau du prestataire.</td></tr>}
          </tbody>
        </table>
      </div>
      {modifiable && (
        <div className="inline" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10, alignItems: "end", marginTop: 10 }}>
          <label className="note">Ligne hors bordereau (facultatif)<input name="libre_designation" placeholder="Libellé" /></label>
          <label className="note">Unité<input name="libre_unite" placeholder="u" /></label>
          <label className="note">Quantité<input name="libre_quantite" type="number" min="0" step="any" /></label>
          <label className="note">PU HT<input name="libre_pu" type="number" min="0" /></label>
          <button className="btn pri" type="submit" disabled={enCours}>Enregistrer les quantités</button>
        </div>
      )}
      {etat?.erreur && <p className="erreur">{etat.erreur}</p>}
      {etat?.ok && <p className="succes">{etat.ok}</p>}
    </form>
  );
}

export function FormSigner({ id, numero, pret }: { id: string; numero: string; pret: boolean }) {
  const [etat, action, enCours] = useActionState(signerPv, null);
  return (
    <form action={action} className="statusline">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="numero" value={numero} />
      <label className="note" style={{ display: "flex", gap: 6, alignItems: "center" }}>Signé le<input name="signe_le" type="date" /></label>
      <button className="btn ok" type="submit" disabled={enCours || !pret}>Marquer signé</button>
      {!pret && <span className="note">Saisissez les quantités et déposez le PV signé pour pouvoir le marquer signé.</span>}
      {etat?.erreur && <span className="erreur">{etat.erreur}</span>}
      {etat?.ok && <span className="succes">{etat.ok}</span>}
    </form>
  );
}
