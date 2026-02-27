const db = require('../config/db');

// GET /api/v1/coordinators/metrics
async function getCoordinatorsMetrics(req, res) {
  try {
    const result = await db.query(
      `WITH zone_counts AS (
         SELECT coordinator_id AS user_id, COUNT(DISTINCT zone_id)::int AS zone_count
         FROM disaster_coordinator_assignments
         WHERE status = 'active'
         GROUP BY coordinator_id
         UNION ALL
         SELECT assigned_coordinator_id AS user_id, COUNT(*)::int AS zone_count
         FROM zones
         WHERE assigned_coordinator_id IS NOT NULL
           AND status = 'active'
         GROUP BY assigned_coordinator_id
       ),
       zone_totals AS (
         SELECT user_id, SUM(zone_count)::int AS active_zones
         FROM zone_counts
         GROUP BY user_id
       ),
       task_metrics AS (
         SELECT
           t.assigned_by AS user_id,
           COUNT(*) FILTER (WHERE t.status IN ('pending', 'accepted', 'in_progress'))::int AS active_tasks,
           COUNT(*) FILTER (WHERE t.status = 'completed')::int AS total_resolved_tasks,
           AVG(EXTRACT(EPOCH FROM (COALESCE(t.check_in_time, t.completed_at, NOW()) - t.created_at)) / 60)
             FILTER (WHERE t.status IN ('accepted', 'in_progress', 'completed')) AS avg_response_time,
           COUNT(*) FILTER (
             WHERE t.status IN ('pending', 'accepted', 'in_progress')
               AND EXTRACT(EPOCH FROM (NOW() - t.created_at)) / 60 > 30
           )::int AS escalated_active_tasks,
           COUNT(*) FILTER (
             WHERE t.status = 'completed'
               AND EXTRACT(EPOCH FROM (COALESCE(t.completed_at, NOW()) - t.created_at)) / 60 <= 30
           )::int AS sla_ok_completed
         FROM tasks t
         WHERE t.assigned_by IS NOT NULL
         GROUP BY t.assigned_by
       )
       SELECT
         u.id AS coordinator_id,
         u.full_name AS coordinator_name,
         COALESCE(z.active_zones, 0)::int AS active_zones,
         COALESCE(tm.active_tasks, 0)::int AS active_tasks,
         COALESCE(tm.avg_response_time, 0)::numeric(10,2) AS avg_response_time,
         COALESCE(tm.total_resolved_tasks, 0)::int AS total_resolved_tasks,
         CASE
           WHEN COALESCE(tm.active_tasks, 0) = 0 THEN 0
           ELSE ROUND((COALESCE(tm.escalated_active_tasks, 0)::numeric / NULLIF(tm.active_tasks, 0)::numeric) * 100, 2)
         END AS escalation_rate_pct,
         CASE
           WHEN COALESCE(tm.total_resolved_tasks, 0) = 0 THEN 100
           ELSE ROUND((COALESCE(tm.sla_ok_completed, 0)::numeric / NULLIF(tm.total_resolved_tasks, 0)::numeric) * 100, 2)
         END AS sla_compliance_pct
       FROM users u
       LEFT JOIN zone_totals z ON z.user_id = u.id
       LEFT JOIN task_metrics tm ON tm.user_id = u.id
       WHERE u.role = 'coordinator'
       ORDER BY total_resolved_tasks DESC, coordinator_name ASC`
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error getting coordinator metrics:', err);
    res.status(500).json({ message: 'Failed to load coordinator metrics' });
  }
}

module.exports = { getCoordinatorsMetrics };
