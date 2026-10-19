import type { ReactNode } from "react";

export interface TitleBlockRow {
  label: string;
  value: ReactNode;
}

/** The corner block of a drawing sheet: who, what, when, and the hash that ties the sheet to the data. */
export function TitleBlock({ title, rows }: { title: string; rows: TitleBlockRow[] }) {
  return (
    <section className="title-block" aria-label={title}>
      <div className="tb-head">{title.toUpperCase()}</div>
      <dl>
        {rows.map((r) => (
          <div key={r.label} style={{ display: "contents" }}>
            <dt>{r.label}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
