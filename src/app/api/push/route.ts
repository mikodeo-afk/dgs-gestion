import { NextResponse, type NextRequest } from "next/server";
import { envoyerNotification } from "@/lib/push";

export const dynamic = "force-dynamic";

/** Appelé par la base de données à chaque nouvelle notification (secret partagé dans l'en-tête). */
export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-dgs-secret") ?? "";
  const corps = await request.json().catch(() => null) as { id?: string } | null;
  if (!secret || !corps?.id) return NextResponse.json({ erreur: "Requête invalide." }, { status: 400 });
  const r = await envoyerNotification(corps.id, secret);
  return NextResponse.json(r, { status: r.statut });
}
