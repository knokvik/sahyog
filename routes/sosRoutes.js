const express = require('express');
const verifyToken = require('../middleware/authMiddleware');
const checkRole = require('../middleware/roleMiddleware');
const sosController = require('../controllers/sosController');

const router = express.Router();

// Any authenticated user can create SOS
router.post('/', verifyToken, checkRole(), sosController.createSos);

// Role-filtered listing handled inside controller
router.get('/', verifyToken, checkRole(), sosController.listSos);

router.get('/nearby', verifyToken, checkRole(), sosController.getNearbySos);

router.get('/:id', verifyToken, checkRole(), sosController.getSosById);

// Status changes typically for volunteers / heads / admins
router.patch('/:id/status', verifyToken, checkRole(), sosController.updateSosStatus);

module.exports = router;

