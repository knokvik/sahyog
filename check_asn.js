require('dotenv').config();
const db = require('./config/db');
async function check() {
    try {
        const res = await db.query(`
            SELECT ora.id, ora.status, ora.request_id, r.disaster_id
            FROM org_request_assignments ora
            JOIN disaster_requests r ON ora.request_id = r.id
        `);
        console.log("Assignments:");
        console.log(res.rows);

        const coords = await db.query(`SELECT id, full_name, role FROM users WHERE role='coordinator'`);
        console.log("Coordinators:");
        console.log(coords.rows);
    } catch (e) {
        console.log(e);
    } finally {
        process.exit();
    }
}
check();
