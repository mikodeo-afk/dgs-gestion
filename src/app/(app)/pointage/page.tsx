import { redirect } from "next/navigation";
import { exigerSession } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { aujourdhui, dateFr, heureFr } from "@/lib/format";
import { Pastille } from "@/components/ui";
import Pointer from "./Pointer";

export default async function Pointage() {
  const s = await exigerSession();
  if (!s.peut("pointer")) redirect("/");
  const supabase = await supabaseServeur();
  const auj = aujourdhui();
  const [{ data: chantiers }, { data: jour }, { data: recents }] = await Promise.all([
    supabase.rpc("chantiers_pointage"),
    supabase.from("presences").select("*").eq("profil_id", s.profil.id).eq("jour", auj).maybeSingle(),
    supabase.from("presences").select("jour,statut,heure_arrivee,distance_m,controle,motif_rejet").eq("profil_id", s.profil.id)
      .not("heure_arrivee", "is", null).order("jour", { ascending: false }).limit(10),
  ]);
  const liste = (chantiers ?? []) as { id: string; code: string; nom: string; latitude: number; longitude: number; rayon_pointage: number }[];
  const ton = (c: string | null) => (c === "Conforme" ? "ok" : c === "Rejeté" ? "bad" : "warn");

  return (
    <>
      <div className="head">
        <div>
          <h1>Pointage</h1>
          <p className="sub">Ouvrez cette page sur votre téléphone, sur le chantier, à votre arrivée.</p>
        </div>
      </div>
      <section className="panel">
        {jour?.heure_arrivee ? (
          <p>
            Arrivée pointée aujourd&apos;hui à <b>{heureFr(jour.heure_arrivee)}</b>, à {jour.distance_m} m du site.{" "}
            <Pastille texte={jour.controle ?? "À contrôler"} ton={ton(jour.controle)} />
            {jour.motif_rejet && <span className="neg"> · {jour.motif_rejet}</span>}
          </p>
        ) : liste.length ? (
          <Pointer chantiers={liste} agentId={s.profil.id} pays={s.pays.code} />
        ) : (
          <p className="note">Aucun chantier où pointer : vous devez être affecté à une tâche d&apos;un chantier en cours, et le chef de projet doit avoir enregistré la position du site (fiche du chantier, « Utiliser ma position actuelle »).</p>
        )}
      </section>
      {(recents ?? []).length > 0 && (
        <section className="panel">
          <h2>Mes derniers pointages</h2>
          <div className="tbl">
            <table>
              <thead><tr><th>Jour</th><th>Heure</th><th className="num">Distance</th><th>Contrôle RH</th></tr></thead>
              <tbody>
                {(recents ?? []).map((p) => (
                  <tr key={p.jour}>
                    <td>{dateFr(p.jour)}</td><td>{heureFr(p.heure_arrivee)}</td><td className="num">{p.distance_m} m</td>
                    <td><Pastille texte={p.controle ?? "—"} ton={ton(p.controle)} />{p.motif_rejet && <span className="note"> {p.motif_rejet}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
