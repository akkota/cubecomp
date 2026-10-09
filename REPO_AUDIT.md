# Repository audit and remediation record

Updated: 2026-10-09. Baseline: `03d8813`. Status: confirmed application defects remediated locally; deployment and the manual checks below remain outstanding.

`REPO_AUDIT.md` was absent when implementation began. This document reconstructs the findings from the preceding audit and records their verification, fixes, and remaining limitations. Existing migrations `001`–`024` were preserved; repairs are forward migrations `025`–`027`.

## Scope and evidence

Reviewed the Next.js routes/components, server actions, Supabase clients and RLS/RPC migrations, standard round scoring/qualification, tournament generation and advancement, privacy/password flows, profile statistics, cubing integration, dependencies, and tests. Important paths were traced from UI through actions/RPCs to database constraints and reads. Installed Next.js documentation was consulted, including Server Actions and data-security guidance.

“Confirmed” means demonstrated by executable reproduction, database permissions/schema behavior, or an unambiguous code path. Dependency findings establish affected installed versions, not successful exploitation of a deployed site. Deployment configuration and production data were unavailable and are not assumed to match the local schema.

Database regressions execute actual application migrations in isolated PostgreSQL databases, with only Supabase auth/roles shimmed. Both an upgrade through the previous schema and a fresh install are exercised. Tests never use application Supabase credentials. Frontend production compilation passes; authenticated browser flows have not been exercised against Supabase.

## Prioritized findings

| ID | Priority | Finding | Status |
| --- | --- | --- | --- |
| A01 | Critical | Unauthenticated/ordinary users could invoke privileged tournament helpers | Fixed |
| A02 | Critical | Affected Next.js and vulnerable CLI dependency tree | Runtime fixed; development advisory remains |
| A03 | High | Direct solve inserts bypassed validation and competition boundaries | Fixed |
| A04 | High | Active rounds accepted solves/exposed scrambles after competition closure | Fixed |
| A05 | High | Private competition creation committed a public intermediate state | Fixed |
| A06 | High | Qualification used truncated results and failed open on verification-read errors | Fixed |
| A07 | High | Participant replacement and tournament activation could partially commit | Fixed |
| A08 | High | Generated tournament attempts could be scored without a fresh scramble | Fixed |
| A09 | High | Evidence corrections were inaccessible; qualification could become stale | Fixed |
| A10 | Medium | Pending format edits could invalidate generated scramble batches | Fixed |
| A11 | Medium | Browser URL normalization bypassed login redirect checks | Fixed |
| A12 | Medium | Password rotation removed registered users' tournament visibility | Fixed |
| A13 | Medium | Profile saving used UPSERT despite absent INSERT permission | Fixed |
| A14 | Medium | Personal bests mixed rounds/formats and ignored older results | Fixed |
| A15 | Medium | FMC/Multi-Blind offered results the time-only model cannot represent | Safely disabled for new/started play; historical data preserved |
| A16 | Medium | Head-to-head dashboard status and tournament live views became stale | Fixed |
| A17 | Medium | Password verification lacked an application database throttle | Fixed per account/competition; distributed abuse requires deployment review |
| A18 | Medium | Critical SQL paths and permission boundaries lacked executable coverage | Database/unit coverage and CI added; browser verification blocked |
| A19 | Low | Completed tournaments left an unnecessary reset final pending | Confirmed during remediation; fixed |

### A01 — Privileged tournament helpers (Critical, confirmed)

Locations: `supabase/migrations/019_fix_tournament_advancement.sql:47`, `:101`, `:224`, `:273`, `:382`; repair `supabase/migrations/025_audit_submission_integrity.sql:6`.

These SECURITY DEFINER helpers lacked caller authorization and inherited public EXECUTE privileges. The audit reproduced an ordinary participant awarding a solve win and removing a match competitor. Checking only the public action/RPC did not protect separately callable helpers.

Fix: revoke EXECUTE from PUBLIC, anon, and authenticated; callers use authorized public RPCs. Renamed implementation RPCs are also owner-only. Test: `tests/helpers/audit-database.mjs:29` checks permissions for both client roles and attempts an unauthorized call. Recommendation: keep helpers owner-only in future migrations and retain permission regression coverage.

