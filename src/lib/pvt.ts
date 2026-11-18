// Ventes terrain Celtiis (contrat PVT avec SBIN SA, Bénin) : grille de primes de l'annexe 3,
// avance aux vendeurs, facture mensuelle à SBIN et échéances du contrat.

export type Offre = {
  id: string; code: string; libelle: string; segment: "B2C" | "B2B"; famille: string;
  commission: number; part_vendeur: number; part_partenaire: number; performance: boolean; actif: boolean;
};
export type Vendeur = { id: string; nom: string; telephone: string | null; numero_celtiis: string | null; piece_identite: string | null; segment: "B2C" | "B2B"; profil_id: string | null; debut: string; actif: boolean };
export type Vente = {
  id: string; mois: string; date_vente: string; vendeur_id: string | null; offre_id: string; client: string | null; ligne: string | null;
  contact: string | null; statut: "Déclarée" | "Validée" | "Rejetée"; source: string; motif: string | null;
  etat_ligne: "Active" | "Suspendue" | "Résiliée" | null; etat_maj_le: string | null;
};
export type Versement = { id: string; mois: string; vendeur_id: string; type: "Avance" | "Solde"; montant: number; verse_le: string; mode: string | null };
export type Mois = {
  mois: string; extraction_recue_le: string | null; facture_numero: string | null; facture_ht: number | null; facture_envoyee_le: string | null;
  payee_le: string | null; montant_paye: number | null; ajustement: number; ajustement_motif: string | null; note: string | null; cloture: boolean;
};

type Palier = [min: number, valeur: number];
const palier = (n: number, grille: Palier[]) => grille.reduce((v, [min, val]) => (n >= min ? val : v), 0);

/** Prime vendeur VTM (B2C), par mois, selon son nombre de ventes. */
export const primeVtm = (n: number) => palier(n, [[15, 50000], [21, 75000], [26, 100000], [31, 125000], [41, 150000]]);
/** Prime de performance du partenaire, par vente : B2C (FTTH) et B2B (FTTO). Seuils réduits les 2 premiers mois. */
export const tauxPerformanceB2c = (n: number, nouveau: boolean) => palier(n, [[nouveau ? 100 : 200, 1000], [300, 1250], [600, 1500]]);
export const tauxPerformanceB2b = (n: number, nouveau: boolean) => palier(n, [[nouveau ? 50 : 80, 1250], [150, 1500], [300, 1750]]);
/** Prime d'objectif du partenaire, forfait mensuel. */
export const primeObjectifB2c = (n: number) => palier(n, [[300, 200000], [600, 300000], [1000, 500000]]);
export const primeObjectifB2b = (n: number) => palier(n, [[150, 125000], [301, 250000], [450, 350000]]);
/** Prime de transport B2B : 1 500 par vente, 30 000 au plus par mois, les 2 premiers mois du vendeur. */
export const primeTransport = (n: number) => Math.min(30000, 1500 * n);

const ajouterMois = (iso: string, n: number) => {
  const [a, m] = iso.slice(0, 7).split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
};
export const moisSuivant = (mois: string) => ajouterMois(mois, 1);
export const moisPrecedent = (mois: string) => ajouterMois(mois, -1);
const jour = (mois: string, j: number) => `${mois.slice(0, 8)}${String(j).padStart(2, "0")}`;
const finDeMois = (mois: string) => new Date(Date.parse(moisSuivant(mois)) - 86400000).toISOString().slice(0, 10);
/** Les deux premiers mois après le début (seuils réduits, prime de transport). */
const premiersMois = (debut: string, mois: string) => mois >= debut.slice(0, 7) + "-01" && mois < ajouterMois(debut, 2);

export const MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
export const moisFr = (mois: string) => `${MOIS_FR[Number(mois.slice(5, 7)) - 1]} ${mois.slice(0, 4)}`;

