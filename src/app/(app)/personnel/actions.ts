"use server";
import { revalidatePath } from "next/cache";
import { exigerDroit } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServeur } from "@/lib/supabase/server";
import { journaliser } from "@/lib/journal";
import { POSTES, type Poste } from "@/lib/types";

const txt = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** Crée le compte de connexion et la fiche de l'employé. Réservé au droit « emp.ajouter ». */
export async function creerEmploye(_: unknown, f: FormData) {
  const s = await exigerDroit("emp.ajouter");
  const poste = txt(f, "poste") as Poste;
  if (!(poste in POSTES)) return { erreur: "Poste inconnu." };
  if (poste === "pdg" && s.profil.poste !== "pdg") return { erreur: "Seul le PDG peut créer un compte PDG." };
  if (poste === "do" && !s.peut("droits.gerer")) return { erreur: "Seule une personne qui gère les droits peut créer un compte de Directeur des Opérations." };
  const motdepasse = txt(f, "motdepasse");
  if (motdepasse.length < 8) return { erreur: "Le mot de passe provisoire doit faire au moins 8 caractères." };

  const admin = supabaseAdmin();
  const { data, error } = await admin.auth.admin.createUser({
    email: txt(f, "email"), password: motdepasse, email_confirm: true, user_metadata: { nom: txt(f, "nom") },
  });
  if (error || !data.user) return { erreur: "Le compte n'a pas été créé : " + (error?.message ?? "erreur inconnue") };
  const id = data.user.id;
  const { error: e2 } = await admin.from("profils").update({
    nom: txt(f, "nom"), poste, actif: true, responsable_id: txt(f, "responsable_id") || null,
    telephone: txt(f, "telephone") || null, contrat: txt(f, "contrat") || "CDD",
    date_embauche: txt(f, "date_embauche") || undefined, date_fin: txt(f, "date_fin") || null,
  }).eq("id", id);
  if (e2) return { erreur: "Compte créé mais fiche incomplète : " + e2.message };
  await admin.from("remunerations").upsert({ profil_id: id, salaire_base: Number(txt(f, "salaire")) || 0 });
  await journaliser(`a ajouté ${txt(f, "nom")} (${POSTES[poste].nom}) au personnel`);
  revalidatePath("/personnel");
  return { ok: `Compte créé pour ${txt(f, "nom")}. Communiquez-lui son e-mail et son mot de passe provisoire.` };
}

export async function modifierEmploye(f: FormData) {
  await exigerDroit("emp.ajouter");
  const supabase = await supabaseServeur();
  const id = txt(f, "id");
  const { error } = await supabase.from("profils").update({
    responsable_id: txt(f, "responsable_id") || null, telephone: txt(f, "telephone") || null,
    contrat: txt(f, "contrat"), date_fin: txt(f, "date_fin") || null,
  }).eq("id", id);
  if (error) throw new Error(error.message);
  if (f.has("salaire")) await supabase.from("remunerations").upsert({ profil_id: id, salaire_base: Number(txt(f, "salaire")) || 0 });
  revalidatePath("/personnel");
}

export async function basculerActif(f: FormData) {
  await exigerDroit("droits.gerer");
  const supabase = await supabaseServeur();
  const actif = txt(f, "actif") === "1";
  const { error } = await supabase.from("profils").update({ actif }).eq("id", txt(f, "id"));
  if (error) throw new Error(error.message);
  await journaliser(`a ${actif ? "activé" : "désactivé"} le compte de ${txt(f, "nom")}`);
  revalidatePath("/personnel");
}
