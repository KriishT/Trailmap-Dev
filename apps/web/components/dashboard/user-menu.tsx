"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase";
import { LogOut, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

export function UserMenu({ email, avatarUrl }: { email: string; avatarUrl?: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/");
  }

  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen(!open)} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center" }}>
        {avatarUrl ? (
          <img src={avatarUrl} alt="avatar" style={{ width: "30px", height: "30px", borderRadius: "50%", border: "1.5px solid rgba(26,15,8,0.12)" }} />
        ) : (
          <div style={{ width: "30px", height: "30px", borderRadius: "50%", background: "rgba(232,117,74,0.1)", border: "1.5px solid rgba(232,117,74,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <User size={13} color="#E8754A" />
          </div>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div style={{ position: "fixed", inset: 0, zIndex: 10 }} onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.96 }}
              transition={{ duration: 0.15 }}
              style={{
                position: "absolute", right: 0, top: "40px", zIndex: 20,
                background: "#FFFFFF", border: "1px solid rgba(26,15,8,0.09)",
                borderRadius: "14px", width: "210px",
                boxShadow: "0 8px 32px rgba(26,15,8,0.1)",
                overflow: "hidden",
              }}
            >
              <div style={{ padding: "12px 14px", borderBottom: "1px solid rgba(26,15,8,0.06)" }}>
                <p className="font-body" style={{ fontSize: "0.75rem", color: "rgba(26,15,8,0.4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{email}</p>
              </div>
              <button onClick={signOut} style={{
                width: "100%", display: "flex", alignItems: "center", gap: "8px",
                padding: "11px 14px", background: "none", border: "none", cursor: "pointer",
                fontSize: "0.85rem", color: "rgba(26,15,8,0.5)", fontFamily: "var(--font-body)",
              }}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(26,15,8,0.04)"; e.currentTarget.style.color = "#1A0F08"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "rgba(26,15,8,0.5)"; }}
              >
                <LogOut size={13} /> Sign out
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
