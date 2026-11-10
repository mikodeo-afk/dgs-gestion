import { redirect } from "next/navigation";
import { exigerSession } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { dateFr, fcfa } from "@/lib/format";
import { Pastille } from "@/components/ui";
import FormPv from "./FormPv";
import Link from "next/link";

const TON: Record<string, "ok" | "warn" | "bad"> = { Établi: "warn", Signé: "ok", Facturé: "ok", Annulé: "bad" };

export default async function PvExecution() {
  const s = await exigerSession();
  if (!(s.peut("pv.initier") || s.peut("fin.voir") || s.peut("fc.emettre") || s.peut("ff.enregistrer"))) redirect("/");
  const supabase = await supabaseServeur();
  const [{ data }, { data: chantiers }, { data: profils }, { data: mes }, { data: tiers }, { data: docs }] = await Promise.all([
    supabase.from("pv_execution").select("*").order("date_pv", { ascending: false }).order("cree_le", { ascending: false }),
    supabase.from("chantiers").select("id,code,nom").order("code"),
    supabase.from("profils").select("id,nom"),
    supabase.rpc("mes_chantiers"),
    supabase.from("tiers").select("id,nom,type").in("type", ["client", "prestataire"]).eq("actif", true).order("nom"),
    supabase.from("justificatifs").select("objet_id").eq("objet", "pv"),
  ]);
  const signes = new Set((docs ?? []).map((d) => d.objet_id));
  const noms = new Map((profils ?? []).map((p) => [p.id, p.nom]));
  const codes = new Map((chantiers ?? []).map((c) => [c.id, c.code]));
  const perim = new Set(((mes ?? []) as unknown as string[]).map((x) => (typeof x === "string" ? x : Object.values(x)[0] as string)));
  const projets = (chantiers ?? []).filter((c) => perim.has(c.id));
  const liste = data ?? [];

  return (
    <>
      <div className="head">
        <div>
          <h1>PV d&apos;exécution</h1>
          <p className="sub">Le chef de projet établit les PV pour les clients et pour les prestataires. Il saisit ligne par ligne les quantités réellement exécutées, puis dépose le PV signé. Un PV signé sert de base à la facture : facture client pour un PV client, facture du prestataire pour un PV prestataire. Un PV erroné s&apos;annule avec un motif (s&apos;il est facturé, on annule d&apos;abord la facture).</p>
        </div>
      </div>
      {s.peut("pv.initier") && projets.length > 0 && <FormPv chantiers={projets} clients={(tiers ?? []).filter((t) => t.type === "client")} prestataires={(tiers ?? []).filter((t) => t.type === "prestataire")} />}
      <section className="panel">
        <div className="tbl">
          <table>
            <thead><tr><th>PV</th><th>Projet</th><th>Pour</th><th className="num">Date</th><th className="num">Avancement</th><th className="num">Montant HT</th><th>Établi par</th><th>Statut</th><th>Action</th></tr></thead>
            <tbody>
              {liste.map((p) => (
                <tr key={p.id} className={p.statut === "Annulé" ? "annule" : undefined}>
                  <td><Link href={`/pv/${p.id}`} className="code">{p.numero}</Link><br />{p.objet}{p.statut === "Annulé" && <><br /><span className="note">Annulé le {dateFr(p.annule_le)} : {p.motif_annulation}</span></>}</td>
                  <td className="code">{codes.get(p.chantier_id)}</td>
                  <td><span className="dom">{p.type === "client" ? "Client" : "Prestataire"}</span><br />{p.tiers}</td>
                  <td className="num">{dateFr(p.date_pv)}</td>
                  <td className="num">{p.avancement != null ? `${p.avancement} %` : "—"}</td>
                  <td className="num">{fcfa(p.montant_ht)}</td>
                  <td>{noms.get(p.initie_par)}</td>
                  <td><Pastille texte={p.statut === "Établi" ? "En attente de signature" : p.statut === "Signé" ? "Signé, à facturer" : p.statut} ton={TON[p.statut]} />{p.signe_le && <><br /><span className="note">signé le {dateFr(p.signe_le)}</span></>}{signes.has(p.id) && <><br /><span className="note">📎 document signé</span></>}</td>
                  <td style={{ whiteSpace: "nowrap" }}><Link className="btn sm" href={`/pv/${p.id}`}>{p.statut === "Établi" && s.peut("pv.initier") && perim.has(p.chantier_id) ? "Saisir et signer" : "Ouvrir"}</Link></td>
                </tr>
              ))}
              {!liste.length && <tr><td colSpan={9} className="note">Aucun PV d&apos;exécution.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
