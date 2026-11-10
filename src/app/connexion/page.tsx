import { supabaseServeur } from "@/lib/supabase/server";
import type { Pays } from "@/lib/types";
import Formulaire from "./Formulaire";

export default async function Connexion({ searchParams }: { searchParams: Promise<{ inactif?: string }> }) {
  const { inactif } = await searchParams;
  const supabase = await supabaseServeur();
  const { data } = await supabase.from("pays").select("code,nom,ville,devise").order("ordre");
  return (
    <main className="login">
      <Formulaire inactif={inactif === "1"} pays={(data ?? []) as Pays[]} />
    </main>
  );
}
