const fs = require('fs');
const Snapshot = require('../../models/cctv/snapshot.model');
const Camera = require('../../models/cctv/camera.model');
const Agent = require('../../models/cctv/agent.model');
const AgentLog = require('../../models/cctv/agentLog.model');
const { NotFoundError, ForbiddenError, ValidationError } = require('../../utils/errors');
const { SnapshotNotFoundError, SnapshotUploadError, CameraNotFoundError } = require('../../utils/cctvErrors');
const { emitToCompany } = require('../../config/socket');

class SnapshotService {
  /**
   * Upload a snapshot from an agent
   * Stores image data directly in MongoDB instead of Cloudinary
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

      // Read the image file from disk (multer temp file)
      const imageBuffer = fs.readFileSync(file.path);
      const actualFileSize = fs.statSync(file.path).size;

      // Determine image format from file extension or mimetype
      const imageFormat = format || (file.mimetype ? file.mimetype.split('/')[1] : 'jpeg') || 'jpeg';

      // Create snapshot document with image data stored in MongoDB
      const snapshot = new Snapshot({
        companyId: agent.companyId,
        cameraId,
        agentId,
        imageData: imageBuffer,
        imageUrl: null, // Will be set after save when we have the _id
        thumbnailUrl: null, // No separate thumbnail — frontend uses CSS sizing
        fileSize: fileSize || actualFileSize,
        width: width || null,
        height: height || null,
        format: imageFormat === 'jpg' ? 'jpeg' : imageFormat,
        capturedAt: capturedAt ? new Date(capturedAt) : new Date(),
        uploadedAt: new Date(),
        uploadDuration: metadata.uploadStartTime ? Date.now() - metadata.uploadStartTime : null,
        storagePath: null, // No Cloudinary path
        status: 'uploaded',
      });

      await snapshot.save();

      // Now set the imageUrl to the API endpoint for serving this image
      snapshot.imageUrl = `/api/cctv/snapshots/${snapshot._id}/image`;
      await snapshot.save();

      // Clean up the temp file from multer
      try {
        if (file.path && fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      } catch (e) {
        // Ignore cleanup errors — temp file will be overwritten next time
      }

      // Update camera last snapshot time
      camera.lastSnapshotAt = new Date();
      camera.consecutiveFailures = 0;
      await camera.save();

      // Update agent snapshot count
      await agent.incrementSnapshotCount();

      // Emit Socket.IO event for real-time updates
      // Note: Don't send imageData in the socket event — it's too large
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

      // Return snapshot without imageData (too large for API responses)
      const result = snapshot.toObject();
      delete result.imageData;
      return result;
    } catch (error) {
      // Clean up temp file on error
      try {
        if (file && file.path && fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
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
   * Get the image binary data for a snapshot
   * Used by the image-serving endpoint
   */
  async getImage(snapshotId, user) {
    const filter = { _id: snapshotId };
    if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    }

    // Explicitly select imageData since it has select: false
    const snapshot = await Snapshot.findOne(filter).select('+imageData');
    if (!snapshot) {
      return null;
    }

    // If snapshot has imageData (MongoDB-stored), return it
    if (snapshot.imageData) {
      return snapshot;
    }

    // If snapshot only has imageUrl (legacy Cloudinary), return null
    // The controller will redirect to the Cloudinary URL
    if (snapshot.imageUrl && snapshot.imageUrl.startsWith('http')) {
      return { redirectUrl: snapshot.imageUrl };
    }

    return null;
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
   * No Cloudinary call needed — image data is stored in MongoDB and deleted with the document
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

    // Simply delete the MongoDB document — imageData is stored within it
    await Snapshot.deleteOne({ _id: snapshotId });

    return { success: true, message: 'Snapshot deleted successfully' };
  }

  /**
   * Cleanup old snapshots based on company retention period
   * No Cloudinary cleanup needed — data is in MongoDB
   */
  async cleanupOldSnapshots(companyId, retentionDays) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    let deletedCount = 0;
    let failedCount = 0;
    const batchSize = 100;

    // Process in batches to avoid loading imageData (which can be large)
    while (true) {
      const batch = await Snapshot.find({
        companyId,
        capturedAt: { $lt: cutoffDate },
      }).select('_id').limit(batchSize);

      if (batch.length === 0) break;

      for (const snapshot of batch) {
        try {
          await Snapshot.deleteOne({ _id: snapshot._id });
          deletedCount++;
        } catch (error) {
          console.error(`Failed to delete snapshot ${snapshot._id}:`, error.message);
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