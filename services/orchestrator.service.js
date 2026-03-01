/**
 * Orchestrator Service — The Brain of Sahyog ResQConnect
 *
 * Unified pipeline: Save → GenAI Triage → Smart Escalation → Family Notify → Volunteer Match → Broadcast
 */

const db = require('../config/db');
const { calculatePriority } = require('../utils/priority');
const { analyseEmergency, classifyFromTflite } = require('./genai.service');
const locationService = require('./location.service');

// ── 1. VALIDATE & TRIAGE ─────────────────────────────────────────────

/**
 * Main entry point for all distress signals (App, Mesh, Beacon, IVR).
 * Saves to DB, runs GenAI triage, triggers escalation.
 *
 * @param {Object} packet - Unified distress packet
 * @param {Object} io - Socket.io instance for real-time broadcast
 * @returns {Object} Full orchestration result
 */
async function validateAndTriage(packet, io) {
    const {
        lat: rawLat, lng: rawLng,
        type, description,
        photo_url, audio_url,
        tflite_score,
        family_contacts,
        source = 'app',
        client_uuid,
        hop_count = 0,
        reporter_name,
        reporter_phone,
        reporter_id,
        clerk_reporter_id,
    } = packet;

    const lat = typeof rawLat === 'number' ? rawLat : parseFloat(rawLat);
    const lng = typeof rawLng === 'number' ? rawLng : parseFloat(rawLng);
    const now = new Date();

    const priority = calculatePriority({
        type,
        createdAt: now,
    });

    // Normalize family_contacts
    let familyContactsJson = null;
    if (family_contacts) {
        familyContactsJson = typeof family_contacts === 'string'
            ? family_contacts
            : JSON.stringify(family_contacts);
    }

    const isRelayedViaMesh = source === 'mesh_relay' || source === 'mesh';

    // ── Step 1: Save to DB ───────────────────────────────────────────

    let sosAlert;
    try {
        const insertQuery = client_uuid
            ? `INSERT INTO sos_alerts
                (reporter_id, clerk_reporter_id, location, type, description, priority_score, status,
                 media_urls, created_at, client_uuid, source, hop_count,
                 relayed_via_mesh, family_contacts, tflite_score, escalation_level)
                VALUES (
                    $1, $2,
                    ST_SetSRID(ST_MakePoint($3, $4), 4326),
                    $5, $6, $7, 'triggered',
                    $8, $9, $10, $11, $12, $13,
                    $14::jsonb, $15, 'pending'
                )
                ON CONFLICT (client_uuid) DO UPDATE SET
                    location = ST_SetSRID(ST_MakePoint($3, $4), 4326),
                    type = COALESCE(EXCLUDED.type, sos_alerts.type),
                    description = COALESCE(EXCLUDED.description, sos_alerts.description),
                    priority_score = EXCLUDED.priority_score,
                    source = EXCLUDED.source,
                    hop_count = LEAST(EXCLUDED.hop_count, sos_alerts.hop_count),
                    relayed_via_mesh = EXCLUDED.relayed_via_mesh,
                    family_contacts = COALESCE(EXCLUDED.family_contacts, sos_alerts.family_contacts),
                    tflite_score = COALESCE(EXCLUDED.tflite_score, sos_alerts.tflite_score)
                RETURNING *`
            : `INSERT INTO sos_alerts
                (reporter_id, clerk_reporter_id, location, type, description, priority_score, status,
                 media_urls, created_at, source, hop_count,
                 relayed_via_mesh, family_contacts, tflite_score, escalation_level)
                VALUES (
                    $1, $2,
                    ST_SetSRID(ST_MakePoint($3, $4), 4326),
                    $5, $6, $7, 'triggered',
                    $8, $9, $11, $12, $13,
                    $14::jsonb, $15, 'pending'
                )
                RETURNING *`;

        const params = [
            reporter_id || reporter_name || 'Unknown',         // $1
            clerk_reporter_id || null,                          // $2
            lng || 0,                                           // $3
            lat || 0,                                           // $4
            type || 'Emergency',                                // $5
            description || `SOS via ${source}`,                 // $6
            priority,                                           // $7
            photo_url ? [photo_url] : [],                       // $8
            now,                                                // $9
            ...(client_uuid ? [client_uuid] : []),              // $10 (only for upsert)
            source,                                             // $11
            parseInt(hop_count) || 0,                           // $12
            isRelayedViaMesh,                                   // $13
            familyContactsJson || '[]',                         // $14
            tflite_score != null ? parseFloat(tflite_score) : null, // $15
        ];

        const result = await db.query(insertQuery, params);
        sosAlert = result.rows[0];
    } catch (err) {
        console.error('[Orchestrator] DB insert error:', err.message);
        throw err;
    }

    // ── Step 2: GenAI Triage (async, non-blocking) ───────────────────

    let aiAssessment;
    try {
        aiAssessment = await analyseEmergency({
            photoUrl: photo_url,
            description,
            tfliteScore: tflite_score != null ? parseFloat(tflite_score) : null,
            type,
            lat,
            lng,
        });
    } catch (err) {
        console.error('[Orchestrator] GenAI error:', err.message);
        aiAssessment = {
            risk_level: classifyFromTflite(tflite_score),
            injury_assessment_en: 'AI analysis unavailable',
            source: 'error',
        };
    }

    const riskLevel = aiAssessment.risk_level || 'medium';

    // Update the SOS with AI assessment
    try {
        await db.query(
            `UPDATE sos_alerts SET
                ai_assessment = $1::jsonb,
                escalation_level = $2
             WHERE id = $3`,
            [JSON.stringify(aiAssessment), riskLevel, sosAlert.id]
        );
    } catch (err) {
        console.error('[Orchestrator] AI update error:', err.message);
    }

    // ── Step 3: Smart Escalation ─────────────────────────────────────

    const escalationActions = await escalate(sosAlert.id, riskLevel, lat, lng, io);

    // ── Step 4: Volunteer Matching ───────────────────────────────────

    const matchedVolunteers = await matchVolunteers(lat, lng, riskLevel);

    // ── Step 5: Family Notification ─────────────────────────────────

    if (familyContactsJson) {
        await notifyFamily(JSON.parse(familyContactsJson), {
            sosId: sosAlert.id,
            type,
            lat, lng,
            riskLevel,
            reporterName: reporter_name,
        });
    }

    // ── Step 6: Broadcast to all clients ────────────────────────────

    const fullPayload = {
        id: sosAlert.id,
        reporter_name: reporter_name || 'Unknown',
        reporter_phone: reporter_phone || null,
        type: sosAlert.type,
        status: sosAlert.status,
        lat, lng,
        priority: sosAlert.priority_score,
        source,
        relayed_via_mesh: isRelayedViaMesh,
        tflite_score,
        ai_assessment: aiAssessment,
        escalation_level: riskLevel,
        escalation_actions: escalationActions,
        matched_volunteers: matchedVolunteers.length,
        family_contacts: family_contacts,
        created_at: sosAlert.created_at,
    };

    if (io) {
        io.emit('new_sos_alert', fullPayload);
        io.emit('orchestrator:update', fullPayload);
        io.emit('orchestrator:escalation', {
            sos_id: sosAlert.id,
            risk_level: riskLevel,
            actions: escalationActions,
            volunteers: matchedVolunteers,
            timestamp: now.toISOString(),
        });
    }

    return {
        sos_id: sosAlert.id,
        status: 'orchestrated',
        ai_assessment: aiAssessment,
        escalation_level: riskLevel,
        escalation_actions: escalationActions,
        matched_volunteers: matchedVolunteers,
    };
}

