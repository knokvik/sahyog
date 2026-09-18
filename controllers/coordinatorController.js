// GET /api/v1/coordinator/my-zone-volunteers
// Returns all volunteers assigned to zones where the coordinator is assigned (primary/backup)
async function getMyZoneVolunteers(req, res) {
    try {
        const { userId } = req.auth || {};
        if (!userId) return res.status(401).json({ message: 'Not authenticated' });
        // Find coordinator's DB id
        const dbUser = await db.query('SELECT id FROM users WHERE clerk_user_id = $1', [userId]);
        const coordinatorId = dbUser.rows[0]?.id;
        if (!coordinatorId) return res.status(404).json({ message: 'Coordinator not found' });
        // Get all zone_ids where this coordinator is assigned
        const zonesResult = await db.query(
            `SELECT zone_id FROM disaster_coordinator_assignments WHERE coordinator_id = $1 AND status = 'active'`,
            [coordinatorId]
        );
        const zoneIds = zonesResult.rows.map(r => r.zone_id);
        if (zoneIds.length === 0) return res.json([]);
        // Get all volunteers assigned to these zones
        const volunteersResult = await db.query(
            `SELECT vda.*, u.full_name, u.email, u.phone, u.organization_id, z.name AS zone_name
             FROM volunteer_disaster_assignments vda
             JOIN users u ON u.id = vda.volunteer_id
             JOIN zones z ON z.id = vda.zone_id
             WHERE vda.zone_id = ANY($1::uuid[]) AND vda.status = 'accepted'`,
            [zoneIds]
        );
        res.json(volunteersResult.rows);
    } catch (err) {
        console.error('[coordinator/my-zone-volunteers] error:', err);
        res.status(500).json({ message: 'Failed to fetch volunteers for your zones' });
    }
}
// GET /api/v1/coordinator/my-zones
// Returns all zones where the coordinator is assigned (primary or backup)
async function getMyZones(req, res) {
    try {
        const { userId } = req.auth || {};
        if (!userId) return res.status(401).json({ message: 'Not authenticated' });
        // Find coordinator's DB id
        const dbUser = await db.query('SELECT id FROM users WHERE clerk_user_id = $1', [userId]);
        const coordinatorId = dbUser.rows[0]?.id;
        if (!coordinatorId) return res.status(404).json({ message: 'Coordinator not found' });
        // Get all active assignments for this coordinator
        const assignments = await db.query(
            `SELECT dca.*, z.*, d.name AS disaster_name, d.type AS disaster_type
             FROM disaster_coordinator_assignments dca
             JOIN zones z ON z.id = dca.zone_id
             JOIN disasters d ON d.id = z.disaster_id
             WHERE dca.coordinator_id = $1 AND dca.status = 'active'`,
            [coordinatorId]
        );
        res.json(assignments.rows);
    } catch (err) {
        console.error('[coordinator/my-zones] error:', err);
        res.status(500).json({ message: 'Failed to fetch assigned zones' });
    }
}
const db = require('../config/db');
const { ensureUserInDb } = require('../utils/userSync');

// GET /api/v1/coordinator/context
async function getContext(req, res) {
    try {
        const { userId } = req.auth || {};
        const dbUser = await ensureUserInDb(userId);

        // Summary stats (global, no zone filter)
        const [volRes, taskRes, needRes, sosRes, missingRes] = await Promise.all([
            db.query(`SELECT COUNT(*)::int AS cnt FROM users WHERE role = 'volunteer'`),
            db.query(`SELECT status, COUNT(*)::int AS cnt FROM tasks GROUP BY status`),
            db.query(`SELECT status, COUNT(*)::int AS cnt FROM needs GROUP BY status`),
            db.query(`SELECT COUNT(*)::int AS cnt FROM sos_alerts WHERE status IN ('triggered','pending','in_progress')`),
            db.query(`SELECT COUNT(*)::int AS cnt FROM missing_persons WHERE status = 'missing'`),
        ]);

        const tasksByStatus = {};
        let totalTasks = 0;
        for (const r of taskRes.rows) { tasksByStatus[r.status] = r.cnt; totalTasks += r.cnt; }

        const needsByStatus = {};
        let totalNeeds = 0;
        for (const r of needRes.rows) { needsByStatus[r.status] = r.cnt; totalNeeds += r.cnt; }

        res.json({
            user_id: dbUser.id,
            user_name: dbUser.full_name,
            role: dbUser.role,
            stats: {
                volunteers: parseInt(volRes.rows[0]?.cnt || '0', 10),
                tasks: { total: totalTasks, ...tasksByStatus },
                needs: { total: totalNeeds, ...needsByStatus },
                active_sos: parseInt(sosRes.rows[0]?.cnt || '0', 10),
                missing: parseInt(missingRes.rows[0]?.cnt || '0', 10),
            },
        });
    } catch (err) {
        console.error('[coordinator/context] error:', err);
        res.status(500).json({ message: 'Failed to fetch coordinator context' });
    }
}

