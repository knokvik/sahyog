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
      // Allow this through - we will update volunteer_id as well
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

    res.json(result.rows[0]);
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
  listPendingTasks,
  listTaskHistory,
  updateTaskStatus,
  voteTaskCompletion,
  getTaskVotes,
  requestHelp,
};
