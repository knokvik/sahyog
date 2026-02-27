-- =========================================
-- SAHAYANET CLEAN PRODUCTION SCHEMA
-- =========================================

-- Drop old tables if they exist
DROP TABLE IF EXISTS missing_persons CASCADE;
DROP TABLE IF EXISTS tasks CASCADE;
DROP TABLE IF EXISTS sos_alerts CASCADE;
DROP TABLE IF EXISTS sos_reports CASCADE;
DROP TABLE IF EXISTS needs CASCADE;
DROP TABLE IF EXISTS pending_actions CASCADE;
DROP TABLE IF EXISTS resources CASCADE;
DROP TABLE IF EXISTS shelters CASCADE;
DROP TABLE IF EXISTS zones CASCADE;
DROP TABLE IF EXISTS disasters CASCADE;
DROP TABLE IF EXISTS volunteers CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS organizations CASCADE;

CREATE EXTENSION IF NOT EXISTS postgis;

-- =========================
-- ORGANIZATIONS
-- =========================
CREATE TABLE organizations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar NOT NULL,
    registration_number varchar UNIQUE,
    primary_phone varchar,
    email varchar,
    state varchar,
    district varchar,
    created_at timestamp DEFAULT now(),
    updated_at timestamp DEFAULT now()
);

-- =========================
-- USERS (NEW ROLE SYSTEM)
-- =========================
CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    clerk_user_id varchar(255) UNIQUE NOT NULL,
    phone varchar UNIQUE,
    email varchar UNIQUE,
    full_name varchar NOT NULL,
    -- Role can be: user, volunteer, coordinator, ngo_admin, district_admin
    role varchar NOT NULL DEFAULT 'volunteer'
        CHECK (role IN (
            'user',
            'volunteer',
            'coordinator',
            'ngo_admin',
            'district_admin'
        )),
    organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
    is_active boolean DEFAULT true,
    is_verified boolean DEFAULT false,
    current_location geometry(Point, 4326),
    avatar_url text, 
    last_active timestamp,
    created_at timestamp DEFAULT now(),
    updated_at timestamp DEFAULT now()
);

CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_clerk_id ON users(clerk_user_id);
CREATE INDEX idx_users_location ON users USING GIST(current_location);

-- =========================
-- DISASTERS
-- =========================
CREATE TABLE disasters (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar NOT NULL,
    type varchar NOT NULL,
    status varchar DEFAULT 'monitoring',
    affected_area geometry(MultiPolygon, 4326),
    severity integer,
    activated_by uuid REFERENCES users(id),
    activated_at timestamp,
    resolved_at timestamp,
    created_at timestamp DEFAULT now()
);

-- =========================
-- ZONES
-- =========================
CREATE TABLE zones (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    disaster_id uuid REFERENCES disasters(id) ON DELETE CASCADE,
    name varchar NOT NULL,
    code varchar UNIQUE NOT NULL,
    boundary geometry(Polygon, 4326),
    assigned_coordinator_id uuid REFERENCES users(id),
    status varchar DEFAULT 'active',
    created_at timestamp DEFAULT now()
);

-- =========================
-- NEEDS (Public Requests)
-- =========================
CREATE TABLE needs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_code varchar UNIQUE NOT NULL,
    reporter_name varchar,
    reporter_phone varchar NOT NULL,
    location geometry(Point, 4326),
    type varchar NOT NULL,
    persons_count integer DEFAULT 1,
    description text,
    urgency varchar DEFAULT 'medium',
    disaster_id uuid REFERENCES disasters(id),
    zone_id uuid REFERENCES zones(id),
    status varchar DEFAULT 'unassigned',
    assigned_volunteer_id uuid REFERENCES users(id),
    photo_urls text[],
    voice_note_url text,
    reported_at timestamp DEFAULT now(),
    resolved_at timestamp,
    created_at timestamp DEFAULT now()
);

CREATE INDEX idx_needs_location ON needs USING GIST(location);
CREATE INDEX idx_needs_status ON needs(status);

-- =========================
-- TASKS (Volunteer Assignments)
-- =========================
CREATE TABLE tasks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    need_id uuid REFERENCES needs(id) ON DELETE SET NULL,
    disaster_id uuid REFERENCES disasters(id),
    zone_id uuid REFERENCES zones(id),
    volunteer_id uuid REFERENCES users(id),
    assigned_by uuid REFERENCES users(id),
    type varchar NOT NULL,
    title varchar NOT NULL,
    description text,
    meeting_point geometry(Point, 4326),
    status varchar DEFAULT 'pending',
    check_in_time timestamp,
    check_out_time timestamp,
    persons_helped integer DEFAULT 0,
    proof_images text[],
    created_at timestamp DEFAULT now(),
    completed_at timestamp
);

CREATE INDEX idx_tasks_status ON tasks(status);

-- =========================
-- RESOURCES
-- =========================
CREATE TABLE resources (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_org_id uuid REFERENCES organizations(id),
    type varchar NOT NULL,
    quantity integer DEFAULT 1,
    status varchar DEFAULT 'available',
    current_location geometry(Point, 4326),
    current_disaster_id uuid REFERENCES disasters(id),
    current_zone_id uuid REFERENCES zones(id),
    created_at timestamp DEFAULT now()
);

-- =========================
-- SOS ALERTS
-- =========================
CREATE TABLE sos_alerts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    volunteer_id uuid REFERENCES users(id),
    disaster_id uuid REFERENCES disasters(id),
    task_id uuid REFERENCES tasks(id),
    location geometry(Point, 4326),
    status varchar DEFAULT 'triggered',
    media_urls text[],
    acknowledged_by uuid REFERENCES users(id),
    acknowledged_at timestamp,
    resolved_at timestamp,
    created_at timestamp DEFAULT now()
);

-- =========================
-- OFFLINE SYNC TABLE
-- =========================
CREATE TABLE pending_actions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id varchar NOT NULL,
    user_id uuid REFERENCES users(id),
    action_type varchar NOT NULL,
    payload jsonb NOT NULL,
    status varchar DEFAULT 'pending',
    retry_count integer DEFAULT 0,
    created_at timestamp DEFAULT now(),
    synced_at timestamp
);

-- =========================
-- MISSING PERSONS 
-- =========================
CREATE TABLE missing_persons (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_phone varchar NOT NULL,
    name varchar,
    age integer,
    last_seen_location geometry(Point, 4326),
    photo_urls text[],
    status varchar DEFAULT 'missing',
    disaster_id uuid REFERENCES disasters(id),
    created_at timestamp DEFAULT now()
);
