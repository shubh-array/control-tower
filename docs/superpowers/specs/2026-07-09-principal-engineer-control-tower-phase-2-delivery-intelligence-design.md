# Principal Engineer Control Tower — Phase 2: Independently Gated Capabilities

**Date:** 2026-07-09  
**Revised:** 2026-07-10  
**Status:** Draft pending final design approval
**Audience:** Implementation agents and principal engineers operating the product locally
**Prerequisite:** Implementation of a selected Phase 2 capability begins only after the revised Phase 1 delegated-review specification is implemented and the Phase 1 gates relevant to that capability have passed.

## 1. Purpose and capability model

Phase 2 defines a menu of independently gated capabilities to build on the Phase 1 control tower after that baseline is delivered:

- **Phase 2A — Advanced and cross-repository review.**
- **Phase 2B — Bot publication.**
- **Phase 2C — Optional delivery-provider intelligence.**
- **Phase 2D — Sandboxed checks.**

There is no required ordering among 2A, 2B, 2C, and 2D after their own Phase 1 dependencies pass. Advanced review and bot publication may proceed independently. Delivery intelligence cannot advance beyond `not_evaluated` until the live planning-data quality gate in section 25 passes. Sandboxed checks cannot advance beyond `not_evaluated` until the concrete-check gate in sections 29–30 passes.

Each capability requires its own implementation plan, branch, schema migrations, feature flags, rollout, evaluation record, and acceptance review. One implementation branch must not combine capabilities. A capability can be deferred or rejected without blocking any other capability, and this specification does not require all capabilities to ship.

Phase 2 health is evaluated per capability, not as aggregate completion: every capability in `gated`, `pilot`, or `accepted` must satisfy the gates and scope for its current canonical identity/evaluation epoch; a selected capability may honestly remain `not_evaluated`, `rejected`, or `deferred`; and an unselected capability remains `disabled`. None of those inactive outcomes makes another capability incomplete.

## 2. Authoritative Phase 1 baseline

The revised Phase 1 specification in this folder is the authoritative baseline contract. Once that baseline is delivered and the relevant Phase 1 gates pass, Phase 2 inherits, without redefining or weakening:

- Deterministic coverage and authority, with agentic judgment and advice.
- The shared organization catalog, portable engineer profile, local machine config, strict schemas, and versioned migrations.
- The application-owned `CanonicalPathMatcher`, canonical path/glob contract, compiled matcher artifact, and protected-path union.
- Feature-grouped organization and engineer harnesses, the exact nine-layer composition order, deterministic review-domain selection, policy snapshots, and complete ordered harness manifests.
- Named model roles, exact doctor validation, no fallback or silent substitution, and role-specific evaluation.
- Streaming protected-diff filtering before every sink, application-created `pv_` provenance IDs, validated repository/blob/path/range file provenance, and explicit missing coverage.
- Control-tower-owned partial mirrors, the authenticated-fetch/credential-free-local boundary, no-checkout administrative worktrees, filtered regular-blob source views, and remote-evidence-only review.
- Pre-context job identities, content-hashed run-input identities, immutable run attempts, guarded state transitions, transactional pointers, restart recovery, and sealed per-run artifacts.
- The bounded Cursor CLI worker pool and the rule that Cursor CLI is the only AI harness.
- Authoritative All Tracked coverage, deterministic Focus Queue order, and advisory-only agent output.
- Safe browser rendering, sanitized Markdown, restrictive CSP, same-origin checks, and single-use action tokens.
- Exact preview and per-action human approval for every external mutation.
- Structured feedback, governed proposals, historical replay, exact preview, explicit adoption, and no silent learning.

Phase 2 implementations reference those delivered contracts directly. If this document and the delivered Phase 1 contract conflict, the stricter safety, provenance, authority, immutability, or credential-isolation rule applies and the Phase 2 implementation is blocked pending a specification correction.

## 3. Capability lifecycle and status reporting

Every capability evaluation has one canonical identity artifact, `capability-evaluation-identity.json`. The application serializes the following versioned object as canonical JSON and assigns `cei_<base32-sha256(canonical bytes)>`:

```json
{
  "identitySchemaVersion": 1,
  "capabilityId": "advanced-review|bot-publication|delivery-intelligence|sandbox-checks",
  "capabilityImplementationVersion": "string",
  "capabilityConfigHash": "string",
  "capabilityScopeHash": "string",
  "enabledModelRoleSpecificationHashes": {
    "roleName": "string"
  },
  "applicableHarnessManifestHashes": {
    "roleName": ["string"]
  },
  "contractSchemaHashes": {
    "schemaLogicalName": "string"
  },
  "safetyContractVersion": "string",
  "safetyContractHash": "string",
  "provenanceFactContractVersion": "string",
  "provenanceFactContractHash": "string",
  "credentialIdentityPermissionStateHashes": {
    "credentialPurpose": "string"
  },
  "capabilityBindingHashes": {
    "bindingLogicalName": "string"
  },
  "migrationSetHash": "string",
  "declaredBaselineEvaluationHash": "string"
}
```

`capabilityConfigHash` covers every applicable shared, profile, and local capability document after canonical validation; `capabilityScopeHash` covers the exact repositories/provider scope or check scope. Role maps contain every role the capability can enable, sorted by role name. The harness map contains the complete distinct gate-manifest hashes materialized from the identity's approved fixed evaluation plan as defined in section 6; live pilot inputs do not mutate this set. Manifest/output/input schema hashes are present in `contractSchemaHashes`. The schema map includes every capability config, run-input, output, database-record, gate-report, and approval schema. Safety and provenance/fact fields bind the inherited application contracts and their content hashes.

`declaredBaselineEvaluationHash` is the content identity of one immutable `declared-baseline-evaluation.json` payload with this closed schema:

```json
{
  "baselineSchemaVersion": 1,
  "baselineKind": "phase1_contract|accepted_capability|external_evidence",
  "baselineId": "stable non-empty string",
  "baselineContractImplementationHash": "string",
  "corpusEvidenceManifestHash": "string",
  "metricDefinitionSchemaHash": "string",
  "acceptedCapabilityBaseline": null
}
```

For `accepted_capability` only, `acceptedCapabilityBaseline` is required and has exactly:

```json
{
  "capabilityIdentity": "cei_already_sealed_prior_identity",
  "acceptanceRecordHash": "string"
}
```

For `phase1_contract` and `external_evidence`, `acceptedCapabilityBaseline` must be null. `baselineContractImplementationHash` binds the immutable delivered Phase 1 contract/implementation manifest for `phase1_contract`, the sealed prior capability contract/implementation manifest for `accepted_capability`, or the approved external-evidence contract for `external_evidence`. `corpusEvidenceManifestHash` binds the immutable Phase 1 evaluation corpus/results manifest, prior accepted-capability evidence manifest, or external CI/manual/provider evidence manifest respectively. `metricDefinitionSchemaHash` binds the exact metric names, formulas, thresholds schema, and comparison semantics used by both sides.

`baselineId` is 1–128 lowercase ASCII characters matching `^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$` and is never reused for different baseline bytes. The application rejects unknown/missing fields, an invalid/reused baseline ID, a kind/binding mismatch, an unresolved or mutable referenced hash, or an accepted-capability record whose identity/acceptance hash does not identify a sealed prior `accepted` epoch. The payload contains no current capability identity, current evaluation/scheduler epoch, current attempt context, current lifecycle state, acceptance pointer, envelope field, or current evaluation output; none of its referenced artifacts may depend on them. A prior accepted-capability identity must already be sealed before this payload is created and its dependency graph must not reach the current candidate, preventing a baseline cycle.

The application canonicalizes the validated payload with the same versioned canonical-JSON implementation used for capability identity and assigns `dbe_<base32-sha256(canonical payload bytes)>`; that exact value is `declaredBaselineEvaluationHash`. It stores the create-once payload at `data/artifacts/baselines/<dbe-hash>/declared-baseline-evaluation.json`, verifies every referenced artifact hash before identity creation, and makes the directory read-only. A baseline payload/reference change creates a new capability identity and follows the section 3 contract-change invalidation before another job starts; baseline evidence is never edited in place.

Credential entries contain only deterministic hashes of verified non-secret identity and permission state: provider/bot/principal login or installation ID, host, allowed repository/scope set, verified permission claims, verification method/result, and current verification-validity state. Logical entries include advanced-review GitHub/source-access identity, bot publisher identity, and delivery-provider identity when applicable. Tokens, token fingerprints, keychain values, verification timestamps, and other secret-derived material are forbidden from the identity hash. Verification timestamps remain audit/status data; crossing the configured freshness boundary changes the non-secret validity state and therefore the hash. `capabilityBindingHashes` is a sorted map over every capability-specific contract, including its approved evaluation/acceptance plan and thresholds; advanced-review triggers/contract groups; bot repositories, identity/canary state, publication mode, and approval settings; delivery provider/adapter settings, extractor bindings, scope, independent data-quality payload hash and approved thresholds; or sandbox catalog, prepared-image verification, CI-gap, limits, and expected-evidence contract. An inapplicable map is empty, never omitted. There is no second or abbreviated acceptance identity elsewhere in this specification.

Before an operator-approved delivery data-quality payload exists, the delivery data-quality logical binding is the hash of canonical `{"bindingSchemaVersion":1,"state":"assessment_pending"}`. This is a fixed non-report binding that permits only the read-only assessment work allowed in `not_evaluated`. Approving the final payload replaces that binding with the payload hash and approved-threshold contract, creating a new canonical delivery identity through section 3 before gate acceptance; no authority carries from the assessment identity.

Any artifact whose hash contributes to the canonical capability identity uses an acyclic payload/envelope contract. Deterministic code first canonicalizes and hashes an immutable payload that explicitly excludes canonical capability identity, evaluation epoch, attempt-context ID, scheduler epoch, lifecycle state, acceptance pointers, and envelope ID/timestamps. The identity may bind only that payload hash. After the resulting identity and active evaluation epoch exist, the application writes a separate immutable envelope that references the payload hash and binds the identity/epoch. An envelope hash never feeds back into the identity that it contains. This pattern applies to delivery reports and, where their hashes are identity inputs, bot canary/permission evidence, prepared-image verification, sandbox CI-gap/evidence contracts, and capability gate/evaluation evidence.

Lifecycle and gate authority are keyed by `(canonical capability-evaluation identity, evaluationEpoch)`. `evaluationEpoch` is a durable, monotonically increasing positive integer stored outside the canonical identity because restarting evaluation does not pretend the contract changed. The first occurrence of an identity starts at epoch 1; if the same content-hashed identity recurs later, it uses the next durable epoch and never restores prior authority. Each epoch has an immutable attempt context:

```text
ceac_<base32-sha256(canonical capability-evaluation identity + evaluationEpoch)>
```

Every gate decision, capability job, recommendation, output, dependent artifact, approval, and status record freezes both values. The separate scheduler epoch remains a transactional lease fence and increments whenever the current identity or evaluation epoch changes.

The only lifecycle states are:

- `disabled`: not selected in local configuration. No capability connector, agent role, publisher, or executor runs. Existing immutable history remains viewable.
- `not_evaluated`: selected for evaluation but one or more prerequisite, doctor, data-quality, concrete-check, corpus, or safety gates have not been accepted. Only explicitly permitted assessment work may run. User-facing claims and actions remain disabled.
- `gated`: all pre-pilot gates for this exact identity and evaluation epoch passed and an operator explicitly approved a bounded shadow or canary scope. No authority exists beyond that recorded scope.
- `pilot`: the bounded live evaluation for the current identity/epoch is active. Outputs and mutations follow the capability-specific autonomy and approval rules. Pilot evidence is accumulated against the declared baseline.
- `accepted`: the exact canonical capability-evaluation identity and evaluation epoch passed its acceptance criteria and an operator explicitly accepted its documented scope.
- `rejected`: an acceptance or safety gate failed for this identity. Runtime activation is disabled. Immutable evidence and reasons remain visible; a materially changed identity may be evaluated separately.
- `deferred`: the operator documented that the capability is not currently needed or lacks a qualifying use case. No runtime activation occurs. Deferral is a valid outcome; evaluation may later restart under the same canonical identity through the explicit transition below.

Transitions are guarded application actions:

| From | To | Cause | Identity behavior | Epoch/authority behavior |
| --- | --- | --- | --- | --- |
| `disabled` | `not_evaluated` | Explicit human selection | Compute/current canonical identity | Create epoch 1 or the next durable epoch if that identity has history; no prior authority carries |
| `deferred` | `not_evaluated` | Exact preview plus single-use human approval to resume | Canonical identity must remain exactly equal | Archive prior gate/evaluation evidence, clear all gate/acceptance/pilot authority, increment evaluation and scheduler epochs, create a new attempt context, and require every gate from the beginning |
| `not_evaluated` | `gated` | Required gates plus explicit human approval | Same identity | Same epoch |
| `gated` | `pilot` | Explicit bounded-pilot approval | Same identity | Same epoch |
| `pilot` | `accepted` | Acceptance gates plus explicit human approval | Same identity | Same epoch |
| `gated`, `pilot`, or `accepted` | `not_evaluated` | Deterministic loss of a continuing gate | Same identity unless a separate contract change also occurred | Atomically archive gate evidence, clear shadow/pilot/acceptance authority, increment evaluation and scheduler epochs, and require every gate from the beginning |
| Any active state | `disabled`, `rejected`, or `deferred` | Explicit disable/rejection/deferral or specified hard gate failure | Same current identity | Clear authority; immutable history remains |

