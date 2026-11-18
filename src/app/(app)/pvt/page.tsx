import Link from "next/link";
import { exigerSession } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { tauxDuPays } from "@/lib/parametres";
import { aujourdhui, dateFr, fcfa } from "@/lib/format";
import { Kpi, Pastille } from "@/components/ui";
import {
  echeances, factureSbin, fenetreAvance, moisFr, moisPrecedent, moisSuivant, parVendeur, retention,
  type Facture, type Mois, type Offre, type Vendeur, type Vente, type Versement,
} from "@/lib/pvt";
import {
  Attribuer, BasculerVendeur, CompteVendeur, ModifierVendeur, EtatLigne, FormContrat, FormMois, FormOffre, FormVendeur, FormVente, FormVersement,
  ImportExtraction, SupprimerVente, SupprimerVersement, VerserAvances,
} from "./Composants";

const ONGLETS = [["mois", "Suivi du mois"], ["ventes", "Ventes"], ["lignes", "Statut des lignes"], ["vendeurs", "Vendeurs"], ["offres", "Offres et contrat"]] as const;
const TON: Record<string, "ok" | "warn" | "bad"> = { Reportée: "warn", Déclarée: "warn", Validée: "ok", Rejetée: "bad", Active: "ok", Suspendue: "bad", Résiliée: "bad" };

