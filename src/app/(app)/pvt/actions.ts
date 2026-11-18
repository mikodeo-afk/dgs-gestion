"use server";
import { revalidatePath } from "next/cache";
import { exigerDroit, exigerSession } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { journaliser } from "@/lib/journal";
import { fcfa } from "@/lib/format";
import { identifiantVersEmail } from "@/lib/identifiant";
import type { LigneExtraction } from "@/lib/pvt";

export type Etat = { ok?: string; erreur?: string } | null;
const txt = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (f: FormData, k: string) => Number(txt(f, k).replace(/\s/g, "").replace(",", ".")) || 0;
const debutMois = (d: string) => d.slice(0, 7) + "-01";
const fini = (m: string): Etat => { revalidatePath("/pvt"); return { ok: m }; };

// --- Ventes ---------------------------------------------------------------------
export async function declarerVente(_: Etat, f: FormData): Promise<Etat> {
  const s = await exigerSession();
  const supabase = await supabaseServeur();
  let vendeur = txt(f, "vendeur_id");
  if (!s.peut("pvt.saisir") && !s.peut("pvt.gerer")) {
    const { data } = await supabase.from("pvt_vendeurs").select("id").eq("profil_id", s.profil.id).maybeSingle();
    if (!data) return { erreur: "Votre compte n'est relié à aucune fiche de vendeur. Voyez votre superviseur." };
    vendeur = data.id;
  }
  const date = txt(f, "date_vente");
  const ligne = txt(f, "ligne").replace(/[^0-9A-Za-z-]/g, "");
  if (!vendeur || !date || !txt(f, "offre_id")) return { erreur: "Vendeur, date et offre sont obligatoires." };
  const { error } = await supabase.from("pvt_ventes").insert({
    mois: debutMois(date), date_vente: date, vendeur_id: vendeur, offre_id: txt(f, "offre_id"),
    client: txt(f, "client") || null, ligne: ligne || null, contact: txt(f, "contact") || null,
  });
  if (error) return { erreur: error.message.includes("pvt_ventes_ligne") ? `La ligne ${ligne} est déjà déclarée pour cette offre.` : "Vente non enregistrée : " + error.message };
  return fini(`Vente${ligne ? " de la ligne " + ligne : ""} déclarée.`);
}

export async function supprimerVente(id: string): Promise<Etat> {
  await exigerSession();
  const supabase = await supabaseServeur();
  const { error, count } = await supabase.from("pvt_ventes").delete({ count: "exact" }).eq("id", id);
  if (error || !count) return { erreur: "Vente non supprimée : seules les ventes encore déclarées se suppriment." };
  return fini("Vente supprimée.");
}

export async function majEtatLigne(id: string, etat: string): Promise<Etat> {
  await exigerSession();
  const supabase = await supabaseServeur();
  const { error } = await supabase.rpc("pvt_etat_ligne", { p_vente: id, p_etat: etat || null });
  if (error) return { erreur: error.message };
  revalidatePath("/pvt");
  return { ok: "Statut mis à jour." };
}

export async function attribuerVente(id: string, vendeur: string): Promise<Etat> {
  await exigerDroit("pvt.gerer");
  const supabase = await supabaseServeur();
  const { error } = await supabase.from("pvt_ventes").update({ vendeur_id: vendeur || null }).eq("id", id);
  if (error) return { erreur: error.message };
  return fini("Vente attribuée.");
}

// --- Extraction SBIN ------------------------------------------------------------------
export async function importerExtraction(mois: string, lignes: LigneExtraction[]): Promise<Etat> {
  await exigerDroit("pvt.gerer");
  const supabase = await supabaseServeur();
  const { data, error } = await supabase.rpc("pvt_rapprocher_extraction", {
    p_mois: mois, p_lignes: lignes.map((l) => ({ ligne: l.ligne, offre: l.offre, date: l.date || null, client: l.client || null })),
  });
  if (error) return { erreur: error.message };
  const r = data as { validees: number; ajoutees: number; offres_inconnues: number; codes_inconnus: string[] };
  await journaliser(`a importé l'extraction SBIN de ${mois.slice(0, 7)} : ${r.validees} vente(s) validée(s), ${r.ajoutees} ajoutée(s)`);
  revalidatePath("/pvt");
  return {
    ok: `${r.validees} vente(s) déclarée(s) validée(s), ${r.ajoutees} ligne(s) SBIN non déclarée(s) ajoutée(s) à attribuer.` +
      (r.offres_inconnues ? ` ${r.offres_inconnues} ligne(s) ignorée(s) : offre inconnue (${r.codes_inconnus.join(", ")}), ajoutez-la dans les offres puis réimportez.` : ""),
  };
}

export async function rejeterNonValidees(mois: string): Promise<Etat> {
  await exigerDroit("pvt.gerer");
  const supabase = await supabaseServeur();
  const { data, error } = await supabase.rpc("pvt_rejeter_non_validees", { p_mois: mois });
  if (error) return { erreur: error.message };
  await journaliser(`a rejeté ${data} vente(s) de ${mois.slice(0, 7)} absente(s) de l'extraction SBIN`);
  return fini(`${data} vente(s) absente(s) de l'extraction passée(s) en rejetée(s).`);
}

