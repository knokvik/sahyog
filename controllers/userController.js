const { clerkClient } = require('@clerk/clerk-sdk-node');
const db = require('../config/db');
const { ensureUserInDb } = require('../utils/userSync');

// @desc    Get current user profile
// @route   GET /api/users/me
// @access  Private (Any authenticated user)
const getMe = async (req, res) => {
    try {
        const user = req.user;
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        const email = user.emailAddresses?.[0]?.emailAddress ?? null;

        // Look up the DB role and organization (source of truth)
        const dbUser = await db.query(
            `SELECT u.role, u.organization_id, u.is_active, u.last_active, o.name as organization_name,
                    u.blood_group, u.medical_history, u.address, u.phone
             FROM users u
             LEFT JOIN organizations o ON u.organization_id = o.id
             WHERE u.clerk_user_id = $1`,
            [user.id]
        );
        const row = dbUser.rows[0];
        const dbRole = row?.role || 'volunteer';
        const orgId = row?.organization_id || null;
        const orgName = row?.organization_name || null;

        res.json({
            id: user.id,
            email,
            role: dbRole,
            organization_id: orgId,
            organization_name: orgName,
            is_active: row?.is_active ?? true,
            last_active: row?.last_active ?? null,
            blood_group: row?.blood_group ?? null,
            medical_history: row?.medical_history ?? null,
            address: row?.address ?? null,
            phone: row?.phone ?? null,
            created_at: user.createdAt,
            last_login_at: user.lastSignInAt ?? null,
        });
    } catch (err) {
        console.error('[500] getMe error:', err?.message || err);
        if (process.env.NODE_ENV !== 'production') console.error(err?.stack);
        res.status(500).json({
            message: 'Failed to load profile',
            ...(process.env.NODE_ENV !== 'production' && { detail: err?.message }),
        });
    }
};

// @desc    Update user role (Admin only)
// @route   PUT /api/users/:uid/role
// @access  Private (Admin only)
const updateUserRole = async (req, res) => {
    const { uid } = req.params;
    const { role } = req.body;

    // Updated roles for dual hierarchy
    const validRoles = ['user', 'volunteer', 'coordinator', 'ngo_admin', 'district_admin'];

    if (!validRoles.includes(role)) {
        return res.status(400).json({ message: `Invalid role. Allowed: ${validRoles.join(', ')}` });
    }

    try {
        await ensureUserInDb(uid);

        // Update user metadata in Clerk
        const user = await clerkClient.users.updateUserMetadata(uid, {
            publicMetadata: { role }
        });

        // Update role in our Postgres users table (source of truth)
        const dbResult = await db.query(
            'UPDATE users SET role = $1, updated_at = NOW() WHERE clerk_user_id = $2 RETURNING *',
            [role, uid]
        );

        res.json({
            id: user.id,
            role: role,
            dbRole: dbResult.rows[0]?.role ?? null,
            updatedAt: user.updatedAt
        });

    } catch (error) {
        console.error('Role update error:', error);
        res.status(500).json({ message: "Failed to update role", error: error.message });
    }
};

// @desc    List all users (Admin only)
// @route   GET /api/users
// @access  Private (Admin only)
const listUsers = async (req, res) => {
    try {
        const result = await db.query(
            `SELECT u.id, u.clerk_user_id, u.full_name, u.email, u.role, u.phone, u.avatar_url, u.created_at, u.updated_at,
                    ST_X(u.current_location::geometry) AS lng, 
                    ST_Y(u.current_location::geometry) AS lat,
                    EXISTS(
                      SELECT 1 FROM tasks t 
                      WHERE t.volunteer_id = u.id AND t.status IN ('pending', 'in_progress')
                    ) AS is_assigned
             FROM users u
             ORDER BY u.created_at DESC
             LIMIT 200`
        );
        res.json(result.rows);
    } catch (err) {
        console.error('[500] listUsers error:', err?.message || err);
        res.status(500).json({
            message: 'Failed to list users',
            ...(process.env.NODE_ENV !== 'production' && { detail: err?.message }),
        });
    }
};

// @desc    Onboard user with form details
// @route   POST /api/users/onboard
// @access  Private
const onboardUser = async (req, res) => {
    try {
        const uid = req.user.id;
        const { role, phone, organization_id } = req.body;

        const validRoles = ['volunteer', 'coordinator', 'organization'];
        if (!validRoles.includes(role)) {
            return res.status(400).json({ message: "Invalid role for onboarding. Allowed: " + validRoles.join(', ') });
        }

        // Ensure user is in our local DB
        await ensureUserInDb(uid);

        // Update Clerk metadata
        await clerkClient.users.updateUserMetadata(uid, {
            publicMetadata: { role }
        });

        // Update local DB role and optional phone
        await db.query(
            'UPDATE users SET role = $1, phone = COALESCE($2, phone), updated_at = NOW() WHERE clerk_user_id = $3',
            [role, phone || null, uid]
        );

        res.status(200).json({ message: "Onboarding complete", role });

    } catch (err) {
        console.error('[500] onboardUser error:', err?.message || err);
        res.status(500).json({
            message: 'Failed to complete onboarding',
            ...(process.env.NODE_ENV !== 'production' && { detail: err?.message }),
        });
    }
};

