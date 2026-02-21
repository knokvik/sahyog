const db = require('../config/db');
const { clerkClient } = require('@clerk/clerk-sdk-node');

// ─── Helper: get org_id from logged-in user ────────────────────────
async function getOrgIdForUser(clerkUserId) {
    const r = await db.query(
        'SELECT organization_id FROM users WHERE clerk_user_id = $1',
        [clerkUserId]
    );
    return r.rows[0]?.organization_id || null;
}

// ─── POST /register — create org & link user ───────────────────────
async function registerOrg(req, res) {
    try {
        // req.auth.userId comes from ClerkExpressRequireAuth (verifyToken)
        // req.user?.id comes from checkRole middleware
        const uid = req.auth?.userId || req.user?.id;
        if (!uid) return res.status(401).json({ message: 'Not authenticated' });

        const { name, registration_number, primary_phone, email, state, district } = req.body;

        if (!name) return res.status(400).json({ message: 'Organization name is required' });

        // Prevent double-registration
        const existing = await getOrgIdForUser(uid);
        if (existing) return res.status(409).json({ message: 'You already belong to an organization' });

        // Create organization
        const orgResult = await db.query(
            `INSERT INTO organizations (name, registration_number, primary_phone, email, state, district)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [name, registration_number || null, primary_phone || null, email || null, state || null, district || null]
        );
        const org = orgResult.rows[0];

        // Link user to org & set role
        await db.query(
            `UPDATE users SET role = 'organization', organization_id = $1, updated_at = NOW()
             WHERE clerk_user_id = $2`,
            [org.id, uid]
        );

        // Sync role to Clerk metadata (non-blocking, don't fail if this errors)
        try {
            await clerkClient.users.updateUserMetadata(uid, {
                publicMetadata: { role: 'organization' }
            });
        } catch (clerkErr) {
            console.warn('[warn] Could not sync role to Clerk:', clerkErr?.message);
        }

        res.status(201).json({ message: 'Organization registered', organization: org });
    } catch (err) {
        console.error('[500] registerOrg error:', err?.message || err);
        res.status(500).json({ message: 'Failed to register organization', detail: err?.message });
    }
}

// ─── GET /me — get my org details ──────────────────────────────────
async function getMyOrg(req, res) {
    try {
        const orgId = await getOrgIdForUser(req.user.id);
        if (!orgId) return res.status(404).json({ message: 'No organization linked to your account' });

        const result = await db.query('SELECT * FROM organizations WHERE id = $1', [orgId]);
        if (!result.rows[0]) return res.status(404).json({ message: 'Organization not found' });

        res.json(result.rows[0]);
    } catch (err) {
        console.error('[500] getMyOrg error:', err?.message || err);
        res.status(500).json({ message: 'Failed to load organization', detail: err?.message });
    }
}

// ─── PUT /me — update org details ──────────────────────────────────
async function updateOrg(req, res) {
    try {
        const orgId = await getOrgIdForUser(req.user.id);
        if (!orgId) return res.status(404).json({ message: 'No organization linked' });

        const { name, registration_number, primary_phone, email, state, district } = req.body;

        const result = await db.query(
            `UPDATE organizations
             SET name = COALESCE($1, name),
                 registration_number = COALESCE($2, registration_number),
                 primary_phone = COALESCE($3, primary_phone),
                 email = COALESCE($4, email),
                 state = COALESCE($5, state),
                 district = COALESCE($6, district),
                 updated_at = NOW()
             WHERE id = $7 RETURNING *`,
            [name, registration_number, primary_phone, email, state, district, orgId]
        );

        res.json(result.rows[0]);
    } catch (err) {
        console.error('[500] updateOrg error:', err?.message || err);
        res.status(500).json({ message: 'Failed to update organization', detail: err?.message });
    }
}

// ─── GET /me/stats — dashboard statistics ──────────────────────────
async function getOrgStats(req, res) {
    try {
        const orgId = await getOrgIdForUser(req.user.id);
        if (!orgId) return res.status(404).json({ message: 'No organization linked' });

        const [volunteers, resources, tasks, activeTasks, completedTasks, activeDisasters] = await Promise.all([
            db.query('SELECT COUNT(*) FROM users WHERE organization_id = $1 AND role != $2', [orgId, 'organization']),
            db.query('SELECT COUNT(*) FROM resources WHERE owner_org_id = $1', [orgId]),
            db.query(
                `SELECT COUNT(*) FROM tasks t
                 JOIN users u ON t.volunteer_id = u.id
                 WHERE u.organization_id = $1`, [orgId]
            ),
            db.query(
                `SELECT COUNT(*) FROM tasks t
                 JOIN users u ON t.volunteer_id = u.id
                 WHERE u.organization_id = $1 AND t.status IN ('pending', 'accepted')`, [orgId]
            ),
            db.query(
                `SELECT COUNT(*) FROM tasks t
                 JOIN users u ON t.volunteer_id = u.id
                 WHERE u.organization_id = $1 AND t.status = 'completed'`, [orgId]
            ),
            db.query(
                `SELECT COUNT(DISTINCT d.id) FROM disasters d
                 JOIN resources r ON r.current_disaster_id = d.id
                 WHERE r.owner_org_id = $1 AND d.status = 'active'`, [orgId]
            ),
        ]);

        res.json({
            totalVolunteers: parseInt(volunteers.rows[0].count),
            totalResources: parseInt(resources.rows[0].count),
            totalTasks: parseInt(tasks.rows[0].count),
            activeTasks: parseInt(activeTasks.rows[0].count),
            completedTasks: parseInt(completedTasks.rows[0].count),
            activeDisasters: parseInt(activeDisasters.rows[0].count),
        });
    } catch (err) {
        console.error('[500] getOrgStats error:', err?.message || err);
        res.status(500).json({ message: 'Failed to load stats', detail: err?.message });
    }
}

// ─── GET /me/volunteers ────────────────────────────────────────────
async function listOrgVolunteers(req, res) {
    try {
        const orgId = await getOrgIdForUser(req.user.id);
        if (!orgId) return res.status(404).json({ message: 'No organization linked' });

        const result = await db.query(
            `SELECT id, clerk_user_id, full_name, email, phone, role, is_active, avatar_url, created_at
             FROM users WHERE organization_id = $1 AND role != 'organization'
             ORDER BY created_at DESC`,
            [orgId]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('[500] listOrgVolunteers error:', err?.message || err);
        res.status(500).json({ message: 'Failed to list volunteers', detail: err?.message });
    }
}

// ─── POST /me/volunteers/:userId — link volunteer to org ───────────
async function linkVolunteer(req, res) {
    try {
        const orgId = await getOrgIdForUser(req.user.id);
        if (!orgId) return res.status(404).json({ message: 'No organization linked' });

        const { userId } = req.params;

        const result = await db.query(
            `UPDATE users SET organization_id = $1, updated_at = NOW()
             WHERE id = $2 AND (organization_id IS NULL OR organization_id = $1) RETURNING id, full_name, email`,
            [orgId, userId]
        );

        if (!result.rows[0]) return res.status(404).json({ message: 'User not found or already in another org' });

        res.json({ message: 'Volunteer linked', user: result.rows[0] });
    } catch (err) {
        console.error('[500] linkVolunteer error:', err?.message || err);
        res.status(500).json({ message: 'Failed to link volunteer', detail: err?.message });
    }
}

// ─── DELETE /me/volunteers/:userId — unlink volunteer ──────────────
async function unlinkVolunteer(req, res) {
    try {
        const orgId = await getOrgIdForUser(req.user.id);
        if (!orgId) return res.status(404).json({ message: 'No organization linked' });

        const { userId } = req.params;

        const result = await db.query(
            `UPDATE users SET organization_id = NULL, updated_at = NOW()
             WHERE id = $1 AND organization_id = $2 RETURNING id, full_name`,
            [userId, orgId]
        );

        if (!result.rows[0]) return res.status(404).json({ message: 'User not found in your organization' });

        res.json({ message: 'Volunteer removed', user: result.rows[0] });
    } catch (err) {
        console.error('[500] unlinkVolunteer error:', err?.message || err);
        res.status(500).json({ message: 'Failed to remove volunteer', detail: err?.message });
    }
}

// ─── GET /me/resources ─────────────────────────────────────────────
async function listOrgResources(req, res) {
    try {
        const orgId = await getOrgIdForUser(req.user.id);
        if (!orgId) return res.status(404).json({ message: 'No organization linked' });

        const result = await db.query(
            `SELECT r.*, d.name as disaster_name, z.name as zone_name
             FROM resources r
             LEFT JOIN disasters d ON r.current_disaster_id = d.id
             LEFT JOIN zones z ON r.current_zone_id = z.id
             WHERE r.owner_org_id = $1
             ORDER BY r.created_at DESC`,
            [orgId]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('[500] listOrgResources error:', err?.message || err);
        res.status(500).json({ message: 'Failed to list resources', detail: err?.message });
    }
}

// ─── GET /me/tasks ─────────────────────────────────────────────────
async function listOrgTasks(req, res) {
    try {
        const orgId = await getOrgIdForUser(req.user.id);
        if (!orgId) return res.status(404).json({ message: 'No organization linked' });

        const { status } = req.query;

        let query = `
            SELECT t.*, u.full_name as volunteer_name, z.name as zone_name, d.name as disaster_name
            FROM tasks t
            JOIN users u ON t.volunteer_id = u.id
            LEFT JOIN zones z ON t.zone_id = z.id
            LEFT JOIN disasters d ON t.disaster_id = d.id
            WHERE u.organization_id = $1
        `;
        const params = [orgId];

        if (status) {
            query += ' AND t.status = $2';
            params.push(status);
        }

        query += ' ORDER BY t.created_at DESC';

        const result = await db.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('[500] listOrgTasks error:', err?.message || err);
        res.status(500).json({ message: 'Failed to list tasks', detail: err?.message });
    }
}

// ─── GET /me/zones ─────────────────────────────────────────────────
async function listOrgZones(req, res) {
    try {
        const orgId = await getOrgIdForUser(req.user.id);
        if (!orgId) return res.status(404).json({ message: 'No organization linked' });

        const result = await db.query(
            `SELECT DISTINCT z.*, d.name as disaster_name,
                (SELECT COUNT(*) FROM users u WHERE u.organization_id = $1
                 AND EXISTS(SELECT 1 FROM tasks t WHERE t.volunteer_id = u.id AND t.zone_id = z.id)) as org_volunteers,
                (SELECT COUNT(*) FROM resources r WHERE r.owner_org_id = $1 AND r.current_zone_id = z.id) as org_resources
             FROM zones z
             JOIN disasters d ON z.disaster_id = d.id
             WHERE EXISTS (
                SELECT 1 FROM resources r WHERE r.owner_org_id = $1 AND r.current_zone_id = z.id
             ) OR EXISTS (
                SELECT 1 FROM tasks t JOIN users u ON t.volunteer_id = u.id
                WHERE u.organization_id = $1 AND t.zone_id = z.id
             )
             ORDER BY z.created_at DESC`,
            [orgId]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('[500] listOrgZones error:', err?.message || err);
        res.status(500).json({ message: 'Failed to list zones', detail: err?.message });
    }
}

// ─── POST /me/resources — create a resource owned by this org ───────
async function createOrgResource(req, res) {
    try {
        const orgId = await getOrgIdForUser(req.user.id);
        if (!orgId) return res.status(404).json({ message: 'No organization linked' });

        const { type, quantity, status } = req.body;
        if (!type) return res.status(400).json({ message: 'Resource type is required' });

        const result = await db.query(
            `INSERT INTO resources (owner_org_id, type, quantity, status)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [orgId, type, quantity || 1, status || 'available']
        );

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('[500] createOrgResource error:', err?.message || err);
        res.status(500).json({ message: 'Failed to create resource', detail: err?.message });
    }
}

module.exports = {
    registerOrg,
    getMyOrg,
    updateOrg,
    getOrgStats,
    listOrgVolunteers,
    linkVolunteer,
    unlinkVolunteer,
    listOrgResources,
    createOrgResource,
    listOrgTasks,
    listOrgZones,
};
