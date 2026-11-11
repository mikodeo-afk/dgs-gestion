"use client";
import { useRef, useState } from "react";
import { importerStock, type LigneImport } from "./actions";
import { lireBordereau, type LigneLue } from "./scan-actions";

type Option = { id: string; libelle: string };
type Ligne = LigneLue & { garder: boolean };

/** Réduit la photo (bord le plus long ≤ 1600 px, JPEG) pour l'envoi. */
async function reduire(f: File): Promise<string> {
  const img = await createImageBitmap(f);
  const k = Math.min(1, 1600 / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * k);
  c.height = Math.round(img.height * k);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85);
}

export default function ScanBordereau({ endroits, clients }: { endroits: Option[]; clients: Option[] }) {
  const [ou, setOu] = useState("depot");
  const [provenance, setProvenance] = useState("DGS");
  const [apercu, setApercu] = useState("");
  const [lignes, setLignes] = useState<Ligne[]>([]);
  const [entete, setEntete] = useState({ fournisseur: "", numero: "", type: "", date: "", remarque: "" });
  const [etape, setEtape] = useState<"" | "lecture" | "import">("");
  const [msg, setMsg] = useState<{ ok?: string; erreur?: string } | null>(null);
  const champ = useRef<HTMLInputElement>(null);

  async function photo(f: File) {
    setMsg(null);
    setLignes([]);
    setEtape("lecture");
    try {
      const image = await reduire(f);
      setApercu(image);
      const r = await lireBordereau(image);
      if (r.erreur || !r.lecture) { setMsg({ erreur: r.erreur ?? "Lecture impossible." }); return; }
      const l = r.lecture;
      setEntete({ fournisseur: l.fournisseur, numero: l.numero, type: l.type_document, date: l.date, remarque: l.remarque });
      setLignes(l.lignes.map((x) => ({ ...x, garder: true })));
    } catch {
      setMsg({ erreur: "Photo illisible : reprenez-la (format JPEG ou PNG)." });
    } finally {
      setEtape("");
      if (champ.current) champ.current.value = "";
    }
  }

  const maj = (i: number, p: Partial<Ligne>) => setLignes((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const retenues = lignes.filter((l) => l.garder);

  async function valider() {
    const reference = [entete.type || "Document", entete.numero].filter(Boolean).join(" n° ") + " (photo)";
    const aImporter: LigneImport[] = retenues.map((l, k) => ({
      ligne: k + 1, code: l.code, designation: l.designation, unite: l.unite, provenance,
      quantite: String(l.quantite), prix: provenance === "DGS" && l.prix_unitaire != null ? String(l.prix_unitaire) : undefined,
      fournisseur: entete.fournisseur || undefined, reference,
    }));
    setEtape("import");
    const r = await importerStock("entree", ou, aImporter);
    setEtape("");
    setMsg(r);
    if (r?.ok) { setLignes([]); setApercu(""); }
  }

  return (
    <div>
      <div className="inline">
        <label>Reçu à
          <select value={ou} onChange={(e) => setOu(e.target.value)}>
            {endroits.filter((e) => !e.id.startsWith("p:")).map((l) => <option key={l.id} value={l.id}>{l.libelle}</option>)}
          </select>
        </label>
        <label>Matériel
          <select value={provenance} onChange={(e) => setProvenance(e.target.value)}>
            <option value="DGS">Acheté par DGS</option>
            {clients.map((c) => <option key={c.id} value={c.libelle}>Fourni par {c.libelle}</option>)}
          </select>
        </label>
        <label className="btn depot" style={{ alignSelf: "end", borderStyle: "dashed" }}>
          📷 {etape === "lecture" ? "Lecture en cours…" : "Photographier le bordereau ou la facture"}
          <input ref={champ} type="file" accept="image/*" capture="environment" hidden disabled={etape !== ""}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) photo(f); }} />
        </label>
      </div>
      {etape === "lecture" && <p className="note">L&apos;application lit le document, cela prend une vingtaine de secondes…</p>}

      {lignes.length > 0 && (
        <>
          <div className="inline" style={{ alignItems: "flex-start" }}>
            {apercu && <img src={apercu} alt="Document photographié" style={{ maxWidth: 160, borderRadius: 6, border: "1px solid var(--bord, #ddd)" }} />}
            <div className="inline">
              <label>Fournisseur<input value={entete.fournisseur} onChange={(e) => setEntete({ ...entete, fournisseur: e.target.value })} /></label>
              <label>N° du document<input value={entete.numero} onChange={(e) => setEntete({ ...entete, numero: e.target.value })} /></label>
              <label>Type<input value={entete.type} onChange={(e) => setEntete({ ...entete, type: e.target.value })} /></label>
            </div>
          </div>
          {entete.remarque && <p className="erreur">À vérifier : {entete.remarque}</p>}
          <p>Vérifiez et corrigez chaque ligne avant d&apos;enregistrer : la lecture automatique peut se tromper.</p>
          <div className="tbl">
            <table>
              <thead><tr><th></th><th>Code</th><th>Désignation</th><th>Unité</th><th className="num">Quantité</th>{provenance === "DGS" && <th className="num">Prix unitaire</th>}</tr></thead>
              <tbody>
                {lignes.map((l, i) => (
                  <tr key={i} style={l.garder ? undefined : { opacity: 0.45 }}>
                    <td><input type="checkbox" checked={l.garder} onChange={(e) => maj(i, { garder: e.target.checked })} aria-label="Garder la ligne" /></td>
                    <td><input value={l.code} size={10} onChange={(e) => maj(i, { code: e.target.value.toUpperCase() })} />
                      {l.nouveau && <div className="note">nouvel article</div>}</td>
                    <td><input value={l.designation} onChange={(e) => maj(i, { designation: e.target.value })} /></td>
                    <td><input value={l.unite} size={6} onChange={(e) => maj(i, { unite: e.target.value })} /></td>
                    <td className="num"><input type="number" step="any" value={l.quantite} style={{ width: 90 }} onChange={(e) => maj(i, { quantite: Number(e.target.value) })} /></td>
                    {provenance === "DGS" && (
                      <td className="num"><input type="number" step="any" value={l.prix_unitaire ?? ""} style={{ width: 110 }}
                        onChange={(e) => maj(i, { prix_unitaire: e.target.value === "" ? null : Number(e.target.value) })} /></td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="statusline">
            <button className="btn pri" type="button" onClick={valider} disabled={etape !== "" || !retenues.length}>
              {etape === "import" ? "Enregistrement…" : `Enregistrer ${retenues.length} ligne(s) en stock`}
            </button>
            <button className="btn" type="button" onClick={() => { setLignes([]); setApercu(""); }} disabled={etape !== ""}>Annuler</button>
          </div>
        </>
      )}
      {msg?.erreur && <p className="erreur">{msg.erreur}</p>}
      {msg?.ok && <p className="succes">{msg.ok}</p>}
      <p className="note">La photo sert seulement à remplir le tableau : rien n&apos;est enregistré avant votre validation. Les articles inconnus sont créés avec le code proposé.</p>
    </div>
  );
}
