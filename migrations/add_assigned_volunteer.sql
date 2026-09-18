-- Add assigned_volunteer_id column to sos_alerts table
ALTER TABLE sos_alerts ADD COLUMN IF NOT EXISTS assigned_volunteer_id UUID REFERENCES users(id);
