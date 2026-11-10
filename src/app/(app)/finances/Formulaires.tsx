"use client";
import { useActionState } from "react";
import { fcfa } from "@/lib/format";
import { ajouterFraisGeneral, emettreFacture, enregistrerFactureFournisseur } from "./actions";

type Ch = { id: string; code: string; nom: string };
export type PvSigne = { id: string; numero: string; code: string; tiers: string; objet: string; montant_ht: number };
export type BcValide = { id: string; numero: string; code: string; fournisseur: string; objet: string };
type Etat = { ok?: string; erreur?: string } | null;
function Retour({ etat }: { etat: Etat }) {
  if (etat?.erreur) return <p className="erreur" style={{ gridColumn: "1/-1" }}>{etat.erreur}</p>;
  if (etat?.ok) return <p className="succes" style={{ gridColumn: "1/-1" }}>{etat.ok}</p>;
  return null;
}

function ChoixTaxes({ tva, aib, pre }: { tva: number; aib: number[]; pre: string }) {
  return (
    <>
      <label>TVA
        <select id={`${pre}-tva`} name="taux_tva" defaultValue={String(tva)}>
          <option value={String(tva)}>{tva} %</option>
          <option value="0">Exonérée (0 %)</option>
        </select>
      </label>
      <label>AIB (sur le HT)
        <select id={`${pre}-aib`} name="taux_aib" defaultValue={String(aib[0])}>
          {Array.from(new Set(aib)).sort((a, b) => a - b).map((t) => <option key={t} value={t}>{t ? `${t} %` : "Non applicable"}</option>)}
        </select>
      </label>
    </>
  );
}

export function FormFactureClient({ pvs, tva, aib }: { pvs: PvSigne[]; tva: number; aib: number[] }) {
  const [etat, action, enCours] = useActionState(emettreFacture, null);
  if (!pvs.length) return <p className="note">Aucun PV client signé à facturer. Le chef de projet établit le PV d&apos;exécution, puis le fait signer par le client.</p>;
  return (
    <form className="inline" action={action}>
      <label>PV d&apos;exécution signé<select id="fc-pv" name="pv_id" required>{pvs.map((p) => <option key={p.id} value={p.id}>{p.numero} · {p.code} · {p.tiers} · {fcfa(p.montant_ht)} FCFA HT</option>)}</select></label>
      <label>Objet<input id="fc-objet" name="objet" required placeholder="ex. Situation n°2" /></label>
      <ChoixTaxes tva={tva} aib={aib} pre="fc" />
      <p className="note" style={{ gridColumn: "1/-1" }}>Le projet et le montant HT viennent du PV. La TVA, le TTC, l&apos;AIB retenu par le client et le net à encaisser sont calculés automatiquement.</p>
      <label>Échéance<input id="fc-ech" name="echeance" type="date" required /></label>
      <button className="btn pri" type="submit" disabled={enCours}>Émettre la facture</button>
      <Retour etat={etat} />
    </form>
  );
}

export function FormFactureFournisseur({ chantiers, pvs, bons, tva, aib }: { chantiers: Ch[]; pvs: PvSigne[]; bons: BcValide[]; tva: number; aib: number[] }) {
  const [etat, action, enCours] = useActionState(enregistrerFactureFournisseur, null);
  return (
    <form className="inline" action={action}>
      <label>Fournisseur<input id="ff-fou" name="fournisseur" required /></label>
      <label>N° de facture<input id="ff-num" name="numero" required /></label>
      <label>Objet<input id="ff-objet" name="objet" required /></label>
      <label>Imputation
        <select id="ff-ch" name="chantier_id" required>
          <option value="FG">Frais généraux (hors projet)</option>
          {chantiers.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.nom}</option>)}
        </select>
      </label>
      <label>PV prestataire signé (facultatif)
        <select id="ff-pv" name="pv_id" defaultValue=""><option value="">Aucun</option>{pvs.map((p) => <option key={p.id} value={p.id}>{p.numero} · {p.code} · {p.tiers}</option>)}</select>
      </label>
      <label>Bon de commande (facultatif)
        <select id="ff-bc" name="bon_commande_id" defaultValue=""><option value="">Aucun</option>{bons.map((b) => <option key={b.id} value={b.id}>{b.numero} · {b.code} · {b.fournisseur}</option>)}</select>
      </label>
      <label>Montant HT (FCFA)<input id="ff-ht" name="montant_ht" type="number" min="1" required /></label>
      <ChoixTaxes tva={tva} aib={aib} pre="ff" />
      <label>Échéance<input id="ff-ech" name="echeance" type="date" /></label>
      <button className="btn pri" type="submit" disabled={enCours}>Enregistrer la facture</button>
      <Retour etat={etat} />
    </form>
  );
}

export function FormFraisGeneral({ mois }: { mois: string }) {
  const [etat, action, enCours] = useActionState(ajouterFraisGeneral, null);
  return (
    <form className="inline" action={action}>
      <input type="hidden" name="mois" value={mois} />
      <label>Catégorie
        <select id="fg-cat" name="categorie">
          {["Loyer", "Électricité et eau", "Télécoms", "Véhicules", "Administration", "Divers"].map((c) => <option key={c}>{c}</option>)}
        </select>
      </label>
      <label>Libellé<input id="fg-lib" name="libelle" required /></label>
      <label>Montant (FCFA)<input id="fg-mon" name="montant" type="number" min="1" required /></label>
      <button className="btn pri" type="submit" disabled={enCours}>Ajouter au mois</button>
      <Retour etat={etat} />
    </form>
  );
}
