import type { ReactNode } from "react";
import { cx } from "./cx";

export type StampTone = "pan" | "phi" | "pii" | "credentials" | "ok" | "bad" | "plain";

/** A rubber-stamp tag. Colour is reserved for data class and status; `possible` draws a dashed border. */
export function Stamp({ tone = "plain", possible, children, title }: { tone?: StampTone; possible?: boolean; children: ReactNode; title?: string }) {
  return (
    <span className={cx("stamp", `stamp-${tone}`, possible && "stamp-possible")} title={title}>
      {children}
    </span>
  );
}

const CLASS_TONE: Record<string, StampTone> = { PAN: "pan", PHI: "phi", PII: "pii", CREDENTIALS: "credentials" };

export function ClassStamp({ name, possible }: { name: string; possible?: boolean }) {
  return (
    <Stamp tone={CLASS_TONE[name] ?? "plain"} possible={possible} title={possible ? `${name}: possible, not confirmed in code` : `${name}: found in code`}>
      {name}
      {possible ? "?" : ""}
    </Stamp>
  );
}
