const express = require('express');
const router = express.Router();
const agentAuth = require('../../middleware/agentAuth');
const { controller: snapshotController, upload } = require('../../controllers/cctv/snapshot.controller');
const { authenticate, authorize, checkCompanyAccess } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { snapshotQueryValidation, uploadSnapshotValidation } = require('../../validations/cctv/cctv.validation');

// ==================== Agent Auth Routes ====================

// Upload snapshot (agent auth)
router.post(
  '/upload',
  agentAuth,
  upload.single('image'),
  uploadSnapshotValidation,
  validate,
  snapshotController.upload
);

// ==================== User Auth Routes ====================

// All following routes require authentication
router.use(authenticate);

// Get all snapshots (paginated)
router.get(
  '/',
  checkCompanyAccess,
  snapshotQueryValidation,
  validate,
  snapshotController.getAll
);

// Get latest snapshot for a camera
router.get(
  '/latest/:cameraId',
  checkCompanyAccess,
  snapshotController.getLatest
);

// Get snapshots by camera (paginated)
router.get(
  '/camera/:cameraId',
  checkCompanyAccess,
  snapshotQueryValidation,
  validate,
  snapshotController.getByCamera
);

// Serve snapshot image (binary data)
// Supports ?token=xxx query parameter for img tags that can't send Authorization headers
router.get(
  '/:id/image',
  snapshotController.getImage
);

// Get snapshot by ID
router.get(
  '/:id',
  checkCompanyAccess,
  snapshotController.getById
);

// Delete snapshot (admin only)
router.delete(
  '/:id',
  authorize('admin', 'super_admin'),
  checkCompanyAccess,
  snapshotController.delete
);

module.exports = router;