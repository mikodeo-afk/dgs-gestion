"use client";
import { useActionState, useState } from "react";
import { affecter, ajouterEntretien, ajouterPlein, creerEquipement, modifierEquipement } from "./actions";

type Etat = { ok?: string; erreur?: string } | null;
type Option = { id: string; libelle: string };
export type Equipement = {
  id: string; code: string; categorie: string; type: string; designation: string; marque: string | null; modele: string | null;
  numero_serie: string | null; immatriculation: string | null; annee: number | null; date_acquisition: string | null;
  valeur_acquisition: number | null; compteur: number | null; unite_compteur: "km" | "h"; etat: string;
  chantier_id: string | null; responsable_id: string | null; notes: string | null;
};
function Retour({ etat }: { etat: Etat }) {
  if (etat?.erreur) return <p className="erreur" style={{ gridColumn: "1/-1" }}>{etat.erreur}</p>;
  if (etat?.ok) return <p className="succes" style={{ gridColumn: "1/-1" }}>{etat.ok}</p>;
  return null;
}
const TYPES_ROULANT = ["Pick-up", "Véhicule de liaison", "Camion", "Camion-grue", "Nacelle", "Moto", "Engin de terrassement", "Remorque"];
const TYPES_TRAVAIL = ["Groupe électrogène", "Soudeuse fibre", "Réflectomètre (OTDR)", "Bétonnière", "Compresseur", "Échafaudage", "Outillage électroportatif", "Appareil de mesure", "EPI"];

