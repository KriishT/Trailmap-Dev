"use client";

import { Github } from "lucide-react";

export function ConnectGitHubButton({ label = "Connect GitHub" }: { label?: string }) {
  const appSlug = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG ?? "trailmap-dev";
  return (
    <a
      href={`https://github.com/apps/${appSlug}/installations/new`}
      className="btn-primary"
      style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "6px" }}
    >
      <Github size={14} /> {label}
    </a>
  );
}
