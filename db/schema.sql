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
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    paddle_customer_id TEXT,
    paddle_subscription_id TEXT UNIQUE,
    tier VARCHAR(20) NOT NULL CHECK (tier IN (''free'', ''pro'', ''business'')) DEFAULT ''free'',
    status VARCHAR(20) NOT NULL CHECK (status IN (''active'', ''past_due'', ''canceled'', ''none'')) DEFAULT ''none'',
    current_period_end TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);

CREATE TABLE IF NOT EXISTS companies (
    uniform_id VARCHAR(8) PRIMARY KEY,
    entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN (''company'', ''business'')),
    name TEXT NOT NULL,
    industry_codes TEXT[] DEFAULT ''{}'',
    industry_codes_checked_at TIMESTAMPTZ,
    capital NUMERIC,
    address_raw TEXT,
    address_region TEXT,
    address_district TEXT,
    responsible_person TEXT,
    registration_date DATE,
    status VARCHAR(20) NOT NULL CHECK (status IN (''active'', ''changed'', ''dissolved'', ''suspended'')) DEFAULT ''active'',
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
    requester_email TEXT NOT NULL,
    reason TEXT,
    status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_data_removal_requests_status ON data_removal_requests(status);

CREATE TABLE IF NOT EXISTS saved_searches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    industry_codes TEXT[] DEFAULT ''{}'',
    regions TEXT[] DEFAULT ''{}'',
    capital_min NUMERIC,
    capital_max NUMERIC,
    entity_type VARCHAR(20) CHECK (entity_type IN (''company'', ''business'', ''both'')) DEFAULT ''both'',
    keyword TEXT,
    cadence VARCHAR(20) NOT NULL CHECK (cadence IN (''weekly'', ''monthly'')) DEFAULT ''weekly'',
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
    status VARCHAR(20) NOT NULL CHECK (status IN (''running'', ''success'', ''failed'', ''partial'', ''no_new_data'')) DEFAULT ''running'',
    error_log TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_dataset_name ON ingestion_runs(dataset_name);
CREATE INDEX IF NOT EXISTS idx_ingestion_runs_started_at ON ingestion_runs(started_at DESC);

CREATE ROLE app_user NOLOGIN;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_isolation ON users
    USING (id = current_setting(''app.current_user_id'', true)::UUID);

CREATE POLICY subscriptions_isolation ON subscriptions
    USING (user_id = current_setting(''app.current_user_id'', true)::UUID);

CREATE POLICY saved_searches_isolation ON saved_searches
    USING (user_id = current_setting(''app.current_user_id'', true)::UUID);

CREATE POLICY search_matches_isolation ON search_matches
    USING (
        saved_search_id IN (
            SELECT id FROM saved_searches
            WHERE user_id = current_setting(''app.current_user_id'', true)::UUID
        )
    );

GRANT SELECT, INSERT, UPDATE, DELETE ON users, subscriptions, saved_searches, search_matches TO app_user;
GRANT SELECT ON companies TO app_user;
GRANT SELECT, INSERT, UPDATE ON ingestion_runs TO app_user;