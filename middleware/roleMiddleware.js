const { clerkClient } = require('@clerk/clerk-sdk-node');

// Middleware to check role using Clerk Metadata
const checkRole = (requiredRole) => {
    return async (req, res, next) => {
        // req.auth is populated by Clerk middleware (verifyJWT/authMiddleware)
        const { userId } = req.auth || {};

        if (!userId) {
            return res.status(401).json({ message: "Unauthorized: No user session" });
        }

        try {
            // Get user from Clerk
            const user = await clerkClient.users.getUser(userId);

            // Get role from public metadata (default: 'org:user')
            const role = user.publicMetadata.role || 'org:user';

            // Role Hierarchy / Check
            // Ideally use a sophisticated check, but simple equality or 'org:admin' override works for now.

            if (role === 'org:admin') {
                // Admin has access to everything
                req.user = user;
                req.role = role;
                return next();
            }

            if (requiredRole && role !== requiredRole) {
                return res.status(403).json({ message: `Access denied. Requires ${requiredRole} role.` });
            }

            // Attach full user object to request
            req.user = user;
            req.role = role;

            next();
        } catch (err) {
            console.error('[500] Clerk/auth error:', err?.message || err);
            if (process.env.NODE_ENV !== 'production') console.error(err?.stack);
            res.status(500).json({
                message: 'Authentication error',
                ...(process.env.NODE_ENV !== 'production' && { detail: err?.message }),
            });
        }
    };
};

module.exports = checkRole;
