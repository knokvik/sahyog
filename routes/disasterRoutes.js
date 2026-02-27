const express = require('express');
const verifyToken = require('../middleware/authMiddleware');
const checkRole = require('../middleware/roleMiddleware');
const { validators } = require('../utils/validate');
const disasterController = require('../controllers/disasterController');
const drController = require('../controllers/disasterRequestController');

const router = express.Router();

// Admin-only creation and lifecycle
router.post('/', verifyToken, checkRole('admin'), validators.createDisaster, disasterController.createDisaster);
router.patch('/:id', verifyToken, checkRole('admin'), validators.uuidParam, disasterController.updateDisaster);
router.post('/:id/activate', verifyToken, checkRole('admin'), validators.uuidParam, disasterController.activateDisaster);
router.post('/:id/resolve', verifyToken, checkRole('admin'), validators.uuidParam, disasterController.resolveDisaster);

// Read endpoints
router.get('/', verifyToken, checkRole(), disasterController.listDisasters);
router.get('/:id', verifyToken, checkRole(), validators.uuidParam, disasterController.getDisasterById);
router.get('/:id/report', verifyToken, checkRole(), validators.uuidParam, disasterController.getDisasterReport);
router.get('/:id/stats', verifyToken, checkRole('admin'), validators.uuidParam, disasterController.getDisasterStats);
router.get('/:id/tasks', verifyToken, checkRole('admin'), validators.uuidParam, disasterController.getDisasterTasks);

// Relief coordination — zones
// Relief coordination — zones
router.post('/:id/relief-zones', verifyToken, checkRole('admin'), drController.createZone);
router.get('/:id/relief-zones', verifyToken, drController.listZones);
router.delete('/:id/relief-zones/:zoneId', verifyToken, checkRole('admin'), drController.deleteZone);

// Relief coordination — resource requests
router.post('/:id/requests', verifyToken, checkRole('admin'), drController.createRequest);
router.get('/:id/requests', verifyToken, checkRole('admin'), drController.listRequests);

module.exports = router;
