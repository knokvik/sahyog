const db = require('../config/db');

// ─── GET /api/v1/admin/logs — Fetch all global activity logs ───────────────────────
async function getAdminLogs(req, res) {
    try {
        const result = await db.query(`
            SELECT a.*, 
                   u.full_name as user_name, 
                   o.name as org_name
            FROM activity_logs a
            LEFT JOIN users u ON a.user_id = u.id
            LEFT JOIN organizations o ON a.organization_id = o.id
            ORDER BY a.created_at DESC
            LIMIT 1000
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('[500] getAdminLogs error:', err);
        res.status(500).json({ message: 'Failed to fetch logs' });
    }
}

// ─── GET /api/v1/org/logs — Fetch org-specific activity logs ───────────────────────
async function getOrgLogs(req, res) {
    try {
        // Find org_id for the logged-in user
        const r = await db.query(
            'SELECT organization_id FROM users WHERE clerk_user_id = $1',
            [req.user.id]
        );
        const orgId = r.rows[0]?.organization_id;
        
        if (!orgId) return res.status(404).json({ message: 'No organization linked' });

        const result = await db.query(`
            SELECT a.*, 
                   u.full_name as user_name, 
                   o.name as org_name
            FROM activity_logs a
            LEFT JOIN users u ON a.user_id = u.id
            LEFT JOIN organizations o ON a.organization_id = o.id
            WHERE a.organization_id = $1
               OR (a.entity_type = 'ZONE' AND a.action_type = 'INFO' AND a.organization_id IS NULL) -- See public zone creations
            ORDER BY a.created_at DESC
            LIMIT 500
        `, [orgId]);
        res.json(result.rows);
    } catch (err) {
        console.error('[500] getOrgLogs error:', err);
        res.status(500).json({ message: 'Failed to fetch org logs' });
    }
}

module.exports = {
    getAdminLogs,
    getOrgLogs
};
