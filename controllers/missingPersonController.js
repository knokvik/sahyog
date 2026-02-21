const db = require('../config/db');

async function ensureMissingPersonSchema() {
  await db.query(
    `ALTER TABLE missing_persons ADD COLUMN IF NOT EXISTS description text`
  );
  await db.query(
    `CREATE TABLE IF NOT EXISTS missing_person_updates (
       id bigserial PRIMARY KEY,
       missing_person_id uuid NOT NULL REFERENCES missing_persons(id) ON DELETE CASCADE,
       updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
       note text,
       created_at timestamp DEFAULT now()
     )`
  );
}

async function ensureMissingUpdatesTable() {
  await ensureMissingPersonSchema();
}

async function reportMissingPerson(req, res) {
  try {
    const { reporter_phone, name, age, last_seen_location, photo_urls, disaster_id } = req.body;
    if (!reporter_phone) return res.status(400).json({ message: 'Reporter phone is required' });
    const locString = last_seen_location ? `POINT(${last_seen_location.lng} ${last_seen_location.lat})` : null;

    await ensureMissingPersonSchema();

    const result = await db.query(
      `INSERT INTO missing_persons (reporter_phone, name, age, last_seen_location, photo_urls, disaster_id, description)
       VALUES ($1, $2, $3, CASE WHEN $4::text IS NOT NULL THEN ST_GeomFromText($4::text, 4326) ELSE NULL END, $5, $6, $7)
       RETURNING *`,
      [
        reporter_phone,
        name || null,
        age || null,
        locString,
        photo_urls || null,
        disaster_id || null,
        req.body.description || null
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error reporting missing person:', err);
    res.status(500).json({ message: 'Failed to report missing person: ' + err.message });
  }
}

async function listMissingPersons(req, res) {
  try {
    const result = await db.query('SELECT * FROM missing_persons ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing missing persons:', err);
    res.status(500).json({ message: 'Failed to list missing persons' });
  }
}

async function markFound(req, res) {
  try {
    const { id } = req.params;
    const { description } = req.body || {};
    const role = req.role || 'volunteer';

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return res.status(400).json({ message: 'Invalid report ID format' });
    }

    if (!['volunteer', 'coordinator', 'admin', 'user'].includes(role)) {
      return res.status(403).json({ message: 'Not allowed to close missing reports' });
    }

    const result = await db.query(
      `UPDATE missing_persons
       SET status = 'found'
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Not found' });
    }

    if (description && description.trim()) {
      try {
        await ensureMissingUpdatesTable();
        await db.query(
          `INSERT INTO missing_person_updates (missing_person_id, updated_by, note)
           VALUES ($1, $2, $3)`,
          [id, req.dbUser?.id || null, description.trim()]
        );
      } catch (noteErr) {
        console.error('Failed to save missing update note:', noteErr?.message || noteErr);
      }
    }

    res.json({
      ...result.rows[0],
      closure_note: description || null,
    });
  } catch (err) {
    console.error('Error marking found:', err);
    res.status(500).json({ message: 'Failed to mark found' });
  }
}

module.exports = { reportMissingPerson, listMissingPersons, markFound };
