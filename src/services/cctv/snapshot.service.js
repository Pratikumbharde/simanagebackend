const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Snapshot = require('../../models/cctv/snapshot.model');
const Camera = require('../../models/cctv/camera.model');
const Agent = require('../../models/cctv/agent.model');
const AgentLog = require('../../models/cctv/agentLog.model');
const { NotFoundError, ForbiddenError, ValidationError } = require('../../utils/errors');
const { SnapshotNotFoundError, SnapshotUploadError, CameraNotFoundError } = require('../../utils/cctvErrors');
const { emitToCompany } = require('../../config/socket');

const UPLOADS_DIR = path.join(__dirname, '../../../uploads');

// Ensure upload directory exists at startup
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

class SnapshotService {
  /**
   * Upload a snapshot from an agent
   * Images are stored on the filesystem in uploads/<_id>.<format>
   */
  async uploadSnapshot(file, metadata, agentId) {
    const { cameraId, capturedAt, fileSize, width, height, format } = metadata;

    // Verify camera exists and belongs to agent's company
    const agent = await Agent.findById(agentId);
    if (!agent) {
      throw new NotFoundError('Agent');
    }

    const camera = await Camera.findOne({
      _id: cameraId,
      companyId: agent.companyId,
    });

    if (!camera) {
      throw new CameraNotFoundError();
    }

    try {
      if (!file || !file.path) {
        throw new Error('Snapshot file path is missing');
      }

      // Determine image format from file extension or mimetype
      const imageFormat = format || (file.mimetype ? file.mimetype.split('/')[1] : 'jpeg') || 'jpeg';

      // Generate ObjectId upfront so we can name the file before saving
      const snapshotId = new mongoose.Types.ObjectId();

      // Determine the file extension
      const ext = imageFormat === 'jpg' ? 'jpeg' : imageFormat;
      const imageName = `${snapshotId}.${ext}`;
      const destPath = path.join(UPLOADS_DIR, imageName);

      // Move the multer temp file to its final destination (async, non-blocking)
      await fs.promises.rename(file.path, destPath);

      // Get the actual file size from the moved file
      let actualFileSize = fileSize;
      try {
        const stats = await fs.promises.stat(destPath);
        actualFileSize = stats.size;
      } catch (e) {
        // Fall back to provided fileSize or 0
        actualFileSize = fileSize || 0;
      }

      // Create Snapshot document — single save
      const snapshot = new Snapshot({
        _id: snapshotId,
        companyId: agent.companyId,
        cameraId,
        agentId,
        imageName,
        imageUrl: `/uploads/${imageName}`,
        thumbnailUrl: null,
        fileSize: actualFileSize,
        width: width || null,
        height: height || null,
        format: ext,
        capturedAt: capturedAt ? new Date(capturedAt) : new Date(),
        uploadedAt: new Date(),
        uploadDuration: metadata.uploadStartTime ? Date.now() - metadata.uploadStartTime : null,
        storagePath: destPath,
        status: 'uploaded',
      });

      await snapshot.save();

      // Update camera last snapshot time
      camera.lastSnapshotAt = new Date();
      camera.consecutiveFailures = 0;
      await camera.save();

      // Update agent snapshot count
      await agent.incrementSnapshotCount();

      // Emit Socket.IO event for real-time updates
      emitToCompany(agent.companyId.toString(), 'snapshot:new', {
        id: snapshot._id,
        cameraId: snapshot.cameraId,
        cameraName: camera.name,
        imageUrl: snapshot.imageUrl,
        thumbnailUrl: null,
        capturedAt: snapshot.capturedAt,
        uploadedAt: snapshot.uploadedAt,
        fileSize: snapshot.fileSize,
      });

      // Log successful upload
      await AgentLog.create({
        companyId: agent.companyId,
        agentId,
        level: 'info',
        event: 'snapshot_uploaded',
        message: `Snapshot uploaded for camera: ${camera.name}`,
        metadata: {
          snapshotId: snapshot._id,
          cameraId,
          fileSize: snapshot.fileSize,
        },
      });

      return snapshot.toObject();
    } catch (error) {
      // Clean up the already-moved file on error (not the temp file)
      try {
        const failedExt = (format || 'jpeg') === 'jpg' ? 'jpeg' : (format || 'jpeg');
        const failedPath = path.join(UPLOADS_DIR, `${snapshotId}.${failedExt}`);
        if (fs.existsSync(failedPath)) {
          fs.unlinkSync(failedPath);
        }
      } catch (e) {
        // Ignore cleanup errors
      }

      // Log failed upload
      await AgentLog.create({
        companyId: agent.companyId,
        agentId,
        level: 'error',
        event: 'snapshot_failed',
        message: `Failed to upload snapshot for camera: ${camera.name}`,
        metadata: {
          cameraId,
          error: error.message,
        },
      });

      // Update agent failure count
      await agent.incrementFailureCount();

      // Update camera failure count
      camera.consecutiveFailures = (camera.consecutiveFailures || 0) + 1;
      camera.lastError = error.message;
      camera.lastErrorAt = new Date();
      await camera.save();

      throw new SnapshotUploadError(`Failed to upload snapshot: ${error.message}`);
    }
  }

