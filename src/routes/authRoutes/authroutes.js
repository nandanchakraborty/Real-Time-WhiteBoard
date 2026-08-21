const express = require('express');
const { currentUser, login, logout, refresh, register } = require('../../controller/authetication/authcontroller');
const { authenticateToken } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { loginSchema, registrationSchema } = require('../../validators/authValidator');

const router = express.Router();

router.post('/register', validate(registrationSchema), register);
router.post('/login', validate(loginSchema), login);
router.post('/refresh', refresh);
router.post('/logout', logout);
router.get('/me', authenticateToken, currentUser);

module.exports = router;
