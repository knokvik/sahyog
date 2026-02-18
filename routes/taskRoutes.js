const express = require('express');
const verifyToken = require('../middleware/authMiddleware');
const checkRole = require('../middleware/roleMiddleware');
const taskController = require('../controllers/taskController');

const router = express.Router();

// Create task (volunteer_head or admin)
router.post('/', verifyToken, checkRole('org:volunteer_head'), taskController.createTask);

router.get('/pending', verifyToken, checkRole(), taskController.listPendingTasks);
router.get('/:id', verifyToken, checkRole(), taskController.getTaskById);

// Volunteer lifecycle actions
router.patch('/:id/accept', verifyToken, checkRole('org:volunteer'), taskController.acceptTask);
router.patch('/:id/start', verifyToken, checkRole('org:volunteer'), taskController.startTask);
router.patch('/:id/complete', verifyToken, checkRole('org:volunteer'), taskController.completeTask);

module.exports = router;

