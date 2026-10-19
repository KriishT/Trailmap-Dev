import type { Confidence, DataClass, EdgeType, NodeType, DependencyGraph } from "@trailmap/graph";

export type SheetKind = "system" | "data-flow" | "network";

export const SHEET_TITLES: Record<SheetKind, string> = {
  system: "System architecture",
  "data-flow": "Data flow",
  network: "Network and exposure",
};

export interface SheetOptions {
  kind: SheetKind;
  /** Data-flow sheet: show only flows carrying this class. */
  dataClass?: DataClass;
  /** Scopes drawn as hatched regions, and used to mark boundary crossings. */
  scopes?: Array<{ id: string; name: string; nodeIds: string[] }>;
  /** Drift: new or changed elements are marked like a highlighter pass. */
  highlightNodeIds?: string[];
  highlightEdgeIds?: string[];
  /** Include internal library packages (hidden by default). */
  showLibraries?: boolean;
  /** Hide connections below this confidence. */
  minConfidence?: Confidence;
}

export interface Point {
  x: number;
  y: number;
}

export interface SceneNode {
  id: string;
  label: string;
  /** Second line: node type in plain words, plus engine / framework. */
  sublabel: string;
  type: NodeType;
  x: number;
  y: number;
  w: number;
  h: number;
  public: boolean;
  highlighted: boolean;
  /** Data classes seen at a code location. */
  evidenced: DataClass[];
  /** Data classes that are implied but not confirmed. */
  possible: DataClass[];
  scopeId: string | null;
  inAnyScope: boolean;
}

export interface SceneEdge {
  id: string;
  from: string;
  to: string;
  type: EdgeType;
  confidence: Confidence;
  points: Point[];
  evidenced: DataClass[];
  possible: DataClass[];
  crossesScope: boolean;
  highlighted: boolean;
  /** `file:line` of the best piece of evidence, shown as a footnote. */
  cite: string | null;
}

export interface SceneScope {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Scene {
  kind: SheetKind;
  title: string;
  width: number;
  height: number;
  nodes: SceneNode[];
  edges: SceneEdge[];
  scopes: SceneScope[];
  /** Why the sheet is empty, if it is. */
  emptyReason: string | null;
}

export interface SheetSource {
  graph: DependencyGraph;
}
