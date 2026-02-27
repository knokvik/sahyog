const db = require('../config/db');
const { ensureUserInDb } = require('../utils/userSync');

const ALLOWED_CREATOR_ROLES = new Set(['volunteer', 'coordinator', 'admin']);
const ACTIVE_STATUSES = ['pending', 'accepted', 'in_progress'];
const HISTORY_STATUSES = ['completed', 'resolved', 'cancelled'];

async function ensureVoteTable() {
  await db.query(
    `CREATE TABLE IF NOT EXISTS task_completion_votes (
       id bigserial PRIMARY KEY,
       task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
       voter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       vote varchar NOT NULL CHECK (vote IN ('completed', 'rejected')),
       note text,
       created_at timestamp DEFAULT now(),
       updated_at timestamp DEFAULT now(),
       UNIQUE(task_id, voter_id)
     )`
  );
}

async function loadTask(taskId) {
  const result = await db.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
  return result.rows[0] || null;
}

async function getRequiredVotes(task) {
  if (!task) return 1;

  const rel = await db.query(
    `SELECT to_regclass('public.volunteer_disaster_assignments') AS rel_name`
  );
  const hasAssignmentTable = !!rel.rows[0]?.rel_name;

  if (hasAssignmentTable && task.disaster_id) {
    const accepted = await db.query(
      `SELECT COUNT(*)::int AS count
       FROM volunteer_disaster_assignments
       WHERE disaster_id = $1 AND status = 'accepted'`,
      [task.disaster_id]
    );

    const count = accepted.rows[0]?.count || 0;
    if (count > 0) return count;
  }

  return task.volunteer_id ? 1 : 1;
}

