"use client";

import { Share2, Check, Copy } from "lucide-react";
import { useState } from "react";
import { motion } from "framer-motion";

export function ShareButton({ snapshotId }: { snapshotId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "copied">("idle");
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  async function handleShare() {
    if (shareUrl) {
      await navigator.clipboard.writeText(shareUrl);
      setState("copied");
      setTimeout(() => setState("idle"), 2000);
      return;
    }
    setState("loading");
    try {
      const res = await fetch("/api/maps/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshotId }),
      });
      const data = await res.json();
      const url = `${window.location.origin}/map/${data.slug}`;
      setShareUrl(url);
      await navigator.clipboard.writeText(url);
      setState("copied");
      setTimeout(() => setState("idle"), 2000);
    } catch { setState("idle"); }
  }

  return (
    <motion.button onClick={handleShare} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
      className="btn-cyber inline-flex items-center gap-1.5 text-xs font-body px-3.5 py-1.5 rounded-lg transition-all"
      style={{
        background: state === "copied" ? "rgba(255,176,133,0.1)" : "rgba(255,255,255,0.04)",
        border: state === "copied" ? "1px solid rgba(255,176,133,0.4)" : "1px solid rgba(255,255,255,0.08)",
        color: state === "copied" ? "#FFB085" : "rgba(255,255,255,0.4)",
      }}>
      {state === "copied" ? <><Check size={11} /> Copied</> : shareUrl ? <><Copy size={11} /> Copy link</> : <><Share2 size={11} /> Share</>}
    </motion.button>
  );
}

