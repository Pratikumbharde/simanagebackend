const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * AgentLog Model
 * Tracks activity logs from Camera Agents for debugging and monitoring.
 * Uses TTL index to auto-delete logs older than 30 days.
 */
const AgentLogSchema = new Schema({
  companyId: {
    type: Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company ID is required'],
    index: true,
  },
  agentId: {
    type: Schema.Types.ObjectId,
    ref: 'Agent',
    required: [true, 'Agent ID is required'],
    index: true,
  },
  level: {
    type: String,
    enum: ['info', 'warning', 'error'],
    default: 'info',
  },
  event: {
    type: String,
    required: [true, 'Event type is required'],
    enum: [
      'agent_started',
      'agent_stopped',
      'heartbeat',
      'config_synced',
      'camera_connected',
      'camera_disconnected',
      'camera_error',
      'snapshot_captured',
      'snapshot_uploaded',
      'snapshot_failed',
      'upload_retry',
      'upload_queue_full',
      'agent_updated',
    ],
  },
  message: {
    type: String,
    required: [true, 'Log message is required'],
    trim: true,
    maxlength: [1000, 'Log message cannot exceed 1000 characters'],
  },
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
AgentLogSchema.index({ agentId: 1, createdAt: -1 });
AgentLogSchema.index({ companyId: 1, createdAt: -1 });
AgentLogSchema.index({ event: 1 });
AgentLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2592000 }); // TTL: 30 days

// Static method to find by agent
AgentLogSchema.statics.findByAgent = function (agentId, options = {}) {
  const query = { agentId };
  if (options.level) query.level = options.level;
  if (options.event) query.event = options.event;

  const { page = 1, limit = 50 } = options;
  const skip = (page - 1) * limit;
  return this.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));
};

// Static method to find by company
AgentLogSchema.statics.findByCompany = function (companyId, options = {}) {
  const query = { companyId };
  if (options.level) query.level = options.level;
  if (options.event) query.event = options.event;
  if (options.agentId) query.agentId = options.agentId;

  const { page = 1, limit = 50 } = options;
  const skip = (page - 1) * limit;
  return this.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));
};

// Static method to count errors by agent
AgentLogSchema.statics.countErrorsByAgent = function (agentId, since = null) {
  const query = { agentId, level: 'error' };
  if (since) query.createdAt = { $gte: since };
  return this.countDocuments(query);
};

module.exports = mongoose.model('AgentLog', AgentLogSchema);