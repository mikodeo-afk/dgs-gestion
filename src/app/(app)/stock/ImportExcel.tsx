"use client";
import { useRef, useState } from "react";
import { importerStock, type LigneImport } from "./actions";

type Option = { id: string; libelle: string };
// En-têtes reconnus (sans accents ni majuscules) → champ.
const COLONNES: Record<string, keyof LigneImport> = {
  code: "code", "code article": "code", reference_article: "code",
  designation: "designation", libelle: "designation", article: "designation",
  unite: "unite", categorie: "categorie", provenance: "provenance", "seuil d'alerte": "seuil", seuil: "seuil",
  quantite: "quantite", qte: "quantite", "quantite comptee": "quantite", "quantite recue": "quantite",
  "prix unitaire ht": "prix", "prix unitaire": "prix", pu: "prix", prix: "prix",
  fournisseur: "fournisseur", reference: "reference", "n° bl": "reference", bl: "reference",
};
const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export default function ImportExcel({ endroits }: { endroits: Option[] }) {
  const [mode, setMode] = useState<"entree" | "inventaire">("entree");
  const [ou, setOu] = useState("depot");
  const [lignes, setLignes] = useState<LigneImport[]>([]);
  const [nomFichier, setNomFichier] = useState("");
  const [msg, setMsg] = useState<{ ok?: string; erreur?: string } | null>(null);
  const [enCours, setEnCours] = useState(false);
  const champ = useRef<HTMLInputElement>(null);

  async function lire(f: File) {
    setMsg(null);
    setLignes([]);
    try {
      const { default: readXlsxFile, readSheetNames } = await import("read-excel-file");
      const feuilles = await readSheetNames(f);
      const feuille = feuilles.find((n) => norm(n) === "stock") ?? feuilles[0];
      const rows = await readXlsxFile(f, { sheet: feuille });
      const iEntete = rows.findIndex((r) => r.some((c) => COLONNES[norm(c)] === "code"));
      if (iEntete < 0) throw new Error("Colonne « Code » introuvable : utilisez le modèle.");
      const champs = rows[iEntete].map((c) => COLONNES[norm(c)]);
      const out: LigneImport[] = [];
      rows.slice(iEntete + 1).forEach((r, k) => {
        if (r.every((c) => c === null || String(c).trim() === "")) return;
        const l: LigneImport = { ligne: iEntete + k + 2, code: "" };
        r.forEach((c, j) => { const ch = champs[j]; if (ch && ch !== "ligne" && c !== null) (l as Record<string, unknown>)[ch] = String(c).trim(); });
        out.push(l);
      });
      if (!out.length) throw new Error("Aucune ligne à importer dans ce fichier.");
      setLignes(out);
      setNomFichier(f.name);
    } catch (e) {
      setMsg({ erreur: e instanceof Error ? e.message : "Fichier illisible : enregistrez-le au format .xlsx." });
    } finally {
      if (champ.current) champ.current.value = "";
    }
  }

  async function valider() {
    setEnCours(true);
    const r = await importerStock(mode, ou, lignes);
    setEnCours(false);
    setMsg(r);
    if (r?.ok) setLignes([]);
  }

  const sources = mode === "entree" ? endroits.filter((e) => !e.id.startsWith("p:")) : endroits;
  return (
    <div>
      <div className="inline">
        <label>Le fichier contient
          <select value={mode} onChange={(e) => { setMode(e.target.value as "entree" | "inventaire"); setOu("depot"); }}>
            <option value="entree">Des entrées en stock (quantités reçues)</option>
            <option value="inventaire">Un inventaire (quantités comptées)</option>
          </select>
        </label>
        <label>{mode === "entree" ? "Reçu à" : "Compté chez / à"}
          <select value={ou} onChange={(e) => setOu(e.target.value)}>
            {sources.map((l) => <option key={l.id} value={l.id}>{l.libelle}</option>)}
          </select>
        </label>
        <label className="btn depot" style={{ alignSelf: "end", borderStyle: "dashed" }}>
          📄 Choisir le fichier Excel
          <input ref={champ} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) lire(f); }} />
        </label>
        <a className="btn" style={{ alignSelf: "end" }} href="/modeles/stock.xlsx" download>Télécharger le modèle</a>
      </div>
      {lignes.length > 0 && (
        <>
          <p><b>{nomFichier}</b> : {lignes.length} ligne(s). Vérifiez l&apos;aperçu puis validez.</p>
          <div className="tbl">
            <table>
              <thead><tr><th>Ligne</th><th>Code</th><th>Désignation</th><th>Unité</th><th>Provenance</th><th className="num">Quantité</th><th className="num">Prix</th><th>Référence</th></tr></thead>
              <tbody>
                {lignes.slice(0, 30).map((l) => (
                  <tr key={l.ligne}>
                    <td className="note">{l.ligne}</td><td className="code">{l.code}</td><td>{l.designation ?? ""}</td><td>{l.unite ?? ""}</td>
                    <td>{l.provenance ?? ""}</td><td className="num">{l.quantite ?? "—"}</td><td className="num">{l.prix ?? ""}</td><td className="note">{l.reference ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {lignes.length > 30 && <p className="note">… et {lignes.length - 30} autres lignes.</p>}
          <div className="statusline">
            <button className="btn pri" type="button" onClick={valider} disabled={enCours}>{enCours ? "Import en cours…" : `Importer ${lignes.length} ligne(s)`}</button>
            <button className="btn" type="button" onClick={() => setLignes([])} disabled={enCours}>Annuler</button>
          </div>
        </>
      )}
      {msg?.erreur && <p className="erreur">{msg.erreur}</p>}
      {msg?.ok && <p className="succes">{msg.ok}</p>}
      <p className="note">Tout le fichier est enregistré, ou rien : en cas d&apos;erreur, la ligne à corriger est indiquée. Les articles inconnus sont créés (désignation et unité obligatoires).</p>
    </div>
  );
}
