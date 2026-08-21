function validate(schema) {
	return (req, res, next) => {
		const result = schema.safeParse(req.body || {});
		if (!result.success) {
			return res.status(400).json({
				error: result.error.issues[0]?.message || 'Invalid request data'
			});
		}

		req.body = result.data;
		return next();
	};
}

module.exports = { validate };
