const { clerkClient } = require('@clerk/clerk-sdk-node');
const db = require('../config/db');
const { ensureUserInDb } = require('../utils/userSync');

// @desc    Get current user profile
// @route   GET /api/users/me
// @access  Private (Any authenticated user)
const getMe = async (req, res) => {
    try {
        const user = req.user;
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        const email = user.emailAddresses?.[0]?.emailAddress ?? null;
        res.json({
            id: user.id,
            email,
            role: req.role ?? 'org:user',
            created_at: user.createdAt,
            last_login_at: user.lastSignInAt ?? null,
        });
    } catch (err) {
        console.error('[500] getMe error:', err?.message || err);
        if (process.env.NODE_ENV !== 'production') console.error(err?.stack);
        res.status(500).json({
            message: 'Failed to load profile',
            ...(process.env.NODE_ENV !== 'production' && { detail: err?.message }),
        });
    }
};

// @desc    Update user role (Admin only)
// @route   PUT /api/users/:uid/role
// @access  Private (Admin only)
const updateUserRole = async (req, res) => {
    const { uid } = req.params;
    const { role } = req.body;

    const validRoles = ['org:user', 'org:member', 'org:volunteer', 'org:volunteer_head', 'org:admin'];

    if (!validRoles.includes(role)) {
        return res.status(400).json({ message: `Invalid role. Allowed: ${validRoles.join(', ')}` });
    }

    try {
        // Ensure user exists in DB so we can keep DB + Clerk in sync
        await ensureUserInDb(uid);

        // Update user metadata in Clerk (used by frontends / Clerk dashboard)
        const user = await clerkClient.users.updateUserMetadata(uid, {
            publicMetadata: {
                role: role
            }
        });

        // Persist role in our Postgres users table (source of truth for backend access)
        // Map API role -> DB role
        const roleMap = {
            'org:user': 'citizen',
            'org:volunteer': 'volunteer',
            'org:volunteer_head': 'volunteer_head',
            'org:member': 'citizen',
            'org:admin': 'admin'
        };
        const dbRole = roleMap[role] || 'citizen';

        const dbResult = await db.query(
            'UPDATE users SET role = $1, updated_at = NOW() WHERE clerk_user_id = $2 RETURNING *',
            [dbRole, uid]
        );

        res.json({
            id: user.id,
            role: user.publicMetadata.role,
            dbRole: dbResult.rows[0]?.role ?? null,
            updatedAt: user.updatedAt
        });

    } catch (error) {
        console.error('Role update error:', error);
        res.status(500).json({ message: "Failed to update role", error: error.message });
    }
};

// @desc    List all users (Admin only)
// @route   GET /api/users
// @access  Private (Admin only)
const listUsers = async (req, res) => {
    try {
        const result = await db.query(
            `SELECT id, clerk_user_id, full_name, email, role, phone, avatar_url, created_at, updated_at
             FROM users
             ORDER BY created_at DESC
             LIMIT 200`
        );
        res.json(result.rows);
    } catch (err) {
        console.error('[500] listUsers error:', err?.message || err);
        res.status(500).json({
            message: 'Failed to list users',
            ...(process.env.NODE_ENV !== 'production' && { detail: err?.message }),
        });
    }
};

// @desc    Onboard user with form details (Volunteer or Volunteer Head)
// @route   POST /api/users/onboard
// @access  Private
const onboardUser = async (req, res) => {
    try {
        const uid = req.user.id;
        const { role, skills, radius, organization, certification_id, region } = req.body;

        if (!['org:volunteer', 'org:volunteer_head'].includes(role)) {
            return res.status(400).json({ message: "Invalid role for onboarding" });
        }

        // 1. Ensure user is in our local DB
        await ensureUserInDb(uid);

        // 2. Fetch the actual postgres UUID for this user
        const userDbResult = await db.query('SELECT id FROM users WHERE clerk_user_id = $1', [uid]);
        if (userDbResult.rows.length === 0) {
            return res.status(404).json({ message: "Local user record not found" });
        }
        const dbUserId = userDbResult.rows[0].id;

        // 3. Update Clerk metadata
        await clerkClient.users.updateUserMetadata(uid, {
            publicMetadata: { role: role }
        });

        // 4. Update local DB Role
        await db.query(
            'UPDATE users SET role = $1, updated_at = NOW() WHERE clerk_user_id = $2',
            [role, uid]
        );

        // 5. Insert into respective sub-tables based on selected role
        if (role === 'org:volunteer') {
            await db.query(`
                INSERT INTO volunteers (user_id, clerk_user_id, skills, service_area, is_available) 
                VALUES ($1, $2, $3, ST_Buffer(ST_MakePoint(0,0), $4::float), true)
                ON CONFLICT (id) DO NOTHING
            `, [dbUserId, uid, skills || [], radius || 10]);
        } else if (role === 'org:volunteer_head') {
            await db.query(`
                INSERT INTO volunteer_heads (user_id, clerk_user_id, organization, certification_id, region)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (id) DO NOTHING
            `, [dbUserId, uid, organization || '', certification_id || '', region || '']);
        }

        res.status(200).json({ message: "Onboarding complete", role });

    } catch (err) {
        console.error('[500] onboardUser error:', err?.message || err);
        res.status(500).json({
            message: 'Failed to complete onboarding Form',
            ...(process.env.NODE_ENV !== 'production' && { detail: err?.message }),
        });
    }
};

module.exports = {
    getMe,
    updateUserRole,
    listUsers,
    onboardUser
};
