require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { notFound, errorHandler } = require('./middleware/errorMiddleware');
const userRoutes = require('./routes/userRoutes');
const needRoutes = require('./routes/needRoutes');
const zoneRoutes = require('./routes/zoneRoutes');
const taskRoutes = require('./routes/taskRoutes');
const disasterRoutes = require('./routes/disasterRoutes');
const resourceRoutes = require('./routes/resourceRoutes');
const missingRoutes = require('./routes/missingRoutes');
const serverRoutes = require('./routes/serverRoutes');
const searchRoutes = require('./routes/searchRoutes');
const organizationRoutes = require('./routes/organizationRoutes');
const sosRoutes = require('./routes/sosRoutes');
const volunteerRoutes = require('./routes/volunteerRoutes');
const locationRoutes = require('./routes/locationRoutes');
const locationService = require('./services/location.service');
const {
    startHeatmapEmitter,
    stopHeatmapEmitter,
    emitLatestToSocket,
} = require('./services/heatmapRealtime.service');

const { Server } = require('socket.io');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.io with flexible transports for better compatibility
const io = new Server(server, {
    cors: {
        origin: '*', // Allow all for convenience, or limit to specific domains in prod
        methods: ['GET', 'POST'],
        credentials: true
    },
    transports: ['websocket', 'polling'], // Allow both for better handshake on some networks
    allowEIO3: true // Compatibility with older clients if needed
});

// Configure Socket connections
io.on('connection', (socket) => {
    console.log('Client connected to Socket.io:', socket.id);
    emitLatestToSocket(socket);

    socket.on('location.update', async (data) => {
        try {
            const { userId, role, lat, lng, name } = data;
            if (userId && role && lat !== undefined && lng !== undefined) {
                await locationService.updateLocation(userId, role, lat, lng, name);
            }
        } catch (err) {
            console.error('Socket location update error:', err.message);
        }
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

// Setup Redis subscriber to emit via Socket.io
const setupRedisSub = async () => {
    try {
        const { createClient } = require('redis');
        const subClient = createClient({ url: process.env.REDIS_URL || 'redis://127.0.0.1:6379' });

        await subClient.connect();
        await subClient.subscribe('location:updates', (message) => {
            try {
                const data = JSON.parse(message);

                // Emit full data on admin channel (for coordinator dashboards)
                io.emit('location.update.admin', data);

                // Emit sanitized data on public channel
                const publicData = { ...data };
                if (publicData.userId) {
                    publicData.userId = publicData.userId.substring(0, 4) + '***';
                }
                io.emit('location.update', publicData);
            } catch (e) {
                console.error('Error parsing redis message', e);
            }
        });
        console.log('✅ Redis subscriber listening on location:updates');
    } catch (err) {
        console.error('Redis Subscribe Error (non-fatal):', err.message);
    }
};

setupRedisSub();

// Make io accessible to our router
app.set('io', io);

// Middleware
app.use(cors());
app.use(express.json()); // Body parser
app.use(express.urlencoded({ extended: true })); // Parse Twilio form data

// Request logging (every request – for testing)
const requestLogger = require('./middleware/requestLogger');
app.use(requestLogger);

// No-auth routes (order matters: exact paths before app.use)
app.get('/', (req, res) => {
    res.json({ message: "Welcome to Sahyog Backend API (Clerk + Postgres)" });
});

// Health check route - using app.use for Express 5 compatibility
const healthRouter = express.Router();
healthRouter.get('/', (req, res) => {
    console.log('[health] GET /api/health hit');
    res.json({ ok: true, message: 'Backend reachable' });
});
app.use('/api/health', healthRouter);
app.get('/health', (req, res) => res.status(200).send('OK'));

// API routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/users', userRoutes);

// v1 API as per spec
app.use('/api/v1/needs', needRoutes);
app.use('/api/v1/zones', zoneRoutes);
app.use('/api/v1/coordinator', require('./routes/coordinatorRoutes'));
app.use('/api/v1/coordinators', require('./routes/coordinatorsRoutes'));
app.use('/api/v1/tasks', taskRoutes);
app.use('/api/v1/disasters', disasterRoutes);
app.use('/api/v1/resources', resourceRoutes);
app.use('/api/v1/volunteers', volunteerRoutes);
app.use('/api/v1/missing', missingRoutes);
app.use('/api/v1/server', serverRoutes);
app.use('/api/v1/search', searchRoutes);
app.use('/api/v1/organizations', organizationRoutes);
app.use('/api/v1/sos', sosRoutes);
app.use('/api/v1/mesh', require('./routes/meshRoutes'));
app.use('/api/v1/orchestrator', require('./routes/orchestratorRoutes'));
app.use('/api/v1/beacon', require('./routes/beaconRoutes'));
app.use('/api/v1/twilio', require('./routes/twilioRoutes'));
app.use('/api/v1/volunteer-assignments', require('./routes/volunteerAssignmentRoutes'));
app.use('/api/v1/admin/workflows', require('./routes/adminWorkflowRoutes'));
app.use('/api/v1/uploads', require('./routes/uploadRoutes'));
app.use('/api/v1/locations', locationRoutes);

// Error Handling Middleware
app.use(notFound);
app.use(errorHandler);

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server & Socket.io running in ${process.env.NODE_ENV} mode on port ${PORT} at 0.0.0.0`);
    console.log(`✅ Clerk Auth Initialized`);
    startHeatmapEmitter(io);
});

const gracefulShutdown = () => {
    stopHeatmapEmitter();
    process.exit(0);
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
