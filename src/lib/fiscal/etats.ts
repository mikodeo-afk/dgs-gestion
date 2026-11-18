// États financiers annuels au format SYSCOHADA révisé (système normal) : bilan, compte de résultat,
// tableau des flux de trésorerie, à partir des données de l'application et des saisies de clôture.
// Fonctions pures : aucun accès à la base.
import { cleMois, REGLES_PAR_PAYS, type DonneesFiscales, type Salaire } from "./regles";

export type Equipement = {
  code: string; designation: string; categorie: string; etat: string;
  date_acquisition: string | null; valeur_acquisition: number | null;
};

/** Ce que l'application ne suit pas : saisi à la clôture (FCFA). */
export const CHAMPS_SAISIE = [
  { cle: "capital", libelle: "Capital social", aide: "Montant du capital inscrit aux statuts (RCCM)" },
  { cle: "reserves", libelle: "Réserves (légale et libres)" },
  { cle: "report_a_nouveau", libelle: "Report à nouveau", aide: "Résultats antérieurs non distribués (négatif si pertes)" },
  { cle: "tresorerie_fin", libelle: "Trésorerie au 31 décembre", aide: "Soldes des relevés bancaires + caisse au 31/12" },
  { cle: "tresorerie_debut", libelle: "Trésorerie au 1er janvier", aide: "Premier exercice seulement (souvent 0 : le capital versé compte comme apport) ; ensuite repris de l'année précédente" },
  { cle: "emprunts", libelle: "Emprunts bancaires restant dus au 31/12" },
  { cle: "decouverts", libelle: "Découverts et crédits de trésorerie au 31/12" },
  { cle: "autres_dettes", libelle: "Autres dettes", aide: "Comptes courants d'associés, salaires restant dus, divers" },
  { cle: "autres_creances", libelle: "Autres créances", aide: "Avances aux fournisseurs, personnel, débiteurs divers" },
  { cle: "depots_cautionnements", libelle: "Dépôts et cautionnements versés", aide: "Cautions de loyer, de marchés…" },
  { cle: "immo_autres_brut", libelle: "Autres immobilisations : valeur d'origine", aide: "Bâtiments, mobilier, informatique… non enregistrés dans Matériel" },
  { cle: "immo_autres_amort", libelle: "Autres immobilisations : amortissements cumulés au 31/12" },
  { cle: "immo_autres_dotation", libelle: "Autres immobilisations : dotation de l'exercice" },
  { cle: "autres_produits", libelle: "Autres produits d'exploitation", aide: "Produits accessoires, subventions d'exploitation" },
  { cle: "produits_financiers", libelle: "Produits financiers" },
  { cle: "frais_financiers", libelle: "Frais financiers (intérêts)", aide: "Intérêts d'emprunts et agios, s'ils ne sont pas en dépenses" },
  { cle: "produits_hao", libelle: "Produits hors activités ordinaires (HAO)", aide: "Cessions d'immobilisations, produits exceptionnels" },
  { cle: "charges_hao", libelle: "Charges HAO", aide: "Valeur des immobilisations cédées, charges exceptionnelles" },
  { cle: "impot_resultat", libelle: "Impôt sur le résultat retenu", aide: "Laisser vide pour le calcul automatique (IS ou minimum)" },
] as const;
export type CleSaisie = (typeof CHAMPS_SAISIE)[number]["cle"];
export type Saisies = Partial<Record<CleSaisie, number>>;

export type DonneesEtats = Omit<DonneesFiscales, "facturesClients" | "facturesFournisseurs"> & {
  facturesClients: (DonneesFiscales["facturesClients"][number] & { net_a_payer: number })[];
  facturesFournisseurs: (DonneesFiscales["facturesFournisseurs"][number] & { net_a_payer: number; tiers_type: string | null })[];
  stock: Record<number, { debut: number; fin: number }>;
  equipements: Equipement[];
};

export type Poste = { ref: string; libelle: string; n: number; n1?: number; total?: boolean; note?: string };
export type PosteActif = { ref: string; libelle: string; brut: number; amort: number; net: number; n1?: number; total?: boolean };
export type Etats = {
  annee: number;
  compteResultat: Poste[];
  actif: PosteActif[];
  passif: Poste[];
  tft: Poste[];
  controles: string[];
  ecart: number;
  /** Détail des reclassements (pour l'agent et les notes annexes). */
  detail: Record<string, unknown>;
};

