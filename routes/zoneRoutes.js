const express = require('express');
const verifyToken = require('../middleware/authMiddleware');
const checkRole = require('../middleware/roleMiddleware');
const zoneController = require('../controllers/zoneController');

const router = express.Router();

// Allow primary coordinator to edit their zone
router.patch('/:id', verifyToken, checkRole('coordinator'), zoneController.updateZone);

router.post('/', verifyToken, checkRole('admin'), zoneController.createZone);
router.get('/summary', verifyToken, checkRole(), zoneController.getZonesSummary);
router.get('/geojson', verifyToken, checkRole(), zoneController.getZonesGeoJson);
router.get('/', verifyToken, checkRole(), zoneController.listZones);
router.patch('/:id/coordinator', verifyToken, checkRole('admin'), zoneController.assignCoordinator);

module.exports = router;
