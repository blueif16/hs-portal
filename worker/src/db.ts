// Supabase with the SECRET key (server-side only, bypasses RLS). Never ship this key to a browser.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../dashboard/utils/supabase/database.types.ts";
import { need } from "./env.ts";

export const db = createClient<Database>(need("SUPABASE_URL"), need("SUPABASE_SECRET_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Throws on error; data is non-null for selects (inserts without .select() just return null, unused).
export function check<T>(res: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as NonNullable<T>;
}
