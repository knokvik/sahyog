-- Sahyog sample data for Supabase SQL Editor (Postgres + PostGIS)
-- 1. Run schema.sql first (Tables + PostGIS). 2. Then run this entire file.
-- In Supabase: SQL Editor → New query → paste → Run. Safe to run multiple times (ON CONFLICT skips existing rows).

-- Ensure PostGIS exists (Supabase has it; ignore error if already enabled)
CREATE EXTENSION IF NOT EXISTS postgis;

-- ========== USERS ==========
-- Roles must match your DB CHECK: 'citizen' | 'volunteer' | 'volunteer_head' | 'admin'
INSERT INTO users (id, clerk_user_id, email, full_name, role) VALUES
  ('a0000001-0000-4000-8000-000000000001', 'clerk_admin_1', 'admin@sahyog.test', 'Admin User', 'admin'),
  ('a0000001-0000-4000-8000-000000000002', 'clerk_volunteer_1', 'volunteer@sahyog.test', 'Volunteer One', 'volunteer'),
  ('a0000001-0000-4000-8000-000000000003', 'clerk_user_1', 'user@sahyog.test', 'Citizen User', 'citizen')
ON CONFLICT (clerk_user_id) DO NOTHING;

-- ========== VOLUNTEERS ==========
INSERT INTO volunteers (id, user_id, clerk_user_id, is_verified, is_available, current_location, skills, rating, total_tasks) VALUES
  ('b0000001-0000-4000-8000-000000000001', 'a0000001-0000-4000-8000-000000000002', 'clerk_volunteer_1', true, true,
   ST_SetSRID(ST_MakePoint(72.8777, 19.0760), 4326)::geography,
   ARRAY['medical', 'rescue'], 4.8, 5)
ON CONFLICT (id) DO NOTHING;

-- ========== DISASTERS ==========
INSERT INTO disasters (id, name, type, status, severity, activated_at, created_by, clerk_created_by) VALUES
  ('c0000001-0000-4000-8000-000000000001', 'Mumbai Floods 2024', 'flood', 'active', 7, NOW() - INTERVAL '2 days', 'a0000001-0000-4000-8000-000000000001', 'clerk_admin_1'),
  ('c0000001-0000-4000-8000-000000000002', 'Cyclone Alert Coastal', 'cyclone', 'contained', 5, NOW() - INTERVAL '5 days', 'a0000001-0000-4000-8000-000000000001', 'clerk_admin_1')
ON CONFLICT (id) DO NOTHING;

-- ========== SOS REPORTS ==========
INSERT INTO sos_reports (id, reporter_id, clerk_reporter_id, disaster_id, location, type, description, priority_score, status) VALUES
  ('d0000001-0000-4000-8000-000000000001', 'a0000001-0000-4000-8000-000000000003', 'clerk_user_1', 'c0000001-0000-4000-8000-000000000001',
   ST_SetSRID(ST_MakePoint(72.8780, 19.0765), 4326)::geography,
   'medical', 'Elderly person needs evacuation', 8, 'pending'),
  ('d0000001-0000-4000-8000-000000000002', 'a0000001-0000-4000-8000-000000000003', 'clerk_user_1', 'c0000001-0000-4000-8000-000000000001',
   ST_SetSRID(ST_MakePoint(72.8790, 19.0770), 4326)::geography,
   'rescue', 'Family stuck on roof', 9, 'in_progress'),
  ('d0000001-0000-4000-8000-000000000003', 'a0000001-0000-4000-8000-000000000003', 'clerk_user_1', NULL,
   ST_SetSRID(ST_MakePoint(72.8800, 19.0780), 4326)::geography,
   'supplies', 'Need water and food', 5, 'resolved')
ON CONFLICT (id) DO NOTHING;

-- ========== TASKS (link to SOS and volunteer) ==========
INSERT INTO tasks (id, sos_id, volunteer_id, assigned_by, status, instructions) VALUES
  ('e0000001-0000-4000-8000-000000000001', 'd0000001-0000-4000-8000-000000000001', 'b0000001-0000-4000-8000-000000000001', 'a0000001-0000-4000-8000-000000000001', 'assigned', 'Evacuate elderly person from building A'),
  ('e0000001-0000-4000-8000-000000000002', 'd0000001-0000-4000-8000-000000000002', 'b0000001-0000-4000-8000-000000000001', 'a0000001-0000-4000-8000-000000000001', 'in_progress', 'Rescue family from roof')
ON CONFLICT (id) DO NOTHING;

-- ========== SHELTERS ==========
INSERT INTO shelters (id, name, location, capacity, current_occupancy, facilities, manager_id, status) VALUES
  ('f0000001-0000-4000-8000-000000000001', 'Central Relief Shelter 1', ST_SetSRID(ST_MakePoint(72.8700, 19.0700), 4326)::geography, 200, 45, ARRAY['medical', 'food', 'beds'], 'a0000001-0000-4000-8000-000000000001', 'active'),
  ('f0000001-0000-4000-8000-000000000002', 'North Zone Shelter', ST_SetSRID(ST_MakePoint(72.8850, 19.0820), 4326)::geography, 100, 12, ARRAY['food', 'beds'], 'a0000001-0000-4000-8000-000000000001', 'active')
ON CONFLICT (id) DO NOTHING;

-- ========== MISSING PERSONS ==========
INSERT INTO missing_persons (id, reporter_id, disaster_id, name, age, description, last_seen_location, status) VALUES
  ('90000001-0000-4000-8000-000000000001', 'a0000001-0000-4000-8000-000000000003', 'c0000001-0000-4000-8000-000000000001', 'Ravi Kumar', 65, 'Last seen near main road during evacuation', ST_SetSRID(ST_MakePoint(72.8777, 19.0760), 4326)::geography, 'missing'),
  ('90000001-0000-4000-8000-000000000002', 'a0000001-0000-4000-8000-000000000003', 'c0000001-0000-4000-8000-000000000001', 'Priya Sharma', 34, 'Wearing red saree, separated at relief camp', NULL, 'found')
ON CONFLICT (id) DO NOTHING;

-- Optional: link one SOS to a volunteer (assigned_volunteer_id)
UPDATE sos_reports SET assigned_volunteer_id = 'b0000001-0000-4000-8000-000000000001' WHERE id = 'd0000001-0000-4000-8000-000000000002';
