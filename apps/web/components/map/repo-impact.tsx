"use client";

import { useMemo, useState } from "react";
import type { DependencyGraph } from "@trailmap/scanner";
import { ArrowRightLeft, Database, FileCode2, GitBranch, GitCommitHorizontal, GitPullRequest, Loader2, RadioTower, Search, Sparkles, TriangleAlert, Zap } from "lucide-react";
import { buildGraphImpactAnalysis, buildPrImpactAnalysis, type ImpactServiceItem, type PrImpactAnalysis } from "@/lib/graph-impact";

const shellStyle = {
  width: "100%",
  maxWidth: "1480px",
  margin: "0 auto",
} satisfies React.CSSProperties;

type ImpactMode = "snapshot" | "pr";

export function RepoImpact({
  repoId,
  currentGraph,
  previousGraph,
}: {
  repoId: string;
  currentGraph: DependencyGraph;
  previousGraph?: DependencyGraph;
}) {
  const [mode, setMode] = useState<ImpactMode>("snapshot");
  const [prNumber, setPrNumber] = useState("");
  const [baseSha, setBaseSha] = useState("");
  const [headSha, setHeadSha] = useState("");
  const [loading, setLoading] = useState(false);
  const [postingComment, setPostingComment] = useState(false);
  const [error, setError] = useState("");
  const [commentMsg, setCommentMsg] = useState("");
  const [prResult, setPrResult] = useState<{ source: string; analysis: PrImpactAnalysis } | null>(null);

  const impact = useMemo(
    () => (previousGraph ? buildGraphImpactAnalysis(currentGraph, previousGraph) : null),
    [currentGraph, previousGraph]
  );

  function switchMode(nextMode: ImpactMode) {
    setMode(nextMode);
    setError("");
    if (nextMode === "snapshot") {
      setPrResult(null);
    }
  }

  async function loadPrImpact() {
    setLoading(true);
    setError("");
    setCommentMsg("");

    const params = new URLSearchParams();
    if (prNumber.trim()) {
      params.set("pr", prNumber.trim());
    } else if (baseSha.trim() && headSha.trim()) {
      params.set("base", baseSha.trim());
      params.set("head", headSha.trim());
    } else {
      setLoading(false);
      setError("Enter a PR number or both base/head commits.");
      return;
    }

    try {
      const res = await fetch(`/api/repos/${repoId}/impact?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load PR impact");

      setPrResult({
        source: data.source,
        analysis: data.analysis,
      });
      setMode("pr");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not load PR impact";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function postPrComment() {
    const parsedPrNumber = Number(prNumber.trim());
    if (!Number.isFinite(parsedPrNumber)) {
      setError("Load a real PR number before posting a GitHub comment.");
      return;
    }

    setPostingComment(true);
    setError("");
    setCommentMsg("");

    try {
      const res = await fetch(`/api/repos/${repoId}/impact/comment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prNumber: parsedPrNumber }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not post PR comment");

      setCommentMsg(data.updated ? "Trailmap comment updated on the PR." : "Trailmap comment posted to the PR.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not post PR comment";
      setError(message);
    } finally {
      setPostingComment(false);
    }
  }

  return (
    <div style={{ width: "100%", padding: "18px 20px 24px", overflow: "auto", display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={shellStyle}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 420px) minmax(0, 1fr)", gap: "12px", marginBottom: "14px", alignItems: "start" }}>
          <div style={panelStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
              <GitPullRequest size={14} color="#E8754A" />
              <span style={eyebrowStyle}>PR impact preview</span>
            </div>

            <div style={{ display: "inline-flex", background: "rgba(26,15,8,0.03)", border: "1px solid rgba(26,15,8,0.08)", borderRadius: "999px", padding: "4px", marginBottom: "12px" }}>
              <ModeButton active={mode === "snapshot"} onClick={() => switchMode("snapshot")}>Snapshot</ModeButton>
              <ModeButton active={mode === "pr"} onClick={() => switchMode("pr")}>PR</ModeButton>
            </div>

            {mode === "pr" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <label style={labelStyle}>
                  PR number
                  <div style={inputWrapStyle}>
                    <GitPullRequest size={13} color="rgba(26,15,8,0.35)" />
                    <input
                      value={prNumber}
                      onChange={(e) => setPrNumber(e.target.value)}
                      placeholder="123"
                      style={inputStyle}
                    />
                  </div>
                </label>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <label style={labelStyle}>
                    Base commit
                    <div style={inputWrapStyle}>
                      <GitCommitHorizontal size={13} color="rgba(26,15,8,0.35)" />
                      <input
                        value={baseSha}
                        onChange={(e) => setBaseSha(e.target.value)}
                        placeholder="abc1234"
                        style={inputStyle}
                      />
                    </div>
                  </label>

                  <label style={labelStyle}>
                    Head commit
                    <div style={inputWrapStyle}>
                      <GitCommitHorizontal size={13} color="rgba(26,15,8,0.35)" />
                      <input
                        value={headSha}
                        onChange={(e) => setHeadSha(e.target.value)}
                        placeholder="def5678"
                        style={inputStyle}
                      />
                    </div>
                  </label>
                </div>

                <button
                  onClick={loadPrImpact}
                  disabled={loading}
                  style={{
                    border: "none",
                    borderRadius: "12px",
                    background: "#1A0F08",
                    color: "#fff",
                    padding: "11px 14px",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px",
                    fontSize: "0.84rem",
                    cursor: loading ? "wait" : "pointer",
                  }}
                >
                  {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                  Load impact
                </button>

                {prResult && prNumber.trim() && (
                  <button
                    onClick={postPrComment}
                    disabled={postingComment}
                    style={{
                      border: "1px solid rgba(26,15,8,0.08)",
                      borderRadius: "12px",
                      background: "#fff",
                      color: "#1A0F08",
                      padding: "10px 14px",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "8px",
                      fontSize: "0.82rem",
                      cursor: postingComment ? "wait" : "pointer",
                    }}
                  >
                    {postingComment ? <Loader2 size={14} className="animate-spin" /> : <GitPullRequest size={14} />}
                    Post comment to PR
                  </button>
                )}
              </div>
            ) : (
              <div
                style={{
                  borderRadius: "16px",
                  border: "1px solid rgba(26,15,8,0.07)",
                  background: "rgba(26,15,8,0.025)",
                  padding: "14px 14px 12px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Sparkles size={14} color="#E8754A" />
                  <span style={{ fontSize: "0.82rem", color: "#1A0F08", fontWeight: 500 }}>
                    Snapshot impact is already active
                  </span>
                </div>
                <div style={{ fontSize: "0.8rem", color: "rgba(26,15,8,0.46)", lineHeight: 1.55 }}>
                  Trailmap is already using the latest meaningful snapshot diff for this view. Switch to PR mode only when you want to inspect a PR number or a base/head commit pair.
                </div>
              </div>
            )}
          </div>

          <div style={panelStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
              <Sparkles size={14} color="#E8754A" />
              <span style={eyebrowStyle}>Current mode</span>
            </div>
            {mode === "pr" && prResult ? (
              <>
                <div style={{ fontSize: "0.92rem", color: "#1A0F08", lineHeight: 1.55, marginBottom: "8px" }}>
                  Previewing <strong>{prResult.source}</strong>. {prResult.analysis.summary}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  <SmallPill icon={FileCode2} text={`${prResult.analysis.changedFiles.length} changed files`} />
                  <SmallPill icon={GitBranch} text={`${prResult.analysis.touchedServices.length} touched services`} />
                  <SmallPill icon={TriangleAlert} text={`${prResult.analysis.unmatchedFiles.length} unmatched files`} tone="warn" />
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: "0.92rem", color: "#1A0F08", lineHeight: 1.55, marginBottom: "8px" }}>
                  Snapshot mode uses the latest meaningful graph diff. Switch to PR mode to inspect changed files before merge.
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  <SmallPill icon={GitCommitHorizontal} text="Latest meaningful snapshot" />
                  <SmallPill icon={Sparkles} text="No PR input needed" />
                </div>
              </>
            )}

            {error && (
              <div style={{ marginTop: "12px", fontSize: "0.82rem", color: "#B24C3D" }}>
                {error}
              </div>
            )}

            {commentMsg && (
              <div style={{ marginTop: "12px", fontSize: "0.82rem", color: "#1D7A46" }}>
                {commentMsg}
              </div>
            )}
          </div>
        </div>

        {mode === "pr" && prResult ? (
          <PrImpactView analysis={prResult.analysis} />
        ) : (
          <SnapshotImpactView impact={impact} hasPrevious={!!previousGraph} />
        )}
      </div>
    </div>
  );
}

function SnapshotImpactView({
  impact,
  hasPrevious,
}: {
  impact: ReturnType<typeof buildGraphImpactAnalysis> | null;
  hasPrevious: boolean;
}) {
  if (!hasPrevious || !impact) {
    return (
      <EmptyImpactState
        title="Impact needs a comparison point"
        body="Trailmap needs an earlier snapshot before it can estimate what changed services might affect."
      />
    );
  }

  if (impact.impactedServiceCount === 0 && impact.totalRelationshipChanges === 0) {
    return (
      <EmptyImpactState
        title="No service impact surfaced"
        body="The latest structural diff didn't touch any service boundaries, vendors, or data stores in a meaningful way."
      />
    );
  }

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
        <ImpactStat icon={Sparkles} label="Touched services" value={impact.impactedServiceCount} accent="#E8754A" />
        <ImpactStat icon={ArrowRightLeft} label="Relationship shifts" value={impact.totalRelationshipChanges} accent="#2D9CDB" />
        <ImpactStat icon={RadioTower} label="Vendors touched" value={impact.touchedVendorCount} accent="#B57A15" />
        <ImpactStat icon={Database} label="Stores touched" value={impact.touchedDataStoreCount} accent="#7C6FE0" />
      </div>

      <div style={{ marginTop: "14px" }}>
        <CompactBanner icon={Zap} title="Impact read" body={impact.summary} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.45fr) minmax(380px, 1fr)", gap: "12px", marginTop: "14px", alignItems: "start" }}>
        <Panel title="Service impact" icon={GitBranch}>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {impact.touchedServices.slice(0, 8).map((service) => (
              <ServiceImpactRow key={service.id} service={service} />
            ))}
          </div>
        </Panel>

        <div style={{ display: "grid", gap: "12px" }}>
          <Panel title="New dependencies" icon={Sparkles}>
            {impact.addedVendors.length + impact.addedDataStores.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {impact.addedVendors.length > 0 && <Section label="Vendors" items={impact.addedVendors} />}
                {impact.addedDataStores.length > 0 && <Section label="Data stores" items={impact.addedDataStores} />}
              </div>
            ) : (
              <MutedText>No new external dependencies were introduced.</MutedText>
            )}
          </Panel>

          <Panel title="Removed dependencies" icon={ArrowRightLeft}>
            {impact.removedVendors.length + impact.removedDataStores.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {impact.removedVendors.length > 0 && <Section label="Vendors" items={impact.removedVendors} />}
                {impact.removedDataStores.length > 0 && <Section label="Data stores" items={impact.removedDataStores} />}
              </div>
            ) : (
              <MutedText>No vendors or stores dropped out of the map.</MutedText>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

function PrImpactView({ analysis }: { analysis: PrImpactAnalysis }) {
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
        <ImpactStat icon={GitBranch} label="Touched services" value={analysis.touchedServices.length} accent="#E8754A" />
        <ImpactStat icon={FileCode2} label="Changed files" value={analysis.changedFiles.length} accent="#2D9CDB" />
        <ImpactStat icon={RadioTower} label="Vendors downstream" value={analysis.affectedVendors.length} accent="#B57A15" />
        <ImpactStat icon={Database} label="Stores downstream" value={analysis.affectedDataStores.length} accent="#7C6FE0" />
      </div>

      <div style={{ marginTop: "14px" }}>
        <CompactBanner icon={Zap} title="PR read" body={analysis.summary} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.45fr) minmax(380px, 1fr)", gap: "12px", marginTop: "14px", alignItems: "start" }}>
        <Panel title="Touched services" icon={GitBranch}>
          {analysis.touchedServices.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {analysis.touchedServices.map((service) => (
                <div key={service.id} style={itemStyle}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "start" }}>
                    <div>
                      <div style={{ fontSize: "0.86rem", color: "#1A0F08", fontWeight: 500 }}>{service.name}</div>
                      <div style={{ fontSize: "0.74rem", color: "rgba(26,15,8,0.42)", marginTop: "2px" }}>
                        {service.path || "/"} · blast radius {service.blastRadius}
                      </div>
                      <div style={{ fontSize: "0.74rem", color: "rgba(26,15,8,0.46)", marginTop: "6px", lineHeight: 1.45 }}>
                        {service.changedFiles.slice(0, 3).join(", ")}
                        {service.changedFiles.length > 3 ? ` +${service.changedFiles.length - 3} more` : ""}
                      </div>
                    </div>
                    <RiskPill riskLevel={service.riskLevel} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <MutedText>No changed files mapped to known services yet.</MutedText>
          )}
        </Panel>

        <div style={{ display: "grid", gap: "12px" }}>
          <Panel title="Downstream surface" icon={Sparkles}>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {analysis.affectedVendors.length > 0 && <Section label="Vendors" items={analysis.affectedVendors} />}
              {analysis.affectedDataStores.length > 0 && <Section label="Data stores" items={analysis.affectedDataStores} />}
              {analysis.affectedDependents.length > 0 && <Section label="Dependent services" items={analysis.affectedDependents} />}
              {analysis.affectedVendors.length + analysis.affectedDataStores.length + analysis.affectedDependents.length === 0 && (
                <MutedText>No downstream dependency surface was found from the touched services.</MutedText>
              )}
            </div>
          </Panel>

          <Panel title="Unmatched files" icon={TriangleAlert}>
            {analysis.unmatchedFiles.length > 0 ? (
              <Section label="Review" items={analysis.unmatchedFiles} />
            ) : (
              <MutedText>All changed files mapped to known services.</MutedText>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

function ServiceImpactRow({ service }: { service: ImpactServiceItem }) {
  return (
    <div style={itemStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: "0.86rem", color: "#1A0F08", fontWeight: 500 }}>{service.name}</div>
          <div style={{ fontSize: "0.74rem", color: "rgba(26,15,8,0.42)" }}>
            {labelForChangeType(service.changeType)} · blast radius {service.blastRadius}
          </div>
        </div>
        <RiskPill riskLevel={service.riskLevel} />
      </div>
    </div>
  );
}

function ImpactStat({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof Sparkles;
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.82)",
        border: "1px solid rgba(26,15,8,0.08)",
        borderRadius: "16px",
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "0.7rem", color: "rgba(26,15,8,0.38)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</span>
        <Icon size={13} color={accent} />
      </div>
      <span style={{ fontSize: "1.35rem", fontWeight: 600, color: accent }}>{value}</span>
    </div>
  );
}

function CompactBanner({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Zap;
  title: string;
  body: string;
}) {
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
        <Icon size={14} color="#E8754A" />
      </div>
      <div>
        <div style={{ fontSize: "0.78rem", color: "rgba(26,15,8,0.42)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>{title}</div>
        <div style={{ fontSize: "0.92rem", color: "#1A0F08", lineHeight: 1.55 }}>{body}</div>
      </div>
    </div>
  );
}

function Panel({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Sparkles;
  children: React.ReactNode;
}) {
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
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
        <Icon size={13} color="#E8754A" />
        <span style={{ fontSize: "0.74rem", color: "rgba(26,15,8,0.38)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function Section({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <div style={{ fontSize: "0.76rem", color: "rgba(26,15,8,0.34)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {items.map((item) => (
          <div key={`${label}-${item}`} style={itemStyle}>
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        border: "none",
        background: active ? "#FFFFFF" : "transparent",
        color: active ? "#1A0F08" : "rgba(26,15,8,0.5)",
        borderRadius: "999px",
        padding: "8px 12px",
        fontSize: "0.8rem",
        cursor: "pointer",
        boxShadow: active ? "0 1px 4px rgba(26,15,8,0.06)" : "none",
      }}
    >
      {children}
    </button>
  );
}

function SmallPill({
  icon: Icon,
  text,
  tone = "default",
}: {
  icon: typeof Search;
  text: string;
  tone?: "default" | "warn";
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        fontSize: "0.74rem",
        color: tone === "warn" ? "#B57A15" : "rgba(26,15,8,0.55)",
        background: tone === "warn" ? "rgba(181,122,21,0.08)" : "rgba(26,15,8,0.03)",
        border: tone === "warn" ? "1px solid rgba(181,122,21,0.12)" : "1px solid rgba(26,15,8,0.06)",
        borderRadius: "999px",
        padding: "6px 9px",
      }}
    >
      <Icon size={12} />
      {text}
    </span>
  );
}

function RiskPill({ riskLevel }: { riskLevel: "low" | "medium" | "high" }) {
  const tone =
    riskLevel === "high"
      ? { color: "#C0392B", bg: "rgba(192,57,43,0.08)" }
      : riskLevel === "medium"
        ? { color: "#B57A15", bg: "rgba(181,122,21,0.09)" }
        : { color: "#1D7A46", bg: "rgba(29,122,70,0.08)" };

  return (
    <span
      style={{
        fontSize: "0.68rem",
        color: tone.color,
        background: tone.bg,
        borderRadius: "999px",
        padding: "4px 8px",
        textTransform: "uppercase",
      }}
    >
      {riskLevel}
    </span>
  );
}

function EmptyImpactState({ title, body }: { title: string; body: string }) {
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

function MutedText({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: "0.84rem", color: "rgba(26,15,8,0.42)", lineHeight: 1.6 }}>{children}</div>;
}

function labelForChangeType(changeType: ImpactServiceItem["changeType"]): string {
  if (changeType === "added") return "new";
  if (changeType === "removed") return "removed";
  return "rewired";
}

const panelStyle = {
  background: "rgba(255,255,255,0.86)",
  border: "1px solid rgba(26,15,8,0.08)",
  borderRadius: "18px",
  padding: "16px",
} satisfies React.CSSProperties;

const eyebrowStyle = {
  fontSize: "0.74rem",
  color: "rgba(26,15,8,0.38)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
} satisfies React.CSSProperties;

const labelStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  fontSize: "0.76rem",
  color: "rgba(26,15,8,0.42)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
} satisfies React.CSSProperties;

const inputWrapStyle = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  height: "42px",
  background: "#fff",
  border: "1px solid rgba(26,15,8,0.08)",
  borderRadius: "12px",
  padding: "0 12px",
} satisfies React.CSSProperties;

const inputStyle = {
  border: "none",
  outline: "none",
  background: "transparent",
  width: "100%",
  fontSize: "0.86rem",
  color: "#1A0F08",
} satisfies React.CSSProperties;

const itemStyle = {
  borderRadius: "12px",
  border: "1px solid rgba(26,15,8,0.06)",
  background: "rgba(26,15,8,0.02)",
  padding: "10px 12px",
  fontSize: "0.84rem",
  color: "rgba(26,15,8,0.62)",
  lineHeight: 1.45,
} satisfies React.CSSProperties;