  /**
   * Get snapshots for a camera (paginated, date-filtered)
   */
  async getByCamera(cameraId, query, user) {
    const {
      page = 1,
      limit = 20,
      startDate,
      endDate,
      status,
    } = query;

    const filter = { cameraId };

    // Data isolation
    if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    }

    // Date range filter
    if (startDate || endDate) {
      filter.capturedAt = {};
      if (startDate) filter.capturedAt.$gte = new Date(startDate);
      if (endDate) filter.capturedAt.$lte = new Date(endDate);
    }

    if (status) filter.status = status;

    const skip = (page - 1) * limit;
    const sort = { capturedAt: -1 };

    const snapshots = await Snapshot.find(filter)
      .skip(skip)
      .limit(parseInt(limit))
      .sort(sort);

    const total = await Snapshot.countDocuments(filter);

    return { data: snapshots, total, page: parseInt(page), limit: parseInt(limit) };
  }

  /**
   * Get snapshots for a company (paginated, filtered)
   */
  async getAll(query, user) {
    const {
      page = 1,
      limit = 20,
      cameraId,
      startDate,
      endDate,
      status,
      sortBy = 'capturedAt',
      sortOrder = 'desc',
    } = query;

    const filter = {};

    // Data isolation
    if (user.role === 'super_admin' && query.companyId) {
      filter.companyId = query.companyId;
    } else if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    }

    if (cameraId) filter.cameraId = cameraId;
    if (status) filter.status = status;

    // Date range filter
    if (startDate || endDate) {
      filter.capturedAt = {};
      if (startDate) filter.capturedAt.$gte = new Date(startDate);
      if (endDate) filter.capturedAt.$lte = new Date(endDate);
    }

    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const snapshots = await Snapshot.find(filter)
      .populate('cameraId', 'name type status')
      .populate('agentId', 'name hostname')
      .skip(skip)
      .limit(parseInt(limit))
      .sort(sort);

    const total = await Snapshot.countDocuments(filter);

    return { data: snapshots, total, page: parseInt(page), limit: parseInt(limit) };
  }

  /**
   * Get latest snapshot for a camera
   */
  async getLatestByCamera(cameraId, user) {
    const filter = { cameraId, status: 'uploaded' };

    if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    }

    const snapshot = await Snapshot.findOne(filter).sort({ capturedAt: -1 });

    if (!snapshot) {
      return null;
    }

    return snapshot;
  }

  /**
   * Get snapshot by ID
   */
  async getById(snapshotId, user) {
    const filter = { _id: snapshotId };

    if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    }

    const snapshot = await Snapshot.findOne(filter)
      .populate('cameraId', 'name type status')
      .populate('agentId', 'name hostname');

    if (!snapshot) {
      throw new SnapshotNotFoundError();
    }

    return snapshot;
  }

  /**
   * Delete a snapshot
   * Removes both the MongoDB document and the physical file from the filesystem
   */
  async deleteSnapshot(snapshotId, user) {
    const filter = { _id: snapshotId };

    if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    }

    const snapshot = await Snapshot.findOne(filter);

    if (!snapshot) {
      throw new SnapshotNotFoundError();
    }

    // Delete the physical file from the filesystem
    if (snapshot.imageName) {
      try {
        const filePath = path.join(UPLOADS_DIR, snapshot.imageName);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (e) {
        console.error(`[SnapshotService] Failed to delete file ${snapshot.imageName}:`, e.message);
      }
    }

    await Snapshot.deleteOne({ _id: snapshotId });

    return { success: true, message: 'Snapshot deleted successfully' };
  }

  /**
   * Cleanup old snapshots based on company retention period
   * Deletes both MongoDB documents and their corresponding physical files
   */
  async cleanupOldSnapshots(companyId, retentionDays) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    let deletedCount = 0;
    let failedCount = 0;
    const batchSize = 100;

    // Process in batches — select imageName to delete physical files
    while (true) {
      const batch = await Snapshot.find({
        companyId,
        capturedAt: { $lt: cutoffDate },
      }).select('_id imageName').limit(batchSize);

      if (batch.length === 0) break;

      for (const snapshot of batch) {
        try {
          // Delete the physical file before removing the document
          if (snapshot.imageName) {
            const filePath = path.join(UPLOADS_DIR, snapshot.imageName);
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
          }
          await Snapshot.deleteOne({ _id: snapshot._id });
          deletedCount++;
        } catch (error) {
          console.error(`[SnapshotService] Failed to delete snapshot ${snapshot._id}:`, error.message);
          failedCount++;
        }
      }
    }

    return { deletedCount, failedCount, cutoffDate };
  }

  /**
   * Get snapshot statistics for a company
   */
  async getSnapshotStats(companyId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalSnapshots,
      todaySnapshots,
      storageUsage,
    ] = await Promise.all([
      Snapshot.countDocuments({ companyId, status: 'uploaded' }),
      Snapshot.countToday(companyId),
      Snapshot.getStorageUsage(companyId),
    ]);

    return {
      total: totalSnapshots,
      today: todaySnapshots,
      storage: storageUsage,
    };
  }
}

module.exports = new SnapshotService();