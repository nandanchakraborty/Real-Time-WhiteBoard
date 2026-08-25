const { verifyToken } = require('../utils/jwt');

// Protect REST endpoints that require a logged-in user.
// The client must send: Authorization: Bearer <access token>
function authenticateToken(req, res, next) {
	const authorization = req.headers.authorization || '';
	const [scheme, token] = authorization.split(' ');

	if (scheme !== 'Bearer' || !token) {
		return res.status(401).json({ error: 'Authentication token is required' });
	}

	try {
		req.auth = verifyToken(token);
		return next();
	} catch (error) {
		return res.status(401).json({ error: 'Invalid or expired authentication token' });
	}
}

module.exports = { authenticateToken };
