"use client";
import { useActionState, useState } from "react";
import { creerArticle, declarerUtilisation, mouvement } from "./actions";

type Etat = { ok?: string; erreur?: string } | null;
type Option = { id: string; libelle: string };
function Retour({ etat }: { etat: Etat }) {
  if (etat?.erreur) return <p className="erreur" style={{ gridColumn: "1/-1" }}>{etat.erreur}</p>;
  if (etat?.ok) return <p className="succes" style={{ gridColumn: "1/-1" }}>{etat.ok}</p>;
  return null;
}

export function FormArticle({ clients }: { clients: Option[] }) {
  const [etat, action, enCours] = useActionState(creerArticle, null);
  return (
    <form className="inline" action={action}>
      <label>Code<input name="code" required placeholder="ex. CIM-50" /></label>
      <label>Désignation<input name="designation" required placeholder="ex. Câble drop 2 FO" /></label>
      <label>Provenance
        <select name="client_id" defaultValue="">
          <option value="">Acheté par DGS</option>
          {clients.map((c) => <option key={c.id} value={c.id}>Fourni par {c.libelle}</option>)}
        </select>
      </label>
      <label>Catégorie<input name="categorie" placeholder="ex. Fibre optique" list="cat-articles" /></label>
      <datalist id="cat-articles"><option>Fibre optique</option><option>Génie civil</option><option>Électricité</option><option>Quincaillerie</option><option>EPI</option></datalist>
      <label>Unité<input name="unite" required placeholder="pièce, m, sac…" /></label>
      <label>Seuil d&apos;alerte<input name="seuil" type="number" min="0" step="any" defaultValue={0} /></label>
      <button className="btn pri" type="submit" disabled={enCours}>Créer l&apos;article</button>
      <Retour etat={etat} />
    </form>
  );
}

const TYPES = {
  deplacer: "Dotation, retour ou transfert",
  entree: "Entrée (achat reçu ou matériel remis par le client)",
  utilisation: "Utilisation (matériel posé / consommé)",
  inventaire: "Inventaire (comptage)",
} as const;

export function FormMouvement({ articles, endroits, chantiers, bcs }: { articles: (Option & { client: boolean })[]; endroits: Option[]; chantiers: Option[]; bcs: Option[] }) {
  const [etat, action, enCours] = useActionState(mouvement, null);
  const [type, setType] = useState<keyof typeof TYPES>("deplacer");
  const [de, setDe] = useState("depot");
  const [article, setArticle] = useState("");
  const art = articles.find((a) => a.id === article);
  const sources = type === "entree" ? endroits.filter((e) => !e.id.startsWith("p:")) : endroits;
  return (
    <form className="inline" action={action}>
      <label>Opération
        <select name="type" value={type} onChange={(e) => { setType(e.target.value as keyof typeof TYPES); setDe("depot"); }}>
          {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label>Article
        <select name="article_id" required value={article} onChange={(e) => setArticle(e.target.value)}>
          <option value="">— Choisir —</option>
          {articles.map((a) => <option key={a.id} value={a.id}>{a.libelle}</option>)}
        </select>
      </label>
      <input type="hidden" name="article_libelle" value={art?.libelle ?? ""} />
      <label>{type === "entree" ? "Reçu à" : type === "deplacer" ? "De" : type === "inventaire" ? "Compté chez / à" : "Utilisé depuis"}
        <select name="de" value={de} onChange={(e) => setDe(e.target.value)}>
          {sources.map((l) => <option key={l.id} value={l.id}>{l.libelle}</option>)}
        </select>
      </label>
      {type === "deplacer" && (
        <label>Vers
          <select name="vers" required>
            {endroits.filter((l) => l.id !== de).map((l) => <option key={l.id} value={l.id}>{l.libelle}</option>)}
          </select>
        </label>
      )}
      {type === "utilisation" && !de.startsWith("ch:") && (
        <label>Sur le chantier
          <select name="chantier" required defaultValue="">
            <option value="">— Choisir —</option>
            {chantiers.map((l) => <option key={l.id} value={l.id}>{l.libelle}</option>)}
          </select>
        </label>
      )}
      <label>{type === "inventaire" ? "Quantité comptée" : "Quantité"}<input name="quantite" type="number" min="0" step="any" required /></label>
      {type === "entree" && !art?.client && (
        <>
          <label>Prix unitaire HT (FCFA)<input name="prix" type="number" min="0" step="1" required /></label>
          <label>Bon de commande
            <select name="bc" defaultValue="">
              <option value="">— Aucun —</option>
              {bcs.map((b) => <option key={b.id} value={b.id}>{b.libelle}</option>)}
            </select>
          </label>
          <label>Fournisseur<input name="fournisseur" /></label>
        </>
      )}
      <label>Motif / référence<input name="motif" placeholder={type === "deplacer" ? "ex. Dotation du jour" : "ex. BL n°…, dossier client…"} /></label>
      <button className="btn pri" type="submit" disabled={enCours}>Enregistrer</button>
      {type === "deplacer" && <p className="note" style={{ gridColumn: "1/-1" }}>Vers une personne : dotation. D&apos;une personne vers le dépôt ou un chantier : retour du matériel non utilisé. Le reste : transfert.</p>}
      {type === "entree" && art?.client && <p className="note" style={{ gridColumn: "1/-1" }}>Matériel du client : il entre sans valeur pour DGS, au nom du client.</p>}
      <Retour etat={etat} />
    </form>
  );
}

export function FormUtilisation({ articles, chantiers }: { articles: (Option & { max: number })[]; chantiers: Option[] }) {
  const [etat, action, enCours] = useActionState(declarerUtilisation, null);
  const [article, setArticle] = useState(articles[0]?.id ?? "");
  const art = articles.find((a) => a.id === article);
  return (
    <form className="inline" action={action}>
      <label>Matériel
        <select name="article_id" value={article} onChange={(e) => setArticle(e.target.value)}>
          {articles.map((a) => <option key={a.id} value={a.id}>{a.libelle}</option>)}
        </select>
      </label>
      <input type="hidden" name="article_libelle" value={art?.libelle ?? ""} />
      <label>Quantité utilisée<input name="quantite" type="number" min="0" max={art?.max} step="any" required /></label>
      <label>Chantier
        <select name="chantier" required defaultValue={chantiers.length === 1 ? chantiers[0].id : ""}>
          <option value="">— Choisir —</option>
          {chantiers.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
        </select>
      </label>
      <label>Référence (client, dossier…)<input name="motif" /></label>
      <button className="btn pri" type="submit" disabled={enCours}>Déclarer l&apos;utilisation</button>
      <p className="note" style={{ gridColumn: "1/-1" }}>Le matériel non utilisé se rend au gestionnaire, qui enregistre le retour.</p>
      <Retour etat={etat} />
    </form>
  );
}
