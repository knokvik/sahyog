const express = require('express');
const verifyToken = require('../middleware/authMiddleware');
const checkRole = require('../middleware/roleMiddleware');
const taskController = require('../controllers/taskController');

const router = express.Router();

router.post('/', verifyToken, checkRole(), taskController.createTask);
router.get('/escalated', verifyToken, checkRole(), taskController.listEscalatedTasks);
router.get('/pending', verifyToken, checkRole(), taskController.listPendingTasks);
router.get('/history', verifyToken, checkRole(), taskController.listTaskHistory);
router.post('/:id/vote-completion', verifyToken, checkRole(), taskController.voteTaskCompletion);
router.get('/:id/votes', verifyToken, checkRole(), taskController.getTaskVotes);
router.patch('/:id/status', verifyToken, checkRole(), taskController.updateTaskStatus);
router.post('/:id/request-help', verifyToken, checkRole('volunteer'), taskController.requestHelp);

module.exports = router;
