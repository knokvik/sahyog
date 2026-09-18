require('dotenv').config();
const db = require('./config/db');

async function main() {
  // Check all FK constraints on zones
  const r = await db.query(`
    SELECT tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = 'zones'
  `);
  console.log('=== Tables referencing zones ===');
  r.rows.forEach(x => console.log(`  ${x.table_name}.${x.column_name}`));

  // Also check FK on disasters
  const r2 = await db.query(`
    SELECT tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = 'disasters'
  `);
  console.log('\n=== Tables referencing disasters ===');
  r2.rows.forEach(x => console.log(`  ${x.table_name}.${x.column_name}`));

  process.exit(0);
}
main();
