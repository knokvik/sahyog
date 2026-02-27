const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/authMiddleware');
const checkRole = require('../middleware/roleMiddleware');
const assignmentController = require('../controllers/assignmentController');

// Coordinator assignments
router.post('/coordinator', verifyToken, checkRole('admin'), assignmentController.assignCoordinator);
router.delete('/coordinator/:id', verifyToken, checkRole('admin'), assignmentController.removeCoordinator);

// Volunteer assignments
router.post('/volunteer', verifyToken, checkRole('coordinator'), assignmentController.assignVolunteer);
router.delete('/volunteer/:id', verifyToken, checkRole('coordinator'), assignmentController.removeVolunteer);

module.exports = router;