// --- Versements aux vendeurs ------------------------------------------------------------
export async function enregistrerVersement(_: Etat, f: FormData): Promise<Etat> {
  await exigerDroit("pvt.gerer");
  const supabase = await supabaseServeur();
  const montant = num(f, "montant");
  if (!montant) return { erreur: "Montant obligatoire." };
  const { error } = await supabase.from("pvt_versements").insert({
    mois: txt(f, "mois"), vendeur_id: txt(f, "vendeur_id"), type: txt(f, "type"), montant,
    verse_le: txt(f, "verse_le") || undefined, mode: txt(f, "mode") || null,
  });
  if (error) return { erreur: error.message };
  await journaliser(`a enregistré ${txt(f, "type").toLowerCase()} de ${fcfa(montant)} FCFA à ${txt(f, "nom")} (ventes terrain ${txt(f, "mois").slice(0, 7)})`);
  return fini(`${txt(f, "type")} de ${fcfa(montant)} FCFA enregistré(e).`);
}

export async function verserAvances(mois: string, avances: { vendeur_id: string; montant: number }[], verseLe: string, mode: string): Promise<Etat> {
  await exigerDroit("pvt.gerer");
  const supabase = await supabaseServeur();
  const lignes = avances.filter((a) => a.montant > 0).map((a) => ({ mois, vendeur_id: a.vendeur_id, type: "Avance", montant: Math.round(a.montant), verse_le: verseLe, mode: mode || null }));
  if (!lignes.length) return { erreur: "Aucune avance à verser." };
  const { error } = await supabase.from("pvt_versements").insert(lignes);
  if (error) return { erreur: error.message };
  const total = lignes.reduce((a, l) => a + l.montant, 0);
  await journaliser(`a versé les avances de ventes terrain de ${mois.slice(0, 7)} : ${lignes.length} vendeur(s), ${fcfa(total)} FCFA`);
  return fini(`Avances enregistrées : ${lignes.length} vendeur(s), ${fcfa(total)} FCFA.`);
}

export async function supprimerVersement(id: string): Promise<Etat> {
  await exigerDroit("pvt.gerer");
  const supabase = await supabaseServeur();
  const { error } = await supabase.from("pvt_versements").delete().eq("id", id);
  if (error) return { erreur: error.message };
  return fini("Versement supprimé.");
}

// --- Suivi du mois (facture SBIN, paiement, ajustements) ----------------------------------
export async function majMois(_: Etat, f: FormData): Promise<Etat> {
  await exigerDroit("pvt.gerer");
  const supabase = await supabaseServeur();
  const s = await exigerSession();
  const v = (k: string) => txt(f, k) || null;
  const { error } = await supabase.from("pvt_mois").upsert({
    pays: s.pays.code, mois: txt(f, "mois"),
    facture_numero: v("facture_numero"), facture_ht: txt(f, "facture_ht") ? num(f, "facture_ht") : null,
    facture_envoyee_le: v("facture_envoyee_le"), payee_le: v("payee_le"), montant_paye: txt(f, "montant_paye") ? num(f, "montant_paye") : null,
    extraction_recue_le: v("extraction_recue_le"),
    ajustement: num(f, "ajustement"), ajustement_motif: v("ajustement_motif"), note: v("note"),
  }, { onConflict: "pays,mois" });
  if (error) return { erreur: error.message };
  return fini("Suivi du mois enregistré.");
}

// --- Vendeurs et leurs comptes ------------------------------------------------------------------
export async function creerVendeur(_: Etat, f: FormData): Promise<Etat> {
  const s = await exigerDroit("pvt.gerer");
  const supabase = await supabaseServeur();
  const nom = txt(f, "nom");
  let profil: string | null = null;
  let identifiant = "";
  if (txt(f, "compte") === "1") {
    const motdepasse = txt(f, "motdepasse");
    if (motdepasse.length < 8) return { erreur: "Le mot de passe provisoire doit faire au moins 8 caractères." };
    const saisi = txt(f, "email") || txt(f, "telephone");
    if (!saisi) return { erreur: "Il faut un téléphone ou un e-mail pour créer le compte." };
    identifiant = identifiantVersEmail(saisi);
    const admin = supabaseAdmin();
    const { data, error } = await admin.auth.admin.createUser({ email: identifiant, password: motdepasse, email_confirm: true, user_metadata: { nom, pays: s.pays.code } });
    if (error || !data.user) return { erreur: "Le compte n'a pas été créé : " + (error?.message ?? "erreur inconnue") };
    profil = data.user.id;
    const { error: e2 } = await admin.from("profils").update({ nom, poste: "vendeur", actif: true, telephone: txt(f, "telephone") || null, contrat: "Mandataire", responsable_id: s.profil.id }).eq("id", profil);
    if (e2) return { erreur: "Compte créé mais fiche incomplète : " + e2.message };
  }
  const { error } = await supabase.from("pvt_vendeurs").insert({
    nom, telephone: txt(f, "telephone") || null, numero_celtiis: txt(f, "numero_celtiis") || null,
    piece_identite: txt(f, "piece_identite") || null, segment: txt(f, "segment") || "B2C", debut: txt(f, "debut") || undefined, profil_id: profil,
  });
  if (error) return { erreur: error.message.includes("pvt_vendeurs_nom") ? `Le vendeur ${nom} existe déjà.` : error.message };
  await journaliser(`a ajouté le vendeur terrain ${nom}${profil ? " avec un compte" : ""}`);
  return fini(profil
    ? `Vendeur ajouté. Pour se connecter : identifiant ${identifiant.endsWith("@vendeur.dgs") ? "= son numéro de téléphone" : identifiant}, avec le mot de passe provisoire.`
    : "Vendeur ajouté.");
}