/** Fenêtre de l'avance : du 30 du mois (le dernier jour en février) au 05 du mois suivant. */
export function fenetreAvance(mois: string) {
  const fin = finDeMois(mois);
  const debut = fin.slice(8) < "30" ? fin : jour(mois, 30);
  return { debut, fin: jour(moisSuivant(mois), 5) };
}

/** Échéances du contrat pour les ventes d'un mois. */
export function echeances(mois: string, m: Mois | undefined) {
  const s = moisSuivant(mois);
  const av = fenetreAvance(mois);
  const facture = m?.facture_envoyee_le;
  return [
    { libelle: "Avance aux vendeurs (sur leur réalisé)", du: av.debut, au: av.fin, fait: null as string | null },
    { libelle: "État mensuel des commandes à SBIN (art. 11)", du: null, au: jour(s, 10), fait: null },
    { libelle: "Extraction SBIN des ventes validées (art. 9.2)", du: null, au: jour(s, 15), fait: m?.extraction_recue_le ?? null },
    { libelle: "Facture des commissions à SBIN", du: null, au: null, fait: facture ?? null },
    { libelle: "Paiement SBIN (15 jours après la facture)", du: null, au: facture ? new Date(Date.parse(facture) + 15 * 86400000).toISOString().slice(0, 10) : null, fait: m?.payee_le ?? null },
  ];
}

// --- Rétention (annexe 3) -----------------------------------------------------------
// B2C : à M+3, si au moins 90 % des lignes vendues au mois M sont actives, +2 000 par ligne au vendeur (VTM)
// et +1 000 au partenaire ; sinon malus de 2 000 par client suspendu pour le partenaire.
// B2B : après 6 mois, au moins 85 % de lignes actives : +1 000 par ligne active au partenaire.
// Le statut de chaque ligne est mis à jour par le vendeur à la fin de chaque mois.
export type Retention = {
  vendeurId: string | null; segment: "B2C" | "B2B"; cohorte: string; lignes: number; actives: number; suspendues: number; aRenseigner: number;
  taux: number; seuil: number; atteint: boolean | null; bonusVendeur: number; bonusPartenaire: number; malus: number;
};

export function retention(mois: string, ventes: Vente[], offres: Map<string, Offre>): Retention[] {
  const res: Retention[] = [];
  for (const [segment, decalage, seuil] of [["B2C", 3, 90], ["B2B", 6, 85]] as const) {
    const cohorte = ajouterMois(mois, -decalage);
    const lot = ventes.filter((x) => x.mois === cohorte && x.statut === "Validée" && offres.get(x.offre_id)?.segment === segment);
    const parV = new Map<string | null, Vente[]>();
    for (const x of lot) parV.set(x.vendeur_id, [...(parV.get(x.vendeur_id) ?? []), x]);
    for (const [vendeurId, l] of parV) {
      const actives = l.filter((x) => x.etat_ligne === "Active").length;
      const suspendues = l.filter((x) => x.etat_ligne === "Suspendue" || x.etat_ligne === "Résiliée").length;
      const aRenseigner = l.length - actives - suspendues;
      const taux = l.length ? Math.round((actives * 1000) / l.length) / 10 : 0;
      const atteint = aRenseigner ? null : taux >= seuil;
      res.push({
        vendeurId, segment, cohorte, lignes: l.length, actives, suspendues, aRenseigner, taux, seuil, atteint,
        bonusVendeur: atteint && segment === "B2C" ? 2000 * actives : 0,
        bonusPartenaire: atteint ? 1000 * actives : 0,
        malus: atteint === false && segment === "B2C" ? 2000 * suspendues : 0,
      });
    }
  }
  return res;
}

export type LigneVendeur = {
  vendeur: Vendeur; declarees: number; validees: number; rejetees: number;
  partDeclaree: number; partValidee: number; vtm: number; transport: number; bonusRetention: number;
  avanceCalculee: number; avancesVersees: number; soldesVerses: number; du: number; avanceHorsFenetre: boolean;
};

