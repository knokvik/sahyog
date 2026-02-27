const db = require('../config/db');
const { ensureUserInDb } = require('../utils/userSync');

// POST /api/v1/volunteers/register
async function registerVolunteer(req, res) {
  try {
    const { userId } = req.auth || {};
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const user = await ensureUserInDb(userId);
    const { skills } = req.body;

    const existing = await db.query('SELECT * FROM volunteers WHERE clerk_user_id = $1', [user.clerk_user_id]);
    if (existing.rows.length > 0) {
      return res.json(existing.rows[0]);
    }

    const result = await db.query(
      `INSERT INTO volunteers (user_id, clerk_user_id, skills, is_verified, is_available)
       VALUES ($1, $2, $3, FALSE, FALSE)
       RETURNING *`,
      [user.id, user.clerk_user_id, skills || []]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error registering volunteer:', err);
    res.status(500).json({ message: 'Failed to register volunteer' });
  }
}

// PATCH /api/v1/volunteers/:id/verify (admin)
async function verifyVolunteer(req, res) {
  try {
    const { id } = req.params;
    const { isVerified } = req.body;

    const result = await db.query(
      'UPDATE volunteers SET is_verified = $1 WHERE id = $2 RETURNING *',
      [Boolean(isVerified), id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Volunteer not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error verifying volunteer:', err);
    res.status(500).json({ message: 'Failed to verify volunteer' });
  }
}

// PATCH /api/v1/volunteers/availability
async function toggleAvailability(req, res) {
  try {
    const { userId } = req.auth || {};
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const volunteerRes = await db.query('SELECT * FROM volunteers WHERE clerk_user_id = $1', [userId]);
    if (volunteerRes.rows.length === 0) {
      return res.status(404).json({ message: 'Volunteer record not found' });
    }

    const current = volunteerRes.rows[0];
    const updated = await db.query(
      'UPDATE volunteers SET is_available = NOT is_available WHERE id = $1 RETURNING *',
      [current.id]
    );

    res.json(updated.rows[0]);
  } catch (err) {
    console.error('Error toggling availability:', err);
    res.status(500).json({ message: 'Failed to toggle availability' });
  }
}

// POST /api/v1/volunteers/location
async function updateLocation(req, res) {
  try {
    const { userId } = req.auth || {};
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const { lat, lng } = req.body;
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return res.status(400).json({ message: 'lat and lng are required numbers' });
    }

    const volunteerRes = await db.query('SELECT * FROM volunteers WHERE clerk_user_id = $1', [userId]);
    if (volunteerRes.rows.length === 0) {
      return res.status(404).json({ message: 'Volunteer record not found' });
    }

    const updated = await db.query(
      `UPDATE volunteers
       SET current_location = ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
       WHERE id = $3
       RETURNING *`,
      [lng, lat, volunteerRes.rows[0].id]
    );

    res.json(updated.rows[0]);
  } catch (err) {
    console.error('Error updating volunteer location:', err);
    res.status(500).json({ message: 'Failed to update location' });
  }
}

// GET /api/v1/volunteers/tasks
async function getMyTasks(req, res) {
  try {
    const { userId } = req.auth || {};
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const volunteerRes = await db.query('SELECT * FROM volunteers WHERE clerk_user_id = $1', [userId]);
    if (volunteerRes.rows.length === 0) {
      return res.status(404).json({ message: 'Volunteer record not found' });
    }

    const result = await db.query(
      `SELECT t.*
       FROM tasks t
       WHERE t.volunteer_id = $1
       ORDER BY t.created_at DESC`,
      [volunteerRes.rows[0].id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching volunteer tasks:', err);
    res.status(500).json({ message: 'Failed to fetch tasks' });
  }
}

// GET /api/v1/volunteers
async function listVolunteers(req, res) {
  try {
    const result = await db.query(
      `SELECT v.*, u.full_name, u.email, u.role
       FROM volunteers v
       JOIN users u ON v.user_id = u.id
       ORDER BY u.created_at DESC
       LIMIT 200`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing volunteers:', err);
    res.status(500).json({ message: 'Failed to list volunteers' });
  }
}

// GET /api/v1/volunteers/:id
async function getVolunteerById(req, res) {
  try {
    const { id } = req.params;
    const result = await db.query(
      `SELECT v.*, u.full_name, u.email, u.role
       FROM volunteers v
       JOIN users u ON v.user_id = u.id
       WHERE v.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Volunteer not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching volunteer:', err);
    res.status(500).json({ message: 'Failed to fetch volunteer' });
  }
}

// GET /api/v1/volunteers/available (Coordinator/Admin)
async function listAvailableVolunteers(req, res) {
  try {
    const { org_id } = req.query;
    const currentUser = req.dbUser;

    // If no org_id provided, default to current user's org
    const targetOrgId = org_id || currentUser?.organization_id;

    if (!targetOrgId) {
      return res.status(400).json({ message: 'organization_id is required' });
    }

    // Define exhaustion limit (max 3 active tasks)
    const MAX_ACTIVE_TASKS = 3;

    const result = await db.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.avatar_url,
              ST_X(u.current_location::geometry) AS lng,
              ST_Y(u.current_location::geometry) AS lat,
              (SELECT COUNT(*) FROM tasks t 
               WHERE t.volunteer_id = u.id AND t.status IN ('pending', 'accepted', 'in_progress')) as active_tasks
       FROM users u
       WHERE u.organization_id = $1 
         AND u.role = 'volunteer'
         AND u.is_active = true
       HAVING (SELECT COUNT(*) FROM tasks t 
               WHERE t.volunteer_id = u.id AND t.status IN ('pending', 'accepted', 'in_progress')) < $2
       ORDER BY active_tasks ASC, u.full_name ASC`,
      [targetOrgId, MAX_ACTIVE_TASKS]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error listing available volunteers:', err);
    res.status(500).json({ message: 'Failed to list available volunteers' });
  }
}

// GET /api/v1/volunteers/locations
async function listVolunteerLocations(req, res) {
  try {
    const result = await db.query(
      `SELECT
         u.id,
         u.full_name,
         u.role,
         u.is_active,
         u.last_active,
         ST_X(u.current_location::geometry) AS lng,
         ST_Y(u.current_location::geometry) AS lat,
         z.name AS zone_name
       FROM users u
       LEFT JOIN LATERAL (
         SELECT z2.name
         FROM tasks t2
         LEFT JOIN zones z2 ON z2.id = t2.zone_id
         WHERE t2.volunteer_id = u.id
           AND t2.status IN ('pending', 'accepted', 'in_progress')
         ORDER BY t2.created_at DESC
         LIMIT 1
       ) z ON TRUE
       WHERE u.role IN ('volunteer', 'coordinator')
         AND u.current_location IS NOT NULL
       ORDER BY u.last_active DESC NULLS LAST`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing volunteer locations:', err);
    res.status(500).json({ message: 'Failed to list volunteer locations' });
  }
}

// PATCH /api/v1/admin/workflows/volunteers/:id/deactivate
async function deactivateVolunteer(req, res) {
  try {
    const { id } = req.params;
    const result = await db.query(
      `UPDATE users
       SET is_active = false,
           updated_at = NOW()
       WHERE id = $1
         AND role = 'volunteer'
       RETURNING id, full_name, email, role, is_active`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Volunteer not found' });
    }

    // Best effort sync with volunteers table for older deployments
    try {
      await db.query(
        `UPDATE volunteers
         SET is_available = false
         WHERE user_id = $1`,
        [id]
      );
    } catch (_) {}

    res.json({ message: 'Volunteer deactivated', volunteer: result.rows[0] });
  } catch (err) {
    console.error('Error deactivating volunteer:', err);
    res.status(500).json({ message: 'Failed to deactivate volunteer' });
  }
}

module.exports = {
  registerVolunteer,
  verifyVolunteer,
  toggleAvailability,
  updateLocation,
  getMyTasks,
  listVolunteers,
  getVolunteerById,
  listAvailableVolunteers,
  listVolunteerLocations,
  deactivateVolunteer,
};
