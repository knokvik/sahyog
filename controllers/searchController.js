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
            volunteers: [],
            disasters: [],
            shelters: [],
            missing_persons: []
        };

        // 1. Search Users
        const usersResult = await pool.query(
            `SELECT id, full_name as name, email, role, avatar_url 
             FROM users 
             WHERE full_name ILIKE $1 OR email ILIKE $1 
             LIMIT 5`,
            [searchQuery]
        );
        results.users = usersResult.rows;

        // 2. Search Volunteers
        const volunteersResult = await pool.query(
            `SELECT v.id, u.full_name as name, u.email, v.skills, v.rating, v.is_available 
             FROM volunteers v 
             JOIN users u ON v.user_id = u.id 
             WHERE u.full_name ILIKE $1 OR array_to_string(v.skills, ',') ILIKE $1 
             LIMIT 5`,
            [searchQuery]
        );
        results.volunteers = volunteersResult.rows;

        // 3. Search Disasters
        const disastersResult = await pool.query(
            `SELECT id, name, type, status, severity 
             FROM disasters 
             WHERE name ILIKE $1 OR type ILIKE $1 
             LIMIT 5`,
            [searchQuery]
        );
        results.disasters = disastersResult.rows;

        // 4. Search Shelters
        const sheltersResult = await pool.query(
            `SELECT id, name, capacity, current_occupancy, status 
             FROM shelters 
             WHERE name ILIKE $1 OR array_to_string(facilities, ',') ILIKE $1 
             LIMIT 5`,
            [searchQuery]
        );
        results.shelters = sheltersResult.rows;

        // 5. Search Missing Persons
        const missingPersonsResult = await pool.query(
            `SELECT id, name, age, status 
             FROM missing_persons 
             WHERE name ILIKE $1 OR description ILIKE $1 
             LIMIT 5`,
            [searchQuery]
        );
        results.missing_persons = missingPersonsResult.rows;

        // Calculate total results found
        const totalFound = Object.values(results).reduce((acc, currentArray) => acc + currentArray.length, 0);

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
