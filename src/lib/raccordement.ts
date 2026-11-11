// Lecture des rapports d'installation envoyés par les équipes (message WhatsApp « Clé : valeur »)
// et des tableaux de dossiers reçus. Aucune IA : le format est toujours le même.

export const RUBRIQUES: { cle: string; libelle: string; unite: string }[] = [
  { cle: "cable", libelle: "Câble (linéaire)", unite: "m" },
  { cle: "pince", libelle: "Pinces", unite: "pièce" },
  { cle: "crochet", libelle: "Crochets", unite: "pièce" },
  { cle: "susp", libelle: "Suspensions", unite: "pièce" },
  { cle: "piton", libelle: "Pitons", unite: "pièce" },
  { cle: "closer", libelle: "Closers", unite: "pièce" },
  { cle: "rp1", libelle: "RP1", unite: "pièce" },
  { cle: "traverse_13t", libelle: "Traverses 13T", unite: "pièce" },
  { cle: "traverse_15t", libelle: "Traverses 15T", unite: "pièce" },
  { cle: "semelle", libelle: "Semelles", unite: "pièce" },
  { cle: "poteau_arme", libelle: "Poteaux SBEE armés", unite: "pièce" },
  { cle: "poteau_implante", libelle: "Poteaux implantés", unite: "pièce" },
];

export type Rapport = {
  equipe: string;          // nom lu dans l'en-tête (*ÉQUIPE EUGÈNE/DGS*)
  date: string;            // AAAA-MM-JJ
  client: string;
  ligne: string;
  mobile: string;
  cable: string;           // type de câble (CPC…)
  latitude: number | null;
  longitude: number | null;
  champs: Record<string, string>;     // toutes les valeurs lues, libellés d'origine (sans mot de passe)
  materiel: Record<string, number>;   // rubrique → quantité
  brut: string;                       // message sans le mot de passe
  alertes: string[];
};

export const norm = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** « ..00 » → 0, « 04 » → 4, « 250m » → 250, « 1,5 » → 1.5 */
export function nombre(v: string | undefined): number | null {
  if (v == null) return null;
  const m = /-?\d+(?:[.,]\d+)?/.exec(v.replace(/\s/g, ""));
  return m ? Number(m[0].replace(",", ".")) : null;
}

export function gps(v: string | undefined): { latitude: number; longitude: number } | null {
  const n = String(v ?? "").match(/-?\d+(?:\.\d+)?/g);
  if (!n || n.length < 2) return null;
  const [latitude, longitude] = [Number(n[0]), Number(n[1])];
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || (latitude === 0 && longitude === 0)) return null;
  return { latitude, longitude };
}

