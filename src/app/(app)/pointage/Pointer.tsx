"use client";
import { useEffect, useRef, useState } from "react";
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

/** Réduit une image (800 px, JPEG) pour un envoi rapide sur réseau mobile. */
function versJpeg(source: CanvasImageSource, l: number, h: number): Promise<Blob> {
  const k = Math.min(1, 800 / Math.max(l, h));
  const c = document.createElement("canvas");
  c.width = Math.round(l * k);
  c.height = Math.round(h * k);
  c.getContext("2d")!.drawImage(source, 0, 0, c.width, c.height);
  return new Promise((ok, ko) => c.toBlob((b) => (b ? ok(b) : ko(new Error("photo illisible"))), "image/jpeg", 0.8));
}

/** Photo prise par l'appareil photo du téléphone (solution de secours). */
async function reduireFichier(f: File): Promise<Blob> {
  const url = URL.createObjectURL(f);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return await versJpeg(img, img.naturalWidth, img.naturalHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
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
  const [camera, setCamera] = useState(false);
  const [secours, setSecours] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; erreur?: string } | null>(null);
  const champ = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const flux = useRef<MediaStream | null>(null);
  const router = useRouter();

  const couper = () => { flux.current?.getTracks().forEach((t) => t.stop()); flux.current = null; setCamera(false); };
  useEffect(() => couper, []);

  // La caméra s'ouvre dans la page : le téléphone ne lance pas l'application photo,
  // qui fermait le navigateur faute de mémoire sur certains Android.
  async function ouvrirCamera() {
    setMsg(null);
    if (!navigator.mediaDevices?.getUserMedia) { setSecours(true); return; }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      flux.current = s;
      setCamera(true);
      requestAnimationFrame(() => { if (video.current) { video.current.srcObject = s; video.current.play().catch(() => {}); } });
    } catch (e) {
      const refus = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");
      setMsg({ erreur: refus
        ? "Caméra refusée : autorisez la caméra pour ce site dans les réglages du navigateur, puis réessayez."
        : "La caméra ne s'ouvre pas dans la page : utilisez le bouton ci-dessous." });
      setSecours(true);
    }
  }

  async function prendre() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const photo = await versJpeg(v, v.videoWidth, v.videoHeight);
    couper();
    envoyer(photo);
  }

  async function envoyer(photo: Blob) {
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

  const bloque = !choix || !!etape;
  return (
    <div className="pointage">
      {chantiers.length > 1 && (
        <label>Chantier où vous êtes affecté
          <select value={choix} onChange={(e) => setChoix(e.target.value)} disabled={camera}>
            <option value="">— Choisir —</option>
            {chantiers.map((c) => <option key={c.id ?? "bureau"} value={c.id ?? "bureau"}>{c.code} · {c.nom}</option>)}
          </select>
        </label>
      )}
      {chantiers.length === 1 && <p>Lieu de pointage : <b>{chantiers[0].id ? `${chantiers[0].code} · ${chantiers[0].nom}` : chantiers[0].nom}</b></p>}
      {camera ? (
        <div className="camera">
          <video ref={video} playsInline muted autoPlay />
          <button type="button" className="btn pri gros" onClick={prendre}>📸 Prendre la photo</button>
          <button type="button" className="btn" onClick={couper}>Annuler</button>
        </div>
      ) : (
        <button type="button" className={`btn pri gros ${bloque ? "inactif" : ""}`} disabled={bloque} onClick={ouvrirCamera}>
          {etape || "📸 Je pointe : prendre mon selfie"}
        </button>
      )}
      {secours && !camera && (
        <label className={`btn ${bloque ? "inactif" : ""}`} aria-disabled={bloque}>
          Ouvrir l&apos;appareil photo du téléphone
          <input ref={champ} type="file" accept="image/*" capture="user" hidden disabled={bloque}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) reduireFichier(f).then(envoyer, () => setMsg({ erreur: "Photo illisible : reprenez-la." })); }} />
        </label>
      )}
      <p className="note">Votre position est vérifiée au moment du pointage : vous devez être sur place. Le selfie est contrôlé par les RH.</p>
      {msg?.erreur && <p className="erreur">{msg.erreur}</p>}
      {msg?.ok && <p className="succes">{msg.ok}</p>}
    </div>
  );
}
