const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const leadController = require('../../controllers/lead/lead.controller');
const { authenticate, authorize } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');

// Validation rules
const createLeadValidation = [
  body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 100 }).withMessage('Name cannot exceed 100 characters'),
  body('email').isEmail().withMessage('Please provide a valid email address').trim().normalizeEmail(),
  body('phone').optional().matches(/^\+?\d{10,15}$/).withMessage('Phone number must be 10-15 digits'),
  body('company').optional().trim().isLength({ max: 100 }).withMessage('Company name cannot exceed 100 characters'),
  body('message').trim().notEmpty().withMessage('Message is required').isLength({ max: 1000 }).withMessage('Message cannot exceed 1000 characters'),
];

const updateLeadValidation = [
  param('id').isMongoId().withMessage('Invalid lead ID'),
  body('status').optional().isIn(['new', 'contacted', 'qualified', 'lost']).withMessage('Invalid status'),
  body('notes').optional().trim().isLength({ max: 2000 }).withMessage('Notes cannot exceed 2000 characters'),
];

const queryValidation = [
  query('page').optional().isInt({ min: 1 }).withMessage('Invalid page'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Invalid limit'),
  query('search').optional().trim(),
  query('status').optional().isIn(['new', 'contacted', 'qualified', 'lost']).withMessage('Invalid status'),
  query('sortBy').optional().isIn(['name', 'email', 'createdAt', 'status']).withMessage('Invalid sort field'),
  query('sortOrder').optional().isIn(['asc', 'desc']).withMessage('Invalid sort order'),
];

// Public route — contact form submission (no auth required)
router.post('/', createLeadValidation, validate, leadController.create);

// All routes below require authentication and super_admin role
router.use(authenticate);
router.use(authorize('super_admin'));

router.get('/', queryValidation, validate, leadController.getAll);
router.get('/:id', param('id').isMongoId().withMessage('Invalid lead ID'), validate, leadController.getById);
router.put('/:id', updateLeadValidation, validate, leadController.update);
router.delete('/:id', param('id').isMongoId().withMessage('Invalid lead ID'), validate, leadController.delete);

module.exports = router;