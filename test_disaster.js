require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

async function testInsert() {
    await client.connect();
    try {
        const result = await client.query(
            `INSERT INTO disasters (name, type, severity, affected_area, status, activated_at, created_by, clerk_created_by)
       VALUES (
         $1,
         $2,
         $3,
         CASE WHEN $4::text IS NOT NULL THEN ST_GeomFromGeoJSON($4::text)::geography ELSE NULL END,
         'active',
         NOW(),
         $5,
         $6
       )
       RETURNING *`,
            ['Test Disaster', 'flood', 7, null, null, 'user_dummy']
        );
        console.log('Success:', result.rows[0]);
    } catch (err) {
        console.error('SQL Error:', err.message);
    } finally {
        await client.end();
    }
}

testInsert();
