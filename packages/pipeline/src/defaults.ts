import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { simpleGit } from "simple-git";
import type { Cloner, TempDir } from "./types.js";

/** Shallow, single-branch clone. Source code lives only in the temp dir. */
export const defaultCloner: Cloner = async ({ url, branch, dir }) => {
  await simpleGit().clone(url, dir, ["--depth=1", "--single-branch", `--branch=${branch}`]);
};

export function defaultTempDir(): TempDir {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trailmap-"));
  return {
    path: dir,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
