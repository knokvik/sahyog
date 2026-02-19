const { clerkClient } = require('@clerk/clerk-sdk-node');
const db = require('../config/db');

// Ensure a Clerk user exists in our Postgres users table and return the row
async function ensureUserInDb(clerkUserId) {
  if (!clerkUserId) {
    throw new Error('Missing clerkUserId');
  }

  const existing = await db.query('SELECT * FROM users WHERE clerk_user_id = $1', [clerkUserId]);
  if (existing.rows.length > 0) {
    return existing.rows[0];
  }

  const clerkUser = await clerkClient.users.getUser(clerkUserId);

  const email = clerkUser.emailAddresses?.[0]?.emailAddress || null;
  const phone = clerkUser.phoneNumbers?.[0]?.phoneNumber || null;
  const fullName = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') || null;
  const role = clerkUser.publicMetadata?.role || 'org:user';
  const avatarUrl = clerkUser.imageUrl || null;

  const insert = await db.query(
    `INSERT INTO users (clerk_user_id, email, phone, full_name, role, avatar_url, last_active)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     RETURNING *`,
    [clerkUserId, email, phone, fullName, role, avatarUrl]
  );

  return insert.rows[0];
}

module.exports = {
  ensureUserInDb,
};