`deferred -> not_evaluated` is invalid if canonical identity inputs changed; the contract-change flow below must create the new identity instead. No agent may select a capability, resume a deferred evaluation, change lifecycle state, approve a gate, or hide an archived/rejected/deferred record.

For same-identity gate loss, the gate monitor first fences new leases and authority-bearing reads/actions, then atomically archives the old epoch's gate authority/evidence, clears gated-shadow/pilot/acceptance pointers, increments evaluation and scheduler epochs, creates the next attempt context in `not_evaluated`, and commits the gate-loss reason. Already created jobs may seal under their old epoch unless a capability-specific revocation rule is stricter, but cannot remain current, satisfy a new gate, or expose authority-bearing output. The capability-specific invalidation hook runs in that transaction before any further external action or operational claim.

Before creating any new capability job, the scheduler recomputes the canonical identity from current validated inputs and compares it with the current lifecycle pointer. Any contract-affecting change creates a different identity. In one SQLite transaction, the application:

1. Prevents new leases for that capability.
2. Creates the new identity's lifecycle record in `not_evaluated` with evaluation epoch 1 when unseen, or the next durable epoch when that canonical identity has prior history, and its immutable attempt context.
3. Moves only that capability's current pointer to the new record and records the prior `gated`, `pilot`, or `accepted` record as superseded by it.
4. Invalidates that capability's gated-shadow/pilot/acceptance authorization pointers and commits a capability scheduler epoch.
5. Re-enables only the jobs permitted in `not_evaluated`, such as explicit gate assessment or Level 0 evaluation.

No new capability job may start between detection and commit. Already created immutable queued/running jobs retain and finish under their frozen old identity, evaluation epoch, and scheduler epoch; they may contribute only to the old evaluation history and cannot pass a gate, restore authority, or establish acceptance for the new identity/epoch. Results from another capability cannot satisfy the changed capability's gates. Unaffected capability pointers and states are unchanged.

The status UI and `pnpm ct status` show, per capability: lifecycle state, full canonical identity hash and component hashes, active evaluation epoch/attempt-context ID, scheduler epoch, superseded identity if any, archived prior epochs and authority-clearing reason, accepted scope, unmet/passed gates for the active epoch, declared baseline kind/stable ID/`dbe_` hash and its contract-implementation/corpus-evidence/metric-schema component hashes, prior accepted identity when applicable, most recent evaluation, credential verification freshness without secrets, failure/degraded state, and operator decision. A resumed deferred capability is labeled `not_evaluated — restarted from deferred; all gates required`. There is no aggregate “all Phase 2 capabilities complete” flag.

## 4. Global Phase 2 invariants

1. Deterministic code owns discovery, triggers, source/fact creation, relationships, progress, anomalies, execution eligibility, state transitions, and authorization.
2. Agents cite and interpret application-created provenance or facts. They cannot mint evidence/fact IDs, rewrite source observations, repair links, mutate relationships, change progress, clear anomalies, or authorize actions.
3. GitHub, Git, delivery-provider, publisher, and sandbox operations use deterministic adapters, never an agent or MCP conversation.
4. No credential reaches Cursor or a sandbox. Connector, fetch, publisher, and image-preparation processes have separate minimal credential boundaries.
5. Phase 1 canonical path, protected-content, source-materialization, related-source worktree capacity, immutable artifact, browser, and publisher guards remain mandatory.
6. Optional capability failures are isolated. They do not remove queue items, weaken Phase 1 review, or disable another healthy capability.
7. Self-reported confidence, risk, relevance, recommendation, or disposition is advice only and never grants execution or publication authority.
8. There is no autonomous approve, request-changes, merge, Linear write, arbitrary command, arbitrary SQL, agent-controlled queue filtering, briefing, command bar, or silent learning in Phase 2.

## 5. Capability-owned configuration and migrations

Phase 2 does not add fields to or advance the schema version of delivered Phase 1 `config/organization.json`, `profile.json`, `policy.json`, or `~/.control-tower/config.json`. Their ownership, versions, and migration path remain exactly Phase 1.

Capability-specific documents may exist only under three explicit roots:

```text
config/capabilities/<capability>.json
profile/capabilities/<capability>.json
~/.control-tower/capabilities/<capability>.json
```

When present for a capability, the shared document owns organization contracts, the profile document owns portable engineer policy/scope, and the local document owns machine enablement, credential aliases, prepared local resources, and exact model-role specifications. A capability schema may omit a root it does not need. There is no cross-document deep merge: the capability schema names the owner of every field and the loader composes the present validated objects in the fixed shared/profile/local order. Every capability document starts at its own `schemaVersion: 1`, has an exact `capabilityId`, rejects unknown fields, and migrates only within that capability namespace.

All documents are optional and the normal disabled state omits that capability's documents. A missing local capability document always means `disabled` and starts no capability process, even if reusable shared/profile templates exist. Templates must use an unrecognized `.example.json` suffix and are never loaded as configuration. Enabling/onboarding creates only that capability's required `.json` documents after preview and confirmation; disabling removes the local document/current selection pointer, making any intentionally retained shared/profile documents inert. No capability loader reserves fields or schema versions in another document.

Advanced-review configuration:

```text
config/capabilities/advanced-review.json
profile/capabilities/advanced-review.json
~/.control-tower/capabilities/advanced-review.json
```

```json
{
  "schemaVersion": 1,
  "capabilityId": "advanced-review",
  "contractGroups": [
    {
      "id": "public-api",
      "members": [
        { "repositoryId": "pba-webapp", "paths": ["src/api-clients/**"] },
        { "repositoryId": "pba-microservices", "paths": ["services/**/Contracts/**"] }
      ]
    }
  ]
}
```

The profile document owns `specialists`, deterministic triggers, and selected contract-group IDs. The local document contains `enabled: true` and exact `concurrencyReview`/`crossRepositoryReview` model specifications.

Bot-publication configuration:

```text
config/capabilities/bot-publication.json
~/.control-tower/capabilities/bot-publication.json
```

The shared schema owns allowed repositories and required bot permission constraints. The local schema contains `schemaVersion: 1`, `capabilityId: "bot-publication"`, `enabled: true`, the non-secret `credentialAlias`, selected repositories, publication mode, and canary verification record references. It never contains a token.

Delivery-intelligence configuration:

```text
config/capabilities/delivery-intelligence.json
profile/capabilities/delivery-intelligence.json
~/.control-tower/capabilities/delivery-intelligence.json
```

```json
{
  "schemaVersion": 1,
  "capabilityId": "delivery-intelligence",
  "providers": [
    {
      "id": "linear",
      "kind": "linear",
      "baseUrl": "https://api.linear.app"
    }
  ],
  "ticketExtractorBindings": [
    { "extractorId": "linear-key", "providerId": "linear" }
  ]
}
```

The profile document owns provider ID, tracked team/project/initiative IDs, stalled-review duration, and snapshot time. The local document owns `enabled: true`, the non-secret credential alias, connector machine settings, and exact `deliveryInterpretation` model specification.

Sandbox-check configuration:

```text
config/capabilities/sandbox-checks.json
~/.control-tower/capabilities/sandbox-checks.json
```

The shared document owns the strict catalog and starts at schema version 1. The schema fixture `{"schemaVersion":1,"capabilityId":"sandbox-checks","checks":[]}` is not installed as active configuration: the document remains omitted until a concrete check qualifies under sections 29–30. The local document owns `enabled`, selected check ID, and prepared-image verification references.

Governed proposal configuration, when enabled, is separately owned by `profile/capabilities/policy-improvement.json` and `~/.control-tower/capabilities/policy-improvement.json`, each at schema version 1. The profile document owns proposal bounds; the local document owns the exact `policyImprovement` model specification. It does not add a fifth product capability lifecycle or modify another capability document directly.

An exact model specification is:

```json
{
  "modelId": "string",
  "effort": "string",
  "context": "string"
}
```

This is a schema-shaped example: each string must be a concrete value supported and exactly validated by the delivered Cursor adapter; the specification makes no model-price or cost assumption. The complete canonical object, including any future role-schema field, is hashed into every applicable canonical capability-evaluation identity. Doctor rejects unavailable values, omitted required fields, initialization-model mismatch, fallback, or silent substitution. The inherited global maximum of two concurrent Cursor processes remains unchanged.

Capability SQLite migrations use namespaced IDs:

```text
cap.advanced-review/0001-<name>
cap.bot-publication/0001-<name>
cap.delivery-intelligence/0001-<name>
cap.sandbox-checks/0001-<name>
```

The delivered Phase 1 migration runner remains the journal owner. Each capability migration declares `{capabilityId, migrationId, checksum, requires[]}`. `requires` names the exact delivered Phase 1 database contract and earlier migrations in the same namespace; cross-capability dependencies are forbidden unless a later approved design explicitly introduces one. Within a namespace sequence is strict. Across namespaces migrations may be discovered and applied in any order, and applying one never reserves a number for another.

Tables, indexes, triggers, and artifact record types have a capability owner recorded in the migration manifest and use capability-specific names. A duplicate object owner, migration ID with a different checksum, undeclared cross-namespace reference, or missing Phase 1 dependency blocks only that capability before its transaction starts. The capability's canonical identity includes the ordered applied migration IDs/checksums as `migrationSetHash`.

`pnpm ct init` and doctor enumerate capability documents independently, report omitted capabilities as disabled, validate only present documents plus their dependencies, and never rewrite Phase 1 config to enable a capability. Tests apply all capability migration permutations, install/disable each capability alone, reject ownership/checksum/dependency collisions, and prove config/migration of one capability leaves the bytes, schema versions, lifecycle pointers, and tables of Phase 1 and every other capability unchanged.

Every repository path in a capability document is validated and matched by the inherited `CanonicalPathMatcher`. Unknown IDs are errors for that capability and never cause partial activation.

## 6. Harnesses, run records, and audit

Phase 2 extends the feature allowlist with:

```text
concurrency-review
cross-repository-review
delivery-interpretation
policy-improvement
```

Each enabled feature may have the same organization prompt/single allowlisted skill and engineer prompt/single allowlisted skill locations as Phase 1. The Phase 1 nine-layer composer, precedence, policy-snapshot rules, persona layer, manifest ordering, content hashing, and prohibition on recursive discovery remain exact.

For `concurrencyReview` and `crossRepositoryReview`, already selected review-domain guidance and approved repository guidance may occupy the same review-only layers as `primaryReview`; agents cannot select additional domains. For `deliveryInterpretation` and `policyImprovement`, domain and repository-guidance layers are empty. Layer 9 contains only the role's versioned, ordered, bounded input artifacts and ends with its application-created provenance/fact catalog when that role can make sourced claims.

Before a capability evaluation identity is created, its approved evaluation plan freezes every fixed corpus case and materializes the complete Phase 1 nine-layer manifest for each applicable enabled role/case. `applicableHarnessManifestHashes` contains that sorted, deduplicated complete gate-manifest set; `contractSchemaHashes` also contains the live run-input schema and harness-manifest schema hashes. Live jobs still record their own complete input-specific manifest in their run identity, but adding/changing an evaluation case, role, harness layer, selected domain/repository guidance contract, persona, manifest schema, or run-input schema changes the canonical capability identity before another job can start. Dynamic PR/provider fact values change only the immutable job/run identity when their governing schemas and harness content are unchanged.

Every Cursor attempt uses the Phase 1 create-once/append-only/seal rules and records:

- Run kind, named role, attempt number, parent job/proposal identity, and terminal status.
- Frozen canonical capability-evaluation identity, evaluation epoch/attempt-context ID, and scheduler epoch when the run belongs to a capability.
- Complete canonical model specification, its hash, exact model/effort/context strings passed to the adapter, and actual initialization model.
- Complete harness manifest and hash.
- Context/input artifact references, context hash, provenance/fact catalog hash, and source/coverage hash.
- Raw bounded output artifact hash, validated output hash, validation/schema version, and cited validated provenance/fact subset hash.
- Start/end timestamps, queue/context/agent/validation timing, Cursor-reported usage fields without inferred cost, failure/cancellation/supersession, and role-specific evaluation result.

Doctor materializes a sample manifest and validates every enabled role, feature allowlist, schema, model specification, permissions, and required dependency. A doctor failure blocks only the affected capability/role.

## 7. Autonomy ladder

Phase 2 uses one explicit ladder:

- **Level 0 — shadow predictions only:** outputs are retained for evaluation and are not shown as actionable drafts or sent externally.
- **Level 1 — recommendations and drafts:** humans may view advice and exact proposed actions; nothing external occurs.
- **Level 2 — exact per-action human approval:** each external bot comment operation requires an exact preview, content hash, head SHA, target, identity, single-use approval, and publisher revalidation. This is the highest level implemented by Phase 2.
- **Level 3 — future narrow standing authorization for bot comments only:** not implemented here. It requires a separate design, measured quality/security gates, revocation semantics, scope limits, and failure analysis. Phase 2 records only readiness telemetry such as eligible draft counts, human accept/edit/reject outcomes, prevented stale actions, provenance validity, and publication failures.

