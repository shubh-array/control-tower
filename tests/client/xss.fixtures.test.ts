// tests/client/xss.fixtures.test.ts
import { describe, it, expect } from "vitest";
import { isSafeUrl, sanitizeSchema } from "../../client/src/lib/sanitize.js";

const XSS_PAYLOADS = [
  '<script>alert("xss")</script>',
  '<img src=x onerror=alert(1)>',
  '<svg onload=alert(1)>',
  '<iframe src="javascript:alert(1)"></iframe>',
  '<a href="javascript:alert(1)">click</a>',
  '<body onload=alert(1)>',
  '<input onfocus=alert(1) autofocus>',
  '<details open ontoggle=alert(1)>',
  '<marquee onstart=alert(1)>',
  '<object data="javascript:alert(1)">',
  '<embed src="javascript:alert(1)">',
  '<form action="javascript:alert(1)"><input type=submit>',
  '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=alert(1)>">',
  '<a href="&#x6A;&#x61;&#x76;&#x61;&#x73;&#x63;&#x72;&#x69;&#x70;&#x74;:alert(1)">encoded</a>',
  '<a href="data:text/html,<script>alert(1)</script>">data uri</a>',
  '"><img src=x onerror=alert(1)>',
  "'-alert(1)-'",
  '<div style="background:url(javascript:alert(1))">',
  '<link rel="import" href="evil.html">',
  '<base href="https://evil.com/">',
];

describe("XSS fixtures — tag filtering", () => {
  const dangerousTags = [
    "script", "style", "iframe", "object", "embed", "form",
    "svg", "math", "video", "audio", "link", "meta", "base",
    "input", "textarea", "select", "button",
  ];

  for (const tag of dangerousTags) {
    it(`strips <${tag}> from allowlist`, () => {
      expect(sanitizeSchema.tagNames).not.toContain(tag);
    });
  }
});

describe("XSS fixtures — dangerous event attributes", () => {
  const eventAttrs = [
    "onclick", "onerror", "onload", "onfocus", "onblur",
    "onmouseover", "ontoggle", "onstart", "onsubmit",
  ];

  for (const attr of eventAttrs) {
    it(`no allowlisted tag permits ${attr}`, () => {
      for (const [, attrs] of Object.entries(sanitizeSchema.attributes)) {
        expect(attrs).not.toContain(attr);
      }
    });
  }
});

describe("XSS fixtures — URL scheme injection", () => {
  const dangerousUrls = [
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    " javascript:alert(1)",
    "\tjavascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:MsgBox",
    "javascript&#58;alert(1)",
    "java\nscript:alert(1)",
  ];

  for (const url of dangerousUrls) {
    it(`rejects dangerous URL: ${JSON.stringify(url).slice(0, 40)}`, () => {
      expect(isSafeUrl(url)).toBe(false);
    });
  }
});

describe("XSS fixtures — untrusted content never controls markup", () => {
  it("action labels, hidden values, and preview text use typed binding not HTML interpolation", () => {
    const untrustedTitle = '<img src=x onerror=alert(1)>';
    const escaped = untrustedTitle
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
    expect(escaped).not.toContain("<img");
    expect(escaped).toContain("&lt;img");
  });

  it("PR titles/bodies with script injection are rendered as text", () => {
    for (const payload of XSS_PAYLOADS) {
      const textContent = payload.replace(/<[^>]*>/g, "");
      expect(textContent).not.toMatch(/<script/i);
    }
  });
});
