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
  const fullName = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') || null;

  // Role mapping: Clerk uses org:role, DB uses simplified roles (citizen, admin, etc.)
  let role = clerkUser.publicMetadata?.role || 'citizen';

  // Normalize roles to match DB constraints
  const roleMap = {
    'org:user': 'citizen',
    'org:volunteer': 'volunteer',
    'org:volunteer_head': 'volunteer_head',
    'org:member': 'citizen',
    'org:admin': 'admin'
  };

  if (roleMap[role]) {
    role = roleMap[role];
  } else if (!['citizen', 'volunteer', 'volunteer_head', 'admin'].includes(role)) {
    // Default fallback if unknown role format
    role = 'citizen';
  }

  const avatarUrl = clerkUser.imageUrl || null;

  const insert = await db.query(
    `INSERT INTO users (clerk_user_id, email, phone, full_name, role, avatar_url, last_active)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     RETURNING *`,
    [clerkUserId, email, phone, fullName, role, avatarUrl]
  );

  console.log(`[userSync] New user created in DB: ${clerkUserId} (${email || 'no email'}) role=${role}`);

  return insert.rows[0];
}

module.exports = {
  ensureUserInDb,
};

