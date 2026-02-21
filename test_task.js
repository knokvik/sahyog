require('dotenv').config();
const db = require('./config/db');

async function testInsert() {
    try {
        const adminRes = await db.query("SELECT id FROM users LIMIT 1");
        const adminId = adminRes.rows[0].id;

        const volRes = await db.query("SELECT id FROM users WHERE role='volunteer' LIMIT 1");
        const volId = volRes.rows[0].id;

        const sosRes = await db.query("SELECT id FROM sos_alerts LIMIT 1");
        const sosId = sosRes.rows[0].id;

        console.log({ adminId, volId, sosId });

        const result = await db.query(
            `INSERT INTO tasks (need_id, disaster_id, zone_id, volunteer_id, assigned_by, type, title, description, meeting_point, sos_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $9::text IS NOT NULL THEN ST_GeomFromText($9::text, 4326) ELSE NULL END, $10)
       RETURNING *`,
            [null, null, null, volId, adminId, 'sos_response', 'Respond to SOS Alert', 'Test desc', null, sosId]
        );
        console.log('Success:', result.rows[0]);
    } catch (err) {
        console.error('Failed:', err);
    } finally {
        process.exit(0);
    }
}
testInsert();