export function FormEquipement({ categorie, chantiers, personnel }: { categorie: string; chantiers: Option[]; personnel: Option[] }) {
  const [etat, action, enCours] = useActionState(creerEquipement, null);
  const roulant = categorie === "Matériel roulant";
  return (
    <form className="inline" action={action}>
      <input type="hidden" name="categorie" value={categorie} />
      <label>N° d&apos;inventaire<input name="code" required placeholder={roulant ? "ex. VH-001" : "ex. GE-001"} /></label>
      <label>Type<input name="type" required list="types-mat" /></label>
      <datalist id="types-mat">{(roulant ? TYPES_ROULANT : TYPES_TRAVAIL).map((t) => <option key={t}>{t}</option>)}</datalist>
      <label>Désignation<input name="designation" required placeholder={roulant ? "ex. Toyota Hilux double cabine" : "ex. Groupe 20 kVA"} /></label>
      <label>Marque<input name="marque" /></label>
      <label>Modèle<input name="modele" /></label>
      {roulant && <label>Immatriculation<input name="immatriculation" /></label>}
      <label>N° de série / châssis<input name="numero_serie" /></label>
      <label>Année<input name="annee" type="number" min="1950" max="2100" /></label>
      <label>Date d&apos;acquisition<input name="date_acquisition" type="date" /></label>
      <label>Valeur d&apos;acquisition (FCFA)<input name="valeur" type="number" min="0" /></label>
      <label>Compteur actuel<input name="compteur" type="number" min="0" /></label>
      <label>Unité du compteur
        <select name="unite_compteur" defaultValue={roulant ? "km" : "h"}><option value="km">km</option><option value="h">heures</option></select>
      </label>
      <label>Où
        <select name="chantier_id" defaultValue="">
          <option value="">Dépôt / bureau</option>
          {chantiers.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
        </select>
      </label>
      <label>{roulant ? "Affecté à (conducteur / responsable)" : "Affecté à (responsable)"}
        <select name="responsable_id" defaultValue="">
          <option value="">— Personne —</option>
          {personnel.map((p) => <option key={p.id} value={p.id}>{p.libelle}</option>)}
        </select>
      </label>
      <button className="btn pri" type="submit" disabled={enCours}>Enregistrer</button>
      <Retour etat={etat} />
    </form>
  );
}

export function FormFiche({ e, peut }: { e: Equipement; peut: boolean }) {
  const [etat, action, enCours] = useActionState(modifierEquipement, null);
  return (
    <form className="inline" action={action}>
      <input type="hidden" name="id" value={e.id} />
      <fieldset disabled={!peut} style={{ display: "contents" }}>
        <label>Désignation<input name="designation" required defaultValue={e.designation} /></label>
        <label>Type<input name="type" required defaultValue={e.type} /></label>
        <label>Marque<input name="marque" defaultValue={e.marque ?? ""} /></label>
        <label>Modèle<input name="modele" defaultValue={e.modele ?? ""} /></label>
        {e.categorie === "Matériel roulant" && <label>Immatriculation<input name="immatriculation" defaultValue={e.immatriculation ?? ""} /></label>}
        <label>N° de série / châssis<input name="numero_serie" defaultValue={e.numero_serie ?? ""} /></label>
        <label>Année<input name="annee" type="number" defaultValue={e.annee ?? ""} /></label>
        <label>Date d&apos;acquisition<input name="date_acquisition" type="date" defaultValue={e.date_acquisition ?? ""} /></label>
        <label>Valeur d&apos;acquisition<input name="valeur" type="number" min="0" defaultValue={e.valeur_acquisition ?? ""} /></label>
        <label style={{ gridColumn: "1/-1" }}>Notes<input name="notes" defaultValue={e.notes ?? ""} /></label>
        {peut && <button className="btn" type="submit" disabled={enCours}>Enregistrer la fiche</button>}
      </fieldset>
      <Retour etat={etat} />
    </form>
  );
}

export function FormAffectation({ e, chantiers, personnel }: { e: Equipement; chantiers: Option[]; personnel: Option[] }) {
  const [etat, action, enCours] = useActionState(affecter, null);
  return (
    <form className="inline" action={action}>
      <input type="hidden" name="id" value={e.id} />
      <input type="hidden" name="code" value={e.code} />
      <label>Où
        <select name="chantier_id" defaultValue={e.chantier_id ?? ""}>
          <option value="">Dépôt / bureau</option>
          {chantiers.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
        </select>
      </label>
      <label>{e.categorie === "Matériel roulant" ? "Conducteur / responsable" : "Responsable"}
        <select name="responsable_id" defaultValue={e.responsable_id ?? ""}>
          <option value="">— Aucun —</option>
          {personnel.map((p) => <option key={p.id} value={p.id}>{p.libelle}</option>)}
        </select>
      </label>
      <label>État
        <select name="etat" defaultValue={e.etat}>{["Bon", "À réparer", "En panne", "Réformé"].map((x) => <option key={x}>{x}</option>)}</select>
      </label>
      <label>Compteur ({e.unite_compteur})<input name="compteur" type="number" min="0" placeholder={e.compteur?.toString() ?? ""} /></label>
      <label>Motif<input name="motif" placeholder="ex. Mise à disposition chantier" /></label>
      <button className="btn pri" type="submit" disabled={enCours}>Enregistrer l&apos;affectation</button>
      <Retour etat={etat} />
    </form>
  );
}

export function FormEntretien({ e, chantiers }: { e: Equipement; chantiers: Option[] }) {
  const [etat, action, enCours] = useActionState(ajouterEntretien, null);
  return (
    <form className="inline" action={action}>
      <input type="hidden" name="equipement_id" value={e.id} />
      <input type="hidden" name="code" value={e.code} />
      <label>Date<input name="le" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></label>
      <label>Type
        <select name="type">{["Entretien", "Réparation", "Pneumatiques", "Visite technique", "Autre"].map((x) => <option key={x}>{x}</option>)}</select>
      </label>
      <label>Travaux<input name="description" required placeholder="ex. Vidange + filtres" /></label>
      <label>Compteur ({e.unite_compteur})<input name="compteur" type="number" min="0" /></label>
      <label>Coût (FCFA)<input name="cout" type="number" min="0" defaultValue={0} /></label>
      <label>Garage / prestataire<input name="prestataire" /></label>
      <label>Chantier imputé
        <select name="chantier_id" defaultValue=""><option value="">— Frais généraux —</option>{chantiers.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}</select>
      </label>
      <label>Prochain le<input name="prochain_le" type="date" /></label>
      <label>Prochain à ({e.unite_compteur})<input name="prochain_compteur" type="number" min="0" /></label>
      <button className="btn pri" type="submit" disabled={enCours}>Enregistrer</button>
      <Retour etat={etat} />
    </form>
  );
}

export function FormPlein({ e, chantiers }: { e: Equipement; chantiers: Option[] }) {
  const [etat, action, enCours] = useActionState(ajouterPlein, null);
  const [litres, setLitres] = useState("");
  return (
    <form className="inline" action={action}>
      <input type="hidden" name="equipement_id" value={e.id} />
      <input type="hidden" name="code" value={e.code} />
      <label>Date<input name="le" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></label>
      <label>Litres<input name="litres" type="number" min="0.1" step="0.01" required value={litres} onChange={(x) => setLitres(x.target.value)} /></label>
      <label>Montant (FCFA)<input name="montant" type="number" min="0" required /></label>
      <label>Compteur ({e.unite_compteur})<input name="compteur" type="number" min="0" /></label>
      <label>Chantier
        <select name="chantier_id" defaultValue={e.chantier_id ?? ""}><option value="">— Aucun —</option>{chantiers.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}</select>
      </label>
      <button className="btn pri" type="submit" disabled={enCours}>Enregistrer le plein</button>
      <Retour etat={etat} />
    </form>
  );
}
