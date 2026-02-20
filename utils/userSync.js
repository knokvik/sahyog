const { clerkClient } = require('@clerk/clerk-sdk-node');
const db = require('../config/db');

// Ensure a Clerk user exists in our Postgres users table and return the row
async function ensureUserInDb(clerkUserId) {
  if (!clerkUserId) {
    throw new Error('Missing clerkUserId');
  }

  const existing = await db.query('SELECT * FROM users WHERE clerk_user_id = $1', [clerkUserId]);
  if (existing.rows.length > 0) {
    await db.query('UPDATE users SET last_active = NOW() WHERE clerk_user_id = $1', [clerkUserId]);
    return existing.rows[0];
  }

  const clerkUser = await clerkClient.users.getUser(clerkUserId);

  const email = clerkUser.emailAddresses?.[0]?.emailAddress || null;
  const phone = clerkUser.phoneNumbers?.[0]?.phoneNumber || null;
  const fullName = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') || 'Sahayanet User';

  // Role mapping: Clerk uses org:role, DB uses simplified roles: volunteer, coordinator, admin, organization
  let role = clerkUser.publicMetadata?.role || 'volunteer';

  // Normalize roles to match DB constraints
  const roleMap = {
    'org:user': 'volunteer',
    'org:volunteer': 'volunteer',
    'org:volunteer_head': 'coordinator',
    'org:coordinator': 'coordinator',
    'org:member': 'volunteer',
    'org:admin': 'admin',
    'org:organization': 'organization'
  };

  if (roleMap[role]) {
    role = roleMap[role];
  } else if (!['volunteer', 'coordinator', 'admin', 'organization'].includes(role)) {
    // Default fallback if unknown role format
    role = 'volunteer';
  }

  const avatarUrl = clerkUser.imageUrl || null;

  try {
    const insert = await db.query(
      `INSERT INTO users (clerk_user_id, email, phone, full_name, role, avatar_url, last_active)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (email) DO UPDATE 
       SET clerk_user_id = EXCLUDED.clerk_user_id, last_active = NOW()
       RETURNING *`,
      [clerkUserId, email, phone, fullName, role, avatarUrl]
    );

    console.log(`[userSync] New user created/updated in DB: ${clerkUserId} (${email || 'no email'}) role=${role}`);
    return insert.rows[0];
  } catch (err) {
    // If phone conflict or other issue occurs, fetch by email/phone again just to be safe
    console.error(`[userSync] Insert failed for ${clerkUserId}, falling back to lookup:`, err.message);
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