// @desc    Update current user's location
// @route   PUT /api/users/me/location
// @access  Private
const updateMyLocation = async (req, res) => {
    try {
        const { lat, lng } = req.body || {};
        const latitude = Number(lat);
        const longitude = Number(lng);

        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            return res.status(400).json({ message: 'lat and lng must be valid numbers' });
        }

        const dbUser = req.dbUser || await ensureUserInDb(req.auth?.userId);

        const result = await db.query(
            `UPDATE users
             SET current_location = ST_SetSRID(ST_MakePoint($1, $2), 4326),
                 last_active = NOW(),
                 updated_at = NOW()
             WHERE id = $3
             RETURNING id, full_name, is_active, last_active,
               ST_X(current_location::geometry) AS lng,
               ST_Y(current_location::geometry) AS lat`,
            [longitude, latitude, dbUser.id]
        );

        const updatedUser = result.rows[0];

        // Emit location update for the Live Map
        const io = req.app.get('io');
        if (io) {
            io.emit('volunteer_location_update', {
                id: updatedUser.id,
                full_name: updatedUser.full_name,
                role: dbUser.role,
                lat: updatedUser.lat,
                lng: updatedUser.lng,
                is_active: updatedUser.is_active,
                last_active: updatedUser.last_active
            });
        }

        res.json(updatedUser);
    } catch (err) {
        console.error('[500] updateMyLocation error:', err?.message || err);
        res.status(500).json({
            message: 'Failed to update location',
            ...(process.env.NODE_ENV !== 'production' && { detail: err?.message }),
        });
    }
};

// @desc    Toggle volunteer availability (users.is_active)
// @route   PATCH /api/users/me/availability
// @access  Private (Volunteer/Coordinator/Admin)
const toggleMyAvailability = async (req, res) => {
    try {
        const dbUser = req.dbUser || await ensureUserInDb(req.auth?.userId);
        const role = req.role || dbUser.role || 'volunteer';

        if (!['volunteer', 'coordinator', 'admin'].includes(role)) {
            return res.status(403).json({ message: 'Only volunteers/coordinators can change availability' });
        }

        const hasExplicit = typeof req.body?.is_active === 'boolean';
        const result = await db.query(
            `UPDATE users
             SET is_active = ${hasExplicit ? '$1' : 'NOT is_active'},
                 last_active = NOW(),
                 updated_at = NOW()
             WHERE id = $${hasExplicit ? '2' : '1'}
             RETURNING id, full_name, role, is_active, last_active`,
            hasExplicit ? [req.body.is_active, dbUser.id] : [dbUser.id]
        );

        res.json(result.rows[0]);
    } catch (err) {
        console.error('[500] toggleMyAvailability error:', err?.message || err);
        res.status(500).json({
            message: 'Failed to update availability',
            ...(process.env.NODE_ENV !== 'production' && { detail: err?.message }),
        });
    }
};

// @desc    List volunteers with live status for coordinator
// @route   GET /api/users/volunteers/live
// @access  Private (Coordinator/Admin)
const listLiveVolunteers = async (req, res) => {
    try {
        const result = await db.query(
            `SELECT u.id, u.full_name, u.email, u.phone, u.avatar_url,
                    u.is_active, u.last_active,
                    COUNT(t.id) FILTER (WHERE t.status IN ('pending', 'accepted', 'in_progress'))::int AS active_tasks,
                    COUNT(t.id) FILTER (WHERE t.status = 'completed')::int AS completed_tasks
             FROM users u
             LEFT JOIN tasks t ON t.volunteer_id = u.id
             WHERE u.role = 'volunteer'
             GROUP BY u.id
             ORDER BY u.is_active DESC, u.last_active DESC NULLS LAST, u.created_at DESC
             LIMIT 500`
        );
        res.json(result.rows);
    } catch (err) {
        console.error('[500] listLiveVolunteers error:', err?.message || err);
        res.status(500).json({
            message: 'Failed to list live volunteer status',
            ...(process.env.NODE_ENV !== 'production' && { detail: err?.message }),
        });
    }
};

// @desc    Update current user profile (personal details)
// @route   PUT /api/users/me
// @access  Private
const updateMe = async (req, res) => {
    try {
        const uid = req.user.id;
        const { blood_group, medical_history, address, phone } = req.body;

        // 1. Update local DB
        const result = await db.query(
            `UPDATE users 
             SET blood_group = COALESCE($1, blood_group),
                 medical_history = COALESCE($2, medical_history),
                 address = COALESCE($3, address),
                 phone = COALESCE($4, phone),
                 updated_at = NOW()
             WHERE clerk_user_id = $5
             RETURNING *`,
            [blood_group || null, medical_history || null, address || null, phone || null, uid]
        );

        // 2. Sync to Clerk publicMetadata (optional but good for consistency)
        await clerkClient.users.updateUserMetadata(uid, {
            publicMetadata: {
                blood_group,
                medical_history,
                address,
                phone
            }
        });

        res.json(result.rows[0]);
    } catch (err) {
        console.error('[500] updateMe error:', err?.message || err);
        res.status(500).json({
            message: 'Failed to update profile',
            ...(process.env.NODE_ENV !== 'production' && { detail: err?.message }),
        });
    }
};

module.exports = {
    getMe,
    updateUserRole,
    listUsers,
    onboardUser,
    updateMyLocation,
    toggleMyAvailability,
    listLiveVolunteers,
    updateMe
};
