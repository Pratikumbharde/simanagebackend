const express = require('express');
const router = express.Router();
const agentAuth = require('../../middleware/agentAuth');
const { controller: snapshotController, upload } = require('../../controllers/cctv/snapshot.controller');
const { authenticate, authorize, checkCompanyAccess } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { snapshotQueryValidation, uploadSnapshotValidation } = require('../../validations/cctv/cctv.validation');

// ==================== Agent Auth Routes ====================

// Upload (Agent)
router.post(
  '/upload',
  agentAuth,
  upload.single('image'),
  uploadSnapshotValidation,
  validate,
  snapshotController.upload
);

// Image route FIRST (NO authenticate)
router.get(
  '/:id/image',
  snapshotController.getImage
);

// Everything below requires authentication
router.use(authenticate);

// Get all snapshots
router.get(
  '/',
  checkCompanyAccess,
  snapshotQueryValidation,
  validate,
  snapshotController.getAll
);

// Latest snapshot
router.get(
  '/latest/:cameraId',
  checkCompanyAccess,
  snapshotController.getLatest
);

// Camera snapshots
router.get(
  '/camera/:cameraId',
  checkCompanyAccess,
  snapshotQueryValidation,
  validate,
  snapshotController.getByCamera
);

// Snapshot by ID
router.get(
  '/:id',
  checkCompanyAccess,
  snapshotController.getById
);

// Delete
router.delete(
  '/:id',
  authorize('admin', 'super_admin'),
  checkCompanyAccess,
  snapshotController.delete
);

module.exports = router;