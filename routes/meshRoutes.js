const express = require('express');
const db = require('../config/db');
const { ensureUserInDb } = require('../utils/userSync');
const { calculatePriority } = require('../utils/priority');

const router = express.Router();

/**
 * POST /api/v1/mesh/sync
 *
 * Accepts a batch of SOS packets relayed through the Bluetooth mesh network.
 * Each packet is UPSERTed into sos_alerts with relayed_via_mesh = true.
 *
 * Body: { packets: [ { uuid, type, lat, lng, description, reporter_name, reporter_phone, family_contacts, source, hop_count } ] }
 */
router.post('/sync', async (req, res) => {
    try {
        const { packets } = req.body;
        if (!Array.isArray(packets) || packets.length === 0) {
            return res.status(400).json({ message: 'packets array is required' });
        }

        const io = req.app.get('io');
        const synced = [];
        const errors = [];

        for (const pkt of packets) {
            try {
                const {
                    uuid,
                    type,
                    lat: rawLat,
                    lng: rawLng,
                    description,
                    reporter_name,
                    reporter_phone,
                    family_contacts,
                    source = 'mesh_relay',
                    hop_count = 1,
                } = pkt;

                if (!uuid) {
                    errors.push({ uuid, error: 'Missing uuid' });
                    continue;
                }

                const lat = typeof rawLat === 'number' ? rawLat : parseFloat(rawLat);
                const lng = typeof rawLng === 'number' ? rawLng : parseFloat(rawLng);

                if (isNaN(lat) || isNaN(lng)) {
                    errors.push({ uuid, error: 'Invalid lat/lng' });
                    continue;
                }

                const now = new Date();
                const priority = calculatePriority({
                    type,
                    createdAt: now,
                });

                // Ensure family_contacts is valid JSON
                let familyContactsJson = null;
                if (family_contacts) {
                    familyContactsJson = typeof family_contacts === 'string'
                        ? family_contacts
                        : JSON.stringify(family_contacts);
                }

                const result = await db.query(
                    `INSERT INTO sos_alerts
           (reporter_id, clerk_reporter_id, location, type, description, priority_score, status,
            media_urls, created_at, client_uuid, source, hop_count, relayed_via_mesh, family_contacts)
           VALUES (
             $1, $2,
             ST_SetSRID(ST_MakePoint($3, $4), 4326),
             $5, $6, $7, 'triggered',
             $8, $9, $10, $11, $12, true,
             $13::jsonb
           )
           ON CONFLICT (client_uuid) DO UPDATE SET
             location = ST_SetSRID(ST_MakePoint($3, $4), 4326),
             type = COALESCE(EXCLUDED.type, sos_alerts.type),
             description = COALESCE(EXCLUDED.description, sos_alerts.description),
             priority_score = EXCLUDED.priority_score,
             source = EXCLUDED.source,
             hop_count = LEAST(EXCLUDED.hop_count, sos_alerts.hop_count),
             relayed_via_mesh = true,
             family_contacts = COALESCE(EXCLUDED.family_contacts, sos_alerts.family_contacts)
           RETURNING *`,
                    [
                        reporter_name || 'Mesh Relay User',    // $1: reporter_id (text name for mesh)
                        null,                                    // $2: clerk_reporter_id (null for mesh)
                        lng,                                     // $3
                        lat,                                     // $4
                        type || 'Emergency',                     // $5
                        description || 'SOS relayed via mesh',   // $6
                        priority,                                // $7
                        [],                                      // $8: media_urls
                        now,                                     // $9
                        uuid,                                    // $10: client_uuid
                        source,                                  // $11
                        parseInt(hop_count) || 1,                // $12
                        familyContactsJson || '[]',              // $13
                    ]
                );

                const emittedAlert = result.rows[0];
                synced.push({ uuid, id: emittedAlert.id });

                // Emit real-time socket event
                if (io) {
                    io.emit('new_sos_alert', {
                        id: emittedAlert.id,
                        reporter_name: reporter_name || 'Unknown (Mesh)',
                        reporter_phone: reporter_phone || null,
                        type: emittedAlert.type,
                        status: emittedAlert.status,
                        lat,
                        lng,
                        location: emittedAlert.location,
                        priority: emittedAlert.priority_score,
                        created_at: emittedAlert.created_at,
                        relayed_via_mesh: true,
                        family_contacts: emittedAlert.family_contacts,
                    });
                }
            } catch (err) {
                errors.push({ uuid: pkt.uuid, error: err.message });
            }
        }

        res.status(200).json({
            synced: synced.length,
            errors,
            details: synced,
        });
    } catch (err) {
        console.error('Mesh sync error:', err.message, err.stack);
        res.status(500).json({ message: 'Mesh sync failed', detail: err.message });
    }
});

module.exports = router;
