const { logError } = require('../utils/errors');

const notFound = (req, res, next) => {
    const error = new Error(`Not Found - ${req.originalUrl}`);
    error.statusCode = 404;
    res.status(404);
    next(error);
};

const errorHandler = (err, req, res, next) => {
    // Log error with request context
    logError(err, {
        method: req.method,
        url: req.originalUrl,
        userId: req.auth?.userId || null,
    });

    // Use error's status code if it's an ApiError, otherwise infer from response
    const statusCode = err.statusCode || (res.statusCode === 200 ? 500 : res.statusCode);
    
    res.status(statusCode).json({
        message: err.message || 'Internal server error',
        details: err.details || null,
        ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
    });
};

module.exports = { notFound, errorHandler };
