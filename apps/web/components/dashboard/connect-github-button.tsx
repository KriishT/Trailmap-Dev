export function ConnectGitHubButton({ label = "Install the GitHub App", variant = "default" }: { label?: string; variant?: "default" | "primary" }) {
  const appSlug = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG ?? "trailmap-dev";
  return (
    <a href={`https://github.com/apps/${appSlug}/installations/new`} className={variant === "primary" ? "btn btn-primary" : "btn"}>
      {label}
    </a>
  );
}
