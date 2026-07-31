const Snapshot = require('../models/cctv/snapshot.model');
const logger = require('./logger');

/**
 * Delete snapshots older than a specified number of days for a company
 * No Cloudinary cleanup needed — image data is stored directly in MongoDB
 * @param {ObjectId} companyId - Company ID
 * @param {number} days - Number of days to retain (delete older)
 * @returns {Promise<{deletedCount: number, failedCount: number, cutoffDate: Date}>}
 */
const deleteSnapshotsOlderThan = async (companyId, days) => {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  let deletedCount = 0;
  let failedCount = 0;
  const batchSize = 100;

  // Process in batches to avoid memory issues with large datasets
  while (true) {
    const batch = await Snapshot.find({
      companyId,
      capturedAt: { $lt: cutoffDate },
    }).select('_id').limit(batchSize);

    if (batch.length === 0) break;

    for (const snapshot of batch) {
      try {
        // Simply delete the MongoDB document — imageData is stored within it
        await Snapshot.deleteOne({ _id: snapshot._id });
        deletedCount++;
      } catch (error) {
        logger.error(`[CCTV Cleanup] Failed to delete snapshot ${snapshot._id}:`, error.message);
        failedCount++;
      }
    }
  }

  return { deletedCount, failedCount, cutoffDate };
};

/**
 * Get storage usage for a company
 * @param {ObjectId} companyId - Company ID
 * @returns {Promise<{totalFiles: number, totalSize: number, averageFileSize: number}>}
 */
const getStorageUsage = async (companyId) => {
  try {
    const result = await Snapshot.getStorageUsage(companyId);
    return result;
  } catch (error) {
    logger.error(`[CCTV Cleanup] Failed to get storage usage for company ${companyId}:`, error.message);
    return { totalFiles: 0, totalSize: 0, averageFileSize: 0 };
  }
};

module.exports = {
  deleteSnapshotsOlderThan,
  getStorageUsage,
};