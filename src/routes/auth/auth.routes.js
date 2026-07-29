const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const authController = require('../../controllers/auth/auth.controller');
const otpController = require('../../controllers/auth/otp.controller');
const { authenticate, authorize } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');

// Validation rules
const registerValidation = [
  body('email').isEmail().withMessage('Valid email is required').trim(),
  // body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('password')
    .if(body('role').isIn(['admin', 'super_admin']))
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters'),

  body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 50 }),
  body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 50 }),
  body('role').optional().isIn(['admin', 'user']).withMessage('Invalid role'),
  // [PHONE VALIDATION FIX] - Accept phone with or without country code (same as SIM module)
  body('phone').optional().matches(/^\+?\d{10,15}$/).withMessage('Invalid phone number (Must be 10-15 digits)'),
  body('companyId').optional().isMongoId().withMessage('Invalid company ID'),
];

const loginValidation = [
  body('email').isEmail().withMessage('Valid email is required').trim(),
  body('password').notEmpty().withMessage('Password is required'),
];

const refreshTokenValidation = [
  body('refreshToken').notEmpty().withMessage('Refresh token is required'),
];

const changePasswordValidation = [
  body('currentPassword').notEmpty().withMessage('Current password is required').isLength({ max: 15 }).withMessage('Current password cannot exceed 15 characters'),
  body('newPassword').isLength({ min: 8, max: 15 }).withMessage('New password must be between 8 and 15 characters'),
];

const updateProfileValidation = [
  body('name').optional().trim().isLength({ max: 50 }).withMessage('Name cannot exceed 50 characters'),
  // [PHONE VALIDATION FIX] - Accept phone with or without country code (same as SIM module)
  // { checkFalsy: true } allows clearing the phone field (empty string, null, undefined skip validation)
  body('phone').optional({ checkFalsy: true }).matches(/^\+?\d{10,15}$/).withMessage('Invalid phone number (Must be 10-15 digits)'),
  body('preferences.notifications.email').optional().isBoolean(),
  body('preferences.notifications.sms').optional().isBoolean(),
  body('preferences.notifications.inApp').optional().isBoolean(),
  body('preferences.timezone').optional().isString(),
  body('preferences.language').optional().isString(),
];

const resetPasswordValidation = [
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
];

// [EMAIL OTP FIX] - OTP validation rules updated to use email instead of mobileNumber
const sendOTPValidation = [
  body('email')
    .isEmail()
    .withMessage('Please enter a valid Email ID')
    .trim(),
];

const verifyOTPValidation = [
  body('email')
    .isEmail()
    .withMessage('Please enter a valid Email ID')
    .trim(),
  body('otp')
    .matches(/^\d{6}$/)
    .withMessage('OTP must be exactly 6 digits'),
];

// [BACKWARD COMPATIBILITY] - Keep mobileNumber validation for backward compatibility
// If mobileNumber is sent, it will be ignored (email is required)

// Public routes
router.post('/register', registerValidation, validate, authController.register);
router.post('/login', loginValidation, validate, authController.login);
router.post('/refresh-token', refreshTokenValidation, validate, authController.refreshToken);
router.post('/forgot-password', [body('email').isEmail()], validate, authController.forgotPassword);
router.post('/reset-password/:token', resetPasswordValidation, validate, authController.resetPassword);
router.post('/init-super-admin', [
  // All fields are optional - if not provided, defaults/environment variables will be used
  body('email').optional().isEmail().withMessage('Please provide a valid Email ID').trim(),
  body('password').optional().isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('name').optional().trim().isLength({ min: 1, max: 50 }).withMessage('Name must be between 1 and 50 characters'),
], validate, authController.initSuperAdmin);

// Forgot Password OTP routes (for admin users)
router.post('/forgot-password-otp', [
  body('email').isEmail().withMessage('Please enter a valid Email ID').trim()
], validate, authController.forgotPasswordOTP);

router.post('/verify-forgot-password-otp', [
  body('email').isEmail().withMessage('Please enter a valid Email ID').trim(),
  body('otp').matches(/^\d{6}$/).withMessage('OTP must be exactly 6 digits')
], validate, authController.verifyForgotPasswordOTP);

router.post('/reset-password-otp', [
  body('email').isEmail().withMessage('Please enter a valid Email ID').trim(),
  body('otp').matches(/^\d{6}$/).withMessage('OTP must be exactly 6 digits'),
  body('newPassword').isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
], validate, authController.resetPasswordWithOTP);

// OTP Authentication routes (public)
router.post('/send-otp', sendOTPValidation, validate, otpController.sendOTP);
router.post('/verify-otp', verifyOTPValidation, validate, otpController.verifyOTP);
router.post('/resend-otp', sendOTPValidation, validate, otpController.resendOTP);

// Protected routes
router.use(authenticate);

router.post('/logout', authController.logout);
router.get('/profile', authController.getProfile);
router.put('/profile', updateProfileValidation, validate, authController.updateProfile);
router.post('/change-password', changePasswordValidation, validate, authController.changePassword);

// Email Change Routes (protected)
router.post('/email-change/request', [
  body('newEmail').isEmail().withMessage('Please enter a valid new Email ID').trim(),
  body('password').notEmpty().withMessage('Password is required to change email'),
], validate, authController.requestEmailChange);

router.post('/email-change/verify-old', [
  body('otp').matches(/^\d{6}$/).withMessage('OTP must be exactly 6 digits'),
], validate, authController.verifyOldEmailOTP);

router.post('/email-change/verify-new', [
  body('otp').matches(/^\d{6}$/).withMessage('OTP must be exactly 6 digits'),
], validate, authController.verifyNewEmailOTP);

router.post('/email-change/cancel', authController.cancelEmailChange);

router.post('/email-change/resend', authController.resendEmailChangeOTP);

module.exports = router;