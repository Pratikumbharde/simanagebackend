const express = require('express')
const router = express.Router()
const { authenticate, authorize } = require('../../middleware/auth')
const pageContentController = require('../../controllers/pageContent.controller')

// Super admin routes (specific routes first)
router.get(
  '/',
  authenticate,
  authorize('super_admin'),
  pageContentController.getAllPages
)

router.get(
  '/details/:slug',
  authenticate,
  authorize('super_admin'),
  pageContentController.getPageDetails
)

router.put(
  '/:slug',
  authenticate,
  authorize('super_admin'),
  pageContentController.upsertPage
)

router.post(
  '/initialize',
  authenticate,
  authorize('super_admin'),
  pageContentController.initializePages
)

// Public routes (dynamic slug route last)
router.get('/:slug', pageContentController.getPageBySlug)

module.exports = router