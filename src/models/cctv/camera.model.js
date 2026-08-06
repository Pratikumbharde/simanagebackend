const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Camera Model
 * Represents a CCTV camera connected to the system via RTSP.
 * Each camera belongs to a company and optionally an office.
 */
const CameraSchema = new Schema({
  companyId: {
    type: Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company ID is required'],
    index: true,
  },
  officeId: {
    type: Schema.Types.ObjectId,
    ref: 'Office',
    default: null,
  },
  name: {
    type: String,
    required: [true, 'Camera name is required'],
    trim: true,
    maxlength: [100, 'Camera name cannot exceed 100 characters'],
  },
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description cannot exceed 500 characters'],
    default: '',
  },
  type: {
    type: String,
    enum: ['ip_camera', 'dvr_nvr'],
    default: 'ip_camera',
  },
  // Camera network credentials
  ipAddress: {
    type: String,
    required: [true, 'IP address is required'],
    trim: true,
    validate: {
      validator: function (v) {
        // Accept IPv4, IPv6, or hostname
        return /^(\d{1,3}\.){3}\d{1,3}$/.test(v) || /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/.test(v) || /^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$/.test(v);
      },
      message: 'Invalid IP address or hostname',
    },
  },
  rtspPort: {
    type: Number,
    default: 554,
    min: [1, 'Port must be between 1 and 65535'],
    max: [65535, 'Port must be between 1 and 65535'],
  },
  rtspUrl: {
    type: String,
    required: [true, 'RTSP URL is required'],
    trim: true,
    validate: {
      validator: function (v) {
        return /^rtsp:\/\//i.test(v);
      },
      message: 'RTSP URL must start with rtsp://',
    },
  },
  username: {
    type: String,
    trim: true,
    default: '',
  },
  password: {
    type: String,
    trim: true,
    default: '',
    select: false, // Never return in queries by default
  },
  // Capture settings
  captureInterval: {
    type: Number,
    default: 30, // minutes
    min: [1, 'Capture interval must be at least 1 minute'],
    max: [1440, 'Capture interval cannot exceed 24 hours (1440 minutes)'],
  },
  imageQuality: {
    type: Number,
    default: 80, // FFmpeg quality 1-100
    min: [1, 'Image quality must be at least 1'],
    max: [100, 'Image quality cannot exceed 100'],
  },
  resolution: {
    type: String,
    default: 'original',
    enum: ['original', '1920x1080', '1280x720', '640x480'],
  },
  // Status tracking
  status: {
    type: String,
    enum: ['online', 'offline', 'error', 'disabled'],
    default: 'offline',
    index: true,
  },
  lastSnapshotAt: {
    type: Date,
    default: null,
  },
  lastError: {
    type: String,
    default: null,
  },
  lastErrorAt: {
    type: Date,
    default: null,
  },
  consecutiveFailures: {
    type: Number,
    default: 0,
    min: 0,
  },
  // Agent assignment
  assignedAgentId: {
    type: Schema.Types.ObjectId,
    ref: 'Agent',
    default: null,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Indexes
CameraSchema.index({ companyId: 1, status: 1 });
CameraSchema.index({ companyId: 1, isActive: 1 });
CameraSchema.index({ companyId: 1, officeId: 1 });
CameraSchema.index({ assignedAgentId: 1 });
CameraSchema.index({ companyId: 1, name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

// Virtual for full camera info
CameraSchema.virtual('fullInfo').get(function () {
  return `${this.name} (${this.ipAddress}) - ${this.status}`;
});

// Virtual for time since last snapshot
CameraSchema.virtual('timeSinceLastSnapshot').get(function () {
  if (!this.lastSnapshotAt) return null;
  const diff = Date.now() - this.lastSnapshotAt.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
});

// Static method to find by company
CameraSchema.statics.findByCompany = function (companyId, options = {}) {
  const query = { companyId, isActive: true };
  if (options.status) query.status = options.status;
  if (options.officeId) query.officeId = options.officeId;
  if (options.search) {
    query.$or = [
      { name: { $regex: options.search, $options: 'i' } },
      { ipAddress: { $regex: options.search, $options: 'i' } },
      { description: { $regex: options.search, $options: 'i' } },
    ];
  }
  const { page = 1, limit = 20 } = options;
  const skip = (page - 1) * limit;
  return this.find(query)
    .populate('officeId', 'name address')
    .populate('assignedAgentId', 'name hostname status')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));
};

// Static method to count by company
CameraSchema.statics.countByCompany = function (companyId) {
  return this.countDocuments({ companyId, isActive: true });
};

// Static method to count by status
CameraSchema.statics.countByStatus = async function (companyId) {
  const result = await this.aggregate([
    { $match: { companyId: new mongoose.Types.ObjectId(companyId), isActive: true } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  return result.reduce((acc, item) => {
    acc[item._id] = item.count;
    return acc;
  }, {});
};

// Static method to find by agent
CameraSchema.statics.findByAgent = function (agentId) {
  return this.find({ assignedAgentId: agentId, isActive: true });
};

// Static method to find offline cameras
CameraSchema.statics.findOffline = function (companyId) {
  return this.find({
    companyId,
    status: { $in: ['offline', 'error'] },
    isActive: true,
  });
};

// Method to mark online
CameraSchema.methods.markOnline = function () {
  this.status = 'online';
  this.consecutiveFailures = 0;
  this.lastError = null;
  this.lastErrorAt = null;
  return this.save();
};

// Method to mark offline
CameraSchema.methods.markOffline = function (errorMessage) {
  this.status = 'offline';
  this.lastError = errorMessage || 'Camera unreachable';
  this.lastErrorAt = new Date();
  // Note: consecutiveFailures is managed by the agent's local counter;
  // we only set it here if the agent didn't provide one in the status update.
  // The agent sends its own failure count, so we don't double-increment.
  return this.save();
};

// Method to mark error
CameraSchema.methods.markError = function (errorMessage) {
  this.status = 'error';
  this.lastError = errorMessage;
  this.lastErrorAt = new Date();
  return this.save();
};

module.exports = mongoose.model('Camera', CameraSchema);