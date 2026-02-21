require('dotenv').config();
const db = require('./config/db');

async function seed() {
    try {
        const orgs = await db.query('SELECT id FROM organizations LIMIT 1');
        if (orgs.rows.length === 0) {
            console.log('No orgs found');
            process.exit(0);
        }
        const orgId = orgs.rows[0].id;

        await db.query(`
            INSERT INTO users (clerk_user_id, email, full_name, role, organization_id)
            VALUES 
            ('dummy_coord_1', 'coord1@org.com', 'Coordinator One', 'coordinator', $1),
            ('dummy_coord_2', 'coord2@org.com', 'Coordinator Two', 'coordinator', $1)
            ON CONFLICT (clerk_user_id) DO NOTHING
        `, [orgId]);

        console.log('Inserted 2 dummy coordinators for org:', orgId);
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
seed();
