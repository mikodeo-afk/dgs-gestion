import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { exigerSession } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { dateFr, fcfa } from "@/lib/format";
import type { Identite } from "@/lib/types";
import Imprimer from "./Imprimer";

export default async function FactureImprimable({ params }: { params: Promise<{ id: string }> }) {
  const s = await exigerSession();
  if (!(s.peut("fin.voir") || s.peut("fc.emettre"))) redirect("/");
  const { id } = await params;
  const supabase = await supabaseServeur();
  const { data: f } = await supabase.from("factures_clients")
    .select("*, pv:pv_execution(numero,tiers,objet,date_pv,avancement), chantier:chantiers(code,nom)").eq("id", id).maybeSingle();
  if (!f) notFound();
  const [{ data: ident }, { data: avs }] = await Promise.all([
    supabase.from("pays").select("*").eq("code", f.pays).maybeSingle(),
    supabase.from("avoirs_clients").select("numero,date_avoir,motif,montant_ht,net_a_payer").eq("facture_id", id).order("numero"),
  ]);
  const e = (ident ?? {}) as Partial<Identite>;
  const avoirs = avs ?? [];
  const tva = Number(f.taux_tva), aib = Number(f.taux_aib);

  return (
    <>
      <div className="head noprint">
        <div>
          <h1>Facture {f.numero}</h1>
          <p className="sub"><Link href="/finances?onglet=clients">← Retour aux factures clients</Link></p>
        </div>
        <Imprimer />
      </div>
      <article className="facture">
        {f.statut === "Annulée" && <div className="annulee">ANNULÉE</div>}
        <div className="ent">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-dgs-fond.png" alt="DGS" />
          <div className="id">
            <b>{e.raison_sociale ?? "D General Solutions"}</b><br />
            {e.adresse && <>{e.adresse}<br /></>}
            {e.rccm && <>RCCM : {e.rccm}<br /></>}
            {e.ifu && <>IFU : {e.ifu}<br /></>}
            {e.telephone && <>Tél. : {e.telephone}<br /></>}
            {e.email && <>{e.email}</>}
          </div>
        </div>

        <h2>Facture n° {f.numero}</h2>
        <div className="bloc">
          <div><b>Client</b><br />{f.pv?.tiers ?? "—"}</div>
          <div><b>Projet</b><br />{f.chantier?.code} · {f.chantier?.nom}</div>
          <div><b>Date</b> : {dateFr(f.date_emission)}<br /><b>Échéance</b> : {dateFr(f.echeance)}</div>
        </div>

        <table>
          <thead><tr><th>Désignation</th><th className="num">Montant HT (FCFA)</th></tr></thead>
          <tbody>
            <tr>
              <td>{f.objet}{f.pv && <><br /><small>Selon PV d&apos;exécution {f.pv.numero} du {dateFr(f.pv.date_pv)}{f.pv.avancement != null ? `, avancement ${f.pv.avancement} %` : ""} : {f.pv.objet}</small></>}</td>
              <td className="num">{fcfa(f.montant_ht)}</td>
            </tr>
          </tbody>
        </table>

        <table className="tot" style={{ maxWidth: 380, marginLeft: "auto" }}>
          <tbody>
            <tr><td>Total HT</td><td className="num">{fcfa(f.montant_ht)}</td></tr>
            <tr><td>{tva ? `TVA ${tva} %` : "TVA (exonérée)"}</td><td className="num">{fcfa(f.montant_tva)}</td></tr>
            <tr><td><b>Total TTC</b></td><td className="num"><b>{fcfa(f.montant_ttc)}</b></td></tr>
            {aib > 0 && <tr><td>AIB {aib} % (retenu par le client)</td><td className="num">− {fcfa(f.montant_aib)}</td></tr>}
            {avoirs.map((a) => <tr key={a.numero}><td>Avoir {a.numero}</td><td className="num">− {fcfa(a.net_a_payer)}</td></tr>)}
            <tr className="net"><td>Net à payer (FCFA)</td><td className="num">{fcfa(Number(f.net_a_payer) - avoirs.reduce((t, a) => t + Number(a.net_a_payer), 0))}</td></tr>
          </tbody>
        </table>

        {avoirs.length > 0 && (
          <p style={{ fontSize: 12.5 }}>Avoirs : {avoirs.map((a) => `${a.numero} du ${dateFr(a.date_avoir)} (${a.motif})`).join(" ; ")}.</p>
        )}
        {f.statut === "Annulée" && <p style={{ fontSize: 12.5 }}>Facture annulée le {dateFr(f.annulee_le)} : {f.motif_annulation}.</p>}

        <div className="pied">
          {e.raison_sociale ?? "D General Solutions"}{e.rccm ? ` · RCCM ${e.rccm}` : ""}{e.ifu ? ` · IFU ${e.ifu}` : ""}{e.adresse ? ` · ${e.adresse}` : ""}
        </div>
      </article>
    </>
  );
}
