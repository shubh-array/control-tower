import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { PrimaryButton } from "../src/components/PrimaryButton.js";
import { AppHeader } from "../src/components/AppHeader.js";

describe("component contracts", () => {
  it("PrimaryButton forwards id and className without injecting type", () => {
    const html = renderToStaticMarkup(
      createElement(
        PrimaryButton,
        { id: "submit-action", className: "extra" },
        "Go",
      ),
    );

    expect(html).toContain('id="submit-action"');
    expect(html).toContain('class="button button--primary extra"');
    expect(html).not.toMatch(/\stype="/);
  });

  it("AppHeader renders primary nav and marks the active page", () => {
    const html = renderToStaticMarkup(
      createElement(AppHeader, {
        active: "coverage",
        onNavigate: () => {},
      }),
    );

    expect(html).toContain("Inbox");
    expect(html).toContain("Coverage");
    expect(html).toContain("Propose");
    expect(html).not.toContain("Review");
    expect(html).toMatch(/aria-current="page">Coverage<\/button>/);
  });
});
