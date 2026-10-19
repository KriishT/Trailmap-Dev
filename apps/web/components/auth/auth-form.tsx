"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Input } from "@trailmap/ui";
import { createSupabaseBrowserClient } from "@/lib/supabase";

/** Sign in or sign up. In local mode there are no real accounts: pick a sample user, or any email address. */
export function AuthForm({ mode, local }: { mode: "sign-in" | "sign-up"; local: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const signUp = mode === "sign-up";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    if (local) {
      const res = await fetch("/api/local/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
      if (!res.ok) {
        setError((await res.json().catch(() => ({}))).error ?? "Could not sign in");
        return setBusy(false);
      }
      window.location.href = "/dashboard";
      return;
    }
    const supabase = createSupabaseBrowserClient();
    const { error: err } = signUp
      ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } })
      : await supabase.auth.signInWithPassword({ email, password });
    if (err) {
      setError(err.message);
      return setBusy(false);
    }
    if (signUp) {
      setError(null);
      setBusy(false);
      setNotice("Check your email to confirm the account.");
      return;
    }
    window.location.href = "/dashboard";
  }

  async function pickSample(user: string) {
    const res = await fetch("/api/local/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ user }) });
    if (res.ok) window.location.href = "/dashboard";
    else setError("Could not sign in");
  }

  async function github() {
    await createSupabaseBrowserClient().auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo: `${window.location.origin}/auth/callback`, scopes: "repo read:org" },
    });
  }

  return (
    <div className="panel auth-card">
      <div className="panel-body stack">
        <h1 style={{ fontSize: "var(--step-2)" }}>{signUp ? "Create an account" : "Sign in"}</h1>
        {local ? (
          <div className="notice">
            <strong>Local sandbox.</strong> Nothing here is real: no real accounts, GitHub or data. Pick a sample user to look around.
            <div className="row" style={{ marginTop: 8 }}>
              <Button size="small" onClick={() => pickSample("kay")}>Kay (owner)</Button>
              <Button size="small" variant="quiet" onClick={() => pickSample("lee")}>Lee (member)</Button>
              <Button size="small" variant="quiet" onClick={() => pickSample("mia")}>Mia (other organisation)</Button>
            </div>
          </div>
        ) : (
          <Button onClick={github}>Continue with GitHub</Button>
        )}
        <form onSubmit={submit} className="stack">
          <Input label="Email address" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          {local ? null : <Input label="Password" type="password" autoComplete={signUp ? "new-password" : "current-password"} required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />}
          {error ? <p className="error-text" role="alert">{error}</p> : null}
          {notice ? <p role="status">{notice}</p> : null}
          <div><Button type="submit" variant="primary" disabled={busy}>{busy ? "Please wait" : signUp ? "Create account" : "Sign in"}</Button></div>
        </form>
        <p className="muted">
          {signUp ? <>Have an account? <Link href="/sign-in">Sign in</Link></> : <>New here? <Link href="/sign-up">Create an account</Link></>}
          {" "}or <Link href="/demo">look at the sample workspace</Link> first.
        </p>
      </div>
    </div>
  );
}
