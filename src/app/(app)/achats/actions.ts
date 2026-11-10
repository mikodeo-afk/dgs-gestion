"use server";
import { revalidatePath } from "next/cache";
import { exigerDroit } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { journaliser } from "@/lib/journal";
import { fcfa } from "@/lib/format";
import { tauxDuPays } from "@/lib/parametres";

type Etat = { ok?: string; erreur?: string } | null;
const txt = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function demanderAchat(_: Etat, f: FormData): Promise<Etat> {
  await exigerDroit("da.demander");
  const supabase = await supabaseServeur();
  const estime = Number(txt(f, "montant_estime"));
  const { data, error } = await supabase.from("demandes_achat").insert({
    chantier_id: txt(f, "chantier_id"), objet: txt(f, "objet"), details: txt(f, "details") || null,
    montant_estime: estime > 0 ? estime : null, besoin_le: txt(f, "besoin_le") || null,
  }).select("numero").single();
  if (error) return { erreur: "La demande n'a pas été enregistrée : " + error.message };
  await journaliser(`a initié la demande d'achat ${data.numero} « ${txt(f, "objet")} »`);
  revalidatePath("/achats");
  return { ok: `Demande ${data.numero} envoyée au RAF.` };
}

export async function initierBonCommande(_: Etat, f: FormData): Promise<Etat> {
  await exigerDroit("bc.initier");
  const supabase = await supabaseServeur();
  const ht = Number(txt(f, "montant_ht"));
  const { data, error } = await supabase.rpc("initier_bon_commande", {
    p_demande: txt(f, "demande_id"), p_fournisseur: txt(f, "fournisseur"), p_montant_ht: ht,
    p_taux_tva: txt(f, "taux_tva") === "0" ? 0 : (await tauxDuPays()).tva, p_livraison: txt(f, "livraison_le") || null,
  });
  if (error) return { erreur: error.message };
  await journaliser(`a initié le bon de commande ${data} (${fcfa(ht)} FCFA HT) pour la demande ${txt(f, "numero")}`);
  revalidatePath("/achats");
  return { ok: `Bon de commande ${data} envoyé au DO pour validation.` };
}

export async function rejeterDemande(_: Etat, f: FormData): Promise<Etat> {
  await exigerDroit("bc.initier");
  const supabase = await supabaseServeur();
  const { error } = await supabase.rpc("rejeter_demande_achat", { p_id: txt(f, "id"), p_motif: txt(f, "motif") });
  if (error) return { erreur: error.message };
  await journaliser(`a rejeté la demande d'achat ${txt(f, "numero")} : ${txt(f, "motif")}`);
  revalidatePath("/achats");
  return { ok: "Demande rejetée." };
}

export async function deciderBonCommande(_: Etat, f: FormData): Promise<Etat> {
  await exigerDroit("bc.valider");
  const supabase = await supabaseServeur();
  const accepte = txt(f, "accepte") === "1";
  const { error } = await supabase.rpc("decider_bon_commande", { p_id: txt(f, "id"), p_accepte: accepte, p_motif: txt(f, "motif") || null });
  if (error) return { erreur: error.message };
  await journaliser(`a ${accepte ? "validé" : "rejeté"} le bon de commande ${txt(f, "numero")}`);
  revalidatePath("/achats");
  return { ok: accepte ? "Bon de commande validé." : "Bon de commande rejeté : la demande retourne au RAF." };
}