async function createTask(req, res) {
  try {
    const {
      need_id,
      disaster_id,
      zone_id,
      volunteer_id,
      type,
      title,
      description,
      meeting_point,
      sosId,
    } = req.body;

    if (!type || !title) {
      return res.status(400).json({ message: 'Missing required fields: type, title' });
    }

    const currentUser = req.dbUser || (await ensureUserInDb(req.auth?.userId));
    const role = req.role || currentUser.role || 'volunteer';

    if (!ALLOWED_CREATOR_ROLES.has(role)) {
      return res.status(403).json({ message: 'Only volunteer/coordinator/admin can create tasks' });
    }

    // Validate foreign key references
    if (need_id) {
      const needCheck = await db.query('SELECT id FROM needs WHERE id = $1', [need_id]);
      if (needCheck.rows.length === 0) {
        return res.status(404).json({ message: 'Referenced need not found' });
      }
    }

    if (disaster_id) {
      const disasterCheck = await db.query('SELECT id FROM disasters WHERE id = $1', [disaster_id]);
      if (disasterCheck.rows.length === 0) {
        return res.status(404).json({ message: 'Referenced disaster not found' });
      }
    }

    if (zone_id) {
      const zoneCheck = await db.query('SELECT id FROM zones WHERE id = $1', [zone_id]);
      if (zoneCheck.rows.length === 0) {
        return res.status(404).json({ message: 'Referenced zone not found' });
      }
    }

    if (volunteer_id) {
      const volunteerCheck = await db.query('SELECT id FROM users WHERE id = $1 AND role = $2', [volunteer_id, 'volunteer']);
      if (volunteerCheck.rows.length === 0) {
        return res.status(404).json({ message: 'Referenced volunteer not found' });
      }
    }

    if (sosId) {
      const sosCheck = await db.query('SELECT id FROM sos_alerts WHERE id = $1', [sosId]);
      if (sosCheck.rows.length === 0) {
        return res.status(404).json({ message: 'Referenced SOS alert not found' });
      }
    }

    const locString = meeting_point
      ? `POINT(${meeting_point.lng} ${meeting_point.lat})`
      : null;

    const result = await db.query(
      `INSERT INTO tasks (need_id, disaster_id, zone_id, volunteer_id, assigned_by, type, title, description, meeting_point, sos_id, status)
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8,
         CASE WHEN $9::text IS NOT NULL THEN ST_GeomFromText($9::text, 4326) ELSE NULL END,
         $10,
         'pending'
       )
       RETURNING *`,
      [
        need_id || null,
        disaster_id || null,
        zone_id || null,
        volunteer_id || null,
        currentUser.id,
        type,
        title,
        description || null,
        locString,
        sosId || null,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating task:', err);
    res.status(500).json({ message: 'Failed to create task: ' + err.message });
  }
}

async function listPendingTasks(req, res) {
  try {
    const user = req.dbUser || (await ensureUserInDb(req.auth?.userId));
    const role = req.role || user.role || 'volunteer';

    let queryText = `
      SELECT t.*, n.request_code AS need_code, n.location AS need_location,
             ST_X(t.meeting_point::geometry) AS lng,
             ST_Y(t.meeting_point::geometry) AS lat,
             u.full_name AS volunteer_name, u2.full_name AS assigned_by_name
      FROM tasks t
      LEFT JOIN needs n ON t.need_id = n.id
      LEFT JOIN users u ON t.volunteer_id = u.id
      LEFT JOIN users u2 ON t.assigned_by = u2.id
      WHERE t.status = ANY($1::text[])
    `;

    const params = [ACTIVE_STATUSES];

    if (role === 'volunteer') {
      queryText += ' AND (t.volunteer_id = $2 OR (t.volunteer_id IS NULL AND t.status = \'pending\'))';
      params.push(user.id);
    } else if (role === 'coordinator') {
      queryText += ' AND (t.assigned_by = $2 OR t.volunteer_id IS NOT NULL)';
      params.push(user.id);
    }

    queryText += ' ORDER BY t.created_at DESC LIMIT 300';

    const result = await db.query(queryText, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing tasks:', err);
    res.status(500).json({ message: 'Failed to list tasks' });
  }
}

async function listTaskHistory(req, res) {
  try {
    const user = req.dbUser || (await ensureUserInDb(req.auth?.userId));
    const role = req.role || user.role || 'volunteer';

    let queryText = `
      SELECT t.*, 
             ST_X(t.meeting_point::geometry) AS lng,
             ST_Y(t.meeting_point::geometry) AS lat,
             u.full_name AS volunteer_name
      FROM tasks t
      LEFT JOIN users u ON t.volunteer_id = u.id
      WHERE t.status = ANY($1::text[])
    `;
    const params = [HISTORY_STATUSES];

    if (role === 'volunteer') {
      queryText += ' AND t.volunteer_id = $2';
      params.push(user.id);
    } else if (role === 'coordinator') {
      queryText += ' AND t.assigned_by = $2';
      params.push(user.id);
    }

    queryText += ' ORDER BY t.completed_at DESC NULLS LAST, t.created_at DESC LIMIT 300';

    const result = await db.query(queryText, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing task history:', err);
    res.status(500).json({ message: 'Failed to list task history' });
  }
}

async function updateTaskStatus(req, res) {
  try {
    const { id } = req.params;
    const { status, persons_helped, proof_images } = req.body;
    const currentUser = req.dbUser || (await ensureUserInDb(req.auth?.userId));
    const role = req.role || currentUser.role || 'volunteer';

    const task = await loadTask(id);
    if (!task) return res.status(404).json({ message: 'Task not found' });

    // Allow acceptance if it's currently unassigned and status is pending
    if (status === 'accepted' && !task.volunteer_id && task.status === 'pending' && role === 'volunteer') {
      // Validate volunteer can accept this task

      // 1. Check volunteer has required skills for task type
      const volunteerSkills = await db.query(
        'SELECT skills FROM volunteers WHERE user_id = $1',
        [currentUser.id]
      );
      const skills = volunteerSkills.rows[0]?.skills || [];

      // Define required skills for critical task types
      const criticalTaskTypes = ['medical', 'rescue', 'fire', 'evacuation'];
      if (criticalTaskTypes.includes(task.type) && !skills.includes(task.type)) {
        return res.status(403).json({
          message: `This ${task.type} task requires specific training. Please contact a coordinator.`,
          required_training: task.type,
          your_skills: skills
        });
      }

      // 2. Check volunteer is within reasonable distance (50km max)
      if (task.meeting_point) {
        const volunteerLocation = await db.query(
          'SELECT current_location FROM users WHERE id = $1',
          [currentUser.id]
        );

        if (volunteerLocation.rows[0]?.current_location) {
          const distanceResult = await db.query(
            `SELECT ST_Distance(
              $1::geography,
              $2::geography
            ) / 1000 as distance_km`,
            [volunteerLocation.rows[0].current_location, task.meeting_point]
          );

          const distanceKm = distanceResult.rows[0]?.distance_km;
          const MAX_ACCEPTANCE_DISTANCE_KM = 50;

          if (distanceKm > MAX_ACCEPTANCE_DISTANCE_KM) {
            return res.status(403).json({
              message: `You are too far from this task location (${Math.round(distanceKm)}km away). Maximum distance is ${MAX_ACCEPTANCE_DISTANCE_KM}km.`,
              distance_km: Math.round(distanceKm),
              max_distance_km: MAX_ACCEPTANCE_DISTANCE_KM
            });
          }
        }
      }

      // 3. Check volunteer isn't already overloaded (max 3 active tasks)
      const activeTaskCount = await db.query(
        `SELECT COUNT(*) as count FROM tasks 
         WHERE volunteer_id = $1 AND status IN ('pending', 'accepted', 'in_progress')`,
        [currentUser.id]
      );

      const MAX_ACTIVE_TASKS = 3;
      if (parseInt(activeTaskCount.rows[0].count) >= MAX_ACTIVE_TASKS) {
        return res.status(403).json({
          message: `You have reached the maximum of ${MAX_ACTIVE_TASKS} active tasks. Complete existing tasks before accepting new ones.`,
          active_tasks: parseInt(activeTaskCount.rows[0].count),
          max_tasks: MAX_ACTIVE_TASKS
        });
      }

    } else if (role === 'volunteer' && task.volunteer_id !== currentUser.id) {
      return res.status(403).json({ message: 'Volunteers can update only their own tasks' });
    }

    const updateFields = [];
    const values = [];
    let idx = 1;

    if (status) {
      updateFields.push(`status = $${idx++}`);
      values.push(status);
    }
    if (persons_helped !== undefined) {
      updateFields.push(`persons_helped = $${idx++}`);
      values.push(persons_helped);
    }
    if (proof_images) {
      updateFields.push(`proof_images = $${idx++}`);
      values.push(proof_images);
    }

    // Require proof images from volunteers when completing a task
    if (status === 'completed' && role === 'volunteer') {
      if (!proof_images || !Array.isArray(proof_images) || proof_images.length === 0) {
        return res.status(400).json({
          message: 'Proof images are required to mark a task as completed. Upload at least one photo as evidence.',
          code: 'PROOF_REQUIRED',
        });
      }
    }

    if (status === 'completed') {
      updateFields.push('completed_at = NOW()');
    } else if (status === 'in_progress') {
      updateFields.push('check_in_time = NOW()');
    } else if (status === 'accepted') {
      updateFields.push('completed_at = NULL');
      if (!task.volunteer_id) {
        updateFields.push(`volunteer_id = $${idx++}`);
        values.push(currentUser.id);
      }
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ message: 'Nothing to update' });
    }

    values.push(id);

    const result = await db.query(
      `UPDATE tasks SET ${updateFields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    const updatedTask = result.rows[0];

    // If task is completed and has a linked SOS, notify but DO NOT auto-resolve
    // SOS resolution requires coordinator approval or proof (handled in sosController)
    if (status === 'completed' && updatedTask.sos_id) {
      // Only update SOS to 'in_progress' if it's still triggered, never auto-resolve
      await db.query(
        `UPDATE sos_alerts 
         SET status = CASE 
           WHEN status = 'triggered' THEN 'acknowledged'
           ELSE status 
         END,
         acknowledged_by = CASE 
           WHEN acknowledged_by IS NULL THEN $2 
           ELSE acknowledged_by 
         END,
         acknowledged_at = CASE 
           WHEN acknowledged_at IS NULL THEN NOW() 
           ELSE acknowledged_at 
         END
         WHERE id = $1`,
        [updatedTask.sos_id, currentUser.id]
      );

      // Emit notification that task is complete but SOS needs manual resolution
      const io = req.app.get('io');
      if (io) {
        io.emit('task_completed_sos_pending', {
          task_id: updatedTask.id,
          sos_id: updatedTask.sos_id,
          message: 'Task completed. SOS requires coordinator review for resolution.'
        });
      }
    }

    res.json(updatedTask);
  } catch (err) {
    console.error('Error updating task:', err);
    res.status(500).json({ message: 'Failed to update task' });
  }
}

// POST /api/v1/tasks/:id/vote-completion
async function voteTaskCompletion(req, res) {
  try {
    const { id } = req.params;
    const { vote, note } = req.body || {};

    if (!['completed', 'rejected'].includes(vote)) {
      return res.status(400).json({ message: 'vote must be completed or rejected' });
    }

    const currentUser = req.dbUser || (await ensureUserInDb(req.auth?.userId));
    const role = req.role || currentUser.role || 'volunteer';
    if (!['volunteer', 'coordinator', 'admin'].includes(role)) {
      return res.status(403).json({ message: 'Not allowed to vote on completion' });
    }

    const task = await loadTask(id);
    if (!task) return res.status(404).json({ message: 'Task not found' });

    // Prevent volunteers from voting on their own tasks
    if (task.volunteer_id === currentUser.id) {
      return res.status(403).json({
        message: 'You cannot vote on completion of your own task. Other volunteers or coordinators must verify your work.'
      });
    }

    // Prevent voting on tasks that aren't in 'completed' status awaiting verification
    if (task.status !== 'completed' && vote === 'completed') {
      return res.status(400).json({
        message: 'Can only vote to confirm completion on tasks marked as completed by the volunteer',
        current_status: task.status
      });
    }

    await ensureVoteTable();

    await db.query(
      `INSERT INTO task_completion_votes (task_id, voter_id, vote, note, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (task_id, voter_id)
       DO UPDATE SET vote = EXCLUDED.vote, note = EXCLUDED.note, updated_at = NOW()`,
      [id, currentUser.id, vote, note || null]
    );

    const voteStats = await db.query(
      `SELECT
         COUNT(*)::int AS total_votes,
         COUNT(*) FILTER (WHERE vote = 'completed')::int AS completed_votes,
         COUNT(*) FILTER (WHERE vote = 'rejected')::int AS rejected_votes
       FROM task_completion_votes
       WHERE task_id = $1`,
      [id]
    );

    const requiredVotes = await getRequiredVotes(task);
    const completedVotes = voteStats.rows[0]?.completed_votes || 0;
    const rejectedVotes = voteStats.rows[0]?.rejected_votes || 0;

    let taskUpdate = task;
    if (vote === 'rejected' || rejectedVotes > 0) {
      const update = await db.query(
        `UPDATE tasks
         SET status = 'accepted', completed_at = NULL
         WHERE id = $1
         RETURNING *`,
        [id]
      );
      taskUpdate = update.rows[0] || task;
    } else if (completedVotes >= requiredVotes) {
      const update = await db.query(
        `UPDATE tasks
         SET status = 'completed', completed_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [id]
      );
      taskUpdate = update.rows[0] || task;
    }

    res.json({
      message: 'Vote recorded',
      task: taskUpdate,
      summary: {
        required_votes: requiredVotes,
        total_votes: voteStats.rows[0]?.total_votes || 0,
        completed_votes: completedVotes,
        rejected_votes: rejectedVotes,
        auto_completed: completedVotes >= requiredVotes,
      },
    });
  } catch (err) {
    console.error('Error voting task completion:', err);
    res.status(500).json({ message: 'Failed to record completion vote', detail: err.message });
  }
}

// GET /api/v1/tasks/:id/votes
async function getTaskVotes(req, res) {
  try {
    const { id } = req.params;
    await ensureVoteTable();

    const votes = await db.query(
      `SELECT v.id, v.vote, v.note, v.created_at, v.updated_at,
              u.id AS voter_id, u.full_name AS voter_name, u.role AS voter_role
       FROM task_completion_votes v
       JOIN users u ON u.id = v.voter_id
       WHERE v.task_id = $1
       ORDER BY v.updated_at DESC`,
      [id]
    );

    const summary = await db.query(
      `SELECT
         COUNT(*)::int AS total_votes,
         COUNT(*) FILTER (WHERE vote = 'completed')::int AS completed_votes,
         COUNT(*) FILTER (WHERE vote = 'rejected')::int AS rejected_votes
       FROM task_completion_votes
       WHERE task_id = $1`,
      [id]
    );

    res.json({
      votes: votes.rows,
      summary: summary.rows[0] || {
        total_votes: 0,
        completed_votes: 0,
        rejected_votes: 0,
      },
    });
  } catch (err) {
    console.error('Error fetching task votes:', err);
    res.status(500).json({ message: 'Failed to fetch task votes' });
  }
}

// GET /api/v1/tasks/escalated
async function listEscalatedTasks(req, res) {
  try {
    const { zone, coordinator } = req.query || {};
    const delayThresholdMinutes = 30;
    const params = [delayThresholdMinutes];
    let idx = 2;

    let where = `
      WHERE t.status IN ('pending', 'accepted', 'in_progress')
        AND EXTRACT(EPOCH FROM (NOW() - t.created_at)) / 60 > $1
    `;

    if (zone) {
      where += ` AND (CAST(t.zone_id AS text) = $${idx} OR z.name ILIKE $${idx + 1})`;
      params.push(zone, `%${zone}%`);
      idx += 2;
    }

    if (coordinator) {
      where += ` AND (CAST(t.assigned_by AS text) = $${idx} OR c.full_name ILIKE $${idx + 1})`;
      params.push(coordinator, `%${coordinator}%`);
      idx += 2;
    }

    const result = await db.query(
      `SELECT
         t.id AS task_id,
         t.status,
         t.created_at AS assigned_at,
         z.id AS zone_id,
         z.name AS zone_name,
         t.volunteer_id,
         u.full_name AS volunteer_name,
         t.assigned_by AS coordinator_id,
         c.full_name AS coordinator_name,
         FLOOR(EXTRACT(EPOCH FROM (NOW() - t.created_at)) / 60)::int AS delay_minutes,
         CASE
           WHEN t.status = 'pending' THEN 'Task pending beyond SLA'
           WHEN t.status = 'accepted' THEN 'Accepted but not started'
           WHEN t.status = 'in_progress' THEN 'Long-running task'
           ELSE 'SLA breach'
         END AS escalation_reason
       FROM tasks t
       LEFT JOIN zones z ON z.id = t.zone_id
       LEFT JOIN users u ON u.id = t.volunteer_id
       LEFT JOIN users c ON c.id = t.assigned_by
       ${where}
       ORDER BY delay_minutes DESC, t.created_at ASC
       LIMIT 500`,
      params
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error listing escalated tasks:', err);
    res.status(500).json({ message: 'Failed to list escalated tasks' });
  }
}

// POST /api/v1/admin/workflows/reassign-tasks
async function reassignTasksFromInactiveCoordinator(req, res) {
  try {
    const { inactiveCoordinatorId, targetCoordinatorId } = req.body || {};
    if (!inactiveCoordinatorId || !targetCoordinatorId) {
      return res
        .status(400)
        .json({ message: 'inactiveCoordinatorId and targetCoordinatorId are required' });
    }
    if (inactiveCoordinatorId === targetCoordinatorId) {
      return res
        .status(400)
        .json({ message: 'inactiveCoordinatorId and targetCoordinatorId must be different' });
    }

    const taskUpdate = await db.query(
      `UPDATE tasks
       SET assigned_by = $2
       WHERE assigned_by = $1
         AND status IN ('pending', 'accepted', 'in_progress')
       RETURNING id`,
      [inactiveCoordinatorId, targetCoordinatorId]
    );

    const zoneUpdate = await db.query(
      `UPDATE zones
       SET assigned_coordinator_id = $2
       WHERE assigned_coordinator_id = $1
       RETURNING id`,
      [inactiveCoordinatorId, targetCoordinatorId]
    );

    res.json({
      message: 'Tasks reassigned successfully',
      reassigned_tasks_count: taskUpdate.rows.length,
      reassigned_zones_count: zoneUpdate.rows.length,
    });
  } catch (err) {
    console.error('Error reassigning tasks:', err);
    res.status(500).json({ message: 'Failed to reassign tasks' });
  }
}

async function requestHelp(req, res) {
  try {
    const { id } = req.params;
    const { note, type } = req.body;
    const currentUser = req.dbUser || (await ensureUserInDb(req.auth?.userId));

    const task = await loadTask(id);
    if (!task) return res.status(404).json({ message: 'Task not found' });

    // Create a "Need" linked to this task to request more help
    const result = await db.query(
      `INSERT INTO needs (request_code, reporter_name, reporter_phone, type, description, disaster_id, zone_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'unassigned')
       RETURNING *`,
      [
        `HELP-${id.substring(0, 4)}-${Date.now().toString().slice(-4)}`,
        currentUser.full_name,
        currentUser.phone || '0000000000',
        type || 'volunteer',
        `Assistance requested for task "${task.title}": ${note || 'More hands needed'}`,
        task.disaster_id,
        task.zone_id,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error requesting help:', err);
    res.status(500).json({ message: 'Failed to request help' });
  }
}

module.exports = {
  createTask,
  listEscalatedTasks,
  listPendingTasks,
  listTaskHistory,
  updateTaskStatus,
  voteTaskCompletion,
  getTaskVotes,
  reassignTasksFromInactiveCoordinator,
  requestHelp,
};
