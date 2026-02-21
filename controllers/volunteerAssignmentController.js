const db = require('../config/db');

// GET /api/v1/volunteer-assignments/mine
async function getMyAssignments(req, res) {
    try {
        const userId = req.dbUser?.id;
        if (!userId) return res.status(401).json({ message: 'User not found' });

        const result = await db.query(
            `SELECT va.id, va.status, va.responded_at, va.created_at,
                    d.name as disaster_name, d.type as disaster_type, d.severity as disaster_severity,
                    c.full_name as coordinator_name, c.phone as coordinator_phone
             FROM volunteer_disaster_assignments va
             JOIN disasters d ON d.id = va.disaster_id
             LEFT JOIN users c ON c.id = va.coordinator_id
             WHERE va.volunteer_id = $1
             ORDER BY va.created_at DESC`,
            [userId]
        );

        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching volunteer assignments:', err);
        res.status(500).json({ message: 'Failed to fetch assignments' });
    }
}

// POST /api/v1/volunteer-assignments/:id/respond
async function respondToAssignment(req, res) {
    try {
        const userId = req.dbUser?.id;
        if (!userId) return res.status(401).json({ message: 'User not found' });

        const { id } = req.params;
        const { status } = req.body; // 'accepted' or 'rejected'

        if (!['accepted', 'rejected'].includes(status)) {
            return res.status(400).json({ message: 'Invalid status. Must be accepted or rejected' });
        }

        const result = await db.query(
            `UPDATE volunteer_disaster_assignments
             SET status = $1, responded_at = NOW()
             WHERE id = $2 AND volunteer_id = $3 AND status = 'pending'
             RETURNING *`,
            [status, id, userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Assignment not found or already responded' });
        }

        res.json({ message: `Assignment ${status} successfully`, assignment: result.rows[0] });
    } catch (err) {
        console.error('Error responding to assignment:', err);
        res.status(500).json({ message: 'Failed to respond to assignment' });
    }
}

module.exports = {
    getMyAssignments,
    respondToAssignment
};
