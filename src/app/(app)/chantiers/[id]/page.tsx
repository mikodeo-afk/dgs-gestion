import Link from "next/link";
import { notFound } from "next/navigation";
import { exigerSession } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { aujourdhui, dateFr, fcfa } from "@/lib/format";
import type { Chantier, Tache } from "@/lib/types";
import { Barre, Kpi, Pastille, etatTache } from "@/components/ui";
import { modifierChantier, supprimerLigneChantier } from "../actions";
import FormLigne from "../FormLigne";
import BoutonValider from "../BoutonValider";
import Justificatifs, { type Fichier } from "@/components/Justificatifs";
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
  const ch = c as Chantier & { client_id: string | null; validation: string; ouverture: string | null; cree_par: string | null; valide_par: string | null; valide_le: string | null; pays: string };
  const [{ data: lignesData }, { data: execData }, { data: bpData }, { data: clients }, { data: bcDocs }] = await Promise.all([
    supabase.from("chantier_lignes").select("*").eq("chantier_id", id).order("ordre"),
    supabase.from("pv_lignes").select("chantier_ligne_id,quantite,pv:pv_execution!inner(type,statut,chantier_id)")
      .eq("pv.chantier_id", id).eq("pv.type", "client").in("pv.statut", ["Signé", "Facturé"]),
    ch.client_id && s.peut("chantier.creer")
      ? supabase.from("bordereau_prix").select("id,code,designation,unite,prix_unitaire_ht").eq("tiers_id", ch.client_id).eq("actif", true).order("code", { nullsFirst: false })
      : Promise.resolve({ data: [] }),
    s.peut("chantier.creer") ? supabase.from("tiers").select("id,nom").eq("type", "client").eq("actif", true).order("nom") : Promise.resolve({ data: [] }),
    supabase.from("justificatifs").select("id,nom_fichier,depose_le").eq("objet", "bc_client").eq("objet_id", id).order("depose_le"),
  ]);
  const aValider = ch.validation === "À valider";
  const peutValider = aValider && ["pdg", "do"].includes(s.profil.poste) && ch.cree_par !== s.profil.id;
  const lignes = (lignesData ?? []) as { id: string; ordre: number; designation: string; unite: string; quantite_prevue: number; prix_unitaire_ht: number; montant_ht: number }[];
  const execute = new Map<string, number>();
  for (const e of (execData ?? []) as { chantier_ligne_id: string | null; quantite: number }[])
    if (e.chantier_ligne_id) execute.set(e.chantier_ligne_id, (execute.get(e.chantier_ligne_id) ?? 0) + Number(e.quantite));
  const voitQuantitatif = s.peut("chantier.creer") || s.peut("fin.voir") || s.peut("pv.initier") || s.peut("fc.emettre");
  const qf = (n: number) => Number(n).toLocaleString("fr-FR", { maximumFractionDigits: 3 });
  const totPrevu = lignes.reduce((t, l) => t + Number(l.montant_ht), 0);
  const totExec = lignes.reduce((t, l) => t + Math.round((execute.get(l.id) ?? 0) * Number(l.prix_unitaire_ht)), 0);
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
        <Pastille texte={aValider ? "À valider" : ch.statut} ton={aValider ? "warn" : undefined} />
      </div>
      {(aValider || (bcDocs ?? []).length > 0 || s.peut("chantier.creer")) && (
        <section className="panel" style={aValider ? { borderColor: "var(--warn)" } : undefined}>
          <h2>Ouverture du chantier</h2>
          {aValider ? (
            <p className="note">
              <b>En attente.</b> Déposez le bon de commande du client : le chantier s&apos;ouvre aussitôt. Sans bon de commande,
              le DG ou le DO (autre que celui qui a créé le chantier) doit valider l&apos;ouverture. D&apos;ici là, ni PV, ni demande d&apos;achat, ni dépense sur ce chantier.
            </p>
          ) : (
            <p className="note">Ouvert{ch.ouverture ? ` : ${ch.ouverture.toLowerCase()}` : ""}{ch.valide_par ? ` (${noms.get(ch.valide_par) ?? ""}, le ${dateFr(ch.valide_le)})` : ""}.</p>
          )}
          <Justificatifs objet="bc_client" objetId={ch.id} numero={ch.code} pays={ch.pays} fichiers={(bcDocs ?? []) as Fichier[]}
            peutDeposer={s.peut("chantier.creer")} page={`/chantiers/${ch.id}`} />
          {peutValider && <div style={{ marginTop: 10 }}><BoutonValider id={ch.id} code={ch.code} /></div>}
        </section>
      )}
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
          <label>Client
            <select id="client_id" name="client_id" defaultValue={ch.client_id ?? ""}>
              <option value="">{ch.client_id ? "—" : ch.client ? `${ch.client} (non enregistré)` : "— Choisir —"}</option>
              {((clients ?? []) as { id: string; nom: string }[]).map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
            </select>
          </label>
          <label>Rayon de pointage (m)<input id="rayon" name="rayon" type="number" min="50" max="2000" step="50" defaultValue={ch.rayon_pointage} /></label>
          <button className="btn" type="submit">Enregistrer le chantier</button>
        </form>
      )}
      {voitQuantitatif && (
        <section className="panel">
          <h2>Activités et quantitatifs</h2>
          <p className="note">Quantités prévues au marché, et quantités réellement exécutées d&apos;après les PV clients signés. Les prix viennent du bordereau du client.</p>
          {s.peut("chantier.creer") && (ch.client_id
            ? <FormLigne chantierId={ch.id} code={ch.code} bordereau={(bpData ?? []) as never[]} />
            : <p className="note">Rattachez d&apos;abord ce chantier à un client enregistré pour reprendre son bordereau des prix (ou ajoutez des activités hors bordereau).</p>)}
          {s.peut("chantier.creer") && !ch.client_id && <FormLigne chantierId={ch.id} code={ch.code} bordereau={[]} />}
          <div className="tbl">
            <table>
              <thead><tr><th>N°</th><th>Activité</th><th>Unité</th><th className="num">Qté prévue</th><th className="num">PU HT</th><th className="num">Montant prévu</th><th className="num">Qté exécutée</th><th className="num">%</th>{s.peut("chantier.creer") && <th></th>}</tr></thead>
              <tbody>
                {lignes.map((l) => {
                  const ex = execute.get(l.id) ?? 0;
                  const pct = Math.round((ex / Number(l.quantite_prevue)) * 100);
                  return (
                    <tr key={l.id}>
                      <td className="code">{l.ordre}</td>
                      <td>{l.designation}</td>
                      <td>{l.unite}</td>
                      <td className="num">{qf(l.quantite_prevue)}</td>
                      <td className="num">{fcfa(l.prix_unitaire_ht)}</td>
                      <td className="num">{fcfa(l.montant_ht)}</td>
                      <td className="num">{qf(ex)}</td>
                      <td className={`num ${pct > 100 ? "depasse" : ""}`}>{pct} %</td>
                      {s.peut("chantier.creer") && <td>{ex === 0 && (
                        <form action={supprimerLigneChantier}>
                          <input type="hidden" name="id" value={l.id} /><input type="hidden" name="chantier_id" value={ch.id} />
                          <input type="hidden" name="code" value={ch.code} /><input type="hidden" name="designation" value={l.designation} />
                          <button className="btn sm bad" type="submit">Retirer</button>
                        </form>
                      )}</td>}
                    </tr>
                  );
                })}
                {!lignes.length && <tr><td colSpan={9} className="note">Aucune activité saisie.</td></tr>}
              </tbody>
              {lignes.length > 0 && (
                <tfoot><tr><td colSpan={5}>Total HT</td><td className="num">{fcfa(totPrevu)}</td><td className="num" colSpan={2}>exécuté : {fcfa(totExec)} ({totPrevu ? Math.round((totExec / totPrevu) * 100) : 0} %)</td>{s.peut("chantier.creer") && <td></td>}</tr></tfoot>
              )}
            </table>
          </div>
        </section>
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
