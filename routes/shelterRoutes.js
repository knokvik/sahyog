const express = require('express');
const verifyToken = require('../middleware/authMiddleware');
const checkRole = require('../middleware/roleMiddleware');
const { validators } = require('../utils/validate');
const shelterController = require('../controllers/shelterController');

const router = express.Router();

// Admin create / update
router.post('/', verifyToken, checkRole('org:admin'), validators.createShelter, shelterController.createShelter);
router.patch('/:id', verifyToken, checkRole('org:admin'), validators.uuidParam, shelterController.updateShelter);

// Read endpoints
router.get('/', verifyToken, checkRole(), shelterController.listShelters);
router.get('/:id', verifyToken, checkRole(), validators.uuidParam, shelterController.getShelterById);

// Check-in evacuees (volunteers, heads, admins)
router.post('/:id/checkin', verifyToken, checkRole('org:volunteer'), validators.uuidParam, shelterController.checkIn);

module.exports = router;

