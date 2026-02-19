const express = require('express');
const verifyToken = require('../middleware/authMiddleware');
const checkRole = require('../middleware/roleMiddleware');
const { validators } = require('../utils/validate');
const missingPersonController = require('../controllers/missingPersonController');

const router = express.Router();

router.post('/', verifyToken, checkRole(), validators.reportMissing, missingPersonController.reportMissing);
router.get('/', verifyToken, checkRole(), missingPersonController.searchMissing);
router.patch('/:id/found', verifyToken, checkRole('org:volunteer'), validators.uuidParam, missingPersonController.markFound);

module.exports = router;

