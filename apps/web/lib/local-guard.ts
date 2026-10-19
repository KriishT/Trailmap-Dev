import { NextResponse } from "next/server";
import { isLocalMode } from "./local-mode";

/** Local-only routes do not exist outside local mode. Returns a 404 response to hand back, or null to continue. */
export function notLocal(): NextResponse | null {
  let local = false;
  try {
    local = isLocalMode();
  } catch {
    local = false; // production with TRAILMAP_LOCAL=1: behave as if the route does not exist
  }
  return local ? null : NextResponse.json({ error: "Not found" }, { status: 404 });
}