Autonomous approval, request-changes, or merge is outside this ladder and remains outside Phase 2. The principal's review disposition is always a separate human-selected, human-approved operation through the principal identity. Principal `COMMENT` and `REQUEST_CHANGES` are body-bearing/cited operations; only principal `APPROVE` may be bodyless under the inherited Phase 1 contract. Confidence or recommendation fields never advance an autonomy level.

# Phase 2A — Advanced and Cross-Repository Review

## 8. Goal, dependencies, and scope

2A adds bounded concurrency and cross-repository specialist judgment after the relevant Phase 1 review, source, provenance, model-role, and evaluation gates pass. It does not require or enable bot publication, a delivery provider, or Docker.

2A adds:

- Deterministic specialist triggers.
- A primary-review specialist recommendation mode.
- Named `concurrencyReview` and `crossRepositoryReview` roles.
- Deterministic related-work resolution and contract groups.
- Safe related-repository source preparation.
- Strict specialist outputs and optional primary consolidation.

It does not add an agent swarm, recursive delegation, delivery progress, commands, credentials, or external authority.

## 9. Deterministic specialist policy

`profile/capabilities/advanced-review.json` owns:

```json
{
  "schemaVersion": 1,
  "capabilityId": "advanced-review",
  "specialists": {
    "concurrencyReview": {
      "enabled": true,
      "triggers": [
        {
          "id": "agents-async-runtime",
          "repositoryId": "pba-agents",
          "paths": ["services/**/src/**"],
          "labelsAny": [],
          "diffPatternsAny": ["asyncio", "retry", "idempot"]
        }
      ]
    },
    "crossRepositoryReview": {
      "enabled": true,
      "contractGroupIds": ["public-api"]
    }
  }
}
```

Trigger fields are limited to those shown. Unknown fields are errors. Path matching uses `CanonicalPathMatcher`. Diff patterns are case-insensitive literal substrings over the first 2 MiB of the already filtered patch; truncation is recorded. Within each non-empty array any value may match, and all non-empty predicate groups must match. An all-empty trigger is invalid.

`concurrencyReview` auto-runs only for an explicit configured trigger match. `crossRepositoryReview` auto-runs only when a changed canonical path belongs to a configured contract group or when two or more deterministic candidate PRs share the same exact normalized opaque ticket identifier. Agent recommendations never become triggers.

The application records trigger ID, matched canonical paths/labels/literals or contract/ticket facts, matcher and policy hashes, and evaluation result. A role runs at most once for one specialist context identity. At most two specialist roles run for one primary job, and all runs share the inherited global Cursor-process limit. Deterministically triggered runs in `gated` are Level 0 evaluation artifacts only and never become actionable recommendations, specialist output, or draft dependencies; current Level 1 specialist behavior requires active `pilot` or `accepted` authority.

## 10. Specialist recommendation mode

Review-result schema version 2 extends the Phase 1 `primaryReview` result with:

```json
{
  "specialistRecommendations": [
    {
      "role": "concurrencyReview|crossRepositoryReview",
      "reason": "string",
      "observationIndexes": [0],
      "provenanceRefs": ["pv_application_created_id"]
    }
  ]
}
```

The array is bounded to one recommendation per role and two total. Each recommendation must cite at least one already valid Phase 1 observation and at least one application-created provenance reference; the validator rejects unsupported, duplicate, stale, or unknown references. The application, not the model, assigns the persisted recommendation ID:

```text
sr_<sha256(primary run ID + role + canonical reason + validated reference set
  + canonical advanced-review capability identity + evaluationEpoch)>
```

Recommendation state is `available`, `started`, `dismissed`, `stale`, `superseded`, or `failed`. Its currentness identity is the primary run ID/run-input hash, PR head SHA, relevant policy and trigger hashes, related-candidate-set hash for cross-repository advice, specialist role specification hash, recommendation payload hash, exact canonical advanced-review capability identity, and active advanced-review evaluation epoch/attempt-context ID. Any PR/context component change marks it `superseded`; a capability identity/epoch or authority change follows the mandatory stale cascade in section 12.

A recommendation cannot enqueue or start a specialist. The workbench shows the role, reason, cited evidence, freshness, bound advanced-review identity/epoch, expected additional coverage, and **Start specialist** and **Dismiss** controls. A human start action revalidates currentness, exact identity/epoch, and current `pilot`/`accepted` advanced-review authority before it creates one manual specialist attempt. Level 0 recommendation predictions remain shadow-only and cannot be started. Failure remains visible and does not change the accepted primary draft.

Only application trigger records from section 9 may auto-run a specialist. A specialist cannot recommend another specialist. A primary rerun cannot auto-run from its own prior recommendation. A manually started specialist output is displayed separately; the human may explicitly request one new primary consolidation attempt that freezes that output. No result can recursively start or consolidate another run.

Evaluation measures recommendation precision and usefulness separately from deterministic-trigger specialist quality. False or stale recommendations, unsupported reasons, attempted authority changes, and schema failures are recorded. Recommendation recall is not allowed to convert recommendations into automatic triggers.

## 11. Related-work resolver and source safety

Deterministic code gathers the complete eligible candidate pool, deduplicated by repository ID/PR number, and applies this total order:

- Open PRs in other active repositories with the exact normalized opaque ticket identifier.
- PRs merged in the previous 30 days with that identifier.
- Open PRs touching another member of a matched contract group.

The sort keys are relationship class (`exact_ticket` before `contract_group_only`; a candidate matching both is `exact_ticket`), lifecycle (`open` before `merged`), GitHub `updatedAt` descending (newest first), repository ID bytewise ascending, and PR number ascending. `updatedAt` is parsed as an RFC 3339 instant and compared in UTC; a missing or invalid value sorts after every valid instant and is recorded as degraded candidate metadata, while repository/PR keys still make the order total. The resolver retains the first 20 candidates only after sorting and records the total pre-limit count, retained count, ordered identities/ranks, every candidate omitted by the 20-candidate limit with reason `candidate_limit`, source observation IDs, query omissions, and truncation.

For a triggered or manually approved cross-repository run, deterministic code selects the first two retained candidates, or all retained candidates when fewer than two, as the requested related-source slots. The target is separate and never consumes a related slot. The resolver records every retained candidate not selected because of the two-source bound with reason `related_source_limit`; together with query and 20-candidate omissions, this is the complete non-selected/omitted-candidate record. The Phase 1 workspace manager may prepare the target plus those selected related filtered source views, each bound to an exact verified SHA and exposed as a separate `--add-dir`. Every requested source uses the inherited authenticated-fetch/credential-free-local boundary, canonical path validation, protected-path filtering, regular-blob-only materialization, no Git metadata, no repository commands, and no credentials.

Specialist source states are `resolving_related_work`, `waiting_for_source_capacity`, `preparing_sources`, `needs_human_source_decision`, `source_preparation_failed`, `queued`, `running`, and the inherited terminal run states. Source preparation follows this exact flow:

1. Freeze the target, complete resolver audit, and selected ordered related repository/PR/SHA slots. The target must be Phase 1 `registered-source` at its exact SHA; otherwise record `unregistered_target_source`, create no specialist job, and leave the Phase 1 remote-evidence-only primary workflow available. Classify each selected related source as `registered-source` or unregistered. Only selected related sources may use the explicit reduced-coverage decision below. A selected slot that needs a human decision, fails preparation, or waits for capacity remains bound to that candidate; the application never backfills it from a lower-ranked candidate.
2. If any related source is unregistered, create no reduced context and start no specialist. Move the specialist job to `needs_human_source_decision` with repository, PR, required SHA, registration state, and `unregistered_related_source`.
3. Otherwise atomically reserve all target/related worktree slots before materializing any source. The inherited global maximum of four materialized admin/source pairs remains unchanged. Insufficient capacity yields `waiting_for_source_capacity`, never partial reservation or startup.
4. Materialize every reserved source under the Phase 1 contract. A registered target preparation failure cleans all pairs, produces visible `source_preparation_failed` with the exact stage/reason/SHA, and starts no specialist. It is never automatically downgraded; the inherited Phase 1 explicit human-started remote-evidence-only primary-review path remains separate.
5. A registered related-source preparation failure also cleans every pair and starts no specialist. The job moves to `needs_human_source_decision` with the exact repository/PR/SHA, failed preparation stage, normalized reason, and source mode. It never automatically becomes GitHub-evidence-only.
6. Only a complete requested source set may move to `queued`.

In `needs_human_source_decision`, the workbench offers exactly **Retry full source**, **Start reduced GitHub-evidence-only specialist**, and **Cancel**. Retry repeats classification and atomic reservation. Cancel seals the job without output. The reduced option requires an exact preview and single-use principal confirmation naming every omitted repository/PR/SHA and reason.

Confirmation creates a new immutable reduced specialist job with an application-created source-decision audit ID, actor, time, originating job ID, and exact reduced-source set. Registered sources still requested by that new job are reserved atomically. Each omitted related repository receives filtered GitHub metadata/diff/check/discussion evidence only, application-created provenance, `sourceTreeInspected: false`, and `missingCoverage: ["source_tree"]`; it permits no file provenance. The specialist output and visible summary must repeat that missing coverage. No prior partial materialization is reused.

An automatically triggered specialist awaiting a source decision does not block the independent Phase 1 primary review: the primary may finish with the visible specialist state `needs_human_source_decision`, not a fabricated specialist failure or reduced result. A later full or explicitly reduced specialist result remains separate until the principal explicitly starts a new consolidation attempt.

## 12. Specialist identities, ordering, and staleness

When its complete source set is available under `pilot` or `accepted`, an automatically triggered Level 1 specialist runs before `primaryReview`; validated output or explicit terminal failure is frozen into the primary run input. The source-decision exception follows section 11 and never fabricates a fallback result. Under `gated`, the same deterministic trigger may create only a Level 0 shadow run stored in the evaluation corpus; it is never supplied to `primaryReview`, never appears in a workbench draft, and has no publication pointer. A manually started recommended or explicitly reduced specialist requires `pilot`/`accepted`, runs independently, and never mutates an existing draft. An explicit Level 1 consolidation creates a new immutable `primaryReview` attempt.

Specialist job identity is:

```text
role + target repository/PR/head SHA
+ ordered related repository/PR/head-SHA set
+ deterministic trigger record or manual recommendation ID
+ full-source plan hash or explicit reduced-source decision ID/hash
+ relevant policy/profile/persona hashes
+ selected domain/repository-guidance identities
+ canonical capability-evaluation identity
+ active evaluation epoch/attempt-context ID
```

The specialist run-input identity additionally includes the complete harness manifest hash, context/source/coverage hash, application provenance catalog hash, and exact role-model-specification hash. Every `concurrencyReview` and `crossRepositoryReview` run/output record repeats the frozen advanced-review identity, evaluation epoch, and attempt-context ID. Output hashes never participate in their own run identity.

A target head change supersedes specialist output and any consolidated draft. A related head, candidate-set, registration state, or source-decision change marks the affected cross-repository output stale. These context rules are additional to, not substitutes for, capability authority.

`advancedReviewDependency` is an optional, application-added primary-result/draft extension. It exists only when at least one schema/provenance-validated Level 1 specialist output produced under the current `pilot` or `accepted` identity/epoch is actually supplied to primary consolidation:

```json
{
  "advancedReviewDependency": {
    "capabilityIdentity": "cei_...",
    "evaluationEpoch": 1,
    "attemptContextId": "ceac_...",
    "specialistRuns": [
      { "role": "concurrencyReview|crossRepositoryReview", "runId": "string", "outputHash": "string" }
    ]
  }
}
```

`specialistRuns` must be non-empty. Level 0 shadow runs/outputs, shadow recommendation predictions, Level 1 recommendations that did not start a specialist, failed specialist runs, and specialist outputs not supplied to consolidation can never create this extension. They remain separate immutable evaluation/advisory artifacts. In the same transaction that changes the current advanced-review canonical identity, increments its evaluation epoch, or removes its `pilot`/`accepted` authority, the application marks stale every current specialist recommendation, every `concurrencyReview` run and output, every `crossRepositoryReview` run and output, and every primary draft whose optional dependency names the prior identity/epoch. It invalidates approvals and blocks publication only for those dependent drafts before exposing the new lifecycle state. Immutable run/output artifacts remain archived with the stale reason.

Publication of a dependent draft remains blocked until either: (a) specialists and the dependent primary draft are rerun under the active advanced-review identity/epoch after `pilot`/`accepted` authority is restored; or (b) the principal starts a current Phase 1-only primary run that receives no specialist outputs, reviews an exact new draft preview with no `advancedReviewDependency`, and explicitly accepts that new draft. Editing or deleting fields from the stale draft cannot remove the dependency. These rules apply equally to concurrency-only, cross-repository-only, full-source, and explicitly reduced Level 1 runs. A recommendation-only primary draft has no dependency; the recommendation itself still becomes stale, but it does not make otherwise independent Phase 1 draft content stale.

## 13. Specialist output and fact authority

Each specialist returns one strict object:

