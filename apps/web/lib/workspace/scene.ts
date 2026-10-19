import { layoutScene, sceneToSvg, DARK, LIGHT, type SheetKind } from "@trailmap/sheets";
import type { Confidence, DataClass } from "@trailmap/graph";
import type { WorkspaceData } from "./types";

export interface SceneRequest {
  sheet: SheetKind;
  dataClass?: DataClass;
  minConfidence?: Confidence;
  showLibraries?: boolean;
  /** Draw focusable boxes and lines for the workspace. Static pages (landing, shared view) leave this off. */
  interactive?: boolean;
  /** Replaces the saved scopes, so an edit in progress can be previewed before it is saved. */
  scopes?: Array<{ id: string; name: string; nodeIds: string[] }>;
}

export interface SceneResponse {
  svg: { light: string; dark: string };
  width: number;
  height: number;
  empty: string | null;
  nodeCount: number;
  edgeCount: number;
}

const SHEETS = new Set<string>(["system", "data-flow", "network"]);
const CLASSES = new Set<string>(["PII", "PAN", "PHI", "CREDENTIALS"]);
const CONF = new Set<string>(["low", "medium", "high"]);

/** Validate untrusted JSON into a scene request. Returns null when a field is malformed. */
export function parseSceneRequest(body: unknown): SceneRequest | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const sheet = (b.sheet ?? "system") as string;
  if (!SHEETS.has(sheet)) return null;
  if (b.dataClass !== undefined && !CLASSES.has(b.dataClass as string)) return null;
  if (b.minConfidence !== undefined && !CONF.has(b.minConfidence as string)) return null;
  let scopes: SceneRequest["scopes"];
  if (b.scopes !== undefined) {
    if (!Array.isArray(b.scopes) || b.scopes.length > 20) return null;
    scopes = [];
    for (const s of b.scopes as Array<Record<string, unknown>>) {
      if (typeof s?.id !== "string" || typeof s.name !== "string" || !Array.isArray(s.nodeIds) || s.nodeIds.length > 500 || !s.nodeIds.every((x) => typeof x === "string")) return null;
      scopes.push({ id: s.id, name: s.name.slice(0, 80), nodeIds: s.nodeIds as string[] });
    }
  }
  return {
    sheet: sheet as SheetKind,
    dataClass: b.dataClass as DataClass | undefined,
    minConfidence: b.minConfidence as Confidence | undefined,
    showLibraries: b.showLibraries === true,
    scopes,
  };
}

/** Lay a sheet out once and draw it in both themes, so switching theme never needs a round trip. */
export async function renderSheet(data: Pick<WorkspaceData, "effective" | "scopes" | "highlightNodeIds" | "highlightEdgeIds">, req: SceneRequest): Promise<SceneResponse> {
  const scopes = req.scopes ?? data.scopes.map((s) => ({ id: s.id, name: s.name, nodeIds: s.nodeIds }));
  const scene = await layoutScene(data.effective, {
    kind: req.sheet,
    dataClass: req.dataClass,
    minConfidence: req.minConfidence,
    showLibraries: req.showLibraries,
    scopes,
    highlightNodeIds: data.highlightNodeIds,
    highlightEdgeIds: data.highlightEdgeIds,
  });
  const draw = (theme: typeof LIGHT) => sceneToSvg(scene, { theme, interactive: req.interactive !== false, legend: true, idPrefix: `${theme.name}-` });
  return {
    svg: { light: draw(LIGHT), dark: draw(DARK) },
    width: scene.width,
    height: scene.height,
    empty: scene.emptyReason,
    nodeCount: scene.nodes.length,
    edgeCount: scene.edges.length,
  };
}
