import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { exigerSession } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { dateFr, fcfa } from "@/lib/format";
import { Kpi, Pastille } from "@/components/ui";
import { Correction } from "@/components/Correction";
import Justificatifs, { type Fichier } from "@/components/Justificatifs";
import { annulerPv } from "../actions";
import { FormQuantites, FormSigner, type LigneLibre, type LigneSaisie } from "./Formulaires";

type Ligne = { id: string; chantier_ligne_id: string | null; bordereau_id: string | null; designation: string; unite: string; quantite: number; prix_unitaire_ht: number; montant_ht: number };

export default async function FichePv({ params }: { params: Promise<{ id: string }> }) {
  const s = await exigerSession();
  if (!(s.peut("pv.initier") || s.peut("fin.voir") || s.peut("fc.emettre") || s.peut("ff.enregistrer"))) redirect("/");
  const { id } = await params;
  const supabase = await supabaseServeur();
  const { data: p } = await supabase.from("pv_execution").select("*, chantier:chantiers(id,code,nom)").eq("id", id).maybeSingle();
  if (!p) notFound();
  const [{ data: lg }, { data: cl }, { data: bp }, { data: autres }, { data: fichiers }, { data: mes }] = await Promise.all([
    supabase.from("pv_lignes").select("*").eq("pv_id", id).order("cree_le"),
    supabase.from("chantier_lignes").select("id,ordre,designation,unite,quantite_prevue,prix_unitaire_ht").eq("chantier_id", p.chantier_id).order("ordre"),
    p.tiers_id ? supabase.from("bordereau_prix").select("id,code,designation,unite,prix_unitaire_ht").eq("tiers_id", p.tiers_id).eq("actif", true).order("code", { nullsFirst: false })
      : Promise.resolve({ data: [] }),
    supabase.from("pv_lignes").select("chantier_ligne_id,bordereau_id,quantite,pv:pv_execution!inner(id,type,statut,chantier_id,tiers_id)")
      .eq("pv.chantier_id", p.chantier_id).eq("pv.type", p.type).in("pv.statut", ["Signé", "Facturé"]).neq("pv_id", id),
    supabase.from("justificatifs").select("id,nom_fichier,depose_le").eq("objet", "pv").eq("objet_id", id).order("depose_le"),
    supabase.rpc("mes_chantiers"),
  ]);
  const lignes = (lg ?? []) as Ligne[];
  const perim = new Set(((mes ?? []) as unknown as (string | Record<string, string>)[]).map((x) => (typeof x === "string" ? x : Object.values(x)[0])));
  const gere = s.peut("pv.initier") && perim.has(p.chantier_id);
  const modifiable = gere && p.statut === "Établi";

  // Lignes à saisir : activités du chantier (PV client) ou bordereau du prestataire.
  const saisie = (ch: string | null, b: string | null) => lignes.filter((l) => l.chantier_ligne_id === ch && l.bordereau_id === b).reduce((t, l) => t + Number(l.quantite), 0);
  const deja = (ch: string | null, b: string | null) => ((autres ?? []) as unknown as { chantier_ligne_id: string | null; bordereau_id: string | null; quantite: number; pv: { tiers_id: string | null } }[])
    .filter((l) => (ch ? l.chantier_ligne_id === ch : l.bordereau_id === b && l.pv?.tiers_id === p.tiers_id)).reduce((t, l) => t + Number(l.quantite), 0);
  const aSaisir: LigneSaisie[] = p.type === "client"
    ? ((cl ?? []) as { id: string; designation: string; unite: string; quantite_prevue: number; prix_unitaire_ht: number }[]).map((c) => ({
        cle: `${c.id}|`, designation: c.designation, unite: c.unite, pu: Number(c.prix_unitaire_ht), prevue: Number(c.quantite_prevue), deja: deja(c.id, null), saisie: saisie(c.id, null) }))
    : ((bp ?? []) as { id: string; code: string | null; designation: string; unite: string; prix_unitaire_ht: number }[]).map((b) => ({
        cle: `|${b.id}`, designation: `${b.code ? b.code + " · " : ""}${b.designation}`, unite: b.unite, pu: Number(b.prix_unitaire_ht), prevue: null, deja: deja(null, b.id), saisie: saisie(null, b.id) }));
  // Lignes déjà saisies mais absentes de la liste (prix retiré du bordereau, PV client sans quantitatif…)
  const connues = new Set(aSaisir.map((l) => l.cle));
  const libres: LigneLibre[] = lignes.filter((l) => !(l.chantier_ligne_id || l.bordereau_id) || !connues.has(`${l.chantier_ligne_id ?? ""}|${l.bordereau_id ?? ""}`))
    .map((l) => ({ id: l.id, designation: l.designation, unite: l.unite, quantite: Number(l.quantite), prix_unitaire_ht: Number(l.prix_unitaire_ht) }));
  const docs = (fichiers ?? []) as Fichier[];
  const libelle = p.statut === "Établi" ? "En attente de signature" : p.statut === "Signé" ? "Signé, à facturer" : p.statut;

  return (
    <>
      <div className="head">
        <div>
          <p className="note"><Link href="/pv">← PV d&apos;exécution</Link></p>
          <h1>PV {p.numero}</h1>
          <p className="sub">{p.objet} · <span className="code">{p.chantier?.code}</span> {p.chantier?.nom} · {p.type === "client" ? "Client" : "Prestataire"} : <b>{p.tiers}</b> · du {dateFr(p.date_pv)}</p>
        </div>
        <Pastille texte={libelle} ton={p.statut === "Annulé" ? "bad" : p.statut === "Établi" ? "warn" : "ok"} />
      </div>
      <div className="kpis">
        <Kpi libelle="Montant HT du PV" valeur={fcfa(p.montant_ht)} unite="FCFA" />
        <Kpi libelle="Lignes" valeur={lignes.length} />
        {p.avancement != null && <Kpi libelle="Avancement déclaré" valeur={`${p.avancement} %`} />}
        {p.signe_le && <Kpi libelle="Signé le" valeur={<span style={{ fontSize: 17 }}>{dateFr(p.signe_le)}</span>} />}
      </div>
      {p.statut === "Annulé" && <p className="erreur">PV annulé le {dateFr(p.annule_le)} : {p.motif_annulation}</p>}

      <section className="panel">
        <h2>Quantités réellement exécutées</h2>
        <p className="note">
          {p.type === "client" ? "Activités du chantier, au prix du marché (bordereau du client)." : "Bordereau des prix du prestataire."}
          {" "}Le montant du PV est la somme des lignes. Après signature, les quantités ne changent plus.
        </p>
        <FormQuantites pvId={p.id} lignes={aSaisir} libres={libres} modifiable={modifiable} />
      </section>

      <section className="panel">
        <h2>Document signé</h2>
        <p className="note">Déposez le PV signé (PDF ou photo). Sans ce document, le PV ne peut pas être marqué signé ni facturé.</p>
        <Justificatifs objet="pv" objetId={p.id} numero={p.numero} pays={p.pays} fichiers={docs} page={`/pv/${p.id}`}
          peutDeposer={(gere || s.peut("doc.annuler")) && p.statut !== "Annulé"} />
        {modifiable && <div style={{ marginTop: 12 }}><FormSigner id={p.id} numero={p.numero} pret={Number(p.montant_ht) > 0 && docs.length > 0} /></div>}
        {(p.statut === "Établi" || p.statut === "Signé") && (s.peut("doc.annuler") || (p.statut === "Établi" && p.initie_par === s.profil.id)) && (
          <div style={{ marginTop: 12 }}><Correction id={p.id} numero={p.numero} quoi="le PV" annuler={annulerPv} /></div>
        )}
      </section>
    </>
  );
}
