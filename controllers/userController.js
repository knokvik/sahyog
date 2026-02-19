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

module.exports = {
    getMe,
    updateUserRole
};
