const express = require('express');
const router = express.Router();
const locationService = require('../services/location.service');

// Initialize Redis (non-blocking)
locationService.initRedis().catch(err => console.warn('Redis init deferred:', err.message));

// POST /api/v1/locations/update
router.post('/update', async (req, res) => {
    try {
        const { userId, role, lat, lng, name } = req.body;

        if (!userId || !role || lat === undefined || lng === undefined) {
            return res.status(400).json({ error: 'Missing required fields: userId, role, lat, lng' });
        }

        await locationService.updateLocation(userId, role, lat, lng, name);
        res.status(200).json({ success: true, message: 'Location updated' });
    } catch (err) {
        console.error('Error updating location:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// GET /api/v1/locations/all — sanitized for public/general view
router.get('/all', async (req, res) => {
    try {
        let locations = await locationService.getAllActiveLocations();

        // Optional role filter
        const { role } = req.query;
        if (role) {
            locations = locations.filter(l => l.role === role);
        }

        // Sanitize userId for public view
        const sanitized = locations.map(l => ({
            userId: (l.userId || '').substring(0, 4) + '***',
            role: l.role,
            lat: l.lat,
            lng: l.lng,
            name: l.name || '',
            timestamp: l.timestamp,
        }));
        res.status(200).json(sanitized);
    } catch (err) {
        console.error('Error fetching locations:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// GET /api/v1/locations/all/full — unsanitized for admin/coordinator dashboards
router.get('/all/full', async (req, res) => {
    try {
        let locations = await locationService.getAllActiveLocations();

        const { role } = req.query;
        if (role) {
            locations = locations.filter(l => l.role === role);
        }

        res.status(200).json(locations);
    } catch (err) {
        console.error('Error fetching full locations:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// GET /api/v1/locations/nearby
router.get('/nearby', async (req, res) => {
    try {
        const { lat, lng, radius } = req.query;
        if (!lat || !lng || !radius) {
            return res.status(400).json({ error: 'Missing required query params: lat, lng, radius' });
        }

        const nearby = await locationService.getNearbyUsers(lat, lng, radius);
        res.status(200).json(nearby);
    } catch (err) {
        console.error('Error fetching nearby locations:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

module.exports = router;
