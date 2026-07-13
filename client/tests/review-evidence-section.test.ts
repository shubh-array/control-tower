import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { ReviewEvidenceSection } from "../src/components/ReviewEvidenceSection.js";

describe("ReviewEvidenceSection", () => {
  it("renders a labeled native disclosure with child content", () => {
    const markup = renderToStaticMarkup(
      createElement(
        ReviewEvidenceSection,
        {
          title: "Coverage & limitations",
          count: 2,
        },
        createElement("p", null, "Missing source tree"),
      ),
    );

    expect(markup).toContain("<details");
    expect(markup).toContain("Coverage &amp; limitations (2)");
    expect(markup).toContain("Missing source tree");
  });
});
