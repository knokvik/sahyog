const db = require('../config/db');

async function createZone(req, res) {
    try {
        const { disaster_id, name, code, polygon } = req.body;
        if (!disaster_id || !name || !code) return res.status(400).json({ message: 'Missing required fields' });

        const result = await db.query(
            `INSERT INTO zones (disaster_id, name, code, boundary)
       VALUES ($1, $2, $3, CASE WHEN $4::text IS NOT NULL THEN ST_GeomFromGeoJSON($4::text)::geography ELSE NULL END)
       RETURNING *`,
            [disaster_id, name, code, polygon ? JSON.stringify(polygon) : null]
        );

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error creating zone:', err);
        res.status(500).json({ message: 'Failed to create zone: ' + err.message });
    }
}

async function listZones(req, res) {
    try {
        const { disaster_id } = req.query;
        let query = 'SELECT * FROM zones';
        let values = [];
        if (disaster_id) {
            query += ' WHERE disaster_id = $1';
            values.push(disaster_id);
        }
        const result = await db.query(query, values);
        res.json(result.rows);
    } catch (err) {
        console.error('Error listing zones:', err);
        res.status(500).json({ message: 'Failed to list zones' });
    }
}

async function assignCoordinator(req, res) {
    try {
        const { id } = req.params;
        const { coordinator_id } = req.body;
        const result = await db.query(
            'UPDATE zones SET assigned_coordinator_id = $1 WHERE id = $2 RETURNING *',
            [coordinator_id, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ message: 'Zone not found' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error assigning coordinator:', err);
        res.status(500).json({ message: 'Failed to assign' });
    }
}

module.exports = { createZone, listZones, assignCoordinator };
