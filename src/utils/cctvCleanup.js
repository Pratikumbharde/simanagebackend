const fs = require('fs');
const path = require('path');
const Snapshot = require('../models/cctv/snapshot.model');
const logger = require('./logger');

const UPLOADS_DIR = path.join(__dirname, '../../uploads');

/**
 * Delete snapshots older than a specified number of days for a company.
 * Removes both the MongoDB document and the corresponding physical file.
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
    }).select('_id imageName').limit(batchSize);

    if (batch.length === 0) break;

    for (const snapshot of batch) {
      try {
        // Delete the physical file from the uploads directory
        if (snapshot.imageName) {
          const filePath = path.join(UPLOADS_DIR, snapshot.imageName);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        }
        // Delete the MongoDB document
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
 * Clean up orphaned files in the uploads directory.
 * These are files that exist on disk but have no corresponding MongoDB document
 * (e.g. left behind by TTL auto-deletion which doesn't trigger Mongoose middleware).
 * @returns {Promise<{orphanedCount: number, failedCount: number}>}
 */
const cleanupOrphanedFiles = async () => {
  let orphanedCount = 0;
  let failedCount = 0;

  // Ensure the uploads directory exists before scanning
  if (!fs.existsSync(UPLOADS_DIR)) {
    logger.info('[CCTV Cleanup] Uploads directory does not exist, skipping orphan cleanup');
    return { orphanedCount: 0, failedCount: 0 };
  }

  const files = fs.readdirSync(UPLOADS_DIR);

  for (const file of files) {
    // Skip .gitkeep and temp files (still being uploaded)
    if (file === '.gitkeep' || file.startsWith('temp-')) continue;

    // Only process image files
    if (!/\.(jpg|jpeg|png|webp)$/i.test(file)) continue;

    try {
      // Extract the snapshot ID from the filename (format: <objectId>.<ext>)
      const idPart = path.basename(file, path.extname(file));

      // Check if a corresponding Snapshot document exists
      const snapshot = await Snapshot.findById(idPart).select('_id').lean();

      if (!snapshot) {
        // Orphaned file — no corresponding DB document
        const filePath = path.join(UPLOADS_DIR, file);
        fs.unlinkSync(filePath);
        orphanedCount++;
        logger.info(`[CCTV Cleanup] Deleted orphaned file: ${file}`);
      }
    } catch (error) {
      logger.error(`[CCTV Cleanup] Error checking file ${file}:`, error.message);
      failedCount++;
    }
  }

  logger.info(`[CCTV Cleanup] Orphan cleanup complete: ${orphanedCount} files deleted, ${failedCount} errors`);
  return { orphanedCount, failedCount };
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
  cleanupOrphanedFiles,
  getStorageUsage,
};