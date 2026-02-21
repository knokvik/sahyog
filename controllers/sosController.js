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
      `INSERT INTO sos_reports
       (reporter_id, clerk_reporter_id, disaster_id, location, type, description, priority_score, status, media_urls, created_at)
       VALUES (
         $1,
         $2,
         $3,
         ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography,
         $6,
         $7,
         $8,
         'pending',
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

    let queryText = `
      SELECT s.*,
             ST_X(s.location) AS lng, ST_Y(s.location) AS lat,
             u.full_name AS volunteer_name,
             d.name      AS disaster_name
      FROM sos_alerts s
      LEFT JOIN users u     ON u.id = s.volunteer_id
      LEFT JOIN disasters d ON d.id = s.disaster_id
      ORDER BY s.created_at DESC LIMIT 100`;
    let params = [];

    // Volunteers only see their own SOS alerts
    if (role === 'volunteer') {
      const dbUser = req.dbUser;
      if (!dbUser) return res.status(401).json({ message: 'Unauthorized' });
      queryText = `
        SELECT s.*,
               ST_X(s.location) AS lng, ST_Y(s.location) AS lat,
               u.full_name AS volunteer_name,
               d.name      AS disaster_name
        FROM sos_alerts s
        LEFT JOIN users u     ON u.id = s.volunteer_id
        LEFT JOIN disasters d ON d.id = s.disaster_id
        WHERE s.volunteer_id = $1
        ORDER BY s.created_at DESC`;
      params = [dbUser.id];
    }

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
    const result = await db.query('SELECT * FROM sos_reports WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'SOS report not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching SOS:', err);
    res.status(500).json({ message: 'Failed to fetch SOS report' });
  }
}

// PATCH /api/v1/sos/:id/status
async function updateSosStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const { userId } = req.auth || {};
    const role = req.role || 'org:user';

    const validStatuses = ['pending', 'in_progress', 'resolved', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: `Invalid status. Allowed: ${validStatuses.join(', ')}` });
    }

    // Check if user has permission to update this SOS
    const sosResult = await db.query(
      `SELECT s.*, v.clerk_user_id as assigned_volunteer_clerk_id
       FROM sos_reports s
       LEFT JOIN volunteers v ON s.assigned_volunteer_id = v.id
       WHERE s.id = $1`,
      [id]
    );

    if (sosResult.rows.length === 0) {
      return res.status(404).json({ message: 'SOS report not found' });
    }

    const sos = sosResult.rows[0];
    const isReporter = sos.clerk_reporter_id === userId;
    const isAssignedVolunteer = sos.assigned_volunteer_clerk_id === userId;
    const isAdminOrHead = ['org:admin', 'org:volunteer_head'].includes(role);

    // Authorization: reporter can cancel, assigned volunteer can update progress, admins can do anything
    if (!isReporter && !isAssignedVolunteer && !isAdminOrHead) {
      return res.status(403).json({ message: 'You do not have permission to update this SOS report' });
    }

    // Additional rule: reporters can only cancel their own reports
    if (isReporter && !isAssignedVolunteer && !isAdminOrHead && status !== 'cancelled') {
      return res.status(403).json({ message: 'You can only cancel your own SOS reports' });
    }

    const result = await db.query(
      `UPDATE sos_reports
       SET status = $1,
           resolved_at = CASE WHEN $1 = 'resolved' THEN NOW() ELSE resolved_at END
       WHERE id = $2
       RETURNING *`,
      [status, id]
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
                location,
                ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
              ) AS distance
       FROM sos_reports
       WHERE ST_DWithin(
         location,
         ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
         $3
       )
       ORDER BY priority_score DESC NULLS LAST, distance ASC
       LIMIT 100`,
      [lngNum, latNum, radius]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching nearby SOS:', err);
    res.status(500).json({ message: 'Failed to fetch nearby SOS reports' });
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
