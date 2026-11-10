"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigerDroit, exigerSession } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { journaliser } from "@/lib/journal";

type Etat = { ok?: string; erreur?: string } | null;
const txt = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function etablirPv(_: Etat, f: FormData): Promise<Etat> {
  await exigerDroit("pv.initier");
  const supabase = await supabaseServeur();
  const av = txt(f, "avancement");
  const tiersId = txt(f, "tiers_id");
  const { data: t } = await supabase.from("tiers").select("nom,type").eq("id", tiersId).maybeSingle();
  if (!t) return { erreur: "Choisissez le client ou le prestataire." };
  const { data, error } = await supabase.from("pv_execution").insert({
    chantier_id: txt(f, "chantier_id"), type: t.type === "client" ? "client" : "prestataire", tiers: t.nom, tiers_id: tiersId, objet: txt(f, "objet"),
    date_pv: txt(f, "date_pv") || undefined, avancement: av ? Number(av) : null,
  }).select("id,numero").single();
  if (error) return { erreur: "Le PV n'a pas été enregistré : " + error.message };
  await journaliser(`a établi le PV d'exécution ${data.numero} (${t.nom})`);
  revalidatePath("/pv");
  redirect(`/pv/${data.id}`);
}

export async function saisirQuantites(_: Etat, f: FormData): Promise<Etat> {
  await exigerDroit("pv.initier");
  const supabase = await supabaseServeur();
  const pv = txt(f, "pv_id");
  const lignes: Record<string, unknown>[] = [];
  for (const [k, v] of f.entries()) {
    const q = Number(String(v).replace(/\s/g, "").replace(",", "."));
    if (!(q > 0)) continue;
    const [ch, bp] = k.startsWith("q:") ? k.slice(2).split("|") : [null, null];
    if (ch === null) continue;
    lignes.push({ pv_id: pv, chantier_ligne_id: ch || null, bordereau_id: bp || null, designation: "-", unite: "-", quantite: q, prix_unitaire_ht: 0 });
  }
  const libre = txt(f, "libre_designation"), lq = Number(txt(f, "libre_quantite").replace(",", "."));
  if (libre && lq > 0) lignes.push({ pv_id: pv, designation: libre, unite: txt(f, "libre_unite") || "u", quantite: lq, prix_unitaire_ht: Number(txt(f, "libre_pu")) || 0 });
  // Les lignes du marché ou du bordereau sont remplacées ; les lignes hors bordereau restent, sauf si on les retire.
  const retirer = [...f.keys()].filter((k) => k.startsWith("x:")).map((k) => k.slice(2));
  const { error: e1 } = await supabase.from("pv_lignes").delete().eq("pv_id", pv).or("chantier_ligne_id.not.is.null,bordereau_id.not.is.null");
  if (e1) return { erreur: e1.message };
  if (retirer.length) await supabase.from("pv_lignes").delete().eq("pv_id", pv).in("id", retirer);
  if (lignes.length) {
    const { error } = await supabase.from("pv_lignes").insert(lignes);
    if (error) return { erreur: "Les quantités n'ont pas été enregistrées : " + error.message };
  }
  const { data } = await supabase.from("pv_execution").select("numero,montant_ht").eq("id", pv).single();
  await journaliser(`a saisi les quantités exécutées du PV ${data?.numero} (${lignes.length} ligne(s))`);
  revalidatePath(`/pv/${pv}`);
  revalidatePath("/pv");
  return { ok: `Quantités enregistrées : ${lignes.length} ligne(s).` };
}

export async function signerPv(_: Etat, f: FormData): Promise<Etat> {
  await exigerDroit("pv.initier");
  const supabase = await supabaseServeur();
  const { error } = await supabase.rpc("signer_pv", { p_id: txt(f, "id"), p_le: txt(f, "signe_le") || null });
  if (error) return { erreur: error.message };
  await journaliser(`a enregistré la signature du PV ${txt(f, "numero")}`);
  revalidatePath("/pv");
  revalidatePath(`/pv/${txt(f, "id")}`);
  revalidatePath("/finances");
  return { ok: "PV marqué signé : il peut être facturé." };
}

export async function annulerPv(_: Etat, f: FormData): Promise<Etat> {
  await exigerSession();
  const supabase = await supabaseServeur();
  const { error } = await supabase.rpc("annuler_pv", { p_id: txt(f, "id"), p_motif: txt(f, "motif") });
  if (error) return { erreur: error.message };
  await journaliser(`a annulé le PV ${txt(f, "numero")} (motif : ${txt(f, "motif")})`);
  revalidatePath("/pv");
  revalidatePath("/finances");
  return { ok: `PV ${txt(f, "numero")} annulé.` };
}
