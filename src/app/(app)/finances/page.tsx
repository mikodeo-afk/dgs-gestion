import Link from "next/link";
import { redirect } from "next/navigation";
import { exigerSession } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { aujourdhui, dateFr, fcfa } from "@/lib/format";
import { Kpi, Pastille } from "@/components/ui";
import { FormFactureClient, FormFactureFournisseur, FormFraisGeneral } from "./Formulaires";
import { deciderFactureFournisseur, encaisser, payerFactureFournisseur } from "./actions";

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const libMois = (m: string) => `${MOIS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const decaler = (m: string, k: number) => {
  const d = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + k, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

type Rent = { chantier_id: string; code: string; nom: string; montant_marche: number; budget_depenses: number; facture_ht: number; encaisse_ht: number; depenses: number; factures_fournisseurs: number; main_oeuvre: number; couts: number; marge: number };

export default async function Finances({ searchParams }: { searchParams: Promise<{ onglet?: string; mois?: string }> }) {
  const s = await exigerSession();
  if (!s.peut("fin.voir")) redirect("/");
  const sp = await searchParams;
  const voitFG = s.peut("fg.voir") || s.peut("fg.saisir");
  const onglets = [["rentabilite", "Rentabilité par projet"], ["clients", "Factures clients"], ["fournisseurs", "Factures fournisseurs"], ...(voitFG ? [["frais", "Frais généraux"]] : [])];
  const onglet = onglets.some((o) => o[0] === sp.onglet) ? sp.onglet! : "rentabilite";
  const auj = aujourdhui();
  const mois = /^\d{4}-\d{2}$/.test(sp.mois ?? "") ? sp.mois! : auj.slice(0, 7);
  const supabase = await supabaseServeur();
  const { data: chantiers } = await supabase.from("chantiers").select("id,code,nom").order("code");
  const codes = new Map((chantiers ?? []).map((c) => [c.id, c.code]));

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
    const { data } = await supabase.from("factures_clients").select("*").order("date_emission", { ascending: false });
    const liste = data ?? [];
    const actives = liste.filter((f) => f.statut !== "Annulée");
    const somme = (l: typeof liste, c: "montant_ht" | "montant_tva" | "montant_ttc") => l.reduce((a, f) => a + Number(f[c]), 0);
    const du = somme(liste.filter((f) => f.statut === "Émise"), "montant_ttc");
    contenu = (
      <>
        {s.peut("fc.emettre") && <FormFactureClient chantiers={chantiers ?? []} />}
        <div className="kpis">
          <Kpi libelle="Facturé HT" valeur={fcfa(somme(actives, "montant_ht"))} unite="FCFA" />
          <Kpi libelle="TVA facturée" valeur={fcfa(somme(actives, "montant_tva"))} unite="FCFA" />
          <Kpi libelle="Facturé TTC" valeur={fcfa(somme(actives, "montant_ttc"))} unite="FCFA" />
          <Kpi libelle="Reste à encaisser TTC" valeur={fcfa(du)} unite="FCFA" ton={du ? "hl" : undefined} />
        </div>
        <section className="panel">
          <p className="note">Numéro attribué automatiquement. Une facture non payée après son échéance apparaît « En retard ».</p>
          <div className="tbl">
            <table>
              <thead><tr><th>Facture</th><th>Projet</th><th className="num">Émise le</th><th className="num">Échéance</th><th className="num">Montant HT</th><th className="num">TVA</th><th className="num">Montant TTC</th><th>Statut</th><th>Action</th></tr></thead>
              <tbody>
                {liste.map((f) => {
                  const retard = f.statut === "Émise" && f.echeance < auj;
                  return (
                    <tr key={f.id}>
                      <td><span className="code">{f.numero}</span><br />{f.objet}</td>
                      <td className="code">{codes.get(f.chantier_id)}</td>
                      <td className="num">{dateFr(f.date_emission)}</td>
                      <td className="num">{dateFr(f.echeance)}</td>
                      <td className="num">{fcfa(f.montant_ht)}</td>
                      <td className="num">{fcfa(f.montant_tva)}<br /><span className="note">{Number(f.taux_tva)} %</span></td>
                      <td className="num"><b>{fcfa(f.montant_ttc)}</b></td>
                      <td><Pastille texte={retard ? "En retard" : f.statut} ton={f.statut === "Payée" ? "ok" : retard ? "bad" : "warn"} /></td>
                      <td>{f.statut === "Émise" && s.peut("fc.encaisser") && (
                        <form action={encaisser}><input type="hidden" name="id" value={f.id} /><input type="hidden" name="numero" value={f.numero} /><button className="btn sm ok">Encaisser</button></form>
                      )}</td>
                    </tr>
                  );
                })}
                {!liste.length && <tr><td colSpan={9} className="note">Aucune facture client.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </>
    );
  }

  if (onglet === "fournisseurs") {
    const [{ data }, { data: seuil }] = await Promise.all([
      supabase.from("factures_fournisseurs").select("*").order("date_reception", { ascending: false }),
      supabase.rpc("parametre", { p_cle: "seuil_validation" }),
    ]);
    const S = Number(seuil ?? 2000000);
    const liste = data ?? [];
    const nonRejetees = liste.filter((f) => f.statut !== "Rejetée");
    const somme = (l: typeof liste, c: "montant_ht" | "montant_tva" | "montant_ttc") => l.reduce((a, f) => a + Number(f[c]), 0);
    const aPayer = somme(liste.filter((f) => f.statut === "Reçue" || f.statut === "Validée"), "montant_ttc");
    const peutValider = (m: number) => s.peut("dep.valider_tout") || (s.peut("dep.valider") && m <= S);
    contenu = (
      <>
        {s.peut("ff.enregistrer") && <FormFactureFournisseur chantiers={chantiers ?? []} />}
        <div className="kpis">
          <Kpi libelle="Total HT" valeur={fcfa(somme(nonRejetees, "montant_ht"))} unite="FCFA" />
          <Kpi libelle="TVA déductible" valeur={fcfa(somme(nonRejetees, "montant_tva"))} unite="FCFA" />
          <Kpi libelle="Total TTC" valeur={fcfa(somme(nonRejetees, "montant_ttc"))} unite="FCFA" />
          <Kpi libelle="Reste à payer TTC" valeur={fcfa(aPayer)} unite="FCFA" ton={aPayer ? "hl" : undefined} />
        </div>
        <section className="panel">
          <p className="note">Circuit : la facture est enregistrée, puis reçoit un bon à payer (RAF jusqu&apos;à {fcfa(S)} FCFA, PDG ou DO au-delà), puis elle est payée. Personne ne valide une facture qu&apos;il a saisie.</p>
          <div className="tbl">
            <table>
              <thead><tr><th>Fournisseur</th><th>Objet</th><th>Imputation</th><th className="num">Échéance</th><th className="num">Montant HT</th><th className="num">TVA</th><th className="num">Montant TTC</th><th>Statut</th><th>Action</th></tr></thead>
              <tbody>
                {liste.map((f) => {
                  const m = Number(f.montant_ht);
                  const decide = f.statut === "Reçue" && f.saisie_par !== s.profil.id && peutValider(m);
                  return (
                    <tr key={f.id}>
                      <td>{f.fournisseur}<br /><span className="code">{f.numero}</span></td>
                      <td>{f.objet}</td>
                      <td>{f.chantier_id ? <span className="code">{codes.get(f.chantier_id)}</span> : <span className="dom">Frais généraux</span>}</td>
                      <td className="num">{dateFr(f.echeance)}{f.statut !== "Payée" && f.echeance && f.echeance < auj && <><br /><Pastille texte="Échue" ton="bad" /></>}</td>
                      <td className="num">{fcfa(m)}</td>
                      <td className="num">{fcfa(f.montant_tva)}<br /><span className="note">{Number(f.taux_tva) ? `${Number(f.taux_tva)} %` : "Exonérée"}</span></td>
                      <td className="num"><b>{fcfa(f.montant_ttc)}</b></td>
                      <td><Pastille texte={f.statut === "Validée" ? "Bon à payer" : f.statut} ton={f.statut === "Payée" || f.statut === "Validée" ? "ok" : f.statut === "Rejetée" ? "bad" : "warn"} /></td>
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
                      </td>
                    </tr>
                  );
                })}
                {!liste.length && <tr><td colSpan={9} className="note">Aucune facture fournisseur.</td></tr>}
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
      {contenu}
    </>
  );
}
