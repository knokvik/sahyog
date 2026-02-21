const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/authMiddleware');
const checkRole = require('../middleware/roleMiddleware');
const {
    registerOrg,
    getMyOrg,
    updateOrg,
    getOrgStats,
    listOrgVolunteers,
    linkVolunteer,
    unlinkVolunteer,
    listOrgResources,
    createOrgResource,
    listOrgTasks,
    listOrgZones,
} = require('../controllers/organizationController');

// Registration — only requires auth (role will be set after registration)
router.post('/register', verifyToken, registerOrg);

// All /me routes require organization role
router.get('/me', verifyToken, checkRole('organization'), getMyOrg);
router.put('/me', verifyToken, checkRole('organization'), updateOrg);
router.get('/me/stats', verifyToken, checkRole('organization'), getOrgStats);

// Volunteer management
router.get('/me/volunteers', verifyToken, checkRole('organization'), listOrgVolunteers);
router.post('/me/volunteers/:userId', verifyToken, checkRole('organization'), linkVolunteer);
router.delete('/me/volunteers/:userId', verifyToken, checkRole('organization'), unlinkVolunteer);

// Resources scoped to org
router.get('/me/resources', verifyToken, checkRole('organization'), listOrgResources);
router.post('/me/resources', verifyToken, checkRole('organization'), createOrgResource);

// Tasks scoped to org's volunteers
router.get('/me/tasks', verifyToken, checkRole('organization'), listOrgTasks);

// Zones where org is active
router.get('/me/zones', verifyToken, checkRole('organization'), listOrgZones);

module.exports = router;
