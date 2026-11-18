// Ventes terrain Celtiis (contrat PVT avec SBIN SA, Bénin) : grille de primes de l'annexe 3,
// avance aux vendeurs, facture mensuelle à SBIN et échéances du contrat.

export type Offre = {
  id: string; code: string; libelle: string; segment: "B2C" | "B2B"; famille: string;
  commission: number; part_vendeur: number; part_partenaire: number; performance: boolean; actif: boolean;
};
export type Vendeur = { id: string; nom: string; telephone: string | null; numero_celtiis: string | null; piece_identite: string | null; segment: "B2C" | "B2B"; profil_id: string | null; debut: string; actif: boolean; login_sbin?: string | null };
export type Vente = {
  id: string; mois: string; date_vente: string; vendeur_id: string | null; offre_id: string; client: string | null; ligne: string | null;
  contact: string | null; statut: "Déclarée" | "Validée" | "Reportée" | "Rejetée"; source: string; motif: string | null;
  etat_ligne: "Active" | "Suspendue" | "Résiliée" | null; etat_maj_le: string | null;
};
export type Versement = { id: string; mois: string; vendeur_id: string; type: "Avance" | "Solde"; montant: number; verse_le: string; mode: string | null };
export type Mois = {
  mois: string; extraction_recue_le: string | null; facture_numero: string | null; facture_ht: number | null; facture_envoyee_le: string | null;
  payee_le: string | null; montant_paye: number | null; ajustement: number; ajustement_motif: string | null; note: string | null; cloture: boolean;
  definitive_le?: string | null; pv_b2c_id?: string | null; pv_b2b_id?: string | null;
};

type Palier = [min: number, valeur: number];
const palier = (n: number, grille: Palier[]) => grille.reduce((v, [min, val]) => (n >= min ? val : v), 0);

/** Prime vendeur VTM (B2C), par mois, selon son nombre de ventes. */
export const primeVtm = (n: number) => palier(n, [[15, 50000], [21, 75000], [26, 100000], [31, 125000], [41, 150000]]);
/** Prime vendeur VTB (B2B), par mois, selon son nombre de ventes (plan de commission SBIN). */
export const primeVtb = (n: number) => palier(n, [[5, 25000], [11, 50000], [16, 75000], [21, 100000]]);
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
    { libelle: "Extraction définitive enregistrée (PV de réception)", du: null, au: null, fait: m?.definitive_le ?? null },
    { libelle: "Facture des commissions à SBIN (Finances)", du: null, au: null, fait: facture ?? null },
    { libelle: "Encaissement du paiement SBIN (15 jours après la facture)", du: null, au: facture ? new Date(Date.parse(facture) + 15 * 86400000).toISOString().slice(0, 10) : null, fait: m?.payee_le ?? null },
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
  partDeclaree: number; partValidee: number; vtm: number; vtb: number; transport: number; bonusRetention: number; reportees: number;
  avanceCalculee: number; avancesVersees: number; soldesVerses: number; du: number; avanceHorsFenetre: boolean;
  previsionnel: boolean;
};
export type Previsionnel = { vendeur_id: string; ventes: number; part: number; taux: number; avance: number };

/**
 * Ce qui revient à chaque vendeur pour un mois, et ce qu'on lui a déjà versé.
 * À partir du 1er du mois suivant, l'avance vient du prévisionnel figé (ventes déclarées à cette date).
 */
