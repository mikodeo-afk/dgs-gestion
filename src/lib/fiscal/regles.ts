// Agent comptable fiscal : règles par pays et calcul des déclarations à faire.
// Fonctions pures (aucun accès à la base) : elles reçoivent les données de l'application
// et renvoient, pour un mois d'échéance, chaque déclaration à faire avec son calcul détaillé.
// Le Bénin est configuré (CGI 2026, loi de finances 2026, CNSS) ; un autre pays s'ajoute
// en écrivant ses règles dans ce dossier et en les déclarant dans REGLES_PAR_PAYS.

export type FactureClient = {
  id?: string; numero: string | null; objet: string; montant_ht: number; montant_tva: number; montant_aib: number;
  date_emission: string; encaisse_le: string | null; statut: string;
};
export type Avoir = { numero: string | null; facture_id: string; montant_ht: number; montant_tva: number; montant_aib: number; date_avoir: string };
export type FactureFournisseur = {
  fournisseur: string; numero: string; objet: string; montant_ht: number; montant_tva: number; montant_aib: number;
  date_reception: string; statut: string; paye_le: string | null;
};
export type Depense = { objet: string; montant: number; statut: string; date_depense: string };
export type FraisGeneral = { mois: string; categorie: string; libelle: string; montant: number };
export type Salaire = {
  profil_id: string; nom: string; poste: string; contrat: string; brut: number; cnss_salarie: number;
  declare_cnss: boolean; numero_cnss: string | null;
};
export type Declaration = {
  obligation: string; periode: string; echeance: string; montant_calcule: number; montant_declare: number;
  statut: "Déclarée" | "Payée"; reference: string | null; detail: Record<string, unknown>; declare_le: string; paye_le: string | null;
};

export type DonneesFiscales = {
  params: Record<string, number>;
  facturesClients: FactureClient[];
  avoirs: (Avoir & { facture_encaissee: boolean })[];
  facturesFournisseurs: FactureFournisseur[];
  depenses: Depense[];
  fraisGeneraux: FraisGeneral[];
  /** Salaires par mois, clé « AAAA-MM ». */
  salaires: Record<string, Salaire[]>;
  /** Statut de la paie par mois, clé « AAAA-MM ». */
  paies: Record<string, string>;
  declarations: Declaration[];
};

export type Ligne = { libelle: string; montant?: number; note?: string };
export type Obligation = {
  code: string;
  nom: string;
  organisme: string;
  periode: string;
  libellePeriode: string;
  echeance: string;
  /** Montant à payer calculé par l'agent (0 = déclaration sans paiement ou rien à payer). */
  montant: number;
  lignes: Ligne[];
  alertes: string[];
  /** Texte de référence (article du CGI, organisme). */
  base: string;
  /** Comment et où déclarer. */
  comment: string;
  /** Informations conservées avec la déclaration enregistrée (ex. crédit de TVA à reporter). */
  detail: Record<string, unknown>;
};

export type ReglesPays = {
  nom: string;
  /** Mois de salaires (« AAAA-MM ») dont le calcul a besoin pour ce mois d'échéance. */
  moisSalaires: (annee: number, mois: number, params: Record<string, number>) => string[];
  /** Années complètes de salaires nécessaires (calcul de l'IS). */
  anneesSalaires: (annee: number, mois: number) => number[];
  obligations: (annee: number, mois: number, d: DonneesFiscales) => Obligation[];
  /** Règles résumées pour l'assistant IA. */
  memo: string;
  sources: { titre: string; url: string }[];
};

// ---------------------------------------------------------------------------
// Outils de dates
// ---------------------------------------------------------------------------
export const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const p2 = (n: number) => String(n).padStart(2, "0");
export const cleMois = (annee: number, mois: number) => `${annee}-${p2(mois)}`;
/** Mois précédent (mois de 1 à 12). */
export const moisAvant = (annee: number, mois: number, n = 1) => {
  const t = annee * 12 + (mois - 1) - n;
  return { annee: Math.floor(t / 12), mois: (t % 12) + 1 };
};
const date = (annee: number, mois: number, jour: number) => `${annee}-${p2(mois)}-${p2(jour)}`;
const dansMois = (d: string | null | undefined, cle: string) => !!d && d.slice(0, 7) === cle;
const dansAnnee = (d: string | null | undefined, annee: number) => !!d && d.slice(0, 4) === String(annee);
const somme = <T,>(l: T[], f: (x: T) => number) => l.reduce((s, x) => s + (Number(f(x)) || 0), 0);
const arrondi = (n: number) => Math.round(n);
/** Montant en négatif pour les lignes de déduction (sans « -0 »). */
const moins = (n: number) => (n ? -n : 0);
export const libelleMois = (cle: string) => {
  const [a, m] = cle.split("-").map(Number);
  return `${MOIS[m - 1]} ${a}`;
};

