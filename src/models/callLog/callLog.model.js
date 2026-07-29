const mongoose = require('mongoose');
const { Schema } = mongoose;

const CallLogSchema = new Schema({
  companyId: {
    type: Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company ID is required'],
    index: true,
  },
  simId: {
    type: Schema.Types.ObjectId,
    ref: 'Sim',
    required: [true, 'SIM ID is required'],
    index: true,
  },
  phoneNumber: {
    type: String,
    required: [true, 'Phone number is required'],
    trim: true,
  },
  callType: {
    type: String,
    enum: ['incoming', 'outgoing', 'missed'],
    required: [true, 'Call type is required'],
  },
  duration: {
    type: Number,
    default: 0, // in seconds
    min: [0, 'Duration cannot be negative'],
  },
  timestamp: {
    type: Date,
    required: [true, 'Call timestamp is required'],
    index: true,
  },
  syncedFrom: {
    type: String,
    enum: ['web', 'mobile', 'api'],
    default: 'web',
  },
  deviceId: {
    type: String,
    default: null,
  },
  contactName: {
    type: String,
    trim: true,
    default: null,
  },
  notes: {
    type: String,
    trim: true,
    maxlength: [200, 'Notes cannot exceed 200 characters'],
  },
  isFlagged: {
    type: Boolean,
    default: false,
  },
  flaggedReason: {
    type: String,
    default: null,
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Indexes
CallLogSchema.index({ companyId: 1, timestamp: -1 });
CallLogSchema.index({ simId: 1, timestamp: -1 });
CallLogSchema.index({ callType: 1 });
CallLogSchema.index({ phoneNumber: 1 });

// Compound index for analytics
CallLogSchema.index({ companyId: 1, callType: 1, timestamp: -1 });

// Virtual for formatted duration
CallLogSchema.virtual('formattedDuration').get(function () {
  const hours = Math.floor(this.duration / 3600);
  const minutes = Math.floor((this.duration % 3600) / 60);
  const seconds = this.duration % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
});

// Virtual for call type display
CallLogSchema.virtual('callTypeDisplay').get(function () {
  const types = {
    incoming: 'Incoming Call',
    outgoing: 'Outgoing Call',
    missed: 'Missed Call',
  };
  return types[this.callType] || 'Unknown';
});

// Static method to find by company
CallLogSchema.statics.findByCompany = function (companyId, options = {}) {
  const query = { companyId };

  if (options.simId) query.simId = options.simId;
  if (options.callType) query.callType = options.callType;
  if (options.startDate || options.endDate) {
    query.timestamp = {};
    if (options.startDate) query.timestamp.$gte = options.startDate;
    if (options.endDate) query.timestamp.$lte = options.endDate;
  }
  if (options.phoneNumber) {
    query.phoneNumber = { $regex: options.phoneNumber, $options: 'i' };
  }

  const { page = 1, limit = 20 } = options;
  const skip = (page - 1) * limit;

  return this.find(query)
    .populate('simId', 'mobileNumber operator')
    .sort({ timestamp: -1 })
    .skip(skip)
    .limit(parseInt(limit));
};

// Static method to get call statistics
CallLogSchema.statics.getStats = async function (companyId, startDate, endDate, filters = {}) {
  const match = { companyId: new mongoose.Types.ObjectId(companyId) };
  if (startDate || endDate) {
    match.timestamp = {};
    if (startDate) match.timestamp.$gte = new Date(startDate);
    if (endDate) match.timestamp.$lte = new Date(endDate);
  }
  if (filters.simId) match.simId = new mongoose.Types.ObjectId(filters.simId);
  if (filters.callType) match.callType = filters.callType;
  if (filters.phoneNumber) {
    const escaped = filters.phoneNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    match.phoneNumber = { $regex: escaped, $options: 'i' };
  }

  const stats = await this.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$callType',
        count: { $sum: 1 },
        totalDuration: { $sum: '$duration' },
        avgDuration: { $avg: '$duration' },
      },
    },
  ]);

  const totalCalls = await this.countDocuments(match);
  const uniqueNumbers = await this.distinct('phoneNumber', match);

  return {
    byType: stats,
    totalCalls,
    uniqueNumbers: uniqueNumbers.length,
  };
};

