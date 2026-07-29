const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const landingContentController = require('../../controllers/landingContent/landingContent.controller');
const { authenticate, authorize } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');

// Multer configuration for logo upload
const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/branding');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'logo-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const logoUpload = multer({
  storage: logoStorage,
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml', 'image/webp'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (PNG, JPG, SVG, WebP) are allowed'), false);
    }
  },
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
});

// Validation rules for hero section
const heroValidation = [
  body('hero.badge').optional().trim().isLength({ max: 200 }),
  body('hero.title').optional().trim().isLength({ max: 200 }),
  body('hero.highlight').optional().trim().isLength({ max: 100 }),
  body('hero.subtitle').optional().trim().isLength({ max: 500 }),
  body('hero.cta1Text').optional().trim().isLength({ max: 50 }),
  body('hero.cta1Link').optional().trim().isLength({ max: 200 }),
  body('hero.cta2Text').optional().trim().isLength({ max: 50 }),
  body('hero.cta2Link').optional().trim().isLength({ max: 200 }),
];

// Validation rules for testimonial
const testimonialValidation = [
  body('testimonials.items').optional().isArray(),
  body('testimonials.items.*.name').optional().trim().isLength({ max: 100 }),
  body('testimonials.items.*.role').optional().trim().isLength({ max: 100 }),
  body('testimonials.items.*.company').optional().trim().isLength({ max: 100 }),
  body('testimonials.items.*.content').optional().trim().isLength({ max: 1000 }),
  body('testimonials.items.*.rating').optional().isInt({ min: 1, max: 5 }),
];

// Validation rules for FAQ
const faqValidation = [
  body('faq.items').optional().isArray(),
  body('faq.items.*.question').optional().trim().isLength({ max: 500 }),
  body('faq.items.*.answer').optional().trim().isLength({ max: 2000 }),
];

// Validation rules for branding
const brandingValidation = [
  body('branding.siteName').optional().trim().isLength({ max: 100 }),
  body('branding.logoUrl').optional().trim().isLength({ max: 500 }),
  body('branding.logoDarkUrl').optional().trim().isLength({ max: 500 }),
  body('branding.faviconUrl').optional().trim().isLength({ max: 500 }),
];

// Public route - no authentication required
router.get('/public', landingContentController.getPublicContent);

// All routes below require authentication and super admin role
router.use(authenticate);
router.use(authorize('super_admin'));

// Get full content (Super Admin only)
router.get('/', landingContentController.getFullContent);

// Update entire content (Super Admin only)
router.put('/', heroValidation, testimonialValidation, faqValidation, brandingValidation, validate, landingContentController.updateContent);

// Update specific section (Super Admin only)
router.put('/:section', landingContentController.updateSection);

// Upload logo (Super Admin only)
router.post('/upload-logo', logoUpload.single('logo'), landingContentController.uploadLogo);

// Delete logo (Super Admin only)
router.delete('/logo/:type', landingContentController.deleteLogo);

// Reset to default (Super Admin only)
router.post('/reset', landingContentController.resetToDefault);

module.exports = router;