// ---------------------------------------------------------------------------
// Bénin
// ---------------------------------------------------------------------------
/** Barème mensuel de l'ITS (CGI Bénin, art. 125). */
export const TRANCHES_ITS_BJ = [
  { jusqua: 60_000, taux: 0 },
  { jusqua: 150_000, taux: 10 },
  { jusqua: 250_000, taux: 15 },
  { jusqua: 500_000, taux: 19 },
  { jusqua: Infinity, taux: 30 },
];
export function itsBenin(brut: number) {
  let reste = Math.max(0, brut), bas = 0, impot = 0;
  for (const t of TRANCHES_ITS_BJ) {
    const part = Math.min(reste, t.jusqua - bas);
    if (part <= 0) break;
    impot += (part * t.taux) / 100;
    reste -= part;
    bas = t.jusqua;
  }
  return arrondi(impot);
}

const CARBURANT = /carbur|gasoil|gas-oil|gazole|essence|lubrifiant|huile moteur/i;

const cnssMensuelle = (params: Record<string, number>, nbDeclares: number) => (params.cnss_mensuelle ?? 0) === 1 || nbDeclares >= 20;

function declaresEtNon(liste: Salaire[]) {
  return { declares: liste.filter((s) => s.declare_cnss), non: liste.filter((s) => !s.declare_cnss) };
}

function alerteNonDeclares(non: Salaire[], moisLib: string) {
  if (!non.length) return [];
  return [`${non.length} salarié(s) payé(s) en ${moisLib} ne sont pas déclarés (${non.map((s) => s.nom).join(", ")}) : `
    + `leurs salaires (${somme(non, (s) => s.brut).toLocaleString("fr-FR")} FCFA) échappent à l'ITS, à la VPS et à la CNSS. `
    + `Risque de redressement et de pénalités : déclarez-les à la CNSS et cochez « Déclaré » sur leur fiche.`];
}

function alertePaie(d: DonneesFiscales, cle: string) {
  const st = d.paies[cle];
  if (!st) return [`La paie de ${libelleMois(cle)} n'est pas encore ouverte : montants calculés sur les salaires de base, à confirmer.`];
  if (st !== "Validée" && st !== "Payée") return [`La paie de ${libelleMois(cle)} est « ${st} » : montants provisoires tant qu'elle n'est pas validée.`];
  return [];
}

