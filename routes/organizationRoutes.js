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
    listOrgRequests,
    acceptOrgRequest,
    rejectOrgRequest,
    assignCoordinator,
    listNearbyOrganizations,
    joinOrganization,
} = require('../controllers/organizationController');
const { listAllOrgs } = require('../controllers/disasterRequestController');

// Registration & Discovery
router.post('/register', verifyToken, registerOrg);
router.get('/nearby', verifyToken, listNearbyOrganizations);
router.post('/join', verifyToken, joinOrganization);

// List all orgs (for admin to select when sending requests)
router.get('/list', verifyToken, checkRole('admin'), listAllOrgs);

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

// Disaster requests received by this org
router.get('/me/requests', verifyToken, checkRole('organization'), listOrgRequests);
router.post('/me/requests/:assignmentId/accept', verifyToken, checkRole('organization'), acceptOrgRequest);
router.post('/me/requests/:assignmentId/reject', verifyToken, checkRole('organization'), rejectOrgRequest);
router.post('/me/requests/:assignmentId/assign-coordinator', verifyToken, checkRole('organization'), assignCoordinator);

module.exports = router;
