// Types de documents des dossiers (sociétés, matériel). Module partagé : utilisable côté serveur
// comme côté navigateur (une constante exportée d'un fichier « use client » n'est pas lisible côté serveur).
export const DOCS_ADMIN = ["RCCM", "IFU / NIF", "Statuts", "Pièce d'identité du gérant", "Autre document administratif"];
export const DOCS_FISCAUX = ["Attestation de régularité fiscale", "Quitus fiscal", "Attestation CNSS / INPS", "Autre document fiscal"];
/** Types de documents d'un dossier : groupes proposés, et types qui exigent une date de validité. */
export type TypesDossier = { groupes: [string, string[]][]; avecValidite: string[] };
export const DOSSIER_SOCIETE: TypesDossier = { groupes: [["Administratif", DOCS_ADMIN], ["Fiscal", DOCS_FISCAUX]], avecValidite: DOCS_FISCAUX };
export const DOSSIER_MATERIEL: TypesDossier = {
  groupes: [["Avec date de validité", ["Assurance", "Visite technique", "Vignette / taxe", "Autorisation de transport"]],
            ["Autres", ["Carte grise", "Facture d'achat", "Notice / garantie", "Photo", "Autre document"]]],
  avecValidite: ["Assurance", "Visite technique", "Vignette / taxe", "Autorisation de transport"],
};
