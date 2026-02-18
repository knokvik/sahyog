const db = require('../config/db');
const { ensureUserInDb } = require('../utils/userSync');

// POST /api/v1/missing
async function reportMissing(req, res) {
  try {
    const { userId } = req.auth || {};
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const user = await ensureUserInDb(userId);
    const { disasterId, name, age, description, lat, lng, photos } = req.body;

    if (!name) return res.status(400).json({ message: 'name is required' });

    const result = await db.query(
      `INSERT INTO missing_persons
       (reporter_id, disaster_id, name, age, description, last_seen_location, photos, status, created_at)
       VALUES (
         $1,
         $2,
         $3,
         $4,
         $5,
         CASE
           WHEN $6 IS NOT NULL AND $7 IS NOT NULL
           THEN ST_SetSRID(ST_MakePoint($7, $6), 4326)::geography
           ELSE NULL
         END,
         $8,
         'missing',
         NOW()
       )
       RETURNING *`,
      [user.id, disasterId || null, name, age || null, description || null, lat || null, lng || null, photos || []]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error reporting missing person:', err);
    res.status(500).json({ message: 'Failed to report missing person' });
  }
}

// GET /api/v1/missing
async function searchMissing(req, res) {
  try {
    const { disasterId, status, name } = req.query;
    const params = [];
    const conditions = [];

    if (disasterId) {
      params.push(disasterId);
      conditions.push(`disaster_id = $${params.length}`);
    }

    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    if (name) {
      params.push(`%${name}%`);
      conditions.push(`name ILIKE $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await db.query(
      `SELECT * FROM missing_persons ${where} ORDER BY created_at DESC LIMIT 200`,
      params
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error searching missing persons:', err);
    res.status(500).json({ message: 'Failed to search missing persons' });
  }
}

// PATCH /api/v1/missing/:id/found
async function markFound(req, res) {
  try {
    const { id } = req.params;
    const result = await db.query(
      `UPDATE missing_persons
       SET status = 'found',
           found_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Missing person record not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error marking missing person as found:', err);
    res.status(500).json({ message: 'Failed to update missing person' });
  }
}

module.exports = {
  reportMissing,
  searchMissing,
  markFound,
};

