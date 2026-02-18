const { clerkClient } = require('@clerk/clerk-sdk-node');

// @desc    Get current user profile
// @route   GET /api/users/me
// @access  Private (Any authenticated user)
const getMe = async (req, res) => {
    // req.user is populated by checkRole() middleware, fetched from Clerk
    if (req.user) {
        res.json({
            id: req.user.id,
            email: req.user.emailAddresses[0]?.emailAddress, // Clerk stores emails in an array
            role: req.role, // From checkRole middleware
            created_at: req.user.createdAt,
            last_login_at: req.user.lastSignInAt
        });
    } else {
        res.status(404).json({ message: "User not found" });
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