### A02 — Dependencies (Critical installed-version risk, confirmed)

Locations: `package.json:24`, `package.json:41`, `package.json:45`, `package-lock.json`.

The baseline installed Next.js 16.2.11 fell within reported npm security advisories. The shadcn CLI tree also included a critical advisory through its server tooling; it was not imported into application request handlers. Severity describes the dependency advisory; a deployed exploit was not attempted.

Fix: update Next.js and eslint-config-next together to 16.4.0, update shadcn to 4.21.4 and compatible transitive dependencies, and move shadcn into devDependencies. Remove duplicate `tsx` declaration and synchronize the lockfile. Production audit now reports **zero** known advisories.

Unresolved: full `npm audit` reports **9 high advisory entries**, all through the development `braces` → micromatch/fast-glob tree used by ESLint/shadcn/ts-morph. These are dependency-path entries, not nine independent application exploits. The registry reports the braces advisory for all versions and offers no patched braces release; `npm audit fix --force` proposes an incompatible shadcn downgrade and still does not establish a safe ESLint replacement. Do not invent a patched version or apply that downgrade. Recommendation: track upstream remediation, update when available, and reassess before exposing those tools to untrusted glob-pattern input. CI gates production advisories separately.

### A03 — Solve integrity and bypass of server validation (High, confirmed)

Locations: `supabase/migrations/025_audit_submission_integrity.sql:30`, `:36`, `:53`; `src/actions/submitTimes.ts:8`.

Client table INSERT permission and RLS allowed requests that bypassed the action's validation. The audit inserted a negative time with an unrelated submitter and linked a round to a competitor from another competition. Separately, eligibility checks and inserts were not serialized with round state changes.

Fix: revoke client solve DML; submit through a transaction locking the round and checking authentication, competition identity, registration/qualification, open lifecycle, exact batch size, distinct attempt numbers, penalties, and positive integer times. The server supplies competitor and submitter identity. Add a time constraint and relationship trigger for future writes. Invalid batches roll back completely; concurrent identical submissions persist one batch.

Verification: malformed/negative/null/duplicate/cross-competition/ineligible submissions, duplicate retries, real concurrent clients, and direct table bypasses in `tests/helpers/audit-database.mjs:51` and `:73`. Historical invalid rows require administrator review; see deployment queries below.

### A04 — Closed competition access (High, confirmed)

Locations: `supabase/migrations/025_audit_submission_integrity.sql:11`, `:18`, `:62`; `supabase/migrations/026_audit_tournament_transactions.sql:18`.

Registration closure previously did not uniformly close submissions and registered scramble access while a round remained active. The audit reproduced access in expired/cancelled competitions.

Fix: central effective-lifecycle predicate gates standard submissions and non-admin scramble reads; tournament result/setup RPCs also require open competition state. Admin scramble review access remains available. Verification: expired and cancelled competition submissions fail, and an expired registered participant sees zero scrambles. Recommendation: deploy SQL together with the updated actions; UI state alone is not the access boundary.

### A05 — Atomic private creation (High, confirmed)

Locations: `src/components/competitions/create-form.tsx:120`; `supabase/migrations/025_audit_submission_integrity.sql:142`.

Creation previously committed a public competition before applying the private password and creating its events/rounds. Concurrent registration could observe public access; failures could leave a public or incomplete competition behind.

Fix: one RPC validates input and creates the competition, password hash, visibility, events, and rounds in one transaction. Private transitions are invisible until commit. Bad event/password/details roll back everything. Existing privacy management/password rotation RPCs remain supported. Verification: invalid later event leaves competition counts unchanged; successful private creation includes a secret and all rounds, with no client secret access.

### A06 — Complete qualification and fail-closed verification (High, confirmed)

Locations: `src/actions/calculateAdvancement.ts:6`; `supabase/migrations/025_audit_submission_integrity.sql:223`; `src/components/competitions/leaderboard.tsx:58`; `src/lib/pagination.ts:2`.

