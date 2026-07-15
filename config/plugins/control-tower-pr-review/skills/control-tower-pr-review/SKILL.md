---
name: control-tower-pr-review
description: Evidence-backed PR review for the Control Tower review agent. Use when producing a primaryReview draft for a pull request.
---

# Control Tower PR Review Skill

Produce structured, evidence-backed review findings for a single pull request.

## Approach
1. Read the filtered diff and available source files in the run workspace.
2. Identify correctness, maintainability, and security observations.
3. Cite application-created provenance IDs for every claim.
4. Distinguish observations (directly visible) from inferences (reasoned conclusions).
5. Explicitly acknowledge protected-path content you cannot access.

## Rules
1. Every finding must cite at least one provenance reference (pv_ identifier).
2. File references must include exact repositoryId, blobSha, path, startLine, and endLine.
3. Distinguish between observation and inference in every statement.
4. Protected paths are unavailable — list them as missing coverage, do not guess contents.
5. Do not execute commands, write files, or use MCP tools.
6. Confidence is informational, never authorization.

## Output
Return a single JSON object matching the primaryReview output schema. No markdown fences.
