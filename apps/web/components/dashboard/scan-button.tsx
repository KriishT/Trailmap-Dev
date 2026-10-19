"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@trailmap/ui";
import { errorMessage } from "@/lib/errors";

type Phase = "idle" | "queued" | "running" | "done" | "error";

const LABEL: Record<Phase, string> = {
  idle: "",
  queued: "Queued. Waiting for a worker.",
  running: "Scanning. Cloning to a temporary directory, reading the code, then deleting it.",
  done: "Scan complete.",
  error: "",
};

/** Starts a scan and shows live progress. In local mode it also runs the worker once, since no separate worker process exists. */
export function ScanButton({ repoId, label = "Scan now", local = false, autoStart = false, variant = "default" }: { repoId: string; label?: string; local?: boolean; autoStart?: boolean; variant?: "default" | "primary" }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");
  const started = useRef(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  async function run() {
    setPhase("queued");
    setMessage("");
    try {
      const res = await fetch(`/api/repos/${repoId}/scan`, { method: "POST" });
      const body = await res.json();
      if (!res.ok || !body.scanLogId) throw new Error(body.error ?? "The scan could not be started");
      if (local) void fetch("/api/local/run-worker", { method: "POST" });

      const deadline = Date.now() + 5 * 60 * 1000;
      while (alive.current && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1200));
        const poll = await fetch(`/api/scan-logs/${body.scanLogId}`, { cache: "no-store" });
        const data = await poll.json();
        if (!poll.ok || !data.log) throw new Error(data.error ?? "Could not read scan progress");
        const status = data.log.status as string;
        if (status === "completed") {
          setPhase("done");
          router.refresh();
          return;
        }
        if (status === "failed") throw new Error(data.log.error_message ?? "The scan failed");
        setPhase(status === "running" ? "running" : "queued");
      }
      throw new Error("The scan is taking longer than expected. Refresh in a minute.");
    } catch (err) {
      if (!alive.current) return;
      setPhase("error");
      setMessage(errorMessage(err, "The scan failed"));
    }
  }

  useEffect(() => {
    if (autoStart && !started.current) {
      started.current = true;
      void run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  const busy = phase === "queued" || phase === "running";
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div><Button variant={variant} onClick={run} disabled={busy}>{busy ? "Scanning" : phase === "error" ? "Try again" : label}</Button></div>
      <div role="status" aria-live="polite" className="hint">
        {busy || phase === "done" ? LABEL[phase] : null}
        {phase === "error" ? <span className="error-text" role="alert">{message}</span> : null}
      </div>
    </div>
  );
}
