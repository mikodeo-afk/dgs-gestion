import Link from "next/link";
import { redirect } from "next/navigation";
import { exigerSession } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { aujourdhui, dateFr, fcfa } from "@/lib/format";
import { Pastille, Verrou } from "@/components/ui";
import { reglesDuPays } from "@/lib/fiscal/donnees";
import { chargerEtats } from "@/lib/fiscal/etats-donnees";
import type { Poste } from "@/lib/fiscal/etats";
import type { Identite } from "@/lib/types";
import Imprimer from "../../finances/facture/[id]/Imprimer";
import { arreterEtats, rouvrirEtats } from "./actions";
import { BoutonNotes, FormSaisies } from "./Formulaires";

// La rédaction des notes annexes par l'agent IA peut prendre plusieurs minutes.
export const maxDuration = 300;

const m = (n: number | undefined) => (n === undefined ? "" : n === 0 ? "—" : fcfa(n));

function Tableau({ titre, lignes, n1 }: { titre: string; lignes: Poste[]; n1: boolean }) {
  return (
    <div className="tbl">
      <table className="etat">
        <thead><tr><th>Réf.</th><th>{titre}</th><th className="num">Exercice N</th>{n1 && <th className="num">Exercice N-1</th>}</tr></thead>
        <tbody>
          {lignes.map((l) => (
            <tr key={l.ref} className={l.total ? "tot" : undefined}>
              <td>{l.ref}</td>
              <td>{l.libelle}{l.note && !l.total && <span className="note noprint"> · {l.note}</span>}</td>
              <td className="num">{m(l.n)}</td>
              {n1 && <td className="num">{m(l.n1)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function EtatsFinanciers({ searchParams }: { searchParams: Promise<{ annee?: string }> }) {
  const s = await exigerSession();
  if (!s.peut("fisc.voir") && !s.peut("fisc.declarer")) redirect("/");
  const auj = aujourdhui();
  const sp = await searchParams;
  const defaut = Number(auj.slice(5, 7)) <= 4 ? Number(auj.slice(0, 4)) - 1 : Number(auj.slice(0, 4));
  const annee = /^\d{4}$/.test(sp.annee ?? "") ? Number(sp.annee) : defaut;

  if (!reglesDuPays(s.pays.code))
    return (
      <>
        <div className="head"><div><h1>États financiers · {s.pays.nom}</h1></div></div>
        <Verrou titre={`Règles de ${s.pays.nom} pas encore configurées`}>Les états financiers sont prêts pour le Bénin ; {s.pays.nom} suivra.</Verrou>
      </>
    );

  const supabase = await supabaseServeur();
  const [{ etats, cloture, premierExercice }, { data: ident }] = await Promise.all([
    chargerEtats(s.pays.code, annee),
    supabase.from("pays").select("*").eq("code", s.pays.code).maybeSingle(),
  ]);
  const e = (ident ?? {}) as Partial<Identite>;
  const arrete = cloture?.statut === "Arrêté";
  const peut = s.peut("fisc.declarer");
  const n1 = etats.actif.some((x) => x.n1 !== undefined);
  const enCours = annee >= Number(auj.slice(0, 4));
  const resultat = etats.compteResultat.find((x) => x.ref === "XI")?.n ?? 0;

  return (
    <>
      <div className="head noprint">
        <div>
          <h1>États financiers {annee} · {s.pays.nom}</h1>
          <p className="sub">
            Bilan, compte de résultat, tableau des flux de trésorerie et notes annexes au format SYSCOHADA révisé (système normal),
            établis à partir des données de l&apos;application. <Link href="/fiscalite">← Agent comptable</Link>
          </p>
        </div>
        <div className="statusline">
          <Link className="btn sm" href={`/fiscalite/etats?annee=${annee - 1}`}>← {annee - 1}</Link>
          <Link className="btn sm" href={`/fiscalite/etats?annee=${annee + 1}`}>{annee + 1} →</Link>
          <Imprimer />
        </div>
      </div>

      <section className="panel noprint">
        <div className="statusline" style={{ justifyContent: "space-between" }}>
          <div className="statusline">
            <Pastille texte={arrete ? `Arrêtés le ${dateFr(cloture?.arrete_le)}` : enCours ? "Exercice en cours : provisoire" : "Brouillon"} ton={arrete ? "ok" : "warn"} />
            <span className="note">Résultat net {resultat >= 0 ? "bénéficiaire" : "déficitaire"} : <b>{fcfa(resultat)} FCFA</b></span>
            {Math.abs(etats.ecart) >= 1 && <Pastille texte={`Bilan déséquilibré de ${fcfa(etats.ecart)} FCFA`} ton="bad" />}
          </div>
          {peut && (arrete ? (
            <form action={rouvrirEtats}><input type="hidden" name="annee" value={annee} /><button className="btn sm" type="submit">Rouvrir pour modifier</button></form>
          ) : (
            <form action={arreterEtats}><input type="hidden" name="annee" value={annee} />
              <button className="btn sm ok" type="submit" disabled={Math.abs(etats.ecart) >= 1} title={Math.abs(etats.ecart) >= 1 ? "Le bilan doit être équilibré" : undefined}>Arrêter les états {annee}</button>
            </form>
          ))}
        </div>
        <p className="note">
          Ces états sont un projet établi par l&apos;application. Pour être valables, ils doivent être arrêtés par la gérance, visés par un expert-comptable
          inscrit à l&apos;Ordre, puis déposés sur e-services impots.bj avec la déclaration de résultat au plus tard le 30 avril {annee + 1}.
        </p>
      </section>

      <section className="panel noprint">
        <h2>Contrôles de l&apos;agent</h2>
        <ul className="alertes">{etats.controles.map((c, i) => <li key={i}>{c}</li>)}</ul>
      </section>

      <section className="panel noprint">
        <h2>Données de clôture</h2>
        <p className="note">
          Ce que l&apos;application ne suit pas. Le reste vient automatiquement des factures, dépenses, frais généraux, paie, stock et matériel.
          {arrete && " Les états sont arrêtés : rouvrez-les pour modifier."}
        </p>
        <FormSaisies annee={annee} saisies={cloture?.saisies ?? {}} verrouille={arrete || !peut} premier={premierExercice} />
      </section>

      <article className="etats">
        <header className="r1">
          <b>{e.raison_sociale ?? "D General Solutions"}</b>
          <span>{[e.adresse, e.rccm && `RCCM ${e.rccm}`, e.ifu && `IFU ${e.ifu}`].filter(Boolean).join(" · ")}</span>
          <span>Exercice du 01/01/{annee} au 31/12/{annee} · durée 12 mois · montants en FCFA · référentiel SYSCOHADA révisé, système normal</span>
          {!arrete && <span className="note">Projet non arrêté</span>}
        </header>

        <h2>Bilan au 31 décembre {annee}</h2>
        <div className="tbl">
          <table className="etat">
            <thead><tr><th>Réf.</th><th>Actif</th><th className="num">Brut</th><th className="num">Amort. et dépréc.</th><th className="num">Net N</th>{n1 && <th className="num">Net N-1</th>}</tr></thead>
            <tbody>
              {etats.actif.map((l) => (
                <tr key={l.ref} className={l.total ? "tot" : undefined}>
                  <td>{l.ref}</td><td>{l.libelle}</td>
                  <td className="num">{m(l.brut)}</td><td className="num">{m(l.amort)}</td><td className="num">{m(l.net)}</td>
                  {n1 && <td className="num">{m(l.n1)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Tableau titre="Passif" lignes={etats.passif} n1={n1} />

        <h2>Compte de résultat de l&apos;exercice {annee}</h2>
        <Tableau titre="Libellés (produits +, charges −)" lignes={etats.compteResultat} n1={n1} />

        <h2>Tableau des flux de trésorerie {annee}</h2>
        <Tableau titre="Libellés" lignes={etats.tft} n1={n1} />

        <h2>Notes annexes</h2>
        {cloture?.notes ? (
          <>
            <p className="note noprint">Rédigées par l&apos;agent IA le {dateFr(cloture.notes.redige_le)} : à relire et compléter.</p>
            {cloture.notes.notes.map((n) => (
              <section key={n.numero} className="note-annexe">
                <h3>Note {n.numero} · {n.titre}</h3>
                <p>{n.texte}</p>
              </section>
            ))}
            {cloture.notes.points_de_vigilance.length > 0 && (
              <div className="noprint">
                <h3>Points de vigilance de l&apos;agent</h3>
                <ul className="alertes">{cloture.notes.points_de_vigilance.map((p, i) => <li key={i}>{p}</li>)}</ul>
              </div>
            )}
          </>
        ) : <p className="note">Pas encore rédigées.</p>}
        {peut && !arrete && <div className="noprint"><BoutonNotes annee={annee} deja={!!cloture?.notes} active={Boolean(process.env.ANTHROPIC_API_KEY)} /></div>}
      </article>
    </>
  );
}
