const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Snapshot Model
 * Represents a captured image from a CCTV camera, uploaded by the Camera Agent.
 * Images are stored on the filesystem in backend/uploads/ as <_id>.<format>.
 * The `imageName` field stores the filename (e.g. "6a72da506bdcae64c5b29404.jpeg").
 * Legacy Cloudinary snapshots still have imageUrl/thumbnailUrl set to http URLs.
 */
const SnapshotSchema = new Schema({
  companyId: {
    type: Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company ID is required'],
    index: true,
  },
  cameraId: {
    type: Schema.Types.ObjectId,
    ref: 'Camera',
    required: [true, 'Camera ID is required'],
    index: true,
  },
  agentId: {
    type: Schema.Types.ObjectId,
    ref: 'Agent',
    required: [true, 'Agent ID is required'],
  },
  // Filename of the stored image on the filesystem (e.g. "6a72da506bdcae64c5b29404.jpeg")
  imageName: {
    type: String,
    default: null,
  },
  // Image URL — for new snapshots: "/uploads/<_id>.<format>", for legacy: Cloudinary URL
  imageUrl: {
    type: String,
    default: null,
  },
  thumbnailUrl: {
    type: String,
    default: null,
    // Legacy: Cloudinary thumbnail URL. Not used for filesystem-stored images.
  },
  fileSize: {
    type: Number, // bytes
    default: null,
  },
  width: {
    type: Number,
    default: null,
  },
  height: {
    type: Number,
    default: null,
  },
  format: {
    type: String,
    default: 'jpeg',
    enum: ['jpg', 'jpeg', 'png', 'webp'],
  },
  // Metadata
  capturedAt: {
    type: Date,
    required: [true, 'Capture timestamp is required'],
    index: true,
  },
  uploadedAt: {
    type: Date,
    default: Date.now,
  },
  uploadDuration: {
    type: Number, // milliseconds
    default: null,
  },
  // Storage path on the filesystem (e.g. "/path/to/uploads/6a72da506bdcae64c5b29404.jpeg")
  storagePath: {
    type: String,
    default: null,
  },
  // Status
  status: {
    type: String,
    enum: ['uploaded', 'processing', 'failed'],
    default: 'uploaded',
  },
  isArchived: {
    type: Boolean,
    default: false,
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Indexes
SnapshotSchema.index({ companyId: 1, cameraId: 1, capturedAt: -1 });
SnapshotSchema.index({ companyId: 1, capturedAt: -1 });
SnapshotSchema.index({ cameraId: 1, capturedAt: -1 });
SnapshotSchema.index({ agentId: 1, capturedAt: -1 });
SnapshotSchema.index({ capturedAt: 1 }, { expireAfterSeconds: 7776000 }); // TTL: 90 days auto-delete

// Virtual for file size display
SnapshotSchema.virtual('fileSizeDisplay').get(function () {
  if (!this.fileSize) return 'Unknown';
  if (this.fileSize < 1024) return `${this.fileSize} B`;
  if (this.fileSize < 1024 * 1024) return `${(this.fileSize / 1024).toFixed(1)} KB`;
  return `${(this.fileSize / (1024 * 1024)).toFixed(1)} MB`;
});

// Static method to find by camera
SnapshotSchema.statics.findByCamera = function (cameraId, options = {}) {
  const query = { cameraId, status: 'uploaded' };
  if (options.startDate && options.endDate) {
    query.capturedAt = { $gte: options.startDate, $lte: options.endDate };
  } else if (options.startDate) {
    query.capturedAt = { $gte: options.startDate };
  } else if (options.endDate) {
    query.capturedAt = { $lte: options.endDate };
  }

  const { page = 1, limit = 20 } = options;
  const skip = (page - 1) * limit;
  return this.find(query)
    .sort({ capturedAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));
};

// Static method to get latest snapshot for a camera
SnapshotSchema.statics.getLatestByCamera = function (cameraId) {
  return this.findOne({ cameraId, status: 'uploaded' })
    .sort({ capturedAt: -1 });
};

// Static method to get snapshots for a company
SnapshotSchema.statics.findByCompany = function (companyId, options = {}) {
  const query = { companyId, status: 'uploaded' };
  if (options.cameraId) query.cameraId = options.cameraId;
  if (options.startDate && options.endDate) {
    query.capturedAt = { $gte: options.startDate, $lte: options.endDate };
  }

  const { page = 1, limit = 20 } = options;
  const skip = (page - 1) * limit;
  return this.find(query)
    .populate('cameraId', 'name ipAddress status')
    .sort({ capturedAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));
};

// Static method to count snapshots by date range
SnapshotSchema.statics.countByDateRange = function (companyId, startDate, endDate) {
  return this.countDocuments({
    companyId,
    status: 'uploaded',
    capturedAt: { $gte: startDate, $lte: endDate },
  });
};

// Static method to get storage usage for a company
SnapshotSchema.statics.getStorageUsage = async function (companyId) {
  const result = await this.aggregate([
    { $match: { companyId: new mongoose.Types.ObjectId(companyId), status: 'uploaded' } },
    { $group: {
      _id: null,
      totalSize: { $sum: '$fileSize' },
      totalCount: { $sum: 1 },
      avgSize: { $avg: '$fileSize' },
    }},
  ]);
  return result[0] || { totalSize: 0, totalCount: 0, avgSize: 0 };
};

// Static method to count today's snapshots
SnapshotSchema.statics.countToday = function (companyId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return this.countDocuments({
    companyId,
    status: 'uploaded',
    capturedAt: { $gte: today, $lt: tomorrow },
  });
};

module.exports = mongoose.model('Snapshot', SnapshotSchema);