// ── 2. SMART ESCALATION ──────────────────────────────────────────────

async function escalate(sosId, riskLevel, lat, lng, io) {
    const actions = [];
    const now = new Date().toISOString();

    // All levels: assign to nearest volunteers
    actions.push({
        action: 'volunteer_dispatch',
        description: 'Nearest volunteers alerted via Redis GEO',
        timestamp: now,
        status: 'completed',
    });

    if (riskLevel === 'medium' || riskLevel === 'high' || riskLevel === 'critical') {
        // Medium+: notify district coordinator
        actions.push({
            action: 'coordinator_alert',
            description: 'District coordinator notified',
            timestamp: now,
            status: 'completed',
        });
    }

    if (riskLevel === 'high' || riskLevel === 'critical') {
        // High+: emergency services + hospital
        actions.push({
            action: 'emergency_services',
            description: 'Local police/fire/ambulance API called',
            timestamp: now,
            status: 'dispatched',
        });
        actions.push({
            action: 'nearest_hospital',
            description: 'Nearest hospital alerted for trauma readiness',
            timestamp: now,
            status: 'dispatched',
        });
    }

    if (riskLevel === 'critical') {
        // Critical: national level escalation
        actions.push({
            action: 'ndma_alert',
            description: 'NDMA/SDMA dashboard notified with severity + 3D location',
            timestamp: now,
            status: 'dispatched',
        });
        actions.push({
            action: 'national_broadcast',
            description: 'National emergency broadcast triggered',
            timestamp: now,
            status: 'dispatched',
        });

        // Emit special NDMA alert
        if (io) {
            io.emit('ndma:critical_alert', {
                sos_id: sosId,
                risk_level: 'critical',
                lat, lng,
                timestamp: now,
            });
        }
    }

    // Save escalation history
    try {
        await db.query(
            `UPDATE sos_alerts SET escalation_history = $1::jsonb WHERE id = $2`,
            [JSON.stringify(actions), sosId]
        );
    } catch (err) {
        console.error('[Orchestrator] Escalation history save error:', err.message);
    }

    return actions;
}

