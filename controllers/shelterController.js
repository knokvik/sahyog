const db = require('../config/db');
const { ensureUserInDb } = require('../utils/userSync');

// POST /api/v1/shelters
async function createShelter(req, res) {
  try {
    const { name, lat, lng, capacity, facilities } = req.body;
    if (!name || typeof lat !== 'number' || typeof lng !== 'number') {
      return res.status(400).json({ message: 'name, lat and lng are required' });
    }

    const { userId } = req.auth || {};
    const user = await ensureUserInDb(userId);

    const result = await db.query(
      `INSERT INTO shelters (name, location, capacity, current_occupancy, facilities, manager_id, status)
       VALUES (
         $1,
         ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
         $4,
         0,
         $5,
         $6,
         'active'
       )
       RETURNING *`,
      [name, lng, lat, capacity || null, facilities || [], user.id]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating shelter:', err);
    res.status(500).json({ message: 'Failed to create shelter' });
  }
}

// GET /api/v1/shelters
async function listShelters(req, res) {
  try {
    const result = await db.query(
      'SELECT * FROM shelters WHERE status = \'active\' ORDER BY name ASC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing shelters:', err);
    res.status(500).json({ message: 'Failed to list shelters' });
  }
}

// GET /api/v1/shelters/:id
async function getShelterById(req, res) {
  try {
    const { id } = req.params;
    const result = await db.query('SELECT * FROM shelters WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Shelter not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching shelter:', err);
    res.status(500).json({ message: 'Failed to fetch shelter' });
  }
}

// PATCH /api/v1/shelters/:id
async function updateShelter(req, res) {
  try {
    const { id } = req.params;
    const { capacity, currentOccupancy, facilities, status } = req.body;

    const result = await db.query(
      `UPDATE shelters
       SET capacity = COALESCE($1, capacity),
           current_occupancy = COALESCE($2, current_occupancy),
           facilities = COALESCE($3, facilities),
           status = COALESCE($4, status)
       WHERE id = $5
       RETURNING *`,
      [capacity || null, currentOccupancy || null, facilities || null, status || null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Shelter not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating shelter:', err);
    res.status(500).json({ message: 'Failed to update shelter' });
  }
}

// POST /api/v1/shelters/:id/checkin
async function checkIn(req, res) {
  try {
    const { id } = req.params;
    const { count } = req.body;
    const people = parseInt(count || '1', 10);

    const updated = await db.query(
      `UPDATE shelters
       SET current_occupancy = current_occupancy + $1
       WHERE id = $2
       RETURNING *`,
      [people, id]
    );

    if (updated.rows.length === 0) {
      return res.status(404).json({ message: 'Shelter not found' });
    }

    res.json(updated.rows[0]);
  } catch (err) {
    console.error('Error checking into shelter:', err);
    res.status(500).json({ message: 'Failed to check in' });
  }
}

module.exports = {
  createShelter,
  listShelters,
  getShelterById,
  updateShelter,
  checkIn,
};

