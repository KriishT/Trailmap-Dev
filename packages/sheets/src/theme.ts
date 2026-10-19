import type { DataClass } from "@trailmap/graph";

/**
 * "Survey sheet" design tokens. The light theme is drafting paper, the dark theme is blueprint.
 * The same values are defined as CSS variables in the web app; they live here too because exported
 * SVG and PDF files must not depend on a stylesheet.
 */
export interface Theme {
  name: "light" | "dark";
  paper: string;
  paperRaised: string;
  ink: string;
  ink2: string;
  ink3: string;
  rule: string;
  grid: string;
  verified: string;
  attention: string;
  danger: string;
  /** Stamp colours per data class. Colour is reserved for data class and drift. */
  classColor: Record<DataClass, string>;
}

export const LIGHT: Theme = {
  name: "light",
  paper: "#F2F0EA",
  paperRaised: "#FBFAF7",
  ink: "#15171B",
  ink2: "#4A4E57",
  ink3: "#62666F",
  rule: "#D8D4C8",
  grid: "rgba(21,23,27,0.06)",
  verified: "#1E6B55",
  attention: "#F1C232",
  danger: "#C2381F",
  classColor: { PAN: "#C2381F", PHI: "#1F5E99", CREDENTIALS: "#4A4E57", PII: "#8A5A00" },
};

export const DARK: Theme = {
  name: "dark",
  paper: "#0D1B2A",
  paperRaised: "#12253A",
  ink: "#E6EEF6",
  ink2: "#A9BCD0",
  ink3: "#8CA3BC",
  rule: "#27425E",
  grid: "rgba(230,238,246,0.07)",
  verified: "#5FD1A8",
  attention: "#F4D35E",
  danger: "#FF7A5C",
  classColor: { PAN: "#FF7A5C", PHI: "#7FB6F0", CREDENTIALS: "#A9BCD0", PII: "#E5B25D" },
};

export const themeFor = (name: "light" | "dark"): Theme => (name === "dark" ? DARK : LIGHT);

/** Highest-sensitivity first: decides which class colours an edge. */
export const CLASS_PRIORITY: DataClass[] = ["PAN", "PHI", "CREDENTIALS", "PII"];

/** Edge stroke by confidence, not by colour: solid, dashed, dotted. */
export const CONFIDENCE_DASH = { high: "", medium: "7 4", low: "1.5 4" } as const;

/** WCAG relative luminance and contrast ratio, used to keep the tokens honest. */
export function contrastRatio(foreground: string, background: string): number {
  const lum = (hex: string) => {
    const n = hex.replace("#", "");
    const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(n.slice(i, i + 2), 16) / 255);
    const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
  };
  const a = lum(foreground);
  const b = lum(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
