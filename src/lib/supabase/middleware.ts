import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function rafraichirSession(request: NextRequest) {
  let reponse = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (liste) => {
          liste.forEach(({ name, value }) => request.cookies.set(name, value));
          reponse = NextResponse.next({ request });
          liste.forEach(({ name, value, options }) => reponse.cookies.set(name, value, options));
        },
      },
    },
  );
  const { data } = await supabase.auth.getUser();
  // /api/push est appelé par la base de données (vérifié par un secret partagé), sans session.
  const publique = request.nextUrl.pathname.startsWith("/connexion") || request.nextUrl.pathname === "/api/push";
  if (!data.user && !publique) {
    const url = request.nextUrl.clone();
    url.pathname = "/connexion";
    return NextResponse.redirect(url);
  }
  return reponse;
}
