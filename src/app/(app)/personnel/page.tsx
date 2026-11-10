import { exigerSession } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { dateFr, fcfa } from "@/lib/format";
import { ORDRE_POSTES, POSTES, type Poste, type Profil } from "@/lib/types";
import { Kpi, Pastille } from "@/components/ui";
import FormEmploye from "./FormEmploye";
import { basculerActif, modifierEmploye } from "./actions";

function equipe(id: string, tous: Profil[]) {
  const n1 = tous.filter((p) => p.responsable_id === id).map((p) => p.id);
  const n2 = tous.filter((p) => p.responsable_id && n1.includes(p.responsable_id)).map((p) => p.id);
  return new Set([id, ...n1, ...n2]);
}

export default async function Personnel() {
  const s = await exigerSession();
  const supabase = await supabaseServeur();
  const [{ data: profils }, { data: rem }] = await Promise.all([
    supabase.from("profils").select("*").order("nom"),
    supabase.from("remunerations").select("*"),
  ]);
  const tous = (profils ?? []) as Profil[];
  const sal = new Map((rem ?? []).map((r) => [r.profil_id, Number(r.salaire_base)]));
  const voitSal = s.peut("sal.voir");
  const edite = s.peut("emp.ajouter");
  const gere = s.peut("droits.gerer");
  const visibles = s.global ? tous : tous.filter((p) => equipe(s.profil.id, tous).has(p.id));
  const noms = new Map(tous.map((p) => [p.id, p.nom]));
  const responsables = tous.filter((p) => p.actif && p.poste !== "tech");
  const postesCreables: Poste[] = ORDRE_POSTES.filter((p) => (p === "pdg" ? s.profil.poste === "pdg" : p === "do" ? gere : true));
  const actifs = tous.filter((p) => p.actif);

  return (
    <>
      <div className="head">
        <div>
          <h1>{s.profil.poste === "tech" ? "Ma fiche" : "Personnel"}</h1>
          <p className="sub">{s.global ? `Tout le personnel de DGS ${s.pays.nom}.` : "Vous et votre équipe."}</p>
        </div>
      </div>
      {voitSal && (
        <div className="kpis">
          <Kpi libelle="Effectif actif" valeur={actifs.length} />
          <Kpi libelle="Masse salariale mensuelle" valeur={fcfa(actifs.reduce((a, p) => a + (sal.get(p.id) ?? 0), 0))} unite="FCFA" />
        </div>
      )}
      {edite && (
        <section className="panel">
          <h2>Ajouter un employé</h2>
          <p className="note">Le compte est créé tout de suite. L&apos;employé se connecte avec son e-mail et ce mot de passe provisoire.</p>
          <FormEmploye responsables={responsables.map((r) => ({ id: r.id, nom: r.nom }))} postes={postesCreables} />
        </section>
      )}
      <section className="panel">
        <div className="tbl">
          <table>
            <thead>
              <tr>
                <th>Nom</th><th>Poste</th><th>Responsable</th><th>Contrat</th><th className="num">Embauche</th>
                {voitSal && <th className="num">Salaire FCFA</th>}
                <th>Compte</th>
                {edite && <th>Modifier</th>}
              </tr>
            </thead>
            <tbody>
              {visibles.map((p) => (
                <tr key={p.id}>
                  <td>{p.nom}<br /><span className="note">{[p.email, p.telephone].filter(Boolean).join(" · ")}</span></td>
                  <td>{POSTES[p.poste].nom}</td>
                  <td>{p.responsable_id ? noms.get(p.responsable_id) : "—"}</td>
                  <td>{p.contrat}{p.date_fin && <><br /><span className="note">fin {dateFr(p.date_fin)}</span></>}</td>
                  <td className="num">{dateFr(p.date_embauche)}</td>
                  {voitSal && <td className="num">{sal.has(p.id) ? fcfa(sal.get(p.id)) : "—"}</td>}
                  <td>
                    {p.actif ? <Pastille texte="Actif" ton="ok" /> : <Pastille texte="Inactif" ton="bad" />}
                    {gere && p.id !== s.profil.id && (
                      <form action={basculerActif} style={{ marginTop: 4 }}>
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="nom" value={p.nom} />
                        <input type="hidden" name="actif" value={p.actif ? "0" : "1"} />
                        <button className="btn sm" type="submit">{p.actif ? "Désactiver" : "Activer"}</button>
                      </form>
                    )}
                  </td>
                  {edite && (
                    <td>
                      <form className="ligne" action={modifierEmploye}>
                        <input type="hidden" name="id" value={p.id} />
                        <select name="responsable_id" defaultValue={p.responsable_id ?? ""} aria-label={`Responsable de ${p.nom}`}>
                          <option value="">Aucun responsable</option>
                          {responsables.filter((r) => r.id !== p.id).map((r) => <option key={r.id} value={r.id}>{r.nom}</option>)}
                        </select>
                        <select name="contrat" defaultValue={p.contrat} aria-label={`Contrat de ${p.nom}`}>
                          {["CDI", "CDD", "Stage", "Journalier", "Mandataire"].map((c) => <option key={c}>{c}</option>)}
                        </select>
                        <input name="date_fin" type="date" defaultValue={p.date_fin ?? ""} aria-label={`Fin de contrat de ${p.nom}`} />
                        {voitSal && <input name="salaire" type="number" min="0" step="1000" defaultValue={sal.get(p.id) ?? 0} aria-label={`Salaire de ${p.nom}`} style={{ width: 110 }} />}
                        <button className="btn sm" type="submit">Enregistrer</button>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
