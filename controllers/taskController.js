const db = require('../config/db');
const { ensureUserInDb } = require('../utils/userSync');

async function createTask(req, res) {
  try {
    const { need_id, disaster_id, zone_id, volunteer_id, type, title, description, meeting_point } = req.body;

    if (!type || !title) return res.status(400).json({ message: 'Missing required fields' });

    const { userId } = req.auth || {};
    const adminUser = await ensureUserInDb(userId);

    const locString = meeting_point ? `POINT(${meeting_point.lng} ${meeting_point.lat})` : null;

    const result = await db.query(
      `INSERT INTO tasks (need_id, disaster_id, zone_id, volunteer_id, assigned_by, type, title, description, meeting_point)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $9::text IS NOT NULL THEN ST_GeogFromText($9::text)::geography ELSE NULL END)
       RETURNING *`,
      [need_id || null, disaster_id || null, zone_id || null, volunteer_id || null, adminUser.id, type, title, description || null, locString]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating task:', err);
    res.status(500).json({ message: 'Failed to create task: ' + err.message });
  }
}

async function listPendingTasks(req, res) {
  try {
    const { userId } = req.auth || {};
    const user = await ensureUserInDb(userId);

    const result = await db.query(
      `SELECT t.*, n.request_code as need_code, n.location as need_location 
       FROM tasks t 
       LEFT JOIN needs n ON t.need_id = n.id
       WHERE t.volunteer_id = $1 AND t.status = 'pending'
       ORDER BY t.created_at DESC`,
      [user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing tasks:', err);
    res.status(500).json({ message: 'Failed to list tasks' });
  }
}

async function updateTaskStatus(req, res) {
  try {
    const { id } = req.params;
    const { status, persons_helped, proof_images } = req.body;

    let updateFields = [];
    let values = [];
    let idx = 1;

    if (status) { updateFields.push(`status = $${idx++}`); values.push(status); }
    if (persons_helped !== undefined) { updateFields.push(`persons_helped = $${idx++}`); values.push(persons_helped); }
    if (proof_images) { updateFields.push(`proof_images = $${idx++}`); values.push(proof_images); }

    if (status === 'completed') {
      updateFields.push(`completed_at = NOW()`);
    } else if (status === 'in_progress') {
      updateFields.push(`check_in_time = NOW()`);
    }

    if (updateFields.length === 0) return res.status(400).json({ message: 'Nothing to update' });

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

module.exports = { createTask, listPendingTasks, updateTaskStatus };
