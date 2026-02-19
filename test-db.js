require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }, // For Supabase
});

async function testConnection() {
    console.log('Testing connection to:', process.env.DATABASE_URL.replace(/:[^:]*@/, ':****@')); // Hide password
    try {
        const client = await pool.connect();
        console.log('✅ Connected successfully!');
        const res = await client.query('SELECT NOW() as now');
        console.log('Server time:', res.rows[0].now);
        client.release();
        process.exit(0);
    } catch (err) {
        console.error('❌ Connection failed:', err.message);
        process.exit(1);
    }
}

testConnection();