export function parVendeur(mois: string, vendeurs: Vendeur[], ventes: Vente[], offres: Map<string, Offre>, versements: Versement[], tauxAvance: number, previsionnel: Previsionnel[] = []): LigneVendeur[] {
  const fen = fenetreAvance(mois);
  const ret = retention(mois, ventes, offres);
  const fige = previsionnel.length > 0;
  return vendeurs.map((v) => {
    const siennes = ventes.filter((x) => x.vendeur_id === v.id && x.mois === mois);
    const ouvertes = siennes.filter((x) => x.statut !== "Rejetée");
    const reportees = siennes.filter((x) => x.statut === "Reportée").length;
    const valid = siennes.filter((x) => x.statut === "Validée");
    const part = (l: Vente[]) => l.reduce((a, x) => a + Number(offres.get(x.offre_id)?.part_vendeur ?? 0), 0);
    const b2cValid = valid.filter((x) => offres.get(x.offre_id)?.segment === "B2C").length;
    const b2bValid = valid.filter((x) => offres.get(x.offre_id)?.segment === "B2B").length;
    const vtm = primeVtm(b2cValid);
    const vtb = primeVtb(b2bValid);
    const transport = premiersMois(v.debut, mois) ? primeTransport(b2bValid) : 0;
    const vers = versements.filter((x) => x.vendeur_id === v.id && x.mois === mois);
    const avances = vers.filter((x) => x.type === "Avance");
    const avancesVersees = avances.reduce((a, x) => a + Number(x.montant), 0);
    const soldesVerses = vers.filter((x) => x.type === "Solde").reduce((a, x) => a + Number(x.montant), 0);
    const partValidee = part(valid);
    const prev = previsionnel.find((p) => p.vendeur_id === v.id);
    const bonusRetention = ret.filter((r) => r.vendeurId === v.id).reduce((a, r) => a + r.bonusVendeur, 0);
    return {
      vendeur: v, declarees: ouvertes.length, validees: valid.length, rejetees: siennes.length - ouvertes.length,
      partDeclaree: prev ? Number(prev.part) : part(ouvertes), partValidee, vtm, vtb, transport, bonusRetention, reportees,
      avanceCalculee: prev ? Number(prev.avance) : fige ? 0 : Math.round((part(ouvertes) * tauxAvance) / 100),
      previsionnel: Boolean(prev),
      avancesVersees, soldesVerses,
      du: partValidee + vtm + vtb + transport + bonusRetention - avancesVersees - soldesVerses,
      avanceHorsFenetre: avances.some((x) => x.verse_le < fen.debut || x.verse_le > fen.fin),
    };
  });
}

export type Facture = {
  nombre: number; nPerf: number; commissions: number; partVendeurs: number; partPartenaire: number;
  performance: number; objectif: number; primesVendeurs: number; transport: number;
  retentionVendeurs: number; retentionPartenaire: number; retentionARenseigner: number; ht: number;
};

/**
 * Facture du mois à SBIN, d'après les ventes validées (extraction), séparée en B2C (FTTH) et B2B (FTTO…)
 * comme les récapitulatifs SBIN. Les arriérés validés ce mois-ci comptent dans ce mois.
 */
export function factureSbin(mois: string, ventes: Vente[], offres: Map<string, Offre>, vendeurs: Vendeur[], debutContrat: string, ajustement: number, tva: number) {
  const nouveau = premiersMois(debutContrat, mois);
  const o = (x: Vente) => offres.get(x.offre_id);
  const lignes = parVendeur(mois, vendeurs, ventes, offres, [], 0);
  const ret = retention(mois, ventes, offres);
  const calc = (seg: "B2C" | "B2B"): Facture => {
    const valid = ventes.filter((x) => x.mois === mois && x.statut === "Validée" && o(x)?.segment === seg);
    const commissions = valid.reduce((a, x) => a + Number(o(x)?.commission ?? 0), 0);
    const partVendeurs = valid.reduce((a, x) => a + Number(o(x)?.part_vendeur ?? 0), 0);
    const nPerf = valid.filter((x) => o(x)?.performance && (seg === "B2C" || o(x)?.famille === "FTTO")).length;
    const performance = nPerf * (seg === "B2C" ? tauxPerformanceB2c(nPerf, nouveau) : tauxPerformanceB2b(nPerf, nouveau));
    const objectif = seg === "B2C" ? primeObjectifB2c(nPerf) : primeObjectifB2b(nPerf);
    const primesVendeurs = lignes.reduce((a, l) => a + (seg === "B2C" ? l.vtm : l.vtb), 0);
    const transport = seg === "B2B" ? lignes.reduce((a, l) => a + l.transport, 0) : 0;
    const r = ret.filter((x) => x.segment === seg);
    const retentionVendeurs = r.reduce((a, x) => a + x.bonusVendeur, 0);
    const retentionPartenaire = r.reduce((a, x) => a + x.bonusPartenaire - x.malus, 0);
    return {
      nombre: valid.length, nPerf, commissions, partVendeurs, partPartenaire: commissions - partVendeurs, performance, objectif, primesVendeurs, transport,
      retentionVendeurs, retentionPartenaire, retentionARenseigner: r.reduce((a, x) => a + x.aRenseigner, 0),
      ht: commissions + performance + objectif + primesVendeurs + transport + retentionVendeurs + retentionPartenaire,
    };
  };
  const b2c = calc("B2C"), b2b = calc("B2B");
  const somme = (k: keyof Facture) => b2c[k] + b2b[k];
  const aj = Number(ajustement || 0);
  const ht = b2c.ht + b2b.ht + aj;
  const montantTva = Math.round((ht * tva) / 100);
  return {
    b2c, b2b, nouveau, nombre: somme("nombre"), commissions: somme("commissions"), partVendeurs: somme("partVendeurs"),
    objectif: somme("objectif"), retentionARenseigner: somme("retentionARenseigner"),
    ajustement: aj, ht, tva: montantTva, ttc: ht + montantTva,
    margeDgs: somme("partPartenaire") + somme("performance") + somme("objectif") + somme("retentionPartenaire") + aj,
  };
}

