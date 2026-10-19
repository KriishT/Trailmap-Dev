import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultCloner, defaultTempDir } from "./defaults";

const created: string[] = [];
afterEach(() => {
  for (const d of created.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("defaultTempDir", () => {
  it("creates a private directory and removes it, contents included, on cleanup", () => {
    const tmp = defaultTempDir();
    created.push(tmp.path);
    expect(fs.existsSync(tmp.path)).toBe(true);
    expect(path.basename(tmp.path)).toMatch(/^trailmap-/);
    fs.mkdirSync(path.join(tmp.path, "nested"));
    fs.writeFileSync(path.join(tmp.path, "nested", "a.txt"), "x");
    tmp.cleanup();
    expect(fs.existsSync(tmp.path)).toBe(false);
  });

  it("cleanup is safe to call twice", () => {
    const tmp = defaultTempDir();
    tmp.cleanup();
    expect(() => tmp.cleanup()).not.toThrow();
  });
});

describe("defaultCloner", () => {
  it("makes a shallow single-branch clone of a repository", async () => {
    const origin = fs.mkdtempSync(path.join(os.tmpdir(), "trailmap-origin-"));
    created.push(origin);
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd: origin, stdio: "pipe" });
    git("init", "-q", "-b", "main");
    fs.writeFileSync(path.join(origin, "a.txt"), "hello");
    git("add", ".");
    git("commit", "-q", "-m", "first");
    fs.writeFileSync(path.join(origin, "a.txt"), "hello again");
    git("commit", "-q", "-am", "second");

    const target = fs.mkdtempSync(path.join(os.tmpdir(), "trailmap-clone-"));
    created.push(target);
    await defaultCloner({ url: pathToFileUrl(origin), branch: "main", dir: target });

    expect(fs.readFileSync(path.join(target, "a.txt"), "utf8")).toBe("hello again");
    const count = execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: target }).toString().trim();
    expect(count).toBe("1"); // depth 1: no history is fetched
  });

  it("rejects when the repository does not exist", async () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), "trailmap-clone-"));
    created.push(target);
    await expect(defaultCloner({ url: pathToFileUrl(path.join(os.tmpdir(), "does-not-exist-xyz")), branch: "main", dir: target })).rejects.toThrow();
  });
});

function pathToFileUrl(p: string): string {
  return "file:///" + p.replace(/\\/g, "/").replace(/^\//, "");
}
