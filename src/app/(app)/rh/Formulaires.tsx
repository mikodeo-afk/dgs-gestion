"use client";
import { useActionState } from "react";
import { enregistrerLignesPaie, enregistrerPresences } from "./actions";

type Etat = { ok?: string; erreur?: string } | null;
function Retour({ etat }: { etat: Etat }) {
  if (etat?.erreur) return <span className="erreur">{etat.erreur}</span>;
  if (etat?.ok) return <span className="succes">{etat.ok}</span>;
  return null;
}

export function FormPresences({ jour, agents }: { jour: string; agents: { id: string; nom: string; poste: string; statut: string; pointage: string }[] }) {
  const [etat, action, enCours] = useActionState(enregistrerPresences, null);
  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <input type="hidden" name="jour" value={jour} />
      <div className="tbl">
        <table>
          <thead><tr><th>Agent</th><th>Pointage</th><th>Présence</th></tr></thead>
          <tbody>
            {agents.map((a) => (
              <tr key={a.id}>
                <td>{a.nom}<br /><span className="note">{a.poste}</span></td>
                <td className="note">{a.pointage || "—"}</td>
                <td>
                  <select name={`p_${a.id}`} defaultValue={a.statut} aria-label={`Présence de ${a.nom}`}>
                    <option value="">Non saisi</option>
                    <option value="P">P · Présent</option>
                    <option value="A">A · Absent</option>
                    <option value="C">C · Congé</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="statusline">
        <button className="btn pri" type="submit" disabled={enCours}>Enregistrer les présences</button>
        <Retour etat={etat} />
      </div>
    </form>
  );
}

export function FormPaie({ mois, lignes, children }: { mois: string; lignes: { id: string; primes: number; avances: number }[]; children: React.ReactNode }) {
  const [etat, action, enCours] = useActionState(enregistrerLignesPaie, null);
  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <input type="hidden" name="mois" value={mois} />
      {children}
      <div className="statusline">
        <button className="btn" type="submit" disabled={enCours || !lignes.length}>Enregistrer primes et avances</button>
        <Retour etat={etat} />
      </div>
    </form>
  );
}
