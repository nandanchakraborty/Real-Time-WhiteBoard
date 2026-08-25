const { createUser, findUserByEmail, findUserById } = require('../../services/authService/authservice');
const { hashPassword, verifyPassword } = require('../../utils/password');
const { createAccessToken, createRefreshToken, verifyRefreshToken } = require('../../utils/jwt');

// The refresh token is kept in an HTTP-only cookie when the bundled client is used.
// API clients may also send it in the request body.
const REFRESH_COOKIE = 'whiteboard_refresh_token';
const refreshCookieOptions = {
	httpOnly: true,
	secure: process.env.NODE_ENV === 'production',
	sameSite: 'lax',
	path: '/api/auth',
	maxAge: 7 * 24 * 60 * 60 * 1000
};

function publicUser(user) {
	// Never return the password hash in an API response.
	return {
		id: user.id,
		name: user.name,
		email: user.email,
		createdAt: user.createdAt
	};
}

function clearRefreshCookie(res) {
	res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions, maxAge: undefined });
}

function getRefreshToken(req) {
	// Supporting both formats makes the API usable by browser and non-browser clients.
	if (req.body?.refreshToken) return req.body.refreshToken;

	const cookies = (req.headers.cookie || '').split(';');
	const refreshCookie = cookies.find((cookie) => cookie.trim().startsWith(`${REFRESH_COOKIE}=`));
	return refreshCookie ? decodeURIComponent(refreshCookie.trim().slice(`${REFRESH_COOKIE}=`.length)) : null;
}

async function register(req, res) {
	// Registration creates the account and immediately starts a session.
	try {
		const existingUser = await findUserByEmail(req.body.email);
		if (existingUser) {
			return res.status(409).json({ error: 'An account with this email already exists' });
		}

		const user = await createUser({
			name: req.body.name,
			email: req.body.email,
			pass: await hashPassword(req.body.password)
		});
		const accessToken = createAccessToken(user);
		const refreshToken = createRefreshToken(user);
		res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions);
		return res.status(201).json({ accessToken, refreshToken, user: publicUser(user) });
	} catch (error) {
		if (error.code === 'P2002') {
			return res.status(409).json({ error: 'An account with this email already exists' });
		}

		console.error('Registration failed:', error);
		return res.status(500).json({ error: 'Unable to create account' });
	}
}

async function login(req, res) {
	// Login checks the hash, then returns a short-lived access token and refresh token.
	try {
		const user = await findUserByEmail(req.body.email);
		if (!user || !(await verifyPassword(req.body.password, user.pass))) {
			return res.status(401).json({ error: 'Invalid email or password' });
		}

		const accessToken = createAccessToken(user);
		const refreshToken = createRefreshToken(user);
		res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions);
		return res.json({
			msg: 'login successful',
			accessToken,
			refreshToken,
			user: publicUser(user)
		});
	} catch (error) {
		console.error('Login failed:', error);
		return res.status(500).json({ error: 'Unable to log in' });
	}
}

async function refresh(req, res) {
	// Rotate both tokens so an old refresh token cannot be reused indefinitely.
	const refreshToken = getRefreshToken(req);
	if (!refreshToken) {
		return res.status(401).json({ error: 'Refresh token is required' });
	}

	try {
		const payload = verifyRefreshToken(refreshToken);
		const user = await findUserById(payload.userId);
		if (!user) {
			clearRefreshCookie(res);
			return res.status(401).json({ error: 'User account no longer exists' });
		}

		const accessToken = createAccessToken(user);
		const rotatedRefreshToken = createRefreshToken(user);
		res.cookie(REFRESH_COOKIE, rotatedRefreshToken, refreshCookieOptions);
		return res.json({ accessToken, refreshToken: rotatedRefreshToken, user: publicUser(user) });
	} catch (error) {
		clearRefreshCookie(res);
		return res.status(401).json({ error: 'Invalid or expired refresh token' });
	}
}

async function logout(req, res) {
	// JWT access tokens expire naturally; clearing the refresh cookie ends the session.
	clearRefreshCookie(res);
	return res.json({ message: 'Logged out successfully' });
}

async function currentUser(req, res) {
	// req.auth is populated by authenticateToken middleware.
	try {
		const user = await findUserById(req.auth.userId);
		if (!user) {
			return res.status(401).json({ error: 'User account no longer exists' });
		}

		return res.json({ user: publicUser(user) });
	} catch (error) {
		console.error('Current user lookup failed:', error);
		return res.status(500).json({ error: 'Unable to load user account' });
	}
}

module.exports = { currentUser, login, logout, refresh, register };
