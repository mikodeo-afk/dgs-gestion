import { exigerSession } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { POSTES, type Chantier, type Tache } from "@/lib/types";
import { aujourdhui, heureFr } from "@/lib/format";
import { Barre, Kpi, Pastille } from "@/components/ui";

export default async function TableauDeBord() {
  const s = await exigerSession();
  const supabase = await supabaseServeur();
  const auj = aujourdhui();
  const [{ data: chantiers }, { data: avancement }, { data: taches }, { data: journal }, { data: profils }] = await Promise.all([
    supabase.from("chantiers").select("*").order("code"),
    supabase.rpc("avancement_chantiers"),
    supabase.from("taches").select("*"),
    supabase.from("journal").select("*").order("cree_le", { ascending: false }).limit(10),
    supabase.from("profils").select("id,nom"),
  ]);
  const av = new Map(((avancement ?? []) as { chantier_id: string; avancement: number }[]).map((a) => [a.chantier_id, Number(a.avancement)]));
  const noms = new Map((profils ?? []).map((p) => [p.id, p.nom]));
  const mesTaches = (taches ?? []) as Tache[];
  const mesChantiers = new Set(
    s.global
      ? (chantiers ?? []).map((c) => c.id)
      : [...(chantiers ?? []).filter((c) => c.chef_projet_id === s.profil.id).map((c) => c.id), ...mesTaches.map((t) => t.chantier_id)],
  );
  const ouvertes = mesTaches.filter((t) => t.avancement < 100);
  const retard = ouvertes.filter((t) => t.echeance && t.echeance < auj).length;

  return (
    <>
      <div className="head">
        <div>
          <h1>Bonjour {s.profil.nom.split(" ")[0]}</h1>
          <p className="sub">{POSTES[s.profil.poste].nom}. Voici l&apos;avancement des activités de DGS {s.pays.nom}.</p>
        </div>
      </div>
      <div className="kpis">
        <Kpi libelle="Chantiers suivis" valeur={mesChantiers.size} unite={`/ ${(chantiers ?? []).length}`} />
        {(s.peut("tache.maj") || s.peut("tache.creer")) && (
          <Kpi libelle="Tâches ouvertes" valeur={ouvertes.length} unite={retard ? `${retard} en retard` : "aucun retard"} ton={retard ? "neg" : undefined} />
        )}
      </div>
      <div className="grid2">
        <section className="panel">
          <h2>Avancement de tous les chantiers</h2>
          <p className="note">Tout le monde voit l&apos;avancement global. Le détail n&apos;est ouvert que sur les chantiers de votre périmètre.</p>
          <div className="tbl">
            <table>
              <thead>
                <tr><th>Chantier</th><th>Domaine</th><th>Avancement</th><th>Statut</th></tr>
              </thead>
              <tbody>
                {((chantiers ?? []) as Chantier[]).map((c) => (
                  <tr key={c.id}>
                    <td><span className="code">{c.code}</span><br />{c.nom}</td>
                    <td><span className="dom">{c.domaine}</span></td>
                    <td style={{ minWidth: 150 }}><Barre valeur={av.get(c.id) ?? 0} /></td>
                    <td>{mesChantiers.has(c.id) ? <Pastille texte={c.statut} /> : <span className="note">Lecture seule</span>}</td>
                  </tr>
                ))}
                {!chantiers?.length && (
                  <tr><td colSpan={4} className="note">Aucun chantier pour le moment. Le PDG ou le Directeur des Opérations crée le premier depuis l&apos;onglet Chantiers.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel">
          <h2>Activité récente</h2>
          <ul className="feed">
            {(journal ?? []).map((j) => (
              <li key={j.id}>
                <time>{heureFr(j.cree_le)}</time>
                <span><b>{noms.get(j.auteur_id) ?? "?"}</b> {j.message}</span>
              </li>
            ))}
            {!journal?.length && <li className="note">Aucune activité pour le moment.</li>}
          </ul>
        </section>
      </div>
    </>
  );
}
