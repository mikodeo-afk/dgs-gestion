"use client";
import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseNavigateur } from "@/lib/supabase/navigateur";
import { controlerPointage, definirPhotoReference } from "./actions";

export function ControlePointage({ profilId, nom, jour }: { profilId: string; nom: string; jour: string }) {
  const [etat, action, enCours] = useActionState(controlerPointage, null);
  const [rejet, setRejet] = useState(false);
  return (
    <form action={action} className="statusline">
      <input type="hidden" name="profil_id" value={profilId} />
      <input type="hidden" name="nom" value={nom} />
      <input type="hidden" name="jour" value={jour} />
      {!rejet ? (
        <>
          <button className="btn sm ok" type="submit" name="decision" value="conforme" disabled={enCours}>✓ Conforme</button>
          <button className="btn sm bad" type="button" onClick={() => setRejet(true)}>✗ Rejeter</button>
        </>
      ) : (
        <>
          <input name="motif" required minLength={3} placeholder="Motif du rejet" aria-label="Motif du rejet" />
          <button className="btn sm bad" type="submit" name="decision" value="rejet" disabled={enCours}>Rejeter (absent)</button>
          <button className="btn sm" type="button" onClick={() => setRejet(false)}>Annuler</button>
        </>
      )}
      {etat?.erreur && <span className="erreur">{etat.erreur}</span>}
      {etat?.ok && <span className="succes">{etat.ok}</span>}
    </form>
  );
}

/** Dépôt de la photo de référence d'un agent (photo de face, prise par les RH). */
export function PhotoReference({ profilId, nom, pays, existe }: { profilId: string; nom: string; pays: string; existe: boolean }) {
  const [msg, setMsg] = useState<{ ok?: string; erreur?: string } | null>(null);
  const [enCours, setEnCours] = useState(false);
  const champ = useRef<HTMLInputElement>(null);
  const router = useRouter();
  async function deposer(f: File) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) return setMsg({ erreur: "Photo JPEG ou PNG." });
    if (f.size > 5 * 1024 * 1024) return setMsg({ erreur: "Photo trop lourde (5 Mo au plus)." });
    setEnCours(true);
    const chemin = `${pays}/reference/${profilId}-${Date.now()}.${f.type.split("/")[1]}`;
    const { error } = await supabaseNavigateur().storage.from("pointages").upload(chemin, f, { contentType: f.type });
    const r = error ? { erreur: "Dépôt impossible : " + error.message } : await definirPhotoReference(profilId, chemin, nom);
    setEnCours(false);
    setMsg(r);
    if (champ.current) champ.current.value = "";
    router.refresh();
  }
  return (
    <span className="statusline">
      <label className="btn sm depot" style={{ borderStyle: "dashed" }}>
        {enCours ? "Envoi…" : existe ? "Changer la photo de référence" : "Déposer la photo de référence"}
        <input ref={champ} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden disabled={enCours}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) deposer(f); }} />
      </label>
      {msg?.erreur && <span className="erreur">{msg.erreur}</span>}
      {msg?.ok && <span className="succes">{msg.ok}</span>}
    </span>
  );
}
