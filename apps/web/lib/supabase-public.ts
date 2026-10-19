import { createClient } from "@supabase/supabase-js";
import { isLocalMode } from "./local-mode";
import { localAnonClient } from "./local-db";

/** Anonymous client for public pages. It can only call functions granted to `anon`. */
export function supabasePublic() {
  if (isLocalMode()) return localAnonClient();
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );
}