function tvaBenin(annee: number, mois: number, d: DonneesFiscales): Obligation {
  const m = moisAvant(annee, mois);
  const cle = cleMois(m.annee, m.mois);
  const encaissees = d.facturesClients.filter((f) => f.statut === "Payée" && dansMois(f.encaisse_le, cle));
  const avoirs = d.avoirs.filter((a) => a.facture_encaissee && dansMois(a.date_avoir, cle));
  const collectee = somme(encaissees, (f) => f.montant_tva) - somme(avoirs, (a) => a.montant_tva);
  const recues = d.facturesFournisseurs.filter((f) => !["Rejetée", "Annulée"].includes(f.statut) && dansMois(f.date_reception, cle));
  const carb = recues.filter((f) => CARBURANT.test(`${f.objet} ${f.fournisseur}`));
  const autres = recues.filter((f) => !carb.includes(f));
  const tvaCarb = somme(carb, (f) => f.montant_tva);
  const plafondCarb = arrondi(tvaCarb * 0.9);
  const deductible = somme(autres, (f) => f.montant_tva) + plafondCarb;

  const prec = moisAvant(m.annee, m.mois);
  const decPrec = d.declarations.find((x) => x.obligation === "TVA" && x.periode === cleMois(prec.annee, prec.mois));
  const creditAnterieur = Number((decPrec?.detail as { credit_a_reporter?: number } | undefined)?.credit_a_reporter ?? 0);
  const net = collectee - deductible - creditAnterieur;

  const emisesNonEncaissees = d.facturesClients.filter((f) => f.statut === "Émise" && dansMois(f.date_emission, cle));
  const alertes: string[] = [];
  if (emisesNonEncaissees.length)
    alertes.push(`${emisesNonEncaissees.length} facture(s) émise(s) en ${libelleMois(cle)} pas encore encaissée(s) : leur TVA (${somme(emisesNonEncaissees, (f) => f.montant_tva).toLocaleString("fr-FR")} FCFA) sera due le mois de l'encaissement.`);
  if (carb.length)
    alertes.push(`Carburant et lubrifiants : la loi de finances 2026 limite la déduction à 90 % de la TVA pour le BTP (art. 247 CGI). ${carb.length} facture(s) concernée(s), déduction retenue ${plafondCarb.toLocaleString("fr-FR")} FCFA au lieu de ${tvaCarb.toLocaleString("fr-FR")}. Pas de déduction pour les véhicules de tourisme.`);
  if (!encaissees.length && !recues.length)
    alertes.push("Aucune opération enregistrée ce mois-ci : la déclaration reste obligatoire (déclaration « néant »).");
  alertes.push("Si un client (État, société désignée) a retenu une partie de la TVA à la source, déduisez le montant retenu figurant sur son attestation.");

  return {
    code: "TVA", nom: "TVA", organisme: "DGI (impots.bj)",
    periode: cle, libellePeriode: libelleMois(cle),
    echeance: date(annee, mois, 10),
    montant: Math.max(net, 0),
    lignes: [
      { libelle: `TVA collectée sur ${encaissees.length} facture(s) encaissée(s)`, montant: somme(encaissees, (f) => f.montant_tva) },
      ...(avoirs.length ? [{ libelle: `Moins TVA des ${avoirs.length} avoir(s)`, montant: moins(somme(avoirs, (a) => a.montant_tva)) }] : []),
      { libelle: `TVA déductible sur ${recues.length} facture(s) fournisseur(s) reçue(s)`, montant: moins(deductible) },
      ...(creditAnterieur ? [{ libelle: "Crédit de TVA du mois précédent", montant: moins(creditAnterieur) }] : []),
      net >= 0 ? { libelle: "TVA nette à payer", montant: net } : { libelle: "Crédit de TVA à reporter", montant: -net, note: "Rien à payer : le crédit est reporté sur le mois suivant (ou remboursable : demande avant le 30 avril de l'année suivante)." },
    ],
    alertes,
    base: "CGI Bénin art. 223 à 262 : TVA 18 %, exigible à l'encaissement pour les prestations et travaux ; déclaration et paiement au plus tard le 10 du mois suivant.",
    comment: "Déclaration mensuelle de TVA sur e-services impots.bj avec l'état des factures normalisées (MECeF), puis paiement en ligne ou à la recette.",
    detail: { collectee, deductible, credit_anterieur: creditAnterieur, credit_a_reporter: Math.max(-net, 0), factures: encaissees.map((f) => f.numero) },
  };
}

function itsBeninObligation(annee: number, mois: number, d: DonneesFiscales): Obligation {
  const m = moisAvant(annee, mois);
  const cle = cleMois(m.annee, m.mois);
  const { declares, non } = declaresEtNon(d.salaires[cle] ?? []);
  const lignes: Ligne[] = declares.map((s) => ({ libelle: `${s.nom} : brut ${s.brut.toLocaleString("fr-FR")} FCFA`, montant: itsBenin(s.brut) }));
  const its = somme(declares, (s) => itsBenin(s.brut));
  let ortb = 0;
  if (m.mois === 3) ortb = declares.length * 1000;
  if (m.mois === 6) ortb = declares.filter((s) => s.brut > 60_000).length * 3000;
  if (ortb) lignes.push({ libelle: `Redevance ORTB (salaires de ${MOIS[m.mois - 1]})`, montant: ortb, note: m.mois === 3 ? "1 000 FCFA par salarié" : "3 000 FCFA par salarié au-dessus de 60 000 FCFA" });
  lignes.push({ libelle: "Total ITS à reverser", montant: its + ortb });
  return {
    code: "ITS", nom: "ITS (impôt sur les salaires)", organisme: "DGI (impots.bj)",
    periode: cle, libellePeriode: `salaires de ${libelleMois(cle)}`,
    echeance: date(annee, mois, 10),
    montant: its + ortb,
    lignes,
    alertes: [...alertePaie(d, cle), ...alerteNonDeclares(non, libelleMois(cle)),
      ...(declares.length ? [] : ["Aucun salarié déclaré ce mois : déclaration « néant » à déposer si vous êtes immatriculé comme employeur."])],
    base: "CGI Bénin art. 125 : barème mensuel 0 % jusqu'à 60 000, 10 %, 15 %, 19 % puis 30 % au-delà de 500 000 FCFA, sur le brut imposable ; retenue par l'employeur, reversée le 10 du mois suivant.",
    comment: "Déclaration ITS/VPS sur e-services impots.bj avec la liste nominative des salariés, paiement en même temps.",
    detail: { its, ortb, salaries: declares.length },
  };
}

