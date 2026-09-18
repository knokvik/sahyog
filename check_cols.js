require('dotenv').config();
const db = require('./config/db');
async function check() {
    try {
        const res = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'disaster_coordinator_assignments'`);
        console.log("disaster_coordinator_assignments columns:", res.rows.map(r => r.column_name));

        const res2 = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'volunteer_disaster_assignments'`);
        console.log("volunteer_disaster_assignments columns:", res2.rows.map(r => r.column_name));
    } catch (e) {
        console.log(e);
    } finally {
        process.exit();
    }
}
check();
