const express = require('express');
const verifyToken = require('../middleware/authMiddleware');
const checkRole = require('../middleware/roleMiddleware');
const { getCoordinatorsMetrics } = require('../controllers/coordinatorsController');

const router = express.Router();

router.get('/metrics', verifyToken, checkRole('admin'), getCoordinatorsMetrics);

module.exports = router;
