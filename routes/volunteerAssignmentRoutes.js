const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/authMiddleware');
const checkRole = require('../middleware/roleMiddleware');
const { getMyAssignments, respondToAssignment } = require('../controllers/volunteerAssignmentController');

// All endpoints require at least volunteer role
router.get('/mine', verifyToken, checkRole('volunteer'), getMyAssignments);
router.post('/:id/respond', verifyToken, checkRole('volunteer'), respondToAssignment);

module.exports = router;
