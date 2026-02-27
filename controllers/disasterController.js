const db = require('../config/db');
const { ensureUserInDb } = require('../utils/userSync');

// POST /api/v1/disasters
async function createDisaster(req, res) {
  try {
    const { name, type, severity, polygon } = req.body;
    if (!name) return res.status(400).json({ message: 'name is required' });
    if (!type) return res.status(400).json({ message: 'type is required' });

    const { userId } = req.auth || {};
    const user = await ensureUserInDb(userId);

    const result = await db.query(
      `INSERT INTO disasters (name, type, severity, affected_area, status, activated_by, activated_at)
       VALUES (
         $1,
         $2,
         $3,
         CASE WHEN $4::text IS NOT NULL THEN ST_Multi(ST_GeomFromGeoJSON($4::text))::geometry(MultiPolygon, 4326) ELSE NULL END,
         'monitoring',
         $5,
         NOW()
       )
       RETURNING *`,
      [name, type, severity || null, polygon ? JSON.stringify(polygon) : null, user.id]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating disaster:', err);
    res.status(500).json({ message: 'Failed to create disaster: ' + err.message });
  }
}

// GET /api/v1/disasters
async function listDisasters(req, res) {
  try {
    const result = await db.query(
      'SELECT * FROM disasters WHERE status IN (\'monitoring\', \'active\', \'contained\') ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing disasters:', err);
    res.status(500).json({ message: 'Failed to list disasters' });
  }
}

// GET /api/v1/disasters/:id
async function getDisasterById(req, res) {
  try {
    const { id } = req.params;
    const result = await db.query('SELECT * FROM disasters WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Disaster not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching disaster:', err);
    res.status(500).json({ message: 'Failed to fetch disaster' });
  }
}

// PATCH /api/v1/disasters/:id
async function updateDisaster(req, res) {
  try {
    const { id } = req.params;
    const { name, type, severity, status } = req.body;

    const result = await db.query(
      `UPDATE disasters
       SET name = COALESCE($1, name),
           type = COALESCE($2, type),
           severity = COALESCE($3, severity),
           status = COALESCE($4, status)
       WHERE id = $5
       RETURNING *`,
      [name || null, type || null, severity !== undefined ? severity : null, status || null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Disaster not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating disaster:', err);
    res.status(500).json({ message: 'Failed to update disaster' });
  }
}

// POST /api/v1/disasters/:id/activate
async function activateDisaster(req, res) {
  try {
    const { id } = req.params;
    const { userId } = req.auth || {};
    const user = await ensureUserInDb(userId);

    const result = await db.query(
      `UPDATE disasters
       SET status = 'active',
           activated_at = NOW(),
           activated_by = $2
       WHERE id = $1
       RETURNING *`,
      [id, user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Disaster not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error activating disaster:', err);
    res.status(500).json({ message: 'Failed to activate disaster' });
  }
}

// POST /api/v1/disasters/:id/resolve
async function resolveDisaster(req, res) {
  try {
    const { id } = req.params;
    const role = req.role || 'user';
    
    // Only admins and coordinators can resolve disasters
    if (!['admin', 'coordinator'].includes(role)) {
      return res.status(403).json({ 
        message: 'Only administrators or coordinators can resolve disasters' 
      });
    }
    
    // Check if disaster has active tasks or SOS alerts
    const activeItems = await db.query(
      `SELECT 
        (SELECT COUNT(*) FROM tasks WHERE disaster_id = $1 AND status IN ('pending', 'accepted', 'in_progress')) as active_tasks,
        (SELECT COUNT(*) FROM sos_alerts WHERE disaster_id = $1 AND status IN ('triggered', 'acknowledged')) as active_sos`,
      [id]
    );
    
    const { active_tasks, active_sos } = activeItems.rows[0];
    
    if (parseInt(active_tasks) > 0 || parseInt(active_sos) > 0) {
      return res.status(400).json({
        message: 'Cannot resolve disaster with active tasks or SOS alerts',
        active_tasks: parseInt(active_tasks),
        active_sos: parseInt(active_sos)
      });
    }
    
    const result = await db.query(
      `UPDATE disasters
       SET status = 'resolved',
           resolved_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Disaster not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error resolving disaster:', err);
    res.status(500).json({ message: 'Failed to resolve disaster' });
  }
}

// GET /api/v1/disasters/:id/stats
async function getDisasterStats(req, res) {
  try {
    const { id } = req.params;
    const stats = await db.query(
      `SELECT
         (SELECT COUNT(*) FROM needs WHERE disaster_id = $1) AS total_needs,
         (SELECT COUNT(*) FROM needs WHERE disaster_id = $1 AND status = 'resolved') AS resolved_needs,
         (SELECT COUNT(*) FROM zones WHERE disaster_id = $1) AS total_zones,
         (SELECT COUNT(*) FROM tasks WHERE disaster_id = $1) AS total_tasks
       `,
      [id]
    );
    res.json(stats.rows[0]);
  } catch (err) {
    console.error('Error getting disaster stats:', err);
    res.status(500).json({ message: 'Failed to get stats' });
  }
}

// GET /api/v1/disasters/:id/tasks
async function getDisasterTasks(req, res) {
  try {
    const { id } = req.params;
    const result = await db.query(
      `SELECT t.*, u.full_name as volunteer_name, u.avatar_url as volunteer_avatar
       FROM tasks t
       LEFT JOIN users u ON t.volunteer_id = u.id
       WHERE t.disaster_id = $1
       ORDER BY t.created_at ASC`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching tasks for disaster:', err);
    res.status(500).json({ message: 'Failed to fetch tasks for disaster' });
  }
}

// GET /api/v1/disasters/:id/report
async function getDisasterReport(req, res) {
  try {
    const { id } = req.params;

    const disaster = await db.query(
      `SELECT id, name, type, status, activated_at, resolved_at
       FROM disasters
       WHERE id = $1`,
      [id]
    );
    if (disaster.rows.length === 0) {
      return res.status(404).json({ message: 'Disaster not found' });
    }

    const metrics = await db.query(
      `WITH task_metrics AS (
         SELECT
           COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_count,
           COUNT(*) FILTER (
             WHERE status IN ('pending', 'accepted', 'in_progress')
               AND EXTRACT(EPOCH FROM (NOW() - created_at)) / 60 > 30
           )::int AS escalation_count,
           AVG(EXTRACT(EPOCH FROM (COALESCE(check_in_time, completed_at, NOW()) - created_at)) / 60)
             FILTER (WHERE status IN ('accepted', 'in_progress', 'completed')) AS avg_response_time,
           COUNT(*) FILTER (
             WHERE status = 'completed'
               AND EXTRACT(EPOCH FROM (COALESCE(completed_at, NOW()) - created_at)) / 60 <= 30
           )::int AS sla_ok_count
         FROM tasks
         WHERE disaster_id = $1
       )
       SELECT
         (SELECT COUNT(*)::int FROM needs WHERE disaster_id = $1) AS total_needs,
         (SELECT COUNT(DISTINCT volunteer_id)::int FROM tasks WHERE disaster_id = $1 AND volunteer_id IS NOT NULL) AS total_volunteers,
         COALESCE((SELECT avg_response_time FROM task_metrics), 0)::numeric(10,2) AS avg_response_time,
         COALESCE((SELECT escalation_count FROM task_metrics), 0)::int AS escalation_count,
         CASE
           WHEN COALESCE((SELECT completed_count FROM task_metrics), 0) = 0 THEN 100
           ELSE ROUND(
             (COALESCE((SELECT sla_ok_count FROM task_metrics), 0)::numeric /
              NULLIF((SELECT completed_count FROM task_metrics), 0)::numeric) * 100, 2
           )
         END AS sla_compliance_pct`,
      [id]
    );

    res.json({
      disaster_id: disaster.rows[0].id,
      disaster_name: disaster.rows[0].name,
      disaster_type: disaster.rows[0].type,
      disaster_status: disaster.rows[0].status,
      ...metrics.rows[0],
    });
  } catch (err) {
    console.error('Error generating disaster report:', err);
    res.status(500).json({ message: 'Failed to generate disaster report' });
  }
}

module.exports = {
  createDisaster,
  listDisasters,
  getDisasterById,
  updateDisaster,
  activateDisaster,
  resolveDisaster,
  getDisasterStats,
  getDisasterTasks,
  getDisasterReport,
};
