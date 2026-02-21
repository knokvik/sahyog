require('dotenv').config();
const db = require('./config/db');

async function seedVolunteerLocations() {
    try {
        // Pune coordinates roughly: 18.5204, 73.8567
        const coordinates = [
            { lng: 73.8550, lat: 18.5210 }, // Vol 1
            { lng: 73.8600, lat: 18.5180 }, // Vol 2
            { lng: 73.8500, lat: 18.5150 }  // Vol 3
        ];

        const vols = await db.query(`SELECT id FROM users WHERE role = 'volunteer' AND email LIKE 'testvol%' ORDER BY created_at DESC LIMIT 3`);

        if (vols.rows.length < 3) {
            console.log('Not enough test volunteers found. Found:', vols.rows.length);
            process.exit(1);
        }

        for (let i = 0; i < 3; i++) {
            const volId = vols.rows[i].id;
            const { lng, lat } = coordinates[i];
            await db.query(`
        UPDATE users 
        SET current_location = ST_SetSRID(ST_MakePoint($1, $2), 4326)
        WHERE id = $3
      `, [lng, lat, volId]);
            console.log(`Updated vol \${volId} with \${lat}, \${lng}`);
        }

        console.log('Volunteer locations seeded successfully.');
        process.exit(0);
    } catch (err) {
        console.error('Seeding failed:', err);
        process.exit(1);
    }
}

seedVolunteerLocations();
