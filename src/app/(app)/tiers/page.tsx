import Link from "next/link";
import { redirect } from "next/navigation";
import { exigerSession } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { TYPES_TIERS, VOIT_TIERS, type Tiers } from "@/lib/types";
import { Pastille } from "@/components/ui";
import { FormTiers } from "./Formulaires";


export default async function ListeTiers({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const s = await exigerSession();
  if (!VOIT_TIERS.some((d) => s.peut(d))) redirect("/");
  const sp = await searchParams;
  const type = (["client", "fournisseur", "prestataire"].includes(sp.type ?? "") ? sp.type : "client") as Tiers["type"];
  const supabase = await supabaseServeur();
  const [{ data }, { data: bp }, { data: docs }] = await Promise.all([
    supabase.from("tiers").select("*").eq("type", type).order("nom"),
    supabase.from("bordereau_prix").select("tiers_id").eq("actif", true),
    supabase.from("justificatifs").select("objet_id,type_document,valide_jusquau").eq("objet", "tiers"),
  ]);
  const auj = new Date().toISOString().slice(0, 10);
  const adminOk = new Set((docs ?? []).filter((d) => ["RCCM", "IFU / NIF", "Statuts", "Pièce d'identité du gérant", "Autre document administratif"].includes(d.type_document ?? "")).map((d) => d.objet_id));
  const fiscalOk = new Set((docs ?? []).filter((d) => ["Attestation de régularité fiscale", "Quitus fiscal"].includes(d.type_document ?? "") && (d.valide_jusquau ?? "") >= auj).map((d) => d.objet_id));
  const nb = new Map<string, number>();
  (bp ?? []).forEach((b) => nb.set(b.tiers_id, (nb.get(b.tiers_id) ?? 0) + 1));
  const liste = (data ?? []) as Tiers[];

  return (
    <>
      <div className="head">
        <div>
          <h1>Clients et fournisseurs</h1>
          <p className="sub">Chaque client, fournisseur ou prestataire a son bordereau des prix : le prix unitaire HT de chaque libellé, qu&apos;on lui applique ou qu&apos;il nous applique. Les quantitatifs des chantiers et des PV reprennent ces prix, ligne par ligne.</p>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {(["client", "fournisseur", "prestataire"] as const).map((k) => (
          <Link key={k} href={`/tiers?type=${k}`} role="tab" aria-selected={k === type} className="tab">{TYPES_TIERS[k]}s</Link>
        ))}
      </div>
      {s.peut("tiers.gerer") && <FormTiers type={type} />}
      <section className="panel">
        <div className="tbl">
          <table>
            <thead><tr><th>Nom</th><th>IFU / NIF</th><th>RCCM</th><th>Téléphone</th><th className="num">Prix au bordereau</th><th>Dossier</th><th>État</th></tr></thead>
            <tbody>
              {liste.map((t) => (
                <tr key={t.id}>
                  <td><Link href={`/tiers/${t.id}`}><b>{t.nom}</b></Link>{t.contact && <><br /><span className="note">{t.contact}</span></>}</td>
                  <td className="code">{t.ifu ?? "—"}</td>
                  <td className="code">{t.rccm ?? "—"}</td>
                  <td>{t.telephone ?? "—"}</td>
                  <td className="num">{nb.get(t.id) ?? 0}</td>
                  <td>
                    <Pastille texte={adminOk.has(t.id) ? "Administratif ✓" : "Administratif manquant"} ton={adminOk.has(t.id) ? "ok" : "bad"} />{" "}
                    <Pastille texte={fiscalOk.has(t.id) ? "Fiscal à jour" : "Fiscal non à jour"} ton={fiscalOk.has(t.id) ? "ok" : "warn"} />
                  </td>
                  <td><Pastille texte={t.actif ? "Actif" : "Inactif"} ton={t.actif ? "ok" : undefined} /></td>
                </tr>
              ))}
              {!liste.length && <tr><td colSpan={7} className="note">Aucun {TYPES_TIERS[type].toLowerCase()} enregistré.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