function vpsBenin(annee: number, mois: number, d: DonneesFiscales): Obligation {
  const m = moisAvant(annee, mois);
  const cle = cleMois(m.annee, m.mois);
  const { declares } = declaresEtNon(d.salaires[cle] ?? []);
  const taux = d.params.vps ?? 4;
  const masse = somme(declares, (s) => s.brut);
  const vps = arrondi((masse * taux) / 100);
  return {
    code: "VPS", nom: "VPS (versement patronal)", organisme: "DGI (impots.bj)",
    periode: cle, libellePeriode: `salaires de ${libelleMois(cle)}`,
    echeance: date(annee, mois, 10),
    montant: vps,
    lignes: [
      { libelle: `Masse salariale brute (${declares.length} salarié(s) déclaré(s))`, montant: masse },
      { libelle: `VPS ${taux} % à la charge de DGS`, montant: vps },
    ],
    alertes: alertePaie(d, cle),
    base: "CGI Bénin, versement patronal sur salaires : 4 % des salaires bruts, payé le 10 du mois suivant.",
    comment: "Sur la même déclaration que l'ITS (e-services impots.bj).",
    detail: { masse, taux },
  };
}

function cnssBenin(annee: number, mois: number, d: DonneesFiscales): Obligation | null {
  const prec = moisAvant(annee, mois);
  const nbPrec = (d.salaires[cleMois(prec.annee, prec.mois)] ?? []).filter((s) => s.declare_cnss).length;
  const mensuelle = cnssMensuelle(d.params, nbPrec);
  let moisCouverts: string[];
  let periode: string, libelle: string;
  if (mensuelle) {
    moisCouverts = [cleMois(prec.annee, prec.mois)];
    periode = moisCouverts[0];
    libelle = `salaires de ${libelleMois(periode)}`;
  } else {
    if (![1, 4, 7, 10].includes(mois)) return null;
    moisCouverts = [3, 2, 1].map((n) => { const x = moisAvant(annee, mois, n); return cleMois(x.annee, x.mois); });
    const t = Math.ceil(prec.mois / 3);
    periode = `${prec.annee}-T${t}`;
    libelle = `${t === 1 ? "1er" : t + "e"} trimestre ${prec.annee}`;
  }
  const tauxPat = (d.params.cnss_patronal ?? 15.4) + (d.params.cnss_risque_pro ?? 1);
  const tauxSal = d.params.inps_salarie ?? 3.6;
  const lignes: Ligne[] = [];
  let total = 0, masseTotale = 0;
  const alertes: string[] = [];
  for (const c of moisCouverts) {
    const { declares, non } = declaresEtNon(d.salaires[c] ?? []);
    const masse = somme(declares, (s) => s.brut);
    const part = arrondi((masse * tauxPat) / 100) + somme(declares, (s) => s.cnss_salarie);
    masseTotale += masse;
    total += part;
    lignes.push({ libelle: `${libelleMois(c)} : ${declares.length} salarié(s), masse ${masse.toLocaleString("fr-FR")} FCFA`, montant: part });
    alertes.push(...alerteNonDeclares(non, libelleMois(c)));
    const sansNumero = declares.filter((s) => !s.numero_cnss);
    if (sansNumero.length) alertes.push(`${libelleMois(c)} : numéro CNSS manquant pour ${sansNumero.map((s) => s.nom).join(", ")} (à saisir dans Personnel).`);
  }
  lignes.push({ libelle: `Total cotisations (employeur ${tauxPat.toLocaleString("fr-FR")} % + salarié ${tauxSal.toLocaleString("fr-FR")} %)`, montant: total });
  if (!mensuelle && nbPrec >= 15) alertes.push("Vous approchez de 20 salariés : au-delà, la CNSS se déclare chaque mois.");
  return {
    code: "CNSS", nom: "Cotisations CNSS", organisme: "CNSS Bénin",
    periode, libellePeriode: libelle,
    echeance: date(annee, mois, 15),
    montant: total,
    lignes,
    alertes: [...new Set(alertes)],
    base: "CNSS Bénin : employeur 9 % prestations familiales + 6,4 % pensions + 1 à 4 % risques professionnels ; salarié 3,6 %. Versement dans les 15 jours qui suivent le mois (20 salariés et plus) ou le trimestre (moins de 20).",
    comment: "Déclaration nominative des salaires et paiement sur le portail de la CNSS (ou à l'agence), avec majoration de 1,5 % par mois de retard.",
    detail: { mois: moisCouverts, masse: masseTotale, taux_employeur: tauxPat, taux_salarie: tauxSal },
  };
}

