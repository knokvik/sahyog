const express = require('express');
const verifyToken = require('../middleware/authMiddleware');
const checkRole = require('../middleware/roleMiddleware');
const missingPersonController = require('../controllers/missingPersonController');

const router = express.Router();

router.post('/', missingPersonController.reportMissingPerson); // Public API possible
router.get('/', verifyToken, checkRole(), missingPersonController.listMissingPersons);
router.patch('/:id/found', verifyToken, checkRole(), missingPersonController.markFound);

module.exports = router;