// Static method to get daily call counts
CallLogSchema.statics.getDailyCounts = async function (companyId, days = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  return this.aggregate([
    {
      $match: {
        companyId: new mongoose.Types.ObjectId(companyId),
        timestamp: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
          callType: '$callType',
        },
        count: { $sum: 1 },
        totalDuration: { $sum: '$duration' },
      },
    },
    {
      $group: {
        _id: '$_id.date',
        incoming: {
          $sum: {
            $cond: [{ $eq: ['$_id.callType', 'incoming'] }, '$count', 0],
          },
        },
        outgoing: {
          $sum: {
            $cond: [{ $eq: ['$_id.callType', 'outgoing'] }, '$count', 0],
          },
        },
        missed: {
          $sum: {
            $cond: [{ $eq: ['$_id.callType', 'missed'] }, '$count', 0],
          },
        },
        totalDuration: { $sum: '$totalDuration' },
      },
    },
    { $sort: { _id: 1 } },
  ]);
};

// Static method to get top contacts
CallLogSchema.statics.getTopContacts = async function (companyId, limit = 10) {
  return this.aggregate([
    { $match: { companyId: new mongoose.Types.ObjectId(companyId) } },
    {
      $group: {
        _id: '$phoneNumber',
        totalCalls: { $sum: 1 },
        totalDuration: { $sum: '$duration' },
        incoming: {
          $sum: { $cond: [{ $eq: ['$callType', 'incoming'] }, 1, 0] },
        },
        outgoing: {
          $sum: { $cond: [{ $eq: ['$callType', 'outgoing'] }, 1, 0] },
        },
      },
    },
    { $sort: { totalCalls: -1 } },
    { $limit: limit },
  ]);
};

// Method to sync from mobile device
CallLogSchema.statics.syncFromDevice = async function (companyId, simId, callLogs, deviceId) {
  const logger = require('../../utils/logger');

  logger.info('syncFromDevice called', {
    companyId: companyId?.toString(),
    simId: simId?.toString(),
    callLogsCount: callLogs?.length,
    deviceId
  });

  if (!companyId || !simId) {
    logger.error('syncFromDevice missing required fields', {
      companyId: companyId?.toString(),
      simId: simId?.toString()
    });
    throw new Error('companyId and simId are required');
  }

  if (!callLogs || callLogs.length === 0) {
    return { synced: 0, message: 'No call logs to sync' };
  }

  const bulkOps = callLogs.map((log) => ({
    updateOne: {
      filter: {
        companyId,
        simId,
        phoneNumber: log.phoneNumber,
        timestamp: new Date(log.timestamp),
        callType: log.callType,
      },
      update: {
        $setOnInsert: {
          companyId,
          simId,
          phoneNumber: log.phoneNumber,
          callType: log.callType,
          duration: log.duration || 0,
          timestamp: new Date(log.timestamp),
          syncedFrom: 'mobile',
          deviceId,
          contactName: log.contactName || null,
        },
      },
      upsert: true,
    },
  }));

  logger.info('Bulk operations prepared', {
    operationsCount: bulkOps.length,
    firstOperation: bulkOps[0] ? JSON.stringify(bulkOps[0].updateOne.filter) : null
  });

  try {
    if (bulkOps.length > 0) {
      const result = await this.bulkWrite(bulkOps);
      logger.info('Bulk write result', {
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
        upsertedCount: result.upsertedCount,
        upsertedIds: result.upsertedIds
      });
      return {
        synced: callLogs.length,
        inserted: result.upsertedCount,
        matched: result.matchedCount
      };
    }
    return { synced: 0 };
  } catch (error) {
    logger.error('Bulk write error in syncFromDevice', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
};

module.exports = mongoose.model('CallLog', CallLogSchema);