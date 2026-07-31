const express = require('express');
const router = express.Router();
const dashboardController = require('../../controllers/cctv/dashboard.controller');
const { authenticate, checkCompanyAccess } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { dashboardQueryValidation } = require('../../validations/cctv/cctv.validation');

// All routes require authentication
router.use(authenticate);

// Get dashboard stats
router.get(
  '/stats',
  checkCompanyAccess,
  dashboardQueryValidation,
  validate,
  dashboardController.getStats
);

// Get recent snapshots
router.get(
  '/recent-snapshots',
  checkCompanyAccess,
  dashboardQueryValidation,
  validate,
  dashboardController.getRecentSnapshots
);

module.exports = router;