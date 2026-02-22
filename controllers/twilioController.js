const db = require('../config/db');
const { calculatePriority } = require('../utils/priority');

/**
 * Handles Twilio IVR Webhook from Studio
 * POST /api/v1/twilio/ivr
 * 
 * Expected Twilio body parameters:
 * - From: The caller's phone number
 * - Digits: The key pressed by the user (from Gather widget)
 */
async function handleIvr(req, res) {
    try {
        // Extract parameters from request body
        // Using user's custom parameters (caller, emergency_type) or Twilio defaults (From, Digits)
        const From = req.body.caller || req.body.From;
        const Digits = req.body.emergency_type || req.body.Digits;
        const City = req.body.FromCity || 'Unknown City';
        const State = req.body.FromState || 'Unknown State';

        console.log(`[Twilio Webhook] Call from ${From} (${City}, ${State}), Digits: ${Digits}`);

        if (!From) {
            return res.status(400).json({ message: 'Missing "caller" or "From" parameter' });
        }

        // 1. Map IVR input to SOS type
        // 1 -> Medical help
        // 2 -> Rescue
        // 3 -> Other/Security
        let type = 'general';
        if (Digits === '1') type = 'medical';
        else if (Digits === '2') type = 'rescue';
        else if (Digits === '3') type = 'security';

        const description = `IVR Report: User pressed ${Digits} (${type} help). Caller Location (Est): ${City}, ${State}`;

        // 2. Find or create a user by phone number
        // For IVR users not in Clerk, we use a pseudo clerk_user_id
        const pseudoClerkId = `ivr:${From}`;

        let userResult = await db.query('SELECT * FROM users WHERE phone = $1 OR clerk_user_id = $2', [From, pseudoClerkId]);
        let user;

        if (userResult.rows.length === 0) {
            // Create a placeholder user
            const insertUser = await db.query(
                `INSERT INTO users (clerk_user_id, phone, full_name, role, is_active)
         VALUES ($1, $2, $3, 'user', true)
         RETURNING *`,
                [pseudoClerkId, From, `IVR Caller (${From})`]
            );
            user = insertUser.rows[0];
        } else {
            user = userResult.rows[0];
        }

        // 3. Determine location
        // Since IVR doesn't give GPS, we use the user's last known location or default to (0,0)
        // In a real scenario, we might use Twilio caller's city/state if available
        let lng = 0;
        let lat = 0;

        // If user has a location in DB, use it
        const locationResult = await db.query(
            `SELECT ST_X(current_location::geometry) as lng, ST_Y(current_location::geometry) as lat 
       FROM users WHERE id = $1 AND current_location IS NOT NULL`,
            [user.id]
        );

        if (locationResult.rows.length > 0) {
            lng = locationResult.rows[0].lng;
            lat = locationResult.rows[0].lat;
        }

        // 4. Calculate Priority
        const now = new Date();
        const priority = calculatePriority({
            type,
            peopleCount: 1,
            hasVulnerable: false,
            createdAt: now,
        });

        // 5. Create the SOS alert
        const sosResult = await db.query(
            `INSERT INTO sos_alerts
       (reporter_id, clerk_reporter_id, location, type, description, priority_score, status, source, created_at)
       VALUES (
         $1,
         $2,
         ST_SetSRID(ST_MakePoint($3, $4), 4326),
         $5,
         $6,
         $7,
         'triggered',
         'ivr',
         $8
       )
       RETURNING *`,
            [
                user.id,
                user.clerk_user_id,
                lng,
                lat,
                type,
                description,
                priority,
                now,
            ]
        );

        const emittedAlert = sosResult.rows[0];

        // 6. Emit real-time socket event
        const io = req.app.get('io');
        if (io) {
            io.emit('new_sos_alert', {
                id: emittedAlert.id,
                reporter_name: user.full_name,
                reporter_phone: user.phone,
                type: emittedAlert.type,
                status: emittedAlert.status,
                lat,
                lng,
                location: emittedAlert.location,
                priority: emittedAlert.priority_score,
                created_at: emittedAlert.created_at,
            });
        }

        console.log(`[Twilio Webhook] SOS created: ${emittedAlert.id} for ${From}`);

        // Twilio Studio Sucess/Fail depends on HTTP status 200
        res.status(200).json({
            success: true,
            sos_id: emittedAlert.id,
            message: 'SOS alert triggered via IVR'
        });

    } catch (err) {
        console.error('Error handling Twilio IVR:', err.message, err.stack);
        // Return 500 to Twilio so the flow can go to Fail path
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
}

module.exports = {
    handleIvr,
};
