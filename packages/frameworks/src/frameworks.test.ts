import { describe, expect, it } from "vitest";
import { FORBIDDEN_CLAIMS, FRAMEWORKS, getFramework, listFrameworks, sheetsFor } from "./index";

describe("framework mappings", () => {
  it("loads and validates SOC 2, PCI DSS and DORA", () => {
    expect(FRAMEWORKS.map((f) => f.id).sort()).toEqual(["dora", "pci-dss", "soc2"]);
    expect(listFrameworks()).toContainEqual({ id: "pci-dss", name: "PCI DSS", version: "4.0.1" });
  });

  it("maps PCI DSS 4.0.1 requirements 1.2.3, 1.2.4 and 12.5.2", () => {
    const pci = getFramework("pci")!;
    expect(pci.requirements.map((r) => r.id)).toEqual(["1.2.3", "1.2.4", "12.5.2"]);
    expect(pci.requirements[0]!.produces).toContain("network-diagram");
    expect(pci.requirements[1]!.produces).toContain("data-flow-diagram");
  });

  it("maps the DORA Article 28(3) register assist", () => {
    expect(getFramework("dora")!.requirements[0]).toMatchObject({ id: "Art28(3)" });
    expect(getFramework("dora")!.requirements[0]!.produces).toContain("dora-register-assist");
  });

  it("resolves aliases and ignores case", () => {
    expect(getFramework("PCI")?.id).toBe("pci-dss");
    expect(getFramework("soc-2")?.id).toBe("soc2");
    expect(getFramework("nope")).toBeUndefined();
  });

  it("derives the sheets needed for a set of frameworks, in a stable order", () => {
    expect(sheetsFor(["dora"])).toEqual(["vendors"]);
    expect(sheetsFor(["pci", "dora"])).toEqual(["system", "network", "data-flow", "vendors", "revisions"].filter((s) => ["system", "network", "data-flow", "vendors"].includes(s)));
    expect(sheetsFor([])).toEqual([]);
  });

  it("never claims certification or approval, and always says what to verify", () => {
    for (const f of FRAMEWORKS) {
      const text = JSON.stringify(f);
      for (const re of FORBIDDEN_CLAIMS) expect(text, `${f.id} ${re}`).not.toMatch(re);
      expect(f.disclaimer).toMatch(/does not|not a substitute|must be completed/i);
      for (const r of f.requirements) expect(r.verify.length, `${f.id} ${r.id}`).toBeGreaterThan(40);
    }
  });
});
