"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase";
import { motion } from "framer-motion";
import { Github, ArrowRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const supabase = createSupabaseBrowserClient();

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setError(error.message); setLoading(false); }
    else window.location.href = "/dashboard";
  }

  async function handleGitHub() {
    await supabase.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo: `${window.location.origin}/auth/callback`, scopes: "repo read:org" },
    });
  }

  return (
    <div style={{ minHeight: "100vh", background: "#FAF8F5", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
      <motion.div
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        style={{ width: "100%", maxWidth: "380px" }}
      >
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", marginBottom: "32px" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#E8754A" strokeWidth="2.5">
            <path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" />
          </svg>
          <span className="font-body font-semibold text-sm" style={{ color: "#1A0F08" }}>Trailmap</span>
        </div>

        {/* Card */}
        <div style={{
          background: "#FFFFFF",
          border: "1px solid rgba(26,15,8,0.09)",
          borderRadius: "20px",
          padding: "28px",
          boxShadow: "0 4px 24px rgba(26,15,8,0.06)",
        }}>
          <h1 className="font-display" style={{ fontSize: "1.6rem", fontWeight: 600, color: "#1A0F08", marginBottom: "4px", letterSpacing: "-0.02em" }}>
            Welcome back
          </h1>
          <p className="font-body" style={{ fontSize: "0.875rem", color: "rgba(26,15,8,0.42)", marginBottom: "24px", fontWeight: 300 }}>
            Sign in to your account
          </p>

          <button onClick={handleGitHub} className="btn-outline" style={{ width: "100%", justifyContent: "center", marginBottom: "20px", borderRadius: "12px", padding: "12px" }}>
            <Github size={15} /> Continue with GitHub
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
            <div style={{ flex: 1, height: "1px", background: "rgba(26,15,8,0.07)" }} />
            <span className="font-body" style={{ fontSize: "0.75rem", color: "rgba(26,15,8,0.3)", letterSpacing: "0.06em" }}>or</span>
            <div style={{ flex: 1, height: "1px", background: "rgba(26,15,8,0.07)" }} />
          </div>

          <form onSubmit={handleEmail} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <input type="email" placeholder="Email address" value={email} onChange={e => setEmail(e.target.value)} required className="input-field" />
            <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required className="input-field" />
            {error && <p className="font-body" style={{ fontSize: "0.8rem", color: "#C0392B", background: "rgba(192,57,43,0.06)", border: "1px solid rgba(192,57,43,0.15)", borderRadius: "10px", padding: "10px 12px" }}>{error}</p>}
            <button type="submit" disabled={loading} className="btn-primary" style={{ width: "100%", justifyContent: "center", borderRadius: "12px", marginTop: "4px", padding: "13px" }}>
              {loading ? "Signing in…" : <><span>Sign in</span> <ArrowRight size={14} /></>}
            </button>
          </form>
        </div>

        <p className="font-body" style={{ textAlign: "center", fontSize: "0.85rem", color: "rgba(26,15,8,0.35)", marginTop: "20px" }}>
          No account?{" "}
          <Link href="/sign-up" style={{ color: "#E8754A", textDecoration: "none", fontWeight: 500 }}>Create one free</Link>
        </p>
      </motion.div>
    </div>
  );
}
