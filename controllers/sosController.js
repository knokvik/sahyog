const db = require('../config/db');
const { ensureUserInDb } = require('../utils/userSync');
const { calculatePriority } = require('../utils/priority');

// POST /api/v1/sos
async function createSos(req, res) {
  try {
    const { userId } = req.auth || {};
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const user = await ensureUserInDb(userId);
    const io = req.app.get('io');
    const orchestrator = require('../services/orchestrator.service');

    // Map mediaUrls array to photo_url if exists
    let photoUrl = null;
    if (req.body.mediaUrls && req.body.mediaUrls.length > 0) {
      photoUrl = req.body.mediaUrls[0];
    }

    const packet = {
      ...req.body,
      photo_url: photoUrl,
      reporter_id: user.id,
      clerk_reporter_id: user.clerk_user_id,
      reporter_name: user.full_name,
      reporter_phone: user.phone
    };

    const result = await orchestrator.validateAndTriage(packet, io);

    // The flutter app's offline sync engine expects `res.json({ id: 'uuid' })` to mark it synced
    res.status(201).json({
      id: result.sos_id,
      ...result
    });
  } catch (err) {
    console.error('Error creating SOS via orchestrator:', err.message, err.stack);
    res.status(500).json({ message: 'Failed to create SOS', detail: err.message });
  }
}

