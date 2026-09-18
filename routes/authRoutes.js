const express = require('express');
const router = express.Router();
const verifyJWT = require('../middleware/verifyJWT');
const { clerkClient } = require('@clerk/clerk-sdk-node');

const { pool } = require('../config/db');

// Protected Route: Get Current User
router.get('/me', verifyJWT, async (req, res) => {
    try {
        const { userId } = req.auth;
        if (!userId) return res.status(401).json({ message: "Unauthorized" });

        const user = await clerkClient.users.getUser(userId);
        res.json({
            message: "You are accessing a protected route!",
            user: user
        });
    } catch (error) {
        console.error("Error fetching user:", error);
        res.status(500).json({ message: "Internal Server Error" });
    }
});

// POST /api/auth/sync
// Verifies Clerk token and creates/returns user from the database
router.post('/sync', verifyJWT, async (req, res) => {
    try {
        const { userId } = req.auth;
        if (!userId) return res.status(401).json({ message: "Unauthorized - No Clerk UserId" });

        // Fetch user from Clerk to get email and details
        const clerkUser = await clerkClient.users.getUser(userId);
        if (!clerkUser) return res.status(404).json({ message: "Clerk user not found" });

        const email = clerkUser.emailAddresses[0]?.emailAddress;
        if (!email) return res.status(400).json({ message: "User has no email address in Clerk" });

        const name = `${clerkUser.firstName || ''} ${clerkUser.lastName || ''}`.trim() || 'Anonymous User';
        const phone = clerkUser.phoneNumbers[0]?.phoneNumber || null;

        // Check if user exists in the database
        const userQuery = `
            SELECT id, full_name, role, organization_id, is_active 
            FROM users 
            WHERE clerk_user_id = $1 OR email = $2
            LIMIT 1
        `;
        const { rows } = await pool.query(userQuery, [userId, email]);

        let dbUser;

        if (rows.length > 0) {
            // User exists
            dbUser = rows[0];

            // If the user exists but hasn't had their clerk_user_id linked yet (e.g. pre-clerk migration)
            if (!dbUser.clerk_user_id) {
                await pool.query('UPDATE users SET clerk_user_id = $1 WHERE id = $2', [userId, dbUser.id]);
            }

        } else {
            // User does not exist, create a new record with default "volunteer" role
            const insertQuery = `
                INSERT INTO users (full_name, email, phone, role, clerk_user_id, is_active, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
                RETURNING id, full_name, role, organization_id, is_active
            `;
            const newUserValues = [name, email, phone, 'volunteer', userId, true];
            const insertResult = await pool.query(insertQuery, newUserValues);
            dbUser = insertResult.rows[0];
        }

        // Return the required structure
        res.json({
            message: "User synced successfully",
            user: {
                id: dbUser.id,
                name: dbUser.full_name,
                role: dbUser.role,
                organization_id: dbUser.organization_id,
                zone_id: null, // zone_id is stored in zones table, linked to assigned_coordinator_id
                is_active: dbUser.is_active
            }
        });

    } catch (err) {
        console.error("Error in /api/auth/sync:", err);
        res.status(500).json({ message: "Internal Server Error during user sync", error: err.message });
    }
});

module.exports = router;
