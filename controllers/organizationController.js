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

// ─── GET /me/requests — incoming disaster requests for this org ─────
async function listOrgRequests(req, res) {
    try {
        const orgId = await getOrgIdForUser(req.user.id);
        if (!orgId) return res.status(404).json({ message: 'No organization linked' });

        const result = await db.query(
            `SELECT ora.id AS assignment_id, ora.status AS assignment_status, ora.responded_at,
                    dr.id AS request_id, dr.status AS request_status, dr.notes, dr.created_at,
                    d.id AS disaster_id, d.name AS disaster_name, d.type AS disaster_type,
                    d.severity AS disaster_severity, d.status AS disaster_status,
                    u.full_name AS requested_by
             FROM org_request_assignments ora
             JOIN disaster_requests dr ON dr.id = ora.request_id
             JOIN disasters d ON d.id = dr.disaster_id
             LEFT JOIN users u ON u.id = dr.created_by
             WHERE ora.organization_id = $1
             ORDER BY ora.created_at DESC`,
            [orgId]
        );

        // Attach items to each request
        for (const row of result.rows) {
            const items = await db.query(
                'SELECT * FROM disaster_request_items WHERE request_id = $1',
                [row.request_id]
            );
            row.items = items.rows;
        }

        res.json(result.rows);
    } catch (err) {
        console.error('[500] listOrgRequests error:', err?.message || err);
        res.status(500).json({ message: 'Failed to list requests' });
    }
}

// ─── POST /me/requests/:assignmentId/accept — accept and commit resources ───
async function acceptOrgRequest(req, res) {
    try {
        const orgId = await getOrgIdForUser(req.user.id);
        if (!orgId) return res.status(404).json({ message: 'No organization linked' });

        const { assignmentId } = req.params;
        const { contributions } = req.body; // [{item_id, quantity_committed}]

        if (!contributions || contributions.length === 0) {
            return res.status(400).json({ message: 'Contributions are required' });
        }

        // Verify this assignment belongs to this org
        const asnCheck = await db.query(
            'SELECT * FROM org_request_assignments WHERE id = $1 AND organization_id = $2',
            [assignmentId, orgId]
        );
        if (asnCheck.rows.length === 0) return res.status(404).json({ message: 'Assignment not found' });
        if (asnCheck.rows[0].status !== 'pending') {
            return res.status(400).json({ message: 'Already responded to this request' });
        }

        // Update assignment status
        await db.query(
            `UPDATE org_request_assignments SET status = 'accepted', responded_at = NOW() WHERE id = $1`,
            [assignmentId]
        );

        // Insert contributions and update fulfilled quantities
        for (const c of contributions) {
            await db.query(
                `INSERT INTO org_request_contributions (assignment_id, item_id, quantity_committed)
                 VALUES ($1, $2, $3)`,
                [assignmentId, c.item_id, c.quantity_committed]
            );
            await db.query(
                `UPDATE disaster_request_items
                 SET quantity_fulfilled = quantity_fulfilled + $1
                 WHERE id = $2`,
                [c.quantity_committed, c.item_id]
            );
        }

        // Check if all items are fulfilled → auto-cancel remaining pending assignments
        const requestId = asnCheck.rows[0].request_id;
        const unfulfilledItems = await db.query(
            `SELECT COUNT(*) FROM disaster_request_items
             WHERE request_id = $1 AND quantity_fulfilled < quantity_needed`,
            [requestId]
        );

        if (parseInt(unfulfilledItems.rows[0].count) === 0) {
            // All fulfilled — cancel remaining pending assignments
            await db.query(
                `UPDATE org_request_assignments SET status = 'cancelled', responded_at = NOW()
                 WHERE request_id = $1 AND status = 'pending'`,
                [requestId]
            );
            await db.query(
                `UPDATE disaster_requests SET status = 'fulfilled' WHERE id = $1`,
                [requestId]
            );
        }

        res.json({ message: 'Request accepted successfully' });
    } catch (err) {
        console.error('[500] acceptOrgRequest error:', err?.message || err);
        res.status(500).json({ message: 'Failed to accept request' });
    }
}

// ─── POST /me/requests/:assignmentId/reject ─────────────────────────
async function rejectOrgRequest(req, res) {
    try {
        const orgId = await getOrgIdForUser(req.user.id);
        if (!orgId) return res.status(404).json({ message: 'No organization linked' });

        const { assignmentId } = req.params;
        const result = await db.query(
            `UPDATE org_request_assignments SET status = 'rejected', responded_at = NOW()
             WHERE id = $1 AND organization_id = $2 AND status = 'pending' RETURNING id`,
            [assignmentId, orgId]
        );
        if (result.rows.length === 0) return res.status(404).json({ message: 'Assignment not found or already responded' });
        res.json({ message: 'Request rejected' });
    } catch (err) {
        console.error('[500] rejectOrgRequest error:', err?.message || err);
        res.status(500).json({ message: 'Failed to reject request' });
    }
}

// ─── POST /me/requests/:assignmentId/assign-coordinator ─────────────
async function assignCoordinator(req, res) {
    try {
        const orgId = await getOrgIdForUser(req.user.id);
        if (!orgId) return res.status(404).json({ message: 'No organization linked' });

        const { assignmentId } = req.params;
        const { coordinator_id } = req.body;
        if (!coordinator_id) return res.status(400).json({ message: 'coordinator_id required' });

        // Get disaster_id from assignment
        const asn = await db.query(
            `SELECT ora.request_id, dr.disaster_id
             FROM org_request_assignments ora
             JOIN disaster_requests dr ON dr.id = ora.request_id
             WHERE ora.id = $1 AND ora.organization_id = $2`,
            [assignmentId, orgId]
        );
        if (asn.rows.length === 0) return res.status(404).json({ message: 'Assignment not found' });
        const disasterId = asn.rows[0].disaster_id;

        // Create coordinator assignment
        await db.query(
            `INSERT INTO disaster_coordinator_assignments (disaster_id, organization_id, coordinator_id)
             VALUES ($1, $2, $3)`,
            [disasterId, orgId, coordinator_id]
        );

        // Create volunteer assignments for coordinator's volunteers
        const volunteers = await db.query(
            `SELECT id FROM users WHERE organization_id = $1 AND role = 'volunteer' AND is_active = true`,
            [orgId]
        );

        for (const vol of volunteers.rows) {
            await db.query(
                `INSERT INTO volunteer_disaster_assignments (disaster_id, coordinator_id, volunteer_id)
                 VALUES ($1, $2, $3)`,
                [disasterId, coordinator_id, vol.id]
            );
        }

        res.json({ message: 'Coordinator assigned, volunteers notified', volunteers_notified: volunteers.rows.length });
    } catch (err) {
        console.error('[500] assignCoordinator error:', err?.message || err);
        res.status(500).json({ message: 'Failed to assign coordinator' });
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
    listOrgRequests,
    acceptOrgRequest,
    rejectOrgRequest,
    assignCoordinator,
};
