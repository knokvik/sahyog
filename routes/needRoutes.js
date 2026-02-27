const express = require('express');
const verifyToken = require('../middleware/authMiddleware');
const checkRole = require('../middleware/roleMiddleware');
const needController = require('../controllers/needController');

const router = express.Router();

router.post('/', needController.createNeed); // Can be public for citizens reporting emergencies
router.get('/active', verifyToken, checkRole(), needController.listActiveNeeds);
router.get('/', verifyToken, checkRole(), needController.listNeeds);
router.patch('/:id/assign', verifyToken, checkRole('coordinator'), needController.assignVolunteer);
router.patch('/:id/resolve', verifyToken, checkRole(), needController.resolveNeed);

module.exports = router;
