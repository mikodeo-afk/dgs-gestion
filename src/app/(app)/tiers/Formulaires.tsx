"use client";
import { useActionState } from "react";
import type { Tiers } from "@/lib/types";
import { ajouterPrix, creerTiers, modifierPrix, modifierTiers } from "./actions";

type Etat = { ok?: string; erreur?: string } | null;
function Retour({ etat }: { etat: Etat }) {
  if (etat?.erreur) return <p className="erreur" style={{ gridColumn: "1/-1" }}>{etat.erreur}</p>;
  if (etat?.ok) return <p className="succes" style={{ gridColumn: "1/-1" }}>{etat.ok}</p>;
  return null;
}
function Champs({ t }: { t?: Tiers }) {
  return (
    <>
      <label>IFU / NIF<input name="ifu" defaultValue={t?.ifu ?? ""} /></label>
      <label>RCCM<input name="rccm" defaultValue={t?.rccm ?? ""} /></label>
      <label>Adresse<input name="adresse" defaultValue={t?.adresse ?? ""} /></label>
      <label>Téléphone<input name="telephone" defaultValue={t?.telephone ?? ""} /></label>
      <label>E-mail<input name="email" type="email" defaultValue={t?.email ?? ""} /></label>
      <label>Contact<input name="contact" defaultValue={t?.contact ?? ""} placeholder="Nom de l'interlocuteur" /></label>
    </>
  );
}

export function FormTiers({ type }: { type: Tiers["type"] }) {
  const [etat, action, enCours] = useActionState(creerTiers, null);
  return (
    <form className="inline" action={action}>
      <label>Type
        <select id="ti-type" name="type" defaultValue={type}>
          <option value="client">Client</option><option value="fournisseur">Fournisseur</option><option value="prestataire">Prestataire (sous-traitant)</option>
        </select>
      </label>
      <label>Nom ou raison sociale<input id="ti-nom" name="nom" required /></label>
      <Champs />
      <button className="btn pri" type="submit" disabled={enCours}>Enregistrer</button>
      <p className="note" style={{ gridColumn: "1/-1" }}>Sur la fiche qui s&apos;ouvre ensuite, déposez ses documents administratifs (RCCM, IFU…) et fiscaux, puis son bordereau des prix.</p>
      <Retour etat={etat} />
    </form>
  );
}

export function FormFiche({ t, peut }: { t: Tiers; peut: boolean }) {
  const [etat, action, enCours] = useActionState(modifierTiers, null);
  return (
    <form className="inline" action={action}>
      <input type="hidden" name="id" value={t.id} />
      <fieldset disabled={!peut} style={{ display: "contents" }}>
        <label>Nom ou raison sociale<input name="nom" required defaultValue={t.nom} /></label>
        <Champs t={t} />
        <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><input type="checkbox" name="actif" defaultChecked={t.actif} /> Actif</label>
        {peut && <button className="btn" type="submit" disabled={enCours}>Enregistrer la fiche</button>}
      </fieldset>
      <Retour etat={etat} />
    </form>
  );
}

export function FormPrix({ tiersId, nom }: { tiersId: string; nom: string }) {
  const [etat, action, enCours] = useActionState(ajouterPrix, null);
  return (
    <form className="inline" action={action}>
      <input type="hidden" name="tiers_id" value={tiersId} />
      <input type="hidden" name="nom" value={nom} />
      <label>N° de prix (facultatif)<input id="bp-code" name="code" placeholder="ex. 2.1" /></label>
      <label style={{ gridColumn: "span 2" }}>Libellé<input id="bp-des" name="designation" required placeholder="ex. Fouille en tranchée 0,60 × 1,00 m" /></label>
      <label>Unité<input id="bp-unite" name="unite" required placeholder="ml, m³, u, ff…" list="unites" /></label>
      <datalist id="unites">{["u", "ml", "m²", "m³", "kg", "t", "ff", "jour", "h", "km"].map((u) => <option key={u} value={u} />)}</datalist>
      <label>Prix unitaire HT (FCFA)<input id="bp-pu" name="prix_unitaire_ht" type="number" min="0" required /></label>
      <button className="btn pri" type="submit" disabled={enCours}>Ajouter au bordereau</button>
      <Retour etat={etat} />
    </form>
  );
}

export function LignePrix({ id, tiersId, nom, designation, pu, actif }: { id: string; tiersId: string; nom: string; designation: string; pu: number; actif: boolean }) {
  const [etat, action, enCours] = useActionState(modifierPrix, null);
  return (
    <form action={action} className="statusline">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="tiers_id" value={tiersId} />
      <input type="hidden" name="nom" value={nom} />
      <input type="hidden" name="designation" value={designation} />
      <input name="prix_unitaire_ht" type="number" min="0" defaultValue={pu} aria-label="Prix unitaire HT" style={{ width: 120 }} />
      <label className="note" style={{ display: "flex", gap: 4, alignItems: "center" }}><input type="checkbox" name="actif" defaultChecked={actif} /> actif</label>
      <button className="btn sm" type="submit" disabled={enCours}>OK</button>
      {etat?.erreur && <span className="erreur">{etat.erreur}</span>}
      {etat?.ok && <span className="note">✓</span>}
    </form>
  );
}