// GET /api/v1/sos
async function listSos(req, res) {
  try {
    const role = req.role || 'volunteer';
    const dbUser = req.dbUser;

    if (!dbUser) return res.status(401).json({ message: 'Unauthorized' });

    let queryText = `
      SELECT s.*,
             ST_X(s.location::geometry) AS lng, ST_Y(s.location::geometry) AS lat,
             ack.full_name AS volunteer_name,
             rep.phone AS reporter_phone,
             rep.full_name AS reporter_name,
             d.name      AS disaster_name
      FROM sos_alerts s
      LEFT JOIN users rep   ON rep.id = s.reporter_id
      LEFT JOIN users ack   ON ack.id = s.acknowledged_by
      LEFT JOIN disasters d ON d.id = s.disaster_id`;

    // Global broadcast: Everyone sees every SOS.
    let params = [];

    // Only fetch active, non-cancelled/non-resolved ones by default for the map
    queryText += ` WHERE s.status NOT IN ('cancelled', 'resolved') ORDER BY s.created_at DESC LIMIT 100`;

    const result = await db.query(queryText, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing SOS:', err);
    res.status(500).json({ message: 'Failed to list SOS alerts' });
  }
}

// GET /api/v1/sos/:id
async function getSosById(req, res) {
  try {
    const { id } = req.params;
    const result = await db.query('SELECT * FROM sos_alerts WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'SOS alert not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching SOS:', err);
    res.status(500).json({ message: 'Failed to fetch SOS alert' });
  }
}

// PATCH /api/v1/sos/:id/status
async function updateSosStatus(req, res) {
  try {
    const { id } = req.params;
    const { status, resolution_proof, resolution_notes, assigned_volunteer_id } = req.body;
    const { userId } = req.auth || {};
    const role = req.role || 'user';

    const validStatuses = ['triggered', 'acknowledged', 'resolved', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: `Invalid status. Allowed: ${validStatuses.join(', ')}` });
    }

    // Check if user has permission to update this SOS
    const sosResult = await db.query(
      `SELECT s.*, u.clerk_user_id as acknowledged_by_clerk_id
       FROM sos_alerts s
       LEFT JOIN users u ON s.acknowledged_by = u.id
       WHERE s.id = $1`,
      [id]
    );

    if (sosResult.rows.length === 0) {
      return res.status(404).json({ message: 'SOS alert not found' });
    }

    const sos = sosResult.rows[0];
    const isReporter = sos.clerk_reporter_id === userId;
    const isAcknowledgedByMe = sos.acknowledged_by_clerk_id === userId;
    const isAdminOrHead = ['admin', 'coordinator'].includes(role);

    // STRICT AUTHORIZATION RULES:

    // 1. RESOLVED status requires coordinator/admin OR proof from acknowledged responder
    if (status === 'resolved') {
      if (isAdminOrHead) {
        // Admins/coordinators can resolve with optional proof
      } else if (isAcknowledgedByMe) {
        // The responder who acknowledged can resolve BUT needs proof
        if (!resolution_proof || resolution_proof.length === 0) {
          return res.status(403).json({
            message: 'Resolution requires photo/video proof. Upload proof and try again.'
          });
        }
      } else {
        return res.status(403).json({
          message: 'Only coordinators, admins, or the assigned responder can resolve an SOS'
        });
      }
    }

    // 2. Anyone (volunteers included) can acknowledge an unassigned SOS
    if (status === 'acknowledged' && !isAdminOrHead) {
      if (sos.acknowledged_by && !isAcknowledgedByMe) {
        return res.status(403).json({ message: 'SOS is already being handled by another responder' });
      }
    }

    // 3. Reporters can only cancel their own reports
    if (status === 'cancelled') {
      if (!isReporter && !isAdminOrHead) {
        return res.status(403).json({ message: 'Only the reporter or admins can cancel an SOS' });
      }
    }

    // 4. General permission check for other status changes
    if (!isReporter && !isAcknowledgedByMe && !isAdminOrHead) {
      if (status !== 'acknowledged') {
        return res.status(403).json({ message: 'You do not have permission to update this SOS alert' });
      }
    }

    // 5. Reporters cannot change status except to cancel
    if (isReporter && !isAcknowledgedByMe && !isAdminOrHead && status !== 'cancelled') {
      return res.status(403).json({ message: 'You can only cancel your own SOS reports' });
    }

    const result = await db.query(
      `UPDATE sos_alerts
       SET status = $1::varchar,
           resolved_at = CASE WHEN $1::varchar = 'resolved' THEN NOW() ELSE resolved_at END,
           acknowledged_by = CASE WHEN $1::varchar = 'acknowledged' AND acknowledged_by IS NULL THEN (SELECT id FROM users WHERE clerk_user_id = $2) ELSE acknowledged_by END,
           acknowledged_at = CASE WHEN $1::varchar = 'acknowledged' AND acknowledged_at IS NULL THEN NOW() ELSE acknowledged_at END,
           resolution_proof = CASE WHEN $1::varchar = 'resolved' THEN $4 ELSE resolution_proof END,
           resolution_notes = CASE WHEN $1::varchar = 'resolved' THEN $5 ELSE resolution_notes END,
           assigned_volunteer_id = CASE WHEN $6::uuid IS NOT NULL THEN $6::uuid ELSE assigned_volunteer_id END
       WHERE id = $3
       RETURNING *`,
      [status, userId, id, resolution_proof || null, resolution_notes || null, assigned_volunteer_id || null]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating SOS status:', err);
    res.status(500).json({ message: 'Failed to update SOS status' });
  }
}

// GET /api/v1/sos/nearby?lat=&lng=&radiusMeters=
async function getNearbySos(req, res) {
  try {
    const { lat, lng, radiusMeters } = req.query;
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    const radius = parseInt(radiusMeters || '10000', 10);

    if (Number.isNaN(latNum) || Number.isNaN(lngNum)) {
      return res.status(400).json({ message: 'lat and lng query params are required numbers' });
    }

    const result = await db.query(
      `SELECT *,
              ST_Distance(
                location::geometry,
                ST_SetSRID(ST_MakePoint($1, $2), 4326)
              ) AS distance
       FROM sos_alerts
       WHERE ST_DWithin(
         location::geometry,
         ST_SetSRID(ST_MakePoint($1, $2), 4326),
         $3
       )
       ORDER BY priority_score DESC NULLS LAST, distance ASC
       LIMIT 100`,
      [lngNum, latNum, radius]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching nearby SOS:', err);
    res.status(500).json({ message: 'Failed to fetch nearby SOS alerts' });
  }
}

// GET /api/v1/sos/:id/tasks
async function getTasksForSos(req, res) {
  try {
    const { id } = req.params;
    const result = await db.query(
      `SELECT t.*, u.full_name as volunteer_name, u.avatar_url as volunteer_avatar
       FROM tasks t
       JOIN users u ON t.volunteer_id = u.id
       WHERE t.sos_id = $1
       ORDER BY t.created_at ASC`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching tasks for SOS:', err);
    res.status(500).json({ message: 'Failed to fetch tasks for SOS report' });
  }
}

// PUT /api/v1/sos/:id/cancel
async function cancelSos(req, res) {
  try {
    const { id } = req.params;
    const { userId } = req.auth || {};

    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    // Verify ownership
    const sosResult = await db.query(
      `SELECT clerk_reporter_id FROM sos_alerts WHERE id = $1`,
      [id]
    );

    if (sosResult.rows.length === 0) {
      return res.status(404).json({ message: 'SOS alert not found' });
    }

    const sos = sosResult.rows[0];
    const isAdminOrHead = ['admin', 'coordinator'].includes(req.role);

    // Only the reporter or an admin can outright cancel an SOS
    if (sos.clerk_reporter_id !== userId && !isAdminOrHead) {
      return res.status(403).json({ message: 'You can only cancel your own SOS alerts' });
    }

    const cancelResult = await db.query(
      `UPDATE sos_alerts
       SET status = 'cancelled', resolved_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    const updatedAlert = cancelResult.rows[0];

    // Emit resolution event
    const io = req.app.get('io');
    if (io) {
      io.emit('sos_resolved', { id: updatedAlert.id });
    }

    res.json(updatedAlert);
  } catch (err) {
    console.error('Error cancelling SOS:', err);
    res.status(500).json({ message: 'Failed to cancel SOS' });
  }
}

// DELETE /api/v1/sos/:id
async function deleteSos(req, res) {
  try {
    const { id } = req.params;
    const role = req.role || 'user';

    if (role !== 'admin' && role !== 'coordinator') {
      return res.status(403).json({ message: 'Only admins or coordinators can delete SOS alerts' });
    }

    const result = await db.query('DELETE FROM sos_alerts WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'SOS alert not found' });
    }

    // Emit event so UI can sync
    const io = req.app.get('io');
    if (io) {
      io.emit('sos_resolved', { id: id }); // Use resolved event to clear blips/counts
    }

    res.json({ message: 'SOS alert deleted successfully', deleted: result.rows[0] });
  } catch (err) {
    console.error('Error deleting SOS:', err);
    res.status(500).json({ message: 'Failed to delete SOS alert' });
  }
}

module.exports = {
  createSos,
  listSos,
  getSosById,
  updateSosStatus,
  getNearbySos,
  getTasksForSos,
  cancelSos,
  deleteSos,
};