export async function creerCompteVendeur(_: Etat, f: FormData): Promise<Etat> {
  const s = await exigerDroit("pvt.gerer");
  const supabase = await supabaseServeur();
  const { data: v } = await supabase.from("pvt_vendeurs").select("*").eq("id", txt(f, "id")).single();
  if (!v) return { erreur: "Vendeur introuvable." };
  if (v.profil_id) return { erreur: "Ce vendeur a déjà un compte." };
  const motdepasse = txt(f, "motdepasse");
  if (motdepasse.length < 8) return { erreur: "Le mot de passe provisoire doit faire au moins 8 caractères." };
  const saisi = txt(f, "email") || v.telephone;
  if (!saisi) return { erreur: "Renseignez son téléphone ou un e-mail." };
  const identifiant = identifiantVersEmail(saisi);
  const admin = supabaseAdmin();
  const { data, error } = await admin.auth.admin.createUser({ email: identifiant, password: motdepasse, email_confirm: true, user_metadata: { nom: v.nom, pays: s.pays.code } });
  if (error || !data.user) return { erreur: "Le compte n'a pas été créé : " + (error?.message ?? "erreur inconnue") };
  await admin.from("profils").update({ nom: v.nom, poste: "vendeur", actif: true, telephone: v.telephone, contrat: "Mandataire", responsable_id: s.profil.id }).eq("id", data.user.id);
  const { error: e2 } = await supabase.from("pvt_vendeurs").update({ profil_id: data.user.id }).eq("id", v.id);
  if (e2) return { erreur: e2.message };
  await journaliser(`a créé le compte du vendeur terrain ${v.nom}`);
  return fini(`Compte créé. Identifiant : ${identifiant.endsWith("@vendeur.dgs") ? "son numéro de téléphone" : identifiant}.`);
}

export async function basculerVendeur(id: string, actif: boolean): Promise<Etat> {
  await exigerDroit("pvt.gerer");
  const supabase = await supabaseServeur();
  const { data: v, error } = await supabase.from("pvt_vendeurs").update({ actif }).eq("id", id).select("nom,profil_id").single();
  if (error) return { erreur: error.message };
  if (v.profil_id) await supabaseAdmin().from("profils").update({ actif }).eq("id", v.profil_id);
  await journaliser(`a ${actif ? "réactivé" : "désactivé"} le vendeur terrain ${v.nom}`);
  return fini(actif ? "Vendeur réactivé." : "Vendeur désactivé (son compte aussi).");
}

// --- Grille et contrat -------------------------------------------------------------------------
export async function majOffre(_: Etat, f: FormData): Promise<Etat> {
  await exigerDroit("pvt.gerer");
  const supabase = await supabaseServeur();
  const commission = num(f, "commission"), part = num(f, "part_vendeur");
  if (part > commission) return { erreur: "La part vendeur dépasse la commission." };
  const ligne = { libelle: txt(f, "libelle"), commission, part_vendeur: part, actif: txt(f, "actif") !== "0", performance: txt(f, "performance") !== "0" };
  const id = txt(f, "id");
  const { error } = id
    ? await supabase.from("pvt_offres").update(ligne).eq("id", id)
    : await supabase.from("pvt_offres").insert({ ...ligne, code: txt(f, "code").toUpperCase(), segment: txt(f, "segment"), famille: txt(f, "famille"), ordre: 100 });
  if (error) return { erreur: error.message };
  return fini(id ? "Offre mise à jour." : "Offre ajoutée.");
}

export async function majContrat(_: Etat, f: FormData): Promise<Etat> {
  const s = await exigerDroit("pvt.gerer");
  const supabase = await supabaseServeur();
  const { error } = await supabase.from("pvt_contrats").upsert({
    pays: s.pays.code, reference: txt(f, "reference") || "Contrat PVT", date_debut: txt(f, "date_debut"), taux_avance: num(f, "taux_avance"),
  }, { onConflict: "pays" });
  if (error) return { erreur: error.message };
  return fini("Contrat mis à jour.");
}
