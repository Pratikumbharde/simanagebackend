const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const statusController = require('../../controllers/status/status.controller');
const { authenticate } = require('../../middleware/auth');
const { checkSubscriptionFeature } = require('../../middleware/subscription');
const { validate } = require('../../middleware/validate');

// Validation rules
const updateWhatsAppValidation = [
  param('simId').isMongoId().withMessage('Invalid SIM ID'),
  body('enabled').isBoolean().withMessage('Enabled must be a boolean'),
];

const updateTelegramValidation = [
  param('simId').isMongoId().withMessage('Invalid SIM ID'),
  body('enabled').isBoolean().withMessage('Enabled must be a boolean'),
];

const bulkUpdateValidation = [
  body('simIds').isArray({ min: 1 }).withMessage('SIM IDs array is required'),
  body('simIds.*').isMongoId().withMessage('Invalid SIM ID'),
  body('platform').isIn(['whatsapp', 'telegram']).withMessage('Invalid platform'),
  body('enabled').isBoolean().withMessage('Enabled must be a boolean'),
];

// Middleware to check feature based on platform
const checkPlatformFeature = (req, res, next) => {
  const platform = req.body.platform;
  const feature = platform === 'whatsapp' ? 'whatsappStatus' : 'telegramStatus';
  return checkSubscriptionFeature(feature)(req, res, next);
};

// All routes require authentication
router.use(authenticate);

// Routes
router.get('/overview', statusController.getOverview);
router.get('/:simId', statusController.getStatus);
router.get('/:simId/history', statusController.getHistory);
router.put('/:simId/whatsapp', checkSubscriptionFeature('whatsappStatus'), updateWhatsAppValidation, validate, statusController.updateWhatsApp);
router.put('/:simId/telegram', checkSubscriptionFeature('telegramStatus'), updateTelegramValidation, validate, statusController.updateTelegram);
router.post('/bulk', bulkUpdateValidation, validate, checkPlatformFeature, statusController.bulkUpdate);

module.exports = router;