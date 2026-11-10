"use server";
import { revalidatePath } from "next/cache";
import { exigerDroit } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { journaliser } from "@/lib/journal";

type Etat = { ok?: string; erreur?: string } | null;

export async function modifierParametre(_: Etat, f: FormData): Promise<Etat> {
  const s = await exigerDroit("param.gerer");
  const cle = String(f.get("cle") ?? "");
  const brut = String(f.get("valeur") ?? "").replace(",", ".").replace(/\s/g, "");
  const valeur = Number(brut);
  if (!brut || !Number.isFinite(valeur) || valeur < 0) return { erreur: "Saisissez un nombre positif." };
  const supabase = await supabaseServeur();
  const { data, error } = await supabase.from("parametres").update({ valeur }).eq("cle", cle).select("libelle").maybeSingle();
  if (error) return { erreur: error.message.includes("parametres_valeur_check") ? "Un taux doit être compris entre 0 et 100 %." : error.message };
  if (!data) return { erreur: "Ce paramètre n'a pas été modifié (droit ou pays)." };
  await journaliser(`a réglé « ${data.libelle} » à ${valeur} (${s.pays.nom})`);
  revalidatePath("/", "layout");
  return { ok: "Enregistré." };
}

export async function modifierIdentite(_: Etat, f: FormData): Promise<Etat> {
  const s = await exigerDroit("param.gerer");
  const t = (k: string) => String(f.get(k) ?? "").trim();
  const supabase = await supabaseServeur();
  const { error } = await supabase.rpc("definir_identite", {
    p_raison: t("raison_sociale"), p_rccm: t("rccm"), p_ifu: t("ifu"), p_adresse: t("adresse"), p_telephone: t("telephone"), p_email: t("email"),
  });
  if (error) return { erreur: error.message };
  await journaliser(`a mis à jour l'identité légale de DGS ${s.pays.nom} (RCCM, IFU, coordonnées)`);
  revalidatePath("/", "layout");
  return { ok: "Identité enregistrée. Elle figure sur les factures." };
}
