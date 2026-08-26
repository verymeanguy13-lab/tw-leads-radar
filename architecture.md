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

## Custom feature — 2026-08-18 (Email/password signup + verification)

**Not part of the original blueprint's 24 numbered sessions** — requested
directly, outside the session plan. Logged here for the same reason
everything else is: so a future session (or a future me) has the full
picture.

- Facebook login removed entirely (`lib/auth.ts`, `/login` page) — too
  much signup friction, per direct instruction. `authOptions.providers`
  is now exactly `['google', 'credentials']`, verified at runtime.
- Added email/password signup (`app/api/auth/signup/route.ts`,
  `app/(marketing)/signup/page.tsx`) with server-side validation
  (email format, password ≥8 chars, required business name/type) and
  bcrypt password hashing (12 rounds, `bcryptjs` - pure JS, no native
  compile step).
- `users` table gained 6 new nullable columns across two pushes:
  `password_hash`, `business_name`, `business_type` (signup itself),
  then `email_verified_at`, `verification_token_hash`,
  `verification_token_expires_at` (verification, added right after -
  the first version had no verification step at all, shipped, then
  corrected same-day once the gap was noticed).
- Email verification: SHA-256-hashed tokens (never the raw token) with
  a 24-hour expiry, sent via Resend
  (`lib/email/verification.ts`, reusing the established
  check-`result.error`-explicitly convention from Session 16's digest
  code). Login is blocked for unverified credentials accounts (a
  distinct `EmailNotVerified` error, not the generic wrong-password
  one) with a working resend button. Google accounts are auto-verified
  on first sign-in - Google already confirms email ownership, so
  there's no reason to make those users verify twice.
- `app/api/auth/resend-verification/route.ts` deliberately never
  reveals whether an email exists or is already verified - same
  response either way, to prevent account enumeration.
- Verified with the same rigor as every blueprint session: full clone,
  `tsc`, `eslint`, a runtime module-load check, and a full `next build`
  - all clean except the same two pre-existing unrelated errors
  (`layout.tsx`'s `LayoutProps`, one `any` in `lib/auth.ts` that
  predates this work). Manually tested live end-to-end (signup → block
  before verifying → email arrives → click link → verified banner →
  login works) - all 5 steps confirmed working.
- **Not built:** no cleanup for accounts that sign up but never click
  the verification link - they sit unverified forever with no expiry
  sweep. Low priority at current volume, flagged for whenever it
  becomes worth doing.
- **Fixed same day, shortly after this was logged:** the homepage's
  "免費開始使用" button was pointing at `/login` instead of the new
  `/signup` - corrected and confirmed live.

**Session 17 — Status / Staleness Flagging**
- [x] A dissolved/changed company already in a saved_search's results
      shows a visible flag in both the results table and the digest
      email
