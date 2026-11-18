"use client";
import { useActionState, useRef, useState, useTransition } from "react";
import { fcfa } from "@/lib/format";
import { lireExtraction, type LigneExtraction, type Offre } from "@/lib/pvt";
import {
  attribuerVente, basculerVendeur, creerCompteVendeur, creerVendeur, declarerVente, enregistrerVersement, importerExtraction,
  majContrat, majEtatLigne, majMois, majOffre, rejeterNonValidees, supprimerVente, supprimerVersement, verserAvances, type Etat,
} from "./actions";

type Option = { id: string; nom: string };

function Retour({ etat }: { etat: Etat }) {
  if (etat?.erreur) return <p className="erreur" style={{ gridColumn: "1/-1" }}>{etat.erreur}</p>;
  if (etat?.ok) return <p className="succes" style={{ gridColumn: "1/-1" }}>{etat.ok}</p>;
  return null;
}

/** Bouton qui lance une action serveur et affiche son retour. */
function Bouton({ action, texte, classe = "btn sm", confirmer }: { action: () => Promise<Etat>; texte: string; classe?: string; confirmer?: string }) {
  const [etat, setEtat] = useState<Etat>(null);
  const [enCours, demarrer] = useTransition();
  return (
    <>
      <button type="button" className={classe} disabled={enCours}
        onClick={() => { if (confirmer && !window.confirm(confirmer)) return; demarrer(async () => setEtat(await action())); }}>{texte}</button>
      {etat?.erreur && <span className="erreur"> {etat.erreur}</span>}
    </>
  );
}

const optionsOffres = (offres: Offre[]) => (["B2C", "B2B"] as const).map((seg) => (
  <optgroup key={seg} label={seg}>
    {offres.filter((o) => o.segment === seg && o.actif).map((o) => <option key={o.id} value={o.id}>{o.libelle} · {fcfa(o.part_vendeur)} vendeur</option>)}
  </optgroup>
));

// --- Ventes ----------------------------------------------------------------------------
export function FormVente({ vendeurs, offres, estVendeur, defaut }: { vendeurs: Option[]; offres: Offre[]; estVendeur: boolean; defaut: string }) {
  const [etat, action, enCours] = useActionState(declarerVente, null);
  return (
    <form className="inline" action={action}>
      {!estVendeur && <label>Vendeur<select name="vendeur_id" required>{vendeurs.map((v) => <option key={v.id} value={v.id}>{v.nom}</option>)}</select></label>}
      <label>Date de la vente<input name="date_vente" type="date" required defaultValue={defaut} /></label>
      <label>Offre<select name="offre_id" required>{optionsOffres(offres)}</select></label>
      <label>Client<input name="client" placeholder="Nom du client" /></label>
      <label>Ligne / n° client<input name="ligne" inputMode="numeric" placeholder="ex. 0197000000" /></label>
      <label>Contact<input name="contact" inputMode="tel" /></label>
      <button className="btn pri" type="submit" disabled={enCours}>Déclarer la vente</button>
      <Retour etat={etat} />
    </form>
  );
}

export function SupprimerVente({ id }: { id: string }) {
  return <Bouton action={() => supprimerVente(id)} texte="Supprimer" classe="btn sm bad" confirmer="Supprimer cette vente déclarée ?" />;
}

export function EtatLigne({ id, etat }: { id: string; etat: string | null }) {
  const [valeur, setValeur] = useState(etat ?? "");
  const [msg, setMsg] = useState<Etat>(null);
  const [enCours, demarrer] = useTransition();
  return (
    <>
      <select aria-label="Statut de la ligne" value={valeur} disabled={enCours} className={valeur ? "" : "a-renseigner"}
        onChange={(e) => { const v = e.target.value; setValeur(v); demarrer(async () => setMsg(await majEtatLigne(id, v))); }}>
        <option value="">À renseigner</option>
        <option value="Active">Active</option>
        <option value="Suspendue">Suspendue</option>
        <option value="Résiliée">Résiliée</option>
      </select>
      {msg?.erreur && <span className="erreur"> {msg.erreur}</span>}
    </>
  );
}

export function Attribuer({ id, vendeurs }: { id: string; vendeurs: Option[] }) {
  const [msg, setMsg] = useState<Etat>(null);
  const [enCours, demarrer] = useTransition();
  return (
    <>
      <select aria-label="Attribuer à un vendeur" defaultValue="" disabled={enCours}
        onChange={(e) => { const v = e.target.value; if (v) demarrer(async () => setMsg(await attribuerVente(id, v))); }}>
        <option value="" disabled>Attribuer à…</option>
        {vendeurs.map((v) => <option key={v.id} value={v.id}>{v.nom}</option>)}
      </select>
      {msg?.erreur && <span className="erreur"> {msg.erreur}</span>}
    </>
  );
}

