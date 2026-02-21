require('dotenv').config();
const db = require('./config/db');

async function migrate() {
    try {
        console.log("Starting DB migration for zone_id...");

        // Add zone_id to disaster_coordinator_assignments
        await db.query(`
            ALTER TABLE disaster_coordinator_assignments 
            ADD COLUMN IF NOT EXISTS zone_id uuid REFERENCES zones(id) ON DELETE CASCADE;
        `);

        // Add zone_id to volunteer_disaster_assignments
        await db.query(`
            ALTER TABLE volunteer_disaster_assignments 
            ADD COLUMN IF NOT EXISTS zone_id uuid REFERENCES zones(id) ON DELETE CASCADE;
        `);

        // Also we want to wipe the current assignments to not have orphans with null zone_ids
        await db.query(`DELETE FROM volunteer_disaster_assignments;`);
        await db.query(`DELETE FROM disaster_coordinator_assignments;`);

        console.log("Migration successful!");
        process.exit(0);
    } catch (err) {
        console.error("Migration failed:", err);
        process.exit(1);
    }
}
migrate();
