require('dotenv').config();
const db = require('./config/db');

async function run() {
    try {
        await db.query('ALTER TABLE tasks ADD COLUMN sos_id uuid REFERENCES sos_alerts(id) ON DELETE CASCADE;');
        console.log('Added sos_id to tasks');
        process.exit(0);
    } catch (err) {
        if (err.code === '42701') {
            console.log('Column sos_id already exists');
            process.exit(0);
        }
        console.error(err);
        process.exit(1);
    }
}
run();
