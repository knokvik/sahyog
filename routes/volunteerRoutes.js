const express = require('express');
const verifyToken = require('../middleware/authMiddleware');
const checkRole = require('../middleware/roleMiddleware');
const volunteerController = require('../controllers/volunteerController');

const router = express.Router();

// Register as volunteer (citizen -> volunteer request)
router.post('/register', verifyToken, checkRole(), volunteerController.registerVolunteer);

// Admin-only list and verification
router.get('/', verifyToken, checkRole('org:admin'), volunteerController.listVolunteers);
router.get('/:id', verifyToken, checkRole('org:admin'), volunteerController.getVolunteerById);
router.patch('/:id/verify', verifyToken, checkRole('org:admin'), volunteerController.verifyVolunteer);

// Volunteer self operations
router.patch('/availability', verifyToken, checkRole('org:volunteer'), volunteerController.toggleAvailability);
router.post('/location', verifyToken, checkRole('org:volunteer'), volunteerController.updateLocation);
router.get('/tasks', verifyToken, checkRole('org:volunteer'), volunteerController.getMyTasks);

module.exports = router;