/** Ce qui revient à chaque vendeur pour un mois, et ce qu'on lui a déjà versé. */
export function parVendeur(mois: string, vendeurs: Vendeur[], ventes: Vente[], offres: Map<string, Offre>, versements: Versement[], tauxAvance: number): LigneVendeur[] {
  const fen = fenetreAvance(mois);
  const ret = retention(mois, ventes, offres);
  return vendeurs.map((v) => {
    const siennes = ventes.filter((x) => x.vendeur_id === v.id && x.mois === mois);
    const ouvertes = siennes.filter((x) => x.statut !== "Rejetée");
    const valid = siennes.filter((x) => x.statut === "Validée");
    const part = (l: Vente[]) => l.reduce((a, x) => a + Number(offres.get(x.offre_id)?.part_vendeur ?? 0), 0);
    const b2cValid = valid.filter((x) => offres.get(x.offre_id)?.segment === "B2C").length;
    const b2bValid = valid.filter((x) => offres.get(x.offre_id)?.segment === "B2B").length;
    const vtm = primeVtm(b2cValid);
    const transport = premiersMois(v.debut, mois) ? primeTransport(b2bValid) : 0;
    const vers = versements.filter((x) => x.vendeur_id === v.id && x.mois === mois);
    const avances = vers.filter((x) => x.type === "Avance");
    const avancesVersees = avances.reduce((a, x) => a + Number(x.montant), 0);
    const soldesVerses = vers.filter((x) => x.type === "Solde").reduce((a, x) => a + Number(x.montant), 0);
    const partValidee = part(valid);
    const bonusRetention = ret.filter((r) => r.vendeurId === v.id).reduce((a, r) => a + r.bonusVendeur, 0);
    return {
      vendeur: v, declarees: ouvertes.length, validees: valid.length, rejetees: siennes.length - ouvertes.length,
      partDeclaree: part(ouvertes), partValidee, vtm, transport, bonusRetention,
      avanceCalculee: Math.round((part(ouvertes) * tauxAvance) / 100),
      avancesVersees, soldesVerses,
      du: partValidee + vtm + transport + bonusRetention - avancesVersees - soldesVerses,
      avanceHorsFenetre: avances.some((x) => x.verse_le < fen.debut || x.verse_le > fen.fin),
    };
  });
}

/** Facture du mois à SBIN, d'après les ventes validées (extraction). */
export function factureSbin(mois: string, ventes: Vente[], offres: Map<string, Offre>, vendeurs: Vendeur[], debutContrat: string, ajustement: number, tva: number) {
  const valid = ventes.filter((x) => x.mois === mois && x.statut === "Validée");
  const nouveau = premiersMois(debutContrat, mois);
  const o = (x: Vente) => offres.get(x.offre_id);
  const commissions = valid.reduce((a, x) => a + Number(o(x)?.commission ?? 0), 0);
  const partVendeurs = valid.reduce((a, x) => a + Number(o(x)?.part_vendeur ?? 0), 0);
  const nB2c = valid.filter((x) => o(x)?.segment === "B2C" && o(x)?.performance).length;
  const nFtto = valid.filter((x) => o(x)?.famille === "FTTO" && o(x)?.performance).length;
  const performance = nB2c * tauxPerformanceB2c(nB2c, nouveau) + nFtto * tauxPerformanceB2b(nFtto, nouveau);
  const objectif = primeObjectifB2c(nB2c) + primeObjectifB2b(nFtto);
  const lignes = parVendeur(mois, vendeurs, ventes, offres, [], 0);
  const vtm = lignes.reduce((a, l) => a + l.vtm, 0);
  const transport = lignes.reduce((a, l) => a + l.transport, 0);
  const ret = retention(mois, ventes, offres);
  const retentionVendeurs = ret.reduce((a, r) => a + r.bonusVendeur, 0);
  const retentionPartenaire = ret.reduce((a, r) => a + r.bonusPartenaire - r.malus, 0);
  const ht = commissions + performance + objectif + vtm + transport + retentionVendeurs + retentionPartenaire + Number(ajustement || 0);
  const montantTva = Math.round((ht * tva) / 100);
  return {
    nombre: valid.length, nB2c, nFtto, nouveau, commissions, partVendeurs, partPartenaire: commissions - partVendeurs,
    performance, objectif, vtm, transport, retentionVendeurs, retentionPartenaire, retentionARenseigner: ret.reduce((a, r) => a + r.aRenseigner, 0),
    ajustement: Number(ajustement || 0), ht, tva: montantTva, ttc: ht + montantTva,
    margeDgs: commissions - partVendeurs + performance + objectif + retentionPartenaire + Number(ajustement || 0),
  };
}

