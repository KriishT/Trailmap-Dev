"use client";

import { useMemo } from "react";
import type { DependencyGraph } from "@trailmap/scanner";
import { ArrowRightLeft, CornerDownRight, Plus, ShieldAlert, Sparkles, Trash2 } from "lucide-react";
import { diffGraphs, type GraphSnapshotDiff } from "@/lib/graph-diff";

const shellStyle = {
  width: "100%",
  maxWidth: "1480px",
  margin: "0 auto",
} satisfies React.CSSProperties;

export function RepoChanges({
  currentGraph,
  previousGraph,
  scannedAt,
  previousScannedAt,
}: {
  currentGraph: DependencyGraph;
  previousGraph?: DependencyGraph;
  scannedAt: string;
  previousScannedAt?: string;
}) {
  const diff = useMemo(
    () => (previousGraph ? diffGraphs(currentGraph, previousGraph) : null),
    [currentGraph, previousGraph]
  );

  if (!previousGraph || !diff) {
    return (
      <EmptyChangesState
        title="Changes appear after the second scan"
        body="Trailmap needs a previous snapshot before it can show architectural drift. Run another scan and this view will start comparing what changed."
      />
    );
  }

  if (!diff.hasChanges) {
    return (
      <EmptyChangesState
        title="No structural change detected"
        body={`Between ${formatRelativeMoment(previousScannedAt)} and ${formatRelativeMoment(scannedAt)}, the graph structure stayed the same.`}
      />
    );
  }

  return (
    <div style={{ width: "100%", padding: "18px 20px 24px", overflow: "auto", display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={shellStyle}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
          <StatCard icon={Plus} label="Added" value={diff.addedNodes.length} tone="green" />
          <StatCard icon={Trash2} label="Removed" value={diff.removedNodes.length} tone="red" />
          <StatCard icon={ArrowRightLeft} label="New links" value={diff.addedEdges.length} tone="green" />
          <StatCard icon={CornerDownRight} label="Dropped links" value={diff.removedEdges.length} tone="red" />
          <StatCard icon={ShieldAlert} label="Confidence" value={diff.changedEdgeConfidence.length} tone="amber" />
        </div>

        <div style={{ marginTop: "14px" }}>
          <CompactBanner title="Change read" body={buildChangeSummary(diff, scannedAt, previousScannedAt)} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px", marginTop: "14px" }}>
          <DiffListCard
            title="Added"
            emptyLabel="Nothing new showed up."
            groups={[
              { label: "Services", items: diff.addedServices.map((node) => `${node.name}${node.path ? ` - ${node.path}` : ""}`) },
              { label: "Data stores", items: diff.addedDataStores.map((node) => node.name) },
              { label: "Vendors", items: diff.addedVendors.map((node) => node.name) },
            ]}
          />
          <DiffListCard
            title="Removed"
            emptyLabel="No nodes disappeared."
            groups={[
              { label: "Services", items: diff.removedServices.map((node) => `${node.name}${node.path ? ` - ${node.path}` : ""}`) },
              { label: "Data stores", items: diff.removedDataStores.map((node) => node.name) },
              { label: "Vendors", items: diff.removedVendors.map((node) => node.name) },
            ]}
          />
          <div style={{ gridColumn: "1 / -1" }}>
            <DiffListCard
              title="Links"
              emptyLabel="No edge movement detected."
              groups={[
                { label: "Added", items: diff.addedEdges.map((edge) => `${edge.from} -> ${edge.to} - ${edge.type}`) },
                { label: "Removed", items: diff.removedEdges.map((edge) => `${edge.from} -> ${edge.to} - ${edge.type}`) },
                { label: "Confidence", items: diff.changedEdgeConfidence.map((edge) => `${edge.from} -> ${edge.to} - ${edge.previousConfidence} -> ${edge.currentConfidence}`) },
              ]}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Plus;
  label: string;
  value: number;
  tone: "green" | "red" | "amber";
}) {
  const colors = {
    green: { text: "#1D7A46", bg: "rgba(29,122,70,0.06)", border: "rgba(29,122,70,0.12)" },
    red: { text: "#B24C3D", bg: "rgba(178,76,61,0.06)", border: "rgba(178,76,61,0.12)" },
    amber: { text: "#B57A15", bg: "rgba(181,122,21,0.06)", border: "rgba(181,122,21,0.12)" },
  }[tone];

  return (
    <div style={{ background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: "16px", padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
        <div style={{ fontSize: "0.72rem", color: "rgba(26,15,8,0.42)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
        <Icon size={13} color={colors.text} />
      </div>
      <div style={{ fontSize: "1.4rem", fontWeight: 600, color: colors.text }}>{value}</div>
    </div>
  );
}

function CompactBanner({ title, body }: { title: string; body: string }) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.86)",
        border: "1px solid rgba(26,15,8,0.08)",
        borderRadius: "18px",
        padding: "14px 16px",
        display: "flex",
        alignItems: "flex-start",
        gap: "10px",
      }}
    >
      <div
        style={{
          width: "28px",
          height: "28px",
          borderRadius: "999px",
          background: "rgba(232,117,74,0.09)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Sparkles size={14} color="#E8754A" />
      </div>
      <div>
        <div style={{ fontSize: "0.78rem", color: "rgba(26,15,8,0.42)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>{title}</div>
        <div style={{ fontSize: "0.92rem", color: "#1A0F08", lineHeight: 1.55 }}>{body}</div>
      </div>
    </div>
  );
}

function DiffListCard({
  title,
  groups,
  emptyLabel,
}: {
  title: string;
  groups: Array<{ label: string; items: string[] }>;
  emptyLabel: string;
}) {
  const visibleGroups = groups.filter((group) => group.items.length > 0);

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.86)",
        border: "1px solid rgba(26,15,8,0.08)",
        borderRadius: "18px",
        padding: "16px",
        minHeight: "280px",
      }}
    >
      <div style={{ fontSize: "0.74rem", color: "rgba(26,15,8,0.38)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "12px" }}>
        {title}
      </div>
      {visibleGroups.length === 0 ? (
        <div style={{ fontSize: "0.84rem", color: "rgba(26,15,8,0.38)", lineHeight: 1.6 }}>{emptyLabel}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {visibleGroups.map((group) => (
            <div key={group.label}>
              <div style={{ fontSize: "0.76rem", color: "rgba(26,15,8,0.34)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.06em" }}>{group.label}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {group.items.slice(0, 8).map((item) => (
                  <div
                    key={`${group.label}-${item}`}
                    style={{
                      borderRadius: "12px",
                      border: "1px solid rgba(26,15,8,0.06)",
                      background: "rgba(26,15,8,0.02)",
                      padding: "10px 12px",
                      fontSize: "0.84rem",
                      color: "rgba(26,15,8,0.62)",
                      lineHeight: 1.45,
                    }}
                  >
                    {item}
                  </div>
                ))}
                {group.items.length > 8 && <div style={{ fontSize: "0.8rem", color: "rgba(26,15,8,0.38)" }}>+{group.items.length - 8} more</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyChangesState({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
      <div
        style={{
          maxWidth: "560px",
          textAlign: "center",
          background: "rgba(255,255,255,0.82)",
          border: "1px solid rgba(26,15,8,0.08)",
          borderRadius: "22px",
          padding: "28px 26px",
        }}
      >
        <div style={{ fontSize: "1rem", fontWeight: 600, color: "#1A0F08", marginBottom: "8px" }}>{title}</div>
        <div style={{ fontSize: "0.92rem", color: "rgba(26,15,8,0.52)", lineHeight: 1.6 }}>{body}</div>
      </div>
    </div>
  );
}

function buildChangeSummary(diff: GraphSnapshotDiff, scannedAt: string, previousScannedAt?: string): string {
  return `${formatRelativeMoment(previousScannedAt)} -> ${formatRelativeMoment(scannedAt)} · ${diff.addedNodes.length} added, ${diff.removedNodes.length} removed, ${diff.addedEdges.length + diff.removedEdges.length} link changes${diff.changedEdgeConfidence.length > 0 ? `, ${diff.changedEdgeConfidence.length} confidence shift${diff.changedEdgeConfidence.length === 1 ? "" : "s"}` : ""}.`;
}

function formatRelativeMoment(value?: string): string {
  if (!value) return "previous scan";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "previous scan";

  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return formatter.format(date);
}
