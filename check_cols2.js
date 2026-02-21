require('dotenv').config();
const db = require('./config/db');
async function check() {
    try {
        const res = await db.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'zones'`);
        console.log("zones:", res.rows);
    } catch (e) {
        console.log(e);
    } finally {
        process.exit();
    }
}
check();
