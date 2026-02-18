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
    const role = req.role || 'citizen';
    let queryText = 'SELECT * FROM sos_reports ORDER BY created_at DESC LIMIT 100';
    let params = [];

    if (role === 'citizen') {
      const { userId } = req.auth || {};
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });
      queryText = 'SELECT * FROM sos_reports WHERE clerk_reporter_id = $1 ORDER BY created_at DESC';
      params = [userId];
    } else if (role === 'volunteer' || role === 'volunteer_head') {
      queryText =
        'SELECT * FROM sos_reports WHERE status != $1 ORDER BY priority_score DESC NULLS LAST, created_at ASC LIMIT 100';
      params = ['resolved'];
    }

    const result = await db.query(queryText, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing SOS:', err);
    res.status(500).json({ message: 'Failed to list SOS reports' });
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
    const validStatuses = ['pending', 'in_progress', 'resolved', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: `Invalid status. Allowed: ${validStatuses.join(', ')}` });
    }

    const result = await db.query(
      `UPDATE sos_reports
       SET status = $1,
           resolved_at = CASE WHEN $1 = 'resolved' THEN NOW() ELSE resolved_at END
       WHERE id = $2
       RETURNING *`,
      [status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'SOS report not found' });
    }

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

module.exports = {
  createSos,
  listSos,
  getSosById,
  updateSosStatus,
  getNearbySos,
};

