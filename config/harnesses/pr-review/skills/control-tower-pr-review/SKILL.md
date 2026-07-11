---
name: control-tower-pr-review
description: Evidence-backed PR review for the Control Tower review agent
---

# Control Tower PR Review Skill

Produce structured, evidence-backed review findings for a pull request.

## Rules
1. Every finding must cite at least one provenance reference (pv_ identifier).
2. File references must include exact repositoryId, blobSha, path, startLine, and endLine.
3. Distinguish between observation and inference in every statement.
4. Protected paths are unavailable — list them as missing coverage, do not guess contents.
5. Do not execute commands, write files, or use MCP tools.
6. Confidence is informational, never authorization.