Unpaginated PostgREST solve reads silently truncated large rounds. A failed verification-setting read defaulted to verification disabled. Qualification could therefore omit competitors or accept unreviewed results.

Fix: aggregate/rank the complete round inside PostgreSQL and atomically replace the pending next-round participants. Check admin identity and verification settings inside the transaction; missing/pending reviews block calculation. Preserve submitted-competitor percentage semantics and all ties at the cutoff. Leaderboard solves, verification statuses, tournament setup (including resumed draft rosters), and review queues use stable paginated reads that throw on errors. Draft restoration failures show a retry path before exposing/persisting a partial roster.

Verification: a 211-competitor/1,055-solve fixture advances every cutoff tie; missing evidence blocks qualification; a later page failure cannot return a partial successful result. Recommendation: retain server-side qualification and bounded, ordered pages for display reads.

### A07 — Atomic tournament setup and lock order (High, confirmed partial-write defect)

Locations: `src/actions/tournament/index.ts:153`, `:259`, `:290`; `supabase/migrations/026_audit_tournament_transactions.sql:7`, `:47`, `:72`, `:101`.

Participant replacement deleted the old roster then inserted each row in separate requests, ignoring individual errors. Activation committed active status before creating playable sets/attempts. A later failure left partial state. Submit and undo also acquired child locks in different orders, creating a concurrency risk; a baseline deadlock was not reproduced.

Fix: validated roster replacement, activation, and match preparation RPCs commit atomically. Public tournament mutations lock the parent tournament before child rows. Owner-only implementation RPCs preserve the original advancement bodies; unsuccessful results/errors roll back their mutations. Revoke direct client DML on tournament children.

Verification: invalid replacement retains the old roster; missing activation scrambles leave status ready and zero sets; concurrent result submissions award exactly one win. Actual SQL traces cover byes, single/double elimination, loser routing, both grand-final paths, reset final, override/re-solve, and undo. Recommendation: preserve the common parent-lock ordering for future tournament mutations.

### A08 — Generated attempts without scrambles (High, confirmed)

Locations: `src/components/tournament/tournament-detail.tsx:149`, `:205`; `supabase/migrations/026_audit_tournament_transactions.sql:72`, `:123`.

The advancement RPC correctly queued a fresh attempt with a NULL scramble, but the repair effect returned early merely because set/attempt rows existed. Results could be submitted without showing a new scramble.

Fix: repair NULL-scramble generated attempts transactionally; never reuse the previous attempt's scramble. Require a scramble before completing/tieing a generated attempt, block UI submission while preparation is pending, and show preparation status. External scramble mode remains supported.

Verification: the SQL test scores an initial generated attempt, rejects the next attempt until prepared, then accepts a tie and re-solve. Recommendation: retain database enforcement even when the UI disables submission.

### A09 — Evidence correction and qualification snapshots (High, confirmed)

Locations: `src/app/competitions/[id]/events/[event]/round/[n]/page.tsx:487`; `src/actions/submitTimes.ts:18`; `supabase/migrations/025_audit_submission_integrity.sql:191`, `:223`; `supabase/migrations/027_audit_privacy_and_review_guards.sql:3`, `:20`.

Video entry disappeared after times were submitted; rejected evidence could not be corrected. Existing participant rows made advancement return “already calculated,” ignoring later review decisions.

Fix: independent evidence saving remains available after time submission and round completion. Validate HTTPS YouTube URLs at the database boundary. Replacing rejected evidence clears reviewer/rejection metadata and returns it to pending; verified evidence cannot be silently replaced. Admin review uses an authorized RPC in the same lock order. Evidence/review changes invalidate pending qualification. Starting a later round requires recalculation; evidence/reviews and qualification are then locked.

Verification: post-times evidence, invalid host rejection, rejected-video correction, unauthorized review, invalidation/recalculation, blocked stale next-round start, and locked later edits. Separate real RLS tests confirm only the author/admin can read video rows; public status payloads contain no URLs. Recommendation: complete all reviews before calculation/start; review changes intentionally require recalculation.

### A10 — Scramble/format consistency (Medium, confirmed)

Locations: `src/app/competitions/[id]/admin/page.tsx:723`; `src/lib/scramble.ts:150`; `supabase/migrations/025_audit_submission_integrity.sql:98`, `:129`.

