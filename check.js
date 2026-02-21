require('dotenv').config();
const db = require('./config/db');
async function check() {
    try {
        const res = await db.query(`
            SELECT table_name, column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name IN ('org_request_assignments', 'disaster_requests', 'disaster_coordinator_assignments')
        `);
        console.log(res.rows);
    } catch (e) {
        console.log(e);
    } finally {
        process.exit();
    }
}
check();
