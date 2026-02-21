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

        // Look up the DB role and organization (source of truth)
        const dbUser = await db.query(
            `SELECT u.role, u.organization_id, o.name as organization_name
             FROM users u
             LEFT JOIN organizations o ON u.organization_id = o.id
             WHERE u.clerk_user_id = $1`,
            [user.id]
        );
        const dbRole = dbUser.rows[0]?.role || 'volunteer';
        const orgId = dbUser.rows[0]?.organization_id || null;
        const orgName = dbUser.rows[0]?.organization_name || null;

        res.json({
            id: user.id,
            email,
            role: dbRole,
            organization_id: orgId,
            organization_name: orgName,
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

    const validRoles = ['volunteer', 'coordinator', 'admin', 'organization'];

    if (!validRoles.includes(role)) {
        return res.status(400).json({ message: `Invalid role. Allowed: ${validRoles.join(', ')}` });
    }

    try {
        await ensureUserInDb(uid);

        // Update user metadata in Clerk
        const user = await clerkClient.users.updateUserMetadata(uid, {
            publicMetadata: { role }
        });

        // Update role in our Postgres users table (source of truth)
        const dbResult = await db.query(
            'UPDATE users SET role = $1, updated_at = NOW() WHERE clerk_user_id = $2 RETURNING *',
            [role, uid]
        );

        res.json({
            id: user.id,
            role: role,
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
            `SELECT u.id, u.clerk_user_id, u.full_name, u.email, u.role, u.phone, u.avatar_url, u.created_at, u.updated_at,
                    EXISTS(
                      SELECT 1 FROM tasks t 
                      WHERE t.volunteer_id = u.id AND t.status IN ('pending', 'in_progress')
                    ) AS is_assigned
             FROM users u
             ORDER BY u.created_at DESC
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

// @desc    Onboard user with form details
// @route   POST /api/users/onboard
// @access  Private
const onboardUser = async (req, res) => {
    try {
        const uid = req.user.id;
        const { role, phone, organization_id } = req.body;

        const validRoles = ['volunteer', 'coordinator', 'organization'];
        if (!validRoles.includes(role)) {
            return res.status(400).json({ message: "Invalid role for onboarding. Allowed: " + validRoles.join(', ') });
        }

        // Ensure user is in our local DB
        await ensureUserInDb(uid);

        // Update Clerk metadata
        await clerkClient.users.updateUserMetadata(uid, {
            publicMetadata: { role }
        });

        // Update local DB role and optional phone
        await db.query(
            'UPDATE users SET role = $1, phone = COALESCE($2, phone), updated_at = NOW() WHERE clerk_user_id = $3',
            [role, phone || null, uid]
        );

        res.status(200).json({ message: "Onboarding complete", role });

    } catch (err) {
        console.error('[500] onboardUser error:', err?.message || err);
        res.status(500).json({
            message: 'Failed to complete onboarding',
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
