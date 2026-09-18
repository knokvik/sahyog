require('dotenv').config();
const db = require('./config/db');

async function seedSOS() {
    try {
        // get a random user to be the volunteer
        const userRes = await db.query("SELECT id FROM users LIMIT 1");
        const volunteerId = userRes.rows[0]?.id || null;

        // get a random disaster
        const disRes = await db.query("SELECT id FROM disasters LIMIT 1");
        const disasterId = disRes.rows[0]?.id || null;

        const query = `
      INSERT INTO sos_alerts (volunteer_id, disaster_id, status, location)
      VALUES ($1, $2, 'triggered', ST_SetSRID(ST_MakePoint(72.880, 19.080), 4326))
      RETURNING id, status, ST_X(location) as lng, ST_Y(location) as lat;
    `;
        const res = await db.query(query, [volunteerId, disasterId]);
        console.log('Seeded SOS:', res.rows[0]);
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

seedSOS();
