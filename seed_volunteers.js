require('dotenv').config();
const db = require('./config/db');

async function seedVolunteers() {
    try {
        for (let i = 1; i <= 3; i++) {
            await db.query(`
            INSERT INTO users (clerk_user_id, full_name, email, role, is_active)
            VALUES ($1, $2, $3, 'volunteer', true)
        `, [`dummy_clerk_vol_${Date.now()}_${i}`, `Test Volunteer ${i}`, `testvol${Date.now()}${i}@example.com`]);
        }
        console.log('Seeded 3 new volunteers successfully.');
        process.exit(0);
    } catch (err) {
        console.error('Failed to seed:', err);
        process.exit(1);
    }
}

seedVolunteers();
