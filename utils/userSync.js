const { clerkClient } = require('@clerk/clerk-sdk-node');
const db = require('../config/db');

// Ensure the users table has the correct schema (columns and constraints)
async function ensureUserSchema() {
  try {
    // 1. Add new columns if they don't exist
    await db.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS blood_group varchar(10);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS medical_history text;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS address text;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_system_admin boolean DEFAULT false;
    `);

    // 2. Ensure assignment tables exist
    await db.query(`
      CREATE TABLE IF NOT EXISTS disaster_coordinator_assignments (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          disaster_id uuid REFERENCES disasters(id) ON DELETE CASCADE,
          zone_id uuid REFERENCES zones(id) ON DELETE CASCADE,
          organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
          coordinator_id uuid REFERENCES users(id) ON DELETE CASCADE,
          status varchar DEFAULT 'active',
          created_at timestamp DEFAULT now(),
          UNIQUE(disaster_id, zone_id, organization_id, coordinator_id)
      );

      CREATE TABLE IF NOT EXISTS volunteer_disaster_assignments (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          disaster_id uuid REFERENCES disasters(id) ON DELETE CASCADE,
          zone_id uuid REFERENCES zones(id) ON DELETE CASCADE,
          coordinator_id uuid REFERENCES users(id) ON DELETE CASCADE,
          volunteer_id uuid REFERENCES users(id) ON DELETE CASCADE,
          status varchar DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
          responded_at timestamp,
          created_at timestamp DEFAULT now(),
          UNIQUE(disaster_id, volunteer_id)
      );
    `);

    // 4. Ensure organizations table is up to date
    await db.query(`
      ALTER TABLE organizations ADD COLUMN IF NOT EXISTS type varchar DEFAULT 'ngo';
      ALTER TABLE organizations ADD COLUMN IF NOT EXISTS location geometry(Point, 4326);
      CREATE INDEX IF NOT EXISTS idx_organizations_location ON organizations USING GIST(location);
    `);

    // 5. Update role constraint.
    // we must drop and recreate if 'user' is missing.
    const conResult = await db.query(`
      SELECT pg_get_constraintdef(oid) as def 
      FROM pg_constraint 
      WHERE conname = 'users_role_check'
      `);

    if (conResult.rows.length > 0) {
      const def = conResult.rows[0].def;
      if (!def.includes("'user'")) {
        console.log('[userSync] Updating users_role_check constraint to include "user"...');
        await db.query(`
          ALTER TABLE users DROP CONSTRAINT users_role_check;
          ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK(role IN('volunteer', 'coordinator', 'admin', 'organization', 'user'));
    `);
      }
    } else {
      // If constraint doesn't exist for some reason, create it
      await db.query(`
        ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK(role IN('volunteer', 'coordinator', 'admin', 'organization', 'user'));
    `);
    }
  } catch (err) {
    console.error('[userSync] ensureUserSchema failed (non-critical):', err.message);
  }
}

// Ensure a Clerk user exists in our Postgres users table and return the row
async function ensureUserInDb(clerkUserId) {
  if (!clerkUserId) {
    throw new Error('Missing clerkUserId');
  }

  // Self-healing schema check on first use or periodically
  await ensureUserSchema();

  const existing = await db.query('SELECT * FROM users WHERE clerk_user_id = $1', [clerkUserId]);
  if (existing.rows.length > 0) {
    await db.query('UPDATE users SET last_active = NOW() WHERE clerk_user_id = $1', [clerkUserId]);
    return existing.rows[0];
  }

  const clerkUser = await clerkClient.users.getUser(clerkUserId);

  const email = clerkUser.emailAddresses?.[0]?.emailAddress || null;
  const phone = clerkUser.phoneNumbers?.[0]?.phoneNumber || null;
  const fullName = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') || 'Sahayanet User';

  // Role mapping: Clerk uses org:role, DB uses simplified roles: volunteer, coordinator, admin, organization, user
  let role = clerkUser.publicMetadata?.role || 'user'; // Default new users to 'user' role

  // Normalize roles to match DB constraints
  const roleMap = {
    'org:user': 'volunteer', // Keep legacy mapping? Or change to 'user'? Let's keep for now.
    'org:volunteer': 'volunteer',
    'org:volunteer_head': 'coordinator',
    'org:coordinator': 'coordinator',
    'org:member': 'volunteer',
    'org:admin': 'admin',
    'org:organization': 'organization',
    'user': 'user'
  };

  if (roleMap[role]) {
    role = roleMap[role];
  } else if (!['volunteer', 'coordinator', 'admin', 'organization', 'user'].includes(role)) {
    // Default fallback if unknown role format
    role = 'user';
  }

  const avatarUrl = clerkUser.imageUrl || null;
  const bloodGroup = clerkUser.publicMetadata?.blood_group || null;
  const medicalHistory = clerkUser.publicMetadata?.medical_history || null;
  const address = clerkUser.publicMetadata?.address || null;
  const orgId = clerkUser.publicMetadata?.organization_id || null;
  const isSystemAdmin = clerkUser.publicMetadata?.is_system_admin === true;

  try {
    const insert = await db.query(
      `INSERT INTO users(clerk_user_id, email, phone, full_name, role, avatar_url, blood_group, medical_history, address, organization_id, is_system_admin, last_active)
    VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
       ON CONFLICT(email) DO UPDATE 
       SET clerk_user_id = EXCLUDED.clerk_user_id,
      organization_id = COALESCE(users.organization_id, EXCLUDED.organization_id),
      is_system_admin = EXCLUDED.is_system_admin,
      last_active = NOW()
    RETURNING * `,
      [clerkUserId, email, phone, fullName, role, avatarUrl, bloodGroup, medicalHistory, address, orgId, isSystemAdmin]
    );

    console.log(`[userSync] New user created / updated in DB: ${clerkUserId} (${email || 'no email'}) role = ${role} `);
    return insert.rows[0];
  } catch (err) {
    // If phone conflict or other issue occurs, fetch by email/phone again just to be safe
    console.error(`[userSync] Insert failed for ${clerkUserId}, falling back to lookup: `, err.message);
    const fallback = await db.query('SELECT * FROM users WHERE email = $1 OR phone = $2 LIMIT 1', [email, phone]);
    if (fallback.rows.length > 0) {
      await db.query('UPDATE users SET clerk_user_id = $1, last_active = NOW() WHERE id = $2', [clerkUserId, fallback.rows[0].id]);
      return fallback.rows[0];
    }
    throw err;
  }
}

module.exports = {
  ensureUserInDb,
};
