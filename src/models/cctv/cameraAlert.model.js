const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * CameraAlert Model
 * Tracks alerts generated when cameras go offline, encounter errors,
 * or when agents become unavailable.
 */
const CameraAlertSchema = new Schema({
  companyId: {
    type: Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company ID is required'],
    index: true,
  },
  cameraId: {
    type: Schema.Types.ObjectId,
    ref: 'Camera',
    default: null,
  },
  agentId: {
    type: Schema.Types.ObjectId,
    ref: 'Agent',
    default: null,
  },
  alertType: {
    type: String,
    enum: ['camera_offline', 'camera_error', 'snapshot_failed', 'agent_offline', 'agent_error'],
    required: [true, 'Alert type is required'],
  },
  message: {
    type: String,
    required: [true, 'Alert message is required'],
    trim: true,
    maxlength: [500, 'Alert message cannot exceed 500 characters'],
  },
  status: {
    type: String,
    enum: ['active', 'acknowledged', 'resolved'],
    default: 'active',
    index: true,
  },
  resolvedAt: {
    type: Date,
    default: null,
  },
  resolvedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  acknowledgedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  acknowledgedAt: {
    type: Date,
    default: null,
  },
  resolutionNote: {
    type: String,
    default: null,
    trim: true,
  },
  // Additional metadata
  metadata: {
    type: Schema.Types.Mixed,
    default: {},
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Indexes
CameraAlertSchema.index({ companyId: 1, status: 1 });
CameraAlertSchema.index({ cameraId: 1, status: 1 });
CameraAlertSchema.index({ alertType: 1, status: 1 });
CameraAlertSchema.index({ companyId: 1, createdAt: -1 });

// Virtual for duration (how long the alert has been active)
CameraAlertSchema.virtual('duration').get(function () {
  if (this.status === 'resolved' && this.resolvedAt) {
    return this.resolvedAt - this.createdAt;
  }
  return Date.now() - this.createdAt;
});

// Static method to find active alerts by company
CameraAlertSchema.statics.findActiveByCompany = function (companyId, options = {}) {
  const query = { companyId, status: 'active' };
  if (options.alertType) query.alertType = options.alertType;
  if (options.cameraId) query.cameraId = options.cameraId;

  const { page = 1, limit = 20 } = options;
  const skip = (page - 1) * limit;
  return this.find(query)
    .populate('cameraId', 'name ipAddress status')
    .populate('agentId', 'name hostname status')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));
};

// Static method to find by company (all statuses)
CameraAlertSchema.statics.findByCompany = function (companyId, options = {}) {
  const query = { companyId };
  if (options.status) query.status = options.status;
  if (options.alertType) query.alertType = options.alertType;
  if (options.cameraId) query.cameraId = options.cameraId;

  const { page = 1, limit = 20 } = options;
  const skip = (page - 1) * limit;
  return this.find(query)
    .populate('cameraId', 'name ipAddress status')
    .populate('agentId', 'name hostname status')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));
};

// Static method to count active alerts
CameraAlertSchema.statics.countActiveByCompany = function (companyId) {
  return this.countDocuments({ companyId, status: 'active' });
};

// Static method to create a camera offline alert (prevents duplicates)
CameraAlertSchema.statics.createCameraOfflineAlert = async function (companyId, cameraId, agentId, message) {
  // Check if there's already an active alert for this camera
  const existing = await this.findOne({
    companyId,
    cameraId,
    alertType: 'camera_offline',
    status: 'active',
  });

  if (existing) {
    // Update the existing alert's timestamp and message
    existing.message = message;
    return existing.save();
  }

  return this.create({
    companyId,
    cameraId,
    agentId,
    alertType: 'camera_offline',
    message,
    status: 'active',
  });
};

// Static method to create an agent offline alert (prevents duplicates)
CameraAlertSchema.statics.createAgentOfflineAlert = async function (companyId, agentId, message) {
  // Check if there's already an active alert for this agent
  const existing = await this.findOne({
    companyId,
    agentId,
    alertType: 'agent_offline',
    status: 'active',
  });

  if (existing) {
    // Update the existing alert's timestamp and message
    existing.message = message;
    return existing.save();
  }

  return this.create({
    companyId,
    agentId,
    alertType: 'agent_offline',
    message,
    status: 'active',
  });
};

// Method to acknowledge
CameraAlertSchema.methods.acknowledge = function (userId) {
  this.status = 'acknowledged';
  this.acknowledgedBy = userId;
  this.acknowledgedAt = new Date();
  return this.save();
};

// Method to resolve
CameraAlertSchema.methods.resolve = function (userId, resolutionNote) {
  this.status = 'resolved';
  this.resolvedAt = new Date();
  this.resolvedBy = userId;
  if (resolutionNote) {
    this.resolutionNote = resolutionNote;
  }
  return this.save();
};

module.exports = mongoose.model('CameraAlert', CameraAlertSchema);