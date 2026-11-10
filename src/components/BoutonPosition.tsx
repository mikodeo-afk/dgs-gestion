"use client";
import { useState } from "react";

/** Remplit les champs latitude/longitude avec la position du téléphone (à utiliser sur le site du chantier). */
export default function BoutonPosition({ lat = "latitude", lon = "longitude" }: { lat?: string; lon?: string }) {
  const [msg, setMsg] = useState("");
  function lire() {
    if (!navigator.geolocation) return setMsg("Ce navigateur ne donne pas la position.");
    setMsg("Recherche de la position…");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const a = document.getElementById(lat) as HTMLInputElement | null, b = document.getElementById(lon) as HTMLInputElement | null;
        if (a) a.value = p.coords.latitude.toFixed(6);
        if (b) b.value = p.coords.longitude.toFixed(6);
        setMsg(`Position relevée (± ${Math.round(p.coords.accuracy)} m).`);
      },
      () => setMsg("Position refusée ou indisponible : autorisez la localisation pour ce site."),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  }
  return (
    <span className="statusline">
      <button type="button" className="btn sm" onClick={lire}>📍 Utiliser ma position actuelle</button>
      {msg && <span className="note">{msg}</span>}
    </span>
  );
}
