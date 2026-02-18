const express = require('express');
const verifyToken = require('../middleware/authMiddleware');
const checkRole = require('../middleware/roleMiddleware');
const disasterController = require('../controllers/disasterController');

const router = express.Router();

// Admin-only creation and lifecycle
router.post('/', verifyToken, checkRole('org:admin'), disasterController.createDisaster);
router.patch('/:id', verifyToken, checkRole('org:admin'), disasterController.updateDisaster);
router.post('/:id/activate', verifyToken, checkRole('org:admin'), disasterController.activateDisaster);
router.post('/:id/resolve', verifyToken, checkRole('org:admin'), disasterController.resolveDisaster);

// Read endpoints (admin / heads / volunteers can be enforced inside controller if needed)
router.get('/', verifyToken, checkRole(), disasterController.listDisasters);
router.get('/:id', verifyToken, checkRole(), disasterController.getDisasterById);
router.get('/:id/stats', verifyToken, checkRole('org:admin'), disasterController.getDisasterStats);

module.exports = router;

