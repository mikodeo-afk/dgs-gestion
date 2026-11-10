"use client";
import { useActionState } from "react";
import type { Pays } from "@/lib/types";
import { seConnecter } from "./actions";

export default function Formulaire({ inactif, pays }: { inactif: boolean; pays: Pays[] }) {
  const [etat, action, enCours] = useActionState(seConnecter, null);
  return (
    <form action={action}>
      <div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="logo" src="/logo-dgs-fond.png" alt="DGS, D General Solutions" />
        <h1>DGS Gestion</h1>
        <p className="sub">Choisissez votre pays, puis connectez-vous avec le compte créé par les RH de ce pays.</p>
      </div>
      {inactif && <p className="erreur">Votre compte n&apos;est pas encore activé. Contactez le service RH.</p>}
      {etat?.erreur && <p className="erreur">{etat.erreur}</p>}
      <label>
        Pays
        <select id="pays" name="pays" required defaultValue="">
          <option value="" disabled>Choisir…</option>
          {pays.map((p) => <option key={p.code} value={p.code}>{p.nom}{p.ville ? ` (${p.ville})` : ""}</option>)}
        </select>
      </label>
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
