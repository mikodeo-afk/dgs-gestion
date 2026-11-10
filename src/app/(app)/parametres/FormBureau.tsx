"use client";
import { useActionState } from "react";
import BoutonPosition from "@/components/BoutonPosition";
import { definirBureau } from "./actions";

export default function FormBureau({ lat, lon, rayon }: { lat: number | null; lon: number | null; rayon: number }) {
  const [etat, action, enCours] = useActionState(definirBureau, null);
  return (
    <form className="inline" action={action}>
      <label>Latitude<input id="bureau_lat" name="latitude" inputMode="decimal" defaultValue={lat ?? ""} placeholder="ex. 12.6392" /></label>
      <label>Longitude<input id="bureau_lon" name="longitude" inputMode="decimal" defaultValue={lon ?? ""} placeholder="ex. -8.0029" /></label>
      <label>Rayon de pointage (m)<input name="rayon" type="number" min="50" max="2000" step="50" defaultValue={rayon} /></label>
      <span style={{ alignSelf: "end" }}><BoutonPosition lat="bureau_lat" lon="bureau_lon" /></span>
      <button className="btn pri" type="submit" disabled={enCours}>Enregistrer le bureau</button>
      {etat?.erreur && <p className="erreur" style={{ gridColumn: "1/-1" }}>{etat.erreur}</p>}
      {etat?.ok && <p className="succes" style={{ gridColumn: "1/-1" }}>{etat.ok}</p>}
    </form>
  );
}
