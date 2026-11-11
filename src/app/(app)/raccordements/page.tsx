import Link from "next/link";
import { exigerSession } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { Kpi } from "@/components/ui";
import { RUBRIQUES } from "@/lib/raccordement";
import {
  BoutonsRegulariser, Correspondance, FicheEquipe, FormEquipe, ImportDossiers, SaisieRapport, TableDossiers,
  type LigneDossier, type LigneEquipe,
} from "./Composants";

// La lecture d'une photo de tableau peut prendre jusqu'à une minute.
export const maxDuration = 60;

const ONGLETS = [["en-cours", "À faire"], ["realises", "Réalisés"], ["echecs", "Échecs"], ["equipes", "Équipes et matériel"]] as const;
type Conso = { id: string; raccordement_id: string; rubrique: string; quantite: number; statut: string; note: string | null; article_id: string | null; cree_le: string };

export default async function Raccordements({ searchParams }: { searchParams: Promise<{ onglet?: string }> }) {
  const s = await exigerSession();
  const sp = await searchParams;
  const onglet = ONGLETS.some((o) => o[0] === sp.onglet) ? sp.onglet! : "en-cours";
  const gere = s.peut("racc.gerer");
  const stock = s.peut("stock.gerer");
  const supabase = await supabaseServeur();
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const debutMois = aujourdhui.slice(0, 8) + "01";

  const statuts = onglet === "realises" ? ["Réalisé"] : onglet === "echecs" ? ["Échec"] : ["À affecter", "Affecté"];
  const [{ data: equipes }, { data: membres }, { data: mes }, { data: profils }, { data: chantiers }, { data: dossiers }, { data: compte }, { data: attente }] = await Promise.all([
    supabase.from("equipes").select("id,nom,chef_id,chantier_id,actif").order("nom"),
    supabase.from("equipe_membres").select("equipe_id,profil_id"),
    supabase.rpc("mes_equipes"),
    supabase.from("profils").select("id,nom,actif").order("nom"),
    supabase.from("chantiers").select("id,code,nom,statut,domaine").order("code"),
    onglet === "equipes" ? Promise.resolve({ data: [] }) : supabase.from("raccordements")
      .select("id,client,ligne,mobile,msan,offre,latitude,longitude,date_demande,date_limite,statut,equipe_id,realise_le,motif_echec")
      .in("statut", statuts).order(onglet === "en-cours" ? "date_limite" : "realise_le", { ascending: onglet === "en-cours", nullsFirst: false }).limit(500),
    supabase.from("raccordements").select("statut,realise_le,date_limite"),
    stock || gere ? supabase.from("consommations_raccordement").select("id,raccordement_id,rubrique,quantite,statut,note,article_id,cree_le").in("statut", ["À régulariser", "Non relié"]).order("cree_le").limit(300) : Promise.resolve({ data: [] }),
  ]);

  const nomProfil = new Map((profils ?? []).map((p) => [p.id, p.nom]));
  const personnes = (profils ?? []).filter((p) => p.actif).map((p) => ({ id: p.id, libelle: p.nom }));
  const optChantiers = (chantiers ?? []).filter((c) => c.statut !== "Terminé").map((c) => ({ id: c.id, libelle: `${c.code} · ${c.nom}` }))
    .sort((a, b) => Number(b.libelle.includes("TEL")) - Number(a.libelle.includes("TEL")));
  const lesEquipes: LigneEquipe[] = (equipes ?? []).map((e) => ({
    ...e, membres: (membres ?? []).filter((m) => m.equipe_id === e.id).map((m) => ({ id: m.profil_id, libelle: nomProfil.get(m.profil_id) ?? "?" })),
  }));
  const mesIds = new Set(((mes ?? []) as unknown as string[]).map(String));
  const equipesSaisie = lesEquipes.filter((e) => e.actif && (gere || mesIds.has(e.id)))
    .map((e) => ({ id: e.id, libelle: `${e.nom} (chef : ${nomProfil.get(e.chef_id) ?? "?"})` }));
  const nomEquipe = new Map(lesEquipes.map((e) => [e.id, e.nom]));

  // Matériel posé, pour les dossiers réalisés affichés.
  const ids = (dossiers ?? []).filter((d) => d.statut === "Réalisé").map((d) => d.id);
  const { data: consos } = ids.length
    ? await supabase.from("consommations_raccordement").select("raccordement_id,rubrique,quantite,statut").in("raccordement_id", ids)
    : { data: [] as { raccordement_id: string; rubrique: string; quantite: number; statut: string }[] };
  const libRub = (k: string) => { const [b, t] = k.split(":"); return `${RUBRIQUES.find((r) => r.cle === b)?.libelle ?? b}${t ? ` ${t}` : ""}`; };
  const lignes: LigneDossier[] = (dossiers ?? []).map((d) => ({
    ...d, equipe: d.equipe_id ? nomEquipe.get(d.equipe_id) ?? null : null,
    retard: (d.statut === "À affecter" || d.statut === "Affecté") && !!d.date_limite && d.date_limite < aujourdhui,
    materiel: (consos ?? []).filter((c) => c.raccordement_id === d.id)
      .map((c) => `${libRub(c.rubrique)} ${Number(c.quantite)}${c.statut === "À régulariser" ? " ⚠" : c.statut === "Non relié" ? " (non suivi)" : ""}`).join(" · "),
  }));

  const tous = compte ?? [];
  const nb = (f: (r: { statut: string; realise_le: string | null; date_limite: string | null }) => boolean) => tous.filter(f).length;
  const aRegulariser = ((attente ?? []) as Conso[]).filter((c) => c.statut === "À régulariser");
  const nonRelies = ((attente ?? []) as Conso[]).filter((c) => c.statut === "Non relié");

  // Onglet matériel : articles et correspondances.
  const [{ data: articles }, { data: liens }] = onglet === "equipes"
    ? await Promise.all([
        supabase.from("articles").select("id,code,designation,unite").eq("actif", true).order("code"),
        supabase.from("materiel_raccordement").select("rubrique,article_id"),
      ])
    : [{ data: [] }, { data: [] }];
  const typesCable = [...new Set(["CPC", ...((liens ?? []) as { rubrique: string }[]).map((l) => l.rubrique).filter((r) => r.startsWith("cable:")).map((r) => r.slice(6))])];

  return (
    <>
      <div className="head">
        <div>
          <h1>Raccordements</h1>
          <p className="sub">Dossiers reçus chaque jour, affectés aux équipes. Le rapport d&apos;installation envoyé par l&apos;équipe clôt le dossier et déduit le matériel posé du stock du chef d&apos;équipe.</p>
        </div>
      </div>
      <div className="kpis">
        <Kpi libelle="À affecter" valeur={nb((r) => r.statut === "À affecter")} ton={nb((r) => r.statut === "À affecter") ? "hl" : undefined} />
        <Kpi libelle="En cours chez les équipes" valeur={nb((r) => r.statut === "Affecté")} />
        <Kpi libelle="En retard" valeur={nb((r) => (r.statut === "À affecter" || r.statut === "Affecté") && !!r.date_limite && r.date_limite < aujourdhui)}
          ton={nb((r) => (r.statut === "À affecter" || r.statut === "Affecté") && !!r.date_limite && r.date_limite < aujourdhui) ? "neg" : undefined} />
        <Kpi libelle="Réalisés ce mois" valeur={nb((r) => r.statut === "Réalisé" && (r.realise_le ?? "") >= debutMois)} ton="pos" />
      </div>

      <section className="panel">
        <h2>Enregistrer un rapport d&apos;installation</h2>
        <SaisieRapport equipes={equipesSaisie} />
      </section>

      {gere && (
        <section className="panel">
          <details>
            <summary>Importer les dossiers reçus (Excel ou photo)</summary>
            <ImportDossiers chantiers={optChantiers} />
          </details>
        </section>
      )}

      {stock && aRegulariser.length > 0 && (
        <section className="panel">
          <h2>Matériel à régulariser ({aRegulariser.length})</h2>
          <p className="note">Rapports dont le chef d&apos;équipe ne détenait pas assez de matériel : dotez-le (ou corrigez son stock), puis déduisez.</p>
          <div className="tbl">
            <table>
              <thead><tr><th>Reçu le</th><th>Rubrique</th><th className="num">Quantité</th><th>Motif</th><th></th></tr></thead>
              <tbody>{aRegulariser.map((c) => (
                <tr key={c.id}><td>{c.cree_le.slice(0, 10).split("-").reverse().join("/")}</td><td>{libRub(c.rubrique)}</td><td className="num">{Number(c.quantite)}</td>
                  <td className="note">{c.note}</td><td><BoutonsRegulariser id={c.id} /></td></tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      )}
      {(stock || gere) && nonRelies.length > 0 && (
        <p className="note">{nonRelies.length} quantité(s) déclarée(s) dans des rubriques sans article relié : voir <Link href="/raccordements?onglet=equipes">Équipes et matériel</Link>.</p>
      )}

      <div className="tabs" role="tablist">
        {ONGLETS.filter(([k]) => k !== "equipes" || gere || stock).map(([k, v]) =>
          <Link key={k} href={`/raccordements?onglet=${k}`} role="tab" aria-selected={onglet === k} className="tab">{v}</Link>)}
      </div>

      {onglet !== "equipes" && (
        <section className="panel">
          <TableDossiers dossiers={lignes} equipes={lesEquipes.filter((e) => e.actif).map((e) => ({ id: e.id, libelle: e.nom }))} gere={gere} />
        </section>
      )}

      {onglet === "equipes" && (
        <>
          {gere && (
            <section className="panel">
              <h2>Équipes de raccordement</h2>
              {lesEquipes.map((e) => <FicheEquipe key={e.id} e={e} personnes={personnes} chantiers={optChantiers} />)}
              <h3 style={{ marginTop: 16 }}>Nouvelle équipe</h3>
              <FormEquipe personnes={personnes} chantiers={optChantiers} />
            </section>
          )}
          <section className="panel">
            <h2>Matériel déduit à chaque rapport</h2>
            <p className="note">Reliez chaque rubrique du rapport à un article du stock. Une rubrique « non suivie » n&apos;est pas déduite.</p>
            <Correspondance
              liens={Object.fromEntries(((liens ?? []) as { rubrique: string; article_id: string }[]).map((l) => [l.rubrique, l.article_id]))}
              articles={((articles ?? []) as { id: string; code: string; designation: string; unite: string }[]).map((a) => ({ id: a.id, libelle: `${a.code} · ${a.designation} (${a.unite})` }))}
              typesCable={typesCable}
            />
          </section>
        </>
      )}
    </>
  );
}
