export type Poste = "pdg" | "do" | "rt" | "raf" | "rh" | "compta" | "commercial" | "rla" | "cp" | "ce" | "tech";

export const POSTES: Record<Poste, { nom: string; court: string }> = {
  pdg: { nom: "PDG / Directeur Général", court: "PDG" },
  do: { nom: "Directeur des Opérations", court: "Dir. Opérations" },
  rt: { nom: "Responsable technique (qualiticien en chef)", court: "Resp. technique" },
  raf: { nom: "Responsable Administratif et Financier", court: "RAF" },
  rh: { nom: "Responsable RH", court: "RH" },
  compta: { nom: "Comptable / Caissier", court: "Comptable" },
  commercial: { nom: "Responsable commercial", court: "Commercial" },
  rla: { nom: "Responsable Logistique et Achats", court: "RLA" },
  cp: { nom: "Chef de projet", court: "Chef de projet" },
  ce: { nom: "Chef d'équipe", court: "Chef d'équipe" },
  tech: { nom: "Technicien", court: "Technicien" },
};
export const ORDRE_POSTES: Poste[] = ["pdg", "do", "rt", "raf", "rh", "compta", "commercial", "rla", "cp", "ce", "tech"];
export const POSTES_TERRAIN: Poste[] = ["cp", "ce", "tech"];
export const PERIMETRE: Partial<Record<Poste, string>> = { cp: "ses chantiers", ce: "son équipe", tech: "lui-même" };

export type Profil = {
  id: string;
  nom: string;
  email: string | null;
  poste: Poste;
  responsable_id: string | null;
  telephone: string | null;
  contrat: string;
  date_embauche: string;
  date_fin: string | null;
  visage_enregistre: boolean;
  photo_reference?: string | null;
  actif: boolean;
  pays: string;
  acces_groupe: boolean;
  pays_actif: string | null;
};

export type Pays = { code: string; nom: string; ville: string | null; devise: string };
export type Identite = Pays & {
  raison_sociale: string | null; rccm: string | null; ifu: string | null;
  adresse: string | null; telephone: string | null; email: string | null;
};

export type Chantier = {
  id: string;
  code: string;
  nom: string;
  domaine: "BTP" | "Énergie" | "Télécoms";
  lieu: string | null;
  client: string | null;
  chef_projet_id: string | null;
  date_debut: string;
  statut: string;
  rayon_pointage: number;
  latitude?: number | null;
  longitude?: number | null;
  validation?: "À valider" | "Validé";
};

export type Tache = {
  id: string;
  chantier_id: string;
  titre: string;
  assigne_id: string | null;
  avancement: number;
  echeance: string | null;
};

export type Tiers = {
  id: string; type: "client" | "fournisseur" | "prestataire"; nom: string; ifu: string | null; rccm: string | null;
  adresse: string | null; telephone: string | null; email: string | null; contact: string | null; actif: boolean;
};
export type LigneBordereau = { id: string; tiers_id: string; code: string | null; designation: string; unite: string; prix_unitaire_ht: number; actif: boolean };
export const TYPES_TIERS: Record<Tiers["type"], string> = { client: "Client", fournisseur: "Fournisseur", prestataire: "Prestataire" };
export const VOIT_TIERS = ["tiers.gerer", "fin.voir", "pv.initier", "chantier.creer", "fc.emettre", "ff.enregistrer", "bc.initier", "da.demander", "pf.initier"];
