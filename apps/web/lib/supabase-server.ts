import type { CookieOptions } from "@supabase/ssr";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { isLocalMode, LOCAL_COOKIE, localUserFromCookie } from "./local-mode";
import { localAdminClient, localAnonClient, localUserClient } from "./local-db";

type CookieMutation = {
  name: string;
  value: string;
  options?: Record<string, unknown>;
};

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  if (isLocalMode()) {
    const userId = localUserFromCookie(cookieStore.get(LOCAL_COOKIE)?.value);
    return (userId ? localUserClient(userId) : localAnonClient()) as unknown as ReturnType<typeof createServerClient>;
  }
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet: CookieMutation[]) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options as CookieOptions)
            );
          } catch {
            // Server components cannot always mutate cookies
          }
        },
      },
    }
  );
}

export function supabaseAdmin() {
  if (isLocalMode()) return localAdminClient();
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
