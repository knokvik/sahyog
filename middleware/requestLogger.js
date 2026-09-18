/**
 * Log every request for testing/debugging.
 * Logs: method, path, query, body (truncated), and auth userId when set.
 */
function requestLogger(req, res, next) {
  const start = Date.now();
  const hasAuth = !!req.auth?.userId;

  const logLine = () => {
    const body = req.body && Object.keys(req.body).length ? JSON.stringify(req.body).slice(0, 200) : '';
    const q = req.query && Object.keys(req.query).length ? JSON.stringify(req.query) : '';
    const hasBearer = !!req.headers.authorization?.startsWith('Bearer ');
    console.log(
      [
        new Date().toISOString(),
        req.method,
        req.path,
        q && `query=${q}`,
        body && `body=${body}${body.length >= 200 ? '...' : ''}`,
        hasBearer ? 'Bearer-sent' : 'no-Bearer',
        hasAuth ? `userId=${req.auth.userId}` : 'no-auth',
        `${res.statusCode} ${Date.now() - start}ms`,
      ]
        .filter(Boolean)
        .join(' ')
    );
  };

  res.on('finish', logLine);
  next();
}

module.exports = requestLogger;
