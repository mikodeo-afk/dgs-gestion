import { redirect } from "next/navigation";
import { exigerSession } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { aujourdhui, dateFr, heureFr } from "@/lib/format";
import { Pastille } from "@/components/ui";
import Pointer, { type Lieu } from "./Pointer";

export default async function Pointage() {
  const s = await exigerSession();
  if (!s.peut("pointer")) redirect("/");
  const supabase = await supabaseServeur();
  const auj = aujourdhui();
  const [{ data: chantiers }, { data: bureau }, { data: jour }, { data: recents }] = await Promise.all([
    supabase.rpc("chantiers_pointage"),
    supabase.from("pays").select("bureau_latitude,bureau_longitude,bureau_rayon,ville").eq("code", s.pays.code).maybeSingle(),
    supabase.from("presences").select("*").eq("profil_id", s.profil.id).eq("jour", auj).maybeSingle(),
    supabase.from("presences").select("jour,statut,heure_arrivee,distance_m,terrain,controle,motif_rejet").eq("profil_id", s.profil.id)
      .not("heure_arrivee", "is", null).order("jour", { ascending: false }).limit(10),
  ]);
  const affectations = (chantiers ?? []) as { id: string; code: string; nom: string; latitude: number | null; longitude: number | null; rayon_pointage: number }[];
  // Pointage terrain (superviseur PVT…) : là où l'on est, sans bureau ni rayon ; ou sur un chantier d'affectation.
  // Sinon : affecté à un chantier, on pointe sur ce chantier ; à défaut au bureau DGS du pays.
  const terrain = s.peut("pointer.terrain");
  const lieux: Lieu[] = terrain
    ? [{ id: null, code: "Terrain", nom: "Sur le terrain (là où je suis)", latitude: 0, longitude: 0, rayon_pointage: 0, terrain: true },
       ...(affectations.filter((c) => c.latitude != null && c.longitude != null) as Lieu[])]
    : affectations.length
    ? affectations.filter((c) => c.latitude != null && c.longitude != null) as Lieu[]
    : bureau?.bureau_latitude != null
      ? [{ id: null, code: "Bureau", nom: `Bureau DGS ${bureau.ville ?? s.pays.nom}`, latitude: bureau.bureau_latitude, longitude: bureau.bureau_longitude, rayon_pointage: bureau.bureau_rayon }]
      : [];
  const sansPosition = affectations.filter((c) => c.latitude == null || c.longitude == null);
  const ton = (c: string | null) => (c === "Conforme" ? "ok" : c === "Rejeté" ? "bad" : "warn");

  return (
    <>
      <div className="head">
        <div>
          <h1>Pointage</h1>
          <p className="sub">Ouvrez cette page sur votre téléphone à votre arrivée : {s.peut("pointer.terrain") ? "là où vous êtes sur le terrain, ou sur un chantier où vous êtes affecté." : "au bureau, ou sur le chantier si vous y êtes affecté."}</p>
        </div>
      </div>
      <section className="panel">
        {jour?.heure_arrivee ? (
          <p>
            Arrivée pointée aujourd&apos;hui à <b>{heureFr(jour.heure_arrivee)}</b>, {jour.terrain ? "sur le terrain" : `à ${jour.distance_m} m du lieu de pointage`}.{" "}
            <Pastille texte={jour.controle ?? "À contrôler"} ton={ton(jour.controle)} />
            {jour.motif_rejet && <span className="neg"> · {jour.motif_rejet}</span>}
          </p>
        ) : (
          <>
            {lieux.length > 0 && <Pointer chantiers={lieux} agentId={s.profil.id} pays={s.pays.code} />}
            {sansPosition.length > 0 && (
              <p className="note">Position non enregistrée pour {sansPosition.map((c) => c.code).join(", ")} : le chef de projet doit l&apos;enregistrer sur place (fiche du chantier, « Utiliser ma position actuelle ») avant que vous puissiez y pointer.</p>
            )}
            {!terrain && !affectations.length && !lieux.length && (
              <p className="note">La position du bureau DGS n&apos;est pas encore enregistrée : la direction doit la régler dans Paramètres, depuis le bureau.</p>
            )}
          </>
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
                    <td>{dateFr(p.jour)}</td><td>{heureFr(p.heure_arrivee)}</td><td className="num">{p.terrain ? "Terrain" : `${p.distance_m} m`}</td>
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
