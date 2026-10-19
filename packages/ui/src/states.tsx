import type { ReactNode } from "react";
import { cx } from "./cx";

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="state">
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {action ? <div style={{ marginTop: 14 }}>{action}</div> : null}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", children, action }: { title?: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={cx("state", "state-error")} role="alert">
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {action ? <div style={{ marginTop: 14 }}>{action}</div> : null}
    </div>
  );
}

/** Hatched placeholder for content that is still loading. */
export function Loading({ label = "Loading", height = 160 }: { label?: string; height?: number }) {
  return (
    <div className="skeleton" style={{ minHeight: height }} role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
    </div>
  );
}
