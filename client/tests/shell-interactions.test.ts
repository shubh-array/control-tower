// @vitest-environment happy-dom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "../src/components/AppShell.js";
import { Tabs } from "../src/components/Tabs.js";

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

describe("Tabs keyboard interaction", () => {
  it("moves roving focus with arrow keys and activates on Enter", () => {
    const onChange = vi.fn();
    const { container } = renderUi(
      createElement(Tabs, {
        tabs: [
          { id: "understand", label: "Understand" },
          { id: "verify", label: "Verify" },
          { id: "act", label: "Act" },
        ],
        active: "understand",
        onChange,
        ariaLabel: "Review tabs",
        tabIdPrefix: "review-tab",
        panelIdPrefix: "review-panel",
      }),
    );

    const tabs = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    );
    expect(tabs[0]?.getAttribute("tabindex")).toBe("0");
    expect(tabs[1]?.getAttribute("tabindex")).toBe("-1");
    expect(tabs[0]?.getAttribute("aria-controls")).toBe("review-panel-understand");

    act(() => {
      tabs[0]?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });

    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[1]?.getAttribute("tabindex")).toBe("0");
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      tabs[1]?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(onChange).toHaveBeenCalledWith("verify");
  });
});

describe("AppShell interaction", () => {
  const baseProps = {
    connection: { state: "connected" as const, label: "Connected" },
    refresh: { tone: "idle" as const, label: "Data is current" },
    showUnavailableBanner: false,
    showStaleBanner: false,
    isRefreshing: false,
    children: createElement("p", null, "Body"),
  };

  it("marks inbox as the only primary nav item", () => {
    const onNavigate = vi.fn();
    const { container } = renderUi(
      createElement(AppShell, {
        ...baseProps,
        active: "inbox",
        onNavigate,
        onRefresh: vi.fn(),
      }),
    );

    const navLinks = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button.primary-nav__link"),
    );
    expect(navLinks.map((button) => button.textContent)).toEqual(["Inbox"]);
    expect(
      container.querySelector('button.primary-nav__link[aria-current="page"]')
        ?.textContent,
    ).toBe("Inbox");
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("invokes manual refresh and retry handlers from shell controls", () => {
    const onRefresh = vi.fn();
    const onRetryConnection = vi.fn();
    const onRetryRefresh = vi.fn();
    const { container } = renderUi(
      createElement(AppShell, {
        ...baseProps,
        active: "inbox",
        onNavigate: vi.fn(),
        onRefresh,
        onRetryConnection,
        onRetryRefresh,
        showUnavailableBanner: true,
        showStaleBanner: true,
      }),
    );

    const refreshButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Refresh");
    act(() => {
      refreshButton?.click();
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);

    const retryConnection = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Retry connection");
    act(() => {
      retryConnection?.click();
    });
    expect(onRetryConnection).toHaveBeenCalledTimes(1);

    const retryRefresh = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Retry refresh");
    expect(retryRefresh).toBeUndefined();
  });

  it("shows stale retry when connection is available", () => {
    const onRetryRefresh = vi.fn();
    const { container } = renderUi(
      createElement(AppShell, {
        ...baseProps,
        active: "inbox",
        onNavigate: vi.fn(),
        onRefresh: vi.fn(),
        onRetryRefresh,
        showStaleBanner: true,
      }),
    );

    const retryRefresh = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Retry refresh");
    act(() => {
      retryRefresh?.click();
    });
    expect(onRetryRefresh).toHaveBeenCalledTimes(1);
  });
});
