const db = require('../config/db');

async function createResource(req, res) {
    try {
        const { owner_org_id, type, quantity, status, location, current_disaster_id, current_zone_id } = req.body;

        if (!type) return res.status(400).json({ message: 'Type is required' });

        const locString = location ? `POINT(${location.lng} ${location.lat})` : null;

        const result = await db.query(
            `INSERT INTO resources (owner_org_id, type, quantity, status, current_location, current_disaster_id, current_zone_id)
       VALUES ($1, $2, $3, $4, CASE WHEN $5::text IS NOT NULL THEN ST_GeogFromText($5::text)::geography ELSE NULL END, $6, $7)
       RETURNING *`,
            [owner_org_id || null, type, quantity || 1, status || 'available', locString, current_disaster_id || null, current_zone_id || null]
        );

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error creating resource:', err);
        res.status(500).json({ message: 'Failed to create resource: ' + err.message });
    }
}

async function listResources(req, res) {
    try {
        const result = await db.query('SELECT * FROM resources ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        console.error('Error listing resources:', err);
        res.status(500).json({ message: 'Failed to list resources' });
    }
}

module.exports = { createResource, listResources };
