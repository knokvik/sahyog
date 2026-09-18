const express = require('express');
const twilioController = require('../controllers/twilioController');

const router = express.Router();

// Twilio IVR Webhook
// This endpoint is called by the Twilio Studio Flow HTTP widget
router.post('/ivr', twilioController.handleIvr);

module.exports = router;
