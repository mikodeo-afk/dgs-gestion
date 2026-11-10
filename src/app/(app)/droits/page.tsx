import { exigerSession } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { ORDRE_POSTES, PERIMETRE, POSTES, POSTES_TERRAIN, type Poste, type Profil } from "@/lib/types";
import EditeurDroits from "./EditeurDroits";
import { changerPoste, definirAccesGroupe } from "./actions";

export default async function Droits({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const s = await exigerSession();
  const supabase = await supabaseServeur();
  const { p } = await searchParams;
  const [{ data: perms }, { data: pp }, { data: profils }, { data: perso }] = await Promise.all([
    supabase.from("permissions").select("*").order("ordre"),
    supabase.from("permissions_poste").select("*"),
    supabase.from("profils").select("*").eq("actif", true).order("nom"),
    supabase.from("droits_personne").select("*"),
  ]);
  const catalogue = (perms ?? []) as { cle: string; groupe: string; libelle: string }[];
  const defauts = new Set((pp ?? []).map((x) => `${x.poste}|${x.cle}`));
  const gere = s.peut("droits.gerer");
  const autres = ((profils ?? []) as Profil[]).filter((x) => x.id !== s.profil.id);
  const cible = gere ? autres.find((x) => x.id === p) ?? autres[0] : undefined;
  const mesEcarts = (perso ?? []).filter((d) => d.profil_id === s.profil.id);

  let groupe = "";
  return (
    <>
      <div className="head">
        <div>
          <h1>{gere ? "Rôles et droits" : "Mes droits"}</h1>
          <p className="sub">{s.profil.nom}, {POSTES[s.profil.poste].nom}.</p>
        </div>
      </div>

      <section className="panel">
        <h2>Ce que vous pouvez faire</h2>
        {mesEcarts.length > 0 && (
          <p className="note">
            Vos droits ont été ajustés personnellement :{" "}
            {mesEcarts.map((d) => `${d.accorde ? "accordé" : "retiré"} « ${catalogue.find((c) => c.cle === d.cle)?.libelle} »`).join(", ")}.
          </p>
        )}
        <ul style={{ margin: 0, paddingLeft: 18, columns: "2 260px" }}>
          {catalogue.filter((c) => s.peut(c.cle)).map((c) => <li key={c.cle}>{c.libelle}</li>)}
        </ul>
        {!s.global && <p className="note">Périmètre : {PERIMETRE[s.profil.poste]}.</p>}
      </section>

      {gere && cible && (
        <section className="panel">
          <h2>Droits par personne</h2>
          <p className="note">
            Choisissez une personne, puis cochez ou décochez chaque action. Une action accordée garde le périmètre du poste : un chef
            d&apos;équipe à qui l&apos;on accorde « Voir la rentabilité » ne voit que ses propres chantiers. Le PDG et le Directeur des
            Opérations gardent toujours la gestion des droits.
          </p>
          <form className="statusline" method="get">
            <label htmlFor="p" className="note">Personne</label>
            <select id="p" name="p" className="btn" defaultValue={cible.id}>
              {autres.map((x) => <option key={x.id} value={x.id}>{x.nom} · {POSTES[x.poste].court}</option>)}
            </select>
            <button className="btn sm" type="submit">Afficher</button>
          </form>
          <form className="statusline" action={changerPoste}>
            <input type="hidden" name="profil_id" value={cible.id} />
            <input type="hidden" name="nom" value={cible.nom} />
            <label htmlFor="poste" className="note">Poste de {cible.nom}</label>
            <select id="poste" name="poste" className="btn" defaultValue={cible.poste}>
              {ORDRE_POSTES.filter((x) => x !== "pdg" || s.profil.poste === "pdg").map((x) => <option key={x} value={x}>{POSTES[x].nom}</option>)}
            </select>
            <button className="btn sm" type="submit">Changer le poste</button>
            <span className="note">Changer le poste remet ses droits standards.</span>
          </form>
          {["pdg", "do"].includes(s.profil.poste) && (
            <form className="statusline" action={definirAccesGroupe}>
              <input type="hidden" name="profil_id" value={cible.id} />
              <input type="hidden" name="nom" value={cible.nom} />
              {["pdg", "do"].includes(cible.poste) ? (
                <span className="note">Accès groupe : {cible.nom} travaille dans tous les pays (toujours, pour le PDG et le DO).</span>
              ) : cible.acces_groupe ? (
                <>
                  <span className="note">{cible.nom} a l&apos;accès groupe : il peut travailler dans tous les pays.</span>
                  <input type="hidden" name="oui" value="0" />
                  <button className="btn sm bad" type="submit">Retirer l&apos;accès groupe</button>
                </>
              ) : (
                <>
                  <span className="note">{cible.nom} ne travaille qu&apos;au {s.tousPays.find((x) => x.code === cible.pays)?.nom ?? cible.pays}.</span>
                  <input type="hidden" name="oui" value="1" />
                  <button className="btn sm" type="submit">Accorder l&apos;accès groupe (tous les pays)</button>
                </>
              )}
            </form>
          )}
          <EditeurDroits
            key={cible.id}
            profilId={cible.id}
            lignes={catalogue.map((c) => {
              const defaut = defauts.has(`${cible.poste}|${c.cle}`);
              const ecart = (perso ?? []).find((d) => d.profil_id === cible.id && d.cle === c.cle);
              const verrouille = c.cle === "droits.gerer" && ["pdg", "do"].includes(cible.poste);
              return { ...c, defaut, verrouille, actuel: verrouille ? true : ecart ? ecart.accorde : defaut };
            })}
          />
        </section>
      )}

      <section className="panel">
        <h2>Droits standards par poste</h2>
        <div className="legend">
          <span><span className="mk-y">✓</span> autorisé</span>
          <span><span className="mk-l">texte</span> limité à ce périmètre</span>
          <span><span className="mk-n">—</span> non autorisé</span>
        </div>
        <div className="tbl">
          <table className="matrix">
            <thead>
              <tr><th>Action</th>{ORDRE_POSTES.map((x) => <th key={x} className={x === s.profil.poste ? "me" : ""}>{POSTES[x].court}</th>)}</tr>
            </thead>
            <tbody>
              {catalogue.map((c) => {
                const entete = c.groupe !== groupe ? ((groupe = c.groupe), <tr className="grp" key={"g" + c.groupe}><td colSpan={ORDRE_POSTES.length + 1}>{c.groupe}</td></tr>) : null;
                return [
                  entete,
                  <tr key={c.cle}>
                    <td>{c.libelle}</td>
                    {ORDRE_POSTES.map((x: Poste) => (
                      <td key={x}>
                        {!defauts.has(`${x}|${c.cle}`) ? <span className="mk-n">—</span> : POSTES_TERRAIN.includes(x) ? <span className="mk-l">{PERIMETRE[x]}</span> : <span className="mk-y">✓</span>}
                      </td>
                    ))}
                  </tr>,
                ];
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
