const db = require('../config/db');

// @desc    Get all regions
// @route   GET /api/v1/regions
// @access  Private
const getRegions = async (req, res) => {
    try {
        const result = await db.query(
            `SELECT id, name, description, created_at FROM regions ORDER BY name ASC`
        );
        res.json(result.rows);
    } catch (err) {
        console.error('[500] getRegions error:', err);
        res.status(500).json({ message: 'Failed to fetch regions' });
    }
};

// @desc    Create a new region (Admin only)
// @route   POST /api/v1/regions
// @access  Private/Admin
const createRegion = async (req, res) => {
    const { name, description } = req.body;

    // Safety check assuming Admin creates this
    if (req.user?.role !== 'admin' && req.user?.role !== 'coordinator') {
        return res.status(403).json({ message: "Forbidden: Not authorized to create regions" });
    }

    if (!name) {
        return res.status(400).json({ message: 'Region name is required' });
    }

    try {
        const result = await db.query(
            'INSERT INTO regions (name, description) VALUES ($1, $2) RETURNING *',
            [name, description || null]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('[500] createRegion error:', err);
        res.status(500).json({ message: 'Failed to create region' });
    }
};

// @desc    Get dashboard stats for current region (Coordinator)
// @route   GET /api/v1/regions/dashboard
// @access  Private/Coordinator
const getDashboardStats = async (req, res) => {
    try {
        const regionId = req.user?.region_id;

        if (!regionId) {
            return res.status(400).json({ message: "You are not assigned to any region." });
        }

        // Count volunteers in region
        const volResult = await db.query(
            `SELECT COUNT(*) FROM users WHERE role = 'volunteer' AND region_id = $1`,
            [regionId]
        );
        const totalVolunteers = parseInt(volResult.rows[0].count, 10);

        // Count tasks by status in region
        const taskResult = await db.query(
            `SELECT status, COUNT(*) FROM tasks WHERE region_id = $1 GROUP BY status`,
            [regionId]
        );

        const tasks = {
            total: 0,
            pending: 0,
            accepted: 0,
            completed: 0,
            rejected: 0
        };

        taskResult.rows.forEach(row => {
            const count = parseInt(row.count, 10);
            tasks[row.status] = count;
            tasks.total += count;
        });

        // Optional: Active events in region (Linking disasters to regions is Phase 2, placeholder for now)
        const events = 0;

        res.json({
            region_name: 'Your Region', // we can join regions table if needed
            volunteers: totalVolunteers,
            tasks,
            events
        });

    } catch (error) {
        console.error('[500] getDashboardStats error:', error);
        res.status(500).json({ message: 'Failed to fetch dashboard stats' });
    }
}

// @desc    Get volunteers under the coordinator's region
// @route   GET /api/v1/regions/volunteers
// @access  Private/Coordinator
const getRegionVolunteers = async (req, res) => {
    try {
        const regionId = req.user?.region_id;

        if (!regionId) {
            return res.status(400).json({ message: "You are not assigned to any region." });
        }

        const result = await db.query(
            `SELECT id, full_name, email, phone, avatar_url, last_active 
             FROM users 
             WHERE role = 'volunteer' AND region_id = $1
             ORDER BY full_name ASC`,
            [regionId]
        );

        res.json(result.rows);

    } catch (error) {
        console.error('[500] getRegionVolunteers error:', error);
        res.status(500).json({ message: 'Failed to fetch regional volunteers' });
    }
}


module.exports = {
    getRegions,
    createRegion,
    getDashboardStats,
    getRegionVolunteers
};
