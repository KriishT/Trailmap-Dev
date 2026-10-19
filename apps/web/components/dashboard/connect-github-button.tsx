"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@trailmap/ui";

/**
 * Sends the person to GitHub to install the app. In the local sandbox there is no GitHub, so this
 * simulates the installation instead, which creates the organisation the same way the real callback does.
 */
export function ConnectGitHubButton({ label = "Install the GitHub App", variant = "default", local = false }: { label?: string; variant?: "default" | "primary"; local?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const appSlug = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG ?? "trailmap-dev";

  if (!local) {
    return (
      <a href={`https://github.com/apps/${appSlug}/installations/new`} className={variant === "primary" ? "btn btn-primary" : "btn"}>
        {label}
      </a>
    );
  }
  return (
    <Button
      variant={variant}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/local/github", { method: "POST" });
        setBusy(false);
        router.refresh();
      }}
    >
      {busy ? "Installing" : `${label} (simulated)`}
    </Button>
  );
}
