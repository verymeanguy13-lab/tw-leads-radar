CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    password_hash TEXT,
    business_name TEXT,
    business_type TEXT,
    email_verified_at TIMESTAMPTZ,
    verification_token_hash TEXT,
    verification_token_expires_at TIMESTAMPTZ,
    -- Added 2026-09-06: forgot-password flow. Deliberately separate
    -- columns from verification_token_hash/_expires_at above rather than
    -- reusing them - the two flows can legitimately be in progress on the
    -- same account at once (e.g. a brand-new, not-yet-verified signup
    -- requests a password reset before ever clicking their verification
    -- link), and sharing one pair of columns would let one flow silently
    -- invalidate the other's token. Same hashToken()/never-store-the-raw-
    -- token pattern as verification - see lib/email/password-reset.ts.
    -- Expiry is intentionally shorter (1 hour vs. verification's 24) -
    -- this token grants account access if intercepted, verification's
    -- only grants "email marked verified".
    password_reset_token_hash TEXT,
    password_reset_token_expires_at TIMESTAMPTZ,
    -- Added 2026-09-03: 統一編號 (Taiwan Uniform Business Number),
    -- capture-and-store only for now - see the 2026-09-03 architecture.md
    -- entry for why this isn't wired into Paddle checkout yet.
    vat_id VARCHAR(8),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    paddle_customer_id TEXT,
    paddle_subscription_id TEXT UNIQUE,
    -- Added 2026-09-04: 藍新 (NewebPay) recurring-billing columns, added
    -- alongside the paddle_* columns rather than replacing them - Paddle
    -- checkout stays live until the NewebPay integration is built AND
    -- verified (2026-09-04 billing-switch decision). newebpay_period_no
    -- is NewebPay's assigned recurring-commitment ID, playing the same
    -- role paddle_subscription_id plays for Paddle. There is no
    -- NewebPay equivalent of paddle_customer_id - the Period API has no
    -- separate "customer" object, so newebpay_merchant_order_no (the
    -- order number *we* generate at checkout-initiation time) is what
    -- ties a subscription row back to the order that created it.
    newebpay_merchant_order_no TEXT UNIQUE,
    newebpay_period_no TEXT UNIQUE,
    tier VARCHAR(20) NOT NULL CHECK (tier IN ('free', 'pro', 'business')) DEFAULT 'free',
    status VARCHAR(20) NOT NULL CHECK (status IN ('active', 'past_due', 'canceled', 'none')) DEFAULT 'none',
    current_period_end TIMESTAMPTZ,
    -- Added 2026-09-05: records when a NewebPay subscription's
    -- cancellation was requested. Only used by the NewebPay path -
    -- Paddle's cancellation state is read live from Paddle's own API
    -- (getPaddleSubscription()'s scheduled_change field) each time, so
    -- Paddle-based rows never set this. NewebPay's AlterStatus call
    -- (lib/newebpay-api.ts's alterNewebpayPeriodStatus()) has no
    -- equivalent live "is a cancellation pending" read, and deliberately
    -- doesn't touch `status`/`current_period_end` on cancel (access
    -- should continue until the already-paid period ends, matching
    -- Paddle's behavior) - so app/api/account/route.ts needs this column
    -- to know a NewebPay subscription already had cancellation
    -- requested, distinct from one that's simply still running.
    canceled_at TIMESTAMPTZ,
    -- Added 2026-09-06: copied from newebpay_pending_orders.
    -- business_use_confirmed_at by the webhook (app/api/webhooks/
    -- newebpay(-mpg)/route.ts) at the moment it creates this row, so the
    -- record of the business-use confirmation (see Terms of Service 第一
    -- 條/第六條 - this is what those clauses were describing, added
    -- 2026-09-06 site completeness audit) outlives the pending order's
    -- short lifetime. Only set on the initial INSERT, never touched by a
    -- later recurring-charge UPDATE - a renewal isn't a fresh
    -- confirmation. NULL for any subscription created before this column
    -- existed, and for every Paddle-based row (Paddle checkout is
    -- unreachable from the UI as of the 2026-09-05 "hide Paddle" change,
    -- so this gap is not expected to grow).
    business_use_confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);

-- Added 2026-09-04: bridges NewebPay's Period-creation call (which only
-- accepts a MerOrderNo, ProdDesc, and payment fields - no arbitrary
-- custom-data JSON the way Paddle's checkout does) to which user/tier
-- that order is actually for. A row here gets inserted at
-- checkout-initiation time (not yet built) and read by the NewebPay
-- webhook (app/api/webhooks/newebpay/route.ts) when the first
-- successful-charge notify comes back, keyed on MerchantOrderNo. Rows
-- are expected to be short-lived - claimed (or expired) shortly after
-- creation - so this intentionally isn't merged into `subscriptions`
-- itself, which represents a real, resolved subscription.
CREATE TABLE IF NOT EXISTS newebpay_pending_orders (
    merchant_order_no TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tier VARCHAR(20) NOT NULL CHECK (tier IN ('pro', 'business')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    claimed_at TIMESTAMPTZ,
    -- Added 2026-09-06: records when the required business-use checkbox
    -- (app/api/checkout/newebpay(-yearly)/route.ts reject the request
    -- with no row inserted here at all if it wasn't checked) was
    -- confirmed at checkout-initiation time. See the matching column on
    -- `subscriptions` for why this is copied forward instead of only
    -- living here - migrate-add-business-use-confirmation.ts adds both.
    business_use_confirmed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_newebpay_pending_orders_user_id ON newebpay_pending_orders(user_id);

CREATE TABLE IF NOT EXISTS companies (
    uniform_id VARCHAR(8) PRIMARY KEY,
    entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('company', 'business')),
    name TEXT NOT NULL,
    industry_codes TEXT[] DEFAULT '{}',
    capital NUMERIC,
    address_raw TEXT,
    address_region TEXT,
    address_district TEXT,
    responsible_person TEXT,
    registration_date DATE,
    status VARCHAR(20) NOT NULL CHECK (status IN ('active', 'changed', 'dissolved', 'suspended')) DEFAULT 'active',
    status_updated_at TIMESTAMPTZ,
    source_dataset TEXT,
    source_month TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    suppressed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_companies_industry_codes ON companies USING GIN (industry_codes);
CREATE INDEX IF NOT EXISTS idx_companies_name_trgm ON companies USING GIN (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_companies_registration_date ON companies(registration_date);
CREATE INDEX IF NOT EXISTS idx_companies_address_region ON companies(address_region);
CREATE INDEX IF NOT EXISTS idx_companies_status ON companies(status);
CREATE INDEX IF NOT EXISTS idx_companies_suppressed_at ON companies(suppressed_at) WHERE suppressed_at IS NOT NULL;

-- Added 2026-08-28: PDPA data-removal request mechanism. A listed
-- business's responsible person (or the business itself) can request
-- their record stop appearing in search results and notification
-- emails. Requests are reviewed manually (not auto-applied) to prevent
-- abuse - e.g. a competitor trying to suppress a rival's visibility, or
-- someone impersonating a business they don't represent. Approving a
-- request sets companies.suppressed_at, which every match/read query
-- (lib/matching/engine.ts, the results page, the digest email) checks
-- and excludes. This does not resolve the underlying open legal
-- question of whether repackaging public GCIS data for lead-generation
-- use satisfies PDPA's purpose-limitation requirement - it exists
-- regardless of how that question resolves, since PDPA gives
-- individuals a right to request processing stop independent of
-- whether the original processing was itself lawful.
CREATE TABLE IF NOT EXISTS data_removal_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    uniform_id VARCHAR(8),
    company_name_submitted TEXT NOT NULL,
    responsible_person_submitted TEXT,
    requester_email TEXT NOT NULL,
    reason TEXT,
    status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_data_removal_requests_status ON data_removal_requests(status);

-- Added 2026-09-05: 統一編號 and 負責人姓名 (responsible_person_submitted)
-- are now BOTH required by the public /data-removal form, and the API
-- route (app/api/data-removal-requests/route.ts) rejects the submission
-- outright - before it ever reaches this table - if the submitted name
-- doesn't match companies.responsible_person for that uniform_id.
-- uniform_id stays nullable at the column level only because older rows
-- predate this requirement; the column itself is unchanged.
--
-- Why: the uniform_id alone was never a real barrier against
-- impersonation, since any uniform_id a requester could type is already
-- visible in this site's own public search results - it only ever
-- filtered out typos and made-up company names. Requiring the exact
-- registered 負責人姓名 too raises the bar, since that field is masked
-- for anonymous/free-tier visitors on this site (see pricing page) and
-- only shown in full to paying subscribers. It's not proof of identity -
-- see architecture.md's 2026-09-05 entry for why a stronger check (e.g.
-- requiring a copy of a government ID) was deliberately NOT built: PDPA's
-- necessity/proportionality principle makes collecting a full ID-card
-- image for this purpose legally questionable on its own, on top of the
-- new custodial burden of storing scanned IDs securely - this needs real
-- legal input before being built, not a code change made on assumption.
-- migrate-add-removal-responsible-person.ts adds the column.

CREATE TABLE IF NOT EXISTS saved_searches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    industry_codes TEXT[] DEFAULT '{}',
    regions TEXT[] DEFAULT '{}',
    capital_min NUMERIC,
    capital_max NUMERIC,
    entity_type VARCHAR(20) CHECK (entity_type IN ('company', 'business', 'both')) DEFAULT 'both',
    keyword TEXT,
    cadence VARCHAR(20) NOT NULL CHECK (cadence IN ('weekly', 'monthly', 'daily')) DEFAULT 'weekly',
    paused BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saved_searches_user_id ON saved_searches(user_id);

CREATE TABLE IF NOT EXISTS search_matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    saved_search_id UUID NOT NULL REFERENCES saved_searches(id) ON DELETE CASCADE,
    company_uniform_id VARCHAR(8) NOT NULL REFERENCES companies(uniform_id) ON DELETE CASCADE,
    matched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    surfaced_in_digest BOOLEAN NOT NULL DEFAULT FALSE,
    surfaced_at TIMESTAMPTZ,
    UNIQUE (saved_search_id, company_uniform_id)
);

CREATE INDEX IF NOT EXISTS idx_search_matches_saved_search_id ON search_matches(saved_search_id);
CREATE INDEX IF NOT EXISTS idx_search_matches_company_uniform_id ON search_matches(company_uniform_id);
CREATE INDEX IF NOT EXISTS idx_search_matches_unsurfaced ON search_matches(saved_search_id) WHERE surfaced_in_digest = FALSE;

CREATE TABLE IF NOT EXISTS ingestion_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataset_name TEXT NOT NULL,
    source_month TEXT,
    source_url TEXT,
    row_count INTEGER,
    new_count INTEGER,
    updated_count INTEGER,
    parse_failures INTEGER DEFAULT 0,
    encoding_detected TEXT,
    status VARCHAR(20) NOT NULL CHECK (status IN ('running', 'success', 'failed', 'partial', 'no_new_data')) DEFAULT 'running',
    error_log TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_dataset_name ON ingestion_runs(dataset_name);
CREATE INDEX IF NOT EXISTS idx_ingestion_runs_started_at ON ingestion_runs(started_at DESC);

-- Added 2026-09-03: mirrors ingestion_runs' pattern for the digest job.
-- scripts/run-digest.ts writes one row here every time it actually runs
-- to completion (success, partial, or a caught crash). A separate
-- watchdog job (.github/workflows/digest-watchdog.yml +
-- scripts/check-digest-ran.ts) checks for a recent row here to detect
-- GitHub Actions silently failing to trigger the scheduled digest.yml
-- workflow at all — a failure mode digest.yml's own `if: failure()` step
-- can never catch, since there's no run object for it to attach to.
CREATE TABLE IF NOT EXISTS digest_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status VARCHAR(20) NOT NULL CHECK (status IN ('success', 'partial', 'failed')) DEFAULT 'success',
    sent_count INTEGER DEFAULT 0,
    skipped_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    error_log TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_digest_runs_started_at ON digest_runs(started_at DESC);

CREATE ROLE app_user NOLOGIN;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE newebpay_pending_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_isolation ON users
    USING (id = current_setting('app.current_user_id', true)::UUID);

CREATE POLICY subscriptions_isolation ON subscriptions
    USING (user_id = current_setting('app.current_user_id', true)::UUID);

CREATE POLICY saved_searches_isolation ON saved_searches
    USING (user_id = current_setting('app.current_user_id', true)::UUID);

CREATE POLICY search_matches_isolation ON search_matches
    USING (
        saved_search_id IN (
            SELECT id FROM saved_searches
            WHERE user_id = current_setting('app.current_user_id', true)::UUID
        )
    );

-- No user-scoped SELECT policy needed beyond isolation itself: the
-- NewebPay webhook (app/api/webhooks/newebpay/route.ts) reads this
-- table via db() (the non-RLS connection, same as the Paddle webhook
-- uses for `subscriptions`), since a server-to-server notify callback
-- has no app.current_user_id to set. Checkout-initiation code (not yet
-- built), by contrast, should insert through withUserContext like every
-- other user-owned write in this app.
CREATE POLICY newebpay_pending_orders_isolation ON newebpay_pending_orders
    USING (user_id = current_setting('app.current_user_id', true)::UUID);

GRANT SELECT, INSERT, UPDATE, DELETE ON users, subscriptions, saved_searches, search_matches, newebpay_pending_orders TO app_user;
GRANT SELECT ON companies TO app_user;
GRANT SELECT, INSERT, UPDATE ON ingestion_runs TO app_user;
GRANT SELECT, INSERT, UPDATE ON digest_runs TO app_user;

-- Added 2026-09-05 (Sessions 25-26, blueprint Section 5): prospect_contacts
-- — internal, admin-only outbound-sales data (記帳士/CPA firm contacts),
-- not customer-owned. Per the blueprint's ★ standing principle, this is
-- gated at the app layer (session email checked against ADMIN_EMAIL —
-- see app/(app)/admin/prospects/page.tsx), the same pattern already used
-- by /admin/ingestion and /admin/data-removal-requests. RLS is
-- deliberately NOT enabled here: the users/subscriptions RLS pattern
-- exists for per-customer isolation, and this table has no customer
-- owner for it to isolate.
--
-- Deviation from the blueprint's literal column spec, worth flagging:
-- the spec listed name/firm_name/region without NOT NULL. They're
-- enforced NOT NULL here because they're also this table's UNIQUE key
-- (used for idempotent upserts via ON CONFLICT) — Postgres treats every
-- NULL in a UNIQUE constraint as distinct from every other NULL, so if
-- any of these three were ever null, ON CONFLICT would silently stop
-- matching existing rows and every re-run would insert duplicates
-- instead of updating them. For a row with no individual person's name
-- (an association-office row, or a CPA firm branch), `name` holds the
-- association's or branch's own descriptive label instead of a blank —
-- see scripts/scrape-bookkeepers.ts and scripts/scrape-cpa-firms.ts.
CREATE TABLE IF NOT EXISTS prospect_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_type VARCHAR(30) NOT NULL CHECK (contact_type IN ('bookkeeper', 'bookkeeper_association', 'cpa_firm')),
    name TEXT NOT NULL,
    firm_name TEXT NOT NULL,
    region TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    website TEXT,
    source_url TEXT NOT NULL,
    source_association TEXT,
    seed_source TEXT,
    contact_method TEXT,
    do_not_contact BOOLEAN NOT NULL DEFAULT FALSE,
    outreach_status VARCHAR(20) NOT NULL CHECK (outreach_status IN ('not_contacted', 'contacted', 'replied', 'opted_out', 'converted')) DEFAULT 'not_contacted',
    notes TEXT,
    scraped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(name, firm_name, region)
);

CREATE INDEX IF NOT EXISTS idx_prospect_contacts_region ON prospect_contacts(region);
CREATE INDEX IF NOT EXISTS idx_prospect_contacts_contact_type ON prospect_contacts(contact_type);
CREATE INDEX IF NOT EXISTS idx_prospect_contacts_do_not_contact ON prospect_contacts(do_not_contact);

-- No RLS policy — see comment above. Granted to app_user (not
-- neondb_owner) same as every other app-accessed table, but gated at
-- the app layer instead of a USING policy.
GRANT SELECT, INSERT, UPDATE ON prospect_contacts TO app_user;

-- Added 2026-09-05: rate limiting for the public, no-login /search page
-- (app/(marketing)/search/page.tsx). That page has no account behind it
-- to hold accountable, so an IP-based limit is the only practical
-- control. Stores a SHA-256 hash of (client IP + NEXTAUTH_SECRET), never
-- the raw IP — same "don't keep more than needed" instinct as everywhere
-- else in this schema, and avoids this table becoming its own PDPA
-- question. Counts are bucketed into fixed windows (ip_hash,
-- window_start) so a request either lands in an existing bucket
-- (increment) or starts a new one — see lib/rate-limit.ts for the actual
-- window size and limit. Only ever written by anonymous /search
-- requests — a logged-in visitor of any tier is already accountable via
-- their account and is exempt (see that file's comment for why).
CREATE TABLE IF NOT EXISTS search_rate_limits (
    ip_hash TEXT NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (ip_hash, window_start)
);

CREATE INDEX IF NOT EXISTS idx_search_rate_limits_window_start ON search_rate_limits(window_start);

-- No RLS — not user-owned data, gated at the app layer (lib/rate-limit.ts
-- is the only code that ever touches this table).
GRANT SELECT, INSERT, UPDATE, DELETE ON search_rate_limits TO app_user;