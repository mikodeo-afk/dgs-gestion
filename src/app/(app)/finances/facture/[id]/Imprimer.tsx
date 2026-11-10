"use client";
export default function Imprimer() {
  return <button className="btn pri" type="button" onClick={() => window.print()}>Imprimer ou enregistrer en PDF</button>;
}
