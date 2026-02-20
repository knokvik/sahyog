-- Sahyog core schema (Clerk-based, PostgreSQL + PostGIS)

CREATE EXTENSION IF NOT EXISTS postgis;

-- Users table (synced from Clerk, or lazily on first backend call)
-- Roles: org:user (default citizen), org:volunteer, org:volunteer_head, org:member, org:admin
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE,
  phone VARCHAR(20),
  full_name VARCHAR(255),
  role VARCHAR(50) CHECK (role IN ('org:user', 'org:volunteer', 'org:volunteer_head', 'org:member', 'org:admin')),
  avatar_url TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  last_active TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_clerk_id ON users (clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

-- Volunteers
CREATE TABLE IF NOT EXISTS volunteers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  clerk_user_id VARCHAR(255) REFERENCES users(clerk_user_id),
  is_verified BOOLEAN DEFAULT FALSE,
  is_available BOOLEAN DEFAULT FALSE,
  current_location GEOGRAPHY(POINT, 4326),
  skills TEXT[],
  rating DECIMAL(2,1) DEFAULT 5.0,
  total_tasks INTEGER DEFAULT 0,
  service_area GEOGRAPHY(POLYGON, 4326),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_volunteer_location ON volunteers USING GIST (current_location);

-- Volunteer Heads
CREATE TABLE IF NOT EXISTS volunteer_heads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  clerk_user_id VARCHAR(255) REFERENCES users(clerk_user_id),
  organization VARCHAR(255),
  certification_id VARCHAR(255),
  region VARCHAR(255),
  is_verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);
-- Disasters
CREATE TABLE IF NOT EXISTS disasters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  type VARCHAR(100),
  status VARCHAR(50) CHECK (status IN ('active', 'contained', 'resolved', 'archived')) DEFAULT 'active',
  affected_area GEOGRAPHY(POLYGON, 4326),
  severity INTEGER CHECK (severity BETWEEN 1 AND 10),
  activated_at TIMESTAMP,
  resolved_at TIMESTAMP,
  created_by UUID REFERENCES users(id),
  clerk_created_by VARCHAR(255)
);

-- SOS reports
CREATE TABLE IF NOT EXISTS sos_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID REFERENCES users(id),
  clerk_reporter_id VARCHAR(255),
  disaster_id UUID REFERENCES disasters(id),
  location GEOGRAPHY(POINT, 4326) NOT NULL,
  type VARCHAR(100),
  description TEXT,
  priority_score INTEGER,
  status VARCHAR(50) DEFAULT 'pending',
  media_urls TEXT[],
  assigned_volunteer_id UUID REFERENCES volunteers(id),
  created_at TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sos_location ON sos_reports USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_sos_status ON sos_reports (status);

-- Tasks
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sos_id UUID REFERENCES sos_reports(id),
  volunteer_id UUID REFERENCES volunteers(id),
  assigned_by UUID REFERENCES users(id),
  status VARCHAR(50) DEFAULT 'assigned',
  instructions TEXT,
  proof_images TEXT[],
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_volunteer ON tasks (volunteer_id, status);

-- Shelters
CREATE TABLE IF NOT EXISTS shelters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255),
  location GEOGRAPHY(POINT, 4326),
  capacity INTEGER,
  current_occupancy INTEGER DEFAULT 0,
  facilities TEXT[],
  manager_id UUID REFERENCES users(id),
  status VARCHAR(50) DEFAULT 'active'
);

-- Missing persons
CREATE TABLE IF NOT EXISTS missing_persons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID REFERENCES users(id),
  disaster_id UUID REFERENCES disasters(id),
  name VARCHAR(255),
  age INTEGER,
  description TEXT,
  last_seen_location GEOGRAPHY(POINT, 4326),
  photos TEXT[],
  status VARCHAR(50) DEFAULT 'missing',
  found_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

