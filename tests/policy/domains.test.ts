import { describe, expect, it } from "vitest";
import { selectDomains } from "../../src/policy/domains.js";

describe("selectDomains", () => {
  it("selects a single matching domain", () => {
    const result = selectDomains({
      changedFiles: ["src/components/App.tsx"],
      domainRules: [{ domain: "frontend", paths: ["src/**"], priority: 100 }],
    });

    expect(result.selected).toHaveLength(1);
    expect(result.selected[0]?.domain).toBe("frontend");
    expect(result.selected[0]?.selectedPriority).toBe(100);
  });

  it("picks highest numeric priority when multiple rules match same domain", () => {
    const result = selectDomains({
      changedFiles: ["src/app.ts", "services/api.ts"],
      domainRules: [
        { domain: "backend", paths: ["services/**"], priority: 50 },
        { domain: "backend", paths: ["src/**"], priority: 200 },
      ],
    });

    expect(result.selected).toHaveLength(1);
    expect(result.selected[0]?.domain).toBe("backend");
    expect(result.selected[0]?.selectedPriority).toBe(200);
  });

  it("breaks same-priority tie with earliest declaration index", () => {
    const result = selectDomains({
      changedFiles: ["src/app.ts", "services/api.ts"],
      domainRules: [
        { domain: "backend", paths: ["services/**"], priority: 100 },
        { domain: "backend", paths: ["src/**"], priority: 100 },
      ],
    });

    expect(result.selected).toHaveLength(1);
    expect(result.selected[0]?.selectedDeclarationIndex).toBe(0);
  });

  it("orders selected domains: descending priority, ascending declaration, name", () => {
    const result = selectDomains({
      changedFiles: ["src/app.ts", "infra/deploy.ts", "services/api.ts"],
      domainRules: [
        { domain: "frontend", paths: ["src/**"], priority: 100 },
        { domain: "infrastructure", paths: ["infra/**"], priority: 50 },
        { domain: "backend", paths: ["services/**"], priority: 200 },
      ],
    });

    expect(result.selected.map((domain) => domain.domain)).toEqual([
      "backend",
      "frontend",
      "infrastructure",
    ]);
  });

  it("enforces max 3 domains", () => {
    const result = selectDomains({
      changedFiles: ["src/a.ts", "services/b.ts", "infra/c.ts", "packages/d.ts"],
      domainRules: [
        { domain: "frontend", paths: ["src/**"], priority: 100 },
        { domain: "backend", paths: ["services/**"], priority: 200 },
        { domain: "infrastructure", paths: ["infra/**"], priority: 50 },
        { domain: "packages", paths: ["packages/**"], priority: 10 },
      ],
    });

    expect(result.selected).toHaveLength(3);
    expect(result.selected.map((domain) => domain.domain)).not.toContain("packages");
  });

  it("selects no domains when no files match", () => {
    const result = selectDomains({
      changedFiles: ["docs/readme.md"],
      domainRules: [{ domain: "frontend", paths: ["src/**"], priority: 100 }],
    });

    expect(result.selected).toHaveLength(0);
  });

  it("preserves all matching reasons per domain", () => {
    const result = selectDomains({
      changedFiles: ["src/a.ts", "src/b.ts"],
      domainRules: [{ domain: "frontend", paths: ["src/**"], priority: 100 }],
    });

    expect(result.selected[0]?.allReasons).toHaveLength(2);
  });

  it("includes matched paths in bytewise ascending order", () => {
    const result = selectDomains({
      changedFiles: ["src/z.ts", "src/a.ts"],
      domainRules: [{ domain: "frontend", paths: ["src/**"], priority: 100 }],
    });

    expect(result.selected[0]?.matchedPaths).toEqual(["src/a.ts", "src/z.ts"]);
  });
});