function aibBenin(annee: number, mois: number, d: DonneesFiscales): Obligation {
  const m = moisAvant(annee, mois);
  const cle = cleMois(m.annee, m.mois);
  const payees = d.facturesFournisseurs.filter((f) => f.statut === "Payée" && f.montant_aib > 0 && dansMois(f.paye_le, cle));
  const total = somme(payees, (f) => f.montant_aib);
  return {
    code: "AIB", nom: "AIB retenu sur les fournisseurs", organisme: "DGI (impots.bj)",
    periode: cle, libellePeriode: libelleMois(cle),
    echeance: date(annee, mois, 10),
    montant: total,
    lignes: payees.length
      ? [...payees.map((f) => ({ libelle: `${f.fournisseur} · facture ${f.numero}`, montant: f.montant_aib })), { libelle: "Total AIB à reverser", montant: total }]
      : [{ libelle: "Aucun AIB retenu sur les factures fournisseurs payées ce mois", montant: 0 }],
    alertes: payees.length ? ["Remettez à chaque fournisseur l'attestation de retenue d'AIB."] : [],
    base: "CGI Bénin art. 130 à 136 : AIB 1 % (achats, IFU), 3 % (prestations de services, IFU), 5 % (sans IFU) ; reversement le 10 du mois suivant.",
    comment: "Déclaration des retenues AIB sur e-services impots.bj, avec la liste des fournisseurs et leur IFU.",
    detail: { factures: payees.map((f) => `${f.fournisseur} ${f.numero}`) },
  };
}

function loyersBenin(annee: number, mois: number, d: DonneesFiscales): Obligation | null {
  const m = moisAvant(annee, mois);
  const cle = cleMois(m.annee, m.mois);
  const loyers = d.fraisGeneraux.filter((f) => /loyer|bail/i.test(`${f.categorie} ${f.libelle}`) && dansMois(f.mois, cle));
  if (!loyers.length) return null;
  const montant = somme(loyers, (f) => f.montant);
  const retenue = arrondi((montant * 12) / 100);
  return {
    code: "IRF", nom: "Retenue sur loyers", organisme: "DGI (impots.bj)",
    periode: cle, libellePeriode: libelleMois(cle),
    echeance: date(annee, mois, 10),
    montant: retenue,
    lignes: [
      ...loyers.map((f) => ({ libelle: f.libelle, montant: f.montant })),
      { libelle: "Retenue 12 % (bailleur personne physique)", montant: retenue, note: "10 % si le bailleur est une société" },
    ],
    alertes: ["Vérifiez le statut du bailleur : 12 % pour une personne physique, 10 % pour une société."],
    base: "CGI Bénin : retenue à la source sur les loyers versés par les entreprises, reversée le 10 du mois suivant.",
    comment: "Déclaration des retenues sur loyers sur e-services impots.bj.",
    detail: { loyers: montant },
  };
}

/** Résultat fiscal estimé d'une année à partir des données de l'application. */
export function resultatEstime(annee: number, d: DonneesFiscales) {
  const factures = d.facturesClients.filter((f) => f.statut !== "Annulée" && dansAnnee(f.date_emission, annee));
  const avoirs = d.avoirs.filter((a) => dansAnnee(a.date_avoir, annee));
  const ca = somme(factures, (f) => f.montant_ht) - somme(avoirs, (a) => a.montant_ht);
  const achats = somme(d.facturesFournisseurs.filter((f) => !["Rejetée", "Annulée"].includes(f.statut) && dansAnnee(f.date_reception, annee)), (f) => f.montant_ht);
  const depenses = somme(d.depenses.filter((x) => x.statut === "Payée" && dansAnnee(x.date_depense, annee)), (x) => x.montant);
  const fg = somme(d.fraisGeneraux.filter((f) => dansAnnee(f.mois, annee)), (f) => f.montant);
  let salaires = 0;
  for (let m = 1; m <= 12; m++) salaires += somme(d.salaires[cleMois(annee, m)] ?? [], (s) => s.brut);
  const charges = arrondi(salaires * ((d.params.vps ?? 4) + (d.params.cnss_patronal ?? 15.4) + (d.params.cnss_risque_pro ?? 1)) / 100);
  const resultat = ca - achats - depenses - fg - salaires - charges;
  const aibSubi = somme(d.facturesClients.filter((f) => f.statut === "Payée" && dansAnnee(f.encaisse_le, annee)), (f) => f.montant_aib);
  return { ca, achats, depenses, fg, salaires, charges, resultat, aibSubi };
}

