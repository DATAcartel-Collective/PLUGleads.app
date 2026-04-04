-- ============================================================
-- PLUGleads Powerstack — Complete Database Schema v3.1
-- Multi-Tenant | PostGIS | RLS | Triggers | Commission Logic
-- ============================================================

-- ============================================================
-- EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- ENUMS
-- ============================================================
DO $$ BEGIN
    CREATE TYPE priority_level      AS ENUM ('Tier 1', 'Tier 2', 'Tier 3');
    CREATE TYPE lead_status         AS ENUM ('NEW', 'CONTACTED', 'APPOINTMENT_SET', 'DEAD', 'SOLD');
    CREATE TYPE skip_trace_state    AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETE', 'FAILED');
    CREATE TYPE call_outcome        AS ENUM ('NO_ANSWER', 'VOICEMAIL', 'CALLBACK_REQUESTED', 'NOT_INTERESTED', 'APPOINTMENT_SET', 'SOLD');
    CREATE TYPE sms_status          AS ENUM ('DRAFT', 'SENT', 'DELIVERED', 'FAILED');
    CREATE TYPE tenant_plan         AS ENUM ('PILOT', 'STARTER', 'PRO', 'ENTERPRISE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================================
-- TENANTS  (Roofing companies — platform clients)
-- ============================================================
CREATE TABLE IF NOT EXISTS tenants (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name                TEXT NOT NULL,
    plan                        tenant_plan DEFAULT 'PILOT',
    contact_email               TEXT UNIQUE NOT NULL,
    contact_phone               TEXT,

    -- Per-tenant API credentials (encrypted at rest via Supabase Vault recommended)
    signalwire_project_id       TEXT,
    signalwire_space_url        TEXT,
    signalwire_api_token        TEXT,
    batchleads_api_key          TEXT,

    -- Commission
    commission_rate             NUMERIC DEFAULT 6.67,   -- % of project value owed to DATAcartel

    -- Platform agreement
    disclaimer_accepted         BOOLEAN DEFAULT false,
    disclaimer_accepted_at      TIMESTAMPTZ,

    is_active                   BOOLEAN DEFAULT true,
    created_at                  TIMESTAMPTZ DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- CONTRACTORS  (Users/reps belonging to a tenant)
-- ============================================================
CREATE TABLE IF NOT EXISTS contractors (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    auth_user_id                UUID UNIQUE,            -- maps to auth.users.id (Supabase Auth)
    full_name                   TEXT NOT NULL,
    email                       TEXT UNIQUE NOT NULL,
    phone                       TEXT,
    role                        TEXT DEFAULT 'REP',     -- 'ADMIN' | 'REP'

    -- Platform disclaimer & anti-poaching agreement
    disclaimer_signed           BOOLEAN DEFAULT false,
    disclaimer_signed_at        TIMESTAMPTZ,

    is_active                   BOOLEAN DEFAULT true,
    created_at                  TIMESTAMPTZ DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- HAIL EVENTS  (NOAA SPC storm swaths — ingested from GeoJSON)
-- ============================================================
CREATE TABLE IF NOT EXISTS hail_events (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_date                  DATE NOT NULL,
    state                       TEXT,
    county                      TEXT,
    hail_size_inches            NUMERIC,
    wind_speed_mph              NUMERIC,
    swath_geom                  GEOMETRY(POLYGON, 4326),  -- PostGIS polygon from NOAA GeoJSON
    source_url                  TEXT,
    ingested_at                 TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hail_events_geom  ON hail_events USING GIST(swath_geom);
CREATE INDEX IF NOT EXISTS idx_hail_events_date  ON hail_events(event_date);
CREATE INDEX IF NOT EXISTS idx_hail_events_state ON hail_events(state);

-- ============================================================
-- PERMITS  (County permit ingestion via CSV)
-- ============================================================
CREATE TABLE IF NOT EXISTS permits (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    lead_id                     UUID,                   -- FK added after leads table exists (see below)

    permit_number               TEXT,
    permit_type                 TEXT,                   -- 'ROOFING','POOL','DECK','CONCRETE','FENCE','DRIVEWAY', etc.
    permit_description          TEXT,
    issue_date                  DATE,
    closed_date                 DATE,
    is_closed                   BOOLEAN DEFAULT false,

    -- Location
    address                     TEXT NOT NULL,
    city                        TEXT,
    state                       TEXT,
    zip_code                    TEXT,
    latitude                    DOUBLE PRECISION,
    longitude                   DOUBLE PRECISION,
    geom                        GEOMETRY(POINT, 4326),  -- auto-populated by trigger

    source_file                 TEXT,                   -- source CSV filename for audit trail
    created_at                  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_permits_geom   ON permits USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_permits_type   ON permits(permit_type);
CREATE INDEX IF NOT EXISTS idx_permits_tenant ON permits(tenant_id);
CREATE INDEX IF NOT EXISTS idx_permits_date   ON permits(issue_date);

-- ============================================================
-- LEADS  (Core entity — fully expanded per v3.1 spec)
-- ============================================================
CREATE TABLE IF NOT EXISTS leads (
    id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    assigned_contractor_id          UUID REFERENCES contractors(id) ON DELETE SET NULL,

    -- ── Location ──────────────────────────────────────────
    address                         TEXT NOT NULL,
    city                            TEXT,
    state                           TEXT,                   -- 'IN' | 'MI' (drives statute window)
    zip_code                        TEXT,
    latitude                        DOUBLE PRECISION,
    longitude                       DOUBLE PRECISION,
    geom                            GEOMETRY(POINT, 4326),  -- auto-populated by trigger

    -- ── Property & Financial Data (Propwire) ──────────────
    homeowner_name                  TEXT,
    absentee_owner                  BOOLEAN DEFAULT false,
    mailing_address                 TEXT,                   -- differs from property = absentee flag
    years_owned                     INTEGER DEFAULT 0,
    year_built                      INTEGER,
    square_footage                  INTEGER,
    property_type                   TEXT,
    assessed_value                  NUMERIC DEFAULT 0,
    equity_percent                  NUMERIC DEFAULT 0,
    last_sale_date                  DATE,
    last_mortgage_date              DATE,                   -- "Golden Handcuffs" check
    mortgage_lender                 TEXT,
    ltv_ratio                       NUMERIC,                -- Loan-to-Value

    -- ── "Ghost Wallet" Deep Financial Flags ───────────────
    has_llc_at_address              BOOLEAN DEFAULT false,
    has_occupational_license        BOOLEAN DEFAULT false,
    is_hecm_reverse_mortgage        BOOLEAN DEFAULT false,  -- Cash-rich senior; "Asset Protection" pitch
    is_trust_owned                  BOOLEAN DEFAULT false,
    has_tax_delinquency             BOOLEAN DEFAULT false,  -- AUTO Tier 3 if true
    has_mechanic_lien               BOOLEAN DEFAULT false,  -- AUTO Tier 3 if true
    has_code_violations             BOOLEAN DEFAULT false,
    is_listed_for_sale              BOOLEAN DEFAULT false,
    listing_date                    DATE,

    -- ── Storm & Deadline Logic ───────────────────────────
    last_storm_date                 DATE,
    -- claim_deadline calculated: IN = storm_date + 24mo | MI = storm_date + 12mo
    claim_deadline                  DATE,
    days_until_deadline             INTEGER,                -- recalculated daily by function
    is_hot_storm_lead               BOOLEAN DEFAULT false,
    hail_event_id                   UUID REFERENCES hail_events(id) ON DELETE SET NULL,

    -- ── Permit Intelligence ───────────────────────────────
    has_open_roofing_permit         BOOLEAN DEFAULT false,  -- Open but never closed → overturning denied claims pitch
    open_permit_date                DATE,
    neighborhood_roof_cluster_count INTEGER DEFAULT 0,      -- Roofing permits within 0.25mi / 6mo
    -- Discretionary permits detected at this address (pools, decks, patios, etc.)
    discretionary_permits           JSONB DEFAULT '[]'::jsonb,

    -- ── AI & Scoring ─────────────────────────────────────
    priority_status                 priority_level DEFAULT 'Tier 3',
    lead_score                      INTEGER DEFAULT 0,
    ai_rationale                    TEXT,
    lead_archetype                  TEXT,           -- e.g. "Golden Handcuffs / Unpermitted Wealth"
    urgency_flag                    TEXT,           -- e.g. "CRITICAL: Indiana 24-Month Window closes in 60 days."
    dynamic_sales_pitch             TEXT,           -- 2-sentence Gemini-generated pitch
    visual_analysis                 JSONB,          -- full visual_analysis JSON block from Gemini
    financial_profile               TEXT,
    ai_scored_at                    TIMESTAMPTZ,
    ai_model_version                TEXT DEFAULT 'gemini-3.1-pro',

    -- ── Satellite Imagery ─────────────────────────────────
    satellite_image_current_url     TEXT,
    satellite_image_historical_url  TEXT,

    -- ── Skip Tracing (Batchleads.io — Manual Trigger Only) ─
    skip_trace_status               skip_trace_state DEFAULT 'PENDING',
    skip_traced_at                  TIMESTAMPTZ,
    phone_numbers                   JSONB DEFAULT '[]'::jsonb,  -- array of {number, type, carrier}

    -- ── CRM Status ────────────────────────────────────────
    lead_status                     lead_status DEFAULT 'NEW',
    last_contacted_at               TIMESTAMPTZ,
    appointment_date                TIMESTAMPTZ,
    appointment_address             TEXT,           -- on-site inspection location
    notes                           TEXT,

    -- ── Commission Tracking ───────────────────────────────
    project_value                   NUMERIC,        -- entered by admin when SOLD
    commission_amount               NUMERIC,        -- auto-calculated: project_value × commission_rate
    commission_paid                 BOOLEAN DEFAULT false,
    commission_paid_at              TIMESTAMPTZ,

    UNIQUE(tenant_id, address),
    created_at                      TIMESTAMPTZ DEFAULT NOW(),
    updated_at                      TIMESTAMPTZ DEFAULT NOW()
);

-- Add deferred FK from permits to leads
ALTER TABLE permits
    ADD CONSTRAINT fk_permits_lead
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_leads_geom        ON leads USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_leads_tenant      ON leads(tenant_id);
CREATE INDEX IF NOT EXISTS idx_leads_contractor  ON leads(assigned_contractor_id);
CREATE INDEX IF NOT EXISTS idx_leads_priority    ON leads(priority_status, lead_score DESC);
CREATE INDEX IF NOT EXISTS idx_leads_status      ON leads(lead_status);
CREATE INDEX IF NOT EXISTS idx_leads_deadline    ON leads(claim_deadline);
CREATE INDEX IF NOT EXISTS idx_leads_state       ON leads(state);

-- ============================================================
-- CALL LOGS  (SignalWire proxy dialer — DATAcartel records)
-- ============================================================
CREATE TABLE IF NOT EXISTS call_logs (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    lead_id                     UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    contractor_id               UUID NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,

    signalwire_call_sid         TEXT,               -- SignalWire unique call identifier
    call_direction              TEXT DEFAULT 'OUTBOUND',
    duration_seconds            INTEGER,
    recording_url               TEXT,               -- DATAcartel retains recording per disclaimer
    outcome                     call_outcome,
    contractor_notes            TEXT,

    called_at                   TIMESTAMPTZ DEFAULT NOW(),
    created_at                  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_call_logs_lead       ON call_logs(lead_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_contractor ON call_logs(contractor_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_tenant     ON call_logs(tenant_id);

-- ============================================================
-- SMS LOGS  (Follow-up text — 2-click send workflow)
-- ============================================================
CREATE TABLE IF NOT EXISTS sms_logs (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    lead_id                     UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    contractor_id               UUID NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
    call_log_id                 UUID REFERENCES call_logs(id) ON DELETE SET NULL,

    ai_generated_body           TEXT,               -- Gemini draft shown to contractor
    final_body                  TEXT NOT NULL,       -- Body after optional contractor edit
    was_edited                  BOOLEAN DEFAULT false,
    contractor_confirmed        BOOLEAN DEFAULT false,  -- Tracks 2-click "Are you sure?" confirmation
    status                      sms_status DEFAULT 'DRAFT',
    signalwire_message_sid      TEXT,
    sent_at                     TIMESTAMPTZ,

    created_at                  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sms_logs_lead    ON sms_logs(lead_id);
CREATE INDEX IF NOT EXISTS idx_sms_logs_tenant  ON sms_logs(tenant_id);

-- ============================================================
-- SKIP TRACE REQUESTS  (Audit trail for every Batchleads.io hit)
-- ============================================================
CREATE TABLE IF NOT EXISTS skip_trace_requests (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    lead_id                     UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    requested_by                UUID REFERENCES contractors(id) ON DELETE SET NULL,

    batchleads_request_id       TEXT,
    cost_per_hit                NUMERIC DEFAULT 0.02,
    result_count                INTEGER DEFAULT 0,
    raw_response                JSONB,

    requested_at                TIMESTAMPTZ DEFAULT NOW(),
    completed_at                TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_skip_trace_lead   ON skip_trace_requests(lead_id);
CREATE INDEX IF NOT EXISTS idx_skip_trace_tenant ON skip_trace_requests(tenant_id);

-- ============================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================

-- ── 1. Auto-update updated_at ────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tenants_updated_at
    BEFORE UPDATE ON tenants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_contractors_updated_at
    BEFORE UPDATE ON contractors
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_leads_updated_at
    BEFORE UPDATE ON leads
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 2. Auto-populate geom from lat/lng (leads) ───────────────
CREATE OR REPLACE FUNCTION sync_leads_geom()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
        NEW.geom = ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_leads_sync_geom
    BEFORE INSERT OR UPDATE OF latitude, longitude ON leads
    FOR EACH ROW EXECUTE FUNCTION sync_leads_geom();

-- ── 3. Auto-populate geom from lat/lng (permits) ─────────────
CREATE OR REPLACE FUNCTION sync_permits_geom()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
        NEW.geom = ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_permits_sync_geom
    BEFORE INSERT OR UPDATE OF latitude, longitude ON permits
    FOR EACH ROW EXECUTE FUNCTION sync_permits_geom();

-- ── 4. Auto Tier 3 enforcement (tax delinquency / mechanic lien) ──
CREATE OR REPLACE FUNCTION enforce_auto_tier3()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.has_tax_delinquency = true OR NEW.has_mechanic_lien = true THEN
        NEW.priority_status := 'Tier 3';
        NEW.lead_score := LEAST(COALESCE(NEW.lead_score, 0), 49);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_leads_auto_tier3
    BEFORE INSERT OR UPDATE ON leads
    FOR EACH ROW EXECUTE FUNCTION enforce_auto_tier3();

-- ── 5. Auto-calculate commission when project_value is set ───
CREATE OR REPLACE FUNCTION calculate_commission()
RETURNS TRIGGER AS $$
DECLARE
    rate NUMERIC;
BEGIN
    SELECT commission_rate INTO rate FROM tenants WHERE id = NEW.tenant_id;
    IF NEW.project_value IS NOT NULL AND rate IS NOT NULL THEN
        NEW.commission_amount := ROUND(NEW.project_value * (rate / 100.0), 2);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_leads_calc_commission
    BEFORE INSERT OR UPDATE OF project_value ON leads
    FOR EACH ROW EXECUTE FUNCTION calculate_commission();

-- ── 6. Recalculate days_until_deadline across all leads ──────
--    Call this daily via a pg_cron job or Supabase Edge Function cron.
CREATE OR REPLACE FUNCTION recalculate_deadline_days()
RETURNS VOID AS $$
BEGIN
    UPDATE leads
    SET days_until_deadline = EXTRACT(DAY FROM (claim_deadline - CURRENT_DATE))::INTEGER
    WHERE claim_deadline IS NOT NULL;
END;
$$ LANGUAGE plpgsql;

-- ── 7. Set claim_deadline automatically from storm date + state window ──
CREATE OR REPLACE FUNCTION set_claim_deadline()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.last_storm_date IS NOT NULL AND NEW.state IS NOT NULL THEN
        CASE UPPER(NEW.state)
            WHEN 'IN' THEN
                NEW.claim_deadline := NEW.last_storm_date + INTERVAL '24 months';
            WHEN 'MI' THEN
                NEW.claim_deadline := NEW.last_storm_date + INTERVAL '12 months';
            ELSE
                NEW.claim_deadline := NEW.last_storm_date + INTERVAL '12 months'; -- default fallback
        END CASE;
        NEW.days_until_deadline := EXTRACT(DAY FROM (NEW.claim_deadline - CURRENT_DATE))::INTEGER;
        -- Mark expired leads Tier 3 immediately
        IF NEW.days_until_deadline < 0 THEN
            NEW.priority_status := 'Tier 3';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_leads_set_deadline
    BEFORE INSERT OR UPDATE OF last_storm_date, state ON leads
    FOR EACH ROW EXECUTE FUNCTION set_claim_deadline();

-- ============================================================
-- PostGIS HELPER: Neighborhood Roof Cluster Count
-- Returns count of closed roofing permits within 0.25 miles
-- of a given lat/lng within the last N months.
-- Usage: SELECT get_roof_cluster_count(41.6764, -86.2520, 6, '<tenant_uuid>');
-- ============================================================
CREATE OR REPLACE FUNCTION get_roof_cluster_count(
    p_latitude  DOUBLE PRECISION,
    p_longitude DOUBLE PRECISION,
    p_months    INTEGER DEFAULT 6,
    p_tenant_id UUID    DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
    result       INTEGER;
    search_point GEOMETRY;
    radius_m  NUMERIC := 1609.344;  -- 1 mile → meters → meters
BEGIN
    search_point := ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326);

    SELECT COUNT(*) INTO result
    FROM permits
    WHERE permit_type = 'ROOFING'
      AND is_closed   = true
      AND issue_date >= (CURRENT_DATE - (p_months || ' months')::INTERVAL)
      AND ST_DWithin(
              geom::GEOGRAPHY,
              search_point::GEOGRAPHY,
              radius_m
          )
      AND (p_tenant_id IS NULL OR tenant_id = p_tenant_id);

    RETURN COALESCE(result, 0);
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================
ALTER TABLE tenants              ENABLE ROW LEVEL SECURITY;
ALTER TABLE contractors          ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads                ENABLE ROW LEVEL SECURITY;
ALTER TABLE permits              ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_logs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_logs             ENABLE ROW LEVEL SECURITY;
ALTER TABLE skip_trace_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE hail_events          ENABLE ROW LEVEL SECURITY;

-- Helper: resolve tenant_id from the current authenticated user
CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS UUID AS $$
    SELECT tenant_id FROM contractors WHERE auth_user_id = auth.uid() LIMIT 1;
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Leads: tenant isolation
CREATE POLICY "leads_tenant_isolation" ON leads
    FOR ALL USING (tenant_id = current_tenant_id());

-- Permits: tenant isolation
CREATE POLICY "permits_tenant_isolation" ON permits
    FOR ALL USING (tenant_id = current_tenant_id());

-- Call logs: tenant isolation
CREATE POLICY "call_logs_tenant_isolation" ON call_logs
    FOR ALL USING (tenant_id = current_tenant_id());

-- SMS logs: tenant isolation
CREATE POLICY "sms_logs_tenant_isolation" ON sms_logs
    FOR ALL USING (tenant_id = current_tenant_id());

-- Skip trace: tenant isolation
CREATE POLICY "skip_trace_tenant_isolation" ON skip_trace_requests
    FOR ALL USING (tenant_id = current_tenant_id());

-- Contractors: each user sees only their own record
CREATE POLICY "contractors_self" ON contractors
    FOR ALL USING (auth_user_id = auth.uid());

-- Tenants: contractor can read their own tenant record
CREATE POLICY "tenants_read_own" ON tenants
    FOR SELECT USING (id = current_tenant_id());

-- Hail events: platform-wide read (public reference data)
CREATE POLICY "hail_events_public_read" ON hail_events
    FOR SELECT USING (true);
