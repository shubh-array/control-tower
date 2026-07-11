
export interface SanitizeSchema {
  tagNames: string[];
  attributes: Record<string, string[]>;
  strip: string[];
}

export const sanitizeSchema: SanitizeSchema = {
  tagNames: [
    "p", "br", "hr",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "strong", "em", "del", "s",
    "code", "pre", "kbd", "samp",
    "blockquote",
    "ul", "ol", "li",
    "dl", "dt", "dd",
    "a",
    "table", "thead", "tbody", "tr", "th", "td",
    "img",
    "details", "summary",
    "sup", "sub",
    "div", "span",
  ],
  attributes: {
    a: ["href"],
    img: ["src", "alt"],
    td: ["align"],
    th: ["align"],
    code: ["className"],
  },
  strip: [
    "script", "style", "iframe", "object", "embed", "form",
    "svg", "math", "video", "audio", "source", "track",
    "input", "textarea", "select", "button",
    "link", "meta", "base", "noscript",
  ],
};

const SAFE_SCHEMES = new Set(["https:", "mailto:"]);

function decodeHtmlEntities(url: string): string {
  return url
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec) =>
      String.fromCharCode(parseInt(dec, 10)),
    );
}

export function isSafeUrl(url: string): boolean {
  const trimmed = url.trim();
  const normalized = decodeHtmlEntities(trimmed);

  if (normalized.startsWith("#") || normalized.startsWith("/")) {
    return true;
  }

  try {
    const parsed = new URL(normalized, "http://localhost");
    if (normalized.includes(":")) {
      return SAFE_SCHEMES.has(parsed.protocol);
    }
    return true;
  } catch {
    return false;
  }
}

export function toRehypeSanitizeSchema() {
  return {
    tagNames: sanitizeSchema.tagNames,
    attributes: {
      ...sanitizeSchema.attributes,
      "*": ["className"],
    },
    strip: sanitizeSchema.strip,
    protocols: {
      href: ["https", "mailto"],
      src: ["https"],
    },
  };
}
