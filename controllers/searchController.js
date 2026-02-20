const pool = require('../config/db');

exports.globalSearch = async (req, res, next) => {
    try {
        const { q } = req.query;

        if (!q || q.length < 2) {
            return res.status(400).json({ status: 'fail', message: 'Search query must be at least 2 characters long' });
        }

        const searchQuery = `%${q}%`;
        const results = {
            users: [],
            needs: [],
            disasters: [],
            resources: [],
            missing_persons: []
        };

        // 1. Search Users (replaces old volunteers + users search)
        const usersResult = await pool.query(
            `SELECT id, full_name as name, email, role, avatar_url 
             FROM users 
             WHERE full_name ILIKE $1 OR email ILIKE $1 OR role ILIKE $1
             LIMIT 5`,
            [searchQuery]
        );
        results.users = usersResult.rows;

        // 2. Search Needs (replaces old sos_reports)
        const needsResult = await pool.query(
            `SELECT id, request_code, reporter_name as name, type, status, urgency 
             FROM needs 
             WHERE reporter_name ILIKE $1 OR type ILIKE $1 OR request_code ILIKE $1 OR description ILIKE $1
             LIMIT 5`,
            [searchQuery]
        );
        results.needs = needsResult.rows;

        // 3. Search Disasters
        const disastersResult = await pool.query(
            `SELECT id, name, type, status, severity 
             FROM disasters 
             WHERE name ILIKE $1 OR type ILIKE $1 
             LIMIT 5`,
            [searchQuery]
        );
        results.disasters = disastersResult.rows;

        // 4. Search Resources (replaces old shelters)
        const resourcesResult = await pool.query(
            `SELECT id, type, quantity, status 
             FROM resources 
             WHERE type ILIKE $1 OR status ILIKE $1
             LIMIT 5`,
            [searchQuery]
        );
        results.resources = resourcesResult.rows;

        // 5. Search Missing Persons
        const missingPersonsResult = await pool.query(
            `SELECT id, name, age, status 
             FROM missing_persons 
             WHERE name ILIKE $1 OR reporter_phone ILIKE $1 
             LIMIT 5`,
            [searchQuery]
        );
        results.missing_persons = missingPersonsResult.rows;

        const totalFound = Object.values(results).reduce((acc, arr) => acc + arr.length, 0);

        res.status(200).json({
            status: 'success',
            data: results,
            meta: {
                totalFound,
                query: q
            }
        });

    } catch (error) {
        console.error('Search error:', error);
        next(error);
    }
};
