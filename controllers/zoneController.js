const db = require('../config/db');

// PATCH /api/v1/zones/:id
// Only primary coordinator assigned to this zone can edit
async function updateZone(req, res) {
    try {
        const { id } = req.params;
        const { userId } = req.auth || {};
        if (!userId) return res.status(401).json({ message: 'Not authenticated' });

        const dbUser = await db.query('SELECT id FROM users WHERE clerk_user_id = $1', [userId]);
        const coordinatorId = dbUser.rows[0]?.id;
        if (!coordinatorId) return res.status(404).json({ message: 'Coordinator not found' });

        const assignment = await db.query(
            `SELECT * FROM disaster_coordinator_assignments
             WHERE zone_id = $1 AND coordinator_id = $2 AND status = 'active' AND is_primary = true`,
            [id, coordinatorId]
        );
        if (assignment.rows.length === 0) {
            return res.status(403).json({ message: 'You are not the primary coordinator for this zone' });
        }

        const { name, code, boundary } = req.body;
        const result = await db.query(
            `UPDATE zones SET
                name = COALESCE($1, name),
                code = COALESCE($2, code),
                boundary = COALESCE(CASE WHEN $3::text IS NOT NULL THEN ST_GeomFromGeoJSON($3::text)::geography ELSE boundary END, boundary)
             WHERE id = $4 RETURNING *`,
            [name, code, boundary ? JSON.stringify(boundary) : null, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ message: 'Zone not found' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error updating zone:', err);
        res.status(500).json({ message: 'Failed to update zone' });
    }
}

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

// GET /api/v1/zones/summary
async function getZonesSummary(req, res) {
    try {
        const result = await db.query(
            `WITH need_stats AS (
               SELECT
                 n.zone_id,
                 COUNT(*) FILTER (WHERE n.status NOT IN ('resolved', 'cancelled'))::int AS active_needs_count,
                 COUNT(*) FILTER (
                   WHERE (n.status = 'unassigned' OR n.assigned_volunteer_id IS NULL)
                     AND n.status NOT IN ('resolved', 'cancelled')
                 )::int AS unassigned_needs_count,
                 AVG(
                   CASE LOWER(COALESCE(n.urgency, 'medium'))
                     WHEN 'critical' THEN 100
                     WHEN 'high' THEN 80
                     WHEN 'medium' THEN 50
                     WHEN 'low' THEN 20
                     ELSE 40
                   END
                 ) AS avg_priority
               FROM needs n
               GROUP BY n.zone_id
             ),
             task_stats AS (
               SELECT
                 t.zone_id,
                 COUNT(*) FILTER (
                   WHERE t.status IN ('pending', 'accepted', 'in_progress')
                     AND EXTRACT(EPOCH FROM (NOW() - t.created_at)) / 60 > 30
                 )::int AS escalated_tasks_count,
                 AVG(
                   EXTRACT(EPOCH FROM (
                     COALESCE(t.check_in_time, t.completed_at, NOW()) - t.created_at
                   )) / 60
                 ) FILTER (WHERE t.status IN ('accepted', 'in_progress', 'completed')) AS avg_response_time_minutes,
                 AVG(
                   EXTRACT(EPOCH FROM (NOW() - t.created_at)) / 60
                 ) FILTER (WHERE t.status IN ('pending', 'accepted', 'in_progress')) AS avg_delay_minutes
               FROM tasks t
               GROUP BY t.zone_id
             ),
             volunteer_stats AS (
               SELECT
                 t.zone_id,
                 COUNT(DISTINCT t.volunteer_id)::int AS active_volunteers_count
               FROM tasks t
               JOIN users u ON u.id = t.volunteer_id
               WHERE t.status IN ('pending', 'accepted', 'in_progress')
                 AND u.role = 'volunteer'
               GROUP BY t.zone_id
             )
             SELECT
               z.id AS zone_id,
               z.name AS zone_name,
               COALESCE(ns.active_needs_count, 0) AS active_needs_count,
               COALESCE(ns.unassigned_needs_count, 0) AS unassigned_needs_count,
               COALESCE(vs.active_volunteers_count, 0) AS active_volunteers_count,
               COALESCE(ts.avg_response_time_minutes, 0)::numeric(10,2) AS avg_response_time_minutes,
               COALESCE(ts.escalated_tasks_count, 0) AS escalated_tasks_count,
               (
                 COALESCE(ns.active_needs_count, 0) * 0.5 +
                 COALESCE(ns.avg_priority, 0) * 0.3 +
                 COALESCE(ts.avg_delay_minutes, 0) * 0.2
               )::numeric(10,2) AS severity_score,
               CASE
                 WHEN (
                   COALESCE(ns.active_needs_count, 0) * 0.5 +
                   COALESCE(ns.avg_priority, 0) * 0.3 +
                   COALESCE(ts.avg_delay_minutes, 0) * 0.2
                 ) <= 30 THEN 'green'
                 WHEN (
                   COALESCE(ns.active_needs_count, 0) * 0.5 +
                   COALESCE(ns.avg_priority, 0) * 0.3 +
                   COALESCE(ts.avg_delay_minutes, 0) * 0.2
                 ) <= 60 THEN 'yellow'
                 ELSE 'red'
               END AS status_color
             FROM zones z
             LEFT JOIN need_stats ns ON ns.zone_id = z.id
             LEFT JOIN task_stats ts ON ts.zone_id = z.id
             LEFT JOIN volunteer_stats vs ON vs.zone_id = z.id
             ORDER BY severity_score DESC, z.name ASC`
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Error getting zone summary:', err);
        res.status(500).json({ message: 'Failed to load zones summary' });
    }
}

// GET /api/v1/zones/geojson
async function getZonesGeoJson(req, res) {
    try {
        const result = await db.query(
            `SELECT json_build_object(
               'type', 'FeatureCollection',
               'features', COALESCE(
                 json_agg(
                   json_build_object(
                     'type', 'Feature',
                     'geometry', ST_AsGeoJSON(z.boundary)::json,
                     'properties', json_build_object(
                       'zone_id', z.id,
                       'zone_name', z.name,
                       'code', z.code,
                       'status', z.status,
                       'disaster_id', z.disaster_id
                     )
                   )
                 ) FILTER (WHERE z.boundary IS NOT NULL),
                 '[]'::json
               )
             ) AS geojson
             FROM zones z`
        );
        res.json(result.rows[0]?.geojson || { type: 'FeatureCollection', features: [] });
    } catch (err) {
        console.error('Error getting zones geojson:', err);
        res.status(500).json({ message: 'Failed to load zones geojson' });
    }
}

// PATCH /api/v1/admin/workflows/zones/:id/freeze
async function freezeZone(req, res) {
    try {
        const { id } = req.params;
        const result = await db.query(
            `UPDATE zones
             SET status = 'frozen'
             WHERE id = $1
             RETURNING *`,
            [id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Zone not found' });
        }
        res.json({ message: 'Zone frozen', zone: result.rows[0] });
    } catch (err) {
        console.error('Error freezing zone:', err);
        res.status(500).json({ message: 'Failed to freeze zone' });
    }
}

module.exports = {
    createZone,
    listZones,
    assignCoordinator,
    updateZone,
    getZonesSummary,
    getZonesGeoJson,
    freezeZone,
};
