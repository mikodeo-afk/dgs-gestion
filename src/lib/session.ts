import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { supabaseServeur } from "./supabase/server";
import { POSTES_TERRAIN, type Pays, type Profil } from "./types";

export type Session = {
  profil: Profil;
  droits: Set<string>;
  global: boolean;
  peut: (cle: string) => boolean;
  /** Pays dans lequel l'employé travaille en ce moment. */
  pays: Pays;
  /** Accès groupe : peut passer d'un pays à l'autre (PDG, DO et personnes désignées). */
  groupe: boolean;
  tousPays: Pays[];
};

/** Profil et droits effectifs de l'employé connecté, lus une fois par requête. */
export const lireSession = cache(async (): Promise<Session | null> => {
  const supabase = await supabaseServeur();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const [{ data: profil }, { data: droits }, { data: courant }, { data: groupe }, { data: pays }] = await Promise.all([
    supabase.from("profils").select("*").eq("id", auth.user.id).maybeSingle(),
    supabase.rpc("mes_droits"),
    supabase.rpc("pays_courant"),
    supabase.rpc("acces_groupe"),
    supabase.from("pays").select("code,nom,ville,devise").order("ordre"),
  ]);
  if (!profil || !profil.actif) return null;
  const set = new Set<string>((droits as string[] | null) ?? []);
  const tousPays = (pays ?? []) as Pays[];
  const ici = tousPays.find((x) => x.code === courant) ?? { code: String(courant ?? profil.pays), nom: String(courant ?? profil.pays), ville: null, devise: "FCFA" };
  return {
    pays: ici,
    groupe: Boolean(groupe),
    tousPays,
    profil: profil as Profil,
    droits: set,
    global: !POSTES_TERRAIN.includes((profil as Profil).poste),
    peut: (cle) => set.has(cle),
  };
});

export async function exigerSession() {
  const s = await lireSession();
  if (!s) redirect("/connexion?inactif=1");
  return s;
}

/** Arrête l'action si l'employé n'a pas le droit. La base le vérifie aussi. */
export async function exigerDroit(cle: string) {
  const s = await exigerSession();
  if (!s.peut(cle)) throw new Error("Vous n'avez pas le droit de faire cette action.");
  return s;
}
