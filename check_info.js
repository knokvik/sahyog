require('dotenv').config();
const db = require('./config/db');
async function check() {
    try {
        const res = await db.query(`SELECT tablename FROM pg_tables WHERE schemaname='public'`);
        console.log(res.rows.map(r => r.tablename));
    } catch (e) {
        console.log(e);
    } finally {
        process.exit();
    }
}
check();