Pending format edits could change Ao5 to Mo3 after generation. Generation reused any nonempty batch regardless of expected size, allowing an incomplete/incompatible round to start.

Fix: freeze format once scrambles exist or the round starts, serialize scramble insertion with format changes, validate stored/raced batch counts, propagate read failures, and require a complete batch before starting generated rounds. Lock scramble edits after start. Verification: format change and incomplete start fail; complete batch starts; wrong-size cached/concurrent batches and query errors are rejected by production helper tests.

### A11 — Login redirect normalization (Medium, confirmed)

Locations: `src/app/(auth)/login/page.tsx:12`; `src/lib/safe-redirect.ts:2`; `tests/audit-helpers.test.mjs:6`.

A raw leading-slash check accepted a slash followed by a backslash and external host; browser URL normalization can interpret this as an external URL.

Fix: reject backslashes/control characters, normalize with a fixed origin, and require that same origin before returning a relative path. Verification: external/protocol-relative/backslash/control-character cases reject; internal paths, queries, fragments, and encoded spaces work. Recommendation: reuse this helper for future caller-controlled redirect destinations.

### A12 — Registered private tournament visibility (Medium, confirmed)

Locations: `supabase/migrations/025_audit_submission_integrity.sql:178`; original `supabase/migrations/012_head_to_head.sql:177`.

Password rotation revoked remembered unlocks. Tournament visibility checked unlock/admin/public status but omitted competition registration, so already registered users lost access despite the product's registration contract.

Fix: include registration in tournament visibility. This preserves enrollment access without letting a password alone grant solve eligibility. Verification: registered participant can still SELECT their private tournament after password rotation revokes the unlock. Recommendation: preserve the distinction between remembered unlock and enrollment.

### A13 — Profile save failure (Medium, confirmed)

Locations: `src/app/profile/page.tsx:115`; `supabase/migrations/001_initial_schema.sql:145`.

UPSERT required INSERT permission/RLS even when a profile existed, while profiles are created by the auth trigger and clients only have an owner UPDATE policy. The audit reproduced the RLS failure.

Fix: UPDATE the authenticated user's existing row, select the updated ID to detect a missing row, report errors, and always clear saving state. No new profile INSERT grant is added. Verification: actual owner UPDATE succeeds and UPSERT remains rejected. Recommendation: repair any missing historical profile through reviewed administration rather than granting broad profile creation.

### A14 — Incorrect lifetime personal bests (Medium, confirmed)

Locations: `src/app/profile/page.tsx:77`; `supabase/migrations/026_audit_tournament_transactions.sql:143`.

Sliding windows combined solves from different rounds, used the WCA event default instead of each round's format, and considered only the latest 200 solves. This fabricated averages and lost older PBs.

Fix: compute authenticated-user lifetime PBs in PostgreSQL, grouping completed attempt batches by round and its actual format before taking minima. Separate Mo3/Ao5 entries and key their cards accordingly. History remains an explicitly labeled recent-50 view and no longer determines PBs. Verification: >1,000 solves, mixed formats, adversarial round-boundary values, and no cross-user stats leakage.

### A15 — Unsupported result models (Medium, confirmed)

Locations: `src/components/competitions/create-form.tsx:351`; `src/actions/tournament/index.ts:77`; `supabase/migrations/025_audit_submission_integrity.sql:65`, `:109`, `:166`; `supabase/migrations/026_audit_tournament_transactions.sql:79`.

Fewest Moves and Multi-Blind need move-count/attempted/solved/time scoring fields the millisecond-only model does not have. Offering them as ordinary timed results produced incorrect outcomes.

Fix: exclude these events from new competition selection; reject unsupported event creation/submission/start and tournament preparation/configuration. Keep existing event metadata, generation support, and historical rows intact. Recommendation: enable these events only after a separately designed result schema, scoring rules, forms, migration, and tests. Historical results cannot be reinterpreted safely without source evidence.

### A16 — Consistent lifecycle and live views (Medium, confirmed)

