import { createClient } from "@supabase/supabase-js";

/** Anonymous client for public pages. It can only call functions granted to `anon`. */
export function supabasePublic() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );
}
