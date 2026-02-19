const { clerkClient } = require('@clerk/clerk-sdk-node');

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
        // Update user metadata in Clerk
        const user = await clerkClient.users.updateUserMetadata(uid, {
            publicMetadata: {
                role: role
            }
        });

        res.json({
            id: user.id,
            role: user.publicMetadata.role,
            updatedAt: user.updatedAt
        });

    } catch (error) {
        console.error('Clerk Error:', error);
        res.status(500).json({ message: "Failed to update role", error: error.message });
    }
};

module.exports = {
    getMe,
    updateUserRole
};