function isAcompteBenin(annee: number, mois: number, d: DonneesFiscales): Obligation | null {
  const n = [3, 6, 9, 12].indexOf(mois);
  if (n < 0) return null;
  const isN1 = d.params.is_annee_precedente ?? 0;
  const acompte = arrondi(isN1 / 4);
  const debut = moisAvant(annee, mois, 3);
  const aibPeriode = somme(
    d.facturesClients.filter((f) => f.statut === "Payée" && f.encaisse_le && f.encaisse_le >= date(debut.annee, debut.mois, 11) && f.encaisse_le <= date(annee, mois, 10)),
    (f) => f.montant_aib,
  );
  const alertes: string[] = [];
  if (!isN1) {
    const est = resultatEstime(annee - 1, d);
    const estIs = Math.max(arrondi(Math.max(est.resultat, 0) * (d.params.is_taux ?? 30) / 100), Math.max(arrondi(est.ca * (d.params.is_minimum ?? 1) / 100), 250_000));
    alertes.push(`Renseignez dans Paramètres l'IS dû au titre de ${annee - 1} (avis ou déclaration de résultat) : il sert de base aux acomptes. `
      + `Estimation d'après l'application : ${estIs.toLocaleString("fr-FR")} FCFA, soit un acompte de ${arrondi(estIs / 4).toLocaleString("fr-FR")} FCFA.`);
  }
  if (aibPeriode) alertes.push(`AIB retenu par vos clients depuis le dernier acompte : ${aibPeriode.toLocaleString("fr-FR")} FCFA. C'est un acompte d'impôt : gardez les attestations, il s'impute sur l'IS (l'agent l'impute sur le solde annuel).`);
  return {
    code: "IS_ACOMPTE", nom: `IS · acompte n° ${n + 1}`, organisme: "DGI (impots.bj)",
    periode: `${annee}-A${n + 1}`, libellePeriode: `acompte ${n + 1} de ${annee}`,
    echeance: date(annee, mois, 10),
    montant: acompte,
    lignes: [
      { libelle: `IS dû au titre de ${annee - 1} (Paramètres)`, montant: isN1 },
      { libelle: "Acompte = un quart", montant: acompte },
    ],
    alertes,
    base: "CGI Bénin : quatre acomptes d'IS, chacun égal au quart de l'impôt de l'année précédente, au plus tard les 10 mars, 10 juin, 10 septembre et 10 décembre.",
    comment: "Déclaration et paiement de l'acompte sur e-services impots.bj.",
    detail: { is_n_1: isN1 },
  };
}

