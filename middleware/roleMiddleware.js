const { clerkClient } = require('@clerk/clerk-sdk-node');
const db = require('../config/db');
const { ensureUserInDb } = require('../utils/userSync');

// Middleware to check role using database (source of truth),
// synced from Clerk on first access.
const checkRole = (requiredRole) => {
  return async (req, res, next) => {
    // req.auth is populated by Clerk middleware (verifyJWT/authMiddleware)
    const { userId } = req.auth || {};

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized: No user session' });
    }

    try {
      // Always load the Clerk user for downstream usage (email, avatar, etc.)
      const clerkUser = await clerkClient.users.getUser(userId);

      // Ensure user exists in Postgres and fetch their row
      const dbUser = await ensureUserInDb(userId);

      // Prefer role from DB, fall back to Clerk metadata, then default
      let rawRole = dbUser.role || clerkUser.publicMetadata?.role || 'citizen';

      // Normalize DB roles (citizen, admin) -> App roles (org:user, org:admin)
      // This ensures the rest of the app (frontend, etc.) sees the expected format
      const dbToAppRole = {
        'citizen': 'org:user',
        'volunteer': 'org:volunteer',
        'volunteer_head': 'org:volunteer_head',
        'admin': 'org:admin'
      };

      // Also handle cases where rawRole is already in org: format or unknown
      const role = dbToAppRole[rawRole] || rawRole;

      // If DB row somehow has no role but Clerk metadata does, sync it once
      // Note: We sync the *raw* Clerk role (org:...) which ensureUserInDb will normalize
      if (!dbUser.role && clerkUser.publicMetadata?.role) {
        try {
          await db.query(
            'UPDATE users SET role = $1, updated_at = NOW() WHERE clerk_user_id = $2',
            [roleFromClerk, userId]
          );
        } catch (syncErr) {
          // Best-effort sync; do not block request on this
          console.error('Failed to sync role from Clerk to DB:', syncErr?.message || syncErr);
        }
      }

      // Admin has access to everything
      if (role === 'org:admin') {
        req.user = clerkUser;
        req.dbUser = dbUser;
        req.role = role;
        return next();
      }

      if (requiredRole && role !== requiredRole) {
        return res
          .status(403)
          .json({ message: `Access denied. Requires ${requiredRole} role.` });
      }

      // Attach user objects and resolved role to request
      req.user = clerkUser;
      req.dbUser = dbUser;
      req.role = role;

      next();
    } catch (err) {
      console.error('[500] Clerk/auth/role error:', err?.message || err);
      if (process.env.NODE_ENV !== 'production') console.error(err?.stack);
      res.status(500).json({
        message: 'Authentication error',
        ...(process.env.NODE_ENV !== 'production' && { detail: err?.message }),
      });
    }
  };
};

module.exports = checkRole;
