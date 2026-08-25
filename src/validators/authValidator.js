const { z } = require('zod');

// Zod rejects malformed input before it reaches password or database code.
const registrationSchema = z.object({
	name: z.string().trim().min(1, 'Name is required'),
	email: z.string().trim().toLowerCase().email('Enter a valid email address'),
	password: z.string().min(8, 'Password must be at least 8 characters')
});

const loginSchema = z.object({
	email: z.string().trim().toLowerCase().email('Enter a valid email address'),
	password: z.string().min(1, 'Password is required')
});

function getValidationError(result) {
	return result.error.issues[0]?.message || 'Invalid request data';
}

module.exports = { registrationSchema, loginSchema, getValidationError };
