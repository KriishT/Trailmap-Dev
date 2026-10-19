"use client";

import { useState } from "react";
import { TabPanel, Tabs, TitleBlock } from "@trailmap/ui";

export interface SharedSheet {
  id: string;
  title: string;
  svg: { light: string; dark: string };
}

/** What a recipient of a share link sees: the sheets and the title block, nothing else. */
export function SharedSheets({ sheets, rows, label }: { sheets: SharedSheet[]; rows: Array<{ label: string; value: string }>; label: string | null }) {
  const [tab, setTab] = useState(sheets[0]?.id ?? "system");
  return (
    <div className="stack" style={{ position: "relative" }}>
      <Tabs tabs={sheets.map((s) => ({ id: s.id, label: s.title }))} active={tab} onChange={setTab} label="Sheets" idPrefix="shared" />
      {sheets.map((s) => (
        <TabPanel key={s.id} id={s.id} active={tab} idPrefix="shared">
          <div className="sheet-frame">
            <div className="sheet-scroll">
              <div className="theme-light-only" dangerouslySetInnerHTML={{ __html: s.svg.light }} />
              <div className="theme-dark-only" dangerouslySetInnerHTML={{ __html: s.svg.dark }} />
            </div>
            {label ? (
              <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden", opacity: 0.08, fontFamily: "var(--font-cond)", fontWeight: 600, fontSize: 28, transform: "rotate(-18deg)", lineHeight: 3.4, whiteSpace: "pre-wrap" }}>
                {Array.from({ length: 80 }, () => `${label}     `).join("")}
              </div>
            ) : null}
          </div>
        </TabPanel>
      ))}
      <TitleBlock title="Sheet information" rows={rows} />
    </div>
  );
}
