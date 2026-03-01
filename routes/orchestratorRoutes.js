const express = require('express');
const orchestrator = require('../services/orchestrator.service');

const router = express.Router();

/**
 * POST /api/v1/orchestrator/validate
 * Unified intake for all distress signals across all channels.
 */
router.post('/validate', async (req, res) => {
    try {
        const io = req.app.get('io');
        const result = await orchestrator.validateAndTriage(req.body, io);

        res.status(201).json({
            success: true,
            ...result,
        });
    } catch (err) {
        console.error('[Orchestrator Route] Validate error:', err.message, err.stack);
        res.status(500).json({
            success: false,
            message: 'Orchestration failed',
            detail: err.message,
        });
    }
});

/**
 * GET /api/v1/orchestrator/status/:id
 * Escalation status for a specific SOS.
 */
router.get('/status/:id', async (req, res) => {
    try {
        const status = await orchestrator.getEscalationStatus(req.params.id);
        if (!status) {
            return res.status(404).json({ message: 'SOS not found' });
        }
        res.json(status);
    } catch (err) {
        console.error('[Orchestrator Route] Status error:', err.message);
        res.status(500).json({ message: 'Failed to get status', detail: err.message });
    }
});

/**
 * GET /api/v1/orchestrator/summary
 * NDMA-style aggregate: total active, severity distribution, source distribution.
 */
router.get('/summary', async (req, res) => {
    try {
        const summary = await orchestrator.getOrchestratorSummary();
        res.json(summary);
    } catch (err) {
        console.error('[Orchestrator Route] Summary error:', err.message);
        res.status(500).json({ message: 'Failed to get summary', detail: err.message });
    }
});

module.exports = router;
