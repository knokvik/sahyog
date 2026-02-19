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

// Status changes - authorization checked in controller
router.patch('/:id/status', verifyToken, checkRole(), validators.updateSosStatus, sosController.updateSosStatus);

module.exports = router;