```json
{
  "schemaVersion": 1,
  "role": "concurrencyReview|crossRepositoryReview",
  "coverage": {
    "repositories": [
      {
        "repositoryId": "string",
        "headSha": "string",
        "sourceMode": "registered-source|remote-evidence-only",
        "sourceTreeInspected": true,
        "missingCoverage": [],
        "sourceDecisionRef": null
      }
    ]
  },
  "observations": [
    {
      "type": "observation|inference",
      "statement": "string",
      "provenanceRefs": ["pv_application_created_id"],
      "fileReferences": [
        {
          "repositoryId": "string",
          "blobSha": "string",
          "path": "canonical/path",
          "startLine": 1,
          "endLine": 1
        }
      ]
    }
  ],
  "findings": [
    {
      "severity": "blocking|high|medium|low",
      "confidence": "high|medium|low",
      "title": "string",
      "rationale": "string",
      "observationIndexes": [0]
    }
  ],
  "crossRepositoryImplications": [
    {
      "repositoryId": "string",
      "prNumber": 1,
      "relationshipFactRefs": ["fact_application_created_id"],
      "observationIndexes": [0]
    }
  ],
  "unknowns": ["string"]
}
```

`crossRepositoryImplications` is empty for `concurrencyReview`. The application supplies exact coverage and creates every `pv_` provenance and deterministic relationship `fact_` record before execution. A full source entry has `sourceMode: "registered-source"`, `sourceTreeInspected: true`, no source-tree omission, and null `sourceDecisionRef`. An explicitly reduced related entry has `sourceMode: "remote-evidence-only"`, `sourceTreeInspected: false`, includes `source_tree` in `missingCoverage`, and cites the application-created source-decision audit ID. File references for that repository are invalid.

Specialists may cite application-created IDs and submit file locators for application validation; they cannot emit a provenance/fact catalog, invent IDs, rewrite observations, create relationships, or silently choose an ambiguous ticket. The Phase 1 provenance validator applies independently to every repository/blob/path/range.

A malformed result, coverage/source-decision mismatch, invented/stale reference, protected path claim, file claim against a reduced repository, or invalid related repository fails the specialist attempt. A source preparation failure or pending human source decision is never represented as a successful/failed Cursor result. Primary review continues with the exact visible source state or explicit terminal specialist failure/unknown; a failed manual or reduced specialist leaves its originating draft unchanged.

## 14. 2A UI, tests, rollout, and acceptance

The workbench shows deterministic trigger reasons separately from agent recommendations, specialist/source state, exact repositories and SHAs, preparation failure reason, source-decision controls/audit ID, application provenance, missing coverage, staleness, and consolidation lineage. Agent text is rendered through the inherited untrusted-content boundary.

Tests cover strict capability config, trigger truth tables, recommendation schema/currentness/manual-only startup, recommendation/run/output binding to exact advanced-review identity and evaluation epoch, optional non-empty `advancedReviewDependency` only for validated Level 1 outputs actually supplied to consolidation, rejection of a dependency containing no specialist run, proof gated Level 0 shadow/recommendation artifacts remain separate and never enter primary inputs/drafts/publication, no recommendation-to-trigger conversion, one-run bounds, recursion prevention, candidate deduplication and total ordering by relationship class/open-before-merged/`updatedAt` descending/repository/PR including invalid-time ordering, post-sort 20-candidate limiting with total/truncation audit, deterministic first-two source selection and complete omission reasons, preservation of a selected slot through capacity/preparation/human-decision states with no lower-ranked substitution, exact ticket ambiguity, unregistered-target non-start, atomic all-source worktree-slot reservation, capacity waiting, registered target failure with no downgrade, registered related failure cleanup and `needs_human_source_decision`, unregistered related decision before materialization, retry/cancel, exact approved reduced-job identity/audit, reduced missing coverage/provenance and file-reference rejection, proof no automatic GitHub-only fallback exists, role model/manifest/run recording, output provenance/fact validation, identity/epoch/authority-loss stale cascades covering both specialist roles and only truly dependent primary drafts, recommendation-only draft independence, approval/publication blocking, Phase 1-only exact replacement drafts, ordering, failure, consolidation, staleness, and browser safety.

Rollout:

1. Offline deterministic fixtures and versioned corpora for both named roles.
2. Historical replay against a `phase1_contract` declared-baseline payload whose stable ID names the delivered `primaryReview` contract/implementation, corpus/results manifest, and finding-metric schema.
3. Live Level 0 shadow for deterministic triggers and recommendation telemetry.
4. Bounded Level 1 pilot with visible specialist output and manual consolidation.
5. Explicit acceptance for the canonical advanced-review capability-evaluation identity and active evaluation epoch.

2A is accepted only for its canonical capability-evaluation identity and active evaluation epoch when its declared corpus and live pilot demonstrate incremental finding value over its identity-bound `phase1_contract` declared-baseline payload, role-specific metrics and failures are displayed, every recommendation/specialist and actual dependent draft binds to that identity/epoch, Level 0 artifacts are proven draft/publication-ineligible, stale cascades and publication blocks are proven for both roles, unregistered targets cannot start specialists, registered target/related source failures never auto-degrade, every reduced run has an exact human source-decision audit record and persistent missing coverage, and there is no regression in false positives, routine-review service target, provenance validity, deterministic coverage, protected-content exclusion, atomic worktree capacity, credential isolation, browser safety, or human authority. Numeric quality thresholds belong to the approved 2A implementation plan and evaluation record, not an agent decision.

# Phase 2B — Bot Publication

## 15. Goal, dependency, and autonomy

2B publishes exact approved comment operations through a dedicated GitHub bot while the principal retains the separate review disposition. It depends on accepted Phase 1 draft/provenance/publisher guards and does not depend on 2A, delivery intelligence, Docker, or any agent role.

Level 0 records predicted publish operations only. Level 1 shows bot-attributed drafts. Level 2 permits exact per-action human-approved bot comments. Level 3 is not implemented. Bot publication never performs approve, request-changes, merge, or principal disposition.

## 16. Bot credential, identity, and enablement

Commands:

```text
pnpm ct credentials set github-bot <alias>
pnpm ct credentials check github-bot <alias>
pnpm ct credentials delete github-bot <alias>
```

The dedicated fine-grained token is stored in the macOS Keychain and restricted to configured repositories with pull-request read/write permission and no administration or contents-write permission. Its non-secret alias is stored only in `~/.control-tower/capabilities/bot-publication.json`.

The publisher retrieves the token only for one short-lived bot `gh api` operation and passes it through that process's sanitized environment. It is never logged, persisted, or inherited by Cursor, Git, Docker, connectors, SQLite, or another publisher operation.

Doctor verifies bot login, repository read access, and inequality with the normalized principal identity. Because GitHub has no reliable non-mutating write-permission proof, each repository requires:

```text
pnpm ct publication bot verify-write --repo <owner/repo>
```

After exact human confirmation, the command creates and immediately deletes a uniquely marked comment on an operator-selected open test PR. Creation and deletion are separate approved, audited, short-lived subprocesses. Until both succeed, that repository remains `not_evaluated`. The application hashes the verified bot identity, repository permission/canary result, verification method, and current validity state into the canonical bot-publication identity; a change uses the section 3 transition before another bot job starts.

## 17. Level 2 bot publication flow

1. The workbench separates body-bearing bot summary/inline comments from the principal review disposition.
2. The operator previews each exact bot operation, actor, repository/PR, head SHA, position, body/content hash, accepted run ID/run-input hash, coverage hash, non-empty validated provenance set, idempotency key, and canonical operation hash.
3. The operator approves each operation individually with a single-use action token and the inherited approval TTL; previewing multiple bot operations creates no batch approval.
4. The publisher revalidates bot identity, accepted sealed run, current head SHA, exact content/target hash, provenance, repository enablement, and idempotency key, then transactionally consumes that operation's approval when recording the first attempt.
5. One bot subprocess performs that one operation.
6. The application records approval identity, response, timestamps, and idempotency state.
7. Principal disposition is previewed and approved separately under the inherited Phase 1 exact per-operation hash, GitHub review-body, citation, summary-use, and first-attempt consumption contract, and executes only through the configured principal identity.

An approval for one comment cannot authorize another comment or disposition. Edit, target change, head change, run/context/model/harness/provenance change, identity change, mode change, first attempt, restart, or TTL expiry invalidates it.

Bot summary and inline comments inherit the Phase 1 structured-comment contract. Each is body-bearing and must carry a non-empty application-validated provenance set; summary citations come from the structured summary observation/provenance selections, and inline citations are the deterministic union derived from finding observations plus validated file/diff provenance. Human edits retain or explicitly reselect current validated citations before preview. The bot cannot publish an empty-body or empty-citation comment and never performs a review disposition.

The principal disposition follows the inherited GitHub API contract: `comment_review` uses event `COMMENT` with a non-empty validated body/citations; `request_changes_review` uses `REQUEST_CHANGES` with a non-empty validated body/citations; `approve_review` uses `APPROVE` and is the only bodyless/empty-provenance operation; `needs_human` is not publishable. The cross-actor operation planner freezes one use for the structured summary body. For principal `COMMENT` or `REQUEST_CHANGES`, it is reserved for the principal review body and cannot also be a bot summary. For principal `APPROVE`, it may be published once as either a separately approved bot summary or principal summary comment, or not published. Actor-specific operation hashes/approvals and a shared summary-body idempotency mapping prevent duplicate bot/principal publication.

Partial bot failure blocks any dependent principal disposition until the operator retries each incomplete operation with new approval or explicitly approves continuing without it. Continuing cannot impersonate the bot or convert missing bot comments into principal comments.

## 18. 2B failure, tests, rollout, and acceptance

Bot failure is visible and does not change the draft, review coverage, another capability, or principal authority. Revoking/invalidating the bot credential disables bot publication only. No automatic retry occurs.

Tests cover capability lifecycle, alias/keychain handling, environment redaction, principal/bot inequality, repository canary, actor separation, exact per-operation hash/approval, inherited structured-summary and deterministic inline citation derivation, mandatory non-empty bot bodies/provenance after edits, rejection of empty/stale/invented bot citations, principal `COMMENT`/`REQUEST_CHANGES` required body/citations, bodyless/empty-provenance-only principal `APPROVE`, non-publishable `needs_human`, cross-actor summary-use reservation and duplicate-body idempotency rejection, no batch approval, first-attempt consumption, SHA/run/coverage/content/provenance/idempotency guards, TTL/restart invalidation, partial failure, explicit continue-without-bot, no bot disposition route, and readiness telemetry that grants no Level 3 authority.

Rollout:

1. Offline fake-publisher and credential-isolation tests.
2. Level 0 shadow against a `phase1_contract` declared-baseline payload whose stable ID binds the delivered Phase 1 principal-publication contract/implementation, accepted publication-outcome manifest, and publication metric schema.
3. Repository-specific write canary.
4. Level 1 attributed previews.
5. Bounded Level 2 pilot with exact per-comment approval.
6. Explicit acceptance of the canonical bot-publication capability-evaluation identity and active evaluation epoch whose scope names the accepted repositories.

2B is accepted only for its canonical bot-publication capability-evaluation identity and active evaluation epoch when it adds clear attribution/operational value against its identity-bound `phase1_contract` declared-baseline payload and cannot weaken content/SHA/provenance guards, credential isolation, idempotency, principal disposition separation, browser/action-token safety, or exact human authority.

# Phase 2C — Optional Delivery-Provider Intelligence

## 19. Goal, optionality, and provider boundary

2C connects code delivery to explicitly configured planned work. It is optional, read-only, and independent of 2A, bot publication, and sandbox checks. Linear is the first adapter, but provider-specific terms stay in the adapter/UI capability labels; generic storage uses `delivery_*` entities.

Connector acquisition may be implemented in `not_evaluated` solely to measure the section 25 data-quality gate. Until that gate is accepted, the product must not display progress claims, deterministic delivery anomalies as operational conclusions, or `deliveryInterpretation` output.

Linear remains read-only throughout Phase 2. There are no Linear mutation commands, credentials in agents, or agent-controlled connector queries.

## 20. Provider configuration and interface

`profile/capabilities/delivery-intelligence.json` owns:

```json
{
  "schemaVersion": 1,
  "capabilityId": "delivery-intelligence",
  "delivery": {
    "providerId": "linear",
    "trackedTeamIds": [],
    "trackedProjectIds": [],
    "trackedInitiativeIds": [],
    "stalledReviewSeconds": 172800,
    "dailySnapshotTimeLocal": "00:05"
  }
}
```

At least one tracked ID is required to select delivery evaluation. `stalledReviewSeconds` is a positive integer canonical duration in seconds. Scope IDs are the content hash of provider ID plus sorted configured team/project/initiative IDs. Unknown fields or provider IDs are errors.

The deterministic provider interface supplies source observations for work items, teams, projects, milestones/initiatives when supported, state, estimate, priority, assignee, target dates, hierarchy/dependency relationships, stable source version, payload hash, and `observedAt`. Unsupported concepts are absent, never synthesized.

The Linear adapter calls the API through deterministic TypeScript code. It retrieves the configured read-only scope, exact PR-linked items, required ancestors, and one hop of blocking relationships. Polling is checkpointed and defaults to five minutes. Every request records provider scope, query/page identity, source version, observed time, and payload hash.

