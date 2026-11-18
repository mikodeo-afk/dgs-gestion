import type { NextRequest } from "next/server";
import { rafraichirSession } from "@/lib/supabase/middleware";

export function middleware(request: NextRequest) {
  return rafraichirSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|webp)$).*)"],
};