// GET /api/v1/coordinator/volunteers
async function getVolunteers(req, res) {
    try {
        const result = await db.query(
            `SELECT u.id, u.clerk_user_id, u.is_verified,
                    u.full_name, u.email, u.phone, u.avatar_url,
                    u.is_active, u.last_active,
                    ST_X(u.current_location::geometry) AS lng,
                    ST_Y(u.current_location::geometry) AS lat,
                    COUNT(t.id) FILTER (WHERE t.status IN ('pending','accepted','in_progress'))::int AS active_tasks,
                    COUNT(t.id) FILTER (WHERE t.status = 'completed')::int AS completed_tasks
             FROM users u
             LEFT JOIN tasks t ON t.volunteer_id = u.id
             WHERE u.role = 'volunteer'
             GROUP BY u.id
             ORDER BY u.is_active DESC, u.last_active DESC NULLS LAST, u.full_name ASC
             LIMIT 500`
        );
        res.json(result.rows);
    } catch (err) {
        console.error('[coordinator/volunteers] error:', err);
        res.status(500).json({ message: 'Failed to fetch volunteers' });
    }
}

// GET /api/v1/coordinator/tasks
async function getTasks(req, res) {
    try {
        const result = await db.query(
            `SELECT t.*, 
                    ST_X(t.meeting_point::geometry) AS lng,
                    ST_Y(t.meeting_point::geometry) AS lat,
                    u.full_name AS volunteer_name
             FROM tasks t
             LEFT JOIN users u ON t.volunteer_id = u.id
             ORDER BY t.created_at DESC
             LIMIT 200`
        );
        res.json(result.rows);
    } catch (err) {
        console.error('[coordinator/tasks] error:', err);
        res.status(500).json({ message: 'Failed to fetch tasks' });
    }
}

// POST /api/v1/coordinator/tasks
async function createTask(req, res) {
    try {
        const { userId } = req.auth || {};
        const dbUser = await ensureUserInDb(userId);

        const { volunteer_id, type, title, description, meeting_point, disaster_id, zone_id, status } = req.body;

        if (!type || !title) {
            return res.status(400).json({ message: 'type and title are required' });
        }

        const locString = meeting_point ? `POINT(${meeting_point.lng} ${meeting_point.lat})` : null;

        const result = await db.query(
            `INSERT INTO tasks (disaster_id, zone_id, volunteer_id, assigned_by, type, title, description, meeting_point, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7,
               CASE WHEN $8::text IS NOT NULL THEN ST_GeomFromText($8::text, 4326) ELSE NULL END,
               $9)
       RETURNING *`,
            [
                disaster_id || null,
                zone_id || null,
                volunteer_id || null,
                dbUser.id,
                type,
                title,
                description || null,
                locString,
                status || 'pending'
            ]
        );

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('[coordinator/createTask] error:', err);
        res.status(500).json({ message: 'Failed to create task' });
    }
}

// DELETE /api/v1/coordinator/tasks/:id
async function deleteTask(req, res) {
    try {
        const { id } = req.params;
        const result = await db.query('DELETE FROM tasks WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Task not found' });
        }
        res.json({ message: 'Task deleted', task: result.rows[0] });
    } catch (err) {
        console.error('[coordinator/deleteTask] error:', err);
        res.status(500).json({ message: 'Failed to delete task' });
    }
}

// GET /api/v1/coordinator/needs
async function getNeeds(req, res) {
    try {
        const result = await db.query(
            `SELECT n.*, 
                    ST_X(n.location::geometry) AS lng,
                    ST_Y(n.location::geometry) AS lat,
                    u.full_name AS volunteer_name
       FROM needs n
       LEFT JOIN users u ON n.assigned_volunteer_id = u.id
       ORDER BY n.reported_at DESC
       LIMIT 200`
        );
        res.json(result.rows);
    } catch (err) {
        console.error('[coordinator/needs] error:', err);
        res.status(500).json({ message: 'Failed to fetch needs' });
    }
}

