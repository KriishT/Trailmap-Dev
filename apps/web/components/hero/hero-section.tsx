"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowRight, GitBranch, Zap, Shield } from "lucide-react";

const ArchitectureGraph = dynamic(
  () => import("./architecture-graph").then((m) => m.ArchitectureGraph),
  { ssr: false }
);

export function HeroSection({ isSignedIn }: { isSignedIn: boolean }) {
  return (
    <div style={{ background: "#FAF8F5", minHeight: "100vh" }}>

      {/* Nav */}
      <nav style={{ borderBottom: "1px solid rgba(26,15,8,0.07)" }}
        className="flex items-center justify-between px-8 py-4">
        <div className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#E8754A" strokeWidth="2.5">
            <path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" />
          </svg>
          <span className="font-body font-semibold text-sm" style={{ color: "#1A0F08" }}>Trailmap</span>
        </div>
        <div className="flex items-center gap-2">
          {isSignedIn ? (
            <Link href="/dashboard" className="btn-primary">Dashboard</Link>
          ) : (
            <>
              <Link href="/sign-in" className="btn-outline" style={{ padding: "9px 18px" }}>Sign in</Link>
              <Link href="/sign-up" className="btn-primary">Start free <ArrowRight size={13} /></Link>
            </>
          )}
        </div>
      </nav>

      {/* Hero */}
      <div
        className="flex items-center"
        style={{
          minHeight: "calc(100vh - 57px)",
          padding: "0 48px",
          gap: "48px",
          maxWidth: "1280px",
          margin: "0 auto",
        }}
      >
        {/* LEFT — text */}
        <div style={{ flex: "0 0 44%", paddingRight: "8px" }}>
          <motion.div
            initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.1 }}
            style={{ marginBottom: "18px" }}
          >
            <span className="tag">Open source · Free · No SDK</span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.2 }}
            className="font-display"
            style={{
              fontSize: "clamp(2.8rem, 4.5vw, 4.6rem)",
              lineHeight: 1.06,
              color: "#1A0F08",
              fontWeight: 700,
              marginBottom: "18px",
              letterSpacing: "-0.025em",
            }}
          >
            Architecture maps<br />
            that{" "}
            <em style={{ color: "#E8754A", fontStyle: "italic", fontWeight: 400 }}>never lie</em>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.32 }}
            className="font-body"
            style={{
              fontSize: "0.975rem",
              lineHeight: 1.72,
              color: "rgba(26,15,8,0.48)",
              marginBottom: "28px",
              maxWidth: "380px",
              fontWeight: 300,
            }}
          >
            Trailmap scans your codebase and generates a live architecture graph —
            automatically updated on every push. Feed it directly into AI coding agents
            so they always know your system.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.42 }}
            style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "40px" }}
          >
            <Link href="/sign-up" className="btn-primary">
              Get started free <ArrowRight size={13} />
            </Link>
            <code
              className="font-body"
              style={{
                fontSize: "0.78rem",
                padding: "11px 16px",
                borderRadius: "100px",
                background: "rgba(26,15,8,0.05)",
                border: "1px solid rgba(26,15,8,0.08)",
                color: "rgba(26,15,8,0.4)",
                letterSpacing: "0.01em",
              }}
            >
              npx trailmap scan .
            </code>
          </motion.div>

          {/* Stats */}
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            transition={{ duration: 0.45, delay: 0.55 }}
            style={{
              display: "flex", gap: "28px",
              paddingTop: "24px",
              borderTop: "1px solid rgba(26,15,8,0.07)",
            }}
          >
            {[
              { val: "6+", label: "Languages" },
              { val: "< 5 min", label: "First map" },
              { val: "100%", label: "Deterministic" },
            ].map((s) => (
              <div key={s.label}>
                <div className="font-display" style={{ fontSize: "1.4rem", fontWeight: 600, color: "#E8754A", letterSpacing: "-0.02em" }}>
                  {s.val}
                </div>
                <div className="font-body" style={{ fontSize: "0.68rem", color: "rgba(26,15,8,0.32)", letterSpacing: "0.08em", textTransform: "uppercase", marginTop: "2px" }}>
                  {s.label}
                </div>
              </div>
            ))}
          </motion.div>
        </div>

        {/* RIGHT — product preview */}
        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, delay: 0.3 }}
          style={{
            flex: 1,
            height: "520px",
            background: "#FFFFFF",
            border: "1px solid rgba(26,15,8,0.09)",
            borderRadius: "20px",
            overflow: "hidden",
            boxShadow: "0 8px 40px rgba(26,15,8,0.1), 0 1px 2px rgba(26,15,8,0.06)",
            position: "relative",
          }}
        >
          {/* Warm orange glow behind graph */}
          <div style={{
            position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none",
            background: "radial-gradient(ellipse 60% 50% at 55% 50%, rgba(232,117,74,0.07) 0%, transparent 70%)",
          }} />
          <ArchitectureGraph />
        </motion.div>
      </div>

      {/* Feature strip */}
      <div style={{ borderTop: "1px solid rgba(26,15,8,0.07)" }}>
        <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "32px 48px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "14px" }}>
            {[
              { icon: GitBranch, title: "Static analysis", body: "Parses imports, docker-compose, k8s, and CI configs. Zero LLM, zero hallucination." },
              { icon: Zap,       title: "AI agent context", body: "MCP server gives Cursor and Claude Code your live graph before they write a single line." },
              { icon: Shield,    title: "5-minute setup",  body: "Install the GitHub App. Maps auto-update on every merge to main." },
            ].map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.07 }}
                style={{
                  background: "rgba(255,255,255,0.8)",
                  border: "1px solid rgba(26,15,8,0.07)",
                  borderRadius: "16px",
                  padding: "20px 22px",
                }}
              >
                <div style={{
                  width: "30px", height: "30px", borderRadius: "9px", marginBottom: "12px",
                  background: "rgba(232,117,74,0.1)", border: "1px solid rgba(232,117,74,0.18)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <f.icon size={13} color="#E8754A" />
                </div>
                <h3 className="font-body" style={{ fontSize: "0.83rem", fontWeight: 600, color: "#1A0F08", marginBottom: "5px" }}>
                  {f.title}
                </h3>
                <p className="font-body" style={{ fontSize: "0.78rem", color: "rgba(26,15,8,0.4)", lineHeight: 1.6, fontWeight: 300 }}>
                  {f.body}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
