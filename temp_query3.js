require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://postgres:sahyog876737@db.kzxjhjkauvsoipvlusjo.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false }
});
async function run() {
  const res = await pool.query(`
    SELECT table_name, column_name, data_type 
    FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name IN ('org_request_contributions', 'org_request_assignments')
  `);
  console.log(JSON.stringify(res.rows, null, 2));
  process.exit(0);
}
run();