function isSoldeBenin(annee: number, mois: number, d: DonneesFiscales): Obligation[] {
  if (mois !== 4) return [];
  const n1 = annee - 1;
  const est = resultatEstime(n1, d);
  const taux = d.params.is_taux ?? 30;
  const theorique = arrondi(Math.max(est.resultat, 0) * taux / 100);
  const minimum = Math.max(arrondi(est.ca * (d.params.is_minimum ?? 1) / 100), 250_000);
  const du = Math.max(theorique, minimum);
  const acomptes = somme(d.declarations.filter((x) => x.obligation === "IS_ACOMPTE" && x.periode.startsWith(`${n1}-A`)), (x) => x.montant_declare);
  const solde = du - acomptes - est.aibSubi;
  const is: Obligation = {
    code: "IS_SOLDE", nom: `IS · solde ${n1}`, organisme: "DGI (impots.bj)",
    periode: String(n1), libellePeriode: `exercice ${n1}`,
    echeance: date(annee, 4, 30),
    montant: Math.max(solde, 0),
    lignes: [
      { libelle: `Chiffre d'affaires HT ${n1} (factures − avoirs)`, montant: est.ca },
      { libelle: "Achats (factures fournisseurs HT)", montant: moins(est.achats) },
      { libelle: "Dépenses payées", montant: moins(est.depenses) },
      { libelle: "Frais généraux", montant: moins(est.fg) },
      { libelle: "Salaires bruts", montant: moins(est.salaires) },
      { libelle: "Charges sociales et VPS", montant: moins(est.charges) },
      { libelle: "Résultat estimé", montant: est.resultat },
      { libelle: `IS théorique ${taux} %`, montant: theorique },
      { libelle: `Minimum de perception (${d.params.is_minimum ?? 1} % du CA, au moins 250 000)`, montant: minimum },
      { libelle: "IS dû (le plus élevé des deux)", montant: du },
      { libelle: "Moins acomptes versés (registre)", montant: moins(acomptes) },
      { libelle: "Moins AIB retenu par les clients", montant: moins(est.aibSubi) },
      solde >= 0 ? { libelle: "Solde à payer", montant: solde } : { libelle: "Excédent (imputable ou remboursable)", montant: -solde },
    ],
    alertes: [
      "Estimation de gestion : le résultat fiscal définitif vient des états financiers SYSCOHADA (amortissements, provisions, charges non déductibles). Faites-le valider par l'expert-comptable.",
      `Après dépôt, inscrivez l'IS dû de ${n1} dans Paramètres : il sert de base aux acomptes de ${annee}.`,
    ],
    base: "CGI Bénin : IS 30 % du bénéfice, minimum de perception 1 % du chiffre d'affaires (3 % BTP selon le CGI, plancher 250 000 FCFA) ; déclaration de résultat et solde avant le 1er mai.",
    comment: "Déclaration de résultat sur e-services impots.bj, paiement du solde, en même temps que les états financiers.",
    detail: { ...est, theorique, minimum, du, acomptes },
  };
  const dsf: Obligation = {
    code: "DSF", nom: `États financiers ${n1} (DSF)`, organisme: "DGI (impots.bj)",
    periode: String(n1), libellePeriode: `exercice ${n1}`,
    echeance: date(annee, 4, 30),
    montant: 0,
    lignes: [{ libelle: "Dépôt de la liasse SYSCOHADA (bilan, compte de résultat, notes annexes)" }],
    alertes: ["Comptabilité irrégulière ou non tenue : amende de 1 000 000 FCFA par exercice (CGI art. 500)."],
    base: "CGI Bénin : dépôt des états financiers au plus tard le 30 avril de l'année suivante.",
    comment: "Dépôt en ligne sur e-services impots.bj, signé par l'expert-comptable.",
    detail: {},
  };
  return [is, dsf];
}

function patenteBenin(annee: number, mois: number, d: DonneesFiscales): Obligation | null {
  if (mois !== 2 && mois !== 4) return null;
  const total = d.params.patente_annuelle ?? 0;
  const acompte = mois === 2;
  const montant = acompte ? arrondi(total / 2) : total - arrondi(total / 2);
  return {
    code: acompte ? "PATENTE_ACOMPTE" : "PATENTE_SOLDE", nom: acompte ? "Patente · acompte 50 %" : "Patente · solde", organisme: "DGI (impots.bj)",
    periode: String(annee), libellePeriode: `patente ${annee}`,
    echeance: acompte ? date(annee, 2, 10) : date(annee, 4, 30),
    montant,
    lignes: [{ libelle: `Patente ${annee} (Paramètres)`, montant: total }, { libelle: acompte ? "Acompte de 50 %" : "Solde", montant }],
    alertes: total ? [] : ["Renseignez dans Paramètres le montant de la patente (avis d'imposition ou montant de l'an dernier)."],
    base: "CGI Bénin art. 191 et suivants : patente, acompte de 50 % le 10 février, solde le 30 avril.",
    comment: "Paiement sur e-services impots.bj ou à la recette des impôts.",
    detail: { total },
  };
}

