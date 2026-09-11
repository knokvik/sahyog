require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://postgres:sahyog876737@db.kzxjhjkauvsoipvlusjo.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function list() {
  const res = await pool.query(`
    SELECT table_name, column_name, data_type 
    FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name IN ('disaster_requests', 'disaster_request_items', 'org_request_assignments')
  `);
  console.log(JSON.stringify(res.rows, null, 2));
  process.exit(0);
}
list();
