const db = require('../config/db');

async function createNeed(req, res) {
    try {
        const { request_code, reporter_name, reporter_phone, location, type, persons_count, description, urgency, disaster_id, zone_id, photo_urls, voice_note_url } = req.body;

        if (!request_code || !reporter_phone || !type || !location) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        const locString = `POINT(${location.lng} ${location.lat})`;

        const result = await db.query(
            `INSERT INTO needs (request_code, reporter_name, reporter_phone, location, type, persons_count, description, urgency, disaster_id, zone_id, photo_urls, voice_note_url)
       VALUES ($1, $2, $3, ST_GeogFromText($4), $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
            [request_code, reporter_name || null, reporter_phone, locString, type, persons_count || 1, description || null, urgency || 'medium', disaster_id || null, zone_id || null, photo_urls || null, voice_note_url || null]
        );

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error creating need:', err);
        res.status(500).json({ message: 'Failed to create need: ' + err.message });
    }
}

async function listNeeds(req, res) {
    try {
        const result = await db.query('SELECT * FROM needs ORDER BY reported_at DESC');
        res.json(result.rows);
    } catch (err) {
        console.error('Error listing needs:', err);
        res.status(500).json({ message: 'Failed to list needs' });
    }
}

async function assignVolunteer(req, res) {
    try {
        const { id } = req.params;
        const { volunteer_id } = req.body;
        const result = await db.query(
            `UPDATE needs SET assigned_volunteer_id = $1, status = 'assigned' WHERE id = $2 RETURNING *`,
            [volunteer_id, id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error assigning volunteer:', err);
        res.status(500).json({ message: err.message });
    }
}

async function resolveNeed(req, res) {
    try {
        const { id } = req.params;
        const result = await db.query(
            `UPDATE needs SET status = 'resolved', resolved_at = NOW() WHERE id = $1 RETURNING *`,
            [id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error resolving need:', err);
        res.status(500).json({ message: err.message });
    }
}

module.exports = { createNeed, listNeeds, assignVolunteer, resolveNeed };
