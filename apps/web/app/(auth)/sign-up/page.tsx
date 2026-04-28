"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase";
import { motion } from "framer-motion";
import { Github, ArrowRight, Mail } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export default function SignUpPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const supabase = createSupabaseBrowserClient();

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } });
    if (error) { setError(error.message); setLoading(false); }
    else setSent(true);
  }

  async function handleGitHub() {
    await supabase.auth.signInWithOAuth({ provider: "github", options: { redirectTo: `${window.location.origin}/auth/callback`, scopes: "repo read:org" } });
  }

  if (sent) {
    return (
      <div style={{ minHeight: "100vh", background: "#FAF8F5", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} style={{
          background: "#FFFFFF", border: "1px solid rgba(26,15,8,0.09)", borderRadius: "20px",
          padding: "40px", textAlign: "center", maxWidth: "340px", boxShadow: "0 4px 24px rgba(26,15,8,0.06)"
        }}>
          <div style={{ width: "48px", height: "48px", background: "rgba(232,117,74,0.1)", border: "1px solid rgba(232,117,74,0.2)", borderRadius: "14px", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <Mail size={20} color="#E8754A" />
          </div>
          <h2 className="font-display" style={{ fontSize: "1.4rem", fontWeight: 600, color: "#1A0F08", marginBottom: "8px", letterSpacing: "-0.02em" }}>Check your inbox</h2>
          <p className="font-body" style={{ fontSize: "0.875rem", color: "rgba(26,15,8,0.42)", lineHeight: 1.6, fontWeight: 300 }}>
            Confirmation link sent to <strong style={{ color: "#E8754A", fontWeight: 500 }}>{email}</strong>
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#FAF8F5", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} style={{ width: "100%", maxWidth: "380px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", marginBottom: "32px" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#E8754A" strokeWidth="2.5">
            <path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" />
          </svg>
          <span className="font-body font-semibold text-sm" style={{ color: "#1A0F08" }}>Trailmap</span>
        </div>
        <div style={{ background: "#FFFFFF", border: "1px solid rgba(26,15,8,0.09)", borderRadius: "20px", padding: "28px", boxShadow: "0 4px 24px rgba(26,15,8,0.06)" }}>
          <h1 className="font-display" style={{ fontSize: "1.6rem", fontWeight: 600, color: "#1A0F08", marginBottom: "4px", letterSpacing: "-0.02em" }}>Get started</h1>
          <p className="font-body" style={{ fontSize: "0.875rem", color: "rgba(26,15,8,0.42)", marginBottom: "24px", fontWeight: 300 }}>Free. No credit card.</p>
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
            <input type="password" placeholder="Password (min 8 characters)" value={password} onChange={e => setPassword(e.target.value)} minLength={8} required className="input-field" />
            {error && <p className="font-body" style={{ fontSize: "0.8rem", color: "#C0392B", background: "rgba(192,57,43,0.06)", border: "1px solid rgba(192,57,43,0.15)", borderRadius: "10px", padding: "10px 12px" }}>{error}</p>}
            <button type="submit" disabled={loading} className="btn-primary" style={{ width: "100%", justifyContent: "center", borderRadius: "12px", marginTop: "4px", padding: "13px" }}>
              {loading ? "Creating…" : <><span>Create account</span> <ArrowRight size={14} /></>}
            </button>
          </form>
        </div>
        <p className="font-body" style={{ textAlign: "center", fontSize: "0.85rem", color: "rgba(26,15,8,0.35)", marginTop: "20px" }}>
          Have an account?{" "}
          <Link href="/sign-in" style={{ color: "#E8754A", textDecoration: "none", fontWeight: 500 }}>Sign in</Link>
        </p>
      </motion.div>
    </div>
  );
}
