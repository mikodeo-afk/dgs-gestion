import "server-only";
import { supabaseServeur } from "./supabase/server";

export async function journaliser(message: string) {
  const supabase = await supabaseServeur();
  await supabase.from("journal").insert({ message });
}
