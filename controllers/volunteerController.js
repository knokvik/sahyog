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

module.exports = {
  registerVolunteer,
  verifyVolunteer,
  toggleAvailability,
  updateLocation,
  getMyTasks,
  listVolunteers,
  getVolunteerById,
};

