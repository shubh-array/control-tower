import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActionButton } from "../src/components/ActionButton.js";
import { AppShell } from "../src/components/AppShell.js";
import { ConnectionStatus } from "../src/components/ConnectionStatus.js";
import { DataState } from "../src/components/DataState.js";
import { FilterBar } from "../src/components/FilterBar.js";
import { PageHeader } from "../src/components/PageHeader.js";
import { PriorityIndicator } from "../src/components/PriorityIndicator.js";
import { RefreshStatus } from "../src/components/RefreshStatus.js";
import { StatusBadge } from "../src/components/StatusBadge.js";
import { Tabs } from "../src/components/Tabs.js";

describe("shell primitives", () => {
  it("ConnectionStatus exposes a text label and status semantics", () => {
    const html = renderToStaticMarkup(
      createElement(ConnectionStatus, {
        state: "unavailable",
        label: "Connection unavailable",
      }),
    );

    expect(html).toContain('role="status"');
    expect(html).toContain("Connection unavailable");
    expect(html).toContain("connection-status--unavailable");
  });

  it("RefreshStatus exposes refresh tone text", () => {
    const html = renderToStaticMarkup(
      createElement(RefreshStatus, {
        tone: "refreshing",
        label: "Refreshing data",
      }),
    );

    expect(html).toContain('role="status"');
    expect(html).toContain("Refreshing data");
    expect(html).toContain("refresh-status--refreshing");
  });

  it("PageHeader renders an accessible page title and subtitle", () => {
    const html = renderToStaticMarkup(
      createElement(PageHeader, {
        title: "Inbox",
        subtitle: "3 items need attention",
      }),
    );

    expect(html).toContain("<h1");
    expect(html).toContain("Inbox");
    expect(html).toContain("3 items need attention");
  });

  it("DataState renders a loading status message", () => {
    const html = renderToStaticMarkup(
      createElement(DataState, {
        isLoading: true,
        showError: false,
        isStale: false,
        loadingMessage: "Loading inbox",
      }),
    );

    expect(html).toContain('role="status"');
    expect(html).toContain("Loading inbox");
  });

  it("DataState renders an error recovery action", () => {
    const html = renderToStaticMarkup(
      createElement(DataState, {
        isLoading: false,
        showError: true,
        isStale: false,
        errorTitle: "Could not load inbox",
        errorMessage: "network",
        onRetry: () => {},
        children: createElement("p", null, "hidden"),
      }),
    );

    expect(html).toContain("Could not load inbox");
    expect(html).toContain("network");
    expect(html).toContain("Retry");
  });

  it("DataState surfaces stale feedback above ready content", () => {
    const html = renderToStaticMarkup(
      createElement(
        DataState,
        {
          isLoading: false,
          showError: false,
          isStale: true,
          staleMessage: "Showing cached data",
          onRetry: () => {},
        },
        createElement("p", null, "Ready content"),
      ),
    );

    expect(html).toContain('role="status"');
    expect(html).toContain("Showing cached data");
    expect(html).toContain("Ready content");
  });

  it("StatusBadge includes visible text and status semantics", () => {
    const html = renderToStaticMarkup(
      createElement(StatusBadge, { status: "ready" }),
    );

    expect(html).toContain('role="status"');
    expect(html).toContain("Ready");
    expect(html).toContain("status-badge--ready");
  });

  it("PriorityIndicator includes a priority label", () => {
    const html = renderToStaticMarkup(
      createElement(PriorityIndicator, { priority: "high" }),
    );

    expect(html).toContain('aria-label="Priority: HIGH"');
    expect(html).toContain("HIGH");
  });

  it("ActionButton exposes busy progress semantics", () => {
    const html = renderToStaticMarkup(
      createElement(
        ActionButton,
        { busy: true, busyLabel: "Working" },
        "Analyze",
      ),
    );

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Working");
    expect(html).toMatch(/\sdisabled=""/);
  });

  it("FilterBar uses native radio inputs for filter options", () => {
    const html = renderToStaticMarkup(
      createElement(FilterBar, {
        options: [
          { value: "eligible", label: "Eligible" },
          { value: "all", label: "All" },
        ],
        value: "eligible",
        onChange: () => {},
        searchValue: "",
        onSearchChange: () => {},
        searchLabel: "Search coverage",
        searchPlaceholder: "Search",
        groupName: "coverage-filter",
      }),
    );

    expect(html).toContain('type="radio"');
    expect(html).toContain('name="coverage-filter"');
    expect(html).toContain("Eligible");
    expect(html).toContain('aria-label="Search coverage"');
  });

  it("Tabs uses tablist semantics with aria-controls", () => {
    const html = renderToStaticMarkup(
      createElement(Tabs, {
        tabs: [
          { id: "understand", label: "Understand" },
          { id: "verify", label: "Verify" },
        ],
        active: "understand",
        onChange: () => {},
        ariaLabel: "Review tabs",
        tabIdPrefix: "review-tab",
        panelIdPrefix: "review-panel",
      }),
    );

    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('aria-controls="review-panel-understand"');
    expect(html).toContain("Understand");
  });

  it("AppShell renders product identity, nav, and refresh controls", () => {
    const html = renderToStaticMarkup(
      createElement(AppShell, {
        active: "inbox",
        onNavigate: () => {},
        connection: { state: "connected", label: "Connected" },
        refresh: { tone: "idle", label: "Data is current" },
        showUnavailableBanner: false,
        showStaleBanner: false,
        isRefreshing: false,
        onRefresh: () => {},
        children: createElement("p", null, "Body"),
      }),
    );

    expect(html).toContain("Control Tower");
    expect(html).toContain("Inbox");
    expect(html).toContain("Coverage");
    expect(html).toContain("Propose");
    expect(html).not.toContain("Review");
    expect(html).toContain("Connected");
    expect(html).toContain("Refresh");
    expect(html).toContain('class="app-shell__main"');
    expect(html).toContain("Body");
  });
});
