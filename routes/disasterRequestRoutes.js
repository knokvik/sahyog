const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/authMiddleware');
const checkRole = require('../middleware/roleMiddleware');
const {
    createZone,
    listZones,
    deleteZone,
    createRequest,
    listRequests,
} = require('../controllers/disasterRequestController');

// Zone management (admin)
router.post('/:id/zones', verifyToken, checkRole('admin'), createZone);
router.get('/:id/zones', verifyToken, checkRole(), listZones);
router.delete('/:id/zones/:zoneId', verifyToken, checkRole('admin'), deleteZone);

// Resource requests (admin)
router.post('/:id/requests', verifyToken, checkRole('admin'), createRequest);
router.get('/:id/requests', verifyToken, checkRole('admin'), listRequests);

module.exports = router;
