import Link from "next/link";
import { notFound } from "next/navigation";
import { exigerSession } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { dateFr, fcfa, heureFr } from "@/lib/format";
import { Kpi, Pastille } from "@/components/ui";
import Justificatifs, { DOSSIER_MATERIEL } from "@/components/Justificatifs";
import { FormAffectation, FormEntretien, FormFiche, FormPlein, type Equipement } from "../Formulaires";

const ton = (e: string) => (e === "Bon" ? "ok" : e === "À réparer" ? "warn" : e === "En panne" ? "bad" : "info");

export default async function FicheMateriel({ params }: { params: Promise<{ id: string }> }) {
  const s = await exigerSession();
  const { id } = await params;
  const supabase = await supabaseServeur();
  const { data } = await supabase.from("equipements").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const e = data as Equipement;
  const [{ data: chs }, { data: profils }, { data: hist }, { data: ent }, { data: pl }, { data: docs }] = await Promise.all([
    supabase.from("chantiers").select("id,code,nom,statut").order("code"),
    supabase.from("profils").select("id,nom,actif").order("nom"),
    supabase.from("equipement_affectations").select("*").eq("equipement_id", id).order("le", { ascending: false }),
    supabase.from("entretiens").select("*").eq("equipement_id", id).order("le", { ascending: false }),
    supabase.from("pleins").select("*").eq("equipement_id", id).order("le", { ascending: false }).limit(50),
    supabase.from("justificatifs").select("id,nom_fichier,depose_le,type_document,valide_jusquau").eq("objet", "equipement").eq("objet_id", id).order("depose_le"),
  ]);
  const gere = s.peut("mat.gerer");
  const roulant = e.categorie === "Matériel roulant";
  const code = new Map((chs ?? []).map((c) => [c.id, c.code]));
  const nom = new Map((profils ?? []).map((p) => [p.id, p.nom]));
  const chantiers = (chs ?? []).filter((c) => c.statut !== "Terminé").map((c) => ({ id: c.id, libelle: `${c.code} · ${c.nom}` }));
  const personnel = (profils ?? []).filter((p) => p.actif).map((p) => ({ id: p.id, libelle: p.nom }));
  const coutEntretien = (ent ?? []).reduce((t, x) => t + Number(x.cout), 0);
  const pleins = pl ?? [];
  const litres = pleins.reduce((t, x) => t + Number(x.litres), 0);
  const carburant = pleins.reduce((t, x) => t + Number(x.montant), 0);
  // Consommation moyenne sur les pleins dont le compteur est relevé.
  const rel = pleins.filter((p) => p.compteur != null).sort((a, b) => a.compteur - b.compteur);
  const distance = rel.length > 1 ? rel.at(-1)!.compteur - rel[0].compteur : 0;
  const litresSurDistance = rel.slice(1).reduce((t, x) => t + Number(x.litres), 0);
  const conso = distance > 0 ? (e.unite_compteur === "km" ? (litresSurDistance / distance) * 100 : litresSurDistance / distance) : null;
  const estConducteur = e.responsable_id === s.profil.id;

  return (
    <>
      <div className="head">
        <div>
          <p className="sub"><Link href={roulant ? "/materiel?cat=roulant" : "/materiel"}>← {e.categorie}</Link></p>
          <h1>{e.code} · {e.designation}</h1>
          <p className="sub">{e.type}{e.marque ? ` · ${e.marque}` : ""}{e.modele ? ` ${e.modele}` : ""}{e.immatriculation ? ` · ${e.immatriculation}` : ""}</p>
        </div>
        <Pastille texte={e.etat} ton={ton(e.etat)} />
      </div>
      <div className="kpis">
        <Kpi libelle="Où" valeur={<span style={{ fontSize: 17 }}>{e.chantier_id ? code.get(e.chantier_id) : "Dépôt / bureau"}</span>} />
        <Kpi libelle={roulant ? "Conducteur" : "Responsable"} valeur={<span style={{ fontSize: 17 }}>{e.responsable_id ? nom.get(e.responsable_id) : "—"}</span>} />
        <Kpi libelle="Compteur" valeur={e.compteur != null ? e.compteur.toLocaleString("fr-FR") : "—"} unite={e.unite_compteur} />
        <Kpi libelle="Entretiens et réparations" valeur={fcfa(coutEntretien)} unite="FCFA" />
        {roulant && <Kpi libelle="Carburant" valeur={fcfa(carburant)} unite={`FCFA · ${litres.toLocaleString("fr-FR")} L`} />}
        {conso != null && <Kpi libelle="Consommation" valeur={conso.toFixed(1)} unite={e.unite_compteur === "km" ? "L/100 km" : "L/h"} />}
      </div>

      {gere && (
        <section className="panel">
          <h2>Affecter / changer l&apos;état</h2>
          <FormAffectation e={e} chantiers={chantiers} personnel={personnel} />
        </section>
      )}

      <section className="panel">
        <h2>Documents</h2>
        <p className="note">Assurance, visite technique, vignette… avec leur date de validité : l&apos;application signale ceux qui expirent dans les 30 jours.</p>
        <Justificatifs objet="equipement" objetId={e.id} numero={e.code} pays={s.pays.code} fichiers={docs ?? []} peutDeposer={gere} page={`/materiel/${e.id}`} dossier types={DOSSIER_MATERIEL} />
      </section>

      <section className="panel">
        <h2>Entretiens et réparations</h2>
        {gere && <details><summary>Enregistrer une intervention</summary><FormEntretien e={e} chantiers={chantiers} /></details>}
        <div className="tbl">
          <table>
            <thead><tr><th>Date</th><th>Type</th><th>Travaux</th><th className="num">Compteur</th><th className="num">Coût</th><th>Prestataire</th><th>Prochain</th></tr></thead>
            <tbody>
              {(ent ?? []).map((x) => (
                <tr key={x.id}>
                  <td>{dateFr(x.le)}</td><td>{x.type}</td><td>{x.description}{x.chantier_id && <span className="note"> · {code.get(x.chantier_id)}</span>}</td>
                  <td className="num">{x.compteur ?? "—"}</td><td className="num">{fcfa(x.cout)}</td><td>{x.prestataire ?? "—"}</td>
                  <td className="note">{[x.prochain_le && dateFr(x.prochain_le), x.prochain_compteur && `${x.prochain_compteur} ${e.unite_compteur}`].filter(Boolean).join(" ou ") || "—"}</td>
                </tr>
              ))}
              {!(ent ?? []).length && <tr><td colSpan={7} className="note">Aucune intervention enregistrée.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {(roulant || pleins.length > 0) && (
        <section className="panel">
          <h2>Carburant</h2>
          {(gere || estConducteur) && <details open={estConducteur && !gere}><summary>Enregistrer un plein</summary><FormPlein e={e} chantiers={chantiers} /></details>}
          <div className="tbl">
            <table>
              <thead><tr><th>Date</th><th className="num">Litres</th><th className="num">Montant</th><th className="num">Compteur</th><th>Chantier</th><th>Saisi par</th></tr></thead>
              <tbody>
                {pleins.map((x) => (
                  <tr key={x.id}>
                    <td>{dateFr(x.le)}</td><td className="num">{Number(x.litres).toLocaleString("fr-FR")}</td><td className="num">{fcfa(x.montant)}</td>
                    <td className="num">{x.compteur ?? "—"}</td><td>{x.chantier_id ? code.get(x.chantier_id) : "—"}</td><td>{nom.get(x.saisi_par) ?? "—"}</td>
                  </tr>
                ))}
                {!pleins.length && <tr><td colSpan={6} className="note">Aucun plein enregistré.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="panel">
        <h2>Historique des affectations</h2>
        <div className="tbl">
          <table>
            <thead><tr><th>Date</th><th>Où</th><th>Responsable</th><th>État</th><th className="num">Compteur</th><th>Motif</th><th>Par</th></tr></thead>
            <tbody>
              {(hist ?? []).map((h) => (
                <tr key={h.id}>
                  <td>{dateFr(h.le)} <span className="note">{heureFr(h.le)}</span></td>
                  <td>{h.chantier_id ? code.get(h.chantier_id) : "Dépôt / bureau"}</td>
                  <td>{h.responsable_id ? nom.get(h.responsable_id) : "—"}</td>
                  <td>{h.etat}</td><td className="num">{h.compteur ?? "—"}</td><td>{h.motif ?? ""}</td><td className="note">{nom.get(h.saisi_par) ?? "—"}</td>
                </tr>
              ))}
              {!(hist ?? []).length && <tr><td colSpan={7} className="note">Pas encore d&apos;affectation : le matériel est au dépôt.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {gere && (
        <details className="panel">
          <summary><b>Modifier la fiche</b></summary>
          <FormFiche e={e} peut={gere} />
        </details>
      )}
    </>
  );
}
