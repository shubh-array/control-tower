// @vitest-environment happy-dom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDraftQuery } from "../src/hooks/useDraftQuery.js";
import { ApiError, api, type DraftDetail } from "../src/lib/api.js";

const draft: DraftDetail = {
  jobId: "job-1",
  runId: "run-1",
  summary: { intent: "Intent", implementation: "Implementation" },
  draftSummary: { body: "Summary", observationIndexes: [], provenanceRefs: [] },
  findings: [],
  observations: [],
  checks: [],
  coverage: {
    mode: "remote-evidence-only",
    sourceTreeInspected: false,
    diffFiltered: true,
    omittedProtectedPaths: [],
    missingCoverage: [],
  },
  unknowns: [],
  recommendedDisposition: "needs_human",
  validatedProvenance: [],
  operationPlan: null,
};

function DraftProbe() {
  const { surface } = useDraftQuery("job-1");
  return createElement(
    "p",
    null,
    surface.displayData ? "ready" : surface.isMissingDraft ? "missing" : "loading",
  );
}

function renderDraftQuery(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  const root = createRoot(container);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });

  document.body.appendChild(container);
  act(() => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(DraftProbe),
      ),
    );
  });

  return { container, root };
}

function setDocumentVisibility(value: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  setDocumentVisibility("visible");
  document.body.innerHTML = "";
});

describe("useDraftQuery polling", () => {
  it("retries a missing draft after three seconds and stops after it loads", async () => {
    vi.useFakeTimers();
    const getDraft = vi
      .spyOn(api, "getDraft")
      .mockRejectedValueOnce(new ApiError(404, "Not found"))
      .mockResolvedValueOnce(draft);
    const { container, root } = renderDraftQuery();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getDraft).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe("missing");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getDraft).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(getDraft).toHaveBeenCalledTimes(2);
    act(() => root.unmount());
  });

  it("does not schedule missing-draft retries for a hidden document", async () => {
    vi.useFakeTimers();
    setDocumentVisibility("hidden");
    const getDraft = vi
      .spyOn(api, "getDraft")
      .mockRejectedValue(new ApiError(404, "Not found"));
    const { root } = renderDraftQuery();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getDraft).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(getDraft).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });
});
