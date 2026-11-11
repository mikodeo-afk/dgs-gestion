"use server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { exigerDroit } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";

const Lecture = z.object({
  type_document: z.string().describe("Bordereau de livraison, Facture, Bon de sortie…"),
  fournisseur: z.string().describe("Nom de l'émetteur du document, vide si illisible"),
  numero: z.string().describe("Numéro du bordereau ou de la facture, vide si absent"),
  date: z.string().describe("Date du document au format AAAA-MM-JJ, vide si absente"),
  lignes: z.array(z.object({
    code: z.string().describe("Code d'un article existant de la liste si c'est le même article, sinon un nouveau code court en majuscules dans le même style"),
    designation: z.string(),
    unite: z.string().describe("Unité : u, m, kg, rouleau, carton…"),
    quantite: z.number(),
    prix_unitaire: z.number().nullable().describe("Prix unitaire HT en FCFA, null si absent"),
  })),
  remarque: z.string().describe("Ce qui est douteux ou illisible, vide si tout est clair"),
});
type Brute = z.infer<typeof Lecture>;
export type LigneLue = Brute["lignes"][number] & { nouveau: boolean };
export type LectureBordereau = Omit<Brute, "lignes"> & { lignes: LigneLue[] };

const CONSIGNE = `Tu lis la photo d'un bordereau de livraison ou d'une facture reçue par DGS (entreprise de BTP, énergie et télécommunications en Afrique de l'Ouest).
Relève chaque ligne d'article livré ou facturé : désignation, unité, quantité, prix unitaire HT.
Ignore les lignes de total, de TVA, de remise, de transport et les frais qui ne sont pas du matériel.
Si un article correspond à un article de la liste du stock (même produit, même unité), reprends son code exact.
Sinon propose un nouveau code court en majuscules dans le même style que la liste.
Recopie les nombres tels qu'ils sont écrits ; n'invente rien : si une valeur est illisible, laisse-la vide et signale-le dans la remarque.`;

/** Lit une photo de bordereau ou de facture et propose les lignes d'entrée en stock (rien n'est enregistré). */
export async function lireBordereau(image: string): Promise<{ lecture?: LectureBordereau; erreur?: string }> {
  await exigerDroit("stock.gerer");
  if (!process.env.ANTHROPIC_API_KEY) {
    return { erreur: "La lecture automatique n'est pas encore activée : la clé ANTHROPIC_API_KEY manque dans les réglages Vercel." };
  }
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(image);
  if (!m) return { erreur: "Image illisible : reprenez la photo." };

  const supabase = await supabaseServeur();
  const { data: arts } = await supabase.from("articles").select("code,designation,unite").eq("actif", true).order("code").limit(800);
  const liste = (arts ?? []).map((a) => `${a.code} | ${a.designation} | ${a.unite}`).join("\n") || "(aucun article pour l'instant)";

  try {
    const client = new Anthropic();
    const rep = await client.messages.parse({
      model: "claude-haiku-5-5",
      max_tokens: 16000,
      output_config: { effort: "low", format: zodOutputFormat(Lecture) },
      system: CONSIGNE,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: m[1] as "image/jpeg" | "image/png" | "image/webp", data: m[2] } },
          { type: "text", text: `Articles déjà au stock (code | désignation | unité) :\n${liste}\n\nRelève les lignes de ce document.` },
        ],
      }],
    });
    if (rep.stop_reason === "refusal") return { erreur: "Ce document n'a pas pu être lu. Reprenez la photo ou saisissez les lignes à la main." };
    if (rep.stop_reason === "max_tokens" || !rep.parsed_output) return { erreur: "Document trop long pour une seule photo : photographiez-le page par page." };
    const codes = new Set((arts ?? []).map((a) => a.code.trim().toUpperCase()));
    const lecture = rep.parsed_output;
    if (!lecture.lignes.length) return { erreur: "Aucune ligne d'article trouvée sur cette photo. Vérifiez qu'elle est nette et bien cadrée." };
    return {
      lecture: {
        ...lecture,
        lignes: lecture.lignes.map((l) => {
          const code = l.code.trim().toUpperCase();
          return { ...l, code, nouveau: !codes.has(code) };
        }),
      },
    };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { erreur: "La clé ANTHROPIC_API_KEY est refusée : vérifiez-la dans les réglages Vercel." };
    if (e instanceof Anthropic.RateLimitError) return { erreur: "Service de lecture saturé : réessayez dans une minute." };
    if (e instanceof Anthropic.APIError) return { erreur: `Lecture impossible (erreur ${e.status ?? "réseau"}). Réessayez.` };
    return { erreur: "Lecture impossible : vérifiez la connexion et réessayez." };
  }
}