const somme = <T,>(l: T[], f: (x: T) => number) => l.reduce((s, x) => s + (Number(f(x)) || 0), 0);
const dansAnnee = (d: string | null | undefined, a: number) => !!d && d.slice(0, 4) === String(a);
const avant = (d: string | null | undefined, limite: string) => !!d && d.slice(0, 10) <= limite;
const r = Math.round;

// ---------------------------------------------------------------------------
// Classement des charges dans les rubriques du compte de résultat
// ---------------------------------------------------------------------------
type Rubrique = "RC" | "RE" | "RG" | "RH" | "RI" | "RJ" | "RM";
const REGLES_CHARGES: [RegExp, Rubrique][] = [
  [/agios?|int[ée]r[êe]ts?/i, "RM"],
  [/taxe|imp[ôo]t|vignette|timbre|patente|droit d'enregistrement|redevance/i, "RI"],
  [/amende|p[ée]nalit|don |dons |cadeau|cotisation (professionnelle|syndicale)/i, "RJ"],
  [/transport|fret|livraison|d[ée]placement|billet|voyage|taxi|p[ée]age/i, "RG"],
  [/sous-trait|prestat|main[- ]d.?[œo]euvre|location|loyer|bail|entretien|r[ée]paration|maintenance|assurance|honoraire|conseil|avocat|notaire|expert|formation|t[ée]l[ée]com|internet|t[ée]l[ée]phon|publicit|frais bancaires?|commission|gardiennage|nettoyage|int[ée]rim/i, "RH"],
  [/carbur|gasoil|gas-oil|gazole|essence|lubrifiant|[ée]lectricit|\beau\b|fourniture de bureau|papeterie|petit mat[ée]riel|outillage|consommable/i, "RE"],
];
function classer(texte: string, defaut: Rubrique): Rubrique {
  for (const [re, rub] of REGLES_CHARGES) if (re.test(texte)) return rub;
  return defaut;
}
const CATEGORIE_FG: Record<string, Rubrique> = {
  Loyer: "RH", "Électricité et eau": "RE", Télécoms: "RH", Véhicules: "RE", Administration: "RH", Divers: "RJ",
};

/** Taux d'amortissement linéaire usuels (à confirmer par l'expert-comptable). */
export const TAUX_AMORTISSEMENT: Record<string, number> = { "Matériel roulant": 25, "Matériel de travail": 20 };

function amortissements(equipements: Equipement[], annee: number) {
  const fin = new Date(Date.UTC(annee, 11, 31));
  const debut = new Date(Date.UTC(annee, 0, 1));
  const lignes = { roulant: { brut: 0, amort: 0, dotation: 0, acquis: 0 }, travail: { brut: 0, amort: 0, dotation: 0, acquis: 0 } };
  const sansValeur: string[] = [];
  for (const e of equipements) {
    if (!e.date_acquisition || !e.valeur_acquisition) { if (e.etat !== "Réformé") sansValeur.push(e.code); continue; }
    const acq = new Date(e.date_acquisition + "T00:00:00Z");
    if (acq > fin || e.etat === "Réformé") continue;
    const k = e.categorie === "Matériel roulant" ? "roulant" : "travail";
    const taux = (TAUX_AMORTISSEMENT[e.categorie] ?? 20) / 100;
    const v = Number(e.valeur_acquisition);
    const jours = (a: Date, b: Date) => Math.max(0, (b.getTime() - a.getTime()) / 86_400_000 + 1);
    const cumulFin = Math.min(v, (v * taux * jours(acq, fin)) / 360);
    const cumulDebut = acq < debut ? Math.min(v, (v * taux * jours(acq, new Date(debut.getTime() - 86_400_000))) / 360) : 0;
    lignes[k].brut += v;
    lignes[k].amort += r(cumulFin);
    lignes[k].dotation += r(cumulFin - cumulDebut);
    if (dansAnnee(e.date_acquisition, annee)) lignes[k].acquis += v;
  }
  return { ...lignes, sansValeur };
}

/** Dettes fiscales et sociales de l'exercice restant à payer au 31/12 (et crédit de TVA). */
function dettesFiscales(annee: number, d: DonneesEtats, paysCode: string) {
  const regles = REGLES_PAR_PAYS[paysCode];
  const fin = `${annee}-12-31`;
  if (!regles) return { dettes: 0, creditTva: 0, lignes: [] as string[], nonEnregistrees: 0 };
  let dettes = 0, creditTva = 0, nonEnregistrees = 0;
  const lignes: string[] = [];
  for (let m = 2; m <= 13; m++) {
    const a = m === 13 ? annee + 1 : annee, mm = m === 13 ? 1 : m;
    for (const o of regles.obligations(a, mm, d)) {
      if (!["TVA", "ITS", "VPS", "AIB", "IRF", "CNSS"].includes(o.code)) continue;
      if (!o.periode.startsWith(String(annee))) continue;
      const reg = d.declarations.find((x) => x.obligation === o.code && x.periode === o.periode);
      if (reg?.paye_le && reg.paye_le.slice(0, 10) <= fin) continue;
      if (o.code === "TVA" && m === 13) creditTva = Number((o.detail as { credit_a_reporter?: number }).credit_a_reporter ?? 0);
      if (o.montant > 0) {
        dettes += o.montant;
        lignes.push(`${o.nom} ${o.libellePeriode} : ${o.montant.toLocaleString("fr-FR")}`);
        if (!reg && m < 13) nonEnregistrees++;
      }
    }
  }
  return { dettes, creditTva, lignes, nonEnregistrees };
}

/** Calcule les états d'un exercice. `saisiesN1` sert seulement à la trésorerie d'ouverture et aux variations. */
export function calculerEtats(annee: number, d: DonneesEtats, s: Saisies, paysCode: string, precedent?: Etats | null): Etats {
  const v = (k: CleSaisie) => Number(s[k] ?? 0) || 0;
  const fin = `${annee}-12-31`;
  const params = d.params;
  const controles: string[] = [];

  // --- Produits
  const factures = d.facturesClients.filter((f) => f.statut !== "Annulée" && dansAnnee(f.date_emission, annee));
  const avoirs = d.avoirs.filter((a) => dansAnnee(a.date_avoir, annee));
  const TC = somme(factures, (f) => f.montant_ht) - somme(avoirs, (a) => a.montant_ht);
  const TH = v("autres_produits");

  // --- Charges externes
  const rub: Record<Rubrique, number> = { RC: 0, RE: 0, RG: 0, RH: 0, RI: 0, RJ: 0, RM: 0 };
  const ff = d.facturesFournisseurs.filter((f) => !["Rejetée", "Annulée"].includes(f.statut) && dansAnnee(f.date_reception, annee));
  for (const f of ff) rub[f.tiers_type === "prestataire" ? classer(`${f.objet}`, "RH") : classer(`${f.objet} ${f.fournisseur}`, "RC")] += f.montant_ht;
  const dep = d.depenses.filter((x) => x.statut === "Payée" && dansAnnee(x.date_depense, annee));
  for (const x of dep) rub[classer(x.objet, "RE")] += x.montant;
  const fg = d.fraisGeneraux.filter((x) => dansAnnee(x.mois, annee));
  for (const x of fg) rub[classer(x.libelle, CATEGORIE_FG[x.categorie] ?? "RH")] += x.montant;

  const stock = d.stock[annee] ?? { debut: 0, fin: 0 };
  const RD = stock.debut - stock.fin; // variation de stocks de matières (+ = diminution)

  // --- Personnel
  const mois = Array.from({ length: 12 }, (_, i) => cleMois(annee, i + 1));
  const tous: Salaire[] = mois.flatMap((m) => d.salaires[m] ?? []);
  const salairesBruts = somme(tous, (x) => x.brut);
  const masseDeclaree = somme(tous.filter((x) => x.declare_cnss), (x) => x.brut);
  const cnssPatronale = r(masseDeclaree * ((params.cnss_patronal ?? 0) + (params.cnss_risque_pro ?? 0)) / 100);
  const RK = salairesBruts + cnssPatronale;
  const vps = r(masseDeclaree * (params.vps ?? 0) / 100);
  if (salairesBruts > masseDeclaree)
    controles.push(`Salaires non déclarés : ${(salairesBruts - masseDeclaree).toLocaleString("fr-FR")} FCFA versés à des salariés non déclarés figurent en charges de personnel sans charges sociales. Régularisez avant le dépôt.`);

  // --- Impôts et taxes, amortissements
  const RI = rub.RI + vps + (params.patente_annuelle ?? 0);
  const am = amortissements(d.equipements, annee);
  const RL = am.roulant.dotation + am.travail.dotation + v("immo_autres_dotation");
  if (am.sansValeur.length) controles.push(`Matériel sans date ou valeur d'acquisition (${am.sansValeur.slice(0, 8).join(", ")}${am.sansValeur.length > 8 ? "…" : ""}) : il n'est ni à l'actif ni amorti. Complétez les fiches dans Matériel.`);
  const acquis = am.roulant.acquis + am.travail.acquis;
  if (acquis) controles.push(`Matériel acquis en ${annee} pour ${acquis.toLocaleString("fr-FR")} FCFA : vérifiez que ces achats n'ont pas aussi été saisis comme dépenses ou factures fournisseurs (ils seraient comptés deux fois, en charges et à l'actif).`);

  // --- Soldes intermédiaires
  const XB = TC; // chiffre d'affaires (DGS : travaux et services vendus)
  const XC = XB + TH - rub.RC - RD - rub.RE - rub.RG - rub.RH - RI - rub.RJ; // valeur ajoutée
  const XD = XC - RK; // EBE
  const XE = XD - RL; // résultat d'exploitation
  const TK = v("produits_financiers");
  const RM = rub.RM + v("frais_financiers");
  const XF = TK - RM;
  const XG = XE + XF;
  const XH = v("produits_hao") - v("charges_hao");
  const avantImpot = XG + XH;
  const minimum = Math.max(r(XB * (params.is_minimum ?? 1) / 100), 250_000);
  const isCalcule = Math.max(r(Math.max(avantImpot, 0) * (params.is_taux ?? 30) / 100), minimum);
  const RS = s.impot_resultat !== undefined && s.impot_resultat !== null && String(s.impot_resultat) !== "" ? v("impot_resultat") : isCalcule;
  const XI = avantImpot - RS;

  const compteResultat: Poste[] = [
    { ref: "TA", libelle: "Ventes de marchandises", n: 0 },
    { ref: "RA", libelle: "Achats de marchandises", n: 0 },
    { ref: "RB", libelle: "Variation de stocks de marchandises", n: 0 },
    { ref: "XA", libelle: "MARGE COMMERCIALE", n: 0, total: true },
    { ref: "TB", libelle: "Ventes de produits fabriqués", n: 0 },
    { ref: "TC", libelle: "Travaux, services vendus", n: TC, note: `${factures.length} facture(s) − ${avoirs.length} avoir(s)` },
    { ref: "TD", libelle: "Produits accessoires", n: 0 },
    { ref: "XB", libelle: "CHIFFRE D'AFFAIRES", n: XB, total: true },
    { ref: "TE", libelle: "Production stockée (ou déstockage)", n: 0 },
    { ref: "TF", libelle: "Production immobilisée", n: 0 },
    { ref: "TG", libelle: "Subventions d'exploitation", n: 0 },
    { ref: "TH", libelle: "Autres produits", n: TH },
    { ref: "TI", libelle: "Transferts de charges d'exploitation", n: 0 },
    { ref: "RC", libelle: "Achats de matières premières et fournitures liées", n: -rub.RC },
    { ref: "RD", libelle: "Variation de stocks de matières premières et fournitures liées", n: -RD },
    { ref: "RE", libelle: "Autres achats", n: -rub.RE },
    { ref: "RF", libelle: "Variation de stocks d'autres approvisionnements", n: 0 },
    { ref: "RG", libelle: "Transports", n: -rub.RG },
    { ref: "RH", libelle: "Services extérieurs", n: -rub.RH },
    { ref: "RI", libelle: "Impôts et taxes", n: -RI, note: "VPS, patente et taxes payées" },
    { ref: "RJ", libelle: "Autres charges", n: -rub.RJ },
    { ref: "XC", libelle: "VALEUR AJOUTÉE", n: XC, total: true },
    { ref: "RK", libelle: "Charges de personnel", n: -RK, note: "Salaires bruts + charges sociales patronales" },
    { ref: "XD", libelle: "EXCÉDENT BRUT D'EXPLOITATION", n: XD, total: true },
    { ref: "TJ", libelle: "Reprises d'amortissements, provisions et dépréciations", n: 0 },
    { ref: "RL", libelle: "Dotations aux amortissements, aux provisions et dépréciations", n: -RL },
    { ref: "XE", libelle: "RÉSULTAT D'EXPLOITATION", n: XE, total: true },
    { ref: "TK", libelle: "Revenus financiers et assimilés", n: TK },
    { ref: "TL", libelle: "Reprises de provisions et dépréciations financières", n: 0 },
    { ref: "TM", libelle: "Transferts de charges financières", n: 0 },
    { ref: "RM", libelle: "Frais financiers et charges assimilées", n: -RM },
    { ref: "RN", libelle: "Dotations aux provisions et dépréciations financières", n: 0 },
    { ref: "XF", libelle: "RÉSULTAT FINANCIER", n: XF, total: true },
    { ref: "XG", libelle: "RÉSULTAT DES ACTIVITÉS ORDINAIRES", n: XG, total: true },
    { ref: "TN", libelle: "Produits des cessions d'immobilisations", n: 0 },
    { ref: "TO", libelle: "Autres produits HAO", n: v("produits_hao") },
    { ref: "RO", libelle: "Valeurs comptables des cessions d'immobilisations", n: 0 },
    { ref: "RP", libelle: "Autres charges HAO", n: -v("charges_hao") },
    { ref: "XH", libelle: "RÉSULTAT HORS ACTIVITÉS ORDINAIRES", n: XH, total: true },
    { ref: "RQ", libelle: "Participation des travailleurs", n: 0 },
    { ref: "RS", libelle: "Impôts sur le résultat", n: -RS, note: RS === isCalcule ? (isCalcule === minimum ? "Minimum de perception" : `IS ${params.is_taux ?? 30} %`) : "Saisi à la clôture" },
    { ref: "XI", libelle: "RÉSULTAT NET", n: XI, total: true },
  ];

  // --- Bilan : actif
  const immoBrutAutres = v("immo_autres_brut"), immoAmAutres = v("immo_autres_amort");
  const AM = { brut: am.travail.brut + immoBrutAutres, amort: am.travail.amort + immoAmAutres };
  const AN = { brut: am.roulant.brut, amort: am.roulant.amort };
  const AS = v("depots_cautionnements");
  const BB = Math.max(stock.fin, 0);
  const clientsOuverts = d.facturesClients.filter((f) => f.statut !== "Annulée" && avant(f.date_emission, fin) && !(f.encaisse_le && avant(f.encaisse_le, fin)));
  const BI = Math.max(somme(clientsOuverts, (f) => f.net_a_payer)
    - somme(d.avoirs.filter((a) => avant(a.date_avoir, fin) && clientsOuverts.some((f) => f.id === a.facture_id)), (a) => a.montant_ht + a.montant_tva - a.montant_aib), 0);
  const fiscal = dettesFiscales(annee, d, paysCode);
  const aibSubi = somme(d.facturesClients.filter((f) => f.statut === "Payée" && dansAnnee(f.encaisse_le, annee)), (f) => f.montant_aib);
  const acomptesIs = somme(d.declarations.filter((x) => x.obligation === "IS_ACOMPTE" && x.periode.startsWith(`${annee}-A`)), (x) => x.montant_declare);
  const soldeIs = RS - aibSubi - acomptesIs;
  if (fiscal.nonEnregistrees)
    controles.push(`${fiscal.nonEnregistrees} déclaration(s) de ${annee} ne sont pas marquées payées dans l'Agent comptable : elles sont comptées en dettes fiscales et sociales au 31/12. Enregistrez celles qui ont été payées.`);
  const BJ = v("autres_creances") + fiscal.creditTva + Math.max(-soldeIs, 0);
  const BS = v("tresorerie_fin");
  if (s.tresorerie_fin === undefined) controles.push("Trésorerie au 31 décembre non saisie : reportez les soldes des relevés bancaires et de la caisse au 31/12.");
  if (!v("capital")) controles.push("Capital social non saisi : indiquez le montant inscrit aux statuts.");

  const ligneA = (ref: string, libelle: string, brut: number, amort = 0, total = false): PosteActif => ({ ref, libelle, brut, amort, net: brut - amort, total });
  const AZ = ligneA("AZ", "TOTAL ACTIF IMMOBILISÉ", AM.brut + AN.brut + AS, AM.amort + AN.amort, true);
  const BK = ligneA("BK", "TOTAL ACTIF CIRCULANT", BB + BI + BJ, 0, true);
  const BT = ligneA("BT", "TOTAL TRÉSORERIE-ACTIF", BS, 0, true);
  const BZ = ligneA("BZ", "TOTAL GÉNÉRAL", AZ.brut + BK.brut + BT.brut, AZ.amort, true);
  const actif: PosteActif[] = [
    ligneA("AD", "Immobilisations incorporelles", 0),
    ligneA("AI", "Immobilisations corporelles", AM.brut + AN.brut, AM.amort + AN.amort),
    ligneA("AJ", "  Terrains", 0), ligneA("AK", "  Bâtiments", 0), ligneA("AL", "  Aménagements, agencements et installations", 0),
    ligneA("AM", "  Matériel, mobilier et actifs biologiques", AM.brut, AM.amort),
    ligneA("AN", "  Matériel de transport", AN.brut, AN.amort),
    ligneA("AP", "Avances et acomptes versés sur immobilisations", 0),
    ligneA("AQ", "Immobilisations financières", AS),
    AZ,
    ligneA("BA", "Actif circulant HAO", 0),
    ligneA("BB", "Stocks et encours", BB),
    ligneA("BG", "Créances et emplois assimilés", BI + BJ),
    ligneA("BH", "  Fournisseurs, avances versées", 0),
    ligneA("BI", "  Clients", BI),
    ligneA("BJ", "  Autres créances", BJ),
    BK,
    ligneA("BQ", "Titres de placement", 0),
    ligneA("BR", "Valeurs à encaisser", 0),
    ligneA("BS", "Banques, chèques postaux, caisse et assimilés", BS),
    BT,
    ligneA("BU", "Écart de conversion-Actif", 0),
    BZ,
  ];

  // --- Bilan : passif
  const fournisseursOuverts = d.facturesFournisseurs.filter((f) => !["Rejetée", "Annulée"].includes(f.statut) && avant(f.date_reception, fin) && !(f.paye_le && avant(f.paye_le, fin)));
  const DJ = somme(fournisseursOuverts, (f) => f.net_a_payer);
  const DK = fiscal.dettes + Math.max(soldeIs, 0);
  const DM = v("autres_dettes");
  const CP = v("capital") + v("reserves") + v("report_a_nouveau") + XI;
  const DD = v("emprunts");
  const DP = DJ + DK + DM;
  const DT = v("decouverts");
  const DZ = CP + DD + DP + DT;
  const passif: Poste[] = [
    { ref: "CA", libelle: "Capital", n: v("capital") },
    { ref: "CB", libelle: "Apporteurs capital non appelé (−)", n: 0 },
    { ref: "CD", libelle: "Primes liées au capital social", n: 0 },
    { ref: "CE", libelle: "Écarts de réévaluation", n: 0 },
    { ref: "CF", libelle: "Réserves indisponibles", n: 0 },
    { ref: "CG", libelle: "Réserves libres", n: v("reserves") },
    { ref: "CH", libelle: "Report à nouveau (+ ou −)", n: v("report_a_nouveau") },
    { ref: "CJ", libelle: "Résultat net de l'exercice (bénéfice + ou perte −)", n: XI },
    { ref: "CL", libelle: "Subventions d'investissement", n: 0 },
    { ref: "CM", libelle: "Provisions réglementées", n: 0 },
    { ref: "CP", libelle: "TOTAL CAPITAUX PROPRES ET RESSOURCES ASSIMILÉES", n: CP, total: true },
    { ref: "DA", libelle: "Emprunts et dettes financières diverses", n: DD },
    { ref: "DB", libelle: "Dettes de location-acquisition", n: 0 },
    { ref: "DC", libelle: "Provisions pour risques et charges", n: 0 },
    { ref: "DD", libelle: "TOTAL DETTES FINANCIÈRES ET RESSOURCES ASSIMILÉES", n: DD, total: true },
    { ref: "DF", libelle: "TOTAL RESSOURCES STABLES", n: CP + DD, total: true },
    { ref: "DH", libelle: "Dettes circulantes HAO", n: 0 },
    { ref: "DI", libelle: "Clients, avances reçues", n: 0 },
    { ref: "DJ", libelle: "Fournisseurs d'exploitation", n: DJ },
    { ref: "DK", libelle: "Dettes fiscales et sociales", n: DK },
    { ref: "DM", libelle: "Autres dettes", n: DM },
    { ref: "DN", libelle: "Provisions pour risques à court terme", n: 0 },
    { ref: "DP", libelle: "TOTAL PASSIF CIRCULANT", n: DP, total: true },
    { ref: "DQ", libelle: "Banques, crédits d'escompte", n: 0 },
    { ref: "DR", libelle: "Banques, établissements financiers et crédits de trésorerie", n: DT },
    { ref: "DT", libelle: "TOTAL TRÉSORERIE-PASSIF", n: DT, total: true },
    { ref: "DV", libelle: "Écart de conversion-Passif", n: 0 },
    { ref: "DZ", libelle: "TOTAL GÉNÉRAL", n: DZ, total: true },
  ];
  const ecart = BZ.net - DZ;
  if (Math.abs(ecart) >= 1)
    controles.unshift(`Le bilan n'est pas équilibré : ${ecart > 0 ? "l'actif dépasse le passif" : "le passif dépasse l'actif"} de ${Math.abs(ecart).toLocaleString("fr-FR")} FCFA. `
      + "L'écart vient de ce que l'application ne suit pas (trésorerie, capital, apports, emprunts, dettes ou créances diverses) ou d'opérations non saisies. Il doit être expliqué et corrigé avant l'arrêté des comptes.");

  // --- Tableau des flux de trésorerie
  const p = precedent;
  const val = (e: Etats | null | undefined, ref: string, cote: "actif" | "passif") =>
    !e ? 0 : cote === "actif" ? Number(e.actif.find((x) => x.ref === ref)?.net ?? 0) : Number(e.passif.find((x) => x.ref === ref)?.n ?? 0);
  const ZA = p ? val(p, "BS", "actif") - val(p, "DT", "passif") : v("tresorerie_debut");
  const FA = XI + RL; // capacité d'autofinancement globale (simplifiée : pas de reprises ni de cessions)
  const FC = -(BB - val(p, "BB", "actif"));
  const FD = -((BI + BJ) - (val(p, "BI", "actif") + val(p, "BJ", "actif")));
  const FE = DP - val(p, "DP", "passif");
  const ZB = FA + FC + FD + FE;
  const immoBrutPrec = p ? Number(p.actif.find((x) => x.ref === "AI")?.brut ?? 0) : 0;
  const FG = -Math.max(AM.brut + AN.brut - immoBrutPrec, 0);
  const FH = -Math.max(AS - val(p, "AQ", "actif"), 0);
  const ZC = FG + FH;
  const FK = v("capital") - val(p, "CA", "passif");
  const ZD = FK;
  const dEmprunts = DD - val(p, "DD", "passif");
  const ZE = dEmprunts;
  const ZF = ZD + ZE;
  const ZG = ZB + ZC + ZF;
  const ZH = ZA + ZG;
  const tft: Poste[] = [
    { ref: "ZA", libelle: "Trésorerie nette au 1er janvier", n: ZA, total: true },
    { ref: "FA", libelle: "Capacité d'autofinancement globale (CAFG)", n: FA },
    { ref: "FB", libelle: "− Actif circulant HAO", n: 0 },
    { ref: "FC", libelle: "− Variation des stocks", n: FC },
    { ref: "FD", libelle: "− Variation des créances", n: FD },
    { ref: "FE", libelle: "+ Variation du passif circulant", n: FE },
    { ref: "ZB", libelle: "Flux de trésorerie provenant des activités opérationnelles", n: ZB, total: true },
    { ref: "FF", libelle: "− Décaissements liés aux acquisitions d'immobilisations incorporelles", n: 0 },
    { ref: "FG", libelle: "− Décaissements liés aux acquisitions d'immobilisations corporelles", n: FG },
    { ref: "FH", libelle: "− Décaissements liés aux acquisitions d'immobilisations financières", n: FH },
    { ref: "FI", libelle: "+ Encaissements liés aux cessions d'immobilisations", n: 0 },
    { ref: "ZC", libelle: "Flux de trésorerie provenant des activités d'investissement", n: ZC, total: true },
    { ref: "FK", libelle: "+ Augmentations de capital par apports nouveaux", n: FK },
    { ref: "FN", libelle: "− Dividendes versés", n: 0 },
    { ref: "ZD", libelle: "Flux de trésorerie provenant des capitaux propres", n: ZD, total: true },
    { ref: "FO", libelle: "+ Emprunts nets des remboursements", n: dEmprunts },
    { ref: "ZE", libelle: "Flux de trésorerie provenant des capitaux étrangers", n: ZE, total: true },
    { ref: "ZF", libelle: "Flux de trésorerie provenant des activités de financement", n: ZF, total: true },
    { ref: "ZG", libelle: "VARIATION DE LA TRÉSORERIE NETTE DE LA PÉRIODE", n: ZG, total: true },
    { ref: "ZH", libelle: "Trésorerie nette au 31 décembre", n: ZH, total: true },
  ];
  const tresoNette = BS - DT;
  if (Math.abs(ZH - tresoNette) >= 1)
    controles.push(`Le tableau des flux aboutit à une trésorerie de ${ZH.toLocaleString("fr-FR")} FCFA au 31/12, contre ${tresoNette.toLocaleString("fr-FR")} FCFA au bilan : l'écart (${(tresoNette - ZH).toLocaleString("fr-FR")}) révèle des encaissements ou décaissements non enregistrés.`);
  if (RS === minimum && isCalcule === minimum) controles.push(`L'impôt retenu est le minimum de perception (${minimum.toLocaleString("fr-FR")} FCFA) : le résultat fiscal estimé est inférieur.`);
  if (clientsOuverts.some((f) => f.date_emission < `${annee - 1}-12-31`))
    controles.push("Des factures clients de plus d'un an ne sont toujours pas encaissées : examinez s'il faut constater une dépréciation des créances douteuses.");
  if (stock.fin < 0) controles.push("Le stock calculé est négatif : faites un inventaire physique au 31/12 et saisissez-le dans Stock.");
  controles.push("Écritures d'inventaire à faire valider par l'expert-comptable : charges à payer et produits à recevoir, charges constatées d'avance, provisions pour risques, dépréciations, et charges non déductibles fiscalement (amendes, cadeaux…) pour le résultat fiscal.");

  return {
    annee, compteResultat, actif, passif, tft, controles, ecart,
    detail: {
      chiffre_affaires: XB, achats_par_rubrique: rub, variation_stock: RD, stock, salaires_bruts: salairesBruts, cnss_patronale: cnssPatronale, vps,
      patente: params.patente_annuelle ?? 0, amortissements: am, taux_amortissement: TAUX_AMORTISSEMENT, is_calcule: isCalcule, minimum_is: minimum,
      aib_subi: aibSubi, acomptes_is: acomptesIs, dettes_fiscales: fiscal.lignes, credit_tva: fiscal.creditTva,
      factures_clients_ouvertes: clientsOuverts.length, factures_fournisseurs_ouvertes: fournisseursOuverts.length,
    },
  };
}

/** Ajoute la colonne N-1 aux états N. */
export function avecN1(n: Etats, n1: Etats | null): Etats {
  if (!n1) return n;
  const m = (l: Poste[], l1: Poste[]) => l.map((x) => ({ ...x, n1: l1.find((y) => y.ref === x.ref)?.n ?? 0 }));
  return {
    ...n,
    compteResultat: m(n.compteResultat, n1.compteResultat),
    passif: m(n.passif, n1.passif),
    tft: m(n.tft, n1.tft),
    actif: n.actif.map((x) => ({ ...x, n1: n1.actif.find((y) => y.ref === x.ref)?.net ?? 0 })),
  };
}
