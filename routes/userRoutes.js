const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/authMiddleware');
const checkRole = require('../middleware/roleMiddleware');
const {
    getMe,
    updateUserRole,
    listUsers,
    onboardUser,
    updateMyLocation,
    toggleMyAvailability,
    listLiveVolunteers,
    updateMe
} = require('../controllers/userController');

// All routes require Clerk Auth (verifyToken)

// GET /api/users - List all users (Admin only)
router.get('/', verifyToken, checkRole('org:admin'), listUsers);

// GET /api/users/me - Get current user profile (syncs logic in checkRole)
router.get('/me', verifyToken, checkRole(), getMe);
router.put('/me', verifyToken, checkRole(), updateMe);
router.put('/me/location', verifyToken, checkRole(), updateMyLocation);
router.patch('/me/availability', verifyToken, checkRole(), toggleMyAvailability);
router.get('/volunteers/live', verifyToken, checkRole('coordinator'), listLiveVolunteers);

// POST /api/users/onboard - Set role and save additional info
router.post('/onboard', verifyToken, onboardUser);

// PUT /api/users/:uid/role - Update user role (Only for admins)
router.put('/:uid/role', verifyToken, checkRole('org:admin'), updateUserRole);

// Example route for 'authority' (mapped to org:member or org:volunteer_head?)
// Assuming authority -> org:member based on context or keeping strictly to new roles
router.get('/authority-only', verifyToken, checkRole('org:member'), (req, res) => {
    res.json({ message: "Welcome, Member! You can assign tasks." });
});

// Example route for 'volunteer'
router.get('/volunteer-only', verifyToken, checkRole('org:volunteer'), (req, res) => {
    res.json({ message: "Welcome, Volunteer! You can accept tasks." });
});

module.exports = router;
