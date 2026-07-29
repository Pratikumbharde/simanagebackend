/**
 * Call Attempt Model
 *
 * Tracks individual call attempts made by the call automation system.
 * Each record represents one call from a caller SIM to a target SIM,
 * with the resulting status (connected, rejected, switched_off, unreachable, unknown).
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

const CallAttemptSchema = new Schema({
  companyId: {
    type: Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company ID is required'],
    index: true,
  },
  configId: {
    type: Schema.Types.ObjectId,
    ref: 'CallAutomationConfig',
    required: [true, 'Config ID is required'],
    index: true,
  },
  callerSimId: {
    type: Schema.Types.ObjectId,
    ref: 'Sim',
    default: null,
  },
  callerSimNumber: {
    type: String,
    trim: true,
    default: '',
  },
  targetSimId: {
    type: Schema.Types.ObjectId,
    ref: 'Sim',
    default: null,
  },
  targetSimNumber: {
    type: String,
    required: [true, 'Target SIM number is required'],
    trim: true,
  },
  status: {
    type: String,
    enum: ['connected', 'rejected', 'switched_off', 'unreachable', 'unknown'],
    default: 'unknown',
  },
  callDuration: {
    type: Number,
    default: 0,
    min: 0,
  },
  attemptedAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
}, {
  timestamps: true,
});

// Compound indexes for efficient queries
CallAttemptSchema.index({ companyId: 1, attemptedAt: -1 });
CallAttemptSchema.index({ companyId: 1, status: 1 });
CallAttemptSchema.index({ targetSimNumber: 1 });

// Static: find recent attempts for a company
CallAttemptSchema.statics.findRecentByCompany = function (companyId, limit = 100) {
  return this.find({ companyId })
    .sort({ attemptedAt: -1 })
    .limit(limit)
    .lean();
};

// Static: find attempts for a specific config
CallAttemptSchema.statics.findByConfig = function (configId, limit = 100) {
  return this.find({ configId })
    .sort({ attemptedAt: -1 })
    .limit(limit)
    .lean();
};

// Static: get latest status for each target SIM in a company
CallAttemptSchema.statics.getLatestStatusPerTarget = function (companyId) {
  return this.aggregate([
    { $match: { companyId: new mongoose.Types.ObjectId(companyId) } },
    { $sort: { attemptedAt: -1 } },
    {
      $group: {
        _id: '$targetSimNumber',
        status: { $first: '$status' },
        callDuration: { $first: '$callDuration' },
        attemptedAt: { $first: '$attemptedAt' },
        callerSimNumber: { $first: '$callerSimNumber' },
        targetSimNumber: { $first: '$targetSimNumber' },
      },
    },
    { $sort: { attemptedAt: -1 } },
  ]);
};

module.exports = mongoose.model('CallAttempt', CallAttemptSchema);