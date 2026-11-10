"use client";
import { useActionState } from "react";
import type { Identite } from "@/lib/types";
import { modifierIdentite } from "./actions";

export default function FormIdentite({ id }: { id: Identite }) {
  const [etat, action, enCours] = useActionState(modifierIdentite, null);
  return (
    <form className="inline" action={action}>
      <label>Raison sociale<input id="id-raison" name="raison_sociale" defaultValue={id.raison_sociale ?? ""} /></label>
      <label>RCCM<input id="id-rccm" name="rccm" defaultValue={id.rccm ?? ""} /></label>
      <label>IFU / NIF<input id="id-ifu" name="ifu" defaultValue={id.ifu ?? ""} /></label>
      <label>Adresse<input id="id-adr" name="adresse" defaultValue={id.adresse ?? ""} /></label>
      <label>Téléphone<input id="id-tel" name="telephone" defaultValue={id.telephone ?? ""} /></label>
      <label>E-mail<input id="id-mail" name="email" type="email" defaultValue={id.email ?? ""} /></label>
      <button className="btn pri" type="submit" disabled={enCours}>Enregistrer l&apos;identité</button>
      {etat?.erreur && <p className="erreur" style={{ gridColumn: "1/-1" }}>{etat.erreur}</p>}
      {etat?.ok && <p className="succes" style={{ gridColumn: "1/-1" }}>{etat.ok}</p>}
    </form>
  );
}
