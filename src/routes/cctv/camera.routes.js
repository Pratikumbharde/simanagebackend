const express = require('express');
const router = express.Router();
const cameraController = require('../../controllers/cctv/camera.controller');
const { authenticate, authorize, checkCompanyAccess } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { createCameraValidation, updateCameraValidation } = require('../../validations/cctv/cctv.validation');
const { checkSubscriptionFeature } = require('../../middleware/subscription');

// All routes require authentication
router.use(authenticate);

// Camera stats (must be before /:id)
router.get(
  '/stats',
  checkCompanyAccess,
  cameraController.getStats
);

// Camera CRUD routes
router.post(
  '/',
  authorize('admin', 'super_admin'),
  checkCompanyAccess,
  checkSubscriptionFeature('cctvMonitoring'),
  createCameraValidation,
  validate,
  cameraController.create
);

router.get(
  '/',
  checkCompanyAccess,
  cameraController.getAll
);

router.get(
  '/:id',
  checkCompanyAccess,
  cameraController.getById
);

router.put(
  '/:id',
  authorize('admin', 'super_admin'),
  checkCompanyAccess,
  updateCameraValidation,
  validate,
  cameraController.update
);

router.delete(
  '/:id',
  authorize('admin', 'super_admin'),
  checkCompanyAccess,
  cameraController.delete
);

module.exports = router;