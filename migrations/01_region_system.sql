-- =========================================
-- SAHAYANET NEW REGION & TASK SCHEMA
-- =========================================

-- 1. Create Regions Table
CREATE TABLE IF NOT EXISTS regions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    description text,
    created_at timestamp DEFAULT now()
);

-- 2. Update Users Table
ALTER TABLE users ADD COLUMN IF NOT EXISTS region_id uuid REFERENCES regions(id) ON DELETE SET NULL;

-- 3. Drop existing tasks table so we can recreate it 
-- (According to user instructions, we are replacing it since it was relying on need_id which is part of an older workflow)
DROP TABLE IF EXISTS tasks CASCADE;

-- 4. Create New Tasks Table
CREATE TABLE tasks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL,
    description text,
    region_id uuid REFERENCES regions(id),
    assigned_to uuid REFERENCES users(id),
    assigned_by uuid REFERENCES users(id),
    status varchar DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'completed', 'rejected')),
    proof_urls text[],
    created_at timestamp DEFAULT now(),
    completed_at timestamp
);

-- Note: We can retain the missing persons, resources, and sos_alerts as they are.
-- Users role check constraint needs updating if it doesn't already allow 'admin' and 'coordinator'.
-- The current schema has: CHECK (role IN ('volunteer', 'coordinator', 'admin', 'organization'))
-- So role constraints are already suitable. We might just need to drop and re-add if it doesn't match exactly.

-- ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
-- ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('volunteer', 'coordinator', 'admin', 'organization'));

-- 5. Create Notifications Table
CREATE TABLE IF NOT EXISTS notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    region_id uuid REFERENCES regions(id) ON DELETE CASCADE,
    type varchar NOT NULL,
    title varchar NOT NULL,
    message text NOT NULL,
    read boolean DEFAULT false,
    created_at timestamp DEFAULT now()
);
