import Link from "next/link";
import { redirect } from "next/navigation";
import { exigerSession } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { aujourdhui, dateFr, fcfa } from "@/lib/format";
import { Kpi, Pastille } from "@/components/ui";
import { FormFactureClient, FormFactureFournisseur, FormFraisGeneral, type BcValide, type PvSigne } from "./Formulaires";
import { annulerFactureClient, annulerFactureFournisseur, deciderFactureFournisseur, emettreAvoir, encaisser, payerFactureFournisseur } from "./actions";
import { Correction } from "@/components/Correction";
import { tauxDuPays } from "@/lib/parametres";
import Justificatifs from "@/components/Justificatifs";
import { documentsPar } from "@/lib/justificatifs";


const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const libMois = (m: string) => `${MOIS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const decaler = (m: string, k: number) => {
  const d = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + k, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

type Rent = { chantier_id: string; code: string; nom: string; montant_marche: number; budget_depenses: number; facture_ht: number; encaisse_ht: number; depenses: number; factures_fournisseurs: number; main_oeuvre: number; couts: number; marge: number };

export default async function Finances({ searchParams }: { searchParams: Promise<{ onglet?: string; mois?: string; erreur?: string }> }) {
  const s = await exigerSession();
  if (!s.peut("fin.voir")) redirect("/");
  const sp = await searchParams;
  const voitFG = s.peut("fg.voir") || s.peut("fg.saisir");
  const onglets = [["rentabilite", "Rentabilité par projet"], ["clients", "Factures clients"], ["fournisseurs", "Factures fournisseurs"], ...(voitFG ? [["frais", "Frais généraux"]] : [])];
  const onglet = onglets.some((o) => o[0] === sp.onglet) ? sp.onglet! : "rentabilite";
  const auj = aujourdhui();
  const mois = /^\d{4}-\d{2}$/.test(sp.mois ?? "") ? sp.mois! : auj.slice(0, 7);
  const supabase = await supabaseServeur();
  const taux = await tauxDuPays();
  const aibs = [taux.aib, 0, 1, 3, 5];
  const corrige = s.peut("doc.annuler");
  const { data: chantiers } = await supabase.from("chantiers").select("id,code,nom").order("code");
  const codes = new Map((chantiers ?? []).map((c) => [c.id, c.code]));
  const pvSignes = async (type: "client" | "prestataire"): Promise<PvSigne[]> => {
    const { data } = await supabase.from("pv_execution").select("id,numero,chantier_id,tiers,objet,montant_ht").eq("type", type).eq("statut", "Signé").order("numero");
    return (data ?? []).map((p) => ({ ...p, code: codes.get(p.chantier_id) ?? "" }));
  };

  let contenu: React.ReactNode = null;
  if (onglet === "rentabilite") {
    const { data } = await supabase.rpc("rentabilite_chantiers");
    const R = ((data ?? []) as Rent[]).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "string" && !["chantier_id", "code", "nom"].includes(k) ? Number(v) : v])) as Rent);
    const tot = R.reduce((a, r) => ({ fact: a.fact + r.facture_ht, enc: a.enc + r.encaisse_ht, couts: a.couts + r.couts, marge: a.marge + r.marge }), { fact: 0, enc: 0, couts: 0, marge: 0 });
    let fgMois = 0;
    if (voitFG && s.global) {
      const { data: fg } = await supabase.rpc("frais_generaux_du_mois", { p_mois: auj });
      fgMois = ((fg ?? []) as { montant: number }[]).reduce((a, l) => a + Number(l.montant), 0);
    }
    contenu = (
      <>
        <div className="kpis">
          <Kpi libelle="Marge cumulée des projets" valeur={fcfa(tot.marge)} unite="FCFA" ton={tot.marge < 0 ? "neg" : "pos"} />
          <Kpi libelle="Facturé HT" valeur={fcfa(tot.fact)} unite="FCFA" />
          <Kpi libelle="Reste à encaisser HT" valeur={fcfa(tot.fact - tot.enc)} unite="FCFA" />
          {voitFG && s.global && <Kpi libelle={`Frais généraux ${MOIS[Number(auj.slice(5, 7)) - 1]}`} valeur={fcfa(fgMois)} unite="FCFA" />}
        </div>
        <section className="panel">
          <p className="note">
            Marge = facturé HT − (dépenses validées + factures fournisseurs validées + main-d&apos;œuvre). La main-d&apos;œuvre compte les salaires du
            chef de projet, des chefs d&apos;équipe et des techniciens, répartis entre les chantiers où ils travaillent, depuis le démarrage du chantier.
            Les salaires de la direction et de l&apos;administration sont dans les frais généraux.
          </p>
          <div className="tbl">
            <table>
              <thead><tr><th>Projet</th><th className="num">Marché HT</th><th className="num">Facturé HT</th><th className="num">Encaissé</th><th className="num">Dépenses</th><th className="num">Fact. fourn.</th><th className="num">Main-d&apos;œuvre</th><th className="num">Total coûts</th><th className="num">Marge</th><th className="num">Taux</th></tr></thead>
              <tbody>
                {R.map((r) => (
                  <tr key={r.chantier_id}>
                    <td><span className="code">{r.code}</span><br />{r.nom}</td>
                    <td className="num">{fcfa(r.montant_marche)}</td>
                    <td className="num">{fcfa(r.facture_ht)}</td>
                    <td className="num">{fcfa(r.encaisse_ht)}</td>
                    <td className="num">{fcfa(r.depenses)}</td>
                    <td className="num">{fcfa(r.factures_fournisseurs)}</td>
                    <td className="num">{fcfa(r.main_oeuvre)}</td>
                    <td className="num">{fcfa(r.couts)}{r.budget_depenses > 0 && <><br /><span className="note">{Math.round((r.couts / r.budget_depenses) * 100)} % du budget</span></>}</td>
                    <td className={`num ${r.marge < 0 ? "neg" : "pos"}`}>{fcfa(r.marge)}</td>
                    <td className="num">{r.facture_ht ? Math.round((r.marge / r.facture_ht) * 100) + " %" : "—"}</td>
                  </tr>
                ))}
                {!R.length && <tr><td colSpan={10} className="note">Aucun projet dans votre périmètre.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </>
    );
  }

  if (onglet === "clients") {
    const [{ data }, { data: avs }] = await Promise.all([
      supabase.from("factures_clients").select("*, pv:pv_execution(numero)").order("date_emission", { ascending: false }),
      supabase.from("avoirs_clients").select("*").order("cree_le", { ascending: false }),
    ]);
    const liste = data ?? [];
    const avoirs = avs ?? [];
    const numFac = new Map(liste.map((f) => [f.id, f.numero]));
    const avoirsDe = (id: string) => avoirs.filter((a) => a.facture_id === id).reduce((t, a) => t + Number(a.montant_ht), 0);
    const totAv = (c: "montant_ht" | "montant_tva" | "montant_ttc") => avoirs.reduce((t, a) => t + Number(a[c]), 0);
    const actives = liste.filter((f) => f.statut !== "Annulée");
    const somme = (l: typeof liste, c: "montant_ht" | "montant_tva" | "montant_ttc") => l.reduce((a, f) => a + Number(f[c]), 0);
    const du = liste.filter((f) => f.statut === "Émise").reduce((a, f) => a + Number(f.net_a_payer)
      - avoirs.filter((x) => x.facture_id === f.id).reduce((t, x) => t + Number(x.net_a_payer), 0), 0);
    contenu = (
      <>
        {s.peut("fc.emettre") && <FormFactureClient pvs={await pvSignes("client")} tva={taux.tva} aib={aibs} />}
        <div className="kpis">
          <Kpi libelle="Facturé HT (avoirs déduits)" valeur={fcfa(somme(actives, "montant_ht") - totAv("montant_ht"))} unite="FCFA" />
          <Kpi libelle="TVA facturée" valeur={fcfa(somme(actives, "montant_tva") - totAv("montant_tva"))} unite="FCFA" />
          <Kpi libelle="Facturé TTC" valeur={fcfa(somme(actives, "montant_ttc") - totAv("montant_ttc"))} unite="FCFA" />
          <Kpi libelle="Reste à encaisser (net d'AIB)" valeur={fcfa(du)} unite="FCFA" ton={du ? "hl" : undefined} />
        </div>
        <section className="panel">
          <p className="note">Numéro attribué automatiquement. Une facture non payée après son échéance apparaît « En retard ». L&apos;AIB est retenu par le client : le net à encaisser est le TTC moins l&apos;AIB. Pour corriger : une facture non encaissée s&apos;annule avec un motif (son PV peut être refacturé) ; une facture encaissée ou déjà remise se corrige par un avoir.</p>
          <div className="tbl">
            <table>
              <thead><tr><th>Facture</th><th>Projet</th><th className="num">Émise le</th><th className="num">Échéance</th><th className="num">Montant HT</th><th className="num">TVA</th><th className="num">Montant TTC</th><th className="num">AIB</th><th className="num">Net à encaisser</th><th>Statut</th><th>Action</th></tr></thead>
              <tbody>
                {liste.map((f) => {
                  const retard = f.statut === "Émise" && f.echeance < auj;
                  const av = avoirsDe(f.id);
                  return (
                    <tr key={f.id} className={f.statut === "Annulée" ? "annule" : undefined}>
                      <td><span className="code">{f.numero}</span><br />{f.objet}{f.pv?.numero && <><br /><span className="note">PV {f.pv.numero}</span></>}
                        {f.statut === "Annulée" && <><br /><span className="note">Annulée le {dateFr(f.annulee_le)} : {f.motif_annulation}</span></>}
                        {av > 0 && <><br /><span className="note">Avoirs : − {fcfa(av)} FCFA HT</span></>}</td>
                      <td className="code">{codes.get(f.chantier_id)}</td>
                      <td className="num">{dateFr(f.date_emission)}</td>
                      <td className="num">{dateFr(f.echeance)}</td>
                      <td className="num">{fcfa(f.montant_ht)}</td>
                      <td className="num">{fcfa(f.montant_tva)}<br /><span className="note">{Number(f.taux_tva)} %</span></td>
                      <td className="num">{fcfa(f.montant_ttc)}</td>
                      <td className="num">{Number(f.taux_aib) ? <>{fcfa(f.montant_aib)}<br /><span className="note">{Number(f.taux_aib)} %</span></> : "—"}</td>
                      <td className="num"><b>{fcfa(f.net_a_payer)}</b></td>
                      <td><Pastille texte={retard ? "En retard" : f.statut} ton={f.statut === "Payée" ? "ok" : f.statut === "Annulée" ? "bad" : retard ? "bad" : "warn"} /></td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <Link className="btn sm" href={`/finances/facture/${f.id}`}>Imprimer</Link>
                        {f.statut === "Émise" && s.peut("fc.encaisser") && (
                          <form action={encaisser}><input type="hidden" name="id" value={f.id} /><input type="hidden" name="numero" value={f.numero} /><button className="btn sm ok">Encaisser</button></form>
                        )}
                        {corrige && f.statut !== "Annulée" && (
                          <Correction id={f.id} numero={f.numero} quoi="la facture" annuler={f.statut === "Émise" && av === 0 ? annulerFactureClient : undefined}
                            avoir={emettreAvoir} resteHt={Number(f.montant_ht) - av} />
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!liste.length && <tr><td colSpan={11} className="note">Aucune facture client.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
        {avoirs.length > 0 && (
          <section className="panel">
            <h2>Avoirs</h2>
            <div className="tbl">
              <table>
                <thead><tr><th>Avoir</th><th>Sur la facture</th><th>Projet</th><th className="num">Date</th><th>Motif</th><th className="num">HT</th><th className="num">TVA</th><th className="num">TTC</th><th className="num">Net</th></tr></thead>
                <tbody>
                  {avoirs.map((a) => (
                    <tr key={a.id}>
                      <td className="code">{a.numero}</td><td className="code">{numFac.get(a.facture_id)}</td><td className="code">{codes.get(a.chantier_id)}</td>
                      <td className="num">{dateFr(a.date_avoir)}</td><td>{a.motif}</td>
                      <td className="num">− {fcfa(a.montant_ht)}</td><td className="num">− {fcfa(a.montant_tva)}</td><td className="num">− {fcfa(a.montant_ttc)}</td><td className="num"><b>− {fcfa(a.net_a_payer)}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </>
    );
  }

  if (onglet === "fournisseurs") {
    const [{ data }, { data: seuil }] = await Promise.all([
      supabase.from("factures_fournisseurs").select("*, pv:pv_execution(numero), bc:bons_commande(numero)").order("date_reception", { ascending: false }),
      supabase.rpc("parametre", { p_cle: "seuil_validation" }),
    ]);
    const S = Number(seuil ?? 2000000);
    const liste = data ?? [];
    const [{ data: fous }, { data: fisc }] = await Promise.all([
      supabase.from("tiers").select("id,nom,type").in("type", ["fournisseur", "prestataire"]).eq("actif", true).order("nom"),
      supabase.from("justificatifs").select("objet_id,valide_jusquau").eq("objet", "tiers").in("type_document", ["Attestation de régularité fiscale", "Quitus fiscal"]).gte("valide_jusquau", auj),
    ]);
    const fiscalOk = new Set((fisc ?? []).map((x) => x.objet_id));
    const docsFf = await documentsPar("facture_fournisseur");
    const { data: bcs } = await supabase.from("bons_commande").select("id,numero,chantier_id,fournisseur,objet").eq("statut", "Validé").order("numero");
    const bonsValides: BcValide[] = (bcs ?? []).map((b) => ({ ...b, code: codes.get(b.chantier_id) ?? "" }));
    const nonRejetees = liste.filter((f) => f.statut !== "Rejetée" && f.statut !== "Annulée");
    const somme = (l: typeof liste, c: "montant_ht" | "montant_tva" | "montant_ttc") => l.reduce((a, f) => a + Number(f[c]), 0);
    const aPayer = liste.filter((f) => f.statut === "Reçue" || f.statut === "Validée").reduce((a, f) => a + Number(f.net_a_payer), 0);
    const peutValider = (m: number) => s.peut("dep.valider_tout") || (s.peut("dep.valider") && m <= S);
    contenu = (
      <>
        {s.peut("ff.enregistrer") && <FormFactureFournisseur chantiers={chantiers ?? []} pvs={await pvSignes("prestataire")} bons={bonsValides} tva={taux.tva} aib={aibs} fournisseurs={fous ?? []} />}
        <div className="kpis">
          <Kpi libelle="Total HT" valeur={fcfa(somme(nonRejetees, "montant_ht"))} unite="FCFA" />
          <Kpi libelle="TVA déductible" valeur={fcfa(somme(nonRejetees, "montant_tva"))} unite="FCFA" />
          <Kpi libelle="Total TTC" valeur={fcfa(somme(nonRejetees, "montant_ttc"))} unite="FCFA" />
          <Kpi libelle="Reste à payer (net d'AIB)" valeur={fcfa(aPayer)} unite="FCFA" ton={aPayer ? "hl" : undefined} />
        </div>
        <section className="panel">
          <p className="note">Circuit : la facture est enregistrée, puis reçoit un bon à payer (RAF jusqu&apos;à {fcfa(S)} FCFA, PDG ou DO au-delà), puis elle est payée. Personne ne valide une facture qu&apos;il a saisie. L&apos;AIB est retenu par DGS : le net à payer est le TTC moins l&apos;AIB. Une facture erronée non payée s&apos;annule avec un motif, puis se ressaisit. Le bon à payer et le paiement exigent une attestation fiscale du fournisseur en cours de validité (sur sa fiche).</p>
          <div className="tbl">
            <table>
              <thead><tr><th>Fournisseur</th><th>Objet</th><th>Imputation</th><th className="num">Échéance</th><th className="num">Montant HT</th><th className="num">TVA</th><th className="num">Montant TTC</th><th className="num">AIB</th><th className="num">Net à payer</th><th>Statut</th><th>Facture</th><th>Action</th></tr></thead>
              <tbody>
                {liste.map((f) => {
                  const m = Number(f.montant_ht);
                  const decide = f.statut === "Reçue" && f.saisie_par !== s.profil.id && peutValider(m);
                  return (
                    <tr key={f.id} className={f.statut === "Annulée" ? "annule" : undefined}>
                      <td>{f.tiers_id ? <Link href={`/tiers/${f.tiers_id}`}>{f.fournisseur}</Link> : f.fournisseur}<br /><span className="code">{f.numero}</span>
                        {(f.statut === "Reçue" || f.statut === "Validée") && (!f.tiers_id ? <><br /><span className="neg">Fournisseur non enregistré</span></>
                          : !fiscalOk.has(f.tiers_id) ? <><br /><span className="neg">Attestation fiscale manquante ou expirée</span></> : null)}{f.statut === "Annulée" && <><br /><span className="note">Annulée le {dateFr(f.annulee_le)} : {f.motif_annulation}</span></>}</td>
                      <td>{f.objet}{(f.pv?.numero || f.bc?.numero) && <><br /><span className="note">{[f.pv?.numero && `PV ${f.pv.numero}`, f.bc?.numero && `BC ${f.bc.numero}`].filter(Boolean).join(" · ")}</span></>}</td>
                      <td>{f.chantier_id ? <span className="code">{codes.get(f.chantier_id)}</span> : <span className="dom">Frais généraux</span>}</td>
                      <td className="num">{dateFr(f.echeance)}{f.statut !== "Payée" && f.echeance && f.echeance < auj && <><br /><Pastille texte="Échue" ton="bad" /></>}</td>
                      <td className="num">{fcfa(m)}</td>
                      <td className="num">{fcfa(f.montant_tva)}<br /><span className="note">{Number(f.taux_tva) ? `${Number(f.taux_tva)} %` : "Exonérée"}</span></td>
                      <td className="num">{fcfa(f.montant_ttc)}</td>
                      <td className="num">{Number(f.taux_aib) ? <>{fcfa(f.montant_aib)}<br /><span className="note">{Number(f.taux_aib)} %</span></> : "—"}</td>
                      <td className="num"><b>{fcfa(f.net_a_payer)}</b></td>
                      <td><Pastille texte={f.statut === "Validée" ? "Bon à payer" : f.statut} ton={f.statut === "Payée" || f.statut === "Validée" ? "ok" : f.statut === "Rejetée" || f.statut === "Annulée" ? "bad" : "warn"} /></td>
                      <td><Justificatifs compact objet="facture_fournisseur" objetId={f.id} numero={f.numero} pays={s.pays.code} fichiers={docsFf(f.id)} peutDeposer={s.peut("ff.enregistrer") && f.statut !== "Annulée"} page="/finances" /></td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {decide && (
                          <span className="statusline">
                            <form action={deciderFactureFournisseur}><input type="hidden" name="id" value={f.id} /><input type="hidden" name="numero" value={f.numero} /><input type="hidden" name="accepte" value="1" /><button className="btn sm ok">Bon à payer</button></form>
                            <form action={deciderFactureFournisseur}><input type="hidden" name="id" value={f.id} /><input type="hidden" name="numero" value={f.numero} /><input type="hidden" name="accepte" value="0" /><button className="btn sm bad">Rejeter</button></form>
                          </span>
                        )}
                        {f.statut === "Validée" && s.peut("dep.payer") && (
                          <form action={payerFactureFournisseur}><input type="hidden" name="id" value={f.id} /><input type="hidden" name="numero" value={f.numero} /><button className="btn sm">Payer</button></form>
                        )}
                        {corrige && (f.statut === "Reçue" || f.statut === "Validée") && (
                          <Correction id={f.id} numero={f.numero} quoi="la facture" annuler={annulerFactureFournisseur} />
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!liste.length && <tr><td colSpan={12} className="note">Aucune facture fournisseur.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </>
    );
  }

  if (onglet === "frais") {
    const { data } = await supabase.rpc("frais_generaux_du_mois", { p_mois: mois + "-01" });
    const lignes = (data ?? []) as { source: string; categorie: string; libelle: string; montant: number }[];
    const total = lignes.reduce((a, l) => a + Number(l.montant), 0);
    contenu = (
      <>
        <div className="statusline">
          <Link className="btn sm" href={`/finances?onglet=frais&mois=${decaler(mois, -1)}`}>← {libMois(decaler(mois, -1))}</Link>
          <b>{libMois(mois)}</b>
          <Link className="btn sm" href={`/finances?onglet=frais&mois=${decaler(mois, 1)}`}>{libMois(decaler(mois, 1))} →</Link>
        </div>
        <div className="kpis"><Kpi libelle={`Frais généraux ${libMois(mois)}`} valeur={fcfa(total)} unite="FCFA" /></div>
        {s.peut("fg.saisir") && <FormFraisGeneral mois={mois} />}
        <section className="panel">
          <p className="note">Seuls les frais de fonctionnement indépendants des projets sont ici : bureau, véhicules de direction, salaires du personnel administratif. Ils réduisent le résultat de la filiale, pas la marge d&apos;un projet.</p>
          <div className="tbl">
            <table>
              <thead><tr><th>Catégorie</th><th>Libellé</th><th>Source</th><th className="num">Montant FCFA</th></tr></thead>
              <tbody>
                {lignes.map((l, i) => (
                  <tr key={i}><td>{l.categorie}</td><td>{l.libelle}</td><td className="note">{l.source}</td><td className="num">{fcfa(l.montant)}</td></tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={3}>Total {libMois(mois)}</td><td className="num">{fcfa(total)}</td></tr></tfoot>
            </table>
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>Finances</h1>
          <p className="sub">{s.global ? "Recettes et dépenses suivies projet par projet. Les frais généraux sont suivis à part, chaque mois." : "Les finances de vos projets."}</p>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {onglets.map(([k, l]) => (
          <Link key={k} href={`/finances?onglet=${k}`} role="tab" aria-selected={k === onglet} className="tab">{l}</Link>
        ))}
      </div>
      {sp.erreur && <p className="erreur">{sp.erreur}</p>}
      {contenu}
    </>
  );
}
