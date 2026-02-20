const express = require('express');
const verifyToken = require('../middleware/authMiddleware');
const checkRole = require('../middleware/roleMiddleware');
const taskController = require('../controllers/taskController');

const router = express.Router();

router.post('/', verifyToken, checkRole('coordinator'), taskController.createTask);
router.get('/pending', verifyToken, checkRole(), taskController.listPendingTasks);
router.patch('/:id/status', verifyToken, checkRole(), taskController.updateTaskStatus);

module.exports = router;
