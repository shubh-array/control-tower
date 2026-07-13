# Control Tower UX — Inbox + Review Redesign

**Date:** 2026-07-13  
**Status:** Approved for implementation planning  
**Audience:** Implementation agents and the operating principal engineer  
**Scope:** Full information-architecture and visual redesign of the Phase 1 local UI so the product cuts noise, surfaces critical attention, and makes delegated agent review easy to execute. Backend policy semantics, discovery, publication guards, and Cursor harness contracts are unchanged unless a UI presentation need requires deriving display state from existing fields.

---

## 1. Summary

Control Tower’s Phase 1 backend already separates **deterministic coverage** from **agentic advice**. The current UI does not: Focus Queue, All Tracked, and Workbench present as peer prototype screens, empty states strand the operator, and agent recommendations are nearly invisible.

This redesign adopts an **Inbox + Review** model:

- **Inbox** is home: advisor-ranked triage with state-driven CTAs.
- **Review** is a full-page Workbench entered only when a draft is ready.
- **Coverage** is the demoted All Tracked audit surface.
- **Propose** remains governed profile/policy change proposals.

Visual direction: **calm focus with high-quality styling** — warm, deliberate, not generic AI-SaaS chrome.

---

## 2. Goals and non-goals

### Goals

1. Optimize for a continuous morning loop: **triage → analyze → review → publish**.
2. Cut default noise: home shows actionable attention; full inventory is opt-in.
3. Make agent recommendations the loudest secondary signal on Inbox rows (advisor-led ordering).
4. Eliminate dead ends (especially “No draft available for this job” with no Back/CTA).
5. Raise visual quality to an intentional product shell with shared components and tokens.

### Non-goals

- Phase 2 delivery intelligence, briefings, natural-language command bar.
- Autonomous publish, approve, request-changes, or merge.
- Mobile-first layouts.
- Changing eligibility, priority, or auto-analyze **policy semantics**.
- Replacing Cursor as the AI harness.
- Letting agents hide deterministic coverage or authorize publication.

---

## 3. Product decisions (locked)

| Decision | Choice |
|----------|--------|
| Primary job | Continuous loop: triage → review → publish |
| Redesign depth | Full IA + visual redesign |
| All Tracked | Secondary **Coverage** audit (not peer primary home) |
| Workbench placement | Hybrid: Inbox for triage; full-page Review only when draft ready |
| Advisor prominence | Advisor-led default ordering on Inbox |
| Visual tone | Calm focus + high-quality styling |

---

## 4. Information architecture

### 4.1 Surfaces

| Surface | Nav | Role |
|---------|-----|------|
| **Inbox** | Primary (home) | Advisor-ranked attention; triage + Analyze; entry to Review when ready |
| **Review** | Not top-nav | Full-page Workbench for draft understand / verify / act |
| **Coverage** | Primary secondary | Deterministic inventory / eligibility audit (former All Tracked) |
| **Propose** | Primary secondary | Governed learning proposals |

### 4.2 Invariants preserved

1. Coverage remains complete and deterministic; agents cannot hide tracked PRs.
2. Advisor may reorder and recommend; it must not change eligibility or auto-analyze.
3. Publication remains human-gated; shadow vs gated mode behavior unchanged.
4. Failures stay visible; items are not removed from queues because of agent/connector failure.

---

## 5. Inbox (home)

### 5.1 Layout

- Page title **Inbox** with a short subtitle: count needing attention + “ordered by advisor relevance & risk”.
- Single vertical list of attention rows (default).
- Optional secondary control: **Group by Now / Next / Monitor** (deterministic lanes) for operators who want lane grouping without making lanes the default.

### 5.2 Default ordering

1. Advisor relevance (critical → low → unknown).
2. Advisor risk (critical → low → unknown).
3. Deterministic tie-break (existing priority + `updatedAt` logic).

When advisor results are missing for an item, that item sorts after advised items using deterministic order. UI copy: quiet **“No advisor yet”** — never a lone `-` badge.

### 5.3 Row content

Each row shows:

- **Status chip:** `NEEDS ANALYSIS` | `ANALYZING` | `READY` | `WAITING` (and failure variant as needed).
- **Identity:** `repo#PR` (monospace) + title.
- **Risk / request hints:** e.g. High risk, Explicit request (restrained, not pill spam).
- **Advisor note:** one short recommendation line.
- **Eligibility one-liner:** summarized reason (explicit request / path / author) — never repeated per-file reason stacks.
- **Primary CTA** (exactly one when applicable) + optional quiet secondary (e.g. Defer if implemented; otherwise omit).

### 5.4 State → CTA mapping

| State | Primary CTA | Notes |
|-------|-------------|--------|
| Needs analysis | **Analyze** | Enqueues analysis; row becomes Analyzing |
| Analyzing | None (progress) | Do not offer Open Review |
| Ready | **Open Review** | Only when a draft exists for the job |
| Waiting | None | Visually muted |
| Failed analysis | **Retry** | Show brief error note |

**Hard rule:** Do not navigate to Review unless a draft is available. This removes the blank Workbench dead-end.

### 5.5 Derive display state

Prefer deriving chips from existing API fields (`attentionState`, job presence, draft presence, advisor result) rather than new backend concepts. Add API fields only if derivation is ambiguous.

