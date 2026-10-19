import type { CatalogEntry, DependencyGraph, Override, Scope, VendorMetadata } from "@trailmap/graph";

export interface RevisionInfo {
  id: string;
  /** "Rev A", "Rev B", ... oldest first, like a drawing revision block. */
  label: string;
  scannedAt: string;
  commitSha: string | null;
  graphHash: string | null;
  nodeCount: number;
  edgeCount: number;
  /** Plain-language change versus the previous revision. */
  summary: string;
}

export interface DriftView {
  id: string;
  prNumber: number;
  headSha: string;
  conclusion: "success" | "neutral" | "failure";
  status: "open" | "acknowledged";
  summary: string;
  findings: Array<{ key: string; rule: string; severity: string; title: string; detail: string; nodeIds: string[]; edgeIds: string[] }>;
  acknowledgedBy: string | null;
  createdAt: string;
}

export interface AttestationView {
  id: string;
  kind: "snapshot_review" | "drift_ack";
  actor: string;
  note: string | null;
  graphHash: string;
  createdAt: string;
}

export interface ExportView {
  id: string;
  framework: string;
  format: string;
  graphHash: string;
  fileHash: string;
  periodStart: string | null;
  periodEnd: string | null;
  createdAt: string;
}

export interface OverrideView {
  id: string;
  kind: Override["kind"];
  summary: string;
  reason: string;
  actor: string;
  createdAt: string;
}

export interface ShareView {
  slug: string;
  snapshotId: string;
  label: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface WorkspaceData {
  repo: { id: string; orgId: string | null; fullName: string; defaultBranch: string };
  /** True for the public sample repository, which lives in the browser and is not saved. */
  demo: boolean;
  revisions: RevisionInfo[];
  selectedId: string;
  /** Scanner output of the selected revision, exactly as stored. */
  graph: DependencyGraph;
  /** The same with people's decisions (confirmed, hidden, added) applied. */
  effective: DependencyGraph;
  highlightNodeIds: string[];
  highlightEdgeIds: string[];
  scopes: Scope[];
  overrides: OverrideView[];
  orphanedOverrides: number;
  vendorMeta: VendorMetadata[];
  catalog: CatalogEntry[];
  attestations: AttestationView[];
  drift: DriftView[];
  exports: ExportView[];
  shares: ShareView[];
  policy: { frameworks: string[]; onDrift: "neutral" | "failure" };
  permissions: { canAdmin: boolean };
  /** Scans that are queued or running, for live progress. */
  activeScan: { id: string; status: string } | null;
}

export function revisionLabel(index: number): string {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `Rev ${out}`;
}
