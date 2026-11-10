import Link from "next/link";
import { exigerSession } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { aujourdhui, dateFr, fcfa, heureFr } from "@/lib/format";
import { POSTES, type Profil } from "@/lib/types";
import { Kpi, Pastille } from "@/components/ui";
import { FormPaie, FormPresences } from "./Formulaires";
import { ControlePointage, PhotoReference } from "./Pointages";
import { avancerPaie, ouvrirPaie } from "./actions";

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const libMois = (m: string) => `${MOIS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const decaler = (m: string, k: number) => {
  const d = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + k, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
function joursOuvres(mois: string, jusqua: string) {
  const [a, m] = mois.split("-").map(Number);
  const out: string[] = [];
  for (let d = 1; d <= 31; d++) {
    const dt = new Date(Date.UTC(a, m - 1, d));
    if (dt.getUTCMonth() !== m - 1) break;
    const iso = dt.toISOString().slice(0, 10);
    if (iso > jusqua) break;
    if (![0, 6].includes(dt.getUTCDay())) out.push(iso);
  }
  return out;
}
function equipe(id: string, tous: Profil[]) {
  const n1 = tous.filter((p) => p.responsable_id === id).map((p) => p.id);
  const n2 = tous.filter((p) => p.responsable_id && n1.includes(p.responsable_id)).map((p) => p.id);
  return new Set([id, ...n1, ...n2]);
}
type Bulletin = { profil_id: string; nom: string; poste: keyof typeof POSTES; base: number; primes: number; absences: number; retenue_absences: number; brut: number; inps: number; avances: number; net: number };

export default async function RH({ searchParams }: { searchParams: Promise<{ onglet?: string; jour?: string; mois?: string }> }) {
  const s = await exigerSession();
  const sp = await searchParams;
  const auj = aujourdhui();
  const voitPaie = ["paie.voir", "paie.preparer", "paie.valider", "paie.payer"].some((d) => s.peut(d));
  const onglets: [string, string][] = [["presences", "Présences"], ["paie", voitPaie ? "Paie" : "Mon bulletin"]];
  if (s.peut("sal.voir")) onglets.push(["contrats", "Contrats et congés"]);
  const onglet = onglets.some((o) => o[0] === sp.onglet) ? sp.onglet! : "presences";
  const supabase = await supabaseServeur();
  const { data: profils } = await supabase.from("profils").select("*").eq("actif", true).order("nom");
  const tous = (profils ?? []) as Profil[];
  const visibles = s.global ? tous : tous.filter((p) => equipe(s.profil.id, tous).has(p.id));
  let contenu: React.ReactNode = null;

  if (onglet === "presences") {
    const mois = /^\d{4}-\d{2}$/.test(sp.mois ?? "") ? sp.mois! : auj.slice(0, 7);
    const jour = s.global && /^\d{4}-\d{2}-\d{2}$/.test(sp.jour ?? "") ? sp.jour! : auj;
    const jours = joursOuvres(mois, mois === auj.slice(0, 7) ? auj : `${mois}-31`);
    const { data: pres } = await supabase.from("presences").select("*").gte("jour", `${mois}-01`).lte("jour", jours.at(-1) ?? `${mois}-01`);
    const { data: presJour } = await supabase.from("presences").select("*").eq("jour", jour);
    const carte = new Map((pres ?? []).map((p) => [`${p.profil_id}|${p.jour}`, p.statut]));
    const duJour = new Map((presJour ?? []).map((p) => [p.profil_id, p]));
    const saisissables = s.peut("pres.saisir") ? visibles : [];
    // Pointages par téléphone du jour, avec selfie et photo de référence (RH et direction).
    const controleur = s.global && s.peut("pres.saisir");
    const pointes = controleur ? (presJour ?? []).filter((p) => p.photo_chemin) : [];
    const chemins = [...pointes.map((p) => p.photo_chemin as string), ...tous.map((p) => p.photo_reference).filter((x): x is string => !!x)];
    const liens = new Map<string, string>();
    if (chemins.length) {
      const { data: urls } = await supabase.storage.from("pointages").createSignedUrls(chemins, 900);
      for (const u of urls ?? []) if (u.path && u.signedUrl) liens.set(u.path, u.signedUrl);
    }
    const { data: chs } = pointes.length ? await supabase.from("chantiers").select("id,code").in("id", pointes.map((p) => p.chantier_id)) : { data: [] };
    const codes = new Map((chs ?? []).map((c) => [c.id, c.code]));
    const parId = new Map(tous.map((p) => [p.id, p]));
    contenu = (
      <>
        {saisissables.length > 0 && (
          <section className="panel">
            <div className="head">
              <h2>Présences du {dateFr(jour)}</h2>
              {s.global && (
                <form className="ligne" method="get">
                  <input type="hidden" name="onglet" value="presences" />
                  <input type="date" name="jour" defaultValue={jour} max={auj} aria-label="Jour" />
                  <button className="btn sm" type="submit">Changer de jour</button>
                </form>
              )}
            </div>
            <p className="note">{s.global ? "Vous pouvez saisir ou corriger n'importe quel jour." : "Vous saisissez la présence de votre équipe pour aujourd'hui."} Les absences (A) non justifiées sont retenues sur la paie ; les congés (C) ne le sont pas.</p>
            <FormPresences
              key={jour}
              jour={jour}
              agents={saisissables.map((a) => {
                const p = duJour.get(a.id);
                return { id: a.id, nom: a.nom, poste: POSTES[a.poste].court, statut: p?.statut ?? "", pointage: p?.heure_arrivee ? `${heureFr(p.heure_arrivee)}${p.score_visage ? ` · visage ${p.score_visage} %` : ""}` : "" };
              })}
            />
          </section>
        )}
        {controleur && (
          <section className="panel">
            <h2>Pointages par téléphone du {dateFr(jour)}</h2>
            <p className="note">Comparez chaque selfie à la photo de référence de l&apos;agent. Un pointage rejeté le rend absent ce jour-là (retenue sur la paie).</p>
            {pointes.length === 0 ? <p className="note">Aucun pointage par téléphone ce jour.</p> : (
              <div className="tbl">
                <table>
                  <thead><tr><th>Agent</th><th>Photos</th><th>Arrivée</th><th>Contrôle</th></tr></thead>
                  <tbody>
                    {pointes.map((p) => {
                      const a = parId.get(p.profil_id);
                      const ref = a?.photo_reference ? liens.get(a.photo_reference) : undefined;
                      const selfie = liens.get(p.photo_chemin);
                      return (
                        <tr key={p.profil_id}>
                          <td><b>{a?.nom ?? "—"}</b><br /><span className="note">{a ? POSTES[a.poste].court : ""}</span></td>
                          <td>
                            <div className="selfies">
                              <figure>{selfie ? <a href={selfie} target="_blank" rel="noopener"><img src={selfie} alt={`Selfie de ${a?.nom}`} /></a> : <span className="vide">Selfie indisponible</span>}Selfie</figure>
                              <figure>{ref ? <img src={ref} alt={`Photo de référence de ${a?.nom}`} /> : <span className="vide">Pas de photo de référence</span>}Référence</figure>
                            </div>
                          </td>
                          <td>{heureFr(p.heure_arrivee)} · {codes.get(p.chantier_id) ?? "—"}<br /><span className="note">à {p.distance_m} m du site{p.precision_m ? ` (GPS ± ${p.precision_m} m)` : ""}</span></td>
                          <td>
                            {p.controle === "À contrôler"
                              ? <ControlePointage profilId={p.profil_id} nom={a?.nom ?? ""} jour={jour} />
                              : <><Pastille texte={p.controle} ton={p.controle === "Conforme" ? "ok" : "bad"} />{p.motif_rejet && <span className="note"> {p.motif_rejet}</span>}</>}
                            {a && !a.photo_reference && <div style={{ marginTop: 6 }}><PhotoReference profilId={a.id} nom={a.nom} pays={s.pays.code} existe={false} /></div>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <details style={{ marginTop: 10 }}>
              <summary>Photos de référence du personnel ({tous.filter((p) => p.photo_reference).length}/{tous.length})</summary>
              <div className="tbl">
                <table>
                  <tbody>
                    {tous.map((a) => (
                      <tr key={a.id}>
                        <td>{a.nom}<br /><span className="note">{POSTES[a.poste].court}</span></td>
                        <td><div className="selfies"><figure>{a.photo_reference && liens.get(a.photo_reference) ? <img src={liens.get(a.photo_reference)} alt={`Photo de référence de ${a.nom}`} /> : <span className="vide">Aucune</span>}</figure></div></td>
                        <td><PhotoReference profilId={a.id} nom={a.nom} pays={s.pays.code} existe={!!a.photo_reference} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>
        )}
        <section className="panel">
          <div className="head">
            <h2>Présences de {libMois(mois)}</h2>
            <span className="statusline">
              <Link className="btn sm" href={`/rh?onglet=presences&mois=${decaler(mois, -1)}`}>←</Link>
              <Link className="btn sm" href={`/rh?onglet=presences&mois=${decaler(mois, 1)}`}>→</Link>
            </span>
          </div>
          <div className="tbl">
            <table className="pres">
              <thead><tr><th>Agent</th>{jours.map((d) => <th key={d} className={d === auj ? "today" : ""}>{Number(d.slice(8))}</th>)}<th className="num">Abs.</th></tr></thead>
              <tbody>
                {(s.global || s.peut("pres.saisir") ? visibles : [s.profil]).map((u) => (
                  <tr key={u.id}>
                    <td>{u.nom}</td>
                    {jours.map((d) => {
                      const v = carte.get(`${u.id}|${d}`) ?? "";
                      return <td key={d}><span className={`cell ${v}`} aria-disabled="true">{v || "·"}</span></td>;
                    })}
                    <td className="num">{jours.filter((d) => carte.get(`${u.id}|${d}`) === "A").length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </>
    );
  }

  if (onglet === "paie") {
    const mois = /^\d{4}-\d{2}$/.test(sp.mois ?? "") ? sp.mois! : auj.slice(0, 7);
    const [{ data: paie }, { data: b }] = await Promise.all([
      supabase.from("paies").select("*").eq("mois", `${mois}-01`).maybeSingle(),
      supabase.rpc("bulletins", { p_mois: `${mois}-01` }),
    ]);
    const bulletins = ((b ?? []) as Bulletin[]).map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, ["profil_id", "nom", "poste"].includes(k) ? v : Number(v)])) as Bulletin);
    const statut = paie?.statut ?? "Non ouverte";
    const edite = s.peut("paie.preparer") && statut === "En préparation";
    const T = bulletins.reduce((a, x) => ({ brut: a.brut + x.brut, net: a.net + x.net, inps: a.inps + x.inps }), { brut: 0, net: 0, inps: 0 });
    const etape = (cible: string, libelle: string, pri = true) => (
      <form action={avancerPaie}>
        <input type="hidden" name="mois" value={mois} /><input type="hidden" name="statut" value={cible} /><input type="hidden" name="libelle" value={libMois(mois)} />
        <button className={`btn ${pri ? "pri" : ""}`} type="submit">{libelle}</button>
      </form>
    );
    const nav = (
      <div className="statusline">
        <Link className="btn sm" href={`/rh?onglet=paie&mois=${decaler(mois, -1)}`}>← {libMois(decaler(mois, -1))}</Link>
        <b>{libMois(mois)}</b>
        <Link className="btn sm" href={`/rh?onglet=paie&mois=${decaler(mois, 1)}`}>{libMois(decaler(mois, 1))} →</Link>
        <Pastille texte={statut} ton={statut === "Payée" || statut === "Validée" ? "ok" : statut === "Soumise" ? "warn" : "info"} />
        {!paie && s.peut("paie.preparer") && <form action={ouvrirPaie}><input type="hidden" name="mois" value={mois} /><button className="btn pri" type="submit">Ouvrir la paie du mois</button></form>}
        {statut === "En préparation" && s.peut("paie.preparer") && etape("Soumise", "Soumettre pour validation")}
        {statut === "Soumise" && s.peut("paie.valider") && <>{etape("Validée", "Valider la paie")}{etape("En préparation", "Renvoyer aux RH", false)}</>}
        {statut === "Validée" && s.peut("paie.payer") && etape("Payée", "Marquer les salaires payés")}
      </div>
    );
    if (!voitPaie) {
      const x = bulletins[0];
      contenu = (
        <>
          {nav}
          <section className="panel">
            <h2>Mon bulletin de {libMois(mois)}</h2>
            {x ? (
              <div className="tbl"><table><tbody>
                <tr><td>Salaire de base</td><td className="num">{fcfa(x.base)}</td></tr>
                <tr><td>Primes</td><td className="num">{fcfa(x.primes)}</td></tr>
                <tr><td>Retenue absences ({x.absences} j)</td><td className="num">−{fcfa(x.retenue_absences)}</td></tr>
                <tr><td>Retenue INPS</td><td className="num">−{fcfa(x.inps)}</td></tr>
                <tr><td>Avances sur salaire</td><td className="num">−{fcfa(x.avances)}</td></tr>
              </tbody><tfoot><tr><td>Net à payer</td><td className="num">{fcfa(x.net)} FCFA</td></tr></tfoot></table></div>
            ) : <p className="note">Aucun salaire enregistré pour vous. Contactez le service RH.</p>}
          </section>
        </>
      );
    } else {
      const tableau = (
        <div className="tbl">
          <table>
            <thead><tr><th>Agent</th><th className="num">Base</th><th className="num">Primes</th><th className="num">Absences</th><th className="num">INPS</th><th className="num">Avances</th><th className="num">Net</th></tr></thead>
            <tbody>
              {bulletins.map((x) => (
                <tr key={x.profil_id}>
                  <td>{x.nom}<br /><span className="note">{POSTES[x.poste].court}</span></td>
                  <td className="num">{fcfa(x.base)}</td>
                  <td className="num">{edite ? <input type="number" min="0" step="1000" name={`primes_${x.profil_id}`} defaultValue={x.primes} aria-label={`Primes ${x.nom}`} style={{ width: 110 }} /> : fcfa(x.primes)}</td>
                  <td className="num">{x.absences ? `${x.absences} j · −${fcfa(x.retenue_absences)}` : "—"}</td>
                  <td className="num">−{fcfa(x.inps)}</td>
                  <td className="num">{edite ? <input type="number" min="0" step="1000" name={`avances_${x.profil_id}`} defaultValue={x.avances} aria-label={`Avances ${x.nom}`} style={{ width: 110 }} /> : x.avances ? `−${fcfa(x.avances)}` : "—"}</td>
                  <td className="num"><b>{fcfa(x.net)}</b></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td>Total</td><td colSpan={5} /><td className="num">{fcfa(T.net)}</td></tr></tfoot>
          </table>
        </div>
      );
      contenu = (
        <>
          {nav}
          <div className="kpis">
            <Kpi libelle="Masse brute" valeur={fcfa(T.brut)} unite="FCFA" />
            <Kpi libelle="Net à verser" valeur={fcfa(T.net)} unite="FCFA" />
            <Kpi libelle="Retenues INPS" valeur={fcfa(T.inps)} unite="FCFA" />
          </div>
          <section className="panel">
            <p className="note">Circuit : les RH préparent (primes, avances), le RAF, le PDG ou le DO valide, le comptable paie. Absences : salaire ÷ 22 par jour d&apos;absence non justifiée. INPS salarié 3,6 % (taux à confirmer) ; l&apos;impôt sur salaire (ITS) sera ajouté selon le barème malien.</p>
            {edite ? <FormPaie mois={mois} lignes={bulletins.map((x) => ({ id: x.profil_id, primes: x.primes, avances: x.avances }))}>{tableau}</FormPaie> : tableau}
          </section>
        </>
      );
    }
  }

  if (onglet === "contrats") {
    const dans60 = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
    const moisDepuis = (d: string) => { const [a, m] = d.split("-").map(Number); const [A, M] = auj.split("-").map(Number); return Math.max(0, (A - a) * 12 + (M - m)); };
    const bientot = tous.filter((u) => u.date_fin && u.date_fin >= auj && u.date_fin <= dans60);
    contenu = (
      <>
        <div className="kpis">
          <Kpi libelle="Contrats à renouveler (60 j)" valeur={bientot.length} ton={bientot.length ? "hl" : undefined} />
          <Kpi libelle="CDD et stages" valeur={tous.filter((u) => ["CDD", "Stage"].includes(u.contrat)).length} />
        </div>
        <section className="panel">
          <p className="note">Congés acquis : 2,5 jours par mois travaillé.</p>
          <div className="tbl">
            <table>
              <thead><tr><th>Agent</th><th>Contrat</th><th className="num">Embauche</th><th className="num">Fin</th><th className="num">Congés acquis</th></tr></thead>
              <tbody>
                {tous.map((u) => (
                  <tr key={u.id}>
                    <td>{u.nom}<br /><span className="note">{POSTES[u.poste].court}</span></td>
                    <td>{u.contrat}</td>
                    <td className="num">{dateFr(u.date_embauche)}</td>
                    <td className="num">{dateFr(u.date_fin)}{bientot.includes(u) && <><br /><Pastille texte="Fin dans moins de 60 j" ton="warn" /></>}</td>
                    <td className="num">{u.contrat === "Mandataire" ? "—" : `${(moisDepuis(u.date_embauche) * 2.5).toFixed(1).replace(".", ",")} j`}</td>
                  </tr>
                ))}
              </tbody>
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
          <h1>{s.profil.poste === "tech" ? "Mon espace RH" : "Ressources humaines"}</h1>
          <p className="sub">Présences, paie et contrats du personnel de DGS {s.pays.nom}.</p>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {onglets.map(([k, l]) => <Link key={k} href={`/rh?onglet=${k}`} role="tab" aria-selected={k === onglet}>{l}</Link>)}
      </div>
      {contenu}
    </>
  );
}
