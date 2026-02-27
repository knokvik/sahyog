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
        res.json(result.rows);
    } catch (err) {
        console.error('Error listing needs:', err);
        res.status(500).json({ message: 'Failed to list needs' });
    }
}

// GET /api/v1/needs/active
async function listActiveNeeds(req, res) {
    try {
        const result = await db.query(
            `SELECT *,
                    ST_X(location::geometry) AS lng,
                    ST_Y(location::geometry) AS lat,
                    CASE LOWER(COALESCE(urgency, 'medium'))
                      WHEN 'critical' THEN 100
                      WHEN 'high' THEN 80
                      WHEN 'medium' THEN 50
                      WHEN 'low' THEN 20
                      ELSE 40
                    END AS urgency_score
             FROM needs
             WHERE status NOT IN ('resolved', 'cancelled')
             ORDER BY reported_at DESC`
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Error listing active needs:', err);
        res.status(500).json({ message: 'Failed to list active needs' });
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
        const { resolution_proof, resolution_notes } = req.body || {};
        const role = req.role || 'volunteer';
        const currentUser = req.dbUser;
        
        // Get the need details
        const needResult = await db.query(
            'SELECT * FROM needs WHERE id = $1',
            [id]
        );
        
        if (needResult.rows.length === 0) {
            return res.status(404).json({ message: 'Need not found' });
        }
        
        const need = needResult.rows[0];
        const isAssignedVolunteer = need.assigned_volunteer_id === currentUser?.id;
        const isCoordinatorOrAdmin = ['coordinator', 'admin'].includes(role);
        
        // Authorization: Only assigned volunteer, coordinator, or admin can resolve
        if (!isAssignedVolunteer && !isCoordinatorOrAdmin) {
            return res.status(403).json({
                message: 'Only the assigned volunteer, coordinator, or admin can resolve this need'
            });
        }
        
        // Require proof for resolution (except coordinators/admins who can override)
        if (!isCoordinatorOrAdmin && (!resolution_proof || resolution_proof.length === 0)) {
            return res.status(403).json({
                message: 'Resolution requires photo/video proof of fulfillment. Please upload proof and try again.'
            });
        }
        
        const result = await db.query(
            `UPDATE needs 
             SET status = 'resolved', 
                 resolved_at = NOW(),
                 resolution_proof = $2,
                 resolution_notes = $3,
                 resolved_by = $4
             WHERE id = $1 
             RETURNING *`,
            [id, resolution_proof || null, resolution_notes || null, currentUser?.id || null]
        );
        
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error resolving need:', err);
        res.status(500).json({ message: err.message });
    }
}

module.exports = {
    createNeed,
    listNeeds,
    listActiveNeeds,
    assignVolunteer,
    resolveNeed,
};
