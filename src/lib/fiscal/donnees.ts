import "server-only";
import { supabaseServeur } from "@/lib/supabase/server";
import { cleMois, moisAvant, REGLES_PAR_PAYS, type DonneesFiscales, type Obligation, type ReglesPays, type Salaire } from "./regles";

export type EtatObligation = Obligation & {
  enregistree: { statut: "Déclarée" | "Payée"; montant_declare: number; reference: string | null; declare_le: string; paye_le: string | null } | null;
  etat: "Faite" | "À payer" | "En retard" | "À faire";
};

/** Lit toutes les données nécessaires à l'agent pour les mois d'échéance demandés (pays courant). */
export async function chargerDonnees(regles: ReglesPays, echeances: { annee: number; mois: number }[]): Promise<DonneesFiscales> {
  const supabase = await supabaseServeur();
  const minAnnee = Math.min(...echeances.map((e) => e.annee)) - 1;
  const depuis = `${minAnnee}-01-01`;

  const moisSal = new Set<string>();
  for (const e of echeances) {
    regles.moisSalaires(e.annee, e.mois, {}).forEach((m) => moisSal.add(m));
    for (const a of regles.anneesSalaires(e.annee, e.mois)) for (let m = 1; m <= 12; m++) moisSal.add(cleMois(a, m));
  }
  const listeMois = [...moisSal].sort();

  const [params, fc, av, ff, dep, fg, paies, decl, ...sal] = await Promise.all([
    supabase.from("parametres").select("cle,valeur"),
    supabase.from("factures_clients").select("id,numero,objet,montant_ht,montant_tva,montant_aib,date_emission,encaisse_le,statut")
      .or(`date_emission.gte.${depuis},encaisse_le.gte.${depuis}`),
    supabase.from("avoirs_clients").select("numero,facture_id,montant_ht,montant_tva,montant_aib,date_avoir").gte("date_avoir", depuis),
    supabase.from("factures_fournisseurs").select("fournisseur,numero,objet,montant_ht,montant_tva,montant_aib,date_reception,statut,paye_le")
      .or(`date_reception.gte.${depuis},paye_le.gte.${depuis}`),
    supabase.from("depenses").select("objet,montant,statut,date_depense").gte("date_depense", depuis),
    supabase.from("frais_generaux").select("mois,categorie,libelle,montant").gte("mois", depuis),
    supabase.from("paies").select("mois,statut").gte("mois", depuis),
    supabase.from("declarations_fiscales").select("*"),
    ...listeMois.map((m) => supabase.rpc("masse_salariale_fiscale", { p_mois: `${m}-01` })),
  ]);
  const erreur = [params, fc, av, ff, dep, fg, paies, decl, ...sal].find((r) => r.error)?.error;
  if (erreur) throw new Error("Lecture des données fiscales impossible : " + erreur.message);

  const num = <T extends Record<string, unknown>>(r: T, cles: (keyof T)[]) => {
    const o = { ...r };
    for (const k of cles) (o as Record<string, unknown>)[k as string] = Number(r[k] ?? 0);
    return o;
  };
  const factures = (fc.data ?? []).map((f) => num(f, ["montant_ht", "montant_tva", "montant_aib"]));
  const statutFacture = new Map(factures.map((f) => [f.id as string, f.statut as string]));
  const salaires: Record<string, Salaire[]> = {};
  listeMois.forEach((m, i) => {
    salaires[m] = ((sal[i].data ?? []) as Salaire[]).map((s) => ({ ...s, brut: Number(s.brut), cnss_salarie: Number(s.cnss_salarie) }));
  });

  return {
    params: Object.fromEntries((params.data ?? []).map((p) => [p.cle, Number(p.valeur)])),
    facturesClients: factures as unknown as DonneesFiscales["facturesClients"],
    avoirs: (av.data ?? []).map((a) => ({ ...num(a, ["montant_ht", "montant_tva", "montant_aib"]), facture_encaissee: statutFacture.get(a.facture_id) === "Payée" })) as DonneesFiscales["avoirs"],
    facturesFournisseurs: (ff.data ?? []).map((f) => num(f, ["montant_ht", "montant_tva", "montant_aib"])) as unknown as DonneesFiscales["facturesFournisseurs"],
    depenses: (dep.data ?? []).map((x) => num(x, ["montant"])) as unknown as DonneesFiscales["depenses"],
    fraisGeneraux: (fg.data ?? []).map((x) => num(x, ["montant"])) as unknown as DonneesFiscales["fraisGeneraux"],
    salaires,
    paies: Object.fromEntries((paies.data ?? []).map((p) => [String(p.mois).slice(0, 7), p.statut])),
    declarations: (decl.data ?? []).map((x) => ({ ...x, montant_calcule: Number(x.montant_calcule), montant_declare: Number(x.montant_declare) })),
  };
}

/** Déclarations dont l'échéance tombe dans le mois demandé, avec leur état dans le registre. */
export function etatDuMois(regles: ReglesPays, annee: number, mois: number, d: DonneesFiscales, aujourdhui: string): EtatObligation[] {
  return regles.obligations(annee, mois, d).map((o) => {
    const e = d.declarations.find((x) => x.obligation === o.code && x.periode === o.periode) ?? null;
    const etat: EtatObligation["etat"] = e?.statut === "Payée" || (e && e.montant_declare <= 0) ? "Faite"
      : e ? "À payer" : o.echeance < aujourdhui ? "En retard" : "À faire";
    return { ...o, enregistree: e ? { statut: e.statut, montant_declare: e.montant_declare, reference: e.reference, declare_le: e.declare_le, paye_le: e.paye_le } : null, etat };
  });
}

/** Mois d'échéance suivis par les alertes : les 3 mois passés, le mois en cours et le suivant. */
export function moisSuivis(annee: number, mois: number) {
  return [3, 2, 1, 0, -1].map((n) => moisAvant(annee, mois, n));
}

export function reglesDuPays(code: string) {
  return REGLES_PAR_PAYS[code] ?? null;
}
