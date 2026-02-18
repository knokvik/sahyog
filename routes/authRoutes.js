const express = require('express');
const router = express.Router();
const verifyJWT = require('../middleware/verifyJWT');
const { clerkClient } = require('@clerk/clerk-sdk-node');

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

module.exports = router;
