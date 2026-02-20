const express = require('express');
const verifyToken = require('../middleware/authMiddleware');
const checkRole = require('../middleware/roleMiddleware');
const resourceController = require('../controllers/resourceController');

const router = express.Router();

router.post('/', verifyToken, checkRole('admin'), resourceController.createResource);
router.get('/', verifyToken, checkRole(), resourceController.listResources);

module.exports = router;
