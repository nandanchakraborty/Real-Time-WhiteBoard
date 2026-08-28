// Return one consistent JSON shape for API errors that were not handled locally.
function apiNotFound(req, res, next) {
	if (req.path.startsWith('/api/')) {
		return res.status(404).json({ error: 'API endpoint not found' });
	}

	return next();
}

// Express identifies error middleware by its four arguments.
function errorHandler(error, req, res, next) {
	console.error('Unhandled application error:', error);

	if (res.headersSent) {
		return next(error);
	}

	const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
	const message = statusCode >= 500 ? 'Internal server error' : error.message;
	return res.status(statusCode).json({ error: message || 'Internal server error' });
}

module.exports = { apiNotFound, errorHandler };
