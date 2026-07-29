const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const simController = require('../../controllers/sim/sim.controller');
const { authenticate, authorize, checkCompanyAccess } = require('../../middleware/auth');
const { checkSubscriptionLimit, checkSubscriptionFeature } = require('../../middleware/subscription');
const { validate } = require('../../middleware/validate');

// Multer configuration for Excel upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'sim-import-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files are allowed'), false);
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// [INTERNATIONAL OPERATORS] - Validation rules updated to accept any operator
const createSimValidation = [
  body('mobileNumber').matches(/^\+?\d{10,15}$/).withMessage('Valid Contact Number required (Must be 10-15 digits)'),
  body('operator').notEmpty().trim().withMessage('Operator is required').isLength({ max: 50 }).withMessage('Operator name too long'),
  body('companyId').optional().isMongoId().withMessage('Invalid company ID'),
  body('circle').optional().isString().isLength({ max: 100 }).withMessage('Circle/region too long'),
  body('notes').optional().isString().isLength({ max: 500 }),
  body('isAdminCaller').optional().isBoolean().withMessage('isAdminCaller must be a boolean'),
];

const bulkCreateValidation = [
  body('sims').isArray({ min: 1 }).withMessage('SIMs must be a non-empty array'),
  body('sims.*.mobileNumber').matches(/^\d{10}$/).withMessage('Valid 10-digit Contact Number required'),
  body('sims.*.countryCode').optional().matches(/^\+\d{1,4}$/).withMessage('Valid country code required (e.g., +91)'),
  body('sims.*.operator').notEmpty().trim().withMessage('Operator is required'),
  body('sims.*.status').optional().isIn(['active', 'inactive']),
  body('sims.*.assignedUserEmail').optional({ values: 'falsy' }).isEmail().withMessage('Valid email required for assigned user'),
];

const updateSimValidation = [
  param('id').isMongoId().withMessage('Invalid SIM ID'),
  body('mobileNumber').optional().matches(/^\+?\d{10,15}$/),
  body('operator').optional().notEmpty().trim().isLength({ max: 50 }),
  body('circle').optional().isString().isLength({ max: 100 }),
  body('notes').optional().isString().isLength({ max: 500 }),
  body('status').optional().isIn(['active', 'inactive']),
  body('isAdminCaller').optional().isBoolean().withMessage('isAdminCaller must be a boolean'),
];

const queryValidation = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  // [PHONE SEARCH FIX] - Sanitize search: trim and remove special characters that could break regex
  query('search').optional().trim().customSanitizer(value => {
    if (!value) return value;
    // Remove tabs, newlines, and extra spaces
    return value.replace(/[\t\n\r]+/g, '').trim();
  }),
  query('status').optional().isIn(['active', 'inactive']),
  query('operator').optional().trim(), // [INTERNATIONAL] - Accept any operator for filtering
  query('sortBy').optional().isIn(['createdAt', 'mobileNumber', 'status', 'operator']),
  query('sortOrder').optional().isIn(['asc', 'desc']),
];

const statusValidation = [
  param('id').isMongoId().withMessage('Invalid SIM ID'),
  body('status').isIn(['active', 'inactive']).withMessage('Invalid status'),
];

const assignValidation = [
  param('id').isMongoId().withMessage('Invalid SIM ID'),
  body('userId').isMongoId().withMessage('Invalid user ID'),
];

const messagingStatusValidation = [
  param('id').isMongoId().withMessage('Invalid SIM ID'),
  body('platform').isIn(['whatsapp', 'telegram']).withMessage('Platform must be whatsapp or telegram'),
  body('enabled').isBoolean().withMessage('Enabled must be a boolean'),
];

// All routes require authentication
router.use(authenticate);

// [MULTI-SIM SUPPORT] - Get assigned SIMs for logged-in user (mobile app)
router.get('/my', simController.getMySims);

// Routes
router.post('/bulk', checkCompanyAccess, checkSubscriptionLimit('sims'), bulkCreateValidation, validate, simController.bulkCreate);
router.post('/', checkCompanyAccess, checkSubscriptionLimit('sims'), createSimValidation, validate, simController.create);
router.post('/import', checkCompanyAccess, checkSubscriptionLimit('sims'), upload.single('file'), simController.bulkImport);
router.post('/detect-operator', simController.detectOperator); // Operator detection from Contact Number
router.get('/template', simController.downloadTemplate);
router.get('/export', checkSubscriptionFeature('excelExport'), simController.export);
router.get('/stats', simController.getStats);
router.get('/messaging-stats', simController.getMessagingStats);
router.get('/', queryValidation, validate, simController.getAll);
router.get('/:id', simController.getById);
router.put('/:id', updateSimValidation, validate, simController.update);
router.delete('/:id', authorize('super_admin', 'admin'), simController.delete);
router.patch('/:id/status', statusValidation, validate, simController.updateStatus);
router.patch('/:id/messaging', messagingStatusValidation, validate, simController.updateMessagingStatus);
router.post('/:id/assign', assignValidation, validate, simController.assign);
router.post('/:id/unassign', simController.unassign);

module.exports = router;