// --- Lecture de l'extraction SBIN (Excel) ----------------------------------------
export type LigneExtraction = { ligne: string; offre: string; offreLue: string; date: string; client: string };

const norm = (t: unknown) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Retrouve le code d'offre à partir du libellé SBIN (code exact, libellé exact, ou débit + gamme). */
export function reconnaitreOffre(texte: string, offres: Offre[]): string | null {
  const n = norm(texte);
  if (!n) return null;
  const exact = offres.find((o) => norm(o.code) === n || norm(o.libelle) === n);
  if (exact) return exact.code;
  const debit = n.match(/(\d+)m/)?.[1];
  const duree = /12mois|12m(?!b)/.test(n) ? "-12M" : /6mois|6m(?!b)/.test(n) ? "-6M" : "";
  const candidats = offres.filter((o) => {
    const c = norm(o.libelle);
    if (debit && !c.includes(debit + "m")) return false;
    const gammes = ["home", "promax", "promega", "officemax", "officemega", "pro", "fwa", "businessconnect", "basic", "premium"];
    const g = gammes.find((x) => n.includes(x));
    return Boolean(g && c.includes(g)) && o.code.endsWith(duree) && (duree || !/-(6|12)M$/.test(o.code));
  });
  return candidats.length === 1 ? candidats[0].code : null;
}

const enDate = (v: unknown) => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const t = String(v ?? "").trim();
  const fr = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (fr) return `${fr[3]}-${fr[2].padStart(2, "0")}-${fr[1].padStart(2, "0")}`;
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : "";
};

/** Lit les lignes d'un fichier Excel : repère les colonnes ligne / offre / date / client par leurs en-têtes. */
export function lireExtraction(rows: unknown[][], offres: Offre[]): LigneExtraction[] {
  const iEntete = rows.findIndex((r) => r.some((c) => /ligne|msisdn|numero|num[eé]ro|compte|abonn/i.test(String(c ?? ""))));
  if (iEntete < 0) throw new Error("Colonnes introuvables : il faut au moins une colonne « Ligne » (ou Numéro, MSISDN) et une colonne « Offre ».");
  const ent = rows[iEntete].map((c) => norm(c));
  const col = (re: RegExp) => ent.findIndex((c) => re.test(c));
  const cLigne = col(/ligne|msisdn|numero|compte|abonne/);
  const cOffre = col(/offre|produit|forfait|formule|pack|service/);
  const cDate = col(/activation|miseenservice|date/);
  const cClient = col(/client|nom|raisonsociale/);
  if (cOffre < 0) throw new Error("Colonne « Offre » (ou Produit, Forfait) introuvable.");
  return rows.slice(iEntete + 1)
    .map((r) => {
      const offreLue = String(r[cOffre] ?? "").trim();
      return {
        ligne: String(r[cLigne] ?? "").replace(/[^0-9A-Za-z-]/g, ""),
        offreLue,
        offre: reconnaitreOffre(offreLue, offres) ?? offreLue,
        date: cDate >= 0 ? enDate(r[cDate]) : "",
        client: cClient >= 0 ? String(r[cClient] ?? "").trim() : "",
      };
    })
    .filter((l) => l.ligne);
}
