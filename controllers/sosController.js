const db = require('../config/db');
const { ensureUserInDb } = require('../utils/userSync');
const { calculatePriority } = require('../utils/priority');

// POST /api/v1/sos
async function createSos(req, res) {
  try {
    const { userId } = req.auth || {};
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const user = await ensureUserInDb(userId);
    const { lat, lng, type, description, mediaUrls, disasterId, peopleCount, hasVulnerable } = req.body;

    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return res.status(400).json({ message: 'lat and lng are required numbers' });
    }

    const now = new Date();
    const priority = calculatePriority({
      type,
      peopleCount,
      hasVulnerable,
      createdAt: now,
    });

    const result = await db.query(
      `INSERT INTO sos_alerts
       (reporter_id, clerk_reporter_id, disaster_id, location, type, description, priority_score, status, media_urls, created_at)
       VALUES (
         $1,
         $2,
         $3,
         ST_SetSRID(ST_MakePoint($4, $5), 4326),
         $6,
         $7,
         $8,
         'triggered',
         $9,
         $10
       )
       RETURNING *`,
      [
        user.id,
        user.clerk_user_id,
        disasterId || null,
        lng,
        lat,
        type || null,
        description || null,
        priority,
        mediaUrls || [],
        now,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating SOS:', err);
    res.status(500).json({ message: 'Failed to create SOS' });
  }
}

// GET /api/v1/sos
async function listSos(req, res) {
  try {
    const role = req.role || 'volunteer';
    const dbUser = req.dbUser;

    if (!dbUser) return res.status(401).json({ message: 'Unauthorized' });

    let queryText = `
      SELECT s.*,
             ST_X(s.location::geometry) AS lng, ST_Y(s.location::geometry) AS lat,
             u.full_name AS volunteer_name,
             d.name      AS disaster_name
      FROM sos_alerts s
      LEFT JOIN users u     ON u.id = s.acknowledged_by
      LEFT JOIN disasters d ON d.id = s.disaster_id`;

    let params = [];

    // Filter logic based on role
    if (role === 'volunteer') {
      // Volunteers might only see alerts they are involved in or all alerts if they need to respond
      // For now, let's keep it to their own created or assigned alerts
      queryText += ` WHERE s.reporter_id = $1 OR s.acknowledged_by = $1`;
      params = [dbUser.id];
    } else if (role === 'user') {
      // Citizens only see their own reports
      queryText += ` WHERE s.reporter_id = $1`;
      params = [dbUser.id];
    }
    // Coordinators see everything in the initial SQL (no WHERE)

    queryText += ` ORDER BY s.created_at DESC LIMIT 100`;

    const result = await db.query(queryText, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing SOS:', err);
    res.status(500).json({ message: 'Failed to list SOS alerts' });
  }
}

// GET /api/v1/sos/:id
async function getSosById(req, res) {
  try {
    const { id } = req.params;
    const result = await db.query('SELECT * FROM sos_alerts WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'SOS alert not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching SOS:', err);
    res.status(500).json({ message: 'Failed to fetch SOS alert' });
  }
}

// PATCH /api/v1/sos/:id/status
async function updateSosStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const { userId } = req.auth || {};
    const role = req.role || 'user';

    const validStatuses = ['triggered', 'acknowledged', 'resolved', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: `Invalid status. Allowed: ${validStatuses.join(', ')}` });
    }

    // Check if user has permission to update this SOS
    const sosResult = await db.query(
      `SELECT s.*, u.clerk_user_id as acknowledged_by_clerk_id
       FROM sos_alerts s
       LEFT JOIN users u ON s.acknowledged_by = u.id
       WHERE s.id = $1`,
      [id]
    );

    if (sosResult.rows.length === 0) {
      return res.status(404).json({ message: 'SOS alert not found' });
    }

    const sos = sosResult.rows[0];
    const isReporter = sos.clerk_reporter_id === userId;
    const isAcknowledgedByMe = sos.acknowledged_by_clerk_id === userId;
    const isAdminOrHead = ['admin', 'coordinator'].includes(role);

    // Authorization: reporter can cancel, responder can update, admins can do anything
    if (!isReporter && !isAcknowledgedByMe && !isAdminOrHead) {
      return res.status(403).json({ message: 'You do not have permission to update this SOS alert' });
    }

    // Reporters can only cancel their own reports
    if (isReporter && !isAcknowledgedByMe && !isAdminOrHead && status !== 'cancelled') {
      return res.status(403).json({ message: 'You can only cancel your own SOS reports' });
    }

    const result = await db.query(
      `UPDATE sos_alerts
       SET status = $1,
           resolved_at = CASE WHEN $1 = 'resolved' THEN NOW() ELSE resolved_at END,
           acknowledged_by = CASE WHEN $1 = 'acknowledged' AND acknowledged_by IS NULL THEN (SELECT id FROM users WHERE clerk_user_id = $2) ELSE acknowledged_by END,
           acknowledged_at = CASE WHEN $1 = 'acknowledged' AND acknowledged_at IS NULL THEN NOW() ELSE acknowledged_at END
       WHERE id = $3
       RETURNING *`,
      [status, userId, id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating SOS status:', err);
    res.status(500).json({ message: 'Failed to update SOS status' });
  }
}

// GET /api/v1/sos/nearby?lat=&lng=&radiusMeters=
async function getNearbySos(req, res) {
  try {
    const { lat, lng, radiusMeters } = req.query;
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    const radius = parseInt(radiusMeters || '10000', 10);

    if (Number.isNaN(latNum) || Number.isNaN(lngNum)) {
      return res.status(400).json({ message: 'lat and lng query params are required numbers' });
    }

    const result = await db.query(
      `SELECT *,
              ST_Distance(
                location::geometry,
                ST_SetSRID(ST_MakePoint($1, $2), 4326)
              ) AS distance
       FROM sos_alerts
       WHERE ST_DWithin(
         location::geometry,
         ST_SetSRID(ST_MakePoint($1, $2), 4326),
         $3
       )
       ORDER BY priority_score DESC NULLS LAST, distance ASC
       LIMIT 100`,
      [lngNum, latNum, radius]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching nearby SOS:', err);
    res.status(500).json({ message: 'Failed to fetch nearby SOS alerts' });
  }
}

// GET /api/v1/sos/:id/tasks
async function getTasksForSos(req, res) {
  try {
    const { id } = req.params;
    const result = await db.query(
      `SELECT t.*, u.full_name as volunteer_name, u.avatar_url as volunteer_avatar
       FROM tasks t
       JOIN users u ON t.volunteer_id = u.id
       WHERE t.sos_id = $1
       ORDER BY t.created_at ASC`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching tasks for SOS:', err);
    res.status(500).json({ message: 'Failed to fetch tasks for SOS report' });
  }
}

module.exports = {
  createSos,
  listSos,
  getSosById,
  updateSosStatus,
  getNearbySos,
  getTasksForSos,
};