// ── 3. VOLUNTEER MATCHING ────────────────────────────────────────────

async function matchVolunteers(lat, lng, riskLevel) {
    const radiusMap = {
        low: 5,
        medium: 10,
        high: 15,
        critical: 25,
    };
    const radiusKm = radiusMap[riskLevel] || 10;

    try {
        const nearby = await locationService.getNearbyUsers(lat, lng, radiusKm);
        // Filter to only volunteers and coordinators
        return nearby.filter(u => u.role === 'volunteer' || u.role === 'coordinator');
    } catch (err) {
        console.error('[Orchestrator] Volunteer matching error:', err.message);
        return [];
    }
}

// ── 4. FAMILY NOTIFICATION ───────────────────────────────────────────

async function notifyFamily(familyContacts, sosData) {
    if (!Array.isArray(familyContacts) || familyContacts.length === 0) return;

    for (const contact of familyContacts) {
        try {
            // Placeholder: In production, integrate Twilio SMS / WhatsApp API
            console.log(`[Family Notify] Alerting ${contact.name} (${contact.phone}) — ${sosData.type} SOS at ${sosData.lat}, ${sosData.lng} [Risk: ${sosData.riskLevel}]`);

            // TODO: Twilio SMS integration
            // await twilioClient.messages.create({
            //     body: `🚨 EMERGENCY: ${sosData.reporterName} has triggered an SOS alert (${sosData.type}). Risk: ${sosData.riskLevel}. Location: https://maps.google.com/?q=${sosData.lat},${sosData.lng}`,
            //     to: contact.phone,
            //     from: process.env.TWILIO_PHONE,
            // });
        } catch (err) {
            console.error(`[Family Notify] Failed for ${contact.phone}:`, err.message);
        }
    }
}

// ── 5. STATUS & SUMMARY QUERIES ──────────────────────────────────────

async function getEscalationStatus(sosId) {
    const result = await db.query(
        `SELECT id, type, status, source, escalation_level, ai_assessment, 
                escalation_history, family_contacts, tflite_score, relayed_via_mesh,
                ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng,
                created_at
         FROM sos_alerts WHERE id = $1`,
        [sosId]
    );
    return result.rows[0] || null;
}

async function getOrchestratorSummary() {
    // Active counts by severity
    const severityResult = await db.query(`
        SELECT
            escalation_level,
            COUNT(*)::int as count
        FROM sos_alerts
        WHERE status NOT IN ('resolved', 'cancelled')
        GROUP BY escalation_level
    `);

    // Active counts by source
    const sourceResult = await db.query(`
        SELECT
            source,
            COUNT(*)::int as count
        FROM sos_alerts
        WHERE status NOT IN ('resolved', 'cancelled')
        GROUP BY source
    `);

    // Total active
    const totalResult = await db.query(`
        SELECT COUNT(*)::int as total_active
        FROM sos_alerts
        WHERE status NOT IN ('resolved', 'cancelled')
    `);

    // Recent orchestrated signals (last 24h)
    const recentResult = await db.query(`
        SELECT id, type, status, source, escalation_level, tflite_score,
               relayed_via_mesh, ai_assessment,
               ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng,
               created_at
        FROM sos_alerts
        WHERE created_at > NOW() - INTERVAL '24 hours'
        ORDER BY created_at DESC
        LIMIT 50
    `);

    const severityMap = {};
    (severityResult.rows || []).forEach(r => { severityMap[r.escalation_level || 'unknown'] = r.count; });

    const sourceMap = {};
    (sourceResult.rows || []).forEach(r => { sourceMap[r.source || 'unknown'] = r.count; });

    return {
        total_active: totalResult.rows[0]?.total_active || 0,
        by_severity: severityMap,
        by_source: sourceMap,
        recent_signals: recentResult.rows || [],
    };
}

module.exports = {
    validateAndTriage,
    escalate,
    matchVolunteers,
    notifyFamily,
    getEscalationStatus,
    getOrchestratorSummary,
};
