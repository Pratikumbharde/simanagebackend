const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Telegram Message Schema
 * Tracks Telegram messages sent to SIMs via SimTrack bot
 */
const TelegramMessageSchema = new Schema({
  // Company isolation - REQUIRED
  companyId: {
    type: Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company ID is required'],
    index: true,
  },
  // SIM reference
  simId: {
    type: Schema.Types.ObjectId,
    ref: 'Sim',
    required: [true, 'SIM ID is required'],
    index: true,
  },
  // Telegram chat ID
  chatId: {
    type: String,
    required: [true, 'Chat ID is required'],
    index: true,
  },
  // Message content
  message: {
    type: String,
    required: [true, 'Message is required'],
    maxlength: [4096, 'Telegram message cannot exceed 4096 characters'],
  },
  // Message status
  status: {
    type: String,
    enum: ['sent', 'delivered', 'failed', 'replied', 'inactive'],
    default: 'sent',
    index: true,
  },
  // Telegram message ID for tracking
  telegramMessageId: {
    type: Number,
    default: null,
  },
  // Timestamp when message was sent
  sentAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
  // Timestamp when reply was received
  repliedAt: {
    type: Date,
    default: null,
  },
  // Reply message content
  replyMessage: {
    type: String,
    default: null,
  },
  // Active status based on reply within 1 hour
  isActive: {
    type: Boolean,
    default: null, // null = pending, true = replied within 1 hour, false = no reply/inactive
  },
  // Option to update SIM status based on reply
  updateSimStatus: {
    type: Boolean,
    default: false,
  },
  // Bulk message batch ID for grouping
  batchId: {
    type: String,
    default: null,
    index: true,
  },
  // Error message if failed
  errorMessage: {
    type: String,
    default: null,
  },
  // Created by
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Compound indexes for efficient queries
TelegramMessageSchema.index({ companyId: 1, status: 1 });
TelegramMessageSchema.index({ companyId: 1, sentAt: -1 });
TelegramMessageSchema.index({ chatId: 1, sentAt: -1 });
TelegramMessageSchema.index({ simId: 1, sentAt: -1 });
TelegramMessageSchema.index({ status: 1, sentAt: 1 }); // For cron job

// Virtual for time elapsed since sent
TelegramMessageSchema.virtual('minutesSinceSent').get(function () {
  if (!this.sentAt) return null;
  return Math.floor((Date.now() - new Date(this.sentAt).getTime()) / (1000 * 60));
});

// Static method to find messages pending reply check
TelegramMessageSchema.statics.findPendingReplyCheck = function () {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  return this.find({
    status: { $in: ['sent', 'delivered'] },
    isActive: null,
    sentAt: { $lte: oneHourAgo },
  });
};

// Static method to find latest message by chat ID
TelegramMessageSchema.statics.findLatestByChatId = async function (chatId, companyId) {
  return this.findOne({
    chatId: String(chatId),
    companyId,
    status: { $in: ['sent', 'delivered'] },
  }).sort({ sentAt: -1 });
};

// Static method to get stats by company
TelegramMessageSchema.statics.getStatsByCompany = async function (companyId, startDate, endDate) {
  const match = { companyId: new mongoose.Types.ObjectId(companyId) };

  if (startDate || endDate) {
    match.sentAt = {};
    if (startDate) match.sentAt.$gte = new Date(startDate);
    if (endDate) match.sentAt.$lte = new Date(endDate);
  }

  const stats = await this.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
      },
    },
  ]);

  const result = {
    total: 0,
    sent: 0,
    delivered: 0,
    failed: 0,
    replied: 0,
    inactive: 0,
  };

  stats.forEach((item) => {
    result[item._id] = item.count;
    result.total += item.count;
  });

  return result;
};

module.exports = mongoose.model('TelegramMessage', TelegramMessageSchema);