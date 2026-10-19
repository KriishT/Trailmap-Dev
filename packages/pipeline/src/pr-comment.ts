import type { ChangeImpact, DriftFinding, GraphEvidence } from "@trailmap/graph";
import type { CheckConclusion } from "./types.js";

export const PR_COMMENT_MARKER = "<!-- trailmap-pr-check -->";
export const CHECK_NAME = "Trailmap scope check";

export function blobUrl(fullName: string, sha: string, file: string, line?: number): string {
  const path = file.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${fullName}/blob/${sha}/${path}${line ? `#L${line}` : ""}`;
}

function evidenceLinks(evidence: GraphEvidence[], fullName: string, sha: string): string {
  return evidence
    .filter((e) => !e.source.startsWith("override:"))
    .slice(0, 3)
    .map((e) => `[\`${e.source}${e.line ? `:${e.line}` : ""}\`](${blobUrl(fullName, sha, e.source, e.line)})`)
    .join(", ");
}

export interface RenderInput {
  fullName: string;
  headSha: string;
  prNumber: number;
  conclusion: CheckConclusion;
  summary: string;
  findings: DriftFinding[];
  ignoredCount: number;
  impact: ChangeImpact | null;
  policyErrors: string[];
  noBaseline: boolean;
  acknowledgedBy: string | null;
  /** Link to the repository in the Trailmap app, when known. */
  appLink?: string;
}

const SEVERITY_LABEL = { high: "HIGH", medium: "MEDIUM", low: "LOW" } as const;

function findingsSection(i: RenderInput): string {
  if (i.noBaseline) {
    return "No baseline snapshot exists for this repository yet, so there is nothing to compare against. Run a scan of the default branch first.";
  }
  if (i.findings.length === 0) return i.summary;
  const lines = i.findings.map((f) => {
    const links = evidenceLinks(f.evidence, i.fullName, i.headSha);
    return `- **${SEVERITY_LABEL[f.severity]}** ${f.title}\n  ${f.detail}${links ? `\n  Evidence: ${links}` : ""}`;
  });
  return `${i.summary}\n\n${lines.join("\n")}`;
}

function impactSection(impact: ChangeImpact | null): string {
  if (!impact) return "";
  const rows: string[] = [impact.summary, ""];
  if (impact.touched.length) {
    rows.push("| Service | Changed files | Blast radius | Owners |", "|---|---|---|---|");
    for (const t of impact.touched) {
      rows.push(`| ${t.name} | ${t.changedFiles.length} | ${t.blastRadius} (${t.risk}) | ${t.owners.join(", ") || "none listed"} |`);
    }
    rows.push("");
  }
  if (impact.affectedVendors.length) rows.push(`Downstream vendors: ${impact.affectedVendors.join(", ")}`);
  if (impact.affectedDataStores.length) rows.push(`Downstream datastores: ${impact.affectedDataStores.join(", ")}`);
  if (impact.affectedDependents.length) rows.push(`Services that depend on this change: ${impact.affectedDependents.join(", ")}`);
  if (impact.suggestedReviewers.length) rows.push(`Suggested reviewers (CODEOWNERS): ${impact.suggestedReviewers.join(", ")}`);
  return rows.join("\n");
}

export function renderComment(i: RenderInput): string {
  const parts: string[] = [PR_COMMENT_MARKER, "## Trailmap scope check", ""];
  parts.push(`Result: **${i.acknowledgedBy ? "acknowledged" : i.conclusion}**`, "");
  if (i.acknowledgedBy) parts.push(`Drift acknowledged by ${i.acknowledgedBy}. The check now passes for this commit; a new commit needs a new acknowledgement.`, "");
  parts.push(findingsSection(i), "");
  if (i.ignoredCount > 0) parts.push(`${i.ignoredCount} finding${i.ignoredCount === 1 ? "" : "s"} accepted by \`.trailmap.yml\` and not shown.`, "");
  if (i.policyErrors.length) parts.push("Policy problems (defaults were used):", ...i.policyErrors.map((e) => `- ${e}`), "");
  if (i.findings.length && !i.acknowledgedBy && i.conclusion !== "success") {
    parts.push("To accept this change, comment `/trailmap ack` on this pull request (needs write access), or acknowledge it in Trailmap.", "");
  }
  const impact = impactSection(i.impact);
  if (impact) parts.push("<details>", "<summary>Blast radius and owners</summary>", "", impact, "", "</details>", "");
  if (i.appLink) parts.push(`[Open in Trailmap](${i.appLink})`, "");
  parts.push("Trailmap produces evidence to support review. Verify findings with your assessor.");
  return parts.join("\n");
}

export interface CheckText {
  title: string;
  summary: string;
  text: string;
}

export function renderCheck(i: RenderInput): CheckText {
  const title = i.acknowledgedBy ? `Acknowledged by ${i.acknowledgedBy}` : i.noBaseline ? "No baseline to compare" : i.summary;
  return { title, summary: renderComment({ ...i, impact: null }).replace(PR_COMMENT_MARKER + "\n", ""), text: impactSection(i.impact) };
}
