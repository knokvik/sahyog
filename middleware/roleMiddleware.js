const { clerkClient } = require('@clerk/clerk-sdk-node');
const db = require('../config/db');
const { ensureUserInDb } = require('../utils/userSync');

const checkRole = (requiredRole) => {
  return async (req, res, next) => {
    const { userId } = req.auth || {};

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized: No user session' });
    }

    try {
      const clerkUser = await clerkClient.users.getUser(userId);
      const dbUser = await ensureUserInDb(userId);

      let rawRole = dbUser.role || clerkUser.publicMetadata?.role || 'volunteer';

      const dbToAppRole = {
        'volunteer': 'volunteer',
        'coordinator': 'coordinator',
        'admin': 'admin',
        'organization': 'organization',
        'org:user': 'volunteer',
        'org:volunteer': 'volunteer',
        'org:volunteer_head': 'coordinator',
        'org:coordinator': 'coordinator',
        'org:admin': 'admin',
        'org:organization': 'organization'
      };

      const role = dbToAppRole[rawRole] || 'volunteer';

      if (!dbUser.role && clerkUser.publicMetadata?.role) {
        try {
          await db.query(
            'UPDATE users SET role = $1, updated_at = NOW() WHERE clerk_user_id = $2',
            [role, userId]
          );
        } catch (syncErr) {
          console.error('Failed to sync role from Clerk to DB:', syncErr?.message || syncErr);
        }
      }

      if (role === 'admin') {
        req.user = clerkUser;
        req.dbUser = dbUser;
        req.role = role;
        return next();
      }

      if (requiredRole) {
        let normalizedReqRole = dbToAppRole[requiredRole] || requiredRole;
        if (role !== normalizedReqRole) {
          return res
            .status(403)
            .json({ message: `Access denied. Requires ${normalizedReqRole} role.` });
        }
      }

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
