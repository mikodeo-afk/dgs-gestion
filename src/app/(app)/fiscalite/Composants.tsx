"use client";
import { useActionState, useState, useTransition } from "react";
import { demanderAgent, enregistrerDeclaration, type Echange } from "./actions";

/** Formulaire « J'ai déclaré » sous une déclaration calculée par l'agent. */
export function FormDeclaration({ mois, obligation, periode, montant }: { mois: string; obligation: string; periode: string; montant: number }) {
  const [etat, action, enCours] = useActionState(enregistrerDeclaration, null);
  const id = `${obligation}-${periode}`;
  return (
    <details className="corr">
      <summary className="btn sm pri">J&apos;ai déclaré</summary>
      <div>
        <form action={action}>
          <input type="hidden" name="mois" value={mois} />
          <input type="hidden" name="obligation" value={obligation} />
          <input type="hidden" name="periode" value={periode} />
          <label htmlFor={`m-${id}`}>Montant déclaré (FCFA)
            <input id={`m-${id}`} name="montant" type="number" min="0" step="1" defaultValue={montant} />
          </label>
          <label htmlFor={`r-${id}`}>Référence (n° de déclaration ou de quittance)
            <input id={`r-${id}`} name="reference" />
          </label>
          <label htmlFor={`n-${id}`}>Remarque
            <input id={`n-${id}`} name="note" />
          </label>
          <label htmlFor={`p-${id}`} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <input id={`p-${id}`} name="payee" type="checkbox" value="1" defaultChecked /> Déjà payée
          </label>
          <button className="btn sm pri" type="submit" disabled={enCours}>{enCours ? "Enregistrement…" : "Enregistrer"}</button>
          {etat?.erreur && <span className="erreur">{etat.erreur}</span>}
          {etat?.ok && <span className="succes">{etat.ok}</span>}
        </form>
      </div>
    </details>
  );
}

const SUGGESTIONS = [
  "Que dois-je déclarer ce mois-ci, et avant quelle date ?",
  "Explique-moi le calcul de la TVA de ce mois.",
  "Sommes-nous en retard quelque part ? Quelles pénalités risquons-nous ?",
  "Que faut-il préparer pour le bilan et l'IS de fin avril ?",
];

/** Discussion avec l'agent comptable IA. */
export function Assistant({ mois, active }: { mois: string; active: boolean }) {
  const [echanges, setEchanges] = useState<Echange[]>([]);
  const [question, setQuestion] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();

  const envoyer = (texte: string) => {
    const t = texte.trim();
    if (!t || enCours) return;
    const suite: Echange[] = [...echanges, { role: "user", texte: t }];
    setEchanges(suite);
    setQuestion("");
    setErreur(null);
    demarrer(async () => {
      const r = await demanderAgent(mois, suite);
      if (r.reponse) setEchanges([...suite, { role: "assistant", texte: r.reponse }]);
      else { setErreur(r.erreur ?? "Erreur inconnue."); setEchanges(echanges); setQuestion(t); }
    });
  };

  if (!active)
    return <p className="note">L&apos;agent IA s&apos;active dès que la clé ANTHROPIC_API_KEY est ajoutée dans les réglages Vercel. Le calendrier et les calculs ci-dessus fonctionnent sans elle.</p>;

  return (
    <div className="agent">
      {echanges.length === 0 && (
        <div className="statusline">
          {SUGGESTIONS.map((s) => <button key={s} type="button" className="btn sm" onClick={() => envoyer(s)} disabled={enCours}>{s}</button>)}
        </div>
      )}
      <div className="fil" aria-live="polite">
        {echanges.map((e, i) => (
          <div key={i} className={`bulle ${e.role === "user" ? "moi" : "ia"}`}>
            <b>{e.role === "user" ? "Vous" : "Agent comptable DGS"}</b>
            <div>{e.texte}</div>
          </div>
        ))}
        {enCours && <div className="bulle ia"><b>Agent comptable DGS</b><div className="note">L&apos;agent analyse vos données…</div></div>}
      </div>
      {erreur && <p className="erreur">{erreur}</p>}
      <form className="question" onSubmit={(ev) => { ev.preventDefault(); envoyer(question); }}>
        <label htmlFor="q-agent" className="note">Votre question à l&apos;agent comptable</label>
        <textarea id="q-agent" rows={3} value={question} onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); envoyer(question); } }}
          placeholder="Ex. : combien de CNSS devons-nous payer pour le trimestre ?" />
        <div className="statusline">
          <button className="btn pri" type="submit" disabled={enCours || !question.trim()}>{enCours ? "Réponse en cours…" : "Envoyer"}</button>
          {echanges.length > 0 && <button className="btn sm" type="button" onClick={() => { setEchanges([]); setErreur(null); }} disabled={enCours}>Nouvelle conversation</button>}
        </div>
      </form>
    </div>
  );
}
