"use client";
import { useRef, type KeyboardEvent, type ReactNode } from "react";

export interface TabSpec {
  id: string;
  label: string;
  badge?: number;
}

/** Roving-tabindex tablist. Arrow keys, Home and End move between tabs. Panels are rendered by the caller. */
export function Tabs({ tabs, active, onChange, label, idPrefix = "tab" }: { tabs: TabSpec[]; active: string; onChange: (id: string) => void; label: string; idPrefix?: string }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKey = (e: KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === active);
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const id = tabs[next]!.id;
    onChange(id);
    refs.current[id]?.focus();
  };
  return (
    <div className="tabs" role="tablist" aria-label={label} onKeyDown={onKey}>
      {tabs.map((t) => (
        <button
          key={t.id}
          ref={(el) => { refs.current[t.id] = el; }}
          id={`${idPrefix}-${t.id}`}
          role="tab"
          type="button"
          className="tab"
          aria-selected={t.id === active}
          aria-controls={`${idPrefix}-panel-${t.id}`}
          tabIndex={t.id === active ? 0 : -1}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.badge ? <span className="count" aria-label={`${t.badge} open`}>{t.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({ id, active, idPrefix = "tab", children }: { id: string; active: string; idPrefix?: string; children: ReactNode }) {
  if (id !== active) return null;
  return (
    <div role="tabpanel" id={`${idPrefix}-panel-${id}`} aria-labelledby={`${idPrefix}-${id}`} tabIndex={-1}>
      {children}
    </div>
  );
}
