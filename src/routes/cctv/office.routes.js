const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const officeController = require('../../controllers/cctv/office.controller');
const { authenticate, authorize, checkCompanyAccess } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { createOfficeValidation, updateOfficeValidation } = require('../../validations/cctv/cctv.validation');

// All routes require authentication
router.use(authenticate);

// Office CRUD routes - admin and super_admin only
router.post(
  '/',
  authorize('admin', 'super_admin'),
  checkCompanyAccess,
  createOfficeValidation,
  validate,
  officeController.create
);

router.get(
  '/',
  checkCompanyAccess,
  officeController.getAll
);

router.get(
  '/:id',
  checkCompanyAccess,
  officeController.getById
);

router.put(
  '/:id',
  authorize('admin', 'super_admin'),
  checkCompanyAccess,
  updateOfficeValidation,
  validate,
  officeController.update
);

router.delete(
  '/:id',
  authorize('admin', 'super_admin'),
  checkCompanyAccess,
  officeController.delete
);

module.exports = router;