import { scan } from "@trailmap/scanner";
import { NextResponse } from "next/server";

// Dev-only endpoint — scans a local path and returns the graph JSON
export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 403 });
  }

  const { rootDir } = await req.json();
  if (!rootDir || typeof rootDir !== "string") {
    return NextResponse.json({ error: "rootDir required" }, { status: 400 });
  }

  const graph = await scan({ rootDir });
  return NextResponse.json(graph);
}