## 21. Credential onboarding

```text
pnpm ct credentials set linear <alias>
pnpm ct credentials check linear <alias>
pnpm ct credentials delete linear <alias>
```

The set command prompts without echo and stores the token in the macOS Keychain; its non-secret alias is stored only in `~/.control-tower/capabilities/delivery-intelligence.json`. Only the connector request process receives it. Cursor, GitHub, Git, bot publisher, Docker, logs, SQLite, and artifacts never receive it. Doctor performs a read-only identity query without printing the token.

## 22. Application-created sources, facts, and links

The connector creates content-addressed source records:

```text
src_<base32-sha256(provider ID + object type + raw object ID + source version + payload hash)>
```

Each immutable connector-observation event references one `src_` record and stores its own `observedAt`, provider scope, request/page identity, and checkpoint. Repeated acquisition of identical provider content therefore reuses the source ID while preserving every observation time. Freshness facts use the applicable observation event; content/relationship facts use stable source IDs, so an unchanged poll does not spuriously change an anomaly fact hash or start another interpretation run.

The normalizer creates immutable facts from exact source fields:

```text
fact_<base32-sha256(fact schema version + fact type + canonical entity IDs + canonical value + supporting source IDs)>
```

Facts include normalized provider state, estimates, hierarchy/dependency edges, PR ticket extraction, PR-to-work-item resolution, and freshness. They retain supporting `sourceIds`, normalization version, `asOf`, and value hash. Agents receive bounded catalogs of these application-created IDs and may cite them; they cannot emit catalogs or alter source/fact records.

Phase 1 ticket extraction and its `config/organization.json` schema remain unchanged. `config/capabilities/delivery-intelligence.json` binds an existing Phase 1 extractor ID to a provider ID through `ticketExtractorBindings`; it does not add `providerId` to the Phase 1 extractor. Missing IDs, multiple IDs, no provider match, or multiple provider matches remain explicit states. Neither deterministic normalization nor an agent chooses or repairs an ambiguous link. Resolution changes create new facts; history is not rewritten.

## 23. Scope, snapshots, baselines, and deterministic math

Retrieval scope is the union of:

- Non-archived work items directly assigned to a tracked project.
- Non-archived work items in a project belonging to a tracked initiative.
- Non-archived, non-canceled work items in an explicitly tracked team.
- Work items resolved from tracked PR identifiers, including context-only items outside planning scope.
- Required ancestor and one-hop blocking records.

Progress scope is narrower: non-archived, non-canceled work items included through the explicit tracked team/project/initiative hierarchy. PR-linked items outside that hierarchy are context-only and cannot change progress, estimate coverage, or scope movement.

The connector stores observations every poll. After the data-quality gate is accepted, it creates one immutable daily snapshot at the configured local time and one additional snapshot only on explicit refresh. A snapshot uses one `asOf`; only observations at or before it participate.

An operator creates an immutable baseline pointer:

```text
pnpm ct delivery baseline create --scope <provider-scope-id>
```

A new baseline closes the previous comparison period without rewriting history.

This delivery-scope comparison pointer is operational snapshot state, not `declaredBaselineEvaluationHash`. The 2C evaluation identity instead uses an `external_evidence` declared-baseline payload whose stable ID binds the approved provider/GitHub reconciliation contract, immutable manual-truth/evidence manifest, and delivery metric-definition schema. Dynamic daily baselines and snapshots never feed back into that payload.

Estimated progress is:

```text
sum(estimate for completed estimated items)
/
sum(estimate for all estimated items in progress scope)
```

For Linear, only workflow-state type `completed` is complete. `canceled` is excluded from the current numerator and denominator and reported as removed scope when present in the active baseline. Unestimated items are excluded from estimate numerator/denominator.

The UI separately shows:

- Estimate coverage: count of scoped non-canceled items with an estimate / count of all scoped non-canceled items.
- Completed-item count ratio: count of completed scoped items / count of all scoped non-canceled items.
- Estimated-point progress using only estimated items.

These metrics never blend estimate and count numerators or denominators.

Every displayed ratio includes its raw numerator and denominator. When a denominator is zero, its stored/display value is null, never zero or 100%. A required metric then fails; only an optional metric with complete acquisition may use the approved `emptyOptionalMetricDenominator` and `notApplicableGateTreatment` policy in section 25.

## 24. Deterministic anomalies

Application rules create immutable anomaly identities and fact hashes for:

- Missing valid PR ticket link.
- Multiple ticket identifiers on one PR.
- Completed work item with an open/unmerged linked PR.
- Merged PR linked to an incomplete work item.
- Blocked work item with active linked work.
- Scope added or removed since baseline.
- Stalled requested review using the configured deterministic event-age rule below.
- Target date passed with incomplete scoped work.

Identity is `anomaly type + canonical primary entity IDs`; the fact hash covers every fact used by the rule. Agents cannot create, resolve, suppress, reprioritize, or mutate an anomaly. New facts may deterministically change its state, creating an auditable transition.

The stalled-review rule applies only while review remains requested from the configured operator at snapshot `asOf`. Its anchor is the latest qualifying event at or before `asOf`: the active review-request timeline event's `createdAt`, the current-head commit's GitHub `committedDate`, any PR review's `submittedAt`, any PR issue/review comment's `createdAt`, any check-state transition's provider timestamp, and any linked provider-item comment's `createdAt` when an exact unique provider link exists and the provider exposes comments. Every qualifying event resets the clock, regardless of author or resulting check state.

All event timestamps and snapshot `asOf` must be RFC 3339 with an explicit offset. Deterministic code converts them to UTC Unix seconds by flooring fractional seconds, computes the anchor as the greatest second, and computes `elapsedSeconds = asOfSecond - anchorSecond`. Equal-second events tie for audit by event kind in this fixed order—`review_request`, `head_commit`, `review`, `pr_comment`, `provider_comment`, `check_transition`—then stable provider/GitHub event ID; the elapsed result is unchanged. Future, missing, or invalid timestamps are never substituted. The active review-request creation and current-head commit are required anchors, and acquisition must be complete for GitHub review/comment/check-transition streams. A check transition without a provider timestamp makes that required stream incomplete. A provider-comment stream is required only when the provider supports it and an exact unique linked item exists; an unsupported provider field is explicitly recorded and not synthesized. A missing required anchor or incomplete required stream creates an explicit `stalled_review_unknown` anomaly input and can produce neither `stalled` nor an all-clear. Otherwise, stalled is true exactly when `elapsedSeconds >= stalledReviewSeconds`; equality is stalled.

## 25. Mandatory live planning-data quality gate

Delivery cannot move beyond `not_evaluated` until a live read-only assessment runs over the exact configured provider scope and current tracked GitHub PR scope. The assessment first creates `delivery-data-quality-payload.json` independently of any capability identity or epoch:

```json
{
  "payloadSchemaVersion": 1,
  "scope": {
    "providerScopeId": "string",
    "githubScopeHash": "string"
  },
  "asOf": "ISO-8601 timestamp",
  "sourceObservations": {
    "githubObservationSetHash": "string",
    "providerObservationSetHash": "string",
    "freshnessFactIds": ["fact_application_created_id"],
    "missingObservationFactIds": []
  },
  "acquisition": {
    "state": "complete|incomplete",
    "configuredScopeHash": "string",
    "requiredGithubSourceCount": 0,
    "acquiredGithubSourceCount": 0,
    "requiredProviderSourceCount": 0,
    "acquiredProviderSourceCount": 0,
    "requiredPageSetHash": "string",
    "acquiredPageSetHash": "string",
    "incompleteFactIds": [],
    "optionalConcepts": {
      "hierarchy": "supported|unsupported",
      "estimates": "supported|unsupported"
    }
  },
  "measuredMetrics": {
    "ticketLinkCompleteness": { "numerator": 0, "denominator": 0, "value": null },
    "ticketLinkAmbiguity": { "numerator": 0, "denominator": 0, "value": null },
    "hierarchyReferenceResolution": { "numerator": 0, "denominator": 0, "value": null },
    "estimateCoverage": { "numerator": 0, "denominator": 0, "value": null },
    "hierarchyCounts": {
      "cycleCount": 0,
      "duplicateParentEdgeCount": 0,
      "outsideConfiguredHierarchyCount": 0
    },
    "githubSourceAge": {
      "observedCount": 0,
      "missingCount": 0,
      "maximumAgeSeconds": null
    },
    "providerSourceAge": {
      "observedCount": 0,
      "missingCount": 0,
      "maximumAgeSeconds": null
    }
  },
  "thresholdDecision": {
    "state": "none|proposed|operator_approved",
    "approvedPolicy": null,
    "decisionId": "string|null",
    "decidedBy": "human identity|null",
    "decidedAt": "ISO-8601 timestamp|null"
  },
  "factIds": ["fact_application_created_id"],
  "factSetHash": "string",
  "omissions": []
}
```

Every ratio has nonnegative safe-integer `numerator` and `denominator`. When the denominator is positive, `value` is the canonical reduced rational string `"<numerator>/<denominator>"`; when it is zero, `value` is null. Application comparisons always use integer cross-multiplication over numerator/denominator, never the display value or floating point.

For `hierarchyReferenceResolution`, the denominator is the canonical count of required reference slots: one for each configured tracked team/project/initiative ID and one for each distinct normalized parent/project/initiative/required-ancestor edge needed to establish progress-scope membership. Exact duplicate edges are counted once in this ratio and separately in `duplicateParentEdgeCount`. A slot contributes to the numerator only when its referenced ID resolves to exactly one current entity of the expected provider type in the complete observation set. Missing, deleted, wrong-type, or non-unique resolution does not contribute. Cycles and resolved entities outside the configured hierarchy remain separate exact counts, so they cannot be hidden by the resolution ratio.

`githubSourceAge` covers every included PR and `providerSourceAge` every included provider entity. Observation and `asOf` timestamps use the explicit-offset UTC-second normalization from section 24. Each maximum is the greatest nonnegative `asOf`-minus-observation age in canonical integer seconds. Missing, invalid, future, or incomplete required observations increment `missingCount`, force `acquisition.state: "incomplete"`, and cannot be converted to age zero; `maximumAgeSeconds` is null when no valid observation exists. Both age metrics are required: an empty required entity set or any positive `missingCount` is `fail`, never configurable `not_applicable`.

For `state: "operator_approved"`, `approvedPolicy` is required and has this closed versioned shape; for `none` it is null, and for `proposed` the same closed shape may be displayed but grants no authority:

```json
{
  "policySchemaVersion": 1,
  "ratioThresholds": {
    "ticketLinkCompleteness": {
      "comparator": "gte",
      "threshold": { "numerator": 0, "denominator": 1 }
    },
    "ticketLinkAmbiguity": {
      "comparator": "lte",
      "threshold": { "numerator": 0, "denominator": 1 }
    },
    "hierarchyReferenceResolution": {
      "comparator": "gte",
      "threshold": { "numerator": 0, "denominator": 1 }
    },
    "estimateCoverage": {
      "comparator": "gte",
      "threshold": { "numerator": 0, "denominator": 1 }
    }
  },
  "countThresholds": {
    "cycleCount": { "comparator": "lte", "threshold": 0 },
    "duplicateParentEdgeCount": { "comparator": "lte", "threshold": 0 },
    "outsideConfiguredHierarchyCount": { "comparator": "lte", "threshold": 0 }
  },
  "durationThresholds": {
    "reportAgeSeconds": { "comparator": "lte", "thresholdSeconds": 0 },
    "githubSourceAgeSeconds": { "comparator": "lte", "thresholdSeconds": 0 },
    "providerSourceAgeSeconds": { "comparator": "lte", "thresholdSeconds": 0 }
  },
  "exceptionPolicy": {
    "unsupportedOptionalConcept": "fail|not_applicable",
    "emptyOptionalMetricDenominator": "fail|not_applicable",
    "notApplicableGateTreatment": "block|allow"
  }
}
```

`acquisition.state` is `complete` only when every configured team/project/initiative source, every required GitHub PR source, every exact linked provider item, required ancestor and one-hop blocker, and every required pagination page has a current observation in the exact configured scope. An authoritative observed not-found result is a complete negative observation, not an acquisition gap; absence without that record is incomplete. Counts and page-set hashes must reconcile, `incompleteFactIds` must be empty, and `missingObservationFactIds` must be empty. A timeout, permission gap, failed page, required object lacking either content or an authoritative not-found observation, invalid/future required timestamp, or any other required-source omission sets `state: "incomplete"`. Optional concepts are declared by the deterministic provider capability contract before assessment; only hierarchy and estimates may be `unsupported` in this schema. Unsupported optional fields are absent rather than counted as missing required sources.

Ticket-link completeness/ambiguity and both source-age metrics are required. Hierarchy resolution/counts and estimate coverage are optional only under their corresponding declared provider concept. If a supported optional metric has an empty denominator after complete acquisition, `emptyOptionalMetricDenominator` applies. If its provider concept is genuinely `unsupported`, `unsupportedOptionalConcept` applies. A required metric with an empty denominator, missing value, or unsupported field is an unconditional `fail`, not `not_applicable`.

