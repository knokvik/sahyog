const db = require('../config/db');

// POST /api/v1/tasks
async function createTask(req, res) {
  try {
    const { sosId, volunteerId, instructions } = req.body;
    if (!sosId || !volunteerId) {
      return res.status(400).json({ message: 'sosId and volunteerId are required' });
    }

    const { userId } = req.auth || {};
    const assigner = await db.query('SELECT id FROM users WHERE clerk_user_id = $1', [userId]);
    const assignedById = assigner.rows[0]?.id || null;

    const result = await db.query(
      `INSERT INTO tasks (sos_id, volunteer_id, assigned_by, status, instructions, created_at)
       VALUES ($1, $2, $3, 'assigned', $4, NOW())
       RETURNING *`,
      [sosId, volunteerId, assignedById, instructions || null]
    );

    await db.query('UPDATE sos_reports SET assigned_volunteer_id = $1 WHERE id = $2', [volunteerId, sosId]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating task:', err);
    res.status(500).json({ message: 'Failed to create task' });
  }
}

// GET /api/v1/tasks/:id
async function getTaskById(req, res) {
  try {
    const { id } = req.params;
    const result = await db.query('SELECT * FROM tasks WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Task not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching task:', err);
    res.status(500).json({ message: 'Failed to fetch task' });
  }
}

// Helper for status transitions
async function updateTaskStatus(id, status, extra = {}) {
  const fields = ['status'];
  const values = [status];

  if (status === 'in_progress') {
    fields.push('started_at');
    values.push(new Date());
  } else if (status === 'completed') {
    fields.push('completed_at');
    values.push(new Date());
    if (extra.proofImages) {
      fields.push('proof_images');
      values.push(extra.proofImages);
    }
  }

  const setClause = fields
    .map((field, idx) => `${field} = $${idx + 2}`)
    .join(', ');

  const result = await db.query(
    `UPDATE tasks
     SET ${setClause}
     WHERE id = $1
     RETURNING *`,
    [id, ...values]
  );

  return result.rows[0] || null;
}

// PATCH /api/v1/tasks/:id/accept
async function acceptTask(req, res) {
  try {
    const { id } = req.params;
    const task = await updateTaskStatus(id, 'accepted');
    if (!task) return res.status(404).json({ message: 'Task not found' });
    res.json(task);
  } catch (err) {
    console.error('Error accepting task:', err);
    res.status(500).json({ message: 'Failed to accept task' });
  }
}

// PATCH /api/v1/tasks/:id/start
async function startTask(req, res) {
  try {
    const { id } = req.params;
    const task = await updateTaskStatus(id, 'in_progress');
    if (!task) return res.status(404).json({ message: 'Task not found' });
    res.json(task);
  } catch (err) {
    console.error('Error starting task:', err);
    res.status(500).json({ message: 'Failed to start task' });
  }
}

// PATCH /api/v1/tasks/:id/complete
async function completeTask(req, res) {
  try {
    const { id } = req.params;
    const { proofImages } = req.body;
    const task = await updateTaskStatus(id, 'completed', { proofImages: proofImages || [] });
    if (!task) return res.status(404).json({ message: 'Task not found' });
    res.json(task);
  } catch (err) {
    console.error('Error completing task:', err);
    res.status(500).json({ message: 'Failed to complete task' });
  }
}

// GET /api/v1/tasks/pending
async function listPendingTasks(req, res) {
  try {
    const result = await db.query(
      `SELECT t.*
       FROM tasks t
       WHERE t.status IN ('assigned', 'accepted', 'in_progress')
       ORDER BY t.created_at ASC
       LIMIT 100`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing pending tasks:', err);
    res.status(500).json({ message: 'Failed to list pending tasks' });
  }
}

module.exports = {
  createTask,
  getTaskById,
  acceptTask,
  startTask,
  completeTask,
  listPendingTasks,
};

