// Les vendeurs terrain n'ont souvent pas d'e-mail : leur compte est créé avec leur numéro de téléphone,
// converti en identifiant de connexion interne. La même conversion sert à la connexion.
export const DOMAINE_VENDEURS = "vendeur.dgs";

export function identifiantVersEmail(saisie: string) {
  const t = saisie.trim().toLowerCase();
  if (t.includes("@")) return t;
  let n = t.replace(/\D/g, "");
  if (n.startsWith("00")) n = n.slice(2);
  if (n.length > 10 && (n.startsWith("229") || n.startsWith("223"))) n = n.slice(3);
  return n ? `${n}@${DOMAINE_VENDEURS}` : t;
}
