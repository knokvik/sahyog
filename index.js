require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { notFound, errorHandler } = require('./middleware/errorMiddleware');
const userRoutes = require('./routes/userRoutes');
const sosRoutes = require('./routes/sosRoutes');
const volunteerRoutes = require('./routes/volunteerRoutes');
const taskRoutes = require('./routes/taskRoutes');
const disasterRoutes = require('./routes/disasterRoutes');
const shelterRoutes = require('./routes/shelterRoutes');
const missingRoutes = require('./routes/missingRoutes');
const serverRoutes = require('./routes/serverRoutes');
const searchRoutes = require('./routes/searchRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json()); // Body parser

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

// API routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/users', userRoutes);

// v1 API as per spec
app.use('/api/v1/sos', sosRoutes);
app.use('/api/v1/volunteers', volunteerRoutes);
app.use('/api/v1/tasks', taskRoutes);
app.use('/api/v1/disasters', disasterRoutes);
app.use('/api/v1/shelters', shelterRoutes);
app.use('/api/v1/missing', missingRoutes);
app.use('/api/v1/server', serverRoutes);
app.use('/api/v1/search', searchRoutes);

// Error Handling Middleware
app.use(notFound);
app.use(errorHandler);

app.listen(PORT, () => {
    console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
    console.log(`✅ Clerk Auth Initialized`);
});
