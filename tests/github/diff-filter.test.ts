import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  StreamingDiffFilter,
  filterDiff,
} from "../../src/github/diff-filter.js";

function loadDiff(name: string): string {
  return readFileSync(new URL(`../fixtures/diffs/${name}`, import.meta.url), "utf-8");
}

const stubCanonicalize = (rawPath: string): string | null => {
  const stripped = rawPath.replace(/^[ab]\//, "");
  if (stripped === "" || stripped.includes("..") || stripped.startsWith("/")) {
    return null;
  }
  return stripped;
};

const stubIsProtected = (path: string): boolean => {
  const basename = path.split("/").pop() ?? "";
  if (basename === ".env") return true;
  if (basename.startsWith(".env.")) return true;
  if (/^deploy\..*\.parameters\.json$/.test(basename)) return true;
  if (basename.endsWith(".pem") || basename.endsWith(".key")) return true;
  return false;
};

describe("filterDiff", () => {
  it("passes through all files when none are protected", () => {
    const diff = loadDiff("allowed-only.diff");
    const result = filterDiff(diff, stubCanonicalize, stubIsProtected);

    expect(result.failed).toBe(false);
    expect(result.files).toHaveLength(2);
    expect(result.files[0]?.path).toBe("src/components/Button.tsx");
    expect(result.files[0]?.patch).toContain("import { cn }");
    expect(result.files[1]?.path).toBe("src/utils/index.ts");
    expect(result.omitted).toHaveLength(0);
  });

  it("omits protected .env file content, retains path metadata", () => {
    const diff = loadDiff("protected-env.diff");
    const result = filterDiff(diff, stubCanonicalize, stubIsProtected);

    expect(result.failed).toBe(false);
    expect(result.files).toHaveLength(0);
    expect(result.omitted).toHaveLength(1);
    expect(result.omitted[0]?.path).toBe(".env");
    expect(result.omitted[0]?.reason).toBe("protected_path_content");
  });

  it("filters mixed allowed/protected, preserving allowed patches only", () => {
    const diff = loadDiff("mixed.diff");
    const result = filterDiff(diff, stubCanonicalize, stubIsProtected);

    expect(result.failed).toBe(false);
    expect(result.files).toHaveLength(2);
    expect(result.files.map((file) => file.path)).toEqual([
      "src/app.ts",
      "src/middleware.ts",
    ]);
    expect(result.omitted).toHaveLength(1);
    expect(result.omitted[0]?.path).toBe(".env.local");

    for (const file of result.files) {
      expect(file.patch).not.toContain("SECRET_KEY");
    }
  });

  it("omits entire rename block when target path is protected", () => {
    const diff = loadDiff("rename-protected.diff");
    const result = filterDiff(diff, stubCanonicalize, stubIsProtected);

    expect(result.failed).toBe(false);
    expect(result.files).toHaveLength(0);
    expect(result.omitted).toHaveLength(1);
    expect(result.omitted[0]?.path).toBe(".env.production");
    expect(result.omitted[0]?.oldPath).toBe(".env.example");
    expect(result.omitted[0]?.reason).toBe("protected_path_content");
  });

  it("fails closed on malformed diff header (diff_filter_failed)", () => {
    const diff = loadDiff("malformed-header.diff");
    const result = filterDiff(diff, stubCanonicalize, stubIsProtected);

    expect(result.failed).toBe(true);
    expect(result.failureReason).toContain("diff_filter_failed");
    expect(result.files).toHaveLength(0);
    expect(result.omitted).toHaveLength(0);
  });

  it("omits binary protected files", () => {
    const diff = loadDiff("binary-protected.diff");
    const result = filterDiff(diff, stubCanonicalize, stubIsProtected);

    expect(result.failed).toBe(false);
    expect(result.files).toHaveLength(0);
    expect(result.omitted).toHaveLength(1);
    expect(result.omitted[0]?.path).toBe("deploy.prod.parameters.json");
  });

  it("fails on uncanonicalizeable path", () => {
    const diff = [
      "diff --git a/../escape b/../escape",
      "index 000..111 100644",
      "--- a/../escape",
      "+++ b/../escape",
      "@@ -1 +1 @@",
      "-old",
      "+new",
    ].join("\n");

    const result = filterDiff(diff, stubCanonicalize, stubIsProtected);
    expect(result.failed).toBe(true);
    expect(result.failureReason).toContain("diff_filter_failed");
  });

  it("handles empty diff", () => {
    const result = filterDiff("", stubCanonicalize, stubIsProtected);
    expect(result.failed).toBe(false);
    expect(result.files).toHaveLength(0);
    expect(result.omitted).toHaveLength(0);
  });
});

describe("StreamingDiffFilter", () => {
  it("matches filterDiff results when fed line-by-line", () => {
    const diff = loadDiff("mixed.diff");
    const batch = filterDiff(diff, stubCanonicalize, stubIsProtected);

    const stream = new StreamingDiffFilter(stubCanonicalize, stubIsProtected);
    for (const line of diff.split("\n")) {
      stream.pushLine(line);
    }
    const streamed = stream.finish();

    expect(streamed).toEqual(batch);
  });

  it("does not retain protected patch content across file blocks", () => {
    const diff = loadDiff("protected-env.diff");
    const stream = new StreamingDiffFilter(stubCanonicalize, stubIsProtected);

    for (const line of diff.split("\n")) {
      stream.pushLine(line);
    }
    const result = stream.finish();

    expect(result.failed).toBe(false);
    expect(result.files).toHaveLength(0);
    expect(result.omitted).toHaveLength(1);
    expect(result.omitted[0]?.path).toBe(".env");
  });
});
