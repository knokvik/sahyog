const express = require('express');
const verifyToken = require('../middleware/authMiddleware');
const checkRole = require('../middleware/roleMiddleware');
const { reassignTasksFromInactiveCoordinator } = require('../controllers/taskController');
const { deactivateVolunteer } = require('../controllers/volunteerController');
const { freezeZone } = require('../controllers/zoneController');

const router = express.Router();

router.post('/reassign-tasks', verifyToken, checkRole('admin'), reassignTasksFromInactiveCoordinator);
router.patch('/volunteers/:id/deactivate', verifyToken, checkRole('admin'), deactivateVolunteer);
router.patch('/zones/:id/freeze', verifyToken, checkRole('admin'), freezeZone);

module.exports = router;
