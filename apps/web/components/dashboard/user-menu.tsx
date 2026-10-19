"use client";

import { useRouter } from "next/navigation";
import { Button } from "@trailmap/ui";
import { createSupabaseBrowserClient } from "@/lib/supabase";

export function UserMenu({ email, local }: { email: string; local: boolean }) {
  const router = useRouter();

  async function signOut() {
    if (local) await fetch("/api/local/session", { method: "DELETE" });
    else await createSupabaseBrowserClient().auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <div className="row">
      <span className="muted mono" style={{ fontSize: "var(--step--1)" }}>{email}</span>
      <Button size="small" variant="quiet" onClick={signOut}>Sign out</Button>
    </div>
  );
}
