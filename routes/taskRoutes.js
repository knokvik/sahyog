const express = require('express');
const verifyToken = require('../middleware/authMiddleware');
const checkRole = require('../middleware/roleMiddleware');
const { validators } = require('../utils/validate');
const taskController = require('../controllers/taskController');

const router = express.Router();

// Create task (volunteer_head or admin)
router.post('/', verifyToken, checkRole('org:volunteer_head'), validators.createTask, taskController.createTask);

router.get('/pending', verifyToken, checkRole(), taskController.listPendingTasks);
router.get('/:id', verifyToken, checkRole(), validators.uuidParam, taskController.getTaskById);

// Volunteer lifecycle actions (ownership verified in controller)
router.patch('/:id/accept', verifyToken, checkRole('org:volunteer'), validators.uuidParam, taskController.acceptTask);
router.patch('/:id/start', verifyToken, checkRole('org:volunteer'), validators.uuidParam, taskController.startTask);
router.patch('/:id/complete', verifyToken, checkRole('org:volunteer'), validators.uuidParam, taskController.completeTask);

module.exports = router;

