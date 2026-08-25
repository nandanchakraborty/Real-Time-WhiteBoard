const jwt = require('jsonwebtoken');

// Keep the secret in the environment so it is not committed to source control.
function getJwtSecret() {
	const secret = process.env.JWT_SECRET;
	if (!secret) {
		throw new Error('JWT_SECRET is not configured');
	}

	return secret;
}

function createAccessToken(user) {
	// Short-lived tokens limit the damage if an access token is exposed.
	return jwt.sign({ userId: user.id, type: 'access' }, getJwtSecret(), { expiresIn: '15m' });
}

function createRefreshToken(user) {
	// Refresh tokens keep sessions alive without making access tokens long-lived.
	return jwt.sign({ userId: user.id, type: 'refresh' }, getJwtSecret(), { expiresIn: '7d' });
}

function verifyToken(token) {
	// Checking the token type prevents a refresh token being used as an access token.
	const payload = jwt.verify(token, getJwtSecret());
	if (payload.type !== 'access') {
		throw new Error('Invalid access token');
	}

	return payload;
}

function verifyRefreshToken(token) {
	const payload = jwt.verify(token, getJwtSecret());
	if (payload.type !== 'refresh') {
		throw new Error('Invalid refresh token');
	}

	return payload;
}

module.exports = { createAccessToken, createRefreshToken, verifyRefreshToken, verifyToken };
