const express = require('express');
const router = express.Router();
const activityLogController = require('../controllers/activityLogController');
const verifyToken = require('../middleware/authMiddleware');
const checkRole = require('../middleware/roleMiddleware');

// GET /api/v1/logs/admin
router.get('/admin', verifyToken, checkRole('admin'), activityLogController.getAdminLogs);

// GET /api/v1/logs/org
router.get('/org', verifyToken, checkRole('organization'), activityLogController.getOrgLogs);

module.exports = router;
