import { describe, expect, it } from "vitest";
import { extractTickets } from "../../src/tickets/extract.js";
import type { TicketExtractor } from "../../src/config/load.js";

describe("extractTickets", () => {
  it("extracts ticket identifiers from configured PR metadata sources", () => {
    const extractors: TicketExtractor[] = [
      {
        id: "array-ticket",
        sources: ["title", "body", "branch"],
        pattern: "ARR-\\d+",
      },
    ];

    const tickets = extractTickets(extractors, {
      title: "ARR-101: add discovery checkpoints",
      body: "Depends on ARR-102 before rollout.",
      headRef: "feature/ARR-103-poll-loop",
    });

    expect(tickets).toEqual([
      { extractorId: "array-ticket", identifier: "ARR-101", source: "title" },
      { extractorId: "array-ticket", identifier: "ARR-102", source: "body" },
      { extractorId: "array-ticket", identifier: "ARR-103", source: "branch" },
    ]);
  });

  it("deduplicates repeated matches for the same extractor", () => {
    const extractors: TicketExtractor[] = [
      {
        id: "array-ticket",
        sources: ["title", "body", "branch"],
        pattern: "ARR-\\d+",
      },
    ];

    const tickets = extractTickets(extractors, {
      title: "ARR-101 fix",
      body: "Relates to ARR-101",
      headRef: "feature/ARR-101-deduplicate",
    });

    expect(tickets).toEqual([
      { extractorId: "array-ticket", identifier: "ARR-101", source: "title" },
    ]);
  });
});
