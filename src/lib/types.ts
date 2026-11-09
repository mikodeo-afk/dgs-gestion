export type Poste = "pdg" | "do" | "raf" | "rh" | "compta" | "cp" | "ce" | "tech";

export const POSTES: Record<Poste, { nom: string; court: string }> = {
  pdg: { nom: "PDG / Directeur Général", court: "PDG" },
  do: { nom: "Directeur des Opérations", court: "Dir. Opérations" },
  raf: { nom: "Responsable Administratif et Financier", court: "RAF" },
  rh: { nom: "Responsable RH", court: "RH" },
  compta: { nom: "Comptable / Caissier", court: "Comptable" },
  cp: { nom: "Chef de projet", court: "Chef de projet" },
  ce: { nom: "Chef d'équipe", court: "Chef d'équipe" },
  tech: { nom: "Technicien", court: "Technicien" },
};
export const ORDRE_POSTES: Poste[] = ["pdg", "do", "raf", "rh", "compta", "cp", "ce", "tech"];
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
  actif: boolean;
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
};

export type Tache = {
  id: string;
  chantier_id: string;
  titre: string;
  assigne_id: string | null;
  avancement: number;
  echeance: string | null;
};