// --- PV de réception (extraction SBIN définitive) ---------------------------------------
export type LignePv = { segment: "B2C" | "B2B"; designation: string; unite: string; quantite: number; prix: number };

/** Lignes des PV de réception du mois, un PV par segment (FTTH / FTTO…), d'après la facture calculée. */
export function lignesPv(mois: string, ventes: Vente[], offres: Map<string, Offre>, vendeurs: Vendeur[], debutContrat: string, ajustement: number): LignePv[] {
  const fac = factureSbin(mois, ventes, offres, vendeurs, debutContrat, ajustement, 0);
  const res: LignePv[] = [];
  for (const seg of ["B2C", "B2B"] as const) {
    const f = seg === "B2C" ? fac.b2c : fac.b2b;
    const parOffre = new Map<string, number>();
    for (const v of ventes) {
      if (v.mois !== mois || v.statut !== "Validée" || offres.get(v.offre_id)?.segment !== seg) continue;
      parOffre.set(v.offre_id, (parOffre.get(v.offre_id) ?? 0) + 1);
    }
    for (const [id, n] of parOffre) {
      const o = offres.get(id)!;
      res.push({ segment: seg, designation: `Commission ${o.libelle} (${o.code})`, unite: "vente", quantite: n, prix: Number(o.commission) });
    }
    if (f.performance) res.push({ segment: seg, designation: `Prime PVT par vente (${f.nPerf} ventes)`, unite: "vente", quantite: f.nPerf, prix: Math.round(f.performance / f.nPerf) });
    if (f.primesVendeurs) res.push({ segment: seg, designation: seg === "B2C" ? "Primes vendeurs VTM" : "Primes vendeurs VTB", unite: "forfait", quantite: 1, prix: f.primesVendeurs });
    if (f.objectif) res.push({ segment: seg, designation: "Prime d'objectif (contrat PVT, annexe 3)", unite: "forfait", quantite: 1, prix: f.objectif });
    if (f.transport) res.push({ segment: seg, designation: "Primes de transport vendeurs", unite: "forfait", quantite: 1, prix: f.transport });
    if (f.retentionVendeurs) res.push({ segment: seg, designation: "Rétention : bonus vendeurs", unite: "forfait", quantite: 1, prix: f.retentionVendeurs });
    if (f.retentionPartenaire) res.push({ segment: seg, designation: f.retentionPartenaire > 0 ? "Rétention : bonus partenaire" : "Rétention : malus partenaire", unite: "forfait", quantite: 1, prix: f.retentionPartenaire });
  }
  if (ajustement) res.push({ segment: fac.b2c.nombre || !fac.b2b.nombre ? "B2C" : "B2B", designation: "Ajustement", unite: "forfait", quantite: 1, prix: ajustement });
  return res;
}

// --- Lecture de l'extraction SBIN (Excel) ----------------------------------------
// Formats SBIN reçus (octobre 2026) :
//  • FTTH B2C, feuille « LISTE CLIENTS … » : LOGIN_VENDEUR (pvt_dgs_xxx.ftth), MSISDN, DEBIT (FTTH_Home_50M),
//    PAIEMENT (A payer / Arriéré à payer / PAIEMENT REPORTE / Vte non validée), MOTIF DE REJET, PRENOM_NOM, DATE_COMMANDE ;
//  • FTTO B2B, feuille « REAL » : MSISDN, LOGIN_VENDEUR (pvt_dgs_xxx), DEBIT (FTTH_PRO_50M…), DATE,
//    OBSERVATION (A payer / Paiement reporté), NEW ETAT (ACTIF, blockage, Clôture du suivi), Commentaire blocages.
export type StatutSbin = "Validée" | "Reportée" | "Rejetée";
export type LigneExtraction = {
  ligne: string; offre: string; offreLue: string; date: string; client: string;
  login: string; statut: StatutSbin; motif: string; etat: "" | "Active" | "Suspendue" | "Résiliée";
};

