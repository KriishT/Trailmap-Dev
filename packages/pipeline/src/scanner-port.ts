import type { DependencyGraph } from "@trailmap/graph";

export type { DependencyGraph };

/** The slice of scanner options the pipeline sets. */
export interface ScanOptionsLike {
  rootDir: string;
  repoName?: string;
  includeLibraries?: boolean;
}
