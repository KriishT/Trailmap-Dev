import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { simpleGit } from "simple-git";
import type { Cloner, TempDir } from "./types.js";

/**
 * Shallow clone. With `ref` (for example `refs/pull/7/head`) that exact ref is fetched, which is
 * how pull request heads, including ones from forks, are checked out. Source code lives only in
 * the temp dir.
 */
export const defaultCloner: Cloner = async ({ url, branch, dir, ref }) => {
  if (!ref) {
    await simpleGit().clone(url, dir, ["--depth=1", "--single-branch", `--branch=${branch}`]);
    return;
  }
  const git = simpleGit(dir);
  await git.init();
  await git.addRemote("origin", url);
  await git.fetch("origin", ref, { "--depth": 1 });
  await git.checkout("FETCH_HEAD");
};

export function defaultTempDir(): TempDir {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trailmap-"));
  return {
    path: dir,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