const norm = (t: unknown) => String(t ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

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
  if (typeof v === "number" && v > 30000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10);
  const t = String(v ?? "").trim();
  const fr = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (fr) return `${fr[3]}-${fr[2].padStart(2, "0")}-${fr[1].padStart(2, "0")}`;
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : "";
};

/** Numéro de ligne : chiffres seuls, avec le 0 initial que l'Excel perd (121296069 → 0121296069). */
export const normaliserLigne = (v: unknown) => {
  const t = typeof v === "number" ? String(Math.round(v)) : String(v ?? "").trim();
  const n = t.replace(/[^0-9A-Za-z-]/g, "");
  return /^[1-9]\d{8}$/.test(n) ? "0" + n : n;
};

export function statutSbin(v: unknown): StatutSbin {
  const n = norm(v);
  if (!n || n.includes("apayer") || n.includes("arriere") || n.includes("valide") && !n.includes("non")) return "Validée";
  if (n.includes("report")) return "Reportée";
  return "Rejetée";
}

const etatSbin = (v: unknown): LigneExtraction["etat"] => {
  const n = norm(v);
  if (!n) return "";
  if (n.startsWith("actif") || n === "active") return "Active";
  if (n.includes("clotur") || n.includes("resili")) return "Résiliée";
  if (n.includes("block") || n.includes("bloc") || n.includes("suspen")) return "Suspendue";
  return "";
};

/** Index de la première colonne dont l'en-tête (normalisé) correspond, dans l'ordre de préférence donné. */
const chercher = (ent: string[], ...motifs: RegExp[]) => {
  for (const re of motifs) { const i = ent.findIndex((c) => re.test(c)); if (i >= 0) return i; }
  return -1;
};

/** Repère la ligne d'en-têtes d'une feuille : celle qui a un numéro de ligne et une offre. */
export function scoreFeuille(rows: unknown[][]) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const ent = rows[i].map((c) => norm(c));
    const aLigne = ent.some((c) => /^msisdn|^ligne|^numero$/.test(c));
    const aOffre = ent.some((c) => /^debit|^offre|^produit|^forfait/.test(c));
    if (aLigne && aOffre) return { entete: i, score: rows.length - i + (ent.some((c) => c.startsWith("loginvendeur")) ? 1000 : 0) };
  }
  return { entete: -1, score: 0 };
}

/** Lit une feuille d'extraction SBIN (ou un fichier simple ligne / offre / date / client). */
export function lireExtraction(rows: unknown[][], offres: Offre[]): LigneExtraction[] {
  const { entete } = scoreFeuille(rows);
  if (entete < 0) throw new Error("Colonnes introuvables : il faut au moins une colonne MSISDN (ou Ligne, Numéro) et une colonne DEBIT (ou Offre).");
  const ent = rows[entete].map((c) => norm(c));
  const cLigne = chercher(ent, /^msisdn\d*$/, /^ligne/, /^numero$/, /msisdn/);
  const cOffre = chercher(ent, /^debit$/, /^debit/, /^offre$/, /^nomoffre/, /^produit/, /^forfait/);
  const cDate = chercher(ent, /^datecommande$/, /^date$/, /^dateactivation/, /^date/);
  const cClient = chercher(ent, /raisonsociale|prenomnom/, /^client$/, /^nomclient/);
  const cLogin = chercher(ent, /^loginvendeur/, /^login$/, /^vendeur$/);
  const cStatut = chercher(ent, /^paiement$/, /^observation$/, /^statutpaiement/, /^validation$/);
  const cMotif = chercher(ent, /^motifderejet/, /^commentaireblocage/, /^motif/);
  const cEtat = chercher(ent, /^newetat$/, /^etatligne/, /^etat$/);
  const val = (r: unknown[], c: number) => (c >= 0 ? r[c] : undefined);
  const texte = (r: unknown[], c: number) => { const v = val(r, c); return v == null ? "" : String(v).trim(); };
  return rows.slice(entete + 1)
    .map((r) => {
      const offreLue = texte(r, cOffre);
      const motif = texte(r, cMotif);
      return {
        ligne: normaliserLigne(val(r, cLigne)),
        offreLue,
        offre: reconnaitreOffre(offreLue, offres) ?? offreLue,
        date: enDate(val(r, cDate)),
        client: texte(r, cClient),
        login: texte(r, cLogin),
        statut: statutSbin(val(r, cStatut)),
        motif: /^#|^0$/.test(motif) ? "" : motif,
        etat: etatSbin(val(r, cEtat)),
      };
    })
    .filter((l) => l.ligne && l.offreLue && !/^total/i.test(l.ligne));
}
