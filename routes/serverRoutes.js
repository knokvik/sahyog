const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/authMiddleware');
const checkRole = require('../middleware/roleMiddleware');
const { getServerStats } = require('../controllers/serverController');

router.get('/stats', verifyToken, checkRole('org:admin'), getServerStats);

module.exports = router;
