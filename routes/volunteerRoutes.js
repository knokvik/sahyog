const express = require('express');
const verifyToken = require('../middleware/authMiddleware');
const checkRole = require('../middleware/roleMiddleware');
const { validators } = require('../utils/validate');
const volunteerController = require('../controllers/volunteerController');

const router = express.Router();

// Register as volunteer (citizen -> volunteer request)
router.post('/register', verifyToken, checkRole(), volunteerController.registerVolunteer);

// Admin/Coordinator list and verification
router.get('/', verifyToken, checkRole(['org:admin', 'org:coordinator']), volunteerController.listVolunteers);
router.get('/locations', verifyToken, checkRole(), volunteerController.listVolunteerLocations);
router.get('/available', verifyToken, checkRole(['org:admin', 'org:coordinator']), volunteerController.listAvailableVolunteers);

// Volunteer self operations
router.patch('/availability', verifyToken, checkRole('org:volunteer'), volunteerController.toggleAvailability);
router.post('/location', verifyToken, checkRole('org:volunteer'), validators.updateLocation, volunteerController.updateLocation);
router.get('/tasks', verifyToken, checkRole('org:volunteer'), volunteerController.getMyTasks);

router.get('/:id', verifyToken, checkRole('org:admin'), validators.uuidParam, volunteerController.getVolunteerById);
router.patch('/:id/verify', verifyToken, checkRole('org:admin'), validators.uuidParam, volunteerController.verifyVolunteer);

module.exports = router;
