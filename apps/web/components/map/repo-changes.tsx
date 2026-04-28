"use client";

import { useMemo } from "react";
import type { DependencyGraph } from "@trailmap/scanner";
import { diffGraphs, type GraphSnapshotDiff } from "@/lib/graph-diff";

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
    <div style={{ padding: "18px 20px 24px", overflow: "auto", display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
        gap: "12px",
      }}>
        <StatCard label="Added nodes" value={diff.addedNodes.length} tone="green" />
        <StatCard label="Removed nodes" value={diff.removedNodes.length} tone="red" />
        <StatCard label="Added edges" value={diff.addedEdges.length} tone="green" />
        <StatCard label="Removed edges" value={diff.removedEdges.length} tone="red" />
        <StatCard label="Confidence shifts" value={diff.changedEdgeConfidence.length} tone="amber" />
      </div>

      <div style={{
        background: "rgba(255,255,255,0.86)",
        border: "1px solid rgba(26,15,8,0.08)",
        borderRadius: "18px",
        padding: "16px 18px",
      }}>
        <div style={{ fontSize: "0.74rem", color: "rgba(26,15,8,0.38)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>
          Change summary
        </div>
        <div style={{ fontSize: "0.95rem", color: "#1A0F08", lineHeight: 1.6 }}>
          {buildChangeSummary(diff, scannedAt, previousScannedAt)}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1.2fr 1fr", gap: "12px" }}>
        <DiffListCard
          title="Added to the map"
          emptyLabel="No new services, stores, or vendors."
          groups={[
            { label: "Services", items: diff.addedServices.map((node) => `${node.name}${node.path ? ` · ${node.path}` : ""}`) },
            { label: "Data stores", items: diff.addedDataStores.map((node) => node.name) },
            { label: "Vendors", items: diff.addedVendors.map((node) => node.name) },
          ]}
        />
        <DiffListCard
          title="Removed from the map"
          emptyLabel="No nodes disappeared."
          groups={[
            { label: "Services", items: diff.removedServices.map((node) => `${node.name}${node.path ? ` · ${node.path}` : ""}`) },
            { label: "Data stores", items: diff.removedDataStores.map((node) => node.name) },
            { label: "Vendors", items: diff.removedVendors.map((node) => node.name) },
          ]}
        />
        <DiffListCard
          title="Relationship changes"
          emptyLabel="No edge movement detected."
          groups={[
            { label: "Added edges", items: diff.addedEdges.map((edge) => `${edge.from} → ${edge.to} · ${edge.type}`) },
            { label: "Removed edges", items: diff.removedEdges.map((edge) => `${edge.from} → ${edge.to} · ${edge.type}`) },
            { label: "Confidence shifts", items: diff.changedEdgeConfidence.map((edge) => `${edge.from} → ${edge.to} · ${edge.previousConfidence} → ${edge.currentConfidence}`) },
          ]}
        />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
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
    <div style={{
      background: colors.bg,
      border: `1px solid ${colors.border}`,
      borderRadius: "16px",
      padding: "14px 16px",
    }}>
      <div style={{ fontSize: "0.72rem", color: "rgba(26,15,8,0.42)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>
        {label}
      </div>
      <div style={{ fontSize: "1.4rem", fontWeight: 600, color: colors.text }}>
        {value}
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
    <div style={{
      background: "rgba(255,255,255,0.86)",
      border: "1px solid rgba(26,15,8,0.08)",
      borderRadius: "18px",
      padding: "16px",
      minHeight: "280px",
    }}>
      <div style={{ fontSize: "0.74rem", color: "rgba(26,15,8,0.38)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "12px" }}>
        {title}
      </div>
      {visibleGroups.length === 0 ? (
        <div style={{ fontSize: "0.84rem", color: "rgba(26,15,8,0.38)", lineHeight: 1.6 }}>{emptyLabel}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {visibleGroups.map((group) => (
            <div key={group.label}>
              <div style={{ fontSize: "0.76rem", color: "rgba(26,15,8,0.34)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {group.label}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {group.items.slice(0, 8).map((item) => (
                  <div key={`${group.label}-${item}`} style={{
                    borderRadius: "12px",
                    border: "1px solid rgba(26,15,8,0.06)",
                    background: "rgba(26,15,8,0.02)",
                    padding: "10px 12px",
                    fontSize: "0.84rem",
                    color: "rgba(26,15,8,0.62)",
                    lineHeight: 1.45,
                  }}>
                    {item}
                  </div>
                ))}
                {group.items.length > 8 && (
                  <div style={{ fontSize: "0.8rem", color: "rgba(26,15,8,0.38)" }}>
                    +{group.items.length - 8} more
                  </div>
                )}
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
    <div style={{
      flex: 1,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px",
    }}>
      <div style={{
        maxWidth: "560px",
        textAlign: "center",
        background: "rgba(255,255,255,0.82)",
        border: "1px solid rgba(26,15,8,0.08)",
        borderRadius: "22px",
        padding: "28px 26px",
      }}>
        <div style={{ fontSize: "1rem", fontWeight: 600, color: "#1A0F08", marginBottom: "8px" }}>{title}</div>
        <div style={{ fontSize: "0.92rem", color: "rgba(26,15,8,0.52)", lineHeight: 1.6 }}>{body}</div>
      </div>
    </div>
  );
}

function buildChangeSummary(diff: GraphSnapshotDiff, scannedAt: string, previousScannedAt?: string): string {
  const parts = [
    `${diff.addedServices.length} service${diff.addedServices.length === 1 ? "" : "s"} added`,
    `${diff.addedVendors.length} vendor${diff.addedVendors.length === 1 ? "" : "s"} added`,
    `${diff.removedNodes.length} node${diff.removedNodes.length === 1 ? "" : "s"} removed`,
    `${diff.addedEdges.length + diff.removedEdges.length} relationship${diff.addedEdges.length + diff.removedEdges.length === 1 ? "" : "s"} moved`,
  ];

  return `Compared with ${formatRelativeMoment(previousScannedAt)}, Trailmap found ${parts.join(", ")} before the latest scan at ${formatRelativeMoment(scannedAt)}. ${diff.changedEdgeConfidence.length > 0 ? `${diff.changedEdgeConfidence.length} relationship confidence change${diff.changedEdgeConfidence.length === 1 ? "" : "s"} also showed up.` : "Confidence stayed stable on unchanged relationships."}`;
}

function formatRelativeMoment(value?: string): string {
  if (!value) return "the previous scan";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "the previous scan";

  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return formatter.format(date);
}
