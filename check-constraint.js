
require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

async function checkConstraint() {
    await client.connect();

    // Query to get the check constraint definition
    const res = await client.query(`
    select pg_get_constraintdef(oid) 
    from pg_constraint 
    where conname = 'users_role_check';
  `);

    if (res.rows.length > 0) {
        console.log('Constraint Definition:', res.rows[0].pg_get_constraintdef);
    } else {
        console.log('Constraint not found');
    }

    await client.end();
}

checkConstraint().catch(console.error);
