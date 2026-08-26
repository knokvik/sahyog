require('dotenv').config();
const { Pool } = require('pg');
const { clerkClient } = require('@clerk/clerk-sdk-node');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    const userRes = await pool.query("SELECT * FROM users WHERE email = $1", ['niraj.naphade30@gmail.com']);
    if (userRes.rows.length === 0) {
      console.error('User not found with email niraj.naphade30@gmail.com');
      return;
    }
    const user = userRes.rows[0];
    console.log('Found user:', user.email, '| Current role:', user.role, '| Clerk ID:', user.clerk_user_id);

    // Check if an org already exists or create one
    let orgId = user.organization_id;
    if (!orgId) {
      const orgCheck = await pool.query("SELECT id FROM organizations WHERE email = $1", [user.email]);
      if (orgCheck.rows.length > 0) {
        orgId = orgCheck.rows[0].id;
        console.log('Found existing org for email:', orgId);
      } else {
        const newOrg = await pool.query(
          "INSERT INTO organizations (name, registration_number, primary_phone, email, state, district, type) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
          [
            'Sahyog Relief & Response Organization',
            'NGO-MH-2026-030',
            user.phone || '+918674378234',
            user.email,
            'Maharashtra',
            'Pune',
            'ngo'
          ]
        );
        orgId = newOrg.rows[0].id;
        console.log('Created new organization:', newOrg.rows[0].name, 'ID:', orgId);
      }
    }

    // Update user to role 'organization' and set organization_id
    const updatedUser = await pool.query(
      "UPDATE users SET role = 'organization', organization_id = $1, is_active = true, is_verified = true, updated_at = NOW() WHERE id = $2 RETURNING id, email, full_name, role, organization_id",
      [orgId, user.id]
    );
    console.log('Updated user in DB:', updatedUser.rows[0]);

    // Sync Clerk metadata if clerk_user_id exists
    if (user.clerk_user_id) {
      try {
        await clerkClient.users.updateUserMetadata(user.clerk_user_id, {
          publicMetadata: { role: 'organization' }
        });
        console.log('Successfully updated Clerk publicMetadata for', user.clerk_user_id);
      } catch (clerkErr) {
        console.warn('Clerk sync warning:', clerkErr?.message);
      }
    }

    console.log('✅ Successfully shifted niraj.naphade30@gmail.com to organization!');
  } catch (err) {
    console.error('Error shifting user to organization:', err);
  } finally {
    await pool.end();
  }
}

run();