const BENIN: ReglesPays = {
  nom: "Bénin",
  moisSalaires: (annee, mois) => [1, 2, 3].map((n) => { const x = moisAvant(annee, mois, n); return cleMois(x.annee, x.mois); }),
  anneesSalaires: (annee, mois) => (mois === 3 || mois === 4 || mois === 6 || mois === 9 || mois === 12 ? [annee - 1] : []),
  obligations: (annee, mois, d) => {
    const l: (Obligation | null)[] = [
      tvaBenin(annee, mois, d), itsBeninObligation(annee, mois, d), vpsBenin(annee, mois, d), aibBenin(annee, mois, d),
      loyersBenin(annee, mois, d), cnssBenin(annee, mois, d), isAcompteBenin(annee, mois, d), patenteBenin(annee, mois, d),
      ...isSoldeBenin(annee, mois, d),
    ];
    return l.filter((x): x is Obligation => !!x).sort((a, b) => a.echeance.localeCompare(b.echeance));
  },
  memo: `Règles fiscales et sociales du Bénin (CGI 2026, loi n° 2025-22 de finances pour 2026, CNSS) utilisées par l'agent :
- TVA 18 % ; exigible à l'encaissement pour les prestations de services et travaux ; déclaration et paiement au plus tard le 10 du mois suivant ; factures normalisées MECeF obligatoires. Loi de finances 2026 : TVA sur carburant des véhicules et engins affectés à l'activité déductible (art. 247), plafonnée à 90 % pour le BTP ; jamais pour les véhicules de tourisme ; crédits de TVA remboursables sur demande au plus tard le 30 avril de l'année suivante. Certains clients (État, entreprises désignées) retiennent une partie de la TVA à la source (40 %).
- ITS : barème mensuel sur le brut imposable : 0 % jusqu'à 60 000 ; 10 % de 60 001 à 150 000 ; 15 % jusqu'à 250 000 ; 19 % jusqu'à 500 000 ; 30 % au-delà ; retenu par l'employeur et reversé le 10 du mois suivant. Redevance ORTB : 1 000 FCFA sur le salaire de mars, 3 000 FCFA sur celui de juin (sauf salariés de la première tranche).
- VPS : 4 % des salaires bruts, le 10 du mois suivant.
- CNSS : employeur 9 % prestations familiales + 6,4 % pensions + 1 à 4 % risques professionnels ; salarié 3,6 % ; sans plafond ; dans les 15 jours qui suivent le mois (20 salariés et plus) ou le trimestre (moins de 20) ; majoration 1,5 % par mois de retard.
- AIB (art. 130-136) : 1 % achats et marchés publics (IFU), 3 % prestations de services (IFU), 5 % sans IFU ; l'AIB retenu par DGS sur ses fournisseurs est reversé le 10 du mois suivant ; l'AIB retenu par les clients de DGS est un acompte imputable sur l'IS.
- Retenue sur loyers : 12 % (bailleur personne physique), 10 % (personne morale), le 10 du mois suivant.
- IS : 30 % ; minimum de perception 1 % du chiffre d'affaires (3 % BTP), plancher 250 000 FCFA ; 4 acomptes du quart de l'IS de l'année précédente les 10 mars, 10 juin, 10 septembre, 10 décembre ; déclaration de résultat, solde et états financiers SYSCOHADA au plus tard le 30 avril.
- Patente : acompte 50 % le 10 février, solde le 30 avril.
- Pénalités (CGI art. 485 à 500) : retard de déclaration 20 % (40 % après mise en demeure) ; retard de paiement 10 % + 0,25 % par mois ; retenue non reversée 20 % (40 % au-delà de 2 mois) ; comptabilité irrégulière 1 000 000 FCFA.
- Les déclarations se font sur e-services impots.bj (DGI) et sur le portail de la CNSS.`,
  sources: [
    { titre: "Code général des impôts du Bénin 2026 (DGI)", url: "https://api.impots.bj/media/6984ebbbb7bc0_B%C3%A9nin-Code%20G%C3%A9n%C3%A9ral%20des%20Imp%C3%B4ts%202026.pdf" },
    { titre: "Loi de finances 2026 : mesures fiscales (Daabaaru)", url: "https://daabaaru.bj/loi-de-finances-gestion-2026-au-benin-les-innovations-et-mesures-fiscales-incitatives-apportees" },
    { titre: "Loi de finances 2026 expliquée aux experts-comptables (La Nation)", url: "https://lanation.bj/index.php/economie/loi-de-finances-2026-les-experts-comptables-eclaires-sur-les-nouvelles-regles-fiscales" },
    { titre: "Cotisations CNSS au Bénin (Cleiss)", url: "https://www.cleiss.fr/docs/cotisations/benin.html" },
  ],
};

export const REGLES_PAR_PAYS: Record<string, ReglesPays> = { BJ: BENIN };
