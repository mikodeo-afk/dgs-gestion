"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseNavigateur } from "@/lib/supabase/navigateur";
import { enregistrerJustificatif, lienJustificatif, type Objet } from "@/app/(app)/justificatifs-actions";

export type Fichier = { id: string; nom_fichier: string; depose_le: string; type_document?: string | null; valide_jusquau?: string | null };
export const DOCS_ADMIN = ["RCCM", "IFU / NIF", "Statuts", "Pièce d'identité du gérant", "Autre document administratif"];
export const DOCS_FISCAUX = ["Attestation de régularité fiscale", "Quitus fiscal", "Attestation CNSS / INPS", "Autre document fiscal"];
const TYPES = "application/pdf,image/jpeg,image/png,image/webp";

/** Documents signés d'une pièce : consultation et dépôt (PDF ou photo, 20 Mo au plus). */
export default function Justificatifs({ objet, objetId, numero, pays, fichiers, peutDeposer, page, compact, dossier }: {
  objet: Objet; objetId: string; numero: string; pays: string; fichiers: Fichier[]; peutDeposer: boolean; page: string; compact?: boolean;
  /** Dossier d'une société : chaque document a un type, et une date de validité s'il est fiscal. */
  dossier?: boolean;
}) {
  const [typeDoc, setTypeDoc] = useState(DOCS_ADMIN[0]);
  const [validite, setValidite] = useState("");
  const fiscal = DOCS_FISCAUX.includes(typeDoc);
  const auj = new Date().toISOString().slice(0, 10);
  const [msg, setMsg] = useState<{ ok?: string; erreur?: string } | null>(null);
  const [enCours, setEnCours] = useState(false);
  const champ = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function ouvrir(id: string) {
    const r = await lienJustificatif(id);
    if (r.url) window.open(r.url, "_blank", "noopener");
    else setMsg({ erreur: r.erreur });
  }

  async function deposer(f: File) {
    if (f.size > 20 * 1024 * 1024) return setMsg({ erreur: "Fichier trop lourd (20 Mo au plus)." });
    if (!TYPES.split(",").includes(f.type)) return setMsg({ erreur: "Déposez un PDF ou une photo (JPEG, PNG)." });
    if (dossier && fiscal && !validite) {
      if (champ.current) champ.current.value = "";
      return setMsg({ erreur: "Indiquez d'abord jusqu'à quand ce document fiscal est valable." });
    }
    setEnCours(true);
    setMsg(null);
    const propre = f.name.normalize("NFD").replace(/[^\w.-]+/g, "_").slice(-80);
    const chemin = `${pays}/${objet}/${objetId}/${Date.now()}-${propre}`;
    const { error } = await supabaseNavigateur().storage.from("justificatifs").upload(chemin, f, { contentType: f.type });
    if (error) {
      setEnCours(false);
      return setMsg({ erreur: "Le dépôt a échoué : " + error.message });
    }
    const r = await enregistrerJustificatif({ objet, objetId, chemin, nom: f.name, taille: f.size, type: f.type, numero, page,
      typeDocument: dossier ? typeDoc : undefined, valideJusquau: dossier && fiscal ? validite : undefined });
    setEnCours(false);
    setMsg(r);
    if (champ.current) champ.current.value = "";
    router.refresh();
  }

  return (
    <div className={compact ? "justif compact" : "justif"}>
      {fichiers.map((x) => (
        <button key={x.id} type="button" className="btn sm" onClick={() => ouvrir(x.id)} title={`Déposé le ${x.depose_le.slice(0, 10).split("-").reverse().join("/")}`}>
          📎 {compact ? "Signé" : x.type_document ?? x.nom_fichier}
          {x.valide_jusquau && <span className={x.valide_jusquau < auj ? "neg" : "note"}> · {x.valide_jusquau < auj ? "expiré le" : "valable jusqu'au"} {x.valide_jusquau.split("-").reverse().join("/")}</span>}
        </button>
      ))}
      {!fichiers.length && !peutDeposer && <span className="note">Aucun document</span>}
      {peutDeposer && dossier && (
        <span className="statusline">
          <select aria-label="Type de document" value={typeDoc} onChange={(e) => setTypeDoc(e.target.value)} className="btn sm">
            <optgroup label="Administratif">{DOCS_ADMIN.map((t) => <option key={t}>{t}</option>)}</optgroup>
            <optgroup label="Fiscal">{DOCS_FISCAUX.map((t) => <option key={t}>{t}</option>)}</optgroup>
          </select>
          {fiscal && <label className="note" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>valable jusqu&apos;au<input type="date" value={validite} onChange={(e) => setValidite(e.target.value)} /></label>}
        </span>
      )}
      {peutDeposer && (
        <label className="btn sm depot">
          {enCours ? "Envoi…" : dossier ? "Déposer ce document" : fichiers.length ? "+ Document" : objet === "bc_client" ? "Déposer le bon de commande du client" : "Déposer le document signé"}
          <input ref={champ} type="file" accept={TYPES} hidden disabled={enCours}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) deposer(f); }} />
        </label>
      )}
      {msg?.erreur && <span className="erreur">{msg.erreur}</span>}
      {msg?.ok && !compact && <span className="succes">{msg.ok}</span>}
    </div>
  );
}
