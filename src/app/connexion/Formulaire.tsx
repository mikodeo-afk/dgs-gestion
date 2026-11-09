"use client";
import { useActionState } from "react";
import { seConnecter } from "./actions";

export default function Formulaire({ inactif }: { inactif: boolean }) {
  const [etat, action, enCours] = useActionState(seConnecter, null);
  return (
    <form action={action}>
      <div>
        <h1>DGS Bamako</h1>
        <p className="sub">Gestion des activités. Connectez-vous avec le compte créé par les RH.</p>
      </div>
      {inactif && <p className="erreur">Votre compte n&apos;est pas encore activé. Contactez le service RH.</p>}
      {etat?.erreur && <p className="erreur">{etat.erreur}</p>}
      <label>
        E-mail
        <input id="email" name="email" type="email" required autoComplete="email" />
      </label>
      <label>
        Mot de passe
        <input id="motdepasse" name="motdepasse" type="password" required autoComplete="current-password" />
      </label>
      <button className="btn pri" type="submit" disabled={enCours}>
        {enCours ? "Connexion…" : "Se connecter"}
      </button>
    </form>
  );
}
