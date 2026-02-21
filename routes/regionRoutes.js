const express = require('express');
const router = express.Router();
const {
    getRegions,
    createRegion,
    getDashboardStats,
    getRegionVolunteers
} = require('../controllers/regionController');
const requireAuth = require('../middleware/authMiddleware');

router.use(requireAuth);

router.get('/', getRegions);
router.post('/', createRegion);
router.get('/dashboard', getDashboardStats);
router.get('/volunteers', getRegionVolunteers);

module.exports = router;
