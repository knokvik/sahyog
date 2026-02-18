const db = require('../config/db');
const { ensureUserInDb } = require('../utils/userSync');

// POST /api/v1/disasters
async function createDisaster(req, res) {
  try {
    const { name, type, severity, polygon } = req.body;
    if (!name) return res.status(400).json({ message: 'name is required' });

    const { userId } = req.auth || {};
    const user = await ensureUserInDb(userId);

    const result = await db.query(
      `INSERT INTO disasters (name, type, severity, affected_area, status, activated_at, created_by, clerk_created_by)
       VALUES (
         $1,
         $2,
         $3,
         CASE WHEN $4 IS NOT NULL THEN ST_GeomFromGeoJSON($4)::geography ELSE NULL END,
         'active',
         NOW(),
         $5,
         $6
       )
       RETURNING *`,
      [name, type || null, severity || null, polygon || null, user.id, user.clerk_user_id]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating disaster:', err);
    res.status(500).json({ message: 'Failed to create disaster' });
  }
}

// GET /api/v1/disasters
async function listDisasters(req, res) {
  try {
    const result = await db.query(
      'SELECT * FROM disasters WHERE status IN (\'active\', \'contained\') ORDER BY activated_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing disasters:', err);
    res.status(500).json({ message: 'Failed to list disasters' });
  }
}

// GET /api/v1/disasters/:id
async function getDisasterById(req, res) {
  try {
    const { id } = req.params;
    const result = await db.query('SELECT * FROM disasters WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Disaster not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching disaster:', err);
    res.status(500).json({ message: 'Failed to fetch disaster' });
  }
}

// PATCH /api/v1/disasters/:id
async function updateDisaster(req, res) {
  try {
    const { id } = req.params;
    const { name, type, severity, status } = req.body;

    const result = await db.query(
      `UPDATE disasters
       SET name = COALESCE($1, name),
           type = COALESCE($2, type),
           severity = COALESCE($3, severity),
           status = COALESCE($4, status)
       WHERE id = $5
       RETURNING *`,
      [name || null, type || null, severity || null, status || null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Disaster not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating disaster:', err);
    res.status(500).json({ message: 'Failed to update disaster' });
  }
}

// POST /api/v1/disasters/:id/activate
async function activateDisaster(req, res) {
  try {
    const { id } = req.params;
    const result = await db.query(
      `UPDATE disasters
       SET status = 'active',
           activated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Disaster not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error activating disaster:', err);
    res.status(500).json({ message: 'Failed to activate disaster' });
  }
}

// POST /api/v1/disasters/:id/resolve
async function resolveDisaster(req, res) {
  try {
    const { id } = req.params;
    const result = await db.query(
      `UPDATE disasters
       SET status = 'resolved',
           resolved_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Disaster not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error resolving disaster:', err);
    res.status(500).json({ message: 'Failed to resolve disaster' });
  }
}

// GET /api/v1/disasters/:id/stats
async function getDisasterStats(req, res) {
  try {
    const { id } = req.params;
    const stats = await db.query(
      `SELECT
         (SELECT COUNT(*) FROM sos_reports WHERE disaster_id = $1) AS total_sos,
         (SELECT COUNT(*) FROM sos_reports WHERE disaster_id = $1 AND status = 'resolved') AS resolved_sos,
         (SELECT COUNT(*) FROM tasks WHERE sos_id IN (SELECT id FROM sos_reports WHERE disaster_id = $1)) AS total_tasks
       `,
      [id]
    );
    res.json(stats.rows[0]);
  } catch (err) {
    console.error('Error getting disaster stats:', err);
    res.status(500).json({ message: 'Failed to get stats' });
  }
}

module.exports = {
  createDisaster,
  listDisasters,
  getDisasterById,
  updateDisaster,
  activateDisaster,
  resolveDisaster,
  getDisasterStats,
};

