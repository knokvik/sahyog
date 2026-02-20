const db = require('../config/db');

async function reportMissingPerson(req, res) {
  try {
    const { reporter_phone, name, age, last_seen_location, photo_urls, disaster_id } = req.body;

    if (!reporter_phone) return res.status(400).json({ message: 'Reporter phone is required' });

    const locString = last_seen_location ? `POINT(${last_seen_location.lng} ${last_seen_location.lat})` : null;

    const result = await db.query(
      `INSERT INTO missing_persons (reporter_phone, name, age, last_seen_location, photo_urls, disaster_id)
       VALUES ($1, $2, $3, CASE WHEN $4::text IS NOT NULL THEN ST_GeogFromText($4::text)::geography ELSE NULL END, $5, $6)
       RETURNING *`,
      [reporter_phone, name || null, age || null, locString, photo_urls || null, disaster_id || null]
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
    const result = await db.query(
      `UPDATE missing_persons 
       SET status = 'found', found_at = NOW() 
       WHERE id = $1 RETURNING *`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error marking found:', err);
    res.status(500).json({ message: 'Failed to mark found' });
  }
}

module.exports = { reportMissingPerson, listMissingPersons, markFound };
