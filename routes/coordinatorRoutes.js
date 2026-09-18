const express = require('express');
const router = express.Router();
const verifyJWT = require('../middleware/verifyJWT');
const checkRole = require('../middleware/roleMiddleware');
const {
    getContext,
    getVolunteers,
    getTasks,
    createTask,
    deleteTask,
    getNeeds,
    getSos,
    getMissingPersons,
    markMissingFound,
    reassignTask,
    getZones,
    getMyZones,
    getMyZoneVolunteers,
} = require('../controllers/coordinatorController');

router.get('/context', verifyJWT, checkRole('coordinator'), getContext);
router.get('/volunteers', verifyJWT, checkRole('coordinator'), getVolunteers);
router.get('/tasks', verifyJWT, checkRole('coordinator'), getTasks);
router.post('/tasks', verifyJWT, checkRole('coordinator'), createTask);
router.delete('/tasks/:id', verifyJWT, checkRole('coordinator'), deleteTask);
router.get('/needs', verifyJWT, checkRole('coordinator'), getNeeds);
router.get('/sos', verifyJWT, checkRole('coordinator'), getSos);
router.get('/missing', verifyJWT, checkRole('coordinator'), getMissingPersons);
router.patch('/missing/:id/found', verifyJWT, checkRole('coordinator'), markMissingFound);
router.patch('/tasks/:id/reassign', verifyJWT, checkRole('coordinator'), reassignTask);
router.get('/zones', verifyJWT, checkRole('coordinator'), getZones);

// New: Get all zones assigned to this coordinator
router.get('/my-zones', verifyJWT, checkRole('coordinator'), getMyZones);

// New: Get all volunteers assigned to this coordinator's zones
router.get('/my-zone-volunteers', verifyJWT, checkRole('coordinator'), getMyZoneVolunteers);

module.exports = router;
