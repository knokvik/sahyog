require('dotenv').config();
const db = require('./config/db');
async function check() {
    try {
        const res = await db.query(`SELECT a.* FROM disaster_coordinator_assignments a`);
        console.log("Coordinator assignments:");
        console.log(res.rows);
    } catch (e) {
        console.log(e);
    } finally {
        process.exit();
    }
}
check();
