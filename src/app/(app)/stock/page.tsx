import Link from "next/link";
import { exigerSession } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { dateFr, fcfa, heureFr } from "@/lib/format";
import { Kpi, Pastille } from "@/components/ui";
import { FormArticle, FormMouvement, FormUtilisation } from "./Formulaires";
import ImportExcel from "./ImportExcel";

type Ligne = { article_id: string; code: string; designation: string; categorie: string | null; unite: string; client_id: string | null;
  seuil_alerte: number; lieu_id: string | null; detenteur_id: string | null; quantite: number; cmp: number; valeur: number };
const qte = (n: number) => Number(n).toLocaleString("fr-FR", { maximumFractionDigits: 3 });
const ONGLETS = [["detenteurs", "Qui détient quoi"], ["articles", "Par article"], ["mouvements", "Mouvements"]] as const;

export default async function Stock({ searchParams }: { searchParams: Promise<{ onglet?: string }> }) {
  const s = await exigerSession();
  const sp = await searchParams;
  const onglet = ONGLETS.some((o) => o[0] === sp.onglet) ? sp.onglet! : "detenteurs";
  const gere = s.peut("stock.gerer");
  const supabase = await supabaseServeur();
  const [{ data: etat }, { data: arts }, { data: chs }, { data: profils }, { data: clients }, { data: alertes }, { data: mvts }, { data: bcs }, { data: mesChs }] = await Promise.all([
    supabase.rpc("etat_stock"),
    supabase.from("articles").select("id,code,designation,unite,client_id,seuil_alerte").eq("actif", true).order("code"),
    supabase.from("chantiers").select("id,code,nom,statut").order("code"),
    supabase.from("profils").select("id,nom,poste,actif").order("nom"),
    supabase.from("tiers").select("id,nom").eq("type", "client").order("nom"),
    supabase.rpc("alertes_logistique"),
    onglet === "mouvements"
      ? supabase.from("mouvements_stock").select("*, articles(code,designation,unite)").order("le", { ascending: false }).limit(300)
      : Promise.resolve({ data: [] as never[] }),
    gere ? supabase.from("bons_commande").select("id,numero,fournisseur,objet").eq("statut", "Validé").order("cree_le", { ascending: false }).limit(50) : Promise.resolve({ data: [] as never[] }),
    supabase.rpc("mes_chantiers"),
  ]);
  const lignes = ((etat ?? []) as Ligne[]).map((l) => ({ ...l, quantite: Number(l.quantite), cmp: Number(l.cmp), valeur: Number(l.valeur), seuil_alerte: Number(l.seuil_alerte) }));
  const codeCh = new Map((chs ?? []).map((c) => [c.id, c.code]));
  const nom = new Map((profils ?? []).map((p) => [p.id, p.nom]));
  const nomClient = new Map((clients ?? []).map((c) => [c.id, c.nom]));
  const endroitLib = (l: { lieu_id: string | null; detenteur_id: string | null }) =>
    l.detenteur_id ? nom.get(l.detenteur_id) ?? "Personne" : l.lieu_id ? `Chantier ${codeCh.get(l.lieu_id) ?? ""}` : "Dépôt central";
  const provenance = (c: string | null) => (c ? <Pastille texte={`Client · ${nomClient.get(c) ?? "?"}`} ton="info" /> : null);

  // Regroupements
  const parEndroit = new Map<string, { titre: string; ordre: number; lignes: Ligne[] }>();
  for (const l of lignes) {
    const k = l.detenteur_id ? `p:${l.detenteur_id}` : l.lieu_id ? `ch:${l.lieu_id}` : "depot";
    const g = parEndroit.get(k) ?? { titre: endroitLib(l), ordre: k === "depot" ? 0 : k.startsWith("ch:") ? 1 : 2, lignes: [] as Ligne[] };
    g.lignes.push(l);
    parEndroit.set(k, g);
  }
  const endroitsTenus = [...parEndroit.entries()].sort((a, b) => a[1].ordre - b[1].ordre || a[1].titre.localeCompare(b[1].titre));
  const totalArticle = new Map<string, number>();
  for (const l of lignes) totalArticle.set(l.article_id, (totalArticle.get(l.article_id) ?? 0) + l.quantite);
  const valeurDGS = lignes.filter((l) => !l.client_id).reduce((t, l) => t + l.valeur, 0);
  const chezPersonnes = new Set(lignes.filter((l) => l.detenteur_id).map((l) => l.detenteur_id)).size;
  const alertesStock = ((alertes ?? []) as { genre: string; libelle: string; detail: string }[]).filter((a) => a.genre === "Stock");

  // Mon matériel (ce que je détiens)
  const miens = lignes.filter((l) => l.detenteur_id === s.profil.id);
  const chantiersOuverts = (chs ?? []).filter((c) => c.statut !== "Terminé");
  const mesChantiers = new Set(((mesChs ?? []) as unknown as string[]).map(String));
  const optChantiers = chantiersOuverts.map((c) => ({ id: c.id, libelle: `${c.code} · ${c.nom}` }));
  const endroits = [
    { id: "depot", libelle: "Dépôt central" },
    ...optChantiers.map((c) => ({ id: `ch:${c.id}`, libelle: `Chantier ${c.libelle}` })),
    ...(profils ?? []).filter((p) => p.actif).map((p) => ({ id: `p:${p.id}`, libelle: `👤 ${p.nom}` })),
  ];

  return (
    <>
      <div className="head">
        <div>
          <h1>Stock</h1>
          <p className="sub">Matériel acheté par DGS ou remis par le client, au dépôt, sur les chantiers et chez chaque personne. Le gestionnaire dote les équipes chaque jour ; chacun déclare ce qu&apos;il a utilisé et rend le reste.</p>
        </div>
      </div>
      <div className="kpis">
        <Kpi libelle="Articles suivis" valeur={(arts ?? []).length} />
        <Kpi libelle="Valeur du stock DGS" valeur={fcfa(valeurDGS)} unite="FCFA" />
        <Kpi libelle="Personnes détenant du matériel" valeur={chezPersonnes} />
        <Kpi libelle="Sous le seuil d'alerte" valeur={alertesStock.length} ton={alertesStock.length ? "neg" : undefined} />
      </div>

      {miens.length > 0 && (
        <section className="panel">
          <h2>Mon matériel</h2>
          <div className="tbl">
            <table>
              <thead><tr><th>Article</th><th className="num">Je détiens</th></tr></thead>
              <tbody>{miens.map((l) => <tr key={l.article_id}><td><span className="code">{l.code}</span> {l.designation} {provenance(l.client_id)}</td><td className="num"><b>{qte(l.quantite)}</b> {l.unite}</td></tr>)}</tbody>
            </table>
          </div>
          <h3>Déclarer ce que j&apos;ai utilisé</h3>
          <FormUtilisation
            articles={miens.map((l) => ({ id: l.article_id, libelle: `${l.code} · ${l.designation} (${qte(l.quantite)} ${l.unite})`, max: l.quantite }))}
            chantiers={optChantiers.filter((c) => mesChantiers.has(c.id) || s.global)}
          />
        </section>
      )}

      {alertesStock.length > 0 && (gere || s.global) && (
        <section className="panel">
          <h2>À réapprovisionner</h2>
          <ul>{alertesStock.map((a) => <li key={a.libelle}><b>{a.libelle}</b> : {a.detail}</li>)}</ul>
        </section>
      )}

      {gere && (
        <section className="panel">
          <h2>Enregistrer une opération</h2>
          <FormMouvement
            articles={(arts ?? []).map((a) => ({ id: a.id, libelle: `${a.code} · ${a.designation} (${a.unite})${a.client_id ? " · client" : ""}`, client: !!a.client_id }))}
            endroits={endroits}
            chantiers={optChantiers}
            bcs={(bcs ?? []).map((b) => ({ id: b.id, libelle: `${b.numero} · ${b.fournisseur} · ${b.objet}` }))}
          />
          <details style={{ marginTop: 10 }}>
            <summary>Importer un fichier Excel</summary>
            <ImportExcel endroits={endroits} />
          </details>
          <details style={{ marginTop: 10 }}>
            <summary>Nouvel article</summary>
            <FormArticle clients={(clients ?? []).map((c) => ({ id: c.id, libelle: c.nom }))} />
          </details>
        </section>
      )}

      <div className="tabs" role="tablist">
        {ONGLETS.map(([k, v]) => <Link key={k} href={`/stock?onglet=${k}`} role="tab" aria-selected={onglet === k} className="tab">{v}</Link>)}
      </div>

      {onglet === "detenteurs" && (
        <>
          {endroitsTenus.map(([k, g]) => (
            <section className="panel" key={k}>
              <h2>{g.ordre === 2 ? "👤 " : ""}{g.titre}</h2>
              <div className="tbl">
                <table>
                  <thead><tr><th>Article</th><th className="num">Quantité</th><th className="num">Valeur</th></tr></thead>
                  <tbody>
                    {g.lignes.map((l) => (
                      <tr key={l.article_id}>
                        <td><span className="code">{l.code}</span> {l.designation} {provenance(l.client_id)}</td>
                        <td className={`num ${l.quantite < 0 ? "neg" : ""}`}><b>{qte(l.quantite)}</b> {l.unite}</td>
                        <td className="num">{l.client_id ? "—" : fcfa(l.valeur)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
          {!endroitsTenus.length && <section className="panel"><p className="note">Aucun stock pour le moment.</p></section>}
        </>
      )}

      {onglet === "articles" && (
        <section className="panel">
          <div className="tbl">
            <table>
              <thead><tr><th>Article</th><th>Répartition</th><th className="num">Total</th><th className="num">CMP</th><th>Alerte</th></tr></thead>
              <tbody>
                {(arts ?? []).map((a) => {
                  const ls = lignes.filter((l) => l.article_id === a.id);
                  const total = totalArticle.get(a.id) ?? 0;
                  return (
                    <tr key={a.id}>
                      <td><b className="code">{a.code}</b> {a.designation} {provenance(a.client_id)}</td>
                      <td className="note">{ls.length ? ls.map((x) => `${endroitLib(x)} : ${qte(x.quantite)}`).join(" · ") : "—"}</td>
                      <td className="num"><b>{qte(total)}</b> {a.unite}</td>
                      <td className="num">{a.client_id ? "—" : fcfa(ls[0]?.cmp ?? 0)}</td>
                      <td>{Number(a.seuil_alerte) > 0 && (total <= Number(a.seuil_alerte)
                        ? <Pastille texte={`Sous le seuil (${qte(a.seuil_alerte)})`} ton="bad" />
                        : <span className="note">seuil {qte(a.seuil_alerte)}</span>)}</td>
                    </tr>
                  );
                })}
                {!(arts ?? []).length && <tr><td colSpan={5} className="note">Aucun article.{gere ? " Créez vos articles (« Nouvel article »), puis enregistrez les entrées." : ""}</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {onglet === "mouvements" && (
        <section className="panel">
          <div className="tbl">
            <table>
              <thead><tr><th>Date</th><th>Opération</th><th>Article</th><th>Endroit</th><th className="num">Quantité</th><th>Chantier · référence</th><th>Par</th></tr></thead>
              <tbody>
                {(mvts ?? []).map((m) => (
                  <tr key={m.id}>
                    <td>{dateFr(m.le)} <span className="note">{heureFr(m.le)}</span></td>
                    <td><Pastille texte={m.type} ton={m.type === "Entrée" ? "ok" : m.type === "Utilisation" ? "warn" : "info"} /></td>
                    <td><span className="code">{m.articles?.code}</span> {m.articles?.designation}</td>
                    <td>{endroitLib(m)}</td>
                    <td className={`num ${Number(m.quantite) < 0 ? "neg" : ""}`}>{Number(m.quantite) > 0 ? "+" : ""}{qte(m.quantite)} {m.articles?.unite}</td>
                    <td className="note">{[m.chantier_id && codeCh.get(m.chantier_id), m.motif, m.fournisseur].filter(Boolean).join(" · ")}</td>
                    <td className="note">{nom.get(m.saisi_par) ?? "—"}</td>
                  </tr>
                ))}
                {!(mvts ?? []).length && <tr><td colSpan={7} className="note">Aucun mouvement.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
