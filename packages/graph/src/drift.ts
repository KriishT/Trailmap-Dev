import type { DataClass, DependencyGraph, GraphEvidence, GraphNode } from "./schema.js";
import { diffGraphs, edgeKey } from "./diff.js";
import { analyzeScope, type Scope } from "./scope.js";
import { ruleEnabled, type DriftRule, type Policy } from "./policy.js";

export type Severity = "high" | "medium" | "low";

export interface DriftFinding {
  /** Stable across scans of the same change, so an acknowledgement or an `ignore` entry can refer to it. */
  key: string;
  rule: DriftRule;
  severity: Severity;
  title: string;
  detail: string;
  nodeIds: string[];
  edgeIds: string[];
  evidence: GraphEvidence[];
}

export interface DriftResult {
  findings: DriftFinding[];
  /** Findings suppressed by the policy's `ignore` list. */
  ignored: DriftFinding[];
  conclusion: "success" | "neutral" | "failure";
  summary: string;
}

const VENDOR_LIKE = new Set(["saas", "external"]);
const SENSITIVE: ReadonlySet<DataClass> = new Set(["PAN", "PHI", "CREDENTIALS"]);
const STATEFUL = new Set(["database", "storage", "queue"]);

const sevRank: Record<Severity, number> = { high: 3, medium: 2, low: 1 };

function firstEvidence(...lists: Array<GraphEvidence[] | undefined>): GraphEvidence[] {
  const out: GraphEvidence[] = [];
  for (const list of lists) for (const e of list ?? []) if (out.length < 4) out.push(e);
  return out;
}

const nameOf = (graph: DependencyGraph, id: string) => graph.nodes.find((n) => n.id === id)?.name ?? id;

function exposureKeys(node: GraphNode | undefined): Set<string> {
  return new Set((node?.exposure ?? []).map((e) => `${e.direction}|${e.cidr}|${e.port ?? "any"}`));
}

export interface DriftInput {
  base: DependencyGraph;
  head: DependencyGraph;
  scopes: Scope[];
  policy: Policy;
}

