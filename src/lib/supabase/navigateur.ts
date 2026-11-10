"use client";
import { createBrowserClient } from "@supabase/ssr";

/** Client Supabase dans le navigateur, au nom de l'employé connecté (dépôt direct des fichiers). */
export const supabaseNavigateur = () =>
  createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
