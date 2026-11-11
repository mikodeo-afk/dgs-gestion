"use client";
import { useActionState, useMemo, useRef, useState } from "react";
import { lireDossiers, lireRapports, RUBRIQUES, type Dossier } from "@/lib/raccordement";
import { reduirePhoto } from "@/lib/photo";
import {
  affecter, ajouterMembre, creerEquipe, enregistrerRapports, importerDossiers, lirePhotoDossiers, modifierEquipe,
  regulariser, relierRubrique, retirerMembre, rouvrir, signalerEchec, type ResultatRapport,
} from "./actions";

type Etat = { ok?: string; erreur?: string } | null;
type Option = { id: string; libelle: string };
function Retour({ etat }: { etat: Etat }) {
  if (etat?.erreur) return <p className="erreur">{etat.erreur}</p>;
  if (etat?.ok) return <p className="succes">{etat.ok}</p>;
  return null;
}
const libRub = (k: string) => {
  const [base, type] = k.split(":");
  const r = RUBRIQUES.find((x) => x.cle === base);
  return `${r?.libelle ?? base}${type ? ` ${type}` : ""}`;
};

// --- Rapport d'installation collé depuis WhatsApp ---------------------------
export function SaisieRapport({ equipes }: { equipes: Option[] }) {
  const [texte, setTexte] = useState("");
  const [equipe, setEquipe] = useState(equipes[0]?.id ?? "");
  const [resultats, setResultats] = useState<ResultatRapport[]>([]);
  const [enCours, setEnCours] = useState(false);
  const rapports = useMemo(() => (texte.trim() ? lireRapports(texte) : []), [texte]);

  // L'équipe nommée dans l'en-tête du message est choisie d'office.
  const nomLu = rapports[0]?.equipe;
  const equipeLue = nomLu ? equipes.find((e) => e.libelle.toLowerCase().includes(nomLu.toLowerCase())) : undefined;

  async function enregistrer() {
    setEnCours(true);
    const r = await enregistrerRapports(equipeLue?.id ?? equipe, rapports.filter((x) => x.ligne));
    setEnCours(false);
    setResultats(r);
    if (r.every((x) => x.ok)) setTexte("");
  }

  if (!equipes.length) return <p className="note">Vous ne faites partie d&apos;aucune équipe de raccordement : demandez au manager de vous y ajouter.</p>;
  return (
    <div>
      <div className="inline">
        <label>Équipe
          <select value={equipeLue?.id ?? equipe} onChange={(e) => setEquipe(e.target.value)} disabled={Boolean(equipeLue)}>
            {equipes.map((e) => <option key={e.id} value={e.id}>{e.libelle}</option>)}
          </select>
        </label>
      </div>
      <label style={{ display: "block" }}>Collez ici le ou les rapports reçus (message WhatsApp tel quel)
        <textarea value={texte} onChange={(e) => { setTexte(e.target.value); setResultats([]); }} rows={8} style={{ width: "100%", fontFamily: "monospace" }}
          placeholder={"*ÉQUIPE …/DGS*\nRACCORDEMENT du 07/11/2026\nClient: …\nLigne: …\nLinéaire : 250m\nPince : 10\n…"} />
      </label>
      {rapports.length > 0 && (
        <>
          <div className="tbl">
            <table>
              <thead><tr><th>Date</th><th>Ligne</th><th>Client</th><th>Matériel lu</th><th>À vérifier</th></tr></thead>
              <tbody>
                {rapports.map((r, i) => (
                  <tr key={i}>
                    <td>{r.date ? r.date.split("-").reverse().join("/") : "—"}</td>
                    <td className="code">{r.ligne || "—"}</td>
                    <td>{r.client}</td>
                    <td className="note">{Object.entries(r.materiel).map(([k, v]) => `${libRub(k === "cable" && r.cable ? `cable:${r.cable}` : k)} : ${v}`).join(" · ") || "aucun"}</td>
                    <td className="note">{r.alertes.join(" ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note">Le mot de passe de la box du client n&apos;est pas enregistré.</p>
          <button className="btn pri" type="button" onClick={enregistrer} disabled={enCours || !rapports.some((r) => r.ligne)}>
            {enCours ? "Enregistrement…" : `Enregistrer ${rapports.filter((r) => r.ligne).length} rapport(s)`}
          </button>
        </>
      )}
      {resultats.map((r, i) => (
        <p key={i} className={r.ok ? "succes" : "erreur"}>Ligne {r.ligne} : {r.ok ?? r.erreur}</p>
      ))}
    </div>
  );
}

// --- Import des dossiers (Excel ou photo) ---------------------------------------
export function ImportDossiers({ chantiers }: { chantiers: Option[] }) {
  const [chantier, setChantier] = useState(chantiers[0]?.id ?? "");
  const [dossiers, setDossiers] = useState<Dossier[]>([]);
  const [msg, setMsg] = useState<Etat>(null);
  const [etape, setEtape] = useState<"" | "lecture" | "import">("");
  const fichier = useRef<HTMLInputElement>(null);
  const photo = useRef<HTMLInputElement>(null);

  async function lireExcel(f: File) {
    setMsg(null); setDossiers([]);
    try {
      const { default: readXlsxFile } = await import("read-excel-file");
      const rows = await readXlsxFile(f);
      const { dossiers: d, sansEntetes } = lireDossiers(rows as unknown[][]);
      if (!d.length) throw new Error("Aucun dossier trouvé dans ce fichier.");
      setDossiers(d);
      if (sansEntetes) setMsg({ ok: "Pas d'en-têtes : colonnes lues dans l'ordre client, ligne, mobile, MSAN/FAT, GPS, date de demande, date d'affectation, offre. Vérifiez l'aperçu." });
    } catch (e) {
      setMsg({ erreur: e instanceof Error ? e.message : "Fichier illisible : enregistrez-le au format .xlsx." });
    } finally { if (fichier.current) fichier.current.value = ""; }
  }

  async function lireImage(f: File) {
    setMsg(null); setDossiers([]); setEtape("lecture");
    try {
      const r = await lirePhotoDossiers(await reduirePhoto(f, 2000));
      if (r.erreur || !r.dossiers) setMsg({ erreur: r.erreur ?? "Lecture impossible." });
      else setDossiers(r.dossiers);
    } catch { setMsg({ erreur: "Photo illisible." }); }
    finally { setEtape(""); if (photo.current) photo.current.value = ""; }
  }

  async function valider() {
    setEtape("import");
    const r = await importerDossiers(chantier, dossiers.filter((d) => d.ligne));
    setEtape("");
    setMsg(r);
    if (r?.ok) setDossiers([]);
  }

  const maj = (i: number, p: Partial<Dossier>) => setDossiers((ds) => ds.map((d, j) => (j === i ? { ...d, ...p } : d)));
  return (
    <div>
      <div className="inline">
        <label>Chantier de raccordement
          <select value={chantier} onChange={(e) => setChantier(e.target.value)}>
            {chantiers.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
          </select>
        </label>
        <label className="btn depot" style={{ alignSelf: "end", borderStyle: "dashed" }}>📄 Fichier Excel
          <input ref={fichier} type="file" accept=".xlsx" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) lireExcel(f); }} />
        </label>
        <label className="btn depot" style={{ alignSelf: "end", borderStyle: "dashed" }}>📷 {etape === "lecture" ? "Lecture…" : "Photo du tableau"}
          <input ref={photo} type="file" accept="image/*" hidden disabled={etape !== ""} onChange={(e) => { const f = e.target.files?.[0]; if (f) lireImage(f); }} />
        </label>
      </div>
      {dossiers.length > 0 && (
        <>
          <div className="tbl">
            <table>
              <thead><tr><th>Client</th><th>Ligne</th><th>Mobile</th><th>MSAN / FAT</th><th>GPS</th><th>Demande</th><th>Affectation</th><th>Offre</th></tr></thead>
              <tbody>
                {dossiers.map((d, i) => (
                  <tr key={i}>
                    <td><input value={d.client} onChange={(e) => maj(i, { client: e.target.value })} /></td>
                    <td><input value={d.ligne} size={11} onChange={(e) => maj(i, { ligne: e.target.value.replace(/\D/g, "") })} /></td>
                    <td>{d.mobile}</td><td>{d.msan}</td>
                    <td className="note">{d.latitude != null ? `${d.latitude.toFixed(5)}, ${d.longitude?.toFixed(5)}` : "—"}</td>
                    <td><input type="date" value={d.date_demande ?? ""} onChange={(e) => maj(i, { date_demande: e.target.value })} /></td>
                    <td><input type="date" value={d.date_affectation ?? ""} onChange={(e) => maj(i, { date_affectation: e.target.value })} /></td>
                    <td>{d.offre}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="statusline">
            <button className="btn pri" type="button" onClick={valider} disabled={etape !== "" || !chantier}>{etape === "import" ? "Import…" : `Importer ${dossiers.length} dossier(s)`}</button>
            <button className="btn" type="button" onClick={() => setDossiers([])}>Annuler</button>
          </div>
        </>
      )}
      <Retour etat={msg} />
    </div>
  );
}

// --- Liste des dossiers, affectation, échec --------------------------------------
export type LigneDossier = {
  id: string; client: string; ligne: string; mobile: string | null; msan: string | null; offre: string | null;
  latitude: number | null; longitude: number | null; date_demande: string | null; date_affectation: string | null;
  statut: string; equipe: string | null; realise_le: string | null; motif_echec: string | null; materiel: string; attente: number | null;
};
const dateFr = (d: string | null) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");
const TON: Record<string, string> = { "À affecter": "p-warn", Affecté: "p-info", Réalisé: "p-ok", Échec: "p-bad" };

export function TableDossiers({ dossiers, equipes, gere }: { dossiers: LigneDossier[]; equipes: Option[]; gere: boolean }) {
  const [coches, setCoches] = useState<Set<string>>(new Set());
  const [equipe, setEquipe] = useState(equipes[0]?.id ?? "");
  const [msg, setMsg] = useState<Etat>(null);
  const [echec, setEchec] = useState<string | null>(null);
  const [etatEchec, actionEchec] = useActionState(signalerEchec, null);
  const ouverts = dossiers.filter((d) => d.statut === "À affecter" || d.statut === "Affecté");
  const basculer = (id: string) => setCoches((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function lancer(eq: string) {
    const r = await affecter([...coches], eq);
    setMsg(r);
    if (r?.ok) setCoches(new Set());
  }
  return (
    <div>
      {gere && ouverts.length > 0 && (
        <div className="inline">
          <label>Affecter les dossiers cochés à
            <select value={equipe} onChange={(e) => setEquipe(e.target.value)}>
              {equipes.map((e) => <option key={e.id} value={e.id}>{e.libelle}</option>)}
            </select>
          </label>
          <button className="btn pri" type="button" style={{ alignSelf: "end" }} disabled={!coches.size || !equipe} onClick={() => lancer(equipe)}>Affecter ({coches.size})</button>
          <button className="btn" type="button" style={{ alignSelf: "end" }} disabled={!coches.size} onClick={() => lancer("")}>Retirer l&apos;affectation</button>
        </div>
      )}
      <Retour etat={msg} />
      <div className="tbl">
        <table>
          <thead><tr>{gere && <th></th>}<th>Client</th><th>Ligne</th><th>MSAN / FAT</th><th>Offre</th><th>Affecté le</th><th>Équipe</th><th>Statut</th><th>Matériel posé</th><th></th></tr></thead>
          <tbody>
            {dossiers.map((d) => (
              <tr key={d.id}>
                {gere && <td>{(d.statut === "À affecter" || d.statut === "Affecté") && <input type="checkbox" checked={coches.has(d.id)} onChange={() => basculer(d.id)} aria-label="Cocher" />}</td>}
                <td>{d.client}{d.mobile && <div className="note">{d.mobile}</div>}</td>
                <td className="code">{d.ligne}</td>
                <td>{d.msan ?? "—"}{d.latitude != null && (
                  <div><a className="note" href={`https://www.google.com/maps?q=${d.latitude},${d.longitude}`} target="_blank" rel="noreferrer">📍 carte</a></div>
                )}</td>
                <td className="note">{d.offre ?? "—"}</td>
                <td>{dateFr(d.date_affectation)}{d.attente != null && <div className={d.attente > 2 ? "neg" : "note"}>{d.attente === 0 ? "aujourd'hui" : `${d.attente} j d'attente`}</div>}</td>
                <td>{d.equipe ?? "—"}</td>
                <td><span className={`pill ${TON[d.statut] ?? "p-info"}`}>{d.statut}</span>
                  {d.realise_le && <div className="note">le {dateFr(d.realise_le)}</div>}
                  {d.motif_echec && <div className="note">{d.motif_echec}</div>}</td>
                <td className="note">{d.materiel || "—"}</td>
                <td>
                  {(d.statut === "Affecté" || d.statut === "À affecter") && (
                    echec === d.id ? (
                      <form action={actionEchec} className="inline">
                        <input type="hidden" name="id" value={d.id} />
                        <input name="motif" required placeholder="Motif (client absent…)" />
                        <button className="btn" type="submit">Valider</button>
                      </form>
                    ) : <button className="btn" type="button" onClick={() => setEchec(d.id)}>Échec</button>
                  )}
                  {gere && d.statut === "Échec" && <button className="btn" type="button" onClick={async () => setMsg(await rouvrir(d.id))}>Rouvrir</button>}
                </td>
              </tr>
            ))}
            {!dossiers.length && <tr><td colSpan={10} className="note">Aucun dossier.</td></tr>}
          </tbody>
        </table>
      </div>
      <Retour etat={etatEchec} />
    </div>
  );
}

// --- Équipes ------------------------------------------------------------------------
export type LigneEquipe = { id: string; nom: string; chef_id: string; chantier_id: string; actif: boolean; membres: Option[] };

export function FormEquipe({ personnes, chantiers }: { personnes: Option[]; chantiers: Option[] }) {
  const [etat, action, enCours] = useActionState(creerEquipe, null);
  return (
    <form className="inline" action={action}>
      <label>Nom<input name="nom" required placeholder="ex. Équipe Eugène" /></label>
      <label>Chef d&apos;équipe (détient le matériel)
        <select name="chef_id" required>{personnes.map((p) => <option key={p.id} value={p.id}>{p.libelle}</option>)}</select>
      </label>
      <label>Chantier<select name="chantier_id" required>{chantiers.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}</select></label>
      <button className="btn pri" style={{ alignSelf: "end" }} disabled={enCours}>Créer l&apos;équipe</button>
      <Retour etat={etat} />
    </form>
  );
}

export function FicheEquipe({ e, personnes, chantiers }: { e: LigneEquipe; personnes: Option[]; chantiers: Option[] }) {
  const [etat, action, enCours] = useActionState(modifierEquipe, null);
  const [etatM, actionM] = useActionState(ajouterMembre, null);
  const [msg, setMsg] = useState<Etat>(null);
  return (
    <div style={{ borderTop: "1px solid var(--ligne, #e5e5e5)", paddingTop: 10, marginTop: 10 }}>
      <form className="inline" action={action}>
        <input type="hidden" name="id" value={e.id} />
        <label>Nom<input name="nom" defaultValue={e.nom} required /></label>
        <label>Chef d&apos;équipe<select name="chef_id" defaultValue={e.chef_id}>{personnes.map((p) => <option key={p.id} value={p.id}>{p.libelle}</option>)}</select></label>
        <label>Chantier<select name="chantier_id" defaultValue={e.chantier_id}>{chantiers.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}</select></label>
        <label style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "end" }}><input type="checkbox" name="actif" defaultChecked={e.actif} /> Active</label>
        <button className="btn" style={{ alignSelf: "end" }} disabled={enCours}>Enregistrer</button>
      </form>
      <Retour etat={etat} />
      <p>Membres : {e.membres.length ? e.membres.map((m) => (
        <span key={m.id} className="pill p-info" style={{ marginRight: 6 }}>{m.libelle}{" "}
          <button type="button" className="lien" aria-label={`Retirer ${m.libelle}`} onClick={async () => setMsg(await retirerMembre(e.id, m.id))}>×</button>
        </span>
      )) : <span className="note">aucun (le chef peut saisir seul)</span>}</p>
      <form className="inline" action={actionM}>
        <input type="hidden" name="equipe_id" value={e.id} />
        <label>Ajouter un membre<select name="profil_id">{personnes.filter((p) => p.id !== e.chef_id && !e.membres.some((m) => m.id === p.id)).map((p) => <option key={p.id} value={p.id}>{p.libelle}</option>)}</select></label>
        <button className="btn" style={{ alignSelf: "end" }}>Ajouter</button>
      </form>
      <Retour etat={etatM} /><Retour etat={msg} />
    </div>
  );
}

// --- Correspondance rubrique → article ------------------------------------------------
export function Correspondance({ liens, articles, typesCable }: { liens: Record<string, string>; articles: Option[]; typesCable: string[] }) {
  const [msg, setMsg] = useState<Etat>(null);
  const [nouveauType, setNouveauType] = useState("");
  const rubriques = [
    ...typesCable.map((t) => `cable:${t}`), "cable",
    ...RUBRIQUES.filter((r) => r.cle !== "cable").map((r) => r.cle),
  ];
  return (
    <div>
      <div className="tbl">
        <table>
          <thead><tr><th>Rubrique du rapport</th><th>Article du stock déduit</th></tr></thead>
          <tbody>
            {rubriques.map((k) => (
              <tr key={k}>
                <td>{k === "cable" ? "Câble (tout autre type)" : libRub(k)}</td>
                <td>
                  <select defaultValue={liens[k] ?? ""} onChange={async (e) => setMsg(await relierRubrique(k, e.target.value))}>
                    <option value="">— non suivi —</option>
                    {articles.map((a) => <option key={a.id} value={a.id}>{a.libelle}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="inline">
        <label>Autre type de câble<input value={nouveauType} onChange={(e) => setNouveauType(e.target.value.toUpperCase())} placeholder="ex. DROP 2FO" /></label>
        <label>Article
          <select defaultValue="" onChange={async (e) => { if (nouveauType && e.target.value) { setMsg(await relierRubrique(`cable:${nouveauType.trim()}`, e.target.value)); setNouveauType(""); } }}>
            <option value="">—</option>
            {articles.map((a) => <option key={a.id} value={a.id}>{a.libelle}</option>)}
          </select>
        </label>
      </div>
      <Retour etat={msg} />
    </div>
  );
}

// --- Consommations à régulariser ---------------------------------------------------------
export function BoutonsRegulariser({ id }: { id: string }) {
  const [msg, setMsg] = useState<Etat>(null);
  return (
    <>
      <button className="btn" type="button" onClick={async () => setMsg(await regulariser(id, false))}>Déduire maintenant</button>{" "}
      <button className="btn" type="button" onClick={async () => setMsg(await regulariser(id, true))}>Ignorer</button>
      <Retour etat={msg} />
    </>
  );
}