export function evaluateDrift({ base, head, scopes, policy }: DriftInput): DriftResult {
  const diff = diffGraphs(base, head);
  const findings: DriftFinding[] = [];
  const headNodes = new Map(head.nodes.map((n) => [n.id, n]));
  const baseNodes = new Map(base.nodes.map((n) => [n.id, n]));
  const edgesByKey = new Map(head.edges.map((e) => [edgeKey(e), e]));

  // 1. A vendor / subprocessor that was not there before
  if (ruleEnabled(policy, "new_vendor")) {
    for (const node of diff.addedNodes.filter((n) => VENDOR_LIKE.has(n.type))) {
      const incoming = head.edges.filter((e) => e.to === node.id);
      const sensitive = incoming.some((e) => (e.dataClasses ?? []).some((t) => t.certainty === "evidenced" && SENSITIVE.has(t.class)));
      findings.push({
        key: `new_vendor:${node.id}`,
        rule: "new_vendor",
        severity: sensitive ? "high" : "medium",
        title: `New third-party vendor: ${node.name}`,
        detail: `${incoming.map((e) => nameOf(head, e.from)).join(", ") || "A service"} now depends on ${node.name}${node.type === "external" ? " (an external host)" : ""}.`,
        nodeIds: [node.id, ...incoming.map((e) => e.from)],
        edgeIds: incoming.map(edgeKey),
        evidence: firstEvidence(...incoming.map((e) => e.evidence), node.evidence),
      });
    }
  }

  // 2. A data class that now reaches a vendor
  if (ruleEnabled(policy, "data_class_to_vendor")) {
    for (const change of diff.addedDataClasses) {
      if (change.subjectKind !== "edge" || change.certainty !== "evidenced") continue;
      const edge = edgesByKey.get(change.subject);
      const target = edge ? headNodes.get(edge.to) : undefined;
      if (!edge || !target || !VENDOR_LIKE.has(target.type)) continue;
      const tag = (edge.dataClasses ?? []).find((t) => t.class === change.class);
      findings.push({
        key: `data_class_to_vendor:${change.subject}:${change.class}`,
        rule: "data_class_to_vendor",
        severity: SENSITIVE.has(change.class) ? "high" : "medium",
        title: `${change.class} now reaches ${target.name}`,
        detail: `${nameOf(head, edge.from)} sends data classified as ${change.class} to ${target.name}.`,
        nodeIds: [edge.from, edge.to],
        edgeIds: [change.subject],
        evidence: firstEvidence(tag?.evidence, edge.evidence),
      });
    }
  }

  // 3. A new connection across the boundary of a scope
  if (ruleEnabled(policy, "scope_boundary_crossing") || ruleEnabled(policy, "low_confidence_in_scope")) {
    for (const scope of scopes) {
      const before = new Set(analyzeScope(base, scope).crossings.map((c) => edgeKey(c.edge)));
      const after = analyzeScope(head, scope);
      if (ruleEnabled(policy, "scope_boundary_crossing")) {
        for (const c of after.crossings) {
          const k = edgeKey(c.edge);
          if (before.has(k)) continue;
          findings.push({
            key: `scope_boundary_crossing:${scope.id}:${k}`,
            rule: "scope_boundary_crossing",
            severity: c.direction === "out" && VENDOR_LIKE.has(c.outside.type) ? "high" : "medium",
            title: `New connection crosses the "${scope.name}" boundary`,
            detail: c.direction === "out"
              ? `${c.inside.name} (in scope) now connects out to ${c.outside.name}.`
              : `${c.outside.name} now connects into ${c.inside.name} (in scope).`,
            nodeIds: [c.inside.id, c.outside.id],
            edgeIds: [k],
            evidence: firstEvidence(c.edge.evidence),
          });
        }
      }
      // 4b. low-confidence connections touching a scoped node
      if (ruleEnabled(policy, "low_confidence_in_scope")) {
        const inScope = new Set(scope.nodeIds);
        for (const edge of [...diff.addedEdges, ...diff.changedEdges.map((c) => c.edge)]) {
          if (edge.confidence !== "low" || !(inScope.has(edge.from) || inScope.has(edge.to))) continue;
          findings.push({
            key: `low_confidence_in_scope:${scope.id}:${edgeKey(edge)}`,
            rule: "low_confidence_in_scope",
            severity: "low",
            title: `Unconfirmed connection touches "${scope.name}"`,
            detail: `${nameOf(head, edge.from)} to ${nameOf(head, edge.to)} was found with low confidence. Confirm or hide it.`,
            nodeIds: [edge.from, edge.to],
            edgeIds: [edgeKey(edge)],
            evidence: firstEvidence(edge.evidence),
          });
        }
      }
    }
  }

  // 4. New public ingress / egress in infrastructure
  if (ruleEnabled(policy, "public_exposure")) {
    for (const node of head.nodes) {
      if (node.id === "internet") continue;
      const before = baseNodes.get(node.id);
      const had = exposureKeys(before);
      const fresh = (node.exposure ?? []).filter((e) => !had.has(`${e.direction}|${e.cidr}|${e.port ?? "any"}`));
      for (const exp of fresh) {
        const stateful = STATEFUL.has(node.type) || node.type === "service";
        findings.push({
          key: `public_exposure:${node.id}:${exp.direction}|${exp.cidr}|${exp.port ?? "any"}`,
          rule: "public_exposure",
          severity: exp.direction === "egress" ? "low" : stateful ? "high" : "medium",
          title: `${node.name} is open to ${exp.cidr} (${exp.direction}${exp.port ? ` :${exp.port}` : ""})`,
          detail: `${node.name} allows ${exp.direction} ${exp.protocol ? `${exp.protocol} ` : ""}traffic ${exp.direction === "ingress" ? "from" : "to"} anywhere on the internet.`,
          nodeIds: [node.id],
          edgeIds: [],
          evidence: [{ kind: "iac", source: exp.source, detail: `${exp.direction} ${exp.cidr}`, ...(exp.line ? { line: exp.line } : {}) }],
        });
      }
      if (node.public && !before?.public && fresh.length === 0) {
        findings.push({
          key: `public_exposure:${node.id}:public`,
          rule: "public_exposure",
          severity: STATEFUL.has(node.type) ? "high" : "medium",
          title: `${node.name} is now reachable from the internet`,
          detail: `${node.name} is exposed publicly (for example through an Ingress or load balancer).`,
          nodeIds: [node.id],
          edgeIds: [],
          evidence: firstEvidence(node.evidence),
        });
      }
    }
  }

  // 5. Datastores added, removed or changed engine
  if (ruleEnabled(policy, "datastore_change")) {
    for (const n of diff.addedNodes.filter((x) => STATEFUL.has(x.type))) {
      findings.push({
        key: `datastore_change:added:${n.id}`, rule: "datastore_change", severity: "medium",
        title: `Datastore added: ${n.name}`, detail: `${n.name}${n.engine ? ` (${n.engine})` : ""} was added to the architecture.`,
        nodeIds: [n.id], edgeIds: [], evidence: firstEvidence(n.evidence),
      });
    }
    for (const n of diff.removedNodes.filter((x) => STATEFUL.has(x.type))) {
      findings.push({
        key: `datastore_change:removed:${n.id}`, rule: "datastore_change", severity: "medium",
        title: `Datastore removed: ${n.name}`, detail: `${n.name}${n.engine ? ` (${n.engine})` : ""} is no longer in the architecture.`,
        nodeIds: [n.id], edgeIds: [], evidence: firstEvidence(n.evidence),
      });
    }
    for (const c of diff.changedNodes.filter((x) => STATEFUL.has(x.after.type) && x.fields.includes("engine"))) {
      findings.push({
        key: `datastore_change:engine:${c.id}`, rule: "datastore_change", severity: "medium",
        title: `Datastore engine changed: ${c.after.name}`, detail: `${c.before.engine ?? "unknown"} became ${c.after.engine ?? "unknown"}.`,
        nodeIds: [c.id], edgeIds: [], evidence: firstEvidence(c.after.evidence),
      });
    }
  }

  const ignore = new Set(policy.ignore);
  const isIgnored = (f: DriftFinding) => ignore.has(f.key) || f.nodeIds.some((id) => ignore.has(id));
  const order = (a: DriftFinding, b: DriftFinding) => sevRank[b.severity] - sevRank[a.severity] || a.key.localeCompare(b.key);
  const kept = findings.filter((f) => !isIgnored(f)).sort(order);
  const ignored = findings.filter(isIgnored).sort(order);

  // A finding can be reported twice (two scopes); keep the first of each key.
  const seen = new Set<string>();
  const unique = kept.filter((f) => (seen.has(f.key) ? false : (seen.add(f.key), true)));

  const conclusion = unique.length === 0 ? "success" : policy.on_drift;
  return { findings: unique, ignored, conclusion, summary: summarize(unique, ignored.length) };
}

export function summarize(findings: DriftFinding[], ignoredCount = 0): string {
  if (findings.length === 0) {
    return ignoredCount ? `No scope drift (${ignoredCount} accepted by policy).` : "No scope drift detected.";
  }
  const high = findings.filter((f) => f.severity === "high").length;
  const noun = findings.length === 1 ? "finding" : "findings";
  return `${findings.length} scope drift ${noun}${high ? `, ${high} high severity` : ""}.`;
}

/** A hash of the finding keys, so an acknowledgement covers exactly what was reported. */
export function driftFingerprint(findings: Array<Pick<DriftFinding, "key">>): string {
  return findings.map((f) => f.key).sort().join("\n");
}
