const express = require('express');
const verifyToken = require('../middleware/authMiddleware');
const checkRole = require('../middleware/roleMiddleware');
const zoneController = require('../controllers/zoneController');

const router = express.Router();

router.post('/', verifyToken, checkRole('admin'), zoneController.createZone);
router.get('/', verifyToken, checkRole(), zoneController.listZones);
router.patch('/:id/coordinator', verifyToken, checkRole('admin'), zoneController.assignCoordinator);

module.exports = router;
