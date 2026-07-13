// @vitest-environment happy-dom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DraftDetail, FocusQueueRow } from "../src/lib/api.js";
import { Workbench } from "../src/routes/Workbench.js";

const draftFixture: DraftDetail = {
  jobId: "job-1",
  runId: "run-1",
  summary: {
    intent: "Improve inbox readability.",
    implementation: "Add labeled context and disclosures.",
  },
  draftSummary: {
    body: "Summary body",
    observationIndexes: [],
    provenanceRefs: [],
  },
  findings: [
    {
      severity: "high",
      confidence: "medium",
      title: "Missing label",
      rationale: "Users cannot scan advisor state.",
      file: "client/src/routes/FocusQueue.tsx",
      location: { side: "RIGHT", line: 12, startSide: null, startLine: null },
      draftComment: "",
      observationIndexes: [],
    },
  ],
  observations: [
    {
      type: "risk",
      statement: "Advisor text is ambiguous.",
      provenanceRefs: ["obs-1"],
    },
  ],
  checks: [{ name: "typecheck", status: "pass", provenanceRef: "check-1" }],
  coverage: {
    mode: "remote",
    sourceTreeInspected: false,
    diffFiltered: true,
    omittedProtectedPaths: [],
    missingCoverage: ["src/missing.ts"],
  },
  unknowns: ["Whether owners share basenames"],
  recommendedDisposition: "comment",
  validatedProvenance: [{ ref: "prov-1" }],
  operationPlan: null,
};

function queueItem(overrides: Partial<FocusQueueRow> = {}): FocusQueueRow {
  return {
    jobId: "job-1",
    repositoryKey: "widgets",
    repository: "acme-corp/widgets",
    prNumber: 42,
    title: "Improve review readability",
    url: "https://github.com/acme-corp/widgets/pull/42",
    author: "dev",
    headSha: "a".repeat(40),
    eligibilityReasons: [],
    exclusionReasons: [],
    priority: "p1",
    priorityReasons: [],
    queueOrder: {
      prioritySortOrdinal: 1,
      explicitRequestSort: 0,
      queueTimestamp: "2026-07-13T10:00:00.000Z",
      normalizedRepositoryIdentity: "widgets",
      prNumber: 42,
    },
    domains: [],
    attentionState: "ready_for_analysis",
    jobState: "draft_ready",
    advisorResult: null,
    discoveredAt: "2026-07-13T09:00:00.000Z",
    updatedAt: "2026-07-13T10:00:00.000Z",
    ...overrides,
  };
}

vi.mock("../src/hooks/useDraftQuery.js", () => ({
  useDraftQuery: () => ({
    surface: {
      displayData: draftFixture,
      isLoading: false,
      isFetching: false,
      isStale: false,
      isError: false,
      error: null,
      showError: false,
      isMissingDraft: false,
    },
  }),
}));

vi.mock("../src/hooks/useJobMutations.js", () => ({
  useAnalyzeMutation: () => ({ mutateAsync: vi.fn() }),
  useRetryMutation: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("../src/hooks/usePublicationMutations.js", () => ({
  useApproveMutation: () => ({ mutateAsync: vi.fn() }),
  usePublishMutation: () => ({ mutateAsync: vi.fn() }),
}));

function renderUi(element: Parameters<Root["render"]>[0]) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return { container, root };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Workbench readability", () => {
  it("renders progressive disclosure sections and labeled finding metadata", () => {
    const { container } = renderUi(
      createElement(Workbench, {
        item: queueItem(),
        onBack: () => {},
      }),
    );

    expect(container.textContent).toContain("acme-corp/widgets#42");

    const understandPanel = container.querySelector("#review-panel-understand");
    expect(understandPanel?.querySelector("details")).not.toBeNull();
    expect(understandPanel?.textContent).toContain("Checks (1)");
    expect(understandPanel?.textContent).toContain("Unknowns (1)");
    expect(understandPanel?.textContent).toContain("Coverage & limitations");

    const verifyTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ).find((tab) => tab.textContent === "Verify");
    expect(verifyTab).toBeDefined();

    act(() => {
      verifyTab?.click();
    });

    const verifyPanel = container.querySelector("#review-panel-verify");
    expect(verifyPanel?.querySelector("details")).not.toBeNull();
    expect(verifyPanel?.textContent).toContain("Observations (1)");

    const labels = Array.from(
      verifyPanel?.querySelectorAll("dt") ?? [],
    ).map((node) => node.textContent);
    expect(labels).toContain("Severity");
    expect(labels).toContain("Confidence");
    expect(labels).toContain("Source");
    expect(verifyPanel?.textContent).toContain("high");
    expect(verifyPanel?.textContent).toContain("medium");
    expect(verifyPanel?.textContent).toContain(
      "client/src/routes/FocusQueue.tsx:12",
    );
  });
});
