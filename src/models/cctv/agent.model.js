const mongoose = require('mongoose');
const { Schema } = mongoose;
const crypto = require('crypto');

/**
 * Agent Model
 * Represents a Camera Agent (Electron desktop app) installed on a Windows PC
 * in a company office. Authenticates via activation code, receives JWT token,
 * captures snapshots from cameras, and uploads to the cloud.
 */
const AgentSchema = new Schema({
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
    required: [true, 'Agent name is required'],
    trim: true,
    maxlength: [100, 'Agent name cannot exceed 100 characters'],
  },
  // Machine identification
  machineId: {
    type: String,
    unique: true,
    required: [true, 'Machine ID is required'],
    trim: true,
    index: true,
  },
  hostname: {
    type: String,
    trim: true,
    default: '',
  },
  osVersion: {
    type: String,
    trim: true,
    default: '',
  },
  agentVersion: {
    type: String,
    trim: true,
    default: '1.0.0',
  },
  // Authentication
  activationCodeId: {
    type: Schema.Types.ObjectId,
    ref: 'ActivationCode',
    default: null,
  },
  token: {
    type: String,
    default: null,
    select: false, // Never return token in queries by default
  },
  tokenExpires: {
    type: Date,
    default: null,
    select: false,
  },
  // Status
  status: {
    type: String,
    enum: ['active', 'inactive', 'suspended'],
    default: 'active',
    index: true,
  },
  lastHeartbeat: {
    type: Date,
    default: null,
  },
  lastSyncAt: {
    type: Date,
    default: null,
  },
  // Statistics
  totalSnapshotsUploaded: {
    type: Number,
    default: 0,
    min: 0,
  },
  totalFailedUploads: {
    type: Number,
    default: 0,
    min: 0,
  },
  // Config versioning for sync
  configVersion: {
    type: Number,
    default: 0,
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
AgentSchema.index({ companyId: 1, status: 1 });
AgentSchema.index({ status: 1, lastHeartbeat: 1 });
AgentSchema.index({ companyId: 1, isActive: 1 });

// Virtual for online status (heartbeat in last 10 minutes)
AgentSchema.virtual('isOnline').get(function () {
  if (!this.lastHeartbeat) return false;
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  return this.lastHeartbeat > tenMinutesAgo;
});

// Virtual for status display
AgentSchema.virtual('statusDisplay').get(function () {
  if (!this.isActive) return 'disabled';
  if (this.status === 'suspended') return 'suspended';
  return this.isOnline ? 'online' : 'offline';
});

// Static method to find by company
AgentSchema.statics.findByCompany = function (companyId, options = {}) {
  const query = { companyId, isActive: true };
  if (options.status) query.status = options.status;
  if (options.officeId) query.officeId = options.officeId;

  const { page = 1, limit = 20 } = options;
  const skip = (page - 1) * limit;
  return this.find(query)
    .populate('officeId', 'name address')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));
};

// Static method to find active agents by company
AgentSchema.statics.findActiveByCompany = function (companyId) {
  return this.find({ companyId, isActive: true, status: 'active' });
};

// Static method to count by company
AgentSchema.statics.countByCompany = function (companyId) {
  return this.countDocuments({ companyId, isActive: true });
};

// Static method to find offline agents (no heartbeat for 10+ minutes)
AgentSchema.statics.findOfflineAgents = function (companyId) {
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  return this.find({
    companyId,
    isActive: true,
    status: 'active',
    $or: [
      { lastHeartbeat: { $lt: tenMinutesAgo } },
      { lastHeartbeat: null },
    ],
  });
};

// Static method to find by machine ID
AgentSchema.statics.findByMachineId = function (machineId) {
  return this.findOne({ machineId, isActive: true });
};

// Method to generate authentication token
AgentSchema.methods.generateAuthToken = function () {
  const jwt = require('jsonwebtoken');
  const config = require('../../config');

  const token = jwt.sign(
    {
      id: this._id,
      companyId: this.companyId,
      role: 'agent',
      type: 'agent_token',
      name: this.name,
    },
    config.jwt.secret,
    { expiresIn: '7d' }
  );

  this.token = token;
  this.tokenExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  return this.save().then(() => token);
};

// Method to update heartbeat
AgentSchema.methods.updateHeartbeat = function (data = {}) {
  this.lastHeartbeat = new Date();
  if (data.agentVersion) this.agentVersion = data.agentVersion;
  if (data.hostname) this.hostname = data.hostname;
  if (data.osVersion) this.osVersion = data.osVersion;
  if (data.totalSnapshotsUploaded !== undefined) this.totalSnapshotsUploaded = data.totalSnapshotsUploaded;
  if (data.totalFailedUploads !== undefined) this.totalFailedUploads = data.totalFailedUploads;
  return this.save();
};

// Method to increment snapshot count
AgentSchema.methods.incrementSnapshotCount = function (count = 1) {
  this.totalSnapshotsUploaded += count;
  return this.save();
};

// Method to increment failure count
AgentSchema.methods.incrementFailureCount = function (count = 1) {
  this.totalFailedUploads += count;
  return this.save();
};

module.exports = mongoose.model('Agent', AgentSchema);