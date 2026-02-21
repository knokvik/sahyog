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
        const result = await db.query(`
            SELECT *,
                   ST_X(location::geometry) AS lng,
                   ST_Y(location::geometry) AS lat
            FROM needs 
            ORDER BY reported_at DESC
        `);
        const rows = [...result.rows];

        const email = req.user?.emailAddresses?.[0]?.emailAddress;
        if (email === 'arya.mahindrakar07@gmail.com') {
            rows.unshift({
                id: 'debug-need-1',
                request_code: 'DBG-NEED-001',
                reporter_name: 'Debug Citizen',
                reporter_phone: '+910000000001',
                type: 'medical',
                persons_count: 2,
                description: 'Debug entry for UI testing in coordinator/needs screens.',
                urgency: 'high',
                status: 'unassigned',
                assigned_volunteer_id: null,
                reported_at: new Date().toISOString(),
                resolved_at: null,
                debug: true
            });
            rows.unshift({
                id: 'debug-need-2',
                request_code: 'DBG-NEED-002',
                reporter_name: 'Debug Citizen 2',
                reporter_phone: '+910000000002',
                type: 'shelter',
                persons_count: 5,
                description: 'Temporary shelter required in flood-affected lane.',
                urgency: 'medium',
                status: 'assigned',
                assigned_volunteer_id: 'debug-volunteer-1',
                reported_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
                resolved_at: null,
                debug: true
            });
        }

        res.json(rows);
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
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Need not found' });
        }
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
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Need not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error resolving need:', err);
        res.status(500).json({ message: err.message });
    }
}

module.exports = { createNeed, listNeeds, assignVolunteer, resolveNeed };