---

## 6. Review (full-page Workbench)

### 6.1 Entry and chrome

- Entered from Inbox **Open Review** when status is Ready.
- Always show: **← Inbox**, `repo#PR`, title, author, priority, advisor one-liner.
- Tabs retain purpose: **Understand** · **Verify** · **Act**.

### 6.2 Tab content

- **Understand:** intent, implementation, checks, unknowns; coverage warning when applicable.
- **Verify:** observations and findings with provenance; severity hierarchy preserved.
- **Act:** disposition controls, per-operation Approve & Publish (no batch approval), Retry Analysis, visible publication results; shadow mode clearly labeled.

### 6.3 Empty / invalid Review

If Review loads without a draft (deep link, race, stale job):

- Never render only “No draft available for this job.”
- Show: context chrome + reason + **Analyze** or **Retry** + **Back to Inbox**.

---

## 7. Coverage (audit)

### 7.1 Role

Secondary surface for “am I missing something?” and policy debugging. Not the daily home.

### 7.2 Defaults and filters

- Default filter: **Eligible only**.
- Toggles: Eligible · Ineligible · All.
- Search by PR id / title / author.

### 7.3 Table presentation

- Columns: PR · Title · Author · Priority · Why · Action.
- **Why** is a single deduped summary (e.g. `eligible path · sdk/**` or `explicit review request`), not N repeated reason lines.
- Sparse columns (Advisor, Updated) omitted from default or available via row expand — not nine equally weighted empty columns.
- **Analyze** remains; after click, show queued/running feedback on the row.

---

## 8. Visual system

### 8.1 Direction

Calm focus, high craft:

- Canvas: warm off-white (`#faf9f7`); cards white; hairline `#e8e6e1`.
- Ink: `#1a1a1a`; secondary `#6b6760`; muted `#8a8680`.
- Primary actions: charcoal fills (not purple/blue gradients).
- Semantic color used sparingly (risk text, success text, error banners).
- Typography: one distinctive UI sans (implementation picks Geist, IBM Plex Sans, or equivalent already acceptable to the repo); monospace only for `repo#PR`.
- Radius ~10px; soft elevation; generous but intentional whitespace.

### 8.2 Anti-patterns

- Purple gradients, glow, rounded-full pill clusters.
- Dashboard stat strips on Inbox.
- Empty `-` advisor badges.
- Prototype inline-style inconsistency across routes.

### 8.3 Shared components

Introduce small presentational components used across routes:

- `StatusChip`
- `ReasonLine` (deduped eligibility/exclusion)
- `AdvisorNote`
- `PrimaryButton` / quiet secondary control
- `EmptyState` (title, body, CTA)
- Shell `AppHeader` with Inbox / Coverage / Propose

Replace ad-hoc inline styles with a token stylesheet or CSS modules under `client/src/`. No new external design-system package required.

### 8.4 Motion

Minimal: subtle list reorder when advisor order applies; progress pulse while Analyzing. No decorative motion.

---

## 9. Error handling and system feedback

| Condition | UI behavior |
|-----------|-------------|
| Analyze fails | Row returns to Needs Analysis / Failed; error note + Retry |
| Advisor unavailable | Deterministic order; “No advisor yet” |
| Publish fails | Per-op failure result remains visible on Act |
| API / daemon unreachable | Shell-level banner with retry; do not blank the page |
| Session/auth cookie issues | Existing API error surfacing; actionable copy where possible |

---

## 10. Testing

Client-focused acceptance:

1. Ready gating: Open Review not offered / not navigable without draft.
2. Eligibility reason dedupe in Coverage (and Inbox one-liner).
3. Coverage default filter is Eligible only.
4. Review empty fallback shows Back + CTA (never orphan message).
5. Advisor-led sort matches existing advisor-order rules when results exist.
6. Visual shell: Inbox is default route; Coverage and Propose reachable; Review not in top nav.

Prefer extending existing client tests / lightweight component tests. Backend contract tests unchanged unless a derived field is added.

---

## 11. Success criteria

1. Operator can complete **Inbox → Analyze (if needed) → Open Review → Act** without dead ends.
2. Default noise is lower: Inbox is actionable; Coverage is opt-in audit.
3. Advisor recommendations are visible and drive default order.
4. UI reads as intentional calm product craft, not Phase-1 scaffolding.
5. Phase 1 authority invariants remain intact.

---

## 12. Implementation notes

- Primary touchpoints: `client/src/App.tsx`, `routes/FocusQueue.tsx` (evolve to Inbox), `routes/AllTracked.tsx` (evolve to Coverage), `routes/Workbench.tsx` (Review chrome + empty state), `routes/ProposeChange.tsx` (shell consistency), new shared components + styles.
- Rename user-facing labels (Focus Queue → Inbox, All Tracked → Coverage) without requiring backend route renames in the first slice; API paths may stay stable.
- Do not expand scope into policy engine changes unless display derivation is impossible with current payloads.

---

## 13. Open implementation choices (non-blocking)

These may be decided during planning without revisiting product intent:

1. Exact font package vs system stack with careful metric tuning.
2. Whether “Defer” is a real attention-state action in v1 or omitted until a backend signal exists.
3. Whether Coverage search is client-side filter only (preferred for v1) or API-backed.