// --- Extraction SBIN --------------------------------------------------------------------------
export function ImportExtraction({ mois, offres, declarees }: { mois: string; offres: Offre[]; declarees: number }) {
  const [lignes, setLignes] = useState<LigneExtraction[]>([]);
  const [msg, setMsg] = useState<Etat>(null);
  const [enCours, demarrer] = useTransition();
  const fichier = useRef<HTMLInputElement>(null);
  const codes = new Set(offres.map((o) => o.code));

  async function lire(f: File) {
    setMsg(null); setLignes([]);
    try {
      const { default: readXlsxFile } = await import("read-excel-file");
      const l = lireExtraction((await readXlsxFile(f)) as unknown[][], offres);
      if (!l.length) throw new Error("Aucune ligne trouvée dans ce fichier.");
      setLignes(l);
    } catch (e) {
      setMsg({ erreur: e instanceof Error ? e.message : "Fichier illisible : enregistrez-le au format .xlsx." });
    } finally { if (fichier.current) fichier.current.value = ""; }
  }
  const inconnues = lignes.filter((l) => !codes.has(l.offre)).length;
  return (
    <div>
      <div className="inline">
        <label>Fichier Excel de l&apos;extraction SBIN<input ref={fichier} type="file" accept=".xlsx" onChange={(e) => e.target.files?.[0] && lire(e.target.files[0])} /></label>
        {declarees > 0 && <Bouton action={() => rejeterNonValidees(mois)} texte={`Rejeter les ${declarees} vente(s) non validée(s)`} classe="btn sm bad"
          confirmer="Les ventes déclarées de ce mois absentes de l'extraction passent en « Rejetée ». Continuer ?" />}
      </div>
      <p className="note">Colonnes reconnues : ligne (ou numéro, MSISDN), offre (ou produit, forfait), date d&apos;activation, client. Les ventes déclarées sont validées ligne par ligne ; les lignes SBIN non déclarées sont ajoutées sans vendeur, à attribuer.</p>
      {lignes.length > 0 && (
        <>
          <p>{lignes.length} ligne(s) lue(s){inconnues > 0 && <> · <b className="erreur">{inconnues} offre(s) non reconnue(s)</b> (ignorées tant que l&apos;offre n&apos;existe pas dans la grille)</>}</p>
          <div className="tbl" style={{ maxHeight: 280, overflow: "auto" }}>
            <table>
              <thead><tr><th>Ligne</th><th>Offre lue</th><th>Offre retenue</th><th>Date</th><th>Client</th></tr></thead>
              <tbody>{lignes.slice(0, 200).map((l, i) => (
                <tr key={i}><td className="code">{l.ligne}</td><td>{l.offreLue}</td><td className={codes.has(l.offre) ? "code" : "erreur"}>{codes.has(l.offre) ? l.offre : "?"}</td><td>{l.date}</td><td>{l.client}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <button className="btn pri" type="button" disabled={enCours} onClick={() => demarrer(async () => { const r = await importerExtraction(mois, lignes); setMsg(r); if (r?.ok) setLignes([]); })}>
            Rapprocher avec les ventes déclarées
          </button>
        </>
      )}
      <Retour etat={msg} />
    </div>
  );
}

// --- Versements -------------------------------------------------------------------------------
export function VerserAvances({ mois, lignes, fenetre }: { mois: string; lignes: { vendeur_id: string; nom: string; montant: number }[]; fenetre: { debut: string; fin: string } }) {
  const [montants, setMontants] = useState(() => Object.fromEntries(lignes.map((l) => [l.vendeur_id, l.montant])));
  const [date, setDate] = useState(() => { const a = new Date().toISOString().slice(0, 10); return a < fenetre.debut ? fenetre.debut : a; });
  const [mode, setMode] = useState("Espèces");
  const [msg, setMsg] = useState<Etat>(null);
  const [enCours, demarrer] = useTransition();
  const total = Object.values(montants).reduce((a, b) => a + (Number(b) || 0), 0);
  const horsFenetre = date < fenetre.debut || date > fenetre.fin;
  if (!lignes.length) return <p className="note">Aucune avance à verser : toutes les avances calculées sont déjà versées.</p>;
  return (
    <div>
      <div className="tbl">
        <table>
          <thead><tr><th>Vendeur</th><th className="num">Avance à verser (FCFA)</th></tr></thead>
          <tbody>{lignes.map((l) => (
            <tr key={l.vendeur_id}><td>{l.nom}</td>
              <td className="num"><input type="number" min="0" value={montants[l.vendeur_id] ?? 0} style={{ width: 120, textAlign: "right" }}
                onChange={(e) => setMontants((m) => ({ ...m, [l.vendeur_id]: Number(e.target.value) }))} /></td></tr>
          ))}</tbody>
          <tfoot><tr><th>Total</th><th className="num">{fcfa(total)}</th></tr></tfoot>
        </table>
      </div>
      <div className="inline">
        <label>Versé le<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label>Mode<select value={mode} onChange={(e) => setMode(e.target.value)}><option>Espèces</option><option>Mobile Money</option><option>Virement</option><option>Chèque</option></select></label>
        <button className="btn pri" type="button" disabled={enCours || !total}
          onClick={() => demarrer(async () => setMsg(await verserAvances(mois, lignes.map((l) => ({ vendeur_id: l.vendeur_id, montant: Number(montants[l.vendeur_id]) || 0 })), date, mode)))}>
          Enregistrer les avances versées
        </button>
      </div>
      {horsFenetre && <p className="note">Attention : la date est hors de la période habituelle des avances (du {fenetre.debut.split("-").reverse().join("/")} au {fenetre.fin.split("-").reverse().join("/")}).</p>}
      <Retour etat={msg} />
    </div>
  );
}

export function FormVersement({ mois, vendeurs, type, defaut }: { mois: string; vendeurs: (Option & { du?: number })[]; type: "Avance" | "Solde"; defaut?: string }) {
  const [etat, action, enCours] = useActionState(enregistrerVersement, null);
  const [vendeur, setVendeur] = useState(vendeurs[0]?.id ?? "");
  const choisi = vendeurs.find((v) => v.id === vendeur);
  return (
    <form className="inline" action={action}>
      <input type="hidden" name="mois" value={mois} /><input type="hidden" name="type" value={type} /><input type="hidden" name="nom" value={choisi?.nom ?? ""} />
      <label>Vendeur<select name="vendeur_id" value={vendeur} onChange={(e) => setVendeur(e.target.value)}>{vendeurs.map((v) => <option key={v.id} value={v.id}>{v.nom}{v.du != null ? ` (reste ${fcfa(v.du)})` : ""}</option>)}</select></label>
      <label>Montant (FCFA)<input name="montant" type="number" required key={vendeur} defaultValue={choisi?.du && choisi.du > 0 ? choisi.du : undefined} /></label>
      <label>Versé le<input name="verse_le" type="date" defaultValue={defaut} /></label>
      <label>Mode<select name="mode"><option>Espèces</option><option>Mobile Money</option><option>Virement</option><option>Chèque</option></select></label>
      <button className="btn pri" type="submit" disabled={enCours}>Enregistrer {type === "Solde" ? "le solde" : "l'avance"}</button>
      <Retour etat={etat} />
    </form>
  );
}

export function SupprimerVersement({ id }: { id: string }) {
  return <Bouton action={() => supprimerVersement(id)} texte="×" classe="btn sm" confirmer="Supprimer ce versement ?" />;
}

// --- Suivi du mois ---------------------------------------------------------------------------------
type M = { extraction_recue_le: string | null; facture_numero: string | null; facture_ht: number | null; facture_envoyee_le: string | null; payee_le: string | null; montant_paye: number | null; ajustement: number; ajustement_motif: string | null; note: string | null };
export function FormMois({ mois, m, htCalcule }: { mois: string; m?: M; htCalcule: number }) {
  const [etat, action, enCours] = useActionState(majMois, null);
  return (
    <form className="inline" action={action}>
      <input type="hidden" name="mois" value={mois} />
      <label>Extraction SBIN reçue le<input name="extraction_recue_le" type="date" defaultValue={m?.extraction_recue_le ?? ""} /></label>
      <label>Ajustement HT (FCFA, + ou −)<input name="ajustement" type="number" defaultValue={m?.ajustement ?? 0} /></label>
      <label>Motif de l&apos;ajustement<input name="ajustement_motif" defaultValue={m?.ajustement_motif ?? ""} placeholder="ex. régularisation SBIN" /></label>
      <label>N° de facture<input name="facture_numero" defaultValue={m?.facture_numero ?? ""} /></label>
      <label>Montant facturé HT<input name="facture_ht" type="number" defaultValue={m?.facture_ht ?? htCalcule} /></label>
      <label>Facture envoyée le<input name="facture_envoyee_le" type="date" defaultValue={m?.facture_envoyee_le ?? ""} /></label>
      <label>Payée par SBIN le<input name="payee_le" type="date" defaultValue={m?.payee_le ?? ""} /></label>
      <label>Montant reçu<input name="montant_paye" type="number" defaultValue={m?.montant_paye ?? ""} /></label>
      <label>Note<input name="note" defaultValue={m?.note ?? ""} /></label>
      <button className="btn pri" type="submit" disabled={enCours}>Enregistrer</button>
      <Retour etat={etat} />
    </form>
  );
}

// --- Vendeurs -------------------------------------------------------------------------------------
export function FormVendeur() {
  const [etat, action, enCours] = useActionState(creerVendeur, null);
  const [compte, setCompte] = useState(true);
  return (
    <form className="inline" action={action}>
      <label>Nom et prénoms<input name="nom" required /></label>
      <label>Téléphone<input name="telephone" inputMode="tel" required={compte} /></label>
      <label>N° Celtiis (vente)<input name="numero_celtiis" inputMode="tel" /></label>
      <label>Pièce d&apos;identité<input name="piece_identite" placeholder="Type et numéro" /></label>
      <label>Segment<select name="segment"><option>B2C</option><option>B2B</option></select></label>
      <label>Début<input name="debut" type="date" /></label>
      <label className="case"><input type="checkbox" name="compte" value="1" checked={compte} onChange={(e) => setCompte(e.target.checked)} /> Lui créer un compte pour déclarer ses ventes</label>
      {compte && <>
        <label>E-mail (facultatif)<input name="email" type="email" placeholder="sinon : son téléphone" /></label>
        <label>Mot de passe provisoire<input name="motdepasse" type="text" minLength={8} required autoComplete="new-password" /></label>
      </>}
      <button className="btn pri" type="submit" disabled={enCours}>Ajouter le vendeur</button>
      <Retour etat={etat} />
    </form>
  );
}

export function CompteVendeur({ id }: { id: string }) {
  const [etat, action, enCours] = useActionState(creerCompteVendeur, null);
  return (
    <details>
      <summary className="btn sm">Créer son compte</summary>
      <form className="inline" action={action} style={{ marginTop: 8 }}>
        <input type="hidden" name="id" value={id} />
        <label>E-mail (facultatif)<input name="email" type="email" placeholder="sinon : son téléphone" /></label>
        <label>Mot de passe provisoire<input name="motdepasse" type="text" minLength={8} required autoComplete="new-password" /></label>
        <button className="btn sm pri" type="submit" disabled={enCours}>Créer</button>
        <Retour etat={etat} />
      </form>
    </details>
  );
}

export function BasculerVendeur({ id, actif }: { id: string; actif: boolean }) {
  return <Bouton action={() => basculerVendeur(id, !actif)} texte={actif ? "Désactiver" : "Réactiver"} classe={actif ? "btn sm bad" : "btn sm"} />;
}

// --- Offres et contrat ------------------------------------------------------------------------------
export function FormOffre({ offre }: { offre?: Offre }) {
  const [etat, action, enCours] = useActionState(majOffre, null);
  return (
    <form className="inline" action={action}>
      {offre ? <input type="hidden" name="id" value={offre.id} /> : <>
        <label>Code<input name="code" required /></label>
        <label>Segment<select name="segment"><option>B2C</option><option>B2B</option></select></label>
        <label>Famille<input name="famille" required placeholder="FTTH, FTTO, FWA…" /></label>
      </>}
      <label>Libellé<input name="libelle" required defaultValue={offre?.libelle} /></label>
      <label>Commission HT<input name="commission" type="number" min="0" required defaultValue={offre?.commission} /></label>
      <label>Part vendeur<input name="part_vendeur" type="number" min="0" required defaultValue={offre?.part_vendeur} /></label>
      <label>Prime de performance<select name="performance" defaultValue={offre && !offre.performance ? "0" : "1"}><option value="1">Compte</option><option value="0">Ne compte pas</option></select></label>
      <label>État<select name="actif" defaultValue={offre && !offre.actif ? "0" : "1"}><option value="1">Proposée</option><option value="0">Retirée</option></select></label>
      <button className="btn sm pri" type="submit" disabled={enCours}>{offre ? "Enregistrer" : "Ajouter l'offre"}</button>
      <Retour etat={etat} />
    </form>
  );
}

export function FormContrat({ reference, debut, taux }: { reference: string; debut: string; taux: number }) {
  const [etat, action, enCours] = useActionState(majContrat, null);
  return (
    <form className="inline" action={action}>
      <label>Référence<input name="reference" defaultValue={reference} /></label>
      <label>Début du contrat<input name="date_debut" type="date" required defaultValue={debut} /></label>
      <label>Avance aux vendeurs (% du point temporaire)<input name="taux_avance" type="number" min="0" max="100" step="1" defaultValue={taux} /></label>
      <button className="btn sm pri" type="submit" disabled={enCours}>Enregistrer</button>
      <Retour etat={etat} />
    </form>
  );
}
