import Link from "next/link";
import { notFound } from "next/navigation";
import { exigerSession } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { aujourdhui, dateFr, fcfa } from "@/lib/format";
import type { Chantier, Tache } from "@/lib/types";
import { Barre, Kpi, Pastille, etatTache } from "@/components/ui";
import { modifierChantier } from "../actions";
import FormTache from "../FormTache";
import Avancement from "../Avancement";

export default async function FicheChantier({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await exigerSession();
  const supabase = await supabaseServeur();
  const [{ data: c }, { data: taches }, { data: fin }, { data: profils }, { data: av }] = await Promise.all([
    supabase.from("chantiers").select("*").eq("id", id).maybeSingle(),
    supabase.from("taches").select("*").eq("chantier_id", id).order("echeance", { nullsFirst: false }),
    supabase.from("chantiers_finance").select("*").eq("chantier_id", id).maybeSingle(),
    supabase.from("profils").select("id,nom,poste,responsable_id").eq("actif", true).order("nom"),
    supabase.rpc("avancement_chantiers"),
  ]);
  if (!c) notFound();
  const ch = c as Chantier;
  const noms = new Map((profils ?? []).map((p) => [p.id, p.nom]));
  const auj = aujourdhui();
  const progression = Number(((av ?? []) as { chantier_id: string; avancement: number }[]).find((a) => a.chantier_id === id)?.avancement ?? 0);
  const peutTaches = s.peut("tache.creer") && (s.global || ch.chef_projet_id === s.profil.id);
  const agents = (profils ?? []).filter((p) => ["ce", "tech"].includes(p.poste));
  const liste = (taches ?? []) as Tache[];

  return (
    <>
      <div className="head">
        <div>
          <p className="note"><Link href="/chantiers">← Chantiers</Link></p>
          <h1>{ch.nom}</h1>
          <p className="sub"><span className="code">{ch.code}</span> · {ch.domaine} · {[ch.lieu, ch.client].filter(Boolean).join(" · ")}</p>
        </div>
        <Pastille texte={ch.statut} />
      </div>
      <div className="kpis">
        <Kpi libelle="Avancement" valeur={`${Math.round(progression)} %`} />
        <Kpi libelle="Chef de projet" valeur={<span style={{ fontSize: 17 }}>{ch.chef_projet_id ? noms.get(ch.chef_projet_id) : "À désigner"}</span>} />
        <Kpi libelle="Rayon de pointage" valeur={ch.rayon_pointage} unite="m" />
        {fin && <Kpi libelle="Marché HT" valeur={fcfa(fin.montant_marche)} unite="FCFA" />}
      </div>
      {s.peut("chantier.creer") && (
        <form className="inline" action={modifierChantier}>
          <input type="hidden" name="id" value={ch.id} />
          <input type="hidden" name="code" value={ch.code} />
          <label>Statut
            <select id="statut" name="statut" defaultValue={ch.statut}>
              {["Démarrage", "En cours", "Suspendu", "Terminé"].map((x) => <option key={x}>{x}</option>)}
            </select>
          </label>
          <label>Chef de projet
            <select id="chef" name="chef_projet_id" defaultValue={ch.chef_projet_id ?? ""}>
              <option value="">À désigner</option>
              {(profils ?? []).filter((p) => p.poste === "cp").map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
            </select>
          </label>
          <label>Rayon de pointage (m)<input id="rayon" name="rayon" type="number" min="50" max="2000" step="50" defaultValue={ch.rayon_pointage} /></label>
          <button className="btn" type="submit">Enregistrer le chantier</button>
        </form>
      )}
      {peutTaches && <FormTache chantierId={ch.id} agents={agents} />}
      <section className="panel">
        <h2>Tâches</h2>
        <div className="tbl">
          <table>
            <thead><tr><th>Tâche</th><th>Assignée à</th><th className="num">Échéance</th><th>État</th><th>Avancement</th><th>Mettre à jour</th></tr></thead>
            <tbody>
              {liste.map((t) => (
                <tr key={t.id}>
                  <td>{t.titre}</td>
                  <td>{t.assigne_id ? noms.get(t.assigne_id) : "—"}</td>
                  <td className="num">{dateFr(t.echeance)}</td>
                  <td>{etatTache(t, auj)}</td>
                  <td style={{ minWidth: 140 }}><Barre valeur={t.avancement} /></td>
                  <td>{s.peut("tache.maj") ? <Avancement id={t.id} valeur={t.avancement} /> : null}</td>
                </tr>
              ))}
              {!liste.length && <tr><td colSpan={6} className="note">Aucune tâche visible pour vous sur ce chantier.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
