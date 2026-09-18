require('dotenv').config();
const db = require('./config/db');

async function main() {
  try {
    const result = await db.query('SELECT id, name, email FROM organizations ORDER BY id');
    console.log('\n=== All Organizations ===');
    result.rows.forEach((row, i) => {
      console.log(`${i + 1}. ID: ${row.id} | Name: ${row.name} | Email: ${row.email}`);
    });
    console.log(`\nTotal: ${result.rows.length} organizations`);
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    process.exit(0);
  }
}

main();
