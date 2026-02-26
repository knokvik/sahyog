const db = require('../config/db');

// ──────────────────────────────────────────
// ZONE CRUD (for disaster relief map)
// ──────────────────────────────────────────

// POST /api/v1/disasters/:id/zones
async function createZone(req, res) {
    try {
        const { id: disasterId } = req.params;
        const { name, severity, center_lng, center_lat, radius_meters } = req.body;

        if (!name) return res.status(400).json({ message: 'Zone name is required' });
        if (!center_lng || !center_lat) return res.status(400).json({ message: 'Center coordinates required' });
        if (!radius_meters) return res.status(400).json({ message: 'Radius is required' });

        const code = `Z-${Date.now().toString(36).toUpperCase()}`;
        const validSeverity = ['red', 'yellow', 'blue'].includes(severity) ? severity : 'red';

        const result = await db.query(
            `INSERT INTO zones (disaster_id, name, code, severity, radius_meters,
            center, boundary, status)
       VALUES ($1, $2, $3, $4, $5,
            ST_SetSRID(ST_MakePoint($6, $7), 4326),
            ST_Buffer(ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography, $5)::geometry,
            'active')
       RETURNING id, name, code, severity, radius_meters, status,
            ST_X(center) AS center_lng, ST_Y(center) AS center_lat, created_at`,
            [disasterId, name, code, validSeverity, radius_meters, center_lng, center_lat]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error creating zone:', err);
        res.status(500).json({ message: 'Failed to create zone: ' + err.message });
    }
}

// GET /api/v1/disasters/:id/zones
async function listZones(req, res) {
    try {
        const { id: disasterId } = req.params;
        const result = await db.query(
            `SELECT id, name, code, severity, radius_meters, status,
              ST_X(center) AS center_lng, ST_Y(center) AS center_lat,
              created_at
       FROM zones WHERE disaster_id = $1 ORDER BY created_at ASC`,
            [disasterId]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Error listing zones:', err);
        res.status(500).json({ message: 'Failed to list zones' });
    }
}

// DELETE /api/v1/disasters/:id/zones/:zoneId
async function deleteZone(req, res) {
    try {
        const { zoneId } = req.params;
        
        // Check for active assignments before deletion
        const activeAssignments = await db.query(
            `SELECT 
                (SELECT COUNT(*) FROM tasks WHERE zone_id = $1 AND status IN ('pending', 'accepted', 'in_progress')) as active_tasks,
                (SELECT COUNT(*) FROM volunteer_disaster_assignments WHERE zone_id = $1 AND status = 'accepted') as active_volunteers,
                (SELECT COUNT(*) FROM disaster_coordinator_assignments WHERE zone_id = $1) as active_coordinators,
                (SELECT COUNT(*) FROM resources WHERE current_zone_id = $1) as deployed_resources`,
            [zoneId]
        );
        
        const { active_tasks, active_volunteers, active_coordinators, deployed_resources } = activeAssignments.rows[0];
        
        const totalActive = parseInt(active_tasks) + parseInt(active_volunteers) + 
                           parseInt(active_coordinators) + parseInt(deployed_resources);
        
        if (totalActive > 0) {
            return res.status(400).json({
                message: 'Cannot delete zone with active assignments. Reassign or complete all activities first.',
                active_tasks: parseInt(active_tasks),
                active_volunteers: parseInt(active_volunteers),
                active_coordinators: parseInt(active_coordinators),
                deployed_resources: parseInt(deployed_resources)
            });
        }
        
        const result = await db.query('DELETE FROM zones WHERE id = $1 RETURNING id', [zoneId]);
        if (result.rows.length === 0) return res.status(404).json({ message: 'Zone not found' });
        res.json({ message: 'Zone deleted', id: result.rows[0].id });
    } catch (err) {
        console.error('Error deleting zone:', err);
        res.status(500).json({ message: 'Failed to delete zone' });
    }
}

// ──────────────────────────────────────────
// DISASTER REQUEST CRUD
// ──────────────────────────────────────────

// POST /api/v1/disasters/:id/requests
// Body: { notes, items: [{resource_type, quantity_needed, is_default}], org_ids: [uuid] }
async function createRequest(req, res) {
    try {
        const { id: disasterId } = req.params;
        const { notes, items, org_ids } = req.body;

        if (!items || items.length === 0)
            return res.status(400).json({ message: 'At least one resource item required' });
        if (!org_ids || org_ids.length === 0)
            return res.status(400).json({ message: 'At least one organization must be selected' });

        const userId = req.dbUser?.id;

        // 1. Create the request
        const reqResult = await db.query(
            `INSERT INTO disaster_requests (disaster_id, created_by, notes)
       VALUES ($1, $2, $3) RETURNING *`,
            [disasterId, userId, notes || null]
        );
        const requestId = reqResult.rows[0].id;

        // 2. Create request items
        for (const item of items) {
            await db.query(
                `INSERT INTO disaster_request_items (request_id, resource_type, quantity_needed, is_default)
         VALUES ($1, $2, $3, $4)`,
                [requestId, item.resource_type, item.quantity_needed, item.is_default ?? false]
            );
        }

        // 3. Create org assignments
        for (const orgId of org_ids) {
            await db.query(
                `INSERT INTO org_request_assignments (request_id, organization_id)
         VALUES ($1, $2)`,
                [requestId, orgId]
            );
        }

        res.status(201).json({ id: requestId, message: 'Request sent to organizations' });
    } catch (err) {
        console.error('Error creating request:', err);
        res.status(500).json({ message: 'Failed to create request: ' + err.message });
    }
}

// GET /api/v1/disasters/:id/requests  (with progress data)
async function listRequests(req, res) {
    try {
        const { id: disasterId } = req.params;

        // Get requests
        const requests = await db.query(
            `SELECT dr.*, u.full_name AS created_by_name
       FROM disaster_requests dr
       LEFT JOIN users u ON u.id = dr.created_by
       WHERE dr.disaster_id = $1
       ORDER BY dr.created_at DESC`,
            [disasterId]
        );

        // For each request, get items with fulfillment + org assignments
        const result = [];
        for (const req_ of requests.rows) {
            const items = await db.query(
                `SELECT * FROM disaster_request_items WHERE request_id = $1 ORDER BY is_default DESC, resource_type`,
                [req_.id]
            );

            const assignments = await db.query(
                `SELECT ora.*, o.name AS org_name
         FROM org_request_assignments ora
         LEFT JOIN organizations o ON o.id = ora.organization_id
         WHERE ora.request_id = $1
         ORDER BY ora.created_at ASC`,
                [req_.id]
            );

            // For accepted assignments, get their contributions
            for (const asn of assignments.rows) {
                if (asn.status === 'accepted') {
                    const contribs = await db.query(
                        `SELECT orc.*, dri.resource_type
             FROM org_request_contributions orc
             JOIN disaster_request_items dri ON dri.id = orc.item_id
             WHERE orc.assignment_id = $1`,
                        [asn.id]
                    );
                    asn.contributions = contribs.rows;
                }
            }

            result.push({
                ...req_,
                items: items.rows,
                assignments: assignments.rows,
            });
        }

        res.json(result);
    } catch (err) {
        console.error('Error listing requests:', err);
        res.status(500).json({ message: 'Failed to list requests' });
    }
}

// GET /api/v1/organizations/list  (list all orgs for admin selection)
async function listAllOrgs(req, res) {
    try {
        const result = await db.query(
            'SELECT id, name, email, state, district FROM organizations ORDER BY name'
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Error listing orgs:', err);
        res.status(500).json({ message: 'Failed to list organizations' });
    }
}

module.exports = {
    createZone,
    listZones,
    deleteZone,
    createRequest,
    listRequests,
    listAllOrgs,
};
