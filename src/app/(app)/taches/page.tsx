import Link from "next/link";
import { exigerSession } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { aujourdhui, dateFr } from "@/lib/format";
import type { Tache } from "@/lib/types";
import { Barre, etatTache } from "@/components/ui";
import Avancement from "../chantiers/Avancement";

export default async function Taches() {
  const s = await exigerSession();
  const supabase = await supabaseServeur();
  const [{ data: taches }, { data: chantiers }, { data: profils }] = await Promise.all([
    supabase.from("taches").select("*").order("echeance", { nullsFirst: false }),
    supabase.from("chantiers").select("id,code"),
    supabase.from("profils").select("id,nom"),
  ]);
  const codes = new Map((chantiers ?? []).map((c) => [c.id, c.code]));
  const noms = new Map((profils ?? []).map((p) => [p.id, p.nom]));
  const auj = aujourdhui();
  const liste = (taches ?? []) as Tache[];
  const tech = s.profil.poste === "tech";
  return (
    <>
      <div className="head">
        <div>
          <h1>{tech ? "Mes tâches" : "Tâches"}</h1>
          <p className="sub">{tech ? "Les tâches qui vous sont confiées." : "Les tâches de votre périmètre."} Déclarez l&apos;avancement : le chantier et le tableau de bord se mettent à jour.</p>
        </div>
      </div>
      <section className="panel">
        <div className="tbl">
          <table>
            <thead><tr><th>Tâche</th><th>Chantier</th><th>Assignée à</th><th className="num">Échéance</th><th>État</th><th>Avancement</th><th>Mettre à jour</th></tr></thead>
            <tbody>
              {liste.map((t) => (
                <tr key={t.id}>
                  <td>{t.titre}</td>
                  <td><Link href={`/chantiers/${t.chantier_id}`} className="code">{codes.get(t.chantier_id)}</Link></td>
                  <td>{t.assigne_id ? noms.get(t.assigne_id) : "—"}</td>
                  <td className="num">{dateFr(t.echeance)}</td>
                  <td>{etatTache(t, auj)}</td>
                  <td style={{ minWidth: 140 }}><Barre valeur={t.avancement} /></td>
                  <td>{s.peut("tache.maj") ? <Avancement id={t.id} valeur={t.avancement} /> : null}</td>
                </tr>
              ))}
              {!liste.length && <tr><td colSpan={7} className="note">Aucune tâche pour le moment.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