Unknown fields, omitted required keys, an unrecognized comparator/enum, negative integer, zero ratio-threshold denominator, noncanonical duration, or non-integer duration is invalid. The numeric values shown are schema-shape examples, not defaults or product-supplied viability values; the operator supplies and approves every threshold. `gte` and `lte` are inclusive, so equality passes. Each deterministic comparator returns exactly `pass`, `fail`, or `not_applicable`. Outcome precedence is fixed: schema invalidity blocks evaluation; incomplete acquisition or any required-source/required-metric omission returns `fail`; a genuinely unsupported optional concept uses `unsupportedOptionalConcept`; an explicitly empty supported optional metric denominator after complete acquisition uses `emptyOptionalMetricDenominator`; otherwise the exact comparator runs. Neither configurable exception path can produce `pass`. The gate passes only when acquisition is complete and every result is `pass`, or is `not_applicable` from one of those two optional-only paths and the approved `notApplicableGateTreatment` is `allow`; any `fail` or blocked `not_applicable` blocks the gate. The application records each outcome and the exact deterministic or policy field that determined it.

The payload records exact source observation/freshness sets, acquisition state/counts/page-set hashes, optional-concept applicability, raw metric numerators/denominators, canonical values, hierarchy reference slots/counts, source-age counts, the applicable proposed or operator-approved closed policy, all supporting application-created facts, and omissions. It explicitly contains no capability identity, evaluation epoch, attempt-context ID, scheduler epoch, lifecycle/gate state, report/envelope ID, or acceptance pointer. Its identity is:

```text
dqp_<base32-sha256(canonical delivery-data-quality-payload.json bytes)>
```

An initial `state: "none"` payload is displayed so the operator sees measured live data. Choosing or approving thresholds creates a new immutable payload over the same explicitly identified observations/metrics plus that threshold decision; it never mutates the initial payload. The final operator-approved payload hash is the only report value bound into `capabilityBindingHashes`. The application computes the resulting canonical delivery capability identity, establishes its active evaluation epoch, and then stores:

```json
{
  "envelopeSchemaVersion": 1,
  "reportPayloadHash": "dqp_...",
  "capabilityIdentity": "cei_...",
  "evaluationEpoch": 1,
  "attemptContextId": "ceac_...",
  "storedAt": "ISO-8601 timestamp"
}
```

The envelope ID is `dqr_<base32-sha256(canonical envelope bytes)>`. Neither envelope ID/hash nor any envelope field feeds the payload hash or canonical capability identity. The displayed immutable report is the independently verifiable payload plus this envelope.

The measured payload contains:

- **Ticket-link completeness:** number of in-scope tracked PRs with exactly one extracted identifier resolving to exactly one provider item / all in-scope tracked PRs.
- **Ticket-link ambiguity:** number of in-scope tracked PRs with multiple extracted identifiers or a non-unique provider resolution / all in-scope tracked PRs.
- **Hierarchy reference resolution and counts:** the exact resolved/required reference-slot ratio plus identities and counts for missing configured parents, missing referenced ancestors, cycles, duplicate parent edges, unsupported hierarchy records, and items outside the configured hierarchy. No blended score is created.
- **Estimate coverage:** estimated scoped non-canceled item count / all scoped non-canceled item count, plus raw counts. It is not reported as delivery progress.
- **GitHub freshness:** age at report `asOf` of the newest complete GitHub observation for every included PR, with missing observations listed.
- **Provider freshness:** age at report `asOf` of the newest provider observation for every included provider entity, with missing observations listed.

The application does not invent numeric viability thresholds. After viewing the initial payload, the operator fills and explicitly approves the complete closed policy: minimum completeness/hierarchy-resolution/estimate-coverage ratios, maximum ambiguity ratio, maximum hierarchy counts, maximum report/GitHub/provider ages in integer seconds, the two optional-only exception enums, not-applicable gate treatment, and exact scope. Those values enter the final operator-approved payload. No operator field can waive incomplete acquisition or required-source/required-metric failure. The application evaluates that payload deterministically to the three-state comparator outcomes and requires a separate explicit gate acceptance after the final envelope exists.

If acquisition is incomplete, the gate outcome is unconditionally `fail` and delivery remains `not_evaluated`; operator exception or not-applicable policy is not consulted. Any other measured failure, stale payload, or scope change likewise leaves delivery `not_evaluated` or explicitly `rejected`/`deferred`. Progress, anomalies as operational conclusions, and visible agent interpretations remain disabled. Reassessment creates a new immutable payload/envelope pair; it never edits prior artifacts.

Gate acceptance creates immutable `delivery-gate-authority.json`:

```json
{
  "capabilityIdentity": "cei_...",
  "evaluationEpoch": 1,
  "scopeHash": "string",
  "reportEnvelopeId": "dqr_...",
  "reportEnvelopeHash": "string",
  "reportPayloadHash": "dqp_...",
  "reportAsOf": "ISO-8601 timestamp",
  "thresholdDecisionId": "string",
  "thresholdDecisionHash": "string",
  "approvedReportAgeSeconds": 0,
  "approvedGithubSourceAgeSeconds": 0,
  "approvedProviderSourceAgeSeconds": 0,
  "acceptedMetricEvaluationHash": "string",
  "approvedBy": "human identity",
  "approvedAt": "ISO-8601 timestamp"
}
```

The exact payload hash, acquisition evidence, closed threshold/exception policy, canonical integer-second report/source-age limits, and complete comparator-outcome hash participate in gate authority. `reportAgeSeconds` is the nonnegative difference between the current gate-evaluation UTC Unix second and payload `asOf` normalized by the same explicit-offset/floor rule as section 24; a future or invalid `asOf` is an unconditional required-data failure, never age zero or `not_applicable`. Only the acyclic payload hash participates in canonical identity bindings; the envelope and gate-authority hashes do not. The operator chooses and approves every numeric threshold and optional-only exception treatment after seeing live data; this specification defines no universal value.

After every GitHub/provider observation cycle, and immediately before serving a current progress/anomaly projection or leasing any delivery snapshot/interpretation job, deterministic code first recomputes acquisition completeness over the exact approved scope. If any required source/page/object/observation is incomplete, it records unconditional `fail` and performs the gate-loss path without evaluating optional exception policy. Only after complete acquisition does it evaluate ratios by exact cross-multiplication, counts by integer comparison, report/source ages by canonical integer-second comparison, unsupported optional concepts by `unsupportedOptionalConcept`, and empty supported optional denominators by `emptyOptionalMetricDenominator`.

Any configured scope/approved-policy/final report-payload hash change is a contract change and invokes section 3 with a new canonical identity. Envelope-only changes never alter identity. If the identity is unchanged but acquisition becomes incomplete, a recomputed comparator fails or produces a policy-blocked optional `not_applicable`, the accepted payload exceeds `approvedReportAgeSeconds`, or any required GitHub/provider source exceeds its approved integer-second age, the monitor invokes the same-identity `gated|pilot|accepted -> not_evaluated` gate-loss transaction before publishing the new observation projection. That transaction fences delivery reads, revokes both shadow and normal delivery leases, cancels queued jobs, terminates/seals running jobs as stale/cancelled old-epoch artifacts, archives the old gate-authority/payload/envelope/policy/current-outcome evidence, clears progress/anomaly/interpretation current pointers, increments the evaluation epoch, and records exact acquisition gaps, failing numerators/denominators, counts, durations, or optional unsupported facts.

After gate loss, the UI shows only an explicitly historical last-known snapshot plus the gate-loss reason; it makes no current progress claim and exposes no current interpretation or operational anomaly conclusion. Old-epoch jobs may seal for audit but cannot become current. Only read-only acquisition needed to produce a fresh assessment may run. Recovery requires a fresh live report for the current scope, displayed metrics, explicit threshold decision/confirmation, and explicit gate approval from the beginning; old gate authority is never reactivated.

## 26. Delivery interpretation

After the data-quality gate passes, an optional `deliveryInterpretation` run may start only when a deterministic anomaly identity first appears, its fact hash changes, it resolves, or a human explicitly requests interpretation of a current snapshot. Repeated identical observations do not create runs.

Lease mode is deterministic from lifecycle state:

- In `gated`, the scheduler may issue a Level 0 `shadow` interpretation lease after all continuing gates validate. Its input/output is marked `visibility: "shadow"`, stored only in immutable evaluation artifacts, and available only to the evaluation comparison view. It is excluded from the user-facing Delivery Map, progress/anomaly claims, GitHub/publication drafts, and operational current pointers. It cannot satisfy `gated -> pilot`, create Level 1 authority, or be promoted/re-labeled after the state changes; a visible result requires a new run.
- In `pilot` or `accepted`, the scheduler may issue a normal `visible` interpretation lease. Only validated output from this mode may populate the separately labeled interpretation area in the Delivery Map.
- In every other lifecycle state, no interpretation lease is permitted.

Immediately before either lease mode, the scheduler revalidates current `gated`/`pilot`/`accepted` delivery gate authority, canonical identity, evaluation epoch, metric thresholds, report age, and source freshness. Every run freezes its lease mode. Continuing-gate loss follows section 25 and revokes queued/running shadow and visible leases before transition commit.

It receives no repository source tree, no credential, and only a bounded snapshot plus application-created source/fact/anomaly catalogs. Its strict output is:

```json
{
  "schemaVersion": 1,
  "asOf": "ISO-8601 timestamp",
  "summary": {
    "statement": "string",
    "factRefs": ["fact_application_created_id"]
  },
  "risks": [
    {
      "severity": "high|medium|low",
      "statement": "string",
      "factRefs": ["fact_application_created_id"],
      "anomalyRefs": ["application_created_anomaly_id"],
      "inference": true
    }
  ],
  "unknowns": [
    {
      "statement": "string",
      "factRefs": ["fact_application_created_id"]
    }
  ]
}
```

Every statement cites current application-created facts. Unknown/invented/stale IDs, `asOf` mismatch, or unsupported claims fail validation. Output cannot alter scope, links, estimates, state, progress, anomaly lifecycle, or GitHub drafts. A visible-mode result is shown only as separately labeled interpretation; a shadow-mode result is never rendered in an operational/user-facing route.

## 27. Delivery Map, staleness, and failure

In `pilot` or `accepted`, the Delivery Map is a structured hierarchy showing exact provider scope, baseline, source freshness, hierarchy, work items, linked PR states, separate estimate/count metrics, scope movement, deterministic anomalies, and separately labeled visible-mode inferred risks. It displays the accepted data-quality payload/envelope and thresholds. In `gated`, the operational Delivery Map and progress claims remain disabled; only the gate report and evaluation-only shadow comparison route are available.

Provider or GitHub failure preserves last-known immutable snapshots as historical, marks freshness/degraded coverage, and never presents an unqualified all-clear. Scope, threshold, final report-payload hash, extractor binding, normalization, provider/schema, credential identity/permission, role, or harness changes alter the canonical delivery-intelligence capability-evaluation identity and invoke the atomic section 3 transition to `not_evaluated`; envelope-only changes do not. Dynamic metric/report-age/source-freshness gate loss uses the same-identity evaluation-epoch transition in section 25 for `gated`, `pilot`, and `accepted`. There is no separate quality-gate identity that can remain accepted. Delivery failure never blocks PR review or another capability.

## 28. 2C tests, rollout, and acceptance

Tests cover strict provider config including positive integer `stalledReviewSeconds`, pagination/checkpoints, credential isolation, source/fact ID reproducibility, ticket extraction and ambiguity, hierarchy/cycle fixtures, exact retrieval/progress scope, acquisition count/page-set/scope-hash reconciliation, required page/object/timestamp/permission/timeout omissions, unconditional incomplete-acquisition failure before policy evaluation, proof no operator policy can convert required missing data to `not_applicable`, closed policy-schema unknown/missing-field rejection, canonical reduced-rational/null representation, exact cross-multiplication and inclusive comparator ties, hierarchy reference-slot numerator/denominator and separate count rules, required empty-denominator failure, unsupported optional-concept and complete-acquisition empty-optional-denominator enums, blocked/allowed optional-only `not_applicable`, canonical integer-second report/GitHub/provider age calculations, acyclic report payload hashing that excludes identity/epoch/envelope fields, deterministic payload-hash reproduction, identity binding to payload hash, post-identity envelope binding, rejection of a circular/mismatched payload or envelope, operator-defined policy storage/evaluation with no product numeric defaults, immutable gate-authority binding, `gated` shadow versus `pilot`/`accepted` visible lease selection, shadow exclusion from Delivery Map/progress/publication/current pointers, no shadow promotion to Level 1 authority, monitor-before-projection/lease ordering, configured scope/policy/report-payload invalidation, current-metric regression, report-age expiry, missing/stale GitHub/provider observations, atomic same-identity `gated|pilot|accepted -> not_evaluated` epoch increment, revocation/cancellation of both lease modes, old-evidence archival/current-pointer clearing, no claims/jobs after gate loss, fresh-payload/envelope/full-regate recovery, snapshot `asOf`, baseline immutability, completion/canceled normalization, separate estimate/count math, stalled-review event reset coverage, UTC-second normalization, equal-second tie audit, exact `>=` boundary, unsupported provider comments, future/invalid timestamps, and unknown on missing required anchors/incomplete streams, anomaly identity/fact-hash transitions, interpretation trigger bounds/schema/fact validation, source disagreement, browser safety, and proof no Linear write exists.

