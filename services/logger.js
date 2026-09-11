const db = require('../config/db');

/**
 * Logs an activity to the activity_logs table.
 * @param {Object} params
 * @param {string} params.action_type - e.g., 'INFO', 'WARNING', 'SUCCESS', 'DANGER'
 * @param {string} params.entity_type - e.g., 'ZONE', 'AGENT', 'ORGANIZATION', 'SYSTEM'
 * @param {string} params.entity_id - UUID (optional)
 * @param {string} params.description - Human readable description
 * @param {string} params.organization_id - UUID (optional)
 * @param {string} params.user_id - UUID (optional)
 * @param {Object} params.metadata - JSON object (optional)
 */
async function logActivity({ action_type, entity_type, entity_id, description, organization_id, user_id, metadata }) {
    try {
        await db.query(`
            INSERT INTO activity_logs (
                action_type, entity_type, entity_id, description, organization_id, user_id, metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
            action_type || 'INFO',
            entity_type || 'SYSTEM',
            entity_id || null,
            description,
            organization_id || null,
            user_id || null,
            metadata ? JSON.stringify(metadata) : null
        ]);
    } catch (err) {
        console.error('[Logger] Failed to log activity:', err.message);
    }
}

module.exports = {
    logActivity
};