Locations: `src/app/dashboard/page.tsx:156`; `src/components/tournament/tournament-detail.tsx:85`, `:113`, `:135`; `src/components/competitions/leaderboard.tsx:127`; `supabase/migrations/027_audit_privacy_and_review_guards.sql:63`.

Dashboard status omitted tournament states even though shared status logic required them. Tournament detail fetched only on initial load/local actions; other admins and spectators saw stale brackets. Verification badges also did not refresh on review changes.

Fix: include tournament states in dashboard derivation; subscribe to relevant changes with 10-second polling/focus fallback; paginate result data and bound child IN lists. Subscribe leaderboard review updates as well as solve updates. Keep selection stable, bind entered drafts to an attempt ID, and ignore superseded fetch responses. Add tables to an existing explicit Supabase Realtime publication.

Verification: lifecycle helper tests, lint/type checks, production build, and actual SQL tournament transitions pass. Realtime delivery and browser presentation require staging verification; publication availability is deployment-specific. Recommendation: keep polling fallback even when Realtime is enabled.

### A17 — Password guessing protection (Medium, confirmed missing control)

Locations: `supabase/migrations/027_audit_privacy_and_review_guards.sql:37`; original `supabase/migrations/019_fix_tournament_advancement.sql:1247`.

Authenticated users could repeatedly invoke password verification without an application throttle. Deployment-level protections were not available for inspection.

Fix: durable, locked per-user/per-competition attempt windows; reject attempt 11 onward for 15 minutes. The original password function becomes owner-only, so direct RPC and registration routes share enforcement. The counter table has no client privileges. Verification: alternating unlock/registration attempts hit one limit; a later window permits the correct password. Recommendation: separately verify Supabase signup/CAPTCHA/edge controls for distributed guessing; a per-account throttle does not establish resistance to many accounts.

### A18 — Test and maintainability gaps (Medium, confirmed)

Locations: `tests/private-competitions-db.test.mjs:38`; `tests/helpers/audit-database.mjs:13`; `tests/event-selection.test.mjs:4`; `.github/workflows/checks.yml:1`; `package.json:11`.

Tests largely exercised a tournament simulator or source-text assertions; event selection tests used a copied helper. They could not detect permission bypasses, SQL/frontend divergence, partial writes, or real database lock behavior. Baseline lint also failed with 64 errors and 25 warnings.

Fix: test the production event-selection helper; add actual ordered-migration, authorization, privacy, integrity, transaction, concurrent-client, large-result and full-bracket regressions. Add production pagination/redirect/scramble-error tests. Type reviewed UI state and replace duplicated derived tournament state/preview effects; resolve baseline lint findings without global rule suppression. Two narrow documented suppressions cover browser-storage hydration and synchronous external-renderer failure reporting. Add a typecheck script and CI for lint, type checks, mandatory PostgreSQL tests, build, and production dependency audit.

Remaining: browser execution and deployment integration verification below. Existing simulator/source tests remain supplemental; successful tests do not prove exhaustive correctness or production configuration. Recommendation: run CI and staging smoke tests for each future access/scoring change.

### A19 — Unused reset final (Low, newly confirmed)

Locations: `supabase/migrations/019_fix_tournament_advancement.sql:293`; `supabase/migrations/026_audit_tournament_transactions.sql:133`.

The real SQL double-elimination trace showed the winners-bracket champion completing the tournament while the unused reset final stayed pending. This produced misleading bracket state.

Fix: mark an unused pending reset final void when the tournament completes. Existing reset activation and undo paths remain usable. Verification: complete actual-SQL traces for both grand-final paths and undo pass. Recommendation: retain these SQL traces alongside the simulator.

## Phased implementation plan and completion

