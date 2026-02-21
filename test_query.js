require('dotenv').config();
const db = require('./config/db');

async function run() {
    try {
        const res = await db.query('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 5');
        console.log(res.rows);
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}
run();
