const express = require('express');
const router = express.Router();
const searchController = require('../controllers/searchController');
const requireAuth = require('../middleware/authMiddleware');

router.get('/', requireAuth, searchController.globalSearch);

module.exports = router;
