-- Sairaj feature support: AI allocation preference + audit log table
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS ai_allocation_preference varchar(20) DEFAULT 'full';

CREATE TABLE IF NOT EXISTS activity_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    action_type varchar NOT NULL DEFAULT 'INFO',
    entity_type varchar NOT NULL DEFAULT 'SYSTEM',
    entity_id uuid,
    description text,
    organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
    user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    metadata jsonb,
    created_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_org ON activity_logs(organization_id);
