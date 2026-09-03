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

**Session 23 — QA Pass**
- [x] `npx tsc --noEmit` clean.
- [x] Full real ingestion cycle run end-to-end (`scripts/run-ingest-daily.ts`
      against live GCIS data) — 0 failures, both before and after this
      session's fixes.
- [x] Free-tier cadence-gating bypass re-verified live (not just
      assumed from code review, unlike the original Session 19 sign-off):
      a direct fetch() to POST /api/searches with cadence: "monthly" as
      a genuinely free-tier account got a clean 403 with the correct
      message.
- [x] Maintenance mode's write-blocking behavior — /api/account
      confirmed returning a proper JSON 503 while MAINTENANCE_MODE=true,
      not a redirect or crash.
- CRITICAL BUG found and fixed same session, not left for a future one:
  `saved_searches.industry_codes` stores GCIS's top-level letter
  categories (e.g. "A"), but `companies.industry_codes` — populated by
  Session 20b's CSV pipeline — only ever held fine-grained numeric
  codes (e.g. "011999"). These are two different GCIS classification
  systems that never overlap as array elements. Consequence: `matchSearch()`'s
  array-overlap check could never match an industry filter against
  anything, meaning **every saved search with an industry filter
  selected had returned zero results, for every user, since Session
  20b shipped** — a severe, silent, product-breaking bug that had
  gone undetected until this QA pass actually exercised a real search
  with a real industry filter rather than just checking the pipeline's
  own summary counts.
  - Fix: `lib/ingestion/parse-industry-csv.ts` now accepts an optional
    `letterToAppend` parameter and pushes it into each row's codes
    array — the letter is always recoverable from which of the 110
    city/category CSV files a company's row came from (filenames follow
    `${region}公司登記資料-${letter}${categoryName}.csv`), so no new
    data source was needed, just capturing information that was already
    implicitly available and previously thrown away.
  - `scripts/backfill-industry-codes.ts` changed to reprocess ALL
    `entity_type='company'` rows every run, not just ones with empty
    `industry_codes` — needed once, to retroactively add the missing
    letter to the ~19,614 rows already populated by earlier runs, and
    going forward this also keeps data correctly current if GCIS ever
    reclassifies a company. Cost is negligible (CPU-bound file parsing
    of 110 files, not rate-limited API calls).
  - Verified live, not just by code review: a real saved search
    (industry H, region 臺北市) went from 0 matches to 696 real matches
    after the fix and a re-run.
- MAJOR IMPROVEMENT found during the same investigation, not originally
  planned for this session: the live per-company GCIS industry API
  (`公司登記基本資料-應用三`, oid `236EE382-4942-41A9-BD03-CA0709025E7C`)
  from the ORIGINAL, since-abandoned Session 20b plan was re-tested and
  found to work fine at daily-discovery volume (~80-150 calls/day) —
  the registration wall that killed the original plan was specifically
  triggered by a 43,599-company HISTORICAL BULK BACKFILL in a short
  window, a fundamentally different load pattern than a small daily
  trickle of newly-discovered companies (the same order of magnitude as
  the existing `fetchProfile()` call in `run-ingest-daily.ts`, which
  already succeeds daily without issue). This API's `Business_Item`
  codes are a different, richer GCIS scheme than the CSV's numeric
  codes, and conveniently embed the top-level letter as the first
  character (e.g. `"I301010"` -> `I`) — confirmed live against a real
  company (統編 62118503) registered the day before, which the monthly
  CSV had nothing for yet but this live API returned full
  classification for immediately.
  - New file `lib/ingestion/fetch-live-industry.ts`: same null-vs-empty-
    array failure discipline as the original (pre-CSV-pivot) design,
    for the same reason that design got it wrong once already — null
    means "lookup failed," never treat it as "confirmed empty."
  - Wired into `run-ingest-daily.ts` for every newly-discovered company.
    `industry_codes` added back into that script's INSERT/ON CONFLICT
    (it had been deliberately removed from both when Session 20b was
    revised to the CSV-only approach) — the ON CONFLICT CASE ensures a
    later re-ingest of an existing company can never overwrite
    already-populated codes with an empty result from a failed live
    call.
  - Verified live: a fresh `run-ingest-daily.ts` run classified 20/20
    newly-discovered companies correctly, same day, with no rate-limit
    or registration-wall errors.
  - Practical effect: new companies now get real industry classification
    the same day they're discovered, not up to a month later. The
    monthly CSV bulk approach remains in place as the backfill path for
    the historical backlog and as a fallback if the live call ever
    fails on a given day.
