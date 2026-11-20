import { supabaseServeur } from "@/lib/supabase/server";
import type { Pays } from "@/lib/types";
import Formulaire from "./Formulaire";
import FondPhotos from "@/components/FondPhotos";

export default async function Connexion({ searchParams }: { searchParams: Promise<{ inactif?: string }> }) {
  const { inactif } = await searchParams;
  const supabase = await supabaseServeur();
  const { data } = await supabase.from("pays").select("code,nom,ville,devise").order("ordre");
  return (
    <main className="login">
      <FondPhotos variante="connexion" />
      <div>
        <Formulaire inactif={inactif === "1"} pays={(data ?? []) as Pays[]} />
        <p className="accroche">BTP · Énergie · Télécommunications</p>
      </div>
    </main>
  );
}
