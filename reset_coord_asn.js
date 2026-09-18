require('dotenv').config();
const db = require('./config/db');

async function reset() {
    try {
        await db.query(`DELETE FROM volunteer_disaster_assignments`);
        await db.query(`DELETE FROM disaster_coordinator_assignments`);
        console.log("Successfully wiped all coordinator assignments for a fresh test!");
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
reset();