| Phase | Work | Completion / remaining gate |
| --- | --- | --- |
| 1 — Security/privacy boundaries | A01–A05, A11–A12, A17; revoke helper/direct-write bypasses, validate atomic RPCs, patch runtime dependencies | Implemented and locally verified. Apply new migrations and deploy; development advisory remains upstream-blocked. |
| 2 — Correctness/data integrity | A06, A08–A10, A13–A15; qualification/review locks, formats, evidence, profile/PBs, unsupported models | Implemented and locally verified. Review historical data and recalculate pending qualifications. |
| 3 — Reliability/live behavior | A07, A16, A19; parent lock order, setup transactions, duplicate protection, paginated/live reads | Implemented; actual concurrent SQL clients and complete bracket paths pass. Verify hosted Realtime/auth/browser behavior in staging. |
| 4 — Regression and delivery controls | A18; production-helper tests, actual SQL coverage, lint/types/build/audit CI, documentation | Implemented; local checks below pass. GitHub-hosted workflow has not run from this workspace. |

No production migration, external account write, push, or deployment was performed. No destructive historical-data cleanup was attempted.

## Verification results

Final checks on 2026-10-09, using Node.js 25.2.1 and PostgreSQL 14.18 locally (CI selects Node.js 22):

| Check | Result | Scope / limits |
| --- | --- | --- |
| `npm ci` | Passed | Clean lockfile installation; checks repeated against the clean install. |
| `REQUIRE_DB_TESTS=1 npm test` | **152 passed, 0 failed, 0 skipped** | Includes actual PostgreSQL fresh/upgrade migrations, concurrent clients, private-video RLS, full bracket traces, generation workers, helper/unit tests. |
| `npm run lint` | Passed, no errors/warnings | Full repository ESLint; baseline failures resolved. |
| `npm run typecheck` | Passed | Strict TypeScript, no emitted application files. |
| `npm run build` / `npm run build -- --webpack` | Passed | Clean-install Turbopack build passed. After the final draft-pagination change, Turbopack's CSS worker hit a sandbox port-binding restriction; the final webpack production build passed with network access for the existing Google Fonts. Both use placeholder Supabase public environment values; no live Supabase requests used for validation. |
| `npm audit --omit=dev` | **0 vulnerabilities** | Production installed dependency tree. |
| Full `npm audit` | **9 high development dependency entries** | Unpatched braces dependency chain; see A02. |
| `git diff --check` | Passed | No whitespace errors. |
| Authenticated browser / hosted integrations | **Not completed** | Browser plugin initialization failed with `Importing module "node:process" is not allowed in node_repl`; no configured Supabase test project/credentials. |

The test runner's total includes nested database subtests. Database tests shim `auth.uid()`/roles and do not exercise GoTrue, HTTP PostgREST caching, Realtime transport, OAuth/email delivery, or the deployed UI. CI is checked in but its hosted execution is unverified.

## Deployment and manual attention

1. Back up the database. Confirm its migration history; apply only missing migrations, in order. A project already at `024` needs `025`, then `026`, then `027`. Preserve migration `024`'s pgcrypto repair and extension placement.
2. Apply the SQL before deploying this app version, using a coordinated maintenance/release window. The new UI requires the new RPCs; old code uses direct writes which the migrations deliberately revoke. Keep the older app from handling submissions during the transition. Do not roll back by reopening helper/client-write permissions.
3. Review existing data using the queries below. New time constraints are `NOT VALID` so migration does not fail or delete historical records. Correct/quarantine rows only with organizer/source evidence. Validate the time constraint when the review is complete. Relationship triggers enforce future writes; they do not certify existing rows.
4. Recalculate advancement for any completed round whose next round is pending. New `qualification_calculated_at` begins NULL for existing rows, so an old pending list must be freshly calculated before start. Resolve missing/pending evidence first. Started rounds are preserved and their review decisions are locked.
5. Inspect preexisting pending scramble batches. Wrong-size/partial batches now fail explicitly; after reviewed removal of a defective **pending** batch by a database administrator, regenerate the whole batch. Do not overwrite scrambles for started rounds.
6. Verify the Supabase publication and actual anon/authenticated grants in staging. The migration adds tables to an existing explicit `supabase_realtime` publication and leaves polling available when no publication exists. Confirm PostgREST has refreshed its schema cache and sees the new RPCs.
7. Run staged browser flows: signup/confirmation/login and unsafe redirect rejection; private standard/head-to-head creation; invite/password rotation; save profile settings; timer/manual +2/DNF results; post-submit evidence/rejection/correction; review/recalculate/start; two-admin tournament setup/result/tie/undo; spectator refresh with Realtime enabled and disabled; lifetime PBs across Mo3/Ao5.
8. Track the development advisory and verify hosted signup/rate-abuse settings. The app now limits attempts per account/competition, but deployment-level distributed protections have not been inspected.