// GET /api/v1/coordinator/sos
async function getSos(req, res) {
    try {
        console.log('[coordinator/sos] Fetching SOS alerts...');
        const result = await db.query(
            `SELECT s.*, 
                    ST_X(s.location::geometry) AS lng,
                    ST_Y(s.location::geometry) AS lat,
                    COALESCE(rep.full_name, 'Unknown Reporter') AS reporter_name,
                    COALESCE(rep.phone, 'No Phone') AS reporter_phone,
                    COALESCE(ack.full_name, 'Unassigned') AS volunteer_name,
                    av.full_name AS assigned_volunteer_name,
                    s.assigned_volunteer_id
             FROM sos_alerts s
             LEFT JOIN users rep ON s.reporter_id = rep.id
             LEFT JOIN users ack ON s.acknowledged_by = ack.id
             LEFT JOIN users av  ON s.assigned_volunteer_id = av.id
             ORDER BY s.created_at DESC
             LIMIT 200`
        );
        res.json(result.rows);
    } catch (err) {
        console.error('[coordinator/sos] Error details:', err.message, err.stack);
        res.status(500).json({ message: 'Failed to fetch SOS alerts', error: err.message });
    }
}

// GET /api/v1/coordinator/missing?sort=created_at&order=desc
async function getMissingPersons(req, res) {
    try {
        const allowedSort = ['created_at', 'name', 'age', 'status'];
        const sort = allowedSort.includes(req.query.sort) ? req.query.sort : 'created_at';
        const order = req.query.order === 'asc' ? 'ASC' : 'DESC';

        const result = await db.query(
            `SELECT *,
                    ST_X(last_seen_location::geometry) AS lng,
                    ST_Y(last_seen_location::geometry) AS lat
             FROM missing_persons 
             ORDER BY ${sort} ${order} NULLS LAST LIMIT 200`
        );
        res.json(result.rows);
    } catch (err) {
        console.error('[coordinator/missing] error:', err);
        res.status(500).json({ message: 'Failed to fetch missing persons' });
    }
}

// PATCH /api/v1/coordinator/missing/:id/found
async function markMissingFound(req, res) {
    try {
        const { id } = req.params;
        const { description } = req.body || {};

        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(id)) {
            if (id && id.toString().includes('debug')) {
                return res.json({ id, status: 'found', message: 'Debug report marked found (mock)' });
            }
            return res.status(400).json({ message: 'Invalid report ID format' });
        }
        const result = await db.query(
            `UPDATE missing_persons SET status = 'found' WHERE id = $1 RETURNING *`,
            [id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Missing person record not found' });
        }
        if (description && description.trim()) {
            try {
                await db.query(
                    `CREATE TABLE IF NOT EXISTS missing_person_updates (
                       id bigserial PRIMARY KEY,
                       missing_person_id uuid NOT NULL REFERENCES missing_persons(id) ON DELETE CASCADE,
                       updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
                       note text,
                       created_at timestamp DEFAULT now()
                     )`
                );
                await db.query(
                    `INSERT INTO missing_person_updates (missing_person_id, updated_by, note)
                     VALUES ($1, $2, $3)`,
                    [id, req.dbUser?.id || null, description.trim()]
                );
            } catch (noteErr) {
                console.error('[coordinator/markFound] note save failed:', noteErr?.message || noteErr);
            }
        }
        res.json({ ...result.rows[0], closure_note: description || null });
    } catch (err) {
        console.error('[coordinator/markFound] error:', err);
        res.status(500).json({ message: 'Failed to mark as found' });
    }
}

// PATCH /api/v1/coordinator/tasks/:id/reassign
async function reassignTask(req, res) {
    try {
        const { id } = req.params;
        const { volunteer_id } = req.body;
        if (!volunteer_id) {
            return res.status(400).json({ message: 'volunteer_id is required' });
        }
        const result = await db.query(
            `UPDATE tasks SET volunteer_id = $1, status = 'pending' WHERE id = $2 RETURNING *`,
            [volunteer_id, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Task not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('[coordinator/reassignTask] error:', err);
        res.status(500).json({ message: 'Failed to reassign task' });
    }
}

// GET /api/v1/coordinator/zones
async function getZones(req, res) {
    try {
        const result = await db.query(
            `SELECT z.*, 
                    ST_X(ST_Centroid(z.boundary::geometry)) AS center_lng,
                    ST_Y(ST_Centroid(z.boundary::geometry)) AS center_lat,
                    d.name AS disaster_name, d.type AS disaster_type
       FROM zones z
       LEFT JOIN disasters d ON z.disaster_id = d.id
       ORDER BY z.created_at DESC`
        );
        res.json(result.rows);
    } catch (err) {
        console.error('[coordinator/zones] error:', err);
        res.status(500).json({ message: 'Failed to fetch zones' });
    }
}

module.exports = {
    getContext,
    getVolunteers,
    getTasks,
    createTask,
    deleteTask,
    getNeeds,
    getSos,
    getMissingPersons,
    markMissingFound,
    reassignTask,
    getZones,
    getMyZones,
    getMyZoneVolunteers,
};
