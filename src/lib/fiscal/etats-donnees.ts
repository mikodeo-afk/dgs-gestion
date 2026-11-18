import "server-only";
import { supabaseServeur } from "@/lib/supabase/server";
import { chargerDonnees, reglesDuPays } from "./donnees";
import { avecN1, calculerEtats, type DonneesEtats, type Equipement, type Etats, type Saisies } from "./etats";

export type Cloture = {
  annee: number; saisies: Saisies; notes: NotesAnnexes | null; etats: Etats | null;
  statut: "Brouillon" | "Arrêté"; maj_le: string; arrete_le: string | null;
};
export type NotesAnnexes = {
  redige_le: string;
  notes: { numero: string; titre: string; texte: string }[];
  points_de_vigilance: string[];
};

/** Lit les données et calcule les états financiers de l'exercice (colonne N-1 comprise). */
export async function chargerEtats(paysCode: string, annee: number) {
  const regles = reglesDuPays(paysCode);
  const supabase = await supabaseServeur();
  const echeances = Array.from({ length: 24 }, (_, i) => {
    const t = (annee - 1) * 12 + 1 + i; // de février N-1 à janvier N+1
    return { annee: Math.floor(t / 12), mois: (t % 12) + 1 };
  });
  const [base, invN, invN1, clo] = await Promise.all([
    regles ? chargerDonnees(regles, echeances) : Promise.reject(new Error("Règles du pays non configurées.")),
    supabase.rpc("donnees_cloture", { p_annee: annee }),
    supabase.rpc("donnees_cloture", { p_annee: annee - 1 }),
    supabase.from("clotures_exercice").select("annee,saisies,notes,etats,statut,maj_le,arrete_le").in("annee", [annee, annee - 1]),
  ]);
  const err = invN.error ?? invN1.error ?? clo.error;
  if (err) throw new Error("Lecture des données de clôture impossible : " + err.message);
  const inv = (x: unknown) => x as { stock_debut: number; stock_fin: number; equipements: Equipement[] };
  const d: DonneesEtats = {
    ...(base as unknown as DonneesEtats),
    stock: {
      [annee]: { debut: Number(inv(invN.data).stock_debut), fin: Number(inv(invN.data).stock_fin) },
      [annee - 1]: { debut: Number(inv(invN1.data).stock_debut), fin: Number(inv(invN1.data).stock_fin) },
    },
    equipements: inv(invN.data).equipements.map((e) => ({ ...e, valeur_acquisition: e.valeur_acquisition === null ? null : Number(e.valeur_acquisition) })),
  };
  const clotures = (clo.data ?? []) as Cloture[];
  const cloN = clotures.find((c) => c.annee === annee) ?? null;
  const cloN1 = clotures.find((c) => c.annee === annee - 1) ?? null;

  const activiteN1 = d.facturesClients.some((f) => f.date_emission.startsWith(String(annee - 1)))
    || d.facturesFournisseurs.some((f) => f.date_reception.startsWith(String(annee - 1)))
    || d.depenses.some((x) => x.date_depense.startsWith(String(annee - 1)));
  let etatsN1: Etats | null = null;
  if (cloN1?.statut === "Arrêté" && cloN1.etats) etatsN1 = cloN1.etats;
  else if (cloN1 || activiteN1) etatsN1 = calculerEtats(annee - 1, d, cloN1?.saisies ?? {}, paysCode, null);
  const etats = avecN1(calculerEtats(annee, d, cloN?.saisies ?? {}, paysCode, cloN1 ? etatsN1 : null), etatsN1);
  return { etats: cloN?.statut === "Arrêté" && cloN.etats ? cloN.etats : etats, calcul: etats, cloture: cloN, precedente: cloN1, premierExercice: !cloN1 && !activiteN1 };
}
