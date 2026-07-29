const mongoose = require('mongoose');
const { Schema } = mongoose;

const SmsSchema = new Schema({
  companyId: {
    type: Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company ID is required'],
    index: true,
  },
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required'],
    index: true,
  },
  simId: {
    type: Schema.Types.ObjectId,
    ref: 'Sim',
    required: [true, 'SIM ID is required'],
    index: true,
  },
  simNumber: {
    type: String,
    required: [true, 'SIM number is required'],
    trim: true,
  },
  sender: {
    type: String,
    required: [true, 'Sender is required'],
    trim: true,
    maxlength: [50, 'Sender cannot exceed 50 characters'],
  },
  message: {
    type: String,
    required: [true, 'Message is required'],
    trim: true,
    maxlength: [5000, 'Message cannot exceed 5000 characters'],
  },
  type: {
    type: String,
    enum: ['inbox', 'sent'],
    required: [true, 'SMS type is required'],
    index: true,
  },
  timestamp: {
    type: Date,
    required: [true, 'Timestamp is required'],
    index: true,
  },
  syncedFrom: {
    type: String,
    enum: ['mobile', 'api', 'web'],
    default: 'mobile',
  },
  deviceId: {
    type: String,
    default: null,
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Indexes
SmsSchema.index({ companyId: 1, timestamp: -1 });
SmsSchema.index({ simId: 1, timestamp: -1 });
SmsSchema.index({ type: 1 });
SmsSchema.index({ sender: 1 });

// Compound index to prevent duplicates
SmsSchema.index({ simId: 1, timestamp: 1, sender: 1 }, { unique: true });

// Virtual for type display
SmsSchema.virtual('typeDisplay').get(function () {
  const types = {
    inbox: 'Inbox',
    sent: 'Sent',
  };
  return types[this.type] || 'Unknown';
});

// Static method to find by company with filters
SmsSchema.statics.findByCompany = function (companyId, options = {}) {
  const query = { companyId };

  if (options.userId) query.userId = options.userId;
  if (options.simId) query.simId = options.simId;
  if (options.type) query.type = options.type;

  if (options.sender) {
    query.sender = { $regex: options.sender, $options: 'i' };
  }

  if (options.search) {
    query.message = { $regex: options.search, $options: 'i' };
  }

  if (options.startDate || options.endDate) {
    query.timestamp = {};
    if (options.startDate) query.timestamp.$gte = new Date(options.startDate);
    if (options.endDate) query.timestamp.$lte = new Date(options.endDate);
  }

  const { page = 1, limit = 20 } = options;
  const skip = (page - 1) * limit;

  return this.find(query)
    .populate('simId', 'mobileNumber operator')
    .populate('userId', 'name email')
    .sort({ timestamp: -1 })
    .skip(skip)
    .limit(parseInt(limit));
};

// Static method to get SMS statistics
SmsSchema.statics.getStats = async function (companyId, startDate, endDate) {
  const match = { companyId: new mongoose.Types.ObjectId(companyId) };

  if (startDate || endDate) {
    match.timestamp = {};
    if (startDate) match.timestamp.$gte = new Date(startDate);
    if (endDate) match.timestamp.$lte = new Date(endDate);
  }

  const stats = await this.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$type',
        count: { $sum: 1 },
      },
    },
  ]);

  const totalSms = await this.countDocuments(match);
  const uniqueSenders = await this.distinct('sender', match);

  return {
    byType: stats,
    totalSms,
    uniqueSenders: uniqueSenders.length,
  };
};

// Static method to get daily SMS counts
SmsSchema.statics.getDailyCounts = async function (companyId, days = 30) {
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
          type: '$type',
        },
        count: { $sum: 1 },
      },
    },
    {
      $group: {
        _id: '$_id.date',
        inbox: {
          $sum: {
            $cond: [{ $eq: ['$_id.type', 'inbox'] }, '$count', 0],
          },
        },
        sent: {
          $sum: {
            $cond: [{ $eq: ['$_id.type', 'sent'] }, '$count', 0],
          },
        },
      },
    },
    { $sort: { _id: 1 } },
  ]);
};

// Static method to get top senders
SmsSchema.statics.getTopSenders = async function (companyId, limit = 10) {
  return this.aggregate([
    { $match: { companyId: new mongoose.Types.ObjectId(companyId), type: 'inbox' } },
    {
      $group: {
        _id: '$sender',
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
    { $limit: limit },
  ]);
};

// Static method to sync SMS from mobile device
SmsSchema.statics.syncFromDevice = async function (companyId, userId, simId, simNumber, smsList, deviceId) {
  const logger = require('../../utils/logger');

  logger.info('SMS syncFromDevice called', {
    companyId: companyId?.toString(),
    userId: userId?.toString(),
    simId: simId?.toString(),
    smsListCount: smsList?.length,
    deviceId,
  });

  if (!companyId || !userId || !simId) {
    logger.error('SMS syncFromDevice missing required fields', {
      companyId: companyId?.toString(),
      userId: userId?.toString(),
      simId: simId?.toString(),
    });
    throw new Error('companyId, userId, and simId are required');
  }

  if (!smsList || smsList.length === 0) {
    return { synced: 0, message: 'No SMS to sync' };
  }

  const bulkOps = smsList.map((sms) => ({
    updateOne: {
      filter: {
        simId,
        timestamp: new Date(sms.timestamp),
        sender: sms.sender,
      },
      update: {
        $setOnInsert: {
          companyId,
          userId,
          simId,
          simNumber,
          sender: sms.sender,
          message: sms.message,
          type: sms.type || 'inbox',
          timestamp: new Date(sms.timestamp),
          syncedFrom: 'mobile',
          deviceId,
        },
      },
      upsert: true,
    },
  }));

  logger.info('SMS Bulk operations prepared', {
    operationsCount: bulkOps.length,
  });

  try {
    if (bulkOps.length > 0) {
      const result = await this.bulkWrite(bulkOps);
      logger.info('SMS Bulk write result', {
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
        upsertedCount: result.upsertedCount,
      });
      return {
        synced: smsList.length,
        inserted: result.upsertedCount,
        matched: result.matchedCount,
      };
    }
    return { synced: 0 };
  } catch (error) {
    logger.error('SMS Bulk write error in syncFromDevice', {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
};

module.exports = mongoose.model('Sms', SmsSchema);