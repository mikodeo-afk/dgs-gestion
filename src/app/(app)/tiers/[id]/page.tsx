import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { exigerSession } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { fcfa } from "@/lib/format";
import { TYPES_TIERS, VOIT_TIERS, type LigneBordereau, type Tiers } from "@/lib/types";
import { FormFiche, FormPrix, LignePrix } from "../Formulaires";
import Justificatifs, { DOCS_ADMIN, DOCS_FISCAUX, type Fichier } from "@/components/Justificatifs";
import { Pastille } from "@/components/ui";
import { aujourdhui, dateFr } from "@/lib/format";

export default async function FicheTiers({ params }: { params: Promise<{ id: string }> }) {
  const s = await exigerSession();
  if (!VOIT_TIERS.some((d) => s.peut(d))) redirect("/");
  const { id } = await params;
  const supabase = await supabaseServeur();
  const [{ data }, { data: bp }, { data: docs }] = await Promise.all([
    supabase.from("tiers").select("*").eq("id", id).maybeSingle(),
    supabase.from("bordereau_prix").select("*").eq("tiers_id", id).order("code", { nullsFirst: false }).order("designation"),
    supabase.from("justificatifs").select("id,nom_fichier,depose_le,type_document,valide_jusquau").eq("objet", "tiers").eq("objet_id", id).order("depose_le"),
  ]);
  const fichiers = (docs ?? []) as Fichier[];
  const auj = aujourdhui();
  const admin = fichiers.filter((f) => DOCS_ADMIN.includes(f.type_document ?? ""));
  const fiscaux = fichiers.filter((f) => DOCS_FISCAUX.includes(f.type_document ?? ""));
  const attestation = fiscaux.filter((f) => ["Attestation de régularité fiscale", "Quitus fiscal"].includes(f.type_document ?? ""))
    .map((f) => f.valide_jusquau ?? "").sort().pop();
  if (!data) notFound();
  const t = data as Tiers;
  const lignes = (bp ?? []) as LigneBordereau[];
  const peut = s.peut("tiers.gerer");
  const sens = t.type === "client" ? "les prix que nous appliquons à ce client" : "les prix que ce " + TYPES_TIERS[t.type].toLowerCase() + " nous applique";

  return (
    <>
      <div className="head">
        <div>
          <p className="note"><Link href={`/tiers?type=${t.type}`}>← {TYPES_TIERS[t.type]}s</Link></p>
          <h1>{t.nom}</h1>
          <p className="sub">{TYPES_TIERS[t.type]}{t.ifu ? ` · IFU ${t.ifu}` : ""}{t.rccm ? ` · RCCM ${t.rccm}` : ""}</p>
        </div>
      </div>
      <FormFiche t={t} peut={peut} />
      <section className="panel">
        <h2>Dossier administratif et fiscal</h2>
        <div className="statusline">
          <Pastille texte={admin.length ? "Dossier administratif déposé" : "Dossier administratif manquant"} ton={admin.length ? "ok" : "bad"} />
          <Pastille texte={attestation && attestation >= auj ? `Attestation fiscale valable jusqu'au ${dateFr(attestation)}` : attestation ? `Attestation fiscale expirée le ${dateFr(attestation)}` : "Aucune attestation fiscale"}
            ton={attestation && attestation >= auj ? "ok" : "bad"} />
        </div>
        <p className="note">
          Sans dossier administratif (RCCM, IFU…), la société ne peut figurer ni sur un chantier, ni sur un PV, ni sur une facture.
          Sans attestation fiscale en cours de validité (attestation de régularité fiscale ou quitus), ses factures ne peuvent recevoir ni bon à payer ni paiement.
        </p>
        <Justificatifs objet="tiers" objetId={t.id} numero={t.nom} pays={s.pays.code} fichiers={fichiers} peutDeposer={peut} page={`/tiers/${t.id}`} dossier />
      </section>
      <section className="panel">
        <h2>Bordereau des prix</h2>
        <p className="note">Prix unitaires HT : {sens}. Un changement de prix vaut pour les nouvelles lignes ; les chantiers et PV déjà saisis gardent leur prix.</p>
        {peut && <FormPrix tiersId={t.id} nom={t.nom} />}
        <div className="tbl">
          <table>
            <thead><tr><th>N°</th><th>Libellé</th><th>Unité</th><th className="num">Prix unitaire HT</th>{peut && <th>Modifier</th>}</tr></thead>
            <tbody>
              {lignes.map((l) => (
                <tr key={l.id} className={l.actif ? undefined : "annule"}>
                  <td className="code">{l.code ?? ""}</td>
                  <td>{l.designation}</td>
                  <td>{l.unite}</td>
                  <td className="num">{fcfa(l.prix_unitaire_ht)}</td>
                  {peut && <td><LignePrix id={l.id} tiersId={t.id} nom={t.nom} designation={l.designation} pu={Number(l.prix_unitaire_ht)} actif={l.actif} /></td>}
                </tr>
              ))}
              {!lignes.length && <tr><td colSpan={5} className="note">Bordereau vide.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
