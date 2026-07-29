const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const notificationController = require('../../controllers/notification/notification.controller');
const { authenticate } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');

// Validation rules
const queryValidation = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('type').optional().isIn(['recharge_due', 'inactive_sim', 'subscription_expiry', 'system', 'alert', 'info']),
  query('isRead').optional().isBoolean(),
  query('priority').optional().isIn(['low', 'medium', 'high', 'critical']),
];

const preferencesValidation = [
  body('notifications.email').optional().isBoolean(),
  body('notifications.sms').optional().isBoolean(),
  body('notifications.inApp').optional().isBoolean(),
  body('timezone').optional().isString(),
  body('language').optional().isString(),
];

// All routes require authentication
router.use(authenticate);

// Routes
router.get('/', queryValidation, validate, notificationController.getAll);
router.get('/user', queryValidation, validate, notificationController.getUserNotifications);
router.get('/unread-count', notificationController.getUnreadCount);
router.get('/:id', notificationController.getById);
router.patch('/:id/read', notificationController.markAsRead);
router.post('/mark-all-read', notificationController.markAllAsRead);
router.delete('/:id', notificationController.delete);
router.post('/clear-read', notificationController.clearRead);
router.delete('/all', notificationController.deleteAll);
router.post('/delete-selected', notificationController.deleteSelected);
router.put('/preferences', preferencesValidation, validate, notificationController.updatePreferences);

module.exports = router;