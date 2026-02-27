const db = require('../config/db');

// Assign a coordinator (primary or backup) to a zone for a disaster
// POST /api/v1/assignments/coordinator
// Body: { disaster_id, zone_id, coordinator_id, organization_id, is_primary }
async function assignCoordinator(req, res) {
    try {
        const { disaster_id, zone_id, coordinator_id, organization_id, is_primary } = req.body;
        if (!disaster_id || !zone_id || !coordinator_id || !organization_id) {
            return res.status(400).json({ message: 'Missing required fields' });
        }
        // Only one primary coordinator per zone/disaster
        if (is_primary) {
            const existing = await db.query(
                `SELECT * FROM disaster_coordinator_assignments WHERE disaster_id = $1 AND zone_id = $2 AND status = 'active' AND is_primary = true`,
                [disaster_id, zone_id]
            );
            if (existing.rows.length > 0) {
                return res.status(409).json({ message: 'Primary coordinator already assigned for this zone' });
            }
        }
        const result = await db.query(
            `INSERT INTO disaster_coordinator_assignments (disaster_id, zone_id, organization_id, coordinator_id, status, is_primary, created_at)
             VALUES ($1, $2, $3, $4, 'active', $5, NOW())
             RETURNING *`,
            [disaster_id, zone_id, organization_id, coordinator_id, !!is_primary]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error assigning coordinator:', err);
        res.status(500).json({ message: 'Failed to assign coordinator' });
    }
}

// Remove a coordinator assignment
// DELETE /api/v1/assignments/coordinator/:id
async function removeCoordinator(req, res) {
    try {
        const { id } = req.params;
        const result = await db.query(
            `DELETE FROM disaster_coordinator_assignments WHERE id = $1 RETURNING *`,
            [id]
        );
        if (result.rows.length === 0) return res.status(404).json({ message: 'Assignment not found' });
        res.json({ message: 'Coordinator assignment removed', assignment: result.rows[0] });
    } catch (err) {
        console.error('Error removing coordinator assignment:', err);
        res.status(500).json({ message: 'Failed to remove coordinator assignment' });
    }
}

// Assign a volunteer to a zone/disaster
// POST /api/v1/assignments/volunteer
// Body: { disaster_id, zone_id, coordinator_id, volunteer_id }
async function assignVolunteer(req, res) {
    try {
        const { disaster_id, zone_id, coordinator_id, volunteer_id } = req.body;
        if (!disaster_id || !zone_id || !coordinator_id || !volunteer_id) {
            return res.status(400).json({ message: 'Missing required fields' });
        }
        // Only one assignment per disaster/volunteer
        const existing = await db.query(
            `SELECT * FROM volunteer_disaster_assignments WHERE disaster_id = $1 AND volunteer_id = $2`,
            [disaster_id, volunteer_id]
        );
        if (existing.rows.length > 0) {
            return res.status(409).json({ message: 'Volunteer already assigned for this disaster' });
        }
        const result = await db.query(
            `INSERT INTO volunteer_disaster_assignments (disaster_id, zone_id, coordinator_id, volunteer_id, status, created_at)
             VALUES ($1, $2, $3, $4, 'pending', NOW())
             RETURNING *`,
            [disaster_id, zone_id, coordinator_id, volunteer_id]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error assigning volunteer:', err);
        res.status(500).json({ message: 'Failed to assign volunteer' });
    }
}

// Remove a volunteer assignment
// DELETE /api/v1/assignments/volunteer/:id
async function removeVolunteer(req, res) {
    try {
        const { id } = req.params;
        const result = await db.query(
            `DELETE FROM volunteer_disaster_assignments WHERE id = $1 RETURNING *`,
            [id]
        );
        if (result.rows.length === 0) return res.status(404).json({ message: 'Assignment not found' });
        res.json({ message: 'Volunteer assignment removed', assignment: result.rows[0] });
    } catch (err) {
        console.error('Error removing volunteer assignment:', err);
        res.status(500).json({ message: 'Failed to remove volunteer assignment' });
    }
}

module.exports = {
    assignCoordinator,
    removeCoordinator,
    assignVolunteer,
    removeVolunteer,
};
