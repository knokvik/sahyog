const express = require('express');
const verifyToken = require('../middleware/authMiddleware');
const checkRole = require('../middleware/roleMiddleware');
const { validators } = require('../utils/validate');
const sosController = require('../controllers/sosController');

const router = express.Router();

// Any authenticated user can create SOS
router.post('/', verifyToken, checkRole(), validators.createSos, sosController.createSos);

// Role-filtered listing handled inside controller
router.get('/', verifyToken, checkRole(), sosController.listSos);

router.get('/nearby', verifyToken, checkRole(), validators.nearbySos, sosController.getNearbySos);

router.get('/:id', verifyToken, checkRole(), validators.uuidParam, sosController.getSosById);
router.get('/:id/tasks', verifyToken, checkRole(), validators.uuidParam, sosController.getTasksForSos);

// Status changes - authorization checked in controller
router.patch('/:id/status', verifyToken, checkRole(), validators.updateSosStatus, sosController.updateSosStatus);
router.put('/:id/cancel', verifyToken, sosController.cancelSos);
router.delete('/:id', verifyToken, checkRole(), sosController.deleteSos);

module.exports = router;

