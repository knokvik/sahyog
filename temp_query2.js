require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://postgres:sahyog876737@db.kzxjhjkauvsoipvlusjo.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false }
});
async function run() {
  const res = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
  console.log(JSON.stringify(res.rows, null, 2));
  process.exit(0);
}
run();