### Historical data review queries (read-only)

```sql
-- Invalid times / null-penalty combinations. Do not infer corrected values.
SELECT id, round_id, competitor_id, penalty, time_ms
FROM public.solves
WHERE NOT (
  (penalty IN ('DNF', 'DNS') AND time_ms IS NULL) OR
  (penalty IN ('none', '+2') AND time_ms IS NOT NULL
    AND time_ms > 0 AND time_ms <= 2147481647)
);

-- Cross-competition relationships and attempts incompatible with format.
SELECT s.id, s.round_id, s.competitor_id, s.solve_number
FROM public.solves s
JOIN public.rounds r ON r.id = s.round_id
JOIN public.competition_events ce ON ce.id = r.competition_event_id
JOIN public.competitors c ON c.id = s.competitor_id
WHERE c.competition_id <> ce.competition_id
   OR s.solve_number > CASE WHEN COALESCE(r.round_format, ce.event_format) = 'mean' THEN 3 ELSE 5 END;

-- Incomplete historical submitted batches need evidence-based review.
SELECT s.round_id, s.competitor_id, count(*) AS attempts
FROM public.solves s
JOIN public.rounds r ON r.id = s.round_id
JOIN public.competition_events ce ON ce.id = r.competition_event_id
GROUP BY s.round_id, s.competitor_id, r.round_format, ce.event_format
HAVING count(*) <> CASE WHEN COALESCE(r.round_format, ce.event_format) = 'mean' THEN 3 ELSE 5 END;

-- Existing nonempty pending batches with the wrong attempt count.
SELECT r.id, count(sc.id) AS scrambles
FROM public.rounds r
JOIN public.competition_events ce ON ce.id = r.competition_event_id
JOIN public.competitions c ON c.id = ce.competition_id
LEFT JOIN public.scrambles sc ON sc.round_id = r.id
WHERE r.status = 'pending' AND c.generate_scrambles
GROUP BY r.id, ce.event_format
HAVING count(sc.id) > 0
   AND count(sc.id) <> CASE WHEN COALESCE(r.round_format, ce.event_format) = 'mean' THEN 3 ELSE 5 END;

-- Unsupported historical result models are preserved for manual disposition.
SELECT ce.competition_id, ce.id, ce.event_key
FROM public.competition_events ce
WHERE ce.event_key IN ('333fm', '333mbf');
```

After resolving time-constraint violations with evidence, an administrator can run:

```sql
ALTER TABLE public.solves VALIDATE CONSTRAINT solves_valid_time;
```

## Findings requiring further verification or product decisions

- **Private metadata semantics:** `supabase/migrations/009_private_competitions.sql:14` defines private as password-required registration. Competition/event/round metadata and some enrollment/qualification identifiers are still discoverable through existing read policies. This is confirmed visibility, but whether it violates intended privacy is **not established**. Video URLs/password hashes remain protected. Decide whether “private” also means hiding metadata/identities before changing discovery and RLS across the app; no speculative restriction was added.
- **Hosted auth/rate settings:** signup CAPTCHA, distributed throttling, email confirmation, redirect allowlists, and project-level protections cannot be verified from this repository. The local per-account throttle is tested; it does not prove these hosted controls exist.
- **Realtime deployment:** actual publication configuration, transport delivery, and delete-event visibility were not inspected remotely. App polling protects refresh behavior; staging must verify badges/brackets under the project's real policies.
- **Historical corruption:** the original bypasses could have produced invalid records, but production corruption is **not asserted**. No database access or source-of-truth evidence was supplied for safe repair. Run the review queries before treating old rankings/PBs as certified.
- **Performance at production volume:** pagination removes response-cap correctness bugs; SQL aggregation uses existing round/competitor indexes. Production query plans, large-bracket rendering, and network latency have not been benchmarked. No unsupported scalability claim or speculative index rewrite is made.
