require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://postgres:sahyog876737@db.kzxjhjkauvsoipvlusjo.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function runMigration() {
  console.log("Adding ai_allocation_preference to organizations...");
  try {
    await pool.query(`
      ALTER TABLE organizations 
      ADD COLUMN IF NOT EXISTS ai_allocation_preference VARCHAR(20) DEFAULT 'full'
    `);
    console.log("Migration successful.");
  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    process.exit(0);
  }
}
runMigration();
