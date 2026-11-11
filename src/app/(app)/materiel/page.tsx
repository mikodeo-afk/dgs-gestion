import Link from "next/link";
import { exigerSession } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { dateFr, fcfa } from "@/lib/format";
import { Kpi, Pastille } from "@/components/ui";
import { FormEquipement, type Equipement } from "./Formulaires";

const CATEGORIES = { travail: "Matériel de travail", roulant: "Matériel roulant" } as const;
const tonEtat = (e: string) => (e === "Bon" ? "ok" : e === "À réparer" ? "warn" : e === "En panne" ? "bad" : "info");

export default async function Materiel({ searchParams }: { searchParams: Promise<{ cat?: string }> }) {
  const s = await exigerSession();
  const sp = await searchParams;
  const cat = sp.cat === "roulant" ? "roulant" : "travail";
  const supabase = await supabaseServeur();
  const [{ data }, { data: chs }, { data: profils }, { data: alertes }] = await Promise.all([
    supabase.from("equipements").select("*").eq("categorie", CATEGORIES[cat]).order("code"),
    supabase.from("chantiers").select("id,code"),
    supabase.from("profils").select("id,nom"),
    supabase.rpc("alertes_logistique"),
  ]);
  const liste = (data ?? []) as Equipement[];
  const code = new Map((chs ?? []).map((c) => [c.id, c.code]));
  const nom = new Map((profils ?? []).map((p) => [p.id, p.nom]));
  const ids = new Set(liste.map((e) => e.id));
  const al = ((alertes ?? []) as { genre: string; objet_id: string; libelle: string; detail: string; echeance: string | null }[])
    .filter((a) => a.genre !== "Stock" && ids.has(a.objet_id));
  const auj = new Date().toISOString().slice(0, 10);
  const actifs = liste.filter((e) => e.etat !== "Réformé");

  return (
    <>
      <div className="head">
        <div>
          <h1>Matériel</h1>
          <p className="sub">Matériel de travail et matériel roulant : où il est, qui en a la charge, son état, ses entretiens et ses documents.</p>
        </div>
      </div>
      <div className="tabs" role="tablist">
        <Link href="/materiel" role="tab" aria-selected={cat === "travail"} className="tab">Matériel de travail</Link>
        <Link href="/materiel?cat=roulant" role="tab" aria-selected={cat === "roulant"} className="tab">Matériel roulant</Link>
      </div>
      <div className="kpis">
        <Kpi libelle="En service" valeur={actifs.length} />
        <Kpi libelle="Sur chantier" valeur={actifs.filter((e) => e.chantier_id).length} />
        <Kpi libelle="À réparer ou en panne" valeur={actifs.filter((e) => e.etat !== "Bon").length} ton={actifs.some((e) => e.etat !== "Bon") ? "neg" : undefined} />
        <Kpi libelle="Valeur d'acquisition" valeur={fcfa(actifs.reduce((t, e) => t + Number(e.valeur_acquisition ?? 0), 0))} unite="FCFA" />
      </div>
      {al.length > 0 && (
        <section className="panel">
          <h2>À surveiller</h2>
          <ul>
            {al.map((a, i) => (
              <li key={i}>
                <Link href={`/materiel/${a.objet_id}`}><b>{a.libelle}</b></Link> : {a.detail}
                {a.echeance && <span className={a.echeance < auj ? "neg" : "note"}> · {a.echeance < auj ? "expiré le" : "échéance le"} {dateFr(a.echeance)}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {s.peut("mat.gerer") && (
        <details className="panel">
          <summary><b>Enregistrer un {cat === "roulant" ? "véhicule ou engin" : "matériel"}</b></summary>
          <FormEquipement categorie={CATEGORIES[cat]} />
        </details>
      )}
      <section className="panel">
        <div className="tbl">
          <table>
            <thead><tr><th>N°</th><th>Désignation</th>{cat === "roulant" && <th>Immatriculation</th>}<th>Où</th><th>Responsable</th><th className="num">Compteur</th><th>État</th></tr></thead>
            <tbody>
              {liste.map((e) => (
                <tr key={e.id}>
                  <td className="code"><Link href={`/materiel/${e.id}`}>{e.code}</Link></td>
                  <td><Link href={`/materiel/${e.id}`}><b>{e.designation}</b></Link><br /><span className="note">{e.type}{e.marque ? ` · ${e.marque}` : ""}</span></td>
                  {cat === "roulant" && <td className="code">{e.immatriculation ?? "—"}</td>}
                  <td>{e.chantier_id ? code.get(e.chantier_id) ?? "Chantier" : "Dépôt / bureau"}</td>
                  <td>{e.responsable_id ? nom.get(e.responsable_id) ?? "—" : "—"}</td>
                  <td className="num">{e.compteur != null ? `${e.compteur.toLocaleString("fr-FR")} ${e.unite_compteur}` : "—"}</td>
                  <td><Pastille texte={e.etat} ton={tonEtat(e.etat)} /></td>
                </tr>
              ))}
              {!liste.length && <tr><td colSpan={7} className="note">Aucun {CATEGORIES[cat].toLowerCase()} enregistré.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
