const { ClerkExpressRequireAuth } = require('@clerk/clerk-sdk-node');

// This middleware verifies the session token and adds the auth object to the request
const requireAuth = ClerkExpressRequireAuth();

module.exports = requireAuth;
