const snapshotService = require('../../services/cctv/snapshot.service');
const auditLogService = require('../../services/auditLog/auditLog.service');
const { successResponse, paginatedResponse } = require('../../utils/response');
const AppError = require('../../utils/errors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Multer config for snapshot uploads
const UPLOAD_DIR = path.join(__dirname, '../../../uploads');

// Ensure upload directory exists at startup
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    // Use temp- prefix so the service can rename it to the final name
    cb(null, 'temp-' + Date.now() + '-' + Math.round(Math.random() * 1e9) + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, and WebP images are allowed'), false);
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
});

class SnapshotController {
  /**
   * Upload snapshot (agent auth)
   */
  async upload(req, res, next) {
    try {
      if (!req.file) {
        throw new AppError('No image file provided', 400);
      }

      // Whitelist allowed fields from body to prevent mass assignment
      const { cameraId, capturedAt, _uploadStartTime } = req.body;
      const metadata = {
        cameraId,
        capturedAt,
        uploadStartTime: _uploadStartTime,
      };

      const snapshot = await snapshotService.uploadSnapshot(req.file, metadata, req.agent._id);

      await auditLogService.logAction({
        action: 'SNAPSHOT_UPLOAD',
        module: 'CCTV',
        description: `Snapshot uploaded for camera: ${req.body.cameraId}`,
        performedBy: null,
        role: 'agent',
        companyId: req.agent.companyId,
        entityId: snapshot._id,
        entityType: 'Snapshot',
        metadata: { cameraId: req.body.cameraId, fileSize: snapshot.fileSize },
        req,
      });

      return successResponse(res, snapshot, 'Snapshot uploaded successfully', 201);
    } catch (error) {
      // Clean up temp file on error
      if (req.file && req.file.path && fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }
      }
      next(error);
    }
  }

  /**
   * Get snapshots by camera (user auth)
   */
  async getByCamera(req, res, next) {
    try {
      const result = await snapshotService.getByCamera(req.params.cameraId, req.query, req.user);
      return paginatedResponse(res, result.data, result.total, result.page, result.limit);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get all snapshots (user auth)
   */
  async getAll(req, res, next) {
    try {
      const result = await snapshotService.getAll(req.query, req.user);
      return paginatedResponse(res, result.data, result.total, result.page, result.limit);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get latest snapshot for a camera
   */
  async getLatest(req, res, next) {
    try {
      const snapshot = await snapshotService.getLatestByCamera(req.params.cameraId, req.user);
      return successResponse(res, snapshot);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get snapshot by ID
   */
  async getById(req, res, next) {
    try {
      const snapshot = await snapshotService.getById(req.params.id, req.user);
      return successResponse(res, snapshot);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Redirect to the snapshot image URL
   * Since images are now served via Express static from /uploads/,
   * this route redirects to the static file URL.
   * Backward compatible: old Cloudinary URLs still redirect correctly.
   * No auth needed — static files are publicly served.
   */
  async getImage(req, res, next) {
    try {
      const Snapshot = require('../../models/cctv/snapshot.model');
      const snapshot = await Snapshot.findById(req.params.id);

      if (!snapshot) {
        return res.status(404).json({ success: false, message: 'Snapshot not found' });
      }

      // New filesystem-stored images: redirect to /uploads/<imageName>
      if (snapshot.imageUrl && snapshot.imageUrl.startsWith('/uploads/')) {
        return res.redirect(snapshot.imageUrl);
      }

      // Legacy Cloudinary URLs: redirect to the external URL
      if (snapshot.imageUrl && snapshot.imageUrl.startsWith('http')) {
        return res.redirect(snapshot.imageUrl);
      }

      return res.status(404).json({ success: false, message: 'Snapshot image not found' });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete snapshot (admin only)
   */
  async delete(req, res, next) {
    try {
      const result = await snapshotService.deleteSnapshot(req.params.id, req.user);

      await auditLogService.logAction({
        action: 'SNAPSHOT_DELETE',
        module: 'CCTV',
        description: `Deleted snapshot: ${req.params.id}`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: req.user.companyId,
        entityId: req.params.id,
        entityType: 'Snapshot',
        req,
      });

      return successResponse(res, null, result.message);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = { controller: new SnapshotController(), upload };