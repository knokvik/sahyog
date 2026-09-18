const { validationResult, body, param, query } = require('express-validator');

/**
 * Middleware to check validation results and return errors
 */
const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      message: 'Validation failed',
      errors: errors.array().map((e) => ({
        field: e.path,
        message: e.msg,
      })),
    });
  }
  next();
};

/**
 * Common validation rules
 */
const rules = {
  // UUID validation
  uuid: (field, location = 'param') => {
    const validator = location === 'param' ? param(field) : body(field);
    return validator
      .isUUID(4)
      .withMessage(`${field} must be a valid UUID`);
  },

  // Required string
  requiredString: (field) =>
    body(field)
      .trim()
      .notEmpty()
      .withMessage(`${field} is required`)
      .isString()
      .withMessage(`${field} must be a string`),

  // Optional string
  optionalString: (field) =>
    body(field)
      .optional()
      .trim()
      .isString()
      .withMessage(`${field} must be a string`),

  // Required number (lat/lng)
  requiredNumber: (field) =>
    body(field)
      .isFloat()
      .withMessage(`${field} must be a number`),

  // Optional number
  optionalNumber: (field) =>
    body(field)
      .optional()
      .isFloat()
      .withMessage(`${field} must be a number`),

  // Latitude validation
  latitude: (field = 'lat') =>
    body(field)
      .isFloat({ min: -90, max: 90 })
      .withMessage(`${field} must be a valid latitude (-90 to 90)`),

  // Longitude validation
  longitude: (field = 'lng') =>
    body(field)
      .isFloat({ min: -180, max: 180 })
      .withMessage(`${field} must be a valid longitude (-180 to 180)`),

  // Optional latitude
  optionalLatitude: (field = 'lat') =>
    body(field)
      .optional()
      .isFloat({ min: -90, max: 90 })
      .withMessage(`${field} must be a valid latitude (-90 to 90)`),

  // Optional longitude
  optionalLongitude: (field = 'lng') =>
    body(field)
      .optional()
      .isFloat({ min: -180, max: 180 })
      .withMessage(`${field} must be a valid longitude (-180 to 180)`),

  // Email validation
  email: (field = 'email') =>
    body(field)
      .optional()
      .isEmail()
      .withMessage('Invalid email format'),

  // Status enum validation
  status: (field, allowedValues) =>
    body(field)
      .isIn(allowedValues)
      .withMessage(`${field} must be one of: ${allowedValues.join(', ')}`),

  // Optional status
  optionalStatus: (field, allowedValues) =>
    body(field)
      .optional()
      .isIn(allowedValues)
      .withMessage(`${field} must be one of: ${allowedValues.join(', ')}`),

  // Array validation
  optionalArray: (field) =>
    body(field)
      .optional()
      .isArray()
      .withMessage(`${field} must be an array`),

  // Positive integer
  positiveInt: (field) =>
    body(field)
      .optional()
      .isInt({ min: 0 })
      .withMessage(`${field} must be a positive integer`),

  // Query param latitude
  queryLatitude: (field = 'lat') =>
    query(field)
      .isFloat({ min: -90, max: 90 })
      .withMessage(`${field} must be a valid latitude`),

  // Query param longitude
  queryLongitude: (field = 'lng') =>
    query(field)
      .isFloat({ min: -180, max: 180 })
      .withMessage(`${field} must be a valid longitude`),
};

/**
 * Pre-built validation chains for common operations
 */
const validators = {
  // SOS creation
  createSos: [
    rules.latitude(),
    rules.longitude(),
    rules.optionalString('type'),
    rules.optionalString('description'),
    rules.optionalArray('mediaUrls'),
    body('disasterId').optional().isUUID(4).withMessage('disasterId must be a valid UUID'),
    rules.positiveInt('peopleCount'),
    handleValidation,
  ],

  // SOS status update
  updateSosStatus: [
    rules.uuid('id'),
    rules.status('status', ['pending', 'in_progress', 'resolved', 'cancelled']),
    handleValidation,
  ],

  // Nearby SOS query
  nearbySos: [
    rules.queryLatitude(),
    rules.queryLongitude(),
    query('radiusMeters').optional().isInt({ min: 100, max: 100000 }).withMessage('radiusMeters must be 100-100000'),
    handleValidation,
  ],

  // Shelter creation
  createShelter: [
    rules.requiredString('name'),
    rules.latitude(),
    rules.longitude(),
    rules.positiveInt('capacity'),
    rules.optionalArray('facilities'),
    handleValidation,
  ],

  // Task creation
  createTask: [
    rules.uuid('sosId', 'body'),
    rules.uuid('volunteerId', 'body'),
    rules.optionalString('instructions'),
    handleValidation,
  ],

  // Disaster creation
  createDisaster: [
    rules.requiredString('name'),
    rules.optionalString('type'),
    body('severity').optional().isInt({ min: 1, max: 10 }).withMessage('severity must be 1-10'),
    handleValidation,
  ],

  // Missing person report
  reportMissing: [
    rules.requiredString('name'),
    rules.positiveInt('age'),
    rules.optionalString('description'),
    rules.optionalLatitude(),
    rules.optionalLongitude(),
    rules.optionalArray('photos'),
    handleValidation,
  ],

  // UUID param validation
  uuidParam: [
    rules.uuid('id'),
    handleValidation,
  ],

  // Location update
  updateLocation: [
    rules.latitude(),
    rules.longitude(),
    handleValidation,
  ],
};

module.exports = {
  handleValidation,
  rules,
  validators,
};
