"use client";
import { useActionState } from "react";
import { enregistrerDroits } from "./actions";

type Ligne = { cle: string; groupe: string; libelle: string; defaut: boolean; actuel: boolean; verrouille: boolean };

export default function EditeurDroits({ profilId, lignes }: { profilId: string; lignes: Ligne[] }) {
  const [etat, action, enCours] = useActionState(enregistrerDroits, null);
  let groupe = "";
  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <input type="hidden" name="profil_id" value={profilId} />
      <div className="tbl">
        <table className="matrix">
          <thead><tr><th>Action</th><th>Par défaut pour ce poste</th><th>Modification</th></tr></thead>
          <tbody>
            {lignes.map((l) => {
              const entete = l.groupe !== groupe ? ((groupe = l.groupe), <tr className="grp" key={"g" + l.groupe}><td colSpan={3}>{l.groupe}</td></tr>) : null;
              const change = l.actuel !== l.defaut && !l.verrouille;
              return [
                entete,
                <tr key={l.cle}>
                  <td>
                    <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      {l.verrouille && <input type="hidden" name="droit" value={l.cle} />}
                      <input type="checkbox" name="droit" value={l.cle} defaultChecked={l.actuel} disabled={l.verrouille} /> {l.libelle}
                    </label>
                  </td>
                  <td className="note">{l.defaut ? "Oui" : "Non"}</td>
                  <td>{l.verrouille ? <span className="note">Toujours actif</span> : change ? <span className={`pill ${l.actuel ? "p-ok" : "p-bad"}`}>{l.actuel ? "Accordé" : "Retiré"}</span> : null}</td>
                </tr>,
              ];
            })}
          </tbody>
        </table>
      </div>
      <div className="statusline">
        <button className="btn pri" type="submit" disabled={enCours}>{enCours ? "Enregistrement…" : "Enregistrer les droits"}</button>
        {etat?.ok && <span className="succes">{etat.ok}</span>}
        {etat?.erreur && <span className="erreur">{etat.erreur}</span>}
      </div>
    </form>
  );
}