/** « 07/11/2026 » ou « 7-11-26 » → « 2026-11-07 » */
export function dateIso(v: unknown): string {
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = String(v ?? "");
  let m = /(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s);
  if (!m) return "";
  const a = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${a}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

// Libellé normalisé → rubrique de matériel.
const MATERIEL: Record<string, string> = {
  lineaire: "cable", pince: "pince", pinces: "pince", crochet: "crochet", crochets: "crochet",
  susp: "susp", suspension: "susp", piton: "piton", pitons: "piton", closer: "closer", rp1: "rp1",
  "traverse 13t": "traverse_13t", "traverse 15t": "traverse_15t", "semelle eq": "semelle", semelle: "semelle",
  "poteaux sbee arme": "poteau_arme", "poteau sbee arme": "poteau_arme",
  "nombre de poteaux implantes": "poteau_implante", "poteau implante": "poteau_implante", "poteaux implantes": "poteau_implante",
};
const SECRET = /^(password|mot de passe|mdp|pwd|login|identifiant)/;

/** Lit un rapport. */
export function lireRapport(texte: string): Rapport {
  const lignes = texte.replace(/\r/g, "").split("\n");
  const champs: Record<string, string> = {};
  const parNorm: Record<string, string> = {};
  const garde: string[] = [];
  let apresSecret = false;
  for (const brute of lignes) {
    const l = brute.trim();
    const m = /^([^:]{1,60}?)\s*:\s*(.*)$/.exec(l);
    if (m && !/^https?$/i.test(m[1])) {
      const cle = m[1].replace(/\*/g, "").trim();
      const n = norm(cle);
      if (SECRET.test(n)) { apresSecret = true; continue; }
      apresSecret = false;
      const val = m[2].replace(/\*/g, "").trim();
      champs[cle] = val;
      parNorm[n] = val;
      garde.push(brute);
    } else {
      // La ligne qui suit le mot de passe (identifiant de la box) n'est pas gardée non plus.
      if (apresSecret && l !== "") { apresSecret = false; continue; }
      garde.push(brute);
    }
  }
  const alertes: string[] = [];
  const entete = /\*?\s*([ÉEée]quipe[^*\n]*)\*?/i.exec(texte);
  const equipe = entete ? entete[1].replace(/\/\s*DGS\s*$/i, "").replace(/^[ÉEée]quipe\s*/i, "").trim() : "";
  const date = dateIso(texte);
  if (!date) alertes.push("Date du raccordement introuvable : la date du jour sera utilisée.");

  const materiel: Record<string, number> = {};
  for (const [n, v] of Object.entries(parNorm)) {
    const rub = MATERIEL[n];
    if (!rub) continue;
    const q = nombre(v);
    if (q == null) continue;
    materiel[rub] = rub === "poteau_implante" ? Math.max(materiel[rub] ?? 0, q) : q;
  }
  if (materiel.cable == null) {
    const arr = nombre(parNorm["arrivee"]);
    if (arr != null) { materiel.cable = arr; alertes.push("Linéaire absent : la longueur « Arrivée » est prise comme câble posé."); }
  }
  for (const k of Object.keys(materiel)) if (!materiel[k]) delete materiel[k];

  const ligne = (parNorm["ligne"] ?? parNorm["numero ligne"] ?? parNorm["n ligne"] ?? "").replace(/\D/g, "");
  if (!ligne) alertes.push("Numéro de ligne introuvable : le rapport ne peut pas être rattaché.");
  const pos = gps(parNorm["gps client"]);
  return {
    equipe, date, ligne,
    client: parNorm["client"] ?? "",
    mobile: (parNorm["mobile"] ?? "").replace(/\s/g, ""),
    cable: (parNorm["type de cable"] ?? parNorm["cable"] ?? "").toUpperCase().replace(/[^A-Z0-9_ -]/g, "").trim(),
    latitude: pos?.latitude ?? null, longitude: pos?.longitude ?? null,
    champs, materiel, brut: garde.join("\n").trim(), alertes,
  };
}

/** Plusieurs rapports collés à la suite : chaque en-tête « *ÉQUIPE …* » ou « RACCORDEMENT du » en commence un. */
export function lireRapports(texte: string): Rapport[] {
  const morceaux: string[] = [];
  let courant: string[] = [];
  let aDesChamps = false;
  for (const l of texte.replace(/\r/g, "").split("\n")) {
    const debut = /^\s*\*?\s*[ÉEée]quipe\b/i.test(l) || (/^\s*\*?\s*raccordement\b/i.test(l) && aDesChamps);
    if (debut && aDesChamps) { morceaux.push(courant.join("\n")); courant = []; aDesChamps = false; }
    courant.push(l);
    if (/:/.test(l) && !/^\s*\*?\s*raccordement/i.test(l)) aDesChamps = true;
  }
  if (courant.join("").trim()) morceaux.push(courant.join("\n"));
  return morceaux.map(lireRapport).filter((r) => r.ligne || Object.keys(r.champs).length > 2);
}

// ---------------------------------------------------------------------------
// Dossiers reçus (tableau Excel)
// ---------------------------------------------------------------------------
export type Dossier = {
  client: string; ligne: string; mobile?: string; msan?: string; offre?: string;
  latitude?: number | null; longitude?: number | null; date_demande?: string; date_limite?: string;
};
type ChampDossier = keyof Dossier | "gps";
const ENTETES: [RegExp, ChampDossier][] = [
  [/^(client|nom|nom du client|abonne|nom client|raison sociale)/, "client"],
  [/^(ligne|n ligne|numero ligne|numero de ligne|ndi|numero)/, "ligne"],
  [/^(mobile|contact|telephone|tel|cellulaire)/, "mobile"],
  [/^(msan|fat|olt|pc|point de concentration)/, "msan"],
  [/^(gps|coordonnees|position)/, "gps"],
  [/^latitude/, "latitude"],
  [/^longitude/, "longitude"],
  [/^(date demande|date de demande|date commande|date reception|date de reception|date)$/, "date_demande"],
  [/^(date limite|delai|date rdv|date de rendez vous|echeance|date fin)/, "date_limite"],
  [/^(offre|forfait|produit|service)/, "offre"],
];
// Ordre des colonnes quand le tableau n'a pas d'en-têtes (modèle reçu de l'opérateur).
const ORDRE: ChampDossier[] = ["client", "ligne", "mobile", "msan", "gps", "date_demande", "date_limite", "offre"];

export function lireDossiers(rows: unknown[][]): { dossiers: Dossier[]; sansEntetes: boolean } {
  const iEntete = rows.slice(0, 10).findIndex((r) => r.some((c) => norm(c) && ENTETES.some(([re, ch]) => ch === "client" && re.test(norm(c)))));
  const colonnes: (ChampDossier | undefined)[] = iEntete >= 0
    ? rows[iEntete].map((c) => ENTETES.find(([re]) => re.test(norm(c)))?.[1])
    : ORDRE;
  const corps = rows.slice(iEntete + 1);
  const dossiers: Dossier[] = [];
  for (const r of corps) {
    if (r.every((c) => c == null || String(c).trim() === "")) continue;
    const d: Dossier = { client: "", ligne: "" };
    r.forEach((c, j) => {
      const ch = colonnes[j];
      if (!ch || c == null) return;
      const s = c instanceof Date ? c.toISOString() : String(c).replace(/\s+/g, " ").trim();
      if (ch === "gps") { const p = gps(s); d.latitude = p?.latitude ?? null; d.longitude = p?.longitude ?? null; }
      else if (ch === "latitude" || ch === "longitude") d[ch] = nombre(s);
      else if (ch === "date_demande" || ch === "date_limite") d[ch] = dateIso(c);
      else if (ch === "ligne" || ch === "mobile") d[ch] = s.replace(/\D/g, "");
      else d[ch] = s;
    });
    if (d.client || d.ligne) dossiers.push(d);
  }
  return { dossiers, sansEntetes: iEntete < 0 };
}