Rollout:

1. Offline connector/normalization/reconciliation fixtures.
2. Live read-only acquisition in `not_evaluated`, with no progress/anomaly conclusions or interpretation.
3. Display and operator review of the initial measured data-quality payload, followed by explicit approval of the complete closed ratio/count/integer-second duration and exception/not-applicable policy to create the final operator-approved payload.
4. Compute the canonical identity and evaluation epoch from that final payload, create its post-identity envelope, evaluate the gate deterministically, and require explicit gate acceptance.
5. `gated` live Level 0 shadow `deliveryInterpretation` evaluation against the identity-bound `external_evidence` declared baseline, with no operational Delivery Map or visible interpretation.
6. Bounded Delivery Map/Level 1 interpretation pilot.
7. Explicit acceptance for the canonical delivery-intelligence capability-evaluation identity and active evaluation epoch.

2C is accepted only for its canonical delivery-intelligence capability-evaluation identity and active evaluation epoch when source/fact records and displayed hierarchy/links/math reconcile to the identity-bound acyclic payload/envelope, closed approved policy, and `external_evidence` declared-baseline payload; incomplete acquisition and required-data gaps are proven unconditional failures before optional policy, all ratio/count/duration outcomes and optional-only exception treatments reproduce deterministically with no implicit pass, the stalled-review clock reproduces from its exact event anchors and unknown rules, gated shadow outputs are proven evaluation-only and non-promotable, deterministic continuing-gate monitoring covers `gated`/`pilot`/`accepted` and atomically revokes both lease modes before stale/failing progress claims or jobs, visible interpretation adds measured value over deterministic presentation, and no regression occurs in deterministic math, provenance/fact authority, credential isolation, read-only Linear behavior, failure visibility, browser safety, or human authority.

# Phase 2D — Sandboxed Checks

## 29. Goal and concrete-check gate

2D runs at most one explicitly cataloged recurring check in an ephemeral Docker sandbox when accepted CI does not provide that evidence. It is independent of bot publication and all agent roles.

2D remains `disabled` or `deferred` unless the operator documents one concrete recurring check with:

- Repository ID.
- Real image pinned by digest and prepared before enablement.
- Exact command argument array.
- Expected evidence contract.
- Documented CI gap explaining why existing checks are insufficient.

If no qualifying check exists, `deferred` is the correct capability outcome. Phase 2 ships no default command and does not enable Docker merely because it is available.

## 30. Check catalog and preparation

`config/capabilities/sandbox-checks.json` owns this strict catalog type:

```typescript
type SandboxCheck = {
  id: string
  repositoryId: string
  image: string // ^[^@]+@sha256:[a-f0-9]{64}$
  command: [string, ...string[]]
  expectedEvidence: {
    exitCode: 0
    requiredOutputPatterns: string[]
    artifactPaths: string[]
  }
  ciGap: {
    statement: string
    evidenceRefs: string[]
  }
  timeoutSeconds: number // 1..900
  cpu: number // 0.5..2
  memoryMb: number // 256..4096
  pids: number // integer 1..512
  maxOutputBytes: number // integer 1..10485760
  scratchMaxBytes: number // integer 1..1073741824
  scratchMaxInodes: number // integer 1..100000
  network: "none"
}
```

Only one catalog entry may be enabled in Phase 2. Both scratch quotas are mandatory positive integers within the shown bounds. `requiredOutputPatterns` and `artifactPaths` each contain at most 20 values and at least one of the two arrays is non-empty. Output patterns are non-empty bounded literal strings of at most 256 UTF-8 bytes, not shell/regular-expression programs. Artifact paths use the canonical path contract and may identify only quota-bounded regular files under scratch output, never source.

An administrator explicitly prepares the pinned image before the check can enter `gated`. Preparation records image digest, architecture, acquisition time, registry source, scanner/attestation evidence when required by the approved implementation plan, image-declared volumes, read-only-root compatibility result, and local verification result. The digest-pinned prepared image must contain the trusted immutable supervisor/collector at the application-defined path; preparation verifies its bytes against the launcher-owned expected hash and records that path/hash in prepared-image verification. Registry credentials exist only in the preparation process and are never mounted or passed to a check.

Doctor validates Docker client/daemon/architecture/disk, support for hard byte and inode quotas on Docker tmpfs, private PID namespace/process-group control, container-cgroup membership inspection/kill/freeze fencing, the exact prepared digest and supervisor/collector path/hash, mandatory read-only container root, absence of image-declared/anonymous writable volumes, scratch-only write behavior, no-network execution, catalog schema, expected-evidence contract, and the documented CI gap. Enablement runs the prepared check's compatibility smoke with root filesystem read-only and one empty quota-bounded tmpfs scratch mount; the immutable supervisor launches fixture children that fork/daemonize, proves TERM/bounded-wait/KILL descendant quiescence through both process-table and cgroup checks, keeps the container alive with scratch immutable to untrusted processes, traverses live scratch safely, emits the framed artifact/status result, and demonstrates deterministic byte/inode exhaustion reporting. Any attempted write outside scratch, supervisor replacement/configurability, unproven descendant quiescence, collector/channel failure, incompatibility with read-only root or tmpfs quotas, or inability to detect exhaustion rejects the prepared image/check. A mutable tag, missing local digest, invalid/missing quota, unsupported tmpfs/cgroup control, supervisor hash mismatch, declared extra volume, command string, shell wrapper, missing evidence/CI gap, or second enabled check blocks activation.

An agent may recommend an existing catalog check by exact check ID and application provenance explaining the evidence gap. It cannot create/edit a check, create a command, select an image, or execute. Recommendations are Level 1 only and stale with the reviewed head/check-catalog hash. Human confirmation of the exact existing command remains mandatory.

## 31. Filtered input and execution

Before Docker starts, deterministic code:

1. Uses the exact reviewed SHA and inherited safe source materializer.
2. Applies the same compiled protected-path matcher and canonical path rules.
3. Excludes protected entries, symlinks, Git metadata, gitlinks/submodules, special files, unsafe paths, and all omitted source entries.
4. Copies only allowed regular blobs into a new read-only filtered input tree.
5. Writes a content-hashed manifest with repository/head SHA, matcher/pattern hashes, allowed blob hashes, and omitted path names/reasons but no omitted contents.

The launcher mounts only that filtered input and one application-created Docker tmpfs scratch filesystem with exact byte and inode limits. The administrative worktree, mirror, developer checkout, credential store, original source view, unbounded host directory, anonymous volume, and image-declared volume are excluded. Tmpfs scratch is the container's only writable mount; no alternate scratch backend is permitted. It:

- Creates one fresh container and an empty writable tmpfs scratch filesystem with both configured hard quotas.
- Starts only the verified immutable supervisor/collector as the container process. The supervisor launches the exact catalog argument array as an unprivileged child without a shell.
- Places the child and every descendant in a dedicated Unix process group inside the private container PID namespace and a dedicated untrusted child cgroup nested under the launcher-observed container cgroup; the trusted supervisor remains in the parent cgroup.
- Captures child stdout/stderr through private bounded pipes; the fixed framed launcher channel is held only by the supervisor and is not inherited by the child.
- Mounts filtered source read-only and scratch separately.
- Passes no host environment or credential mounts; it adds only `CI=true` and a `HOME` directory under scratch.
- Always starts Docker with the container root filesystem read-only. There is no compatibility exception.
- Uses `network=none`, unprivileged UID/GID, dropped capabilities, no-new-privileges, and bounded CPU/memory/PIDs/output/time/scratch bytes/scratch inodes.
- Denies host PID/IPC/devices, Docker socket, SSH agent, Keychain, `gh`, Cursor auth, package/cloud credentials, and additional mounts. Seccomp and dropped capabilities deny `setns`, `unshare`, namespace-creating clone flags, cgroup movement/control, and access to a writable cgroup filesystem, so untrusted descendants cannot escape to another PID namespace or cgroup.
- On direct-child exit, timeout, cancellation, or quota event, sends TERM to the entire untrusted process group, waits at most five seconds, sends KILL to the entire group and any remaining untrusted cgroup members, and applies the launcher cgroup fence. It then requires stable agreement from the private process table and cgroup membership that no process other than the trusted supervisor remains.
- Keeps the container and live tmpfs mounted after successful quiescence. No further untrusted process can start, and scratch is immutable with respect to untrusted code while the supervisor performs descriptor-relative no-follow collection.
- Sends the bounded framed command-status/artifact result to the parent through the fixed launcher output channel, then exits. Only after the parent receives or definitively fails that result does it remove the container and tmpfs; restart recovery follows the same inspect-before-remove rule when the supervisor is still recoverable.

The catalogued PR command cannot replace, configure, invoke, or bypass the supervisor/collector, choose the collection paths beyond the prevalidated catalog, write the framed result channel, move itself or descendants out of the controlled process group/cgroup/PID namespace, or keep the container alive. There is no dependency installation, image build, Compose, deployment, service stack, browser/E2E suite, network access, or arbitrary operator/agent command. Cursor and sandbox pools remain separate.

## 32. Evidence, state, and failure

Check identity is:

```text
check catalog entry hash
+ prepared image digest/verification hash
+ repository ID + reviewed head SHA
+ filtered input manifest hash
+ expected-evidence contract hash
```

Execution states are `queued`, `running`, `passed`, `failed`, `timed_out`, `resource_exhausted`, `collector_failed`, `cancelled`, and `unavailable`. New commits or catalog/image/evidence-contract changes make results stale.

Catalog, selected-check, prepared-image verification, limit, CI-gap, or expected-evidence changes also alter the canonical sandbox-checks capability-evaluation identity and invoke section 3 before another check job may start.

Output is capped, redacted, content-hashed, and stored as an immutable application-created check source/provenance record. The launcher and supervisor monitor tmpfs quotas independently of the child. Any byte/inode denial or exhaustion signal initiates full descendant quiescence while keeping the supervisor/container alive long enough to emit bounded status, then seals `resource_exhausted` with the exhausted resource and observed limit; it can never become `passed` or retry automatically, even if the direct child catches an error, exits zero, or leaves a daemonized descendant.

Only after quiescence succeeds, while the supervisor and live tmpfs remain mounted, the collector opens the now-untrusted-immutable scratch root once and resolves each configured artifact path beneath it with descriptor-relative, no-follow traversal. Every segment must remain canonical and beneath scratch; symlinks, files with link count other than one, special files, sockets/devices/FIFOs, path escapes, and non-regular final entries are rejected. Collected artifact count and total bytes must remain within `scratchMaxInodes` and `scratchMaxBytes`, while process output independently remains within `maxOutputBytes`; a traversal or bound violation fails evidence validation and never produces partial trusted artifacts. If process-table/cgroup checks disagree, membership changes during the stable-empty fence, or any untrusted descendant remains, the supervisor seals `collector_failed` with reason `descendants_not_quiesced`, does not open or trust any artifact, emits status only, and proceeds to teardown. Otherwise the collector writes only the fixed versioned bounded frame containing command status, artifact metadata/bytes, hashes, omissions, and failure state to the launcher channel. Missing/malformed/truncated frames, supervisor exit before collection, channel failure, or collection failure also seal `collector_failed`. `passed` requires proven quiescence, exact child exit-code, output, live-scratch artifact, and expected-evidence validation by parent application code. A missing required pattern/artifact, truncation that prevents validation, unsafe artifact, timeout, launcher failure, resource exhaustion, unproven quiescence, collector failure, or unavailable Docker cannot become a pass. Existing GitHub CI remains separately visible and is never overwritten or hidden.

There is no automatic execution, retry, or agent confirmation. A human previews check ID, digest, command array, repository/head, input omissions, limits, expected evidence, and CI gap, then confirms one run. Rerun and cancellation are explicit audited actions.

## 33. 2D tests, rollout, and acceptance

Tests cover lifecycle deferral with no qualifying check, strict one-entry catalog, mandatory bounded positive `scratchMaxBytes`/`scratchMaxInodes`, real digest/prepared-image and immutable supervisor path/hash binding, mandatory read-only root, rejection of an image that writes outside scratch or fails under read-only root/quotas, rejection of image-declared/anonymous/extra writable volumes and any non-tmpfs/unbounded scratch backend, argument arrays/no shell/unprivileged child, proof the catalogued command cannot replace/configure/bypass the supervisor or collector, expected-evidence validation, CI-gap requirement, canonical/protected/symlink/gitlink/special-file exclusion, input blob manifest, read-only source, proof quota-bounded tmpfs scratch is the only writable mount, dedicated process-group/container-cgroup membership, denied PID-namespace/cgroup escape, direct-child exit with daemonized/forked descendants, fork-during-TERM/KILL races, TERM/five-second-wait/KILL ordering on exit/timeout/cancellation/quota, stable process-table/cgroup-empty verification before collection, no collection and visible `collector_failed: descendants_not_quiesced` when proof fails, scratch immutability to untrusted code during collection, byte and inode exhaustion with distinct `resource_exhausted` state and supervisor status frame even after caught errors/zero exit, no automatic retry, container/tmpfs liveness through descriptor-relative no-follow collection, collection-before-supervisor-exit and teardown ordering, symlink/special/hard-link/path-escape rejection, aggregate artifact byte/inode bounds and independent output bounds, fixed frame/channel validation, distinct visible `collector_failed` behavior for supervisor/collector/channel/truncation failure, environment filtering, no network, non-root/drop-capability/no-new-privileges, Docker-socket/device/mount denial, CPU/memory/PID/time/output limits, cancellation, restart inspect-before-remove cleanup, stale identity, no automatic run, catalog-only recommendation, and credential leakage.

