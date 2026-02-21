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
            `SELECT t.*, u.full_name AS volunteer_name
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

        const { volunteer_id, type, title, description, meeting_point, disaster_id, zone_id } = req.body;

        if (!type || !title) {
            return res.status(400).json({ message: 'type and title are required' });
        }

        const locString = meeting_point ? `POINT(${meeting_point.lng} ${meeting_point.lat})` : null;

        const result = await db.query(
            `INSERT INTO tasks (disaster_id, zone_id, volunteer_id, assigned_by, type, title, description, meeting_point)
       VALUES ($1, $2, $3, $4, $5, $6, $7,
               CASE WHEN $8::text IS NOT NULL THEN ST_GeogFromText($8::text)::geography ELSE NULL END)
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
            `SELECT n.*, u.full_name AS volunteer_name
       FROM needs n
       LEFT JOIN users u ON n.assigned_volunteer_id = u.id
       ORDER BY n.reported_at DESC
       LIMIT 200`
        );
        const rows = [...result.rows];
        const email = req.user?.emailAddresses?.[0]?.emailAddress;
        if (email === 'arya.mahindrakar07@gmail.com') {
            rows.unshift({
                id: 'debug-need-1',
                request_code: 'DBG-NEED-001',
                reporter_name: 'Debug Citizen',
                reporter_phone: '+910000000001',
                type: 'medical',
                persons_count: 2,
                description: 'Debug entry for coordinator needs dashboard.',
                urgency: 'high',
                status: 'unassigned',
                assigned_volunteer_id: null,
                reported_at: new Date().toISOString(),
                debug: true
            });
        }
        res.json(rows);
    } catch (err) {
        console.error('[coordinator/needs] error:', err);
        res.status(500).json({ message: 'Failed to fetch needs' });
    }
}

// GET /api/v1/coordinator/sos
async function getSos(req, res) {
    try {
        const result = await db.query(
            `SELECT s.*, u.full_name AS volunteer_name
       FROM sos_alerts s
       LEFT JOIN users u ON s.volunteer_id = u.id
       ORDER BY s.created_at DESC
       LIMIT 200`
        );
        res.json(result.rows);
    } catch (err) {
        console.error('[coordinator/sos] error:', err);
        res.status(500).json({ message: 'Failed to fetch SOS alerts' });
    }
}

// GET /api/v1/coordinator/missing?sort=created_at&order=desc
async function getMissingPersons(req, res) {
    try {
        const allowedSort = ['created_at', 'name', 'age', 'status'];
        const sort = allowedSort.includes(req.query.sort) ? req.query.sort : 'created_at';
        const order = req.query.order === 'asc' ? 'ASC' : 'DESC';

        const result = await db.query(
            `SELECT * FROM missing_persons ORDER BY ${sort} ${order} NULLS LAST LIMIT 200`
        );
        const rows = [...result.rows];
        const email = req.user?.emailAddresses?.[0]?.emailAddress;
        if (email === 'arya.mahindrakar07@gmail.com') {
            rows.unshift({
                id: 'debug-missing-1',
                reporter_phone: '+910000000011',
                name: 'Debug Missing Person',
                age: 12,
                status: 'missing',
                created_at: new Date().toISOString(),
                debug: true
            });
        }
        res.json(rows);
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

// GET /api/v1/coordinator/zones
async function getZones(req, res) {
    try {
        const result = await db.query(
            `SELECT z.*, d.name AS disaster_name, d.type AS disaster_type
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

module.exports = { getContext, getVolunteers, getTasks, createTask, deleteTask, getNeeds, getSos, getMissingPersons, markMissingFound, getZones };
