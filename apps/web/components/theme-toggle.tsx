"use client";

import { useEffect, useState } from "react";
import { Button } from "@trailmap/ui";

type Theme = "light" | "dark";

function currentTheme(): Theme {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function setTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem("trailmap-theme", theme);
  } catch {
    /* private mode: the choice just lasts for this page */
  }
}

/** Switches between drafting paper (light) and blueprint (dark). */
export function ThemeToggle() {
  const [theme, set] = useState<Theme | null>(null);
  useEffect(() => set(currentTheme()), []);
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <Button
      size="small"
      variant="quiet"
      aria-label={`Switch to ${next} theme`}
      onClick={() => {
        setTheme(next);
        set(next);
      }}
    >
      {theme === "dark" ? "Paper" : "Blueprint"}
    </Button>
  );
}
