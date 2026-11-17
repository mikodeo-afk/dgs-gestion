import Link from "next/link";
import { redirect } from "next/navigation";
import { exigerSession } from "@/lib/session";
import { aujourdhui, dateFr, fcfa } from "@/lib/format";
import { Kpi, Pastille, Verrou } from "@/components/ui";
import { chargerDonnees, etatDuMois, moisSuivis, reglesDuPays, type EtatObligation } from "@/lib/fiscal/donnees";
import { cleMois, libelleMois, moisAvant } from "@/lib/fiscal/regles";
import { annulerEnregistrement, marquerPayee } from "./actions";
import { Assistant, FormDeclaration } from "./Composants";

const TON: Record<EtatObligation["etat"], "ok" | "warn" | "bad" | "info"> = { Faite: "ok", "À payer": "warn", "En retard": "bad", "À faire": "info" };

export default async function Fiscalite({ searchParams }: { searchParams: Promise<{ mois?: string }> }) {
  const s = await exigerSession();
  if (!s.peut("fisc.voir") && !s.peut("fisc.declarer")) redirect("/");
  const regles = reglesDuPays(s.pays.code);
  const sp = await searchParams;
  const auj = aujourdhui();
  const mois = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.mois ?? "") ? sp.mois! : auj.slice(0, 7);
  const [annee, m] = mois.split("-").map(Number);

  if (!regles)
    return (
      <>
        <div className="head"><div><h1>Fiscalité · {s.pays.nom}</h1></div></div>
        <Verrou titre={`Règles fiscales de ${s.pays.nom} pas encore configurées`}>
          L&apos;agent comptable est prêt pour le Bénin. Les règles de {s.pays.nom} (impôts, sécurité sociale, échéances) seront ajoutées ensuite :
          les déclarations de ce pays seront alors calculées de la même façon.
        </Verrou>
      </>
    );

  const [aa, mm] = auj.split("-").map(Number);
  const suivis = moisSuivis(aa, mm);
  const tous = suivis.some((x) => x.annee === annee && x.mois === m) ? suivis : [...suivis, { annee, mois: m }];
  const d = await chargerDonnees(regles, tous);
  const duMois = etatDuMois(regles, annee, m, d, auj);
  const retards = suivis.flatMap((x) => etatDuMois(regles, x.annee, x.mois, d, auj)).filter((o) => o.etat === "En retard" || (o.etat === "À payer" && o.echeance < auj));
  const prochaines = suivis.flatMap((x) => etatDuMois(regles, x.annee, x.mois, d, auj))
    .filter((o) => o.etat === "À faire" && o.echeance >= auj).sort((a, b) => a.echeance.localeCompare(b.echeance)).slice(0, 5);
  const aPayer = duMois.filter((o) => o.etat !== "Faite").reduce((t, o) => t + o.montant, 0);
  const declare = s.peut("fisc.declarer");
  const prec = moisAvant(annee, m), suiv = moisAvant(annee, m, -1);

  return (
    <>
      <div className="head">
        <div>
          <h1>Agent comptable · {s.pays.nom}</h1>
          <p className="sub">
            Les déclarations fiscales et sociales à faire chaque mois, calculées à partir des factures, dépenses, frais généraux,
            salariés déclarés et paie enregistrés dans l&apos;application, selon le CGI 2026 et la loi de finances 2026 du Bénin.
          </p>
        </div>
        <Link className="btn pri" href="/fiscalite/etats">États financiers annuels</Link>
      </div>

      <div className="kpis">
        <Kpi libelle="En retard" valeur={retards.length} ton={retards.length ? "neg" : "pos"} />
        <Kpi libelle={`Échéances de ${libelleMois(mois)}`} valeur={duMois.length} />
        <Kpi libelle="Reste à payer ce mois" valeur={fcfa(aPayer)} unite="FCFA" ton="hl" />
        <Kpi libelle="Prochaine échéance" valeur={prochaines[0] ? dateFr(prochaines[0].echeance) : "—"} />
      </div>

      {retards.length > 0 && (
        <section className="panel">
          <h2>À régulariser tout de suite</h2>
          <p className="note">Chaque mois de retard coûte : 20 % de pénalité pour déclaration tardive, 10 % + 0,25 % par mois pour paiement tardif (CGI art. 485 à 491), 1,5 % par mois à la CNSS.</p>
          <ul>
            {retards.map((o) => (
              <li key={o.code + o.periode}>
                <b>{o.nom}</b> · {o.libellePeriode} · échéance dépassée du {dateFr(o.echeance)} · {fcfa(o.montant)} FCFA{" "}
                <Link href={`/fiscalite?mois=${o.echeance.slice(0, 7)}`}>Ouvrir</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel">
        <div className="statusline" style={{ justifyContent: "space-between" }}>
          <h2>Déclarations à faire en {libelleMois(mois)}</h2>
          <div className="statusline">
            <Link className="btn sm" href={`/fiscalite?mois=${cleMois(prec.annee, prec.mois)}`}>← {libelleMois(cleMois(prec.annee, prec.mois))}</Link>
            {mois !== auj.slice(0, 7) && <Link className="btn sm" href="/fiscalite">Ce mois-ci</Link>}
            <Link className="btn sm" href={`/fiscalite?mois=${cleMois(suiv.annee, suiv.mois)}`}>{libelleMois(cleMois(suiv.annee, suiv.mois))} →</Link>
          </div>
        </div>
        {duMois.map((o) => (
          <article key={o.code + o.periode} className="decl">
            <div className="statusline" style={{ justifyContent: "space-between" }}>
              <div>
                <b>{o.nom}</b> <span className="note">· {o.libellePeriode} · {o.organisme}</span>
                <br />
                <span className="note">Échéance {dateFr(o.echeance)}</span>
              </div>
              <div className="statusline">
                <span style={{ fontFamily: "var(--f-mono)" }}><b>{fcfa(o.montant)}</b> FCFA</span>
                <Pastille texte={o.etat} ton={TON[o.etat]} />
              </div>
            </div>
            <div className="tbl">
              <table>
                <tbody>
                  {o.lignes.map((l, i) => (
                    <tr key={i}>
                      <td>{l.libelle}{l.note && <><br /><span className="note">{l.note}</span></>}</td>
                      <td className="num">{l.montant !== undefined ? fcfa(l.montant) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {o.alertes.length > 0 && (
              <ul className="alertes">
                {o.alertes.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            )}
            <p className="note">{o.comment} <i>{o.base}</i></p>
            {o.code === "DSF" && <p><Link className="btn sm" href={`/fiscalite/etats?annee=${o.periode}`}>Préparer les états financiers {o.periode}</Link></p>}
            {o.enregistree ? (
              <div className="statusline">
                <span className="note">
                  Déclarée le {dateFr(o.enregistree.declare_le)} pour {fcfa(o.enregistree.montant_declare)} FCFA
                  {o.enregistree.reference && ` (réf. ${o.enregistree.reference})`}
                  {o.enregistree.paye_le && ` · payée le ${dateFr(o.enregistree.paye_le)}`}
                  {o.enregistree.montant_declare !== o.montant && ` · écart avec le calcul : ${fcfa(o.enregistree.montant_declare - o.montant)} FCFA`}
                </span>
                {declare && o.enregistree.statut !== "Payée" && o.enregistree.montant_declare > 0 && (
                  <form action={marquerPayee}>
                    <input type="hidden" name="obligation" value={o.code} />
                    <input type="hidden" name="periode" value={o.periode} />
                    <button className="btn sm ok" type="submit">Marquer payée</button>
                  </form>
                )}
                {declare && (
                  <form action={annulerEnregistrement}>
                    <input type="hidden" name="obligation" value={o.code} />
                    <input type="hidden" name="periode" value={o.periode} />
                    <button className="btn sm" type="submit">Annuler l&apos;enregistrement</button>
                  </form>
                )}
              </div>
            ) : declare && <FormDeclaration mois={mois} obligation={o.code} periode={o.periode} montant={o.montant} />}
          </article>
        ))}
      </section>

      <section className="panel">
        <h2>Demander à l&apos;agent comptable</h2>
        <p className="note">
          L&apos;agent IA lit le calendrier ci-dessus et vos données, explique les calculs, signale les risques et vous dit quoi préparer.
          Il ne dépose rien à votre place : les déclarations se font sur e-services impots.bj et sur le portail de la CNSS.
        </p>
        <Assistant mois={mois} active={Boolean(process.env.ANTHROPIC_API_KEY)} />
      </section>

      <section className="panel">
        <h2>Bon à savoir</h2>
        <ul className="note">
          <li>Les montants sont des propositions calculées sur ce qui est saisi dans l&apos;application : une facture, une dépense ou un salaire oublié fausse le calcul. Faites valider les déclarations annuelles (IS, états financiers) par l&apos;expert-comptable.</li>
          <li>Seuls les salariés cochés « Déclaré » dans Personnel entrent dans l&apos;ITS, la VPS et la CNSS ; les autres sont signalés.</li>
          <li>Taux réglables dans Paramètres : VPS, CNSS (dont le taux de risques professionnels notifié par la CNSS), IS, minimum d&apos;IS, IS de l&apos;année précédente, patente, périodicité CNSS.</li>
          <li>Sources : {regles.sources.map((x, i) => <span key={x.url}>{i > 0 && " · "}<a href={x.url} target="_blank" rel="noreferrer">{x.titre}</a></span>)}</li>
        </ul>
      </section>
    </>
  );
}
