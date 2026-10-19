import { NextResponse } from "next/server";
import { demoWorkspace } from "@/lib/demo/workspace";
import { parseSceneRequest, renderSheet } from "@/lib/workspace/scene";

/** The same sheet renderer as a real repo, fed with the bundled sample data. Public, read-only. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = parseSceneRequest(body);
  if (!parsed) return NextResponse.json({ error: "Invalid sheet request" }, { status: 400 });
  return NextResponse.json(await renderSheet(demoWorkspace(typeof body?.rev === "string" ? body.rev : null), parsed));
}
