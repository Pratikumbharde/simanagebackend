const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cloudinary = require('../config/cloudinary');
const logger = require('../utils/logger');

// Disk storage for receipts
const receiptStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../uploads/receipts');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `receipt-${Date.now()}-${Math.round(Math.random() * 1e4)}${ext}`);
  },
});

const receiptUpload = multer({
  storage: receiptStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG, PNG, and PDF files are allowed'), false);
    }
  },
});

// Upload local file to Cloudinary, return URL or local path as fallback
async function uploadToCloudinary(filePath) {
  try {
    const result = await cloudinary.uploader.upload(filePath, {
      folder: 'sim-management/receipts',
      resource_type: 'auto',
    });
    // Remove local file after successful Cloudinary upload
    fs.unlink(filePath, () => {});
    return result.secure_url;
  } catch (err) {
    logger.error('[UPLOAD] Cloudinary upload failed, using local path:', err.message);
    // Return local URL as fallback
    const filename = path.basename(filePath);
    return `/uploads/receipts/${filename}`;
  }
}

// Middleware that runs multer, then uploads to Cloudinary
function optionalReceiptUpload(req, res, next) {
  receiptUpload.single('receipt')(req, res, async (err) => {
    if (err) {
      logger.error('[UPLOAD] Multer error:', err.message);
      return next();
    }
    // If file was uploaded, move it to Cloudinary
    if (req.file) {
      logger.info(`[UPLOAD] File received: ${req.file.originalname}, saving to ${req.file.path}`);
      try {
        const url = await uploadToCloudinary(req.file.path);
        req.file.cloudinaryUrl = url;
        logger.info(`[UPLOAD] Cloudinary URL: ${url}`);
      } catch (e) {
        logger.error('[UPLOAD] Post-upload processing failed:', e.message);
      }
    } else {
      logger.info('[UPLOAD] No file received in request');
    }
    next();
  });
}

module.exports = { optionalReceiptUpload };