Rollout:

1. Approve the concrete check definition, documented CI gap, and `external_evidence` declared-baseline payload binding the existing CI/manual evidence contract, immutable evidence manifest, and check-comparison metric schema.
2. Prepare and verify the pinned image.
3. Offline malicious-input/launcher fixtures.
4. Evaluation-only evidence comparison against existing CI/manual results using explicitly human-confirmed runs, with no automatic execution or operational claim.
5. Bounded human-confirmed pilot for the one repository/check.
6. Explicit acceptance of the canonical sandbox-checks capability-evaluation identity and active evaluation epoch.

2D is accepted only for its canonical sandbox-checks capability-evaluation identity and active evaluation epoch when the identity-bound check provides incremental, reproducible evidence over its declared external-evidence baseline, every prepared image runs with mandatory read-only root and quota-bounded tmpfs scratch as its only writable mount, the verified immutable supervisor launches the unprivileged no-shell child in the controlled process group/cgroup, proves all descendants quiesced after exit/timeout/cancellation/quota, makes scratch immutable to untrusted code, and only then completes bounded no-follow/regular-file-only live-scratch collection before teardown; unproven quiescence, byte/inode exhaustion, and collector failure are visible terminal non-passing outcomes, and the capability cannot weaken canonical/protected-source safety, credential isolation, no-network/no-shell execution, resource bounds, evidence provenance, existing CI visibility, or human execution authority.

# Shared Governance

## 34. Governed policy improvement

Phase 2 formalizes `policyImprovement` as a named Cursor role over Phase 1 structured feedback. It is available independently of the four capability lifecycle states but can propose only changes relevant to installed features.

The only run trigger is an explicit human action selecting a target role/capability and bounded structured feedback. The application may display a deterministic “enough eligible feedback exists” notice based on an approved evaluation-plan rule, but that notice cannot start a run. Input is capped at 50 immutable historical runs or 2 MiB, includes accepted/edited/rejected outcomes and failures, and excludes credentials, protected content, raw environment, arbitrary repository source, and unrelated feedback.

The proposal identity includes selected-signal hash, target base-content/profile-version hashes, target role/capability, relevant corpus version/hash, immutable proposal-contract hash, exact `policyImprovement` model-specification hash, persona hash, and complete harness-manifest hash.

The strict proposal may target at most four versioned engineer-owned files from:

- `policy.json`.
- `persona.md`.
- `profile/capabilities/<capability>.json` when that profile capability schema marks the proposed field as engineer-owned.
- `harnesses/<feature>/prompt.md`.
- The feature's single allowlisted `harnesses/<feature>/skills/<skill>/SKILL.md`.

It returns complete replacement content, base hash, rationale, expected effect, risks, and replay-case references for each target. It cannot target application code, SQL, migrations, schemas, organization authority, local config, credentials, model specifications, permissions, protected paths, canonical matching, evidence/fact rules, publisher guards, autonomy levels, connector/executor code, or lifecycle records.

Every proposal stores immutable inputs, output, validation, exact line diff, and output hash. Before adoption, application code:

1. Validates strict schema, target allowlist, size bounds, base hashes, resulting policy/harness/persona schemas, and security invariants.
2. Builds the exact candidate nine-layer manifest for every affected role.
3. Replays the relevant versioned historical corpus with pinned inputs and exact configured role model specifications.
4. Stores every replay input/output/failure plus before/after role-specific metrics, manifest hashes, provenance validity, security validation, and comparison to the current accepted profile.
5. Runs deterministic capability-impact analysis from every changed file/field and candidate manifest to the canonical identity components in section 3. It records every affected/unaffected capability, old identity, candidate identity, changed component hashes, lifecycle consequence, and scheduler epoch. An unknown dependency or incomplete impact map blocks adoption.
6. Shows the exact complete preview, comparative metrics, regressions, failures, resulting content/profile hashes, and capability-impact report.
7. Requires explicit single-use adoption naming the proposal, base profile, exact file hashes, diff hash, replay result hash, resulting profile-version hash, impact-report hash, and every affected old/new capability identity.

Adoption creates a new immutable content-hashed profile version. In one SQLite transaction the application blocks new leases for every affected capability, rechecks proposal/base/impact hashes, creates each affected candidate identity in `not_evaluated` with epoch 1 when unseen or the next durable epoch when reused, creates its attempt context, supersedes only its prior `gated`, `pilot`, or `accepted` current record, invalidates its gated-shadow/pilot/acceptance authorization pointers, advances its scheduler epoch, and only then advances the active-profile pointer. The commit exposes the new profile and all affected invalidations together. After commit, new jobs snapshot the new profile and current canonical identity/epoch and only `not_evaluated`-permitted gate/Level 0 jobs may start until reevaluation.

Already created immutable queued/running jobs finish under their frozen old profile, canonical identity, evaluation epoch, and scheduler epoch. Their results remain old-epoch/identity history and cannot establish acceptance for a candidate identity/epoch. Capabilities absent from the impact report retain the same identity pointer, evaluation/scheduler epochs, and `accepted`/other lifecycle state. Rejection, failure, staleness, or transaction rollback changes neither profile nor any capability pointer.

Rollback is an explicit human action selecting a prior immutable profile version, previewing the exact reverse diff and affected roles, validating current base state, and running the same capability-impact/transactional invalidation protocol before creating a new audited active-pointer event. It is never automatic, never restores an old acceptance pointer merely because profile bytes recur, and does not rewrite history.

`policyImprovement` has no shell, write, delete, MCP, browser/network, source-view, provider credential, arbitrary code, or SQL execution. It cannot adopt its output, trigger another proposal, or run continuously. Proposal/replay/validation failure remains visible and disables adoption. This is governed proposal generation, not a self-editing loop.

Tests cover explicit trigger/bounds, feedback redaction and lineage, target allowlist, strict output, exact model/manifest/context/output/timing/usage/evaluation recording, schema/security validation, corpus selection, replay completeness, comparative metrics, deterministic complete impact mapping, unknown-dependency rejection, preview/impact hashes, stale base, single-use adoption, transactional affected-identity invalidation before new leases, immutable old-job completion without new-identity acceptance, unaffected accepted-capability preservation, immutable profile versions, rollback, no recursion, no execution, and no silent change.

Acceptance requires replayable audit reconstruction of inputs, proposal, diff, corpora, metrics, validation, preview, adoption/rollback actor and hashes; no adopted version may weaken deterministic coverage, provenance/fact authority, protected paths, credential isolation, browser safety, publisher/executor guards, or human authority.

## 35. Cross-capability failure isolation and security

Each capability has separate queues, leases, run kinds, health, migrations, feature flags, acceptance evidence, and disable controls. Shared Phase 1 worker/worktree limits are enforced globally. Exhaustion yields the capability-specific visible waiting or unavailable state and never reduced coverage unless an exact, audited human-approved reduced-coverage route is defined; for related-source capacity the only state is `waiting_for_source_capacity`.

- Specialist failure leaves Phase 1 primary review available.
- Bot failure leaves drafts and principal workflow available.
- Provider failure leaves code review and other capabilities available.
- Sandbox failure leaves GitHub CI and review available.
- Policy-improvement failure leaves the active profile unchanged.

No capability may catch a failure by silently downgrading coverage, substituting a model/identity/source, repairing links, relaxing a threshold, using stale evidence, exposing a credential, or granting more autonomy.

All newly rendered provider, specialist, bot, sandbox, feedback, and proposal text is untrusted and uses the inherited text/sanitized-Markdown/CSP/action-token boundary. State-changing controls use typed data, exact previews, same-origin checks, and single-use tokens.

## 36. Shared deterministic and security tests

Every capability implementation includes regression tests proving:

- Canonical identity serialization includes every required config/scope, enabled role, complete gate-manifest/schema, safety/provenance, non-secret credential identity/permission, capability-binding, migration, and exact `dbe_` declared-baseline payload hash; any component change invalidates only affected current `gated`/`pilot`/`accepted` evaluation transactionally before a new lease.
- Declared-baseline fixtures cover all three closed kinds, canonical hash/storage reproduction, stable ID and referenced-artifact validation, Phase 1/external contract-evidence bindings, accepted-capability prior sealed identity/acceptance binding, null/non-null kind rules, unknown/missing fields, immutable read-only storage, status component display, payload/reference change invalidation, and rejection of any current identity/epoch/envelope/output dependency or cyclic accepted-capability graph.
- Every identity-bound gate/evaluation artifact uses a canonical payload that excludes identity/epoch/envelope fields and a post-identity immutable envelope; circular hashes, envelope feedback, and payload/envelope mismatches are rejected.
- Human-approved `deferred -> not_evaluated` preserves the exact canonical identity, archives/clears authority, increments durable evaluation/scheduler epochs and attempt context, and reruns every gate; changed contract inputs are rejected from that path.
- Deterministic same-identity `gated|pilot|accepted -> not_evaluated` gate loss fences claims/jobs, archives shadow/pilot/acceptance authority, increments epochs, and invokes capability-specific stale/current-pointer clearing before commit.
- Existing immutable jobs finish only under their frozen old canonical identity/evaluation epoch and cannot establish new-identity/epoch acceptance; unaffected accepted capabilities and evaluation/scheduler epochs remain unchanged.
- Capability-owned config schemas and namespaced migrations install in every order without changing or reserving Phase 1/other capability schema versions or objects.
- Phase 1 All Tracked coverage, eligibility, deterministic queue order, and auto-analysis are unchanged.
- All path consumers use the same canonical matcher artifact/version and protected bytes never reach a new sink.
- Every agent citation resolves to application-created current provenance/facts or validated file provenance.
- Every enabled named role passes doctor and records exact model specification/effort/context, manifest/context/output hashes, timing, usage, and evaluation.
- Every attempt is immutable and sealed; retries create new attempts and guarded pointers never reference partial output.
- Credentials are available only in their owning deterministic subprocess boundary.
- Untrusted text cannot execute or alter authority-bearing UI controls.
- Self-reported confidence/recommendation cannot start a run, pass a gate, execute a check, publish, adopt, or change autonomy.
- Capability disable/failure does not disable or corrupt another accepted capability.

## 37. Independent rollout and acceptance reviews

Before implementation, each capability plan names:

- Exact immutable `declared-baseline-evaluation.json` payload: `phase1_contract`, `accepted_capability`, or `external_evidence`, with stable ID and all required contract/evidence/metric hashes.
- Capability configuration and migration ownership.
- Deterministic fixtures and role corpus where applicable.
- Incremental-value metrics and operator-approved thresholds.
- Safety/security non-regression gates.
- Pilot scope, rollback/disable procedure, and acceptance approver.

The common rollout shape is offline fixtures, historical comparison, live shadow/Level 0 where applicable, a bounded `pilot`, and explicit acceptance. A capability may stop at any stage as `rejected` or `deferred`. Acceptance is scoped only to the canonical capability-evaluation identity and active evaluation epoch; every contract-affecting change or continuing-gate loss uses the applicable atomic section 3 invalidation protocol.

No capability is allowed to claim incremental value merely because it produced more output. It must compare against its identity-bound declared-baseline payload and preserve or improve quality while proving no weakening of deterministic coverage, evidence provenance, source safety, credential isolation, failure visibility, browser safety, or human authority. A reevaluation may use `accepted_capability` only for an already sealed prior accepted identity; otherwise 2A/2B use their specified Phase 1 contract baselines and 2C/2D use their specified external-evidence baselines.

## 38. Phase 2 completion and explicit exclusions

There is no all-capabilities completion requirement. The implementation reports Phase 2 as healthy when:

- Phase 1 remains healthy.
- Every `gated`, `pilot`, or `accepted` capability satisfies the gates and scope for its current canonical capability-evaluation identity and active evaluation epoch.
- Every selected capability has an honest current lifecycle state and visible unmet gates/failures.
- Every unselected or unsuitable capability remains `disabled` or `deferred` without background work or authority.

Phase 2 does not authorize:

- Level 3 standing authorization.
- Autonomous approve, request-changes, merge, or principal disposition.
- Autonomous Linear or other delivery-provider writes.
- Agent-created or arbitrary commands, code, or SQL.
- Networked sandbox commands or dependency installation.
- Agent-controlled discovery, eligibility, queue hiding, progress, relationships, anomalies, or lifecycle.
- Briefings or a natural-language command bar.
- Automatic proposal generation/adoption, self-editing, recursive specialists, or silent learning.

Any such capability requires a separate approved design based on measured evidence. It cannot be introduced through configuration, a proposal, a model recommendation, or an implementation-plan shortcut.
