# tw-leads-radar — Architecture & Session Log

Backfilled 2026-08-13 from the project blueprint (blueprint_updated_11.docx)
and the repo's own corrections log (Section 11), covering Sessions 1-12.
Updated 2026-08-13 (same day, second pass) to fix schema staleness and
record the daily-ingestion bug fixes and pricing-page redo.
Maintained going forward per-session alongside db/schema.sql.

## Stack

Next.js, TypeScript, Neon PostgreSQL, Vercel Hobby tier, Paddle billing,
NextAuth v4 (Google + Facebook OAuth as of the 2026-08-12 correction —
originally magic-link/email in Sessions 1-5, revised after Session 12).

## Schema (as of 2026-08-13 — corrected, previous version was missing two fields)

| Table | Key fields |
|---|---|
| **users** | id UUID PK, email UNIQUE, name, created_at |
| **subscriptions** | id UUID PK, user_id FK→users, paddle_customer_id, paddle_subscription_id UNIQUE, tier CHECK(free/pro/business), status CHECK(active/past_due/canceled/none), current_period_end |
| **companies** | uniform_id VARCHAR(8) PK (統一編號), entity_type CHECK(company/business), name, industry_codes TEXT[], capital NUMERIC, address_raw, address_region, address_district, responsible_person, registration_date DATE (source of truth for "new"), status CHECK(active/changed/dissolved/suspended), status_updated_at, source_dataset, source_month |
| **saved_searches** | id UUID PK, user_id FK→users, name, industry_codes TEXT[], regions TEXT[], capital_min/max NUMERIC, entity_type CHECK(company/business/both), keyword, cadence CHECK(weekly/monthly), paused BOOLEAN |
| **search_matches** | id UUID PK, saved_search_id FK, company_uniform_id FK, matched_at, surfaced_in_digest BOOLEAN, surfaced_at, UNIQUE(saved_search_id, company_uniform_id) |
| **ingestion_runs** | id UUID PK, dataset_name, source_month, **source_url** (added Session 6, was missing from this doc until 2026-08-13), row_count, new_count, updated_count, parse_failures, encoding_detected, status CHECK(running/success/failed/partial/**no_new_data** — 5th value added Session 6, was missing from this doc until 2026-08-13), error_log, started_at, completed_at |

RLS via `app_user` role + `app.current_user_id` session setting on
users/subscriptions/saved_searches/search_matches. `companies` and
`ingestion_runs` are not user-owned — gated at the app layer.

**Standing principle:** wherever `companies.status` is shown to a user,
an "active" reading must never imply more recency than the dissolution
dataset actually has — 商業歇業登記清冊 runs ~2 months behind the
registration datasets (confirmed in Session 11's corrections log).

## Data Flow

1. GitHub Actions (monthly) → `scripts/run-ingest.ts` → per dataset:
   `discover.ts` scrapes the data.gov.tw dataset page for the current
   latest-month CSV link → `fetch.ts` downloads it.
2. Raw files saved to scratch storage before parsing (never parse-on-stream).
3. Encoding detected + normalized per file (`normalize.ts`).
4. Address parsed into region/district (`lib/parsing/address.ts`).
5. Rows diffed against `companies` by `uniform_id` — insert if new
   (per `registration_date`), update status/fields if existing.
6. `ingestion_runs` row logged with counts and parse failures.
7. Matching engine runs `saved_searches` against newly-changed rows,
   populates `search_matches`.
8. GitHub Actions (weekly) → `scripts/run-digest.ts` — emails unsurfaced
   matches via Resend, marks surfaced.

Separately, as of 2026-08-12: a **daily** discovery pipeline
(`.github/workflows/ingest-daily.yml` → `scripts/run-ingest-daily.ts`)
queries GCIS's `Company_Setup_Date`-filtered API directly, confirmed
working unauthenticated — runs alongside the above monthly pipeline,
does not replace it. **公司 (company) entities only** — no equivalent
daily discovery endpoint exists for 商業 (business/sole-proprietorship)
entities, which stay monthly-only regardless of subscription tier.

Status for daily-ingested rows is derived from GCIS's structured
`Revoke_App_Date`/`Sus_Beg_Date`/`Sus_End_Date` fields, never by
matching `Company_Status_Desc` text — see the 2026-08-13 correction
below for why.

## Session Log — Sessions 1-12

**Session 1 — Project Setup**
- [x] Project scaffolded, pushed to GitHub, deployed on Vercel
- [x] All folders from Section 6 exist
- [x] `npm run build` succeeds

**Session 2 — Database Schema**
- [x] `db/schema.sql` created covering every table in Section 5
- [x] Schema runs in Neon, all indexes created
- [x] `lib/db.ts` sets `app.current_user_id` before every user-scoped query

**Session 3 — Design System**
- [x] `app/globals.css` has required CSS variables + font
- [x] `lib/utils.ts` exports `formatCapital`, `formatDate`, `cn`
- [x] Design tokens/spacing verified at mobile widths

**Session 4 — TypeScript Types**
- [x] `types/db.ts` has one interface per schema table
- [x] `types/api.ts` covers every API response shape needed

**Session 5 — NextAuth Setup**
- [x] Login/logout works end to end (originally magic-link; revised to
      Google + Facebook OAuth 2026-08-12, both providers tested live
      against real accounts)
- [x] `/(app)/*` routes blocked when logged out
- [x] `users` row created on first login, not duplicated on repeat
- Correction (Session 10): `callbackUrl` was hardcoded to `/searches`
  in the old magic-link flow — fixed by threading it through properly.
- Correction (2026-08-12): default fallback changed from `/searches`
  (never a real route) to `/searches/new` (the actual Session 13 page).

**Session 6 — Ingestion: Fetch Layer**
- [x] `discover.ts` scrapes all 6 data.gov.tw dataset pages for the
      latest-month CSV link — verified against 2+ real datasets
- [x] `sources.config.ts` lists all 6 dataset PAGE URLs, not direct
      CSV oid links (those are fixed to one month forever — see Section
      11 correction predating this session)
- [x] `fetch.ts` downloads to scratch storage, not parse-on-stream
- [x] `ingestion_runs` row created with `status='running'` before each
      download
- [x] `scripts/run-ingest.ts` runs standalone via tsx, no time limit
- [x] `.github/workflows/ingest.yml` triggers monthly
- [x] Failure notification exists, not just a dashboard to check
- Correction (Session 10): `run-ingest.ts` only ever called `fetch.ts`,
  never chained into `normalize.ts`/`upsert.ts` — fixed, re-verified
  end-to-end for real (not just recompiled).

**Session 7 — Ingestion: Encoding & Normalization**
- [x] `normalize.ts` correctly detects UTF-8 vs Big5
- [x] Every parse failure logged with the raw line, none silently dropped

**Session 8 — Address Parser**
- [x] `parseAddress()` handles all 22 縣市 plus both 台/臺 variants
- [x] Test file passes for 15+ real-format addresses
- [x] Unparseable addresses return null rather than a guess
- [x] District-level miss rate logged against the test set

**Session 9 — Diff & Status Logic**
- [x] New companies insert correctly; existing companies update in place
- [x] Status transitions apply correctly per `source_dataset`
- [x] "New" detection uses `registration_date`, not file-membership —
      directly proven against a real existing `uniform_id` (status
      flip confirmed, `registration_date` untouched via COALESCE)
- [x] Writes happen in chunked batches, not one row at a time

**Session 10 — Ingestion Admin Dashboard**
- [x] `/admin/ingestion` reachable only by the owner account
- [x] Dashboard flags a dataset that should have run this month
- [x] Dashboard shows last known-good `source_month` per dataset, plus
      the two pipeline/login fixes logged above

**Session 11 — Attribution Component**
- [x] Attribution renders correctly for all 6 datasets in the footer
      (visually verified in-browser, character-checked against the
      required 政府資料開放授權條款-第1版 credit line)
- [ ] Inline attribution anywhere company data is shown directly —
      explicitly deferred, not falsely marked done (per Session 11's
      own corrections entry) — STILL TRUE as of 2026-08-13, unchanged.

**Session 12 — Marketing Pages**
- [x] Landing page and pricing page **REDONE 2026-08-13** to reflect
      the real 3-tier freshness-gated model (方案A free/ads/30+ day
      data, 方案B NT$600/mo weekly-fresh, 方案C NT$1,300/mo daily-fresh)
      — the original flat monthly-only copy from initial Session 12 is
      fully superseded, not just noted as needing revision.
- [x] Privacy/Terms pages exist and linked in nav
- [x] All page copy in Traditional Chinese
- [x] No marketing copy frames the product around its data source
- **CAVEAT (still open as of 2026-08-13):** the pricing page's copy is
  now accurate, but the backend logic that actually enforces which
  tier sees which freshness of data does NOT exist yet anywhere in the
  app. No query currently checks a user's subscription tier before
  deciding what to show them. This is real, separate, unbuilt work —
  do not assume the pricing page describes a working feature.

## Corrections — 2026-08-13 (daily-ingestion review)

`scripts/run-ingest-daily.ts` was reviewed for the first time this day
and had one critical bug plus two real gaps, all fixed and verified
against a live test run (ROC date 1150813, 137 companies, 0 failures):

1. **CRITICAL:** `mapStatus()` matched `Company_Status_Desc` against
   corrupted/garbled placeholder text that could never match real API
   output — every row silently defaulted to `'active'` regardless of
   true status, with no error or log trace. Fixed by deriving status
   from GCIS's structured `Revoke_App_Date`/`Sus_Beg_Date`/`Sus_End_Date`
   fields instead of text-matching at all, since only one status value
   (核准設立 = active) had ever been confirmed against a real response —
   guessing the dissolved/suspended text would have risked repeating
   the same error class.
2. `parseAddress()` was never called — `address_region`/`address_district`
   stayed NULL for every daily-ingested row. Fixed; verified live (all
   137 new rows from the test run had `address_region` populated; ~185
   older rows from before the fix remain unparsed, a minor backfill
   item, not urgent).
3. The script read `process.env.NEON_DATABASE_URL`, inconsistent with
   every other file in the codebase (`DATABASE_URL`) — confirmed via a
   real failed local run. Fixed in both the script and
   `ingest-daily.yml`'s `env:` block (mapped the existing
   `NEON_DATABASE_URL` GitHub secret to `DATABASE_URL`, no new secret
   created).

Also fixed: `source_month` now uses the same "YYYY年MM月" format as the
monthly pipeline (was raw comma-joined ROC dates). Added
`gcis_daily_setup_query` to `lib/ingestion/sources.config.ts`'s
`DATASET_SOURCES` so the admin dashboard's freshness table picks it up.

**Session 13 — Saved Search Filter Builder**
- [x] Saved search form validates server-side, not just client-side —
      `app/api/searches/route.ts` checks name length, capital_min/max
      ordering, entity_type and cadence against allowed values
- [x] A saved search can be created and appears correctly in the database
- [x] All form labels, placeholders, and validation messages are
      Traditional Chinese

**Session 14 — Results Table**
- [x] Server-side pagination (20/page, `LIMIT`/`OFFSET` in SQL)
- [x] "Run now" actually re-triggers matching for just that saved_search —
      verified live, 773 real matches returned
- [x] Column headers, status badges, empty state — Traditional Chinese
- [x] Mobile (<768px): stacked cards, table `hidden` entirely below `md`
- [x] "資料更新日期" line sourced from most recent successful `ingestion_runs`
      row; dissolved/suspended badges carry their own recency note from
      that row's specific `source_dataset`, separate from the general line
- `lib/matching/engine.ts` (`matchSearch()`) was pulled forward from
  Session 15 — Session 14's own "Run now" objective can't be satisfied
  without it. It's idempotent (`ON CONFLICT DO NOTHING`) and deliberately
  does not filter on `industry_codes` (always empty on every company row,
  confirmed below Section 11 already). Session 15 only needs to add
  `matchAllSearches()` for the cron job — don't rebuild `matchSearch()`.

**Session 15 — Filter Matching Engine**
- [x] `matchSearch()` correctly upserts into `search_matches` without
      erroring on already-matched rows — already proven in Session 14
      (773 real matches, `ON CONFLICT DO NOTHING`)
- [x] `matchAllSearches()` skips paused saved_searches
- Wired into `scripts/run-ingest.ts` — every monthly ingestion run now
  automatically re-matches every active saved search, not just on manual
  "Run now" clicks. Not wired into `run-ingest-daily.ts` — daily-cadence
  saved searches don't exist yet (gated behind Session 19's tier system),
  so that would be premature scope, not an oversight.
- `matchAllSearches()` and `matchSearch()` both use plain `db()`, not
  `withUserContext()`, despite `lib/db.ts`'s comment saying
  `saved_searches`/`search_matches` should never be queried without it.
  This is deliberate and safe, not a bug: RLS on those tables is enabled
  via `ENABLE ROW LEVEL SECURITY` (not `FORCE`), so it does not restrict
  the table-owner role this app's `DATABASE_URL` connects as. Both
  functions genuinely need cross-user access (a saved-search-owning
  cron job, not one user's request), which `withUserContext` structurally
  can't express anyway. `lib/db.ts`'s comment is correct guidance for
  user-facing request code, not an absolute rule — future sessions
  should keep using `withUserContext` for anything request-scoped, but
  don't assume `db()` on these tables is broken; it isn't.

**Session 16 — Digest Emails**
- [x] Only genuinely unsurfaced matches are ever sent — filtered on
      `search_matches.surfaced_in_digest = false`, only marked `true`
      after Resend confirms no `result.error` (per the magic-link
      lesson below: Resend fails silently, never throws)
- [x] Saved searches with zero new matches are skipped, not emailed
      empty
- [x] Runs standalone via GitHub Actions
      (`npx tsx scripts/run-digest.ts`), not a Vercel route
- [x] Weekly cron (`.github/workflows/digest.yml`, mirrors `ingest.yml`)
- [x] Dissolved/suspended companies in the email carry their own
      recency note, same principle as the Session 14 results table
- `saved_searches.cadence` only supports `weekly`/`monthly` (see the
  cadence discussion below) but the cron itself only runs weekly. A
  `weekly` search is trivially due every run. A `monthly` search is
  derived as due when its most recent `search_matches.surfaced_at` is
  NULL or ≥28 days old — there's no `last_sent_at` column, this is
  computed from `search_matches` each run.
- 負責人 (responsible person) intentionally left out of the email content
  — a deliberate choice, not a spec requirement (the blueprint doesn't
  pin down exact email fields, unlike Session 14's table). One email per
  saved search (not a combined digest) if a user has several due at once.
- **Requires a `NEXTAUTH_URL` GitHub Actions secret** (used for the
  "view full results" link in the email body) — did not exist before
  this session, needs to be added manually in GitHub repo settings if
  not already done.
- Found and reused `app/api/auth/magic-link/route.ts` for the correct
  Resend calling convention — it's dead code (not wired into
  `lib/auth.ts`, which now only has Google/Facebook providers), leftover
  from before the magic-link approach was replaced. Harmless, not fixed,
  just flagged.

## Cadence clarification (not a bug)

`saved_searches.cadence` only allows `weekly`/`monthly` by design — this
matches Section 7's own note that tier boundaries are "finalized before
Session 18." A `daily` option (方案C, tied to the already-live
`gcis_daily_setup_query` pipeline) is intentionally deferred to
Session 19 (Tier Gating), not an oversight in Session 13's form.

## Corrections — 2026-08-16 (monthly ingestion loop crash)

`scripts/run-ingest.ts` iterated over every entry in `DATASET_SOURCES`,
including `gcis_daily_setup_query` — but that source is a live filterable
API endpoint (used only by `run-ingest-daily.ts`), not a data.gov.tw CSV
dataset. Treating it like the other 6 caused `discover.ts` to fail with
"no CSV links found" on every single monthly run, since June/July 2026,
without actually blocking the 6 real datasets from succeeding (GitHub
Actions still reported the whole job failed). Fixed by skipping
`gcis_daily_setup_query` in both `scripts/run-ingest.ts`'s loop and the
same latent (unused-but-present) bug in `lib/ingestion/fetch.ts`'s
`fetchAllDatasets()`. Verified live: a re-run after the fix succeeded
cleanly with July's backlog ingested (3,602+ new companies) and the
"Running saved_search matching..." step now visible in the log.

## Domain migration — 2026-08-16

Production domain changed from `tw-leads-radar.vercel.app` to
`taiwanleads.com` (Vercel nameservers, `www` as canonical). Resend
domain verified (DKIM/SPF/MX via Vercel's Resend auto-configure
integration) — `EMAIL_FROM` should now be `noreply@taiwanleads.com`,
not the old `resend.dev` shared sender, which could only ever deliver
to the account owner. `NEXTAUTH_URL` and Google/Facebook OAuth
redirect URIs updated to match. Confirmed working: login (both
providers), site load, and DNS all verified live after the switch.


**Real, live bug found via manual testing, not a Session 14 defect —
originated in Session 13's form.** `app/(app)/searches/new/page.tsx`'s
`REGIONS` dropdown listed `台北市`/`台中市`/`台南市`/`台東縣` using the
common 台 character variant. `companies.address_region` (populated by
every ingestion script since Session 6) always uses the formal 臺
variant — `臺北市`/`臺中市`/`臺南市`/`臺東縣`. Since these are different
characters to Postgres, any saved search selecting one of those 4
regions matched **zero companies, silently, with no error** — the "Run
now" button and the empty-state message both looked completely normal.

Fixed in `app/(app)/searches/new/page.tsx` (dropdown now uses 臺). Two
saved searches created before the fix ("Test", 省身公司) had the wrong
character baked into their `regions` column — corrected via a one-off
`UPDATE ... array_replace(...)` in Neon's SQL editor, not a migration
(no schema change, just bad data in existing rows). If any other saved
searches exist from before 2026-08-16, check their `regions` column for
the same 4 characters.

## Known open items carried into Session 17+

- CSV export (Session 20) is not built yet — users can only browse the
  results table or click through to Google Maps per row, no download.
- If the `NEXTAUTH_URL` GitHub Actions secret from Session 16 wasn't
  actually added yet, the digest email's "view full results" link will
  be broken even though sending itself works fine.
- `/searches` (bare index) is not a defined route anywhere in the
  blueprint — only `/searches/new` (Session 13) and `/searches/[id]`
  (Session 14) are ever specified. Not a bug; just don't expect a page
  at the bare path.
- Session 11's inline-attribution objective remains genuinely
  incomplete, not just unchecked.
- The freshness-tier enforcement logic (which tier sees which data)
  is not built — see Session 12's caveat above. This, not "pricing
  copy needs a rewrite," is the accurate current gap.
- A stray `cookies.txt` file was previously noted as committed at the
  repo root (leftover from manual API testing) — not independently
  re-verified in this pass; check and `.gitignore` it if still present.
- `middleware.ts` uses Next.js's deprecated "middleware" convention
  (Next 16 wants "proxy" instead). Still works, just deprecated — low
  priority, but it's the file guarding `/searches`, `/account`,
  `/admin`, so don't let it linger indefinitely. Codemod available:
  `npx @next/codemod@canary middleware-to-proxy .`