- No schema changes — used `search_matches.matched_at` and
  `companies.status_updated_at`, both already existed. A row is
  flagged when `status_updated_at > matched_at` (results table) or
  `status_updated_at > surfaced_at` (digest email) and the current
  status is `dissolved` or `changed` (not `suspended` — matches the
  blueprint's exact objective wording).
- Digest email gained a second possible section, 狀態異動通知, separate
  from 新符合結果. A saved search can now trigger a digest send purely
  from a status change, even with zero brand-new matches — worth
  knowing a tracked company dissolved even without new leads that
  week. After sending, a status-change row's `surfaced_at` resets, so
  the same change isn't re-flagged every subsequent run — only a
  further change would trigger it again.
- Distinct visually from the existing dissolved/suspended
  data-source-freshness note (Session 14/16) — that note answers "how
  fresh is the source data," this one answers "did this change since
  you started tracking it." Both can show on the same row if
  applicable.

**Session 18 — Paddle Integration**
- [x] Full checkout + webhook loop tested and working in Paddle SANDBOX —
      verified live with a real test transaction, not just code review
- [x] `subscriptions.tier` updates correctly on the relevant webhook
      events (`subscription.created`/`activated`/`updated`/`canceled`,
      `transaction.payment_failed`)
- [x] Checkout button has double-submit protection, verified with an
      actual rapid multi-click test (only one overlay ever opened)
- Uses a fresh Paddle account (the "Ching" and the support-created
  duplicate accounts were both abandoned — see the personal-account-setup
  discussion earlier this session, not repeated here since it's Paddle
  account admin, not app code).
- `app/api/webhooks/paddle/route.ts` verifies the `Paddle-Signature`
  header manually (HMAC-SHA256 over `${ts}:${rawBody}`, `timingSafeEqual`
  comparison) rather than pulling in the Paddle SDK — no new dependency,
  matches the project's existing lean-dependency style. Verified against
  5 real HMAC test cases (valid, wrong secret, tampered body, malformed
  header, stale timestamp) before ever touching real credentials.
  Timestamp tolerance is 5 minutes, not Paddle's own SDK default of 5
  seconds — deliberately looser to avoid false-rejecting legitimate
  webhooks over ordinary network delay; the HMAC match is the real
  security guarantee, the timestamp check is defense-in-depth against
  replay only.
- User linkage uses `customData: { userId }` passed at checkout time,
  echoed back in the webhook payload — not email matching, which could
  break on a typo or a different email used at Paddle checkout vs. the
  app account.
- Price → tier mapping is a lookup built from the 4
  `NEXT_PUBLIC_PADDLE_PRICE_*` env vars (B monthly/yearly → `pro`, C
  monthly/yearly → `business`) — if a 5th price or tier is ever added,
  this map needs updating too, it doesn't infer tier from price amount
  or name.
- **Two real bugs found only by testing live, not by writing/reviewing
  the code:**
  1. Checkout failed with `transaction_default_checkout_url_not_set`
     until a Default Payment Link was set in Paddle's dashboard
     (Checkout → Checkout Settings) — a one-time Paddle account
     configuration step, not something fixable in app code.
  2. The webhook silently failed every delivery (`308` response) because
     the webhook URL was registered as `taiwanleads.com` while the site's
     own DNS setup 308-redirects that bare domain to `www.taiwanleads.com`
     — Paddle does not follow redirects for webhook delivery. Fixed by
     registering the webhook against the `www` URL directly. Worth
     remembering for any *other* external service that calls this app's
     URLs directly (not through a browser, which follows redirects
     transparently) — always use the `www` form for server-to-server
     callback URLs.
- Not built this session, deliberately out of scope per the objectives
  checklist: 統一編號/VAT ID capture at checkout for B2B reverse-charge
  (mentioned in Section 7 as a general principle, not a Session 18
  checklist item) — flagged below as an open item rather than built
  prematurely.
- No schema changes — `subscriptions` already had every column needed.

**Session 19 — Tier Gating**
- [x] Free-tier limits enforced server-side — verified live with a real
      bypass attempt (`fetch()` directly against `/api/searches` from
      the browser console, skipping the form entirely). First attempt
      accidentally used an already-`pro` test account and correctly
      succeeded (expected - paid tiers are unlimited); re-tested against
      a genuinely free account already holding 7 leftover test searches
      and got a clean `403` with the correct Traditional Chinese message.
- `lib/tiers.ts` — `getUserTier()` only counts an `active`-status
  subscription; `past_due`/`canceled`/no-row-at-all all fall back to
  free. This means tier access is lost immediately on cancellation, not
  at the end of the already-paid period - matches how Session 18's
  webhook handler already behaves, deliberately not building a grace
  period.
- `canExportCsv()` is built and exported but not called from anywhere
  yet - nothing to gate until Session 20 builds actual CSV export.
  Wire it in immediately when that session starts, don't ship the
  export endpoint ungated even briefly.
- Cadence gating (`isCadenceAllowed`) and the search-count limit both
  live in `app/api/searches/route.ts` itself, not just the form UI -
  this is what makes the direct-fetch bypass attempt a real test and
  not theater.
- **Found while double-checking the spec, not a code bug:** the
  already-shipped Session 12 pricing page said free tier does
  `✗ 不支援儲存搜尋條件` (no saved-search support at all), contradicting
  Section 7 and Session 19's own spec text, which both consistently
  say **1** saved search for free tier. Session 12's own objective was
  literally "pricing page reflects the tier limits from Section 7" -
  it just didn't. Fixed the copy to say `✓ 1 組儲存搜尋條件（每週摘要）`,
  matching what's actually enforced.

**Session 20 — CSV Export**
- [x] Free-tier export blocked at the API level — verified live by
      clicking the new 匯出 CSV button on a free-tier account: clean
      Chinese error message (CSV 匯出僅限付費方案使用，請升級方案。),
      no file downloaded, no navigation to raw JSON.
- [x] Attribution credit line and per-row dissolution/suspension
      recency both present — verified by opening a real downloaded CSV
      in Notepad, not just checking that a file exists.
- Three real bugs found and fixed during actual testing, not just
  written and assumed correct:
  1. First draft of `route.ts` inferred dissolution-dataset freshness
     from `entity_type` (guessing company_dissolve vs business_dissolve).
     The results page (`page.tsx`) already solves this correctly per-row
     via each company's own `source_dataset` column — rewrote to match
     that existing pattern instead of inventing a parallel one.
  2. `freshAt.slice is not a function` at runtime — `ingestion_runs.
     completed_at` comes back from postgres.js as a `Date` object, not
     a string. Fixed by wrapping in `new Date(freshAt).toISOString()`
     before slicing.
  3. `ORDER BY c.registration_date DESC` (no `NULLS LAST`) put every
     company with no registration date on file at the *top* of the
     export — Postgres's default NULL ordering for DESC is NULLS FIRST,
     not last. Silently disagreed with `page.tsx`'s own query, which
     already has `NULLS LAST`. Caught by comparing the same company's
     row position between the live results page and a real export, not
     by inspection — the two were out of sync until this was added.
- No export button existed anywhere in the UI before this session -
  added `components/ExportCsvButton.tsx` (fetch + blob download, mirrors
  `RunNowButton.tsx`'s loading/message pattern) and wired it into
  `app/(app)/searches/[id]/page.tsx` next to 立即執行.
- CSV attribution lines reuse `DATASET_SOURCES` / the same Chinese
  wording as `DataAttribution.tsx`, scoped to only the datasets actually
  represented in that export - not a separately hardcoded string that
  could drift out of sync with the results page's attribution.
- No schema changes.

**Session 20b — Industry Code Enrichment (revised, CSV-based)**
- [x] All 43,599 pre-existing `entity_type='company'` rows checked
      against real GCIS data: 9,543 matched with real industry codes
      via a full production run against all 110 bulk CSV files,
      verified by querying the database directly (`matched with real
      codes: 9543`), not by trusting the script's own printed summary
      alone.
- [x] Automated refresh confirmed working end to end twice — a 2-file
      test run, then the full 110-file run (110/110 succeeded) — before
      being wired into the scheduled monthly job.
- [x] Failure alerting verified live: a fake failure file was fed to
      `send-refresh-alert.ts` and a real email confirmed to arrive,
      not just assumed from a non-error exit code.
- The original plan for this session (documented earlier in this
  blueprint) called two live per-company GCIS APIs, one confirmed
  working and one with an unconfirmed response shape, and hit a real
  registration wall requiring GCIS's formal IP-whitelisting process for
  sustained/automated use. That whole approach was abandoned mid-session
  (2026-08-23) in favor of GCIS's own bulk CSV downloads
  (公司登記混搭 CSV dataset category) — same underlying data, no
  per-company API calls, no registration. See the corrections-log entry
  for the full reasoning, including why `entity_type='business'` is
  explicitly out of scope (no equivalent complete CSV source exists for
  it — the 商業登記混搭 CSV category only covers 6 of Taiwan's cities and
  5 of 11 industry categories).
- The CSV download button on GCIS's site is JavaScript-triggered
  (`href="javascript:void(0)"`), not a plain URL — confirmed by reading
  the page's raw source, not by assumption. A real file-download URL
  (`data.gcis.nat.gov.tw/od/file?oid=...`) does exist and is a plain,
  script-fetchable link once you know it, but each file's oid is only
  generated client-side when the button is actually clicked and differs
  from the dataset page's own oid — there's no static mapping between
  the two. Rather than manually harvesting and hardcoding 110 oids (a
  real option that was considered and rejected), `scripts/refresh-industry-csv.ts`
  drives a real headless browser (Playwright) to click through each of
  the 110 dataset pages itself, every run — slower per-run, but immune
  to GCIS changing how oids are generated, and needs no pre-harvested
  list to maintain.
- `lib/ingestion/parse-industry-csv.ts` reads one downloaded CSV file
  and returns a `統一編號 → industry codes` map, distinguishing a
  uniform ID that's present with an empty array (the CSV had a row for
  it, but GCIS's own 行業代號 field was genuinely blank) from one absent
  entirely (not in this file at all — may just belong to a different
  city/letter file, or be too new for this refresh cycle). Both
  `scripts/backfill-industry-codes.ts` and the monthly job depend on
  this distinction being kept, not collapsed into a single "empty"
  state — same category of bug as the null-vs-empty-array issue the
  original per-company-API plan already ran into and fixed once.
- `industry_codes_checked_at` (added to `db/schema.sql` and to the live
  Neon database during the original, since-abandoned per-company-API
  attempt, before this session's revision) is NOT used by any of the
  code actually built or shipped in this session. The revised design
  doesn't need it: `scripts/backfill-industry-codes.ts` and the monthly
  refresh job both just re-check every row still `industry_codes = '{}'`
  each time they run, since re-parsing already-downloaded CSVs is cheap
  and CPU-bound, not rate-limited like the old per-company API calls
  were. The column was left in place rather than removed via a fresh
  migration (harmless as dead schema, and removing it wasn't worth the
  migration risk) — don't be misled into thinking it's load-bearing for
  anything; nothing reads or writes it going forward.
- New monthly scheduled job: `.github/workflows/refresh-industry-csv.yml`
  (runs the 10th of each month) — downloads all 110 files via
  `scripts/refresh-industry-csv.ts`, applies matches via
  `scripts/backfill-industry-codes.ts` (runs even if some downloads
  failed, so partial progress from the ones that succeeded still lands),
  then `scripts/send-refresh-alert.ts` emails `verymeanguy13@gmail.com`
  with concrete re-harvest/debugging instructions baked into the email
  body itself — only if a per-dataset failure actually occurred, not
  every run. A separate generic `if: failure()` step (matching the
  existing `ingest.yml`/`digest.yml` pattern already in this repo)
  covers any other unexpected job-level crash.
- Reused the project's existing Resend setup (`RESEND_API_KEY`,
  `EMAIL_FROM` — already configured since Session 5) for alerting
  rather than adding a second email mechanism. Hit the same Resend
  sandbox restriction Session 6 already documented (a non-domain-
  verified sender can only deliver to the account's own address) —
  worked around by using the account's own address as the alert
  recipient rather than pursuing domain verification now.
- Deliberate product decision, not an oversight: freshly-registered
  companies may show `industry_codes = '{}'` for up to roughly a month
  (GCIS's own refresh cadence for these CSV files, confirmed on the
  dataset page itself: 更新頻率 每月) after appearing in the app via the
  existing daily pipeline. This is NOT surfaced to end users anywhere
  (no "pending" tag, no disclaimer) — checked against this product's
  actual target customers (記帳士 and insurance agents), for whom
  industry classification is a secondary filter, not the primary reason
  they use the app. A saved_search with an industry filter selected
  simply won't match a row until its industry_codes populates, same as
  any filter behaves against not-yet-arrived data.
- Schema: no new migration in this session (the one column that exists,
  `industry_codes_checked_at`, predates this session's actual design —
  see above).

**Session 21 — Account & Billing Settings**
- [x] Cancel, upgrade, downgrade, and update-payment-method all
      verified against a real Paddle sandbox subscription (not just
      code review) — created via a real checkout on the live site
      (which already runs in Paddle sandbox mode), then tested locally:
      upgrade (pro -> business) confirmed via the webhook actually
      updating the DB tier afterward, downgrade button correctly
      appeared post-upgrade, and cancel-at-period-end showed the
      correct scheduled-end messaging with the right buttons
      hidden/shown.
- Cancellation policy decision (2026-08-24/25): cancel at period end
  (customer keeps access, Jason keeps the payment for the already-paid
  period) rather than immediate cutoff — standard SaaS practice, and
  simpler to build correctly. Implemented via Paddle's cancel API with
  `effective_from: "next_billing_period"` rather than relying on the
  hosted customer-portal's default cancel behavior, since that default
  isn't something this app controls or can verify explicitly.
- Verified against the actual webhook handler before relying on it:
  `resolveStatus()` in `app/api/webhooks/paddle/route.ts` reads only
  Paddle's `data.status` field, which stays `"active"` throughout the
  cancel-at-period-end grace window (Paddle tracks the pending
  cancellation separately via `scheduled_change`, which the handler
  doesn't check) — so this app's existing tier-gating logic correctly
  keeps working with zero changes needed, until the real
  `subscription.canceled` event fires at the actual period end.
- New file `lib/paddle-api.ts`: server-side Paddle Billing REST API
  client (separate from `components/CheckoutButton.tsx`'s client-side
  Paddle.js, which only handles new purchases). Requires a new secret,
  `PADDLE_API_KEY`, with the "Customer portal sessions (Write)"
  permission specifically — without it, `management_urls` on the
  subscription response comes back null/absent rather than erroring,
  which is easy to misdiagnose as a code bug rather than a permissions
  gap.
- Real bug caught and fixed during this session: the account page was
  first written using `next-auth/react`'s `useSession()`, which crashed
  immediately (`useSession must be wrapped in a <SessionProvider />`)
  — this app has no `SessionProvider` anywhere; every other page
  (e.g. the pricing page) gets the session server-side via
  `getServerSession()` instead. Fixed by splitting the account page
  into a server component (`app/(app)/account/page.tsx`, fetches the
  session and passes `userId`/`userEmail` down as props) and a client
  component (`AccountPageClient.tsx`, holds all the interactive
  fetch/button logic) — matching the same pattern the pricing page
  already uses for `CheckoutButton`.
- Local dev setup gap discovered and fixed during testing: `.env.local`
  was missing `NEXT_PUBLIC_PADDLE_ENV` and all four
  `NEXT_PUBLIC_PADDLE_PRICE_*` variables — they existed on Vercel
  (which is why checkout already worked on the live site) but were
  never copied into local dev. Missing `NEXT_PUBLIC_PADDLE_ENV`
  specifically caused real, confusing 403s (defaulted to calling
  Paddle's live API URL with a sandbox key) rather than an obviously
  related error — worth checking first if a future session hits an
  unexplained Paddle API 403 locally.
- Known limitation, deliberately not built: no "resume/undo
  cancellation" button. A safe, documented Paddle Billing API call for
  reversing a scheduled cancellation wasn't confirmed during this
  session, and this is real payment infrastructure — rather than guess,
  it was left out. If a customer wants to undo a cancellation before
  their period ends, that currently requires manual support
  intervention or simply letting the subscription lapse and
  re-subscribing.
- Schema: no changes.

**Session 22 — Maintenance Mode**
- [x] MAINTENANCE_MODE=true gates the whole app — verified all three
      states locally, not just code review: normal operation unchanged
      (pricing page loads without forced login, account page still
      shows the real logged-in session), maintenance-on (every page
      redirects to /maintenance, /api/account returns a proper JSON 503
      rather than a redirect or crash), and turning it back off
      restores normal behavior.
- Real risk caught before it shipped: `middleware.ts`'s matcher
  previously only covered `/searches`, `/account`, `/admin`. Broadening
  it to catch the whole app (needed so maintenance mode can gate
  everything) would have made `withAuth`'s default behavior start
  forcing a login redirect onto previously-public pages like `/pricing`
  too, since `withAuth` protects every route it's actually invoked
  against. Fixed by keeping the maintenance-mode check separate from
  the auth check: the auth check (`authMiddleware`) is now only
  actually invoked for the same three prefixes it always was
  (`PROTECTED_PREFIXES`), even though the middleware's matcher itself
  is now broad — verified locally that `/pricing` still loads without
  a login prompt.
- Schema: no changes.

## Known open items carried into Session 21+

- `companies.industry_codes_checked_at` exists in both `db/schema.sql`
  and the live Neon database but is unused dead schema as of Session
  20b's revised design (see that session's entry above for why) — not
  urgent to remove, but don't build new logic assuming it's populated
  or meaningful.

- RESOLVED 2026-08-24: the test `pro` subscription row (user id
  `3503f33c-486d-43c2-a63d-73fbc4f69193`, email verymeanguy13@gmail.com,
  paddle_subscription_id confirmed NULL before deletion) and
  verymeanguy11@gmail.com's 7 leftover "Test" saved searches (one with
  43,204 real matches) were both deleted via `scripts/check-test-data.ts`
  (read-only verification first) then `scripts/cleanup-test-data.ts`
  (the actual delete, re-checking the paddle_subscription_id safety
  condition itself rather than trusting the check script's earlier
  output). `search_matches` rows for the deleted searches were removed
  automatically via the existing `ON DELETE CASCADE`.

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
- `middleware.ts` uses Next.js's deprecated "middleware" convention
  (Next 16 wants "proxy" instead). Still works, just deprecated — low
  priority, but it's the file guarding `/searches`, `/account`,
  `/admin`, so don't let it linger indefinitely. Codemod available:
  `npx @next/codemod@canary middleware-to-proxy .`
- Unverified signups (email/password) never expire or get cleaned up —
  see the custom feature entry above.
- 統一編號/VAT ID capture at checkout (B2B reverse-charge VAT, per
  Section 7) is not built — see the Session 18 entry above.
- CORRECTED 2026-08-24/25 (documentation bug, not a code bug): this
  item claimed Tier gating (Session 19) didn't exist. It does — fully
  built and already verified elsewhere in this file (see the "Free-tier
  limits enforced server-side" checklist item, tested with a real
  direct-API bypass attempt). `lib/tiers.ts` (getUserTier,
  canCreateSavedSearch, isCadenceAllowed, canExportCsv) is wired into
  both `app/api/searches/route.ts` and the CSV export route. This stale
  note was simply never removed after Session 19 actually shipped —
  left here as a reminder to double-check "Known open items" against
  the real code before assuming something isn't built.