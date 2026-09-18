/**
 * Custom API Error class with status code
 */
class ApiError extends Error {
  constructor(message, statusCode = 500, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true; // Distinguish from programming errors
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Common error factory functions
 */
const errors = {
  badRequest: (message = 'Bad request', details = null) =>
    new ApiError(message, 400, details),

  unauthorized: (message = 'Unauthorized') =>
    new ApiError(message, 401),

  forbidden: (message = 'Access denied') =>
    new ApiError(message, 403),

  notFound: (resource = 'Resource') =>
    new ApiError(`${resource} not found`, 404),

  conflict: (message = 'Resource already exists') =>
    new ApiError(message, 409),

  internal: (message = 'Internal server error') =>
    new ApiError(message, 500),
};

/**
 * Async handler wrapper to catch errors in async route handlers
 * @param {Function} fn - Async function (req, res, next) => Promise
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Log error with context
 * @param {Error} err - The error
 * @param {Object} context - Additional context (userId, route, etc.)
 */
const logError = (err, context = {}) => {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    message: err.message,
    statusCode: err.statusCode || 500,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
    ...context,
  };
  console.error('[ERROR]', JSON.stringify(logEntry, null, 2));
  if (process.env.NODE_ENV !== 'production' && err.stack) console.error(err.stack);
};

module.exports = {
  ApiError,
  errors,
  asyncHandler,
  logError,
};
