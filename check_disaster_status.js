require('dotenv').config();
const db = require('./config/db');

async function check() {
    try {
        const res = await db.query(`SELECT id, name, status FROM disasters`);
        console.log("Disasters:", res.rows);
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
}
check();