- Added transparency copy on the search-creation form (near the 行業別
  checkboxes) and the search-results page, per Jason's explicit request
  — this reverses the earlier 2026-08-23 decision not to surface the
  freshness gap to end users. Copy was written, then rewritten again
  once the live-classification fix above made the original "up to a
  month" framing inaccurate — current copy reflects that new companies
  are same-day, only a shrinking historical backlog remains pending.
- Schema: no changes — both fixes write into the existing
  `industry_codes TEXT[]` column, no new columns needed.

## Known open items carried into Session 21+

- RESOLVED 2026-08-30: `companies.industry_codes_checked_at` removed
  entirely (`scripts/migrate-drop-industry-codes-checked-at.ts`) —
  confirmed via full codebase grep it was referenced nowhere except its
  own schema declaration before dropping it.

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
- RESOLVED 2026-08-27 (this was wrong — see the post-Session-23 entry
  below): this item previously said "/searches (bare index) is not a
  defined route... Not a bug; just don't expect a page at the bare
  path." That was true to the blueprint's spec but wrong in practice —
  it silently combined with the login page's callbackUrl default and
  free tier's 1-search limit to leave a real user unable to ever
  navigate back to their own saved search. Built now; see below.
- RESOLVED 2026-08-30 (was stale, not accurate at time of investigation):
  this note claimed Session 11's inline-attribution objective remained
  incomplete. On checking, it turned out to already be correctly and
  fully implemented on the results page and CSV export (both properly
  scoped to only datasets actually represented in the displayed rows,
  exactly per the blueprint's requirement) - this note was simply never
  updated after that work happened, same pattern as the earlier stale
  Session 19 note below. The ONE genuine gap found: the digest email
  had no attribution at all. Fixed, and consolidated the
  previously-duplicated attribution constants (defined independently,
  with different names, in both the results page and CSV export) into
  a single shared `lib/attribution.ts` used by all three now.
- RESOLVED 2026-09-03 (correction to the note directly above): "used by
  all three now" was written ahead of the code actually being done -
  `lib/email/digest.ts` had never been updated to import from
  `lib/attribution.ts`. This sat as an uncommitted, unpushed change on
  the development machine (along with the results-page and CSV-export
  updates) with the digest.ts half never finished, and was only caught
  when a routine "no results" bug investigation surfaced the stale
  working tree via `git status`. Finished now: `lib/email/digest.ts`
  imports `ATTRIBUTION_AGENCY`/`ATTRIBUTION_NAME_ZH` from
  `lib/attribution.ts` and renders the same credit line in the email
  footer, scoped to only the datasets actually represented among the
  rendered (non-overflow) rows - not yet verified with a real send, see
  Session 26's notes.
- RESOLVED 2026-08-27: the freshness-tier enforcement logic is now
  built — see the post-Session-23 entry below for the full story
  (it took three attempts to get right).
- RESOLVED 2026-08-30: `middleware.ts` renamed to `proxy.ts`, migrated
  to Next.js 16's "proxy" convention via `npx @next/codemod@canary
  middleware-to-proxy .`. Verified before applying, not just trusted
  blind: ran the codemod against a sandboxed copy first, confirmed the
  only actual change was the exported function name (`middleware` →
  `proxy` — everything else, including the `config` matcher export, was
  untouched), confirmed nothing else in the codebase referenced the old
  filename by path, and confirmed a clean project-wide type-check
  afterward.
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

## Post-Session-23 fixes — 2026-08-27 (freshness-tier gating, missing navigation, delete)

Not a numbered blueprint session — ad-hoc bug-fixing that came out of
attempting to verify the "Known open items" freshness-tier gap above,
before starting Session 24 (Deploy). Four real, separate bugs found and
fixed, in the order they surfaced:

**1. Freshness-tier gating was completely unenforced.** The pricing page
promises free tier only "30天以上之公司資料." Nothing checked this
anywhere — `matchSearch()` (`lib/matching/engine.ts`) had no tier
awareness at all. Fixed in three attempts, because the first two were
each wrong in a way that only showed up once tested against real data:

  - *Attempt 1:* gated on `companies.created_at`, and only at
    write-time (inside `matchSearch()`). This was wrong on two counts.
    First, `matchSearch()` only ever `INSERT`s into `search_matches`
    (`ON CONFLICT DO NOTHING`) and never deletes — every read path
    (results page, digest email) reads straight from that
    pre-computed table, so a write-time-only gate does nothing about
    matches that were already stored before the gate existed. Second,
    `created_at` measures when *we* imported a row, not how old the
    company itself is — meaningless as a freshness signal right after
    a bulk historical backfill, since nearly the whole table shares
    almost the same `created_at`.
  - *Attempt 2:* moved enforcement to read-time too (results page in
    `app/(app)/searches/[id]/page.tsx`, digest email in
    `lib/email/digest.ts`, in addition to the write-time gate) and
    switched the gated field to `registration_date` — the company's
    actual government registration date, already the documented
    "source of truth for new" per this file's schema table above.
    This immediately zeroed out a real free-tier test search. Turned
    out `registration_date` was `NULL` for most established companies:
    the `公司登記混搭 CSV` (used since Session 20b for industry-code
    enrichment) has always carried a `核准設立日期` column with the
    real date, but `parseIndustryCsv()` only ever extracted the
    uniform ID and industry codes — that column was parsed by nothing
    and discarded. The `company_new` government dataset doesn't have
    the retention to cover older companies either, so most established
    companies had no registration date captured from any source.
  - *Attempt 3 (final):* extended `parseIndustryCsv()` to also extract
    and parse `核准設立日期` (new shared parser at
    `lib/parsing/roc-date.ts`, replacing a private, less flexible
    duplicate that used to live in `lib/ingestion/normalize.ts`), and
    extended `scripts/backfill-industry-codes.ts` to also write
    `registration_date` (`COALESCE`d — only fills when currently
    `NULL`, never overwrites a known date). Verified live: re-ran the
    backfill against the existing downloaded CSVs, filled in 15,236
    previously-`NULL` registration dates out of 19,614 matched rows.
    Free-tier test search went from 21 stale-looking matches to 200+
    pages of realistic results correctly capped at ~30 days ago.
  - Final gate condition, applied identically at write-time (defense
    in depth — keeps `search_matches` from accumulating rows a free
    user shouldn't see in the first place) and at all three read
    points: `entity_type = 'business' OR NOT isFreeTier OR
    COALESCE(registration_date, created_at::date) <= (now() - interval
    '30 days')::date`. The `entity_type = 'business'` exemption matches
    the pricing page's own footnote — 商業 (獨資/合夥) data is monthly-
    cadence for every tier already, so gating it further would be
    meaningless.

**2. No way to navigate back to an existing saved search.** `/searches`
(the login page's redirect target) was never a real route — only
`/searches/new` and `/searches/[id]` existed, and there was no `GET` on
`/api/searches` either (only `POST`). The only way to ever reach a
saved search's results page was the one-time redirect right after
creating it, or a link in a digest email if one had been sent. This
affected every user, not just free tier — a paying user with several
searches had the same dead end. Combined with free tier's 1-search
limit and `login/page.tsx`'s callback default pointing to
`/searches/new` (not `/searches`), a free-tier user who'd already used
their one slot had no way to ever reach it again through the UI. Fixed:
added `GET /api/searches` and `app/(app)/searches/page.tsx` (lists a
user's own saved searches, RLS-scoped via `withUserContext`, same
pattern as everywhere else), and corrected `login/page.tsx`'s default
callbackUrl from `/searches/new` to `/searches`.

**3. No way to delete a saved search — at all, for anyone.** No
`DELETE` route existed under `/api/searches/[id]` (only `/run` and
`/export` sub-routes did), and no delete button existed anywhere.
Especially bad for free tier: the one saved-search slot was otherwise
permanent. Fixed: added `DELETE /api/searches/[id]/route.ts` (ownership-
checked via RLS, relies on `search_matches`'s existing `ON DELETE
CASCADE` for cleanup — no separate delete-matches query needed) and a
new `components/DeleteSearchButton.tsx`, wired into both the results
page and the new list page.

**Schema: no changes.** `registration_date DATE` already existed,
already nullable, already documented above as the intended source of
truth for "new" — this was a matter of actually populating and
enforcing against it, not a schema gap.

**Verified locally** against `verymeanguy11@gmail.com` (free) and a
paid test account, end to end: list page renders, Run Now updates
results, free tier's results correctly stop at ~30 days ago while paid
tier sees through today, delete removes a search and frees the slot.
**Not yet verified against production** — confirm the same checks there
after this is pushed and Vercel finishes deploying, before treating this
as closed.

## Post-Session-23 fixes, continued — 2026-08-30 (data gap + missing alerting; PDPA removal feature)

**1. PDPA data-removal request mechanism added.** New public form at
`/data-removal`, admin review queue at `/admin/data-removal-requests`
(requires manual approval — auto-applying a public removal request
would be trivially abusable by a competitor targeting a rival's
listing). Approving a request sets the new `companies.suppressed_at`
column, checked at write-time (`matchSearch()`) and all three read
points (results page, digest email) — same defense-in-depth pattern as
the freshness gate. This does not resolve the underlying open question
of whether repackaging public GCIS data for lead-generation use
satisfies PDPA's purpose-limitation requirement (see the
`shihjungching@gmail.com` account's conversation history for the fuller
discussion) — it exists regardless of how that resolves, since PDPA
gives individuals a right to request processing stop independent of
whether the original processing was lawful. Verified end-to-end in
production: submitted a real test request, approved it, confirmed the
company actually disappeared from a live saved search's results.

**2. Discovered an 11-day company-wide data gap: 2026-08-01 to
2026-08-11, zero companies with a registration_date in that window,
across the entire database, not just one filtered search.** Root cause:
a pipeline handoff gap between the old and new ingestion sources.
`company_new` (the periodic government bulk dataset, ~45-day cadence)
last covered through 2026-07-31; the new daily live-discovery pipeline
(`gcis_daily_setup_query`, wired into `run-ingest-daily.ts`) didn't
start reliably capturing new registrations until 2026-08-12. Nothing
was watching for new registrations in the 11 days between those two
sources' coverage. This will very likely self-correct once a future
monthly bulk release covering August is published and ingested
(~45-day cadence means possibly not until mid-to-late September) — not
fixed proactively, just noting it's expected to resolve on its own.
**Practical impact to watch for:** free tier's 30-day cutoff means this
exact window will become directly visible to free-tier users around
early-to-mid September — expect it to look like a real (accurate) gap
in their results, not a bug, if this hasn't self-corrected by then.

**3. Found and fixed a real alerting gap while investigating the above:
`ingest-daily.yml`'s only failure handling was a `::error::` log
annotation inside GitHub's own Actions UI — no email, no notification
that would actually reach a person.** This is the mechanism that let
the Aug 1–11 gap (and any future recurrence) go completely unnoticed
until someone happened to spot it in the product. Fixed by reusing the
exact same Resend-based failure-alert pattern `refresh-industry-csv.yml`
already had (a direct `curl` call to Resend's API using the
`RESEND_API_KEY` / `EMAIL_FROM` / `ALERT_EMAIL` GitHub Actions secrets
already configured for that workflow) rather than inventing a second
alerting mechanism. This matters more for paid tier than free tier:
paid customers see today's data with no buffer at all, so a silent
multi-day ingestion failure directly costs them the exact freshness
they're paying for, with no cushion the way free tier's 30-day gate
provides.

**Schema change:** `companies.suppressed_at TIMESTAMPTZ` (nullable,
indexed with a partial index `WHERE suppressed_at IS NOT NULL`) and new
table `data_removal_requests`. Migration:
`scripts/migrate-add-data-removal.ts` (idempotent, safe to re-run).

## Post-Session-23 fixes, continued — 2026-08-30, part 2 (silent industry-code/region fetch failures; self-healing retry)

Found while investigating a user-reported "date gap" in a filtered
search's results for 2026-08-12 to 2026-08-25 — initially assumed to be
sparse-filter variance, but turned out to be a real, previously-unknown
bug, worse than the already-logged 08-01/08-11 gap above because it was
silently ongoing, not a one-time historical hole.

**What was found:** `scripts/check-daily-pipeline-field-completeness.ts`
and `scripts/check-field-completeness-by-age.ts` (both one-off
diagnostics, kept in the repo) showed that `gcis_daily_setup_query`
-sourced companies registered 2026-08-18 through 2026-08-25 — six
straight days — had a **0% success rate** for fetching
`industry_codes`, and two isolated days (08-12, 08-14) had 0% for
`address_region`. The clean on/off pattern (0% then a sudden jump back
to ~100% on 08-26) ruled out "GCIS just hasn't processed very new
registrations yet" as the explanation (that would show gradual
improvement, not a binary switch) — this was a real fetch failure of
some kind, most likely on GCIS's side, though the exact cause was never
identified.

**Why nothing caught this at the time:** `fetch-live-industry.ts`
returns `null` on any failure, but `run-ingest-daily.ts` immediately
collapsed that into `liveIndustryCodesResult ?? []` — making "the API
call failed" and "this company genuinely has zero classified business
items" indistinguishable everywhere downstream. The job's own
`console.error` calls only went to that day's raw GitHub Actions log,
which nobody was reading line-by-line. Every affected day's
`ingestion_runs.status` still logged `'success'` — even the alerting
fix added earlier the same day (part 1, above) would NOT have caught
this, since it only fires on the whole job actually failing, not on a
step silently degrading while the job still exits 0. Compounding this:
`run-ingest-daily.ts` only ever processes "yesterday" and "today" — a
company that failed during this window was never going to be looked at
again by anything, ever, once those two days passed.

**Fix, in `scripts/run-ingest-daily.ts`:**
- Track `industryCodeAttempts`/`industryCodeSuccesses` and
  `regionAttempts`/`regionSuccesses` per run (a "success" requires
  actually getting a non-empty result back, not just the call not
  throwing).
- After each run, if either success rate falls below `DEGRADED_THRESHOLD`
  (50% — deliberately generous; the real incident sat at 0% for six
  days straight, nowhere near this line), the run is marked `'failed'`
  in `ingestion_runs` with a descriptive `error_log` even though no
  individual call threw an exception. This is what makes the
  Resend alert (part 1) actually fire for this failure mode — updated
  its email copy to explain the self-healing retry below and say
  "you probably don't need to do anything unless this keeps recurring
  for several days," rather than demanding manual action for something
  that mostly fixes itself.
- New `retryRecentGaps()` function, called at the end of every daily
  run regardless of that day's own success rate: finds up to
  `RETRY_CAP` (100 — deliberately kept in the same range as the
  already-proven-safe ~80-150/day discovery volume, not pushed higher
  just to clear a backlog faster, since GCIS's exact rate-limit
  thresholds aren't documented anywhere accessible) `entity_type =
  'company'` rows sourced from `gcis_daily_setup_query` in the last 14
  days still missing `address_region` and/or `industry_codes`, and
  re-attempts both live API calls for each. Only writes a field if the
  retry actually improved on what was there (`COALESCE`/cardinality
  checks in the `UPDATE`), never clobbers an already-good value. This
  is what turns "a multi-day outage" into something that heals itself
  over the following several days once the underlying cause clears,
  instead of leaving a permanent hole the way the 08-18/08-25 incident
  otherwise would have.

**Verified live:** manually triggered `ingest-daily.yml` after
deploying this — log showed `retryRecentGaps: attempting 100 companies
with missing fields... 100/100 improved`. 100% success on the retry
batch is a strong signal the underlying GCIS-side issue (whatever it
was) has genuinely resolved. Given the cap of 100/run and an estimated
backlog of roughly 800 affected companies from the original incident,
full catch-up will take several more days of scheduled runs, with no
action needed.

**No schema.sql changes** — this was entirely application-logic (new
function, new in-memory counters); no new columns or tables were
needed.

## Post-Session-23 fixes, continued — 2026-08-30, part 3 (real daily-cadence support; a much bigger hidden gap found while fixing it)

Prompted by the user directly asking whether the blueprint's promised
features were actually all implemented, using "daily notification" as
a named example. Investigation confirmed a real, complete, cross-stack
gap, and then surfaced something more severe underneath it.

**Finding 1 — Plan C's headline feature didn't exist anywhere.** The
pricing page names Plan C "每日方案" with "每日電子郵件摘要" as its main
differentiator over Plan B, priced at more than double Plan B's rate.
But `'daily'` did not exist as a valid cadence value ANYWHERE in the
stack: not in the `saved_searches.cadence` CHECK constraint, not in
`lib/tiers.ts`'s `Cadence` type or `TIER_LIMITS` (where `business` had
*identical* `allowedCadences` to `pro` — the two paid tiers were
functionally indistinguishable in every gated dimension), not in
`VALID_CADENCE` in the API route, not in the search-creation form's UI,
and not in the digest scheduler's due-date logic. Fixed across all of
those layers — see the code itself for specifics, comments are
thorough. Also fixed two other stale weekly/monthly-only spots found
during the sweep (`types/db.ts`, the `/searches` list page's
`CADENCE_LABEL` map) and a genuine syntax bug in `db/schema.sql`
unrelated to this fix but discovered while editing it: the file uses
invalid doubled single-quotes (`''weekly''`) throughout, which is not
valid executable SQL in this context — not fixed file-wide (out of
scope for this task), just not perpetuated in the new line added here.

**Finding 2 (bigger) — the digest workflow itself only ran once a
week, so daily cadence would have been undeliverable even with full
data-layer support.** Fixed by changing `digest.yml`'s cron to run
daily. This required also fixing `getDueSavedSearches()`, which
previously treated `'weekly'` as unconditionally "always due" — that
only produced correct once-a-week behavior as a side effect of the job
itself running weekly. Once the job runs daily, that same logic would
have emailed weekly-tier customers every single day. Rewrote it to use
real day-since-last-sent thresholds for every cadence uniformly
(`daily: 0.9`, `weekly: 6.5`, `monthly: 28` — set slightly below their
nominal period to tolerate normal GitHub Actions cron jitter without
risking a skipped day).

**Finding 3 (the real severity) — found while re-checking coherence
before telling the user this was done: `scripts/run-ingest-daily.ts`
never called `matchAllSearches()` at all.** Only the *monthly* bulk
ingestion (`scripts/run-ingest.ts`) did. This means every company the
daily live-discovery pipeline found was inserted into `companies` but
never automatically matched against any saved search's filters —
`search_matches` only ever got new rows from (a) a user manually
clicking "Run Now," or (b) the next monthly bulk run, up to ~45 days
later. This silently undermined the core promise of EVERY cadence, not
just the new daily one — a "weekly" digest customer was only ever
getting matches that existed at whatever point they'd last manually
re-run their own search, not anything approaching real automatic
weekly freshness. Fixed by adding a `matchAllSearches()` call at the
end of `run-ingest-daily.ts`'s `main()`, after ingestion and the
self-healing retry step. Safe to run daily with no rate-limit
concern — `matchSearch()` only queries this project's own database, it
makes no external GCIS API calls at all, unlike the profile/industry
fetches earlier in the same script.

**Status: all three findings fixed and type-checked. NOT YET deployed
or verified live** — this session ended with the user about to apply
and test the patch. A future session should confirm: (1) the migration
ran cleanly, (2) a business-tier test account can select and receive a
genuinely daily digest, (3) a lower-tier account still only gets
weekly/monthly as before (not suddenly daily), and — most
importantly — that newly-discovered companies from the daily pipeline
now actually show up as fresh matches without anyone manually clicking
Run Now.

**No schema changes beyond the CHECK constraint update** (migration:
`scripts/migrate-add-daily-cadence.ts`, idempotent, looks up the real
constraint name via `pg_constraint` rather than assuming it).

**Finding 4 — found during a SECOND coherence recheck, requested again
by the user before applying anything: a real race condition between
the two daily workflows.** `digest.yml` had been changed to run at
`0 22 * * *` — the exact same time as `ingest-daily.yml`. GitHub
Actions gives no ordering guarantee between two independently-triggered
workflows scheduled at the same time, so `digest.yml` could easily have
finished and sent emails *before* `ingest-daily.yml`'s new
`matchAllSearches()` call (Finding 3) had updated that day's matches -
silently defeating the entire point of today's work on the first day it
ran. Fixed by moving `digest.yml` to `0 23 * * *` (1 hour after
`ingest-daily.yml` starts), with cross-reference comments in both files
so a future schedule change to one doesn't quietly break the other.

Also found in the same pass: `ingest-daily.yml`'s existing
`timeout-minutes: 10` no longer had adequate headroom once
`retryRecentGaps()` (up to 100 extra live API calls) and
`matchAllSearches()` were added to the end of its run - a slow day
could now plausibly approach or exceed 10 minutes, and a timeout kills
the process mid-execution rather than letting it exit gracefully (the
final `INSERT INTO ingestion_runs` never runs in that case). Raised to
20 minutes.

## Post-Session-23 fixes, continued — 2026-08-30, part 5 (schema.sql was not valid SQL)

RESOLVED: `db/schema.sql` had invalid doubled single-quotes
(`''weekly''` instead of `'weekly'`) throughout the entire file — 66
occurrences, first noticed in part 3 above but only fixed on the one
line being edited at the time. This was not valid, directly-executable
SQL in this context; running it via `psql -f` would have failed
immediately on the first CHECK constraint it hit.

Fixed with a global find-replace (confirmed no ambiguous 3+ consecutive
quote sequences existed anywhere first, so the replace was
unambiguous). Verified properly, not just visually: installed Postgres
16 locally, created a scratch database, and ran the actual file
end-to-end via `psql -f db/schema.sql` — every statement succeeded
(every `CREATE TABLE`, `CREATE INDEX`, `CREATE ROLE`, `ALTER TABLE`,
`CREATE POLICY`, `GRANT`), and `\dt` confirmed all 7 expected tables
were created correctly, including `data_removal_requests`. This is
strong evidence the file has been broken like this for a long time —
long enough to predate this session entirely — without anyone
noticing, presumably because the live database was built up
incrementally through individual migration scripts (which all use
correct syntax) rather than by ever actually executing this file
directly.

## Background-job reliability: 504 retry-with-backoff and a digest watchdog — 2026-09-03

Two carried-over reliability items, addressed together at the user's
request.

**Discovery/Profile API retry-with-backoff.** `scripts/run-ingest-daily.ts`'s
`fetchDiscoveryPage()` and `fetchProfile()` previously threw immediately
on any non-OK HTTP response, including transient GCIS 502/503/504
gateway errors. Worse than it looked: `fetchAllForDate()` (which calls
`fetchDiscoveryPage()`) is called OUTSIDE `ingestDate()`'s per-row
try/catch, and `main()`'s `for (const rocDate of dates)` loop had no
per-date recovery either — so a single transient 504 on the FIRST date
processed (`yesterdayRocDate()`) killed the entire run: the second date
was never attempted, and neither were `retryRecentGaps()` or
`matchAllSearches()`, since both sit after the loop in the same try
block. Since `main()` only ever looks at "yesterday" and "today", a
failure on yesterday's date was never revisited by any future run —
that date's newly-registered companies would be silently, permanently
missed, not just delayed a day as the "self-healing" framing implied.

Fixed two ways:
1. Added `fetchWithRetry()` — retries up to 4 attempts with exponential
   backoff (2s/4s/8s) on 429 and any 5xx status, or a network-level
   failure (timeout, DNS, connection reset). Non-retryable 4xx statuses
   still fail immediately. Both `fetchDiscoveryPage()` and
   `fetchProfile()` now go through this.
2. Added a per-date try/catch inside `main()`'s loop, so if a date's
   `ingestDate()` call still fails after all retries are exhausted, the
   OTHER date is still attempted, and `retryRecentGaps()` +
   `matchAllSearches()` still run afterward. `status`/`errorLog` are set
   the same way the existing degraded-rate check already did, and that
   check was changed to append to `errorLog` rather than overwrite it,
   so both a per-date failure and a degraded rate in the same run are
   both preserved in the logged row instead of the second clobbering the
   first.

No new "used to fail silently, still does" gap intentionally left open
here — `fetchLiveIndustryCodes()` (a separate file,
`lib/ingestion/fetch-live-industry.ts`) was NOT touched. Its failures
already degrade gracefully to `null` → empty `industry_codes` array
rather than throwing, and are already caught by the existing
`industryCodeAttempts`/`industryCodeSuccesses` degraded-rate detection —
a different, already-adequate safety net for a different failure shape.

**Digest watchdog (the "did it actually run" detector).** Session 25
found `digest.yml` silently didn't run for 2 real days (2026-09-01 to
09-02) with nothing anywhere flagging it. `digest.yml` already had an
`if: failure()` alert step, but that can only fire when the workflow
actually runs and then fails — it has no way to catch GitHub Actions
simply never triggering the scheduled run at all, since no run object
ever exists for that step to attach to in that case.

Fixed with an independent, separately-scheduled check rather than
anything inside `digest.yml` itself (an internal check has the same
"never runs" blind spot as the alert step does):

- New table `digest_runs` (migration: `scripts/migrate-add-digest-runs.ts`,
  idempotent, same pattern as `migrate-add-daily-cadence.ts`) — mirrors
  `ingestion_runs`. `scripts/run-digest.ts` was restructured to wrap its
  existing logic in a try/catch and insert one row here on every actual
  execution (success, partial, or a caught crash), inside its own nested
  try/catch so a logging failure can never mask or crash out of the real
  run result.
- New script `scripts/check-digest-ran.ts` queries `digest_runs` for any
  row in the last 8 hours. If one exists, exits cleanly. If not, it sends
  its own alert email (reusing the existing Resend/`EMAIL_FROM`/
  `ALERT_EMAIL` setup, same as `send-refresh-alert.ts`) explaining that
  the scheduled workflow itself appears to not have fired, then exits 1
  so the Actions run also shows red as a second signal.
- New workflow `.github/workflows/digest-watchdog.yml`, scheduled
  `0 2 * * *` UTC — a few hours after `digest.yml`'s own 23:00 UTC start,
  comfortable buffer past when both `ingest-daily.yml` and `digest.yml`
  normally finish (minutes, not hours) without being so tight it could
  false-alarm on a slow day. Runs completely independently of
  `digest.yml`'s own trigger, which is the entire point.

Deployed, type-checked, and verified live via manual `workflow_dispatch`
runs (not just the code being trusted): "Digest" was triggered manually,
ran green, and sent real digest emails to the user's kept test searches
— confirming both the digest cadence system itself AND that it now
writes a `digest_runs` row. "Digest Watchdog" was then triggered
manually right after and also ran green, confirming it correctly found
that fresh row and did not false-alarm. The alert path itself (no row
found → email sent, red run) was NOT separately tested — lower priority
to verify deliberately, since triggering it for real means either
waiting for an actual gap or briefly disabling `digest.yml`, and the OK
path being correct is the one that matters day-to-day.

## VAT ID (統一編號) capture-and-store — 2026-09-03

Addressed the last carried-over item this session, item #3 on the
priority list: "統一編號/VAT ID capture at checkout (B2B reverse-charge
VAT, blueprint Section 7)." The actual "Section 7" spec document this
references was not found anywhere in the repo when this session looked
for it — only mentioned by name in this file's own earlier entries — so
its exact requirements are unverifiable at this point.

Before building anything, flagged an important distinction to the user:
Paddle's checkout overlay has built-in support for collecting a business
customer's name + tax ID directly (`components/CheckoutButton.tsx`
already loads `paddle.js` and calls `Checkout.open()`), but Paddle's
reverse-charge tax handling is built around the EU/UK VAT framework —
not necessarily the right mechanism for Taiwan's own 統一發票 (GUI
invoice) system, which is what a Taiwan business would actually need a
統一編號 for. Given that uncertainty, and that Paddle live mode + real
payments are still deliberately paused (see the "Deliberately deferred
together" section), the user chose the lowest-risk option: capture and
store the number on the account, with no functional effect on billing
or checkout yet, rather than build checkout logic on an unconfirmed tax
mechanism.

**What was built:**
- `users.vat_id VARCHAR(8)` — new nullable column (migration:
  `scripts/migrate-add-vat-id.ts`, idempotent `ADD COLUMN IF NOT
  EXISTS`, same pattern as other one-off migrations).
- `app/api/account/vat-id/route.ts` — new `POST` endpoint, session-gated
  like every other `/api/account/*` route. Validates format only (exactly
  8 digits, or empty to clear) — deliberately does NOT implement the
  official 統一編號 checksum/validity algorithm (a specific weighted-digit
  formula), which is out of scope for a capture-and-store field. A
  well-formed but not-actually-registered number can still be saved.
- `app/api/account/route.ts`'s existing `GET` now also selects and
  returns `vat_id` (all three response branches — free tier, live Paddle
  fetch, and the Paddle-unreachable fallback) so the account page can
  show the current value.
- `app/(app)/account/AccountPageClient.tsx` — new input + save button,
  visible regardless of tier, with an explicit Traditional Chinese note
  ("目前僅供儲存，尚未用於發票或付款流程" — currently for storage only, not yet
  used for invoicing or payment) so nobody assumes filling this in
  changes anything about their actual invoice or checkout today.

**Deliberately NOT touched:** `components/CheckoutButton.tsx` and the
Paddle checkout flow itself — no business-customer fields were added to
`Checkout.open()`. Signup (`app/(marketing)/signup/page.tsx` /
`app/api/auth/signup/route.ts`) also wasn't touched — VAT ID capture
lives in Account Settings only, editable any time after signup, not
gated into the signup or checkout flow.

**Still genuinely open, carried forward:** whether Paddle's own
tax-handling mechanism is even the right vehicle for Taiwan 統一發票
compliance is unresolved and belongs with the other unresolved legal/tax
items (see "Legal — still unresolved, flagged for a lawyer/accountant").
Once that's answered, revisit whether this stored value should flow into
Paddle checkout, a separate invoicing system, or somewhere else
entirely.

