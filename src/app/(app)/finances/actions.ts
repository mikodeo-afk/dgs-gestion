"use server";
import { revalidatePath } from "next/cache";
import { exigerDroit, exigerSession } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { journaliser } from "@/lib/journal";
import { fcfa } from "@/lib/format";

const txt = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const fin = () => revalidatePath("/finances");

export async function emettreFacture(_: unknown, f: FormData) {
  await exigerDroit("fc.emettre");
  const supabase = await supabaseServeur();
  const { data, error } = await supabase.from("factures_clients").insert({
    pv_id: txt(f, "pv_id"), objet: txt(f, "objet"), echeance: txt(f, "echeance"),
  }).select("numero,montant_ht,montant_ttc").single();
  if (error) return { erreur: "La facture n'a pas été émise : " + error.message };
  await journaliser(`a émis la facture ${data.numero} (${fcfa(data.montant_ht)} FCFA HT, ${fcfa(data.montant_ttc)} FCFA TTC)`);
  fin();
  return { ok: `Facture ${data.numero} émise.` };
}

export async function enregistrerFactureFournisseur(_: unknown, f: FormData) {
  await exigerDroit("ff.enregistrer");
  const supabase = await supabaseServeur();
  const ch = txt(f, "chantier_id");
  const { error } = await supabase.from("factures_fournisseurs").insert({
    fournisseur: txt(f, "fournisseur"), numero: txt(f, "numero"), chantier_id: ch === "FG" ? null : ch,
    pv_id: txt(f, "pv_id") || null, bon_commande_id: txt(f, "bon_commande_id") || null,
    objet: txt(f, "objet"), montant_ht: Number(txt(f, "montant_ht")), taux_tva: txt(f, "taux_tva") === "0" ? 0 : 18, echeance: txt(f, "echeance") || null,
  });
  if (error) return { erreur: error.code === "23505" ? "Cette facture de ce fournisseur est déjà enregistrée." : "La facture n'a pas été enregistrée : " + error.message };
  await journaliser(`a enregistré la facture ${txt(f, "numero")} de ${txt(f, "fournisseur")}`);
  fin();
  return { ok: "Facture fournisseur enregistrée." };
}

export async function ajouterFraisGeneral(_: unknown, f: FormData) {
  await exigerDroit("fg.saisir");
  const supabase = await supabaseServeur();
  const { error } = await supabase.from("frais_generaux").insert({
    mois: txt(f, "mois") + "-01", categorie: txt(f, "categorie"), libelle: txt(f, "libelle"), montant: Number(txt(f, "montant")),
  });
  if (error) return { erreur: error.message };
  await journaliser(`a ajouté « ${txt(f, "libelle")} » aux frais généraux`);
  fin();
  return { ok: "Frais général ajouté." };
}

async function rpc(nom: string, args: Record<string, unknown>, message: string) {
  await exigerSession();
  const supabase = await supabaseServeur();
  const { error } = await supabase.rpc(nom, args);
  if (error) throw new Error(error.message);
  await journaliser(message);
  fin();
}
export async function encaisser(f: FormData) {
  await rpc("encaisser_facture", { p_id: txt(f, "id") }, `a encaissé la facture ${txt(f, "numero")}`);
}
export async function deciderFactureFournisseur(f: FormData) {
  const ok = txt(f, "accepte") === "1";
  await rpc("decider_facture_fournisseur", { p_id: txt(f, "id"), p_accepte: ok }, `a ${ok ? "donné le bon à payer pour" : "rejeté"} la facture ${txt(f, "numero")}`);
}
export async function payerFactureFournisseur(f: FormData) {
  await rpc("payer_facture_fournisseur", { p_id: txt(f, "id") }, `a payé la facture fournisseur ${txt(f, "numero")}`);
}
