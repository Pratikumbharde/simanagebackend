const express = require('express');
const router = express.Router();
const cameraAlertController = require('../../controllers/cctv/cameraAlert.controller');
const { authenticate, authorize, checkCompanyAccess } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const {
  alertQueryValidation,
  acknowledgeAlertValidation,
  resolveAlertValidation,
} = require('../../validations/cctv/cctv.validation');

// All routes require authentication
router.use(authenticate);

// Get all alerts (paginated, filtered)
router.get(
  '/',
  checkCompanyAccess,
  alertQueryValidation,
  validate,
  cameraAlertController.getAll
);

// Get alerts for a specific camera
router.get(
  '/camera/:cameraId',
  checkCompanyAccess,
  cameraAlertController.getByCamera
);

// Acknowledge an alert
router.patch(
  '/:id/acknowledge',
  authorize('admin', 'super_admin'),
  checkCompanyAccess,
  acknowledgeAlertValidation,
  validate,
  cameraAlertController.acknowledge
);

// Resolve an alert
router.patch(
  '/:id/resolve',
  authorize('admin', 'super_admin'),
  checkCompanyAccess,
  resolveAlertValidation,
  validate,
  cameraAlertController.resolve
);

module.exports = router;