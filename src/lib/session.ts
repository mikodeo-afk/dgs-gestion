import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { supabaseServeur } from "./supabase/server";
import { POSTES_TERRAIN, type Profil } from "./types";

export type Session = {
  profil: Profil;
  droits: Set<string>;
  global: boolean;
  peut: (cle: string) => boolean;
};

/** Profil et droits effectifs de l'employé connecté, lus une fois par requête. */
export const lireSession = cache(async (): Promise<Session | null> => {
  const supabase = await supabaseServeur();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const [{ data: profil }, { data: droits }] = await Promise.all([
    supabase.from("profils").select("*").eq("id", auth.user.id).maybeSingle(),
    supabase.rpc("mes_droits"),
  ]);
  if (!profil || !profil.actif) return null;
  const set = new Set<string>((droits as string[] | null) ?? []);
  return {
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
