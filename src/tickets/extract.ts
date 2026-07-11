import type { TicketExtractor } from "../config/load.js";

export interface ExtractedTicket {
  extractorId: string;
  identifier: string;
  source: string;
}

export function extractTickets(
  extractors: TicketExtractor[],
  pr: { title: string; body?: string; headRef?: string },
): ExtractedTicket[] {
  const results: ExtractedTicket[] = [];
  const seen = new Set<string>();

  for (const extractor of extractors) {
    const regex = new RegExp(extractor.pattern, "g");

    for (const source of extractor.sources) {
      let text: string | undefined;
      if (source === "title") {
        text = pr.title;
      } else if (source === "body") {
        text = pr.body;
      } else {
        text = pr.headRef;
      }

      if (!text) {
        continue;
      }

      regex.lastIndex = 0;

      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        const key = `${extractor.id}:${match[0]}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        results.push({
          extractorId: extractor.id,
          identifier: match[0],
          source,
        });
      }
    }
  }

  return results;
}
