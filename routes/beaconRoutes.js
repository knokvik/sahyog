const express = require('express');
const orchestrator = require('../services/orchestrator.service');

const router = express.Router();

/**
 * POST /api/v1/beacon/relay
 * 
 * Accepts LoRa ResQ Beacon packets from gateway hardware.
 * Transforms the beacon signal into the unified orchestrator format.
 *
 * Body: { device_id, lat, lng, signal_type, battery_pct, payload }
 */
router.post('/relay', async (req, res) => {
    try {
        const {
            device_id,
            lat,
            lng,
            signal_type = 'sos',
            battery_pct,
            payload,
        } = req.body;

        if (!device_id) {
            return res.status(400).json({ message: 'device_id is required' });
        }

        console.log(`[Beacon] Signal from ${device_id}: ${signal_type} at ${lat},${lng} (battery: ${battery_pct}%)`);

        // Map beacon signal types to SOS types
        const typeMap = {
            sos: 'Emergency',
            medical: 'Medical',
            fire: 'Fire',
            flood: 'Flood',
            earthquake: 'Earthquake',
            security: 'Security',
        };

        // Transform beacon packet into orchestrator format
        const orchestratorPacket = {
            lat: parseFloat(lat) || 0,
            lng: parseFloat(lng) || 0,
            type: typeMap[signal_type] || 'Emergency',
            description: `ResQ Beacon alert from device ${device_id}. Signal: ${signal_type}. Battery: ${battery_pct || '?'}%. ${payload || ''}`,
            source: 'beacon',
            client_uuid: `beacon-${device_id}-${Date.now()}`,
            reporter_name: `Beacon ${device_id}`,
            tflite_score: signal_type === 'sos' ? 0.7 : 0.5,
        };

        const io = req.app.get('io');
        const result = await orchestrator.validateAndTriage(orchestratorPacket, io);

        res.status(201).json({
            success: true,
            device_id,
            ...result,
        });
    } catch (err) {
        console.error('[Beacon Route] Relay error:', err.message, err.stack);
        res.status(500).json({
            success: false,
            message: 'Beacon relay failed',
            detail: err.message,
        });
    }
});

module.exports = router;
