"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseNavigateur } from "@/lib/supabase/navigateur";
import { pointer } from "./actions";

/** Lieu de pointage : un chantier d'affectation, ou le bureau (id vide). */
export type Lieu = { id: string | null; code: string; nom: string; latitude: number; longitude: number; rayon_pointage: number };

function distance(a: number, b: number, c: number, d: number) {
  const r = (x: number) => (x * Math.PI) / 180;
  const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

/** Réduit le selfie (800 px, JPEG) pour un envoi rapide sur réseau mobile. */
async function reduire(f: File): Promise<Blob> {
  const img = await createImageBitmap(f);
  const k = Math.min(1, 800 / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * k);
  c.height = Math.round(img.height * k);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((ok, ko) => c.toBlob((b) => (b ? ok(b) : ko(new Error("photo illisible"))), "image/jpeg", 0.8));
}

function position(): Promise<GeolocationPosition> {
  return new Promise((ok, ko) => {
    if (!navigator.geolocation) return ko(new Error("Ce téléphone ne donne pas sa position."));
    navigator.geolocation.getCurrentPosition(ok, (e) =>
      ko(new Error(e.code === 1 ? "Localisation refusée : autorisez la position pour ce site dans les réglages du navigateur, puis réessayez." : "Position introuvable : mettez-vous à découvert et réessayez.")),
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 });
  });
}

export default function Pointer({ chantiers, agentId, pays }: { chantiers: Lieu[]; agentId: string; pays: string }) {
  const [choix, setChoix] = useState(chantiers.length === 1 ? chantiers[0].id ?? "bureau" : "");
  const [etape, setEtape] = useState("");
  const [msg, setMsg] = useState<{ ok?: string; erreur?: string } | null>(null);
  const champ = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function envoyer(f: File) {
    setMsg(null);
    try {
      setEtape("Recherche de votre position…");
      const p = await position();
      const c = chantiers.find((x) => (x.id ?? "bureau") === choix)!;
      const d = Math.round(distance(p.coords.latitude, p.coords.longitude, c.latitude, c.longitude));
      if (d > c.rayon_pointage) {
        throw new Error(`Vous êtes à ${d} m ${c.id ? `du chantier ${c.code}` : "du bureau"} (rayon autorisé : ${c.rayon_pointage} m). Rapprochez-vous pour pointer.`);
      }
      setEtape("Envoi du selfie…");
      const photo = await reduire(f);
      const chemin = `${pays}/${agentId}/${new Date().toISOString().slice(0, 10)}-${Date.now()}.jpg`;
      const { error } = await supabaseNavigateur().storage.from("pointages").upload(chemin, photo, { contentType: "image/jpeg" });
      if (error) throw new Error("Le selfie n'a pas pu être envoyé : " + error.message);
      setEtape("Enregistrement…");
      const r = await pointer({ chantierId: c.id, lat: p.coords.latitude, lon: p.coords.longitude, precision: p.coords.accuracy, photo: chemin });
      setMsg(r);
      router.refresh();
    } catch (e) {
      setMsg({ erreur: e instanceof Error ? e.message : String(e) });
    } finally {
      setEtape("");
      if (champ.current) champ.current.value = "";
    }
  }

  return (
    <div className="pointage">
      {chantiers.length > 1 && (
        <label>Chantier où vous êtes affecté
          <select value={choix} onChange={(e) => setChoix(e.target.value)}>
            <option value="">— Choisir —</option>
            {chantiers.map((c) => <option key={c.id ?? "bureau"} value={c.id ?? "bureau"}>{c.code} · {c.nom}</option>)}
          </select>
        </label>
      )}
      {chantiers.length === 1 && <p>Lieu de pointage : <b>{chantiers[0].id ? `${chantiers[0].code} · ${chantiers[0].nom}` : chantiers[0].nom}</b></p>}
      <label className={`btn pri gros ${!choix || etape ? "inactif" : ""}`} aria-disabled={!choix || !!etape}>
        {etape || "📸 Je pointe : prendre mon selfie"}
        <input ref={champ} type="file" accept="image/*" capture="user" hidden disabled={!choix || !!etape}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) envoyer(f); }} />
      </label>
      <p className="note">Votre position est vérifiée au moment du pointage : vous devez être sur place. Le selfie est contrôlé par les RH.</p>
      {msg?.erreur && <p className="erreur">{msg.erreur}</p>}
      {msg?.ok && <p className="succes">{msg.ok}</p>}
    </div>
  );
}