export default async function VentesTerrain({ searchParams }: { searchParams: Promise<{ mois?: string; onglet?: string }> }) {
  const s = await exigerSession();
  const sp = await searchParams;
  const supabase = await supabaseServeur();
  const mois = /^\d{4}-\d{2}$/.test(sp.mois ?? "") ? `${sp.mois}-01` : aujourdhui().slice(0, 8) + "01";
  const gere = s.peut("pvt.gerer");
  const voitTout = gere || s.peut("pvt.voir") || s.peut("pvt.saisir");
  const debutHisto = moisPrecedent(moisPrecedent(moisPrecedent(moisPrecedent(moisPrecedent(moisPrecedent(mois))))));

  const [{ data: contrat }, { data: offresB }, { data: vendeursB }, { data: ventesB }, { data: versB }, { data: moisB }, taux] = await Promise.all([
    supabase.from("pvt_contrats").select("*").maybeSingle(),
    supabase.from("pvt_offres").select("*").order("ordre"),
    supabase.from("pvt_vendeurs").select("*").order("nom"),
    supabase.from("pvt_ventes").select("*").gte("mois", debutHisto).lte("mois", mois).order("date_vente", { ascending: false }),
    supabase.from("pvt_versements").select("*").eq("mois", mois).order("verse_le"),
    supabase.from("pvt_mois").select("*").eq("mois", mois).maybeSingle(),
    tauxDuPays(),
  ]);
  const offresL = (offresB ?? []) as Offre[];
  const offres = new Map(offresL.map((o) => [o.id, o]));
  const vendeurs = (vendeursB ?? []) as Vendeur[];
  const nomV = new Map(vendeurs.map((v) => [v.id, v.nom]));
  const ventes = (ventesB ?? []) as Vente[];
  const versements = (versB ?? []) as Versement[];
  const m = (moisB ?? undefined) as Mois | undefined;
  const tauxAvance = Number(contrat?.taux_avance ?? 50);
  const debutContrat = contrat?.date_debut ?? "2026-07-31";
  const estVendeur = !voitTout;
  const moi = vendeurs.find((v) => v.profil_id === s.profil.id);

  const duMois = ventes.filter((v) => v.mois === mois);
  const lignesV = parVendeur(mois, vendeurs.filter((v) => v.actif || duMois.some((x) => x.vendeur_id === v.id)), ventes, offres, versements, tauxAvance);
  const fac = factureSbin(mois, ventes, offres, vendeurs, debutContrat, Number(m?.ajustement ?? 0), taux.tva);
  const ret = retention(mois, ventes, offres);
  const fen = fenetreAvance(mois);
  const nb = (st: string) => duMois.filter((v) => v.statut === st).length;
  const onglet = ONGLETS.some(([k]) => k === sp.onglet) ? sp.onglet! : estVendeur ? "ventes" : "mois";
  const lien = (p: { mois?: string; onglet?: string }) => `/pvt?mois=${(p.mois ?? mois).slice(0, 7)}&onglet=${p.onglet ?? onglet}`;
  const aRenseigner = ventes.filter((v) => v.statut === "Validée" && !v.etat_ligne).length;

  if (!contrat && !offresL.length) {
    return (
      <>
        <div className="head"><div><h1>Ventes terrain</h1></div></div>
        <section className="panel"><p className="note">Aucun contrat de ventes terrain dans ce pays. Le suivi est configuré pour le contrat PVT Celtiis (SBIN) du Bénin.</p>
          {gere && <FormContrat reference="Contrat PVT" debut={aujourdhui()} taux={50} />}</section>
      </>
    );
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>{estVendeur ? "Mes ventes" : "Ventes terrain Celtiis"} · {moisFr(mois)}</h1>
          <p className="sub">
            {estVendeur
              ? `Déclarez chaque vente dès qu'elle est faite. L'avance (${tauxAvance} % de votre part sur le point temporaire) est versée entre le 30 et le 05 ; le solde après validation par l'extraction SBIN.`
              : `${contrat?.reference ?? "Contrat PVT"}. Avance aux vendeurs de ${tauxAvance} % de leur part sur le point temporaire, entre le 30 et le 05, puis régularisation à réception de l'extraction SBIN (au plus tard le 15).`}
          </p>
        </div>
        <div className="statusline">
          <Link className="btn sm" href={lien({ mois: moisPrecedent(mois) })}>← {moisFr(moisPrecedent(mois))}</Link>
          <Link className="btn sm" href={lien({ mois: moisSuivant(mois) })}>{moisFr(moisSuivant(mois))} →</Link>
        </div>
      </div>

      <div className="kpis">
        <Kpi libelle="Ventes déclarées (point temporaire)" valeur={nb("Déclarée") + nb("Validée") + nb("Reportée")} unite={`dont ${nb("Validée")} validée(s)${nb("Reportée") ? `, ${nb("Reportée")} reportée(s)` : ""}`} />
        {estVendeur && moi ? (() => {
          const l = lignesV.find((x) => x.vendeur.id === moi.id);
          return <>
            <Kpi libelle="Ma part sur le déclaré" valeur={fcfa(l?.partDeclaree)} unite="FCFA" />
            <Kpi libelle="Avance reçue" valeur={fcfa(l?.avancesVersees)} unite="FCFA" />
            <Kpi libelle="Reste à recevoir (validé)" valeur={fcfa(l?.du)} unite="FCFA" ton="hl" />
          </>;
        })() : <>
          <Kpi libelle="Avances calculées" valeur={fcfa(lignesV.reduce((a, l) => a + l.avanceCalculee, 0))} unite="FCFA" />
          <Kpi libelle="Facture SBIN (validé)" valeur={fcfa(fac.ttc)} unite="FCFA TTC" />
          <Kpi libelle="Marge DGS (HT)" valeur={fcfa(fac.margeDgs)} unite="FCFA" ton="hl" />
        </>}
      </div>
      {aRenseigner > 0 && <p className="note"><Pastille texte={`${aRenseigner} ligne(s) à renseigner`} ton="warn" /> Mettez à jour le statut des lignes en fin de mois : il déclenche le bonus ou le malus de rétention. <Link href={lien({ onglet: "lignes" })}>Statut des lignes</Link></p>}

      <div className="tabs" role="tablist">
        {ONGLETS.filter(([k]) => !estVendeur || k === "ventes" || k === "lignes").map(([k, v]) =>
          <Link key={k} href={lien({ onglet: k })} role="tab" aria-selected={onglet === k} className="tab">{v}</Link>)}
      </div>

      {onglet === "mois" && !estVendeur && (
        <>
          <section className="panel">
            <h2>Vendeurs : avance et solde</h2>
            <div className="tbl">
              <table>
                <thead><tr><th>Vendeur</th><th className="num">Déclarées</th><th className="num">Validées</th><th className="num">Part sur le déclaré</th><th className="num">Avance ({tauxAvance} %)</th>
                  <th className="num">Part validée</th><th className="num">Prime VTM / VTB</th><th className="num">Transport</th><th className="num">Bonus rétention</th><th className="num">Déjà versé</th><th className="num">Reste dû</th></tr></thead>
                <tbody>
                  {lignesV.filter((l) => l.declarees || l.validees || l.avancesVersees || l.bonusRetention).map((l) => (
                    <tr key={l.vendeur.id}>
                      <td>{l.vendeur.nom}{l.avanceHorsFenetre && <><br /><Pastille texte="Avance hors période 30→05" ton="warn" /></>}</td>
                      <td className="num">{l.declarees}</td><td className="num">{l.validees}{l.reportees > 0 && <span className="note"> ({l.reportees} rep.)</span>}{l.rejetees > 0 && <span className="note"> ({l.rejetees} rej.)</span>}</td>
                      <td className="num">{fcfa(l.partDeclaree)}</td><td className="num">{fcfa(l.avanceCalculee)}</td>
                      <td className="num">{fcfa(l.partValidee)}</td><td className="num">{fcfa(l.vtm + l.vtb)}</td><td className="num">{fcfa(l.transport)}</td><td className="num">{fcfa(l.bonusRetention)}</td>
                      <td className="num">{fcfa(l.avancesVersees + l.soldesVerses)}</td>
                      <td className="num"><b className={l.du < 0 ? "erreur" : ""}>{fcfa(l.du)}</b></td>
                    </tr>
                  ))}
                  {!lignesV.some((l) => l.declarees || l.validees) && <tr><td colSpan={11} className="note">Aucune vente ce mois-ci.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="note">Le reste dû est calculé sur les ventes validées par SBIN : il devient négatif si l&apos;avance dépasse ce qui a été validé (à retenir sur le mois suivant).</p>
            {gere && <>
              <h3>Avances du mois (du {dateFr(fen.debut)} au {dateFr(fen.fin)})</h3>
              <VerserAvances mois={mois} fenetre={fen}
                lignes={lignesV.filter((l) => l.avanceCalculee - l.avancesVersees > 0).map((l) => ({ vendeur_id: l.vendeur.id, nom: l.vendeur.nom, montant: l.avanceCalculee - l.avancesVersees }))} />
              <h3>Solde après validation SBIN</h3>
              <FormVersement mois={mois} type="Solde" vendeurs={lignesV.map((l) => ({ id: l.vendeur.id, nom: l.vendeur.nom, du: l.du }))} />
            </>}
            {versements.length > 0 && (
              <details><summary className="btn sm">Versements enregistrés ({versements.length})</summary>
                <div className="tbl"><table>
                  <thead><tr><th>Date</th><th>Vendeur</th><th>Type</th><th>Mode</th><th className="num">Montant</th><th /></tr></thead>
                  <tbody>{versements.map((v) => (
                    <tr key={v.id}><td>{dateFr(v.verse_le)}</td><td>{nomV.get(v.vendeur_id)}</td><td>{v.type}</td><td>{v.mode}</td><td className="num">{fcfa(v.montant)}</td><td>{gere && <SupprimerVersement id={v.id} />}</td></tr>
                  ))}</tbody>
                </table></div>
              </details>
            )}
          </section>

          <section className="panel">
            <h2>Extraction SBIN et facture</h2>
            {gere && <ImportExtraction mois={mois} offres={offresL} declarees={nb("Déclarée")} />}
            <div className="tbl">
              <table>
                <tbody>
                  {(() => {
                    const L = (libelle: React.ReactNode, k: keyof Facture, note?: boolean) => (
                      <tr className={note ? "note" : undefined}><td>{libelle}</td><td className="num">{fcfa(fac.b2c[k])}</td><td className="num">{fcfa(fac.b2b[k])}</td><td className="num">{fcfa(fac.b2c[k] + fac.b2b[k])}</td></tr>
                    );
                    return <>
                      <tr><th /><th className="num">FTTH (B2C)</th><th className="num">FTTO… (B2B)</th><th className="num">Total</th></tr>
                      {L("Ventes validées (dont arriérés payés ce mois)", "nombre")}
                      {L("Commissions", "commissions")}
                      {L("dont part des vendeurs (VTB)", "partVendeurs", true)}
                      {L("dont part DGS (PVT)", "partPartenaire", true)}
                      {L(`Prime PVT par vente${fac.nouveau ? " (seuils des 2 premiers mois)" : ""}`, "performance")}
                      {L("Primes vendeurs (VTM en B2C, VTB en B2B)", "primesVendeurs")}
                      {L("Prime d'objectif (contrat)", "objectif")}
                      {(fac.b2b.transport > 0) && L("Primes de transport", "transport")}
                      {L("Rétention : bonus vendeurs", "retentionVendeurs")}
                      {L(<>Rétention : bonus / malus DGS{fac.retentionARenseigner > 0 && <span className="note"> ({fac.retentionARenseigner} ligne(s) à renseigner)</span>}</>, "retentionPartenaire")}
                      {L("Total HT", "ht")}
                    </>;
                  })()}
                  {fac.ajustement !== 0 && <tr><td colSpan={3}>Ajustement {m?.ajustement_motif ? `(${m.ajustement_motif})` : ""}</td><td className="num">{fcfa(fac.ajustement)}</td></tr>}
                  <tr><th colSpan={3}>Total HT</th><th className="num">{fcfa(fac.ht)}</th></tr>
                  <tr><td colSpan={3}>TVA {taux.tva} %</td><td className="num">{fcfa(fac.tva)}</td></tr>
                  <tr><th colSpan={3}>Total TTC à facturer à SBIN</th><th className="num">{fcfa(fac.ttc)}</th></tr>
                </tbody>
              </table>
            </div>
            {gere && <FormMois mois={mois} m={m} htCalcule={fac.ht} />}
          </section>

          <section className="panel">
            <h2>Échéances de {moisFr(mois)}</h2>
            <div className="tbl"><table>
              <thead><tr><th>Étape</th><th>Quand</th><th>État</th></tr></thead>
              <tbody>{echeances(mois, m).map((e) => {
                const retard = !e.fait && e.au && e.au < aujourdhui();
                return (
                  <tr key={e.libelle}><td>{e.libelle}</td>
                    <td>{e.du ? `du ${dateFr(e.du)} au ${dateFr(e.au)}` : e.au ? `au plus tard le ${dateFr(e.au)}` : "dès réception de l'extraction"}</td>
                    <td>{e.fait ? <Pastille texte={`Fait le ${dateFr(e.fait)}`} ton="ok" /> : retard ? <Pastille texte="En retard" ton="bad" /> : <Pastille texte="À venir" ton="warn" />}</td></tr>
                );
              })}</tbody>
            </table></div>
          </section>
        </>
      )}

      {onglet === "ventes" && (
        <section className="panel">
          <h2>{estVendeur ? "Déclarer une vente" : "Ventes du mois"}</h2>
          {(estVendeur ? moi : s.peut("pvt.saisir") || gere) && vendeurs.some((v) => v.actif) &&
            <FormVente vendeurs={vendeurs.filter((v) => v.actif)} offres={offresL} estVendeur={estVendeur} defaut={mois === aujourdhui().slice(0, 8) + "01" ? aujourdhui() : mois} />}
          {estVendeur && !moi && <p className="erreur">Votre compte n&apos;est relié à aucune fiche de vendeur : voyez votre superviseur.</p>}
          <div className="tbl">
            <table>
              <thead><tr><th>Date</th>{!estVendeur && <th>Vendeur</th>}<th>Offre</th><th>Client · ligne</th><th className="num">Part vendeur</th><th>Statut</th><th /></tr></thead>
              <tbody>
                {duMois.map((v) => {
                  const o = offres.get(v.offre_id);
                  return (
                    <tr key={v.id}>
                      <td>{dateFr(v.date_vente)}</td>
                      {!estVendeur && <td>{v.vendeur_id ? nomV.get(v.vendeur_id) : gere ? <Attribuer id={v.id} vendeurs={vendeurs.filter((x) => x.actif)} /> : <Pastille texte="À attribuer" ton="warn" />}</td>}
                      <td>{o?.libelle}<br /><span className="note">{o?.segment} · {o?.famille}</span></td>
                      <td>{v.client ?? "—"}<br /><span className="code">{v.ligne}</span></td>
                      <td className="num">{fcfa(o?.part_vendeur)}</td>
                      <td><Pastille texte={v.statut} ton={TON[v.statut]} />{v.source === "Extraction SBIN" && <><br /><span className="note">ajoutée par l&apos;extraction</span></>}{v.motif && <><br /><span className="note">{v.motif}</span></>}</td>
                      <td>{v.statut === "Déclarée" && <SupprimerVente id={v.id} />}</td>
                    </tr>
                  );
                })}
                {!duMois.length && <tr><td colSpan={7} className="note">Aucune vente en {moisFr(mois)}.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {onglet === "lignes" && (
        <section className="panel">
          <h2>Statut des lignes (rétention)</h2>
          <p className="note">À mettre à jour à la fin de chaque mois. B2C : à M+3, au moins 90 % de lignes actives donne +2 000 par ligne au vendeur et +1 000 à DGS ; en dessous, malus de 2 000 par client suspendu. B2B : après 6 mois, au moins 85 % de lignes actives donne +1 000 par ligne à DGS.</p>
          {ret.length > 0 && (
            <div className="tbl"><table>
              <thead><tr><th>Ventes de</th><th>Vendeur</th><th className="num">Lignes</th><th className="num">Actives</th><th className="num">Taux</th><th>Résultat ce mois-ci</th></tr></thead>
              <tbody>{ret.filter((r) => !estVendeur || r.vendeurId === moi?.id).map((r, i) => (
                <tr key={i}><td>{moisFr(r.cohorte)} · {r.segment}</td><td>{r.vendeurId ? nomV.get(r.vendeurId) : "Non attribuées"}</td><td className="num">{r.lignes}</td><td className="num">{r.actives}</td><td className="num">{r.taux} %</td>
                  <td>{r.atteint === null ? <Pastille texte={`${r.aRenseigner} ligne(s) à renseigner`} ton="warn" />
                    : r.atteint ? <Pastille texte={`Bonus : ${fcfa(r.bonusVendeur + r.bonusPartenaire)} FCFA (seuil ${r.seuil} %)`} ton="ok" />
                    : <Pastille texte={r.malus ? `Malus : ${fcfa(r.malus)} FCFA` : `Seuil de ${r.seuil} % non atteint`} ton="bad" />}</td></tr>
              ))}</tbody>
            </table></div>
          )}
          <div className="tbl">
            <table>
              <thead><tr><th>Vendue en</th>{!estVendeur && <th>Vendeur</th>}<th>Client · ligne</th><th>Offre</th><th>Statut de la ligne</th></tr></thead>
              <tbody>
                {ventes.filter((v) => v.statut === "Validée").map((v) => (
                  <tr key={v.id}>
                    <td>{moisFr(v.mois)}</td>
                    {!estVendeur && <td>{v.vendeur_id ? nomV.get(v.vendeur_id) : "—"}</td>}
                    <td>{v.client ?? "—"}<br /><span className="code">{v.ligne}</span></td>
                    <td>{offres.get(v.offre_id)?.libelle}</td>
                    <td><EtatLigne id={v.id} etat={v.etat_ligne} />{v.etat_maj_le && <><br /><span className="note">mis à jour le {dateFr(v.etat_maj_le)}</span></>}</td>
                  </tr>
                ))}
                {!ventes.some((v) => v.statut === "Validée") && <tr><td colSpan={5} className="note">Aucune ligne validée par SBIN sur les 6 derniers mois.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {onglet === "vendeurs" && !estVendeur && (
        <section className="panel">
          <h2>Vendeurs terrain</h2>
          {gere && <details><summary className="btn sm pri">Ajouter un vendeur</summary><FormVendeur /></details>}
          <div className="tbl">
            <table>
              <thead><tr><th>Vendeur · login SBIN</th><th>Téléphone · n° Celtiis</th><th>Pièce</th><th>Segment</th><th>Depuis</th><th>Compte</th><th /></tr></thead>
              <tbody>
                {vendeurs.map((v) => (
                  <tr key={v.id} style={v.actif ? undefined : { opacity: 0.55 }}>
                    <td>{v.nom}<br /><span className="note code">{v.login_sbin ?? "login SBIN à renseigner"}</span></td><td>{v.telephone ?? "—"}<br /><span className="note">{v.numero_celtiis}</span></td><td>{v.piece_identite ?? "—"}</td>
                    <td>{v.segment}</td><td>{dateFr(v.debut)}</td>
                    <td>{v.profil_id ? <Pastille texte="Oui" ton="ok" /> : gere ? <CompteVendeur id={v.id} /> : "Non"}</td>
                    <td>{gere && <><ModifierVendeur v={v} /><BasculerVendeur id={v.id} actif={v.actif} /></>}</td>
                  </tr>
                ))}
                {!vendeurs.length && <tr><td colSpan={7} className="note">Aucun vendeur.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="note">Le login SBIN (pvt_dgs_…) relie automatiquement les lignes des extractions au vendeur ; les vendeurs inconnus sont créés à l&apos;import, avec leur login comme nom provisoire. Un vendeur qui a un compte se connecte avec son numéro de téléphone (ou son e-mail) et voit seulement ses ventes, ses avances et le statut de ses lignes.</p>
        </section>
      )}

      {onglet === "offres" && !estVendeur && (
        <section className="panel">
          <h2>Contrat</h2>
          {gere ? <FormContrat reference={contrat?.reference ?? ""} debut={debutContrat} taux={tauxAvance} />
            : <p>{contrat?.reference} · depuis le {dateFr(debutContrat)} · avance {tauxAvance} %</p>}
          <h2>Grille des commissions (annexe 3)</h2>
          <div className="tbl">
            <table>
              <thead><tr><th>Code</th><th>Offre</th><th>Segment</th><th className="num">Commission</th><th className="num">Vendeur</th><th className="num">DGS</th><th /></tr></thead>
              <tbody>{offresL.map((o) => (
                <tr key={o.id} style={o.actif ? undefined : { opacity: 0.55 }}>
                  <td className="code">{o.code}</td><td>{o.libelle}{!o.performance && <><br /><span className="note">hors prime de performance</span></>}</td><td>{o.segment} · {o.famille}</td>
                  <td className="num">{fcfa(o.commission)}</td><td className="num">{fcfa(o.part_vendeur)}</td><td className="num">{fcfa(o.part_partenaire)}</td>
                  <td>{gere && <details><summary className="btn sm">Modifier</summary><FormOffre offre={o} /></details>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {gere && <details><summary className="btn sm">Ajouter une offre</summary><FormOffre /></details>}
          <p className="note">Primes calculées automatiquement : VTM vendeur B2C (15 ventes et plus), VTB vendeur B2B (5 ventes et plus), performance et objectif DGS (seuils de l&apos;annexe 3, réduits les 2 premiers mois du contrat), transport B2B (1 500 par vente, 30 000 au plus, 2 premiers mois du vendeur), rétention selon le statut des lignes.</p>
        </section>
      )}
    </>
  );
}
