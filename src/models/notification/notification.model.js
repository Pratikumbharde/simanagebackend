const mongoose = require('mongoose');
const { Schema } = mongoose;

const NotificationSchema = new Schema({
  companyId: {
    type: Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company ID is required'],
    index: true,
  },
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    index: true,
  },
  type: {
    type: String,
    enum: ['recharge_due', 'inactive_sim', 'subscription_expiry', 'system', 'alert', 'info', 'wifi_alert', 'security'],
    required: [true, 'Notification type is required'],
  },
  title: {
    type: String,
    required: [true, 'Title is required'],
    trim: true,
    maxlength: [100, 'Title cannot exceed 100 characters'],
  },
  message: {
    type: String,
    required: [true, 'Message is required'],
    trim: true,
    maxlength: [500, 'Message cannot exceed 500 characters'],
  },
  // [HIGHLIGHT FIX] Metadata for frontend highlighting
  // Contains extracted entity names for proper display
  metadata: {
    companyName: { type: String },
    userName: { type: String },
    simNumber: { type: String },
    amount: { type: Number },
    planName: { type: String },
    daysLeft: { type: Number },
    expiryDate: { type: Date },
    // WiFi alert metadata
    wifiName: { type: String },
    avgSpeed: { type: Number },
    threshold: { type: Number },
    alertType: { type: String },
    customData: { type: Schema.Types.Mixed },
  },
  data: {
    simId: { type: Schema.Types.ObjectId, ref: 'Sim' },
    rechargeId: { type: Schema.Types.ObjectId, ref: 'Recharge' },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company' },
    wifiId: { type: Schema.Types.ObjectId, ref: 'WifiNetwork' },
    alertId: { type: Schema.Types.ObjectId, ref: 'WifiAlert' },
    customData: { type: Schema.Types.Mixed },
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium',
  },
  channels: {
    email: { type: Boolean, default: false },
    sms: { type: Boolean, default: false },
    inApp: { type: Boolean, default: true },
  },
  status: {
    type: String,
    enum: ['pending', 'sent', 'delivered', 'failed', 'read'],
    default: 'pending',
  },
  isRead: {
    type: Boolean,
    default: false,
  },
  readAt: {
    type: Date,
    default: null,
  },
  sentAt: {
    type: Date,
    default: null,
  },
  sentVia: [{
    channel: { type: String, enum: ['email', 'sms', 'push', 'in_app'] },
    sentAt: { type: Date },
    status: { type: String, enum: ['success', 'failed'] },
    error: { type: String },
  }],
  expiresAt: {
    type: Date,
    default: function () {
      const date = new Date();
      date.setDate(date.getDate() + 30); // 30 days expiry
      return date;
    },
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Indexes
NotificationSchema.index({ companyId: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, isRead: 1 });
NotificationSchema.index({ type: 1 });
NotificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index
NotificationSchema.index({ status: 1 });

// Virtual for time since creation
NotificationSchema.virtual('timeAgo').get(function () {
  const diff = Date.now() - this.createdAt;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'Just now';
});

// Static method to find by company
NotificationSchema.statics.findByCompany = function (companyId, options = {}) {
  const query = { companyId };

  if (options.type) query.type = options.type;
  if (options.isRead !== undefined) query.isRead = options.isRead;
  if (options.priority) query.priority = options.priority;

  const { page = 1, limit = 20 } = options;
  const skip = (page - 1) * limit;

  return this.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));
};

// Static method to find by user
NotificationSchema.statics.findByUser = function (userId, options = {}) {
  const query = { userId };

  if (options.isRead !== undefined) query.isRead = options.isRead;

  const { page = 1, limit = 20 } = options;
  const skip = (page - 1) * limit;

  return this.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));
};

// Static method to get unread count
NotificationSchema.statics.getUnreadCount = async function (userId) {
  return this.countDocuments({ userId, isRead: false });
};

// Static method to get unread count by company
NotificationSchema.statics.getCompanyUnreadCount = async function (companyId) {
  return this.countDocuments({ companyId, isRead: false });
};

// Static method to create recharge reminder
NotificationSchema.statics.createRechargeReminder = async function (company, sim, recharge, daysLeft) {
  return this.create({
    companyId: company._id,
    userId: company.createdBy,
    type: 'recharge_due',
    title: `Recharge Reminder - ${sim.mobileNumber}`,
    message: `Your SIM ${sim.mobileNumber} (${sim.operator}) recharge is due in ${daysLeft} days. Next recharge date: ${recharge.nextRechargeDate.toDateString()}`,
    priority: daysLeft <= 1 ? 'critical' : daysLeft <= 3 ? 'high' : 'medium',
    metadata: {
      companyName: company.name,
      simNumber: sim.mobileNumber,
      daysLeft: daysLeft,
      expiryDate: recharge.nextRechargeDate,
    },
    data: { simId: sim._id, rechargeId: recharge._id },
    channels: { email: true, sms: false, inApp: true },
  });
};

// Static method to create inactive SIM alert
NotificationSchema.statics.createInactiveSimAlert = async function (company, sim) {
  return this.create({
    companyId: company._id,
    userId: company.createdBy,
    type: 'inactive_sim',
    title: `Inactive SIM Alert - ${sim.mobileNumber}`,
    message: `SIM ${sim.mobileNumber} (${sim.operator}) has been inactive for more than ${company.settings.inactiveSimDays} days. Please check the SIM status.`,
    priority: 'high',
    metadata: {
      companyName: company.name,
      simNumber: sim.mobileNumber,
    },
    data: { simId: sim._id },
    channels: { email: true, sms: false, inApp: true },
  });
};

// Static method to create subscription expiry notice
NotificationSchema.statics.createSubscriptionExpiry = async function (company, daysLeft) {
  return this.create({
    companyId: company._id,
    userId: company.createdBy,
    type: 'subscription_expiry',
    title: 'Subscription Expiring Soon',
    message: `Your subscription will expire in ${daysLeft} days. Please renew to continue using all features.`,
    priority: daysLeft <= 3 ? 'critical' : 'high',
    metadata: {
      companyName: company.name,
      planName: company.subscriptionId?.name,
      daysLeft: daysLeft,
      expiryDate: company.subscriptionEndDate,
    },
    data: { companyId: company._id },
    channels: { email: true, sms: true, inApp: true },
  });
};

// Method to mark as read
NotificationSchema.methods.markAsRead = async function () {
  this.isRead = true;
  this.readAt = new Date();
  this.status = 'read';
  return this.save();
};

// Method to mark as sent
NotificationSchema.methods.markAsSent = function (channel, success = true, error = null) {
  this.sentVia.push({
    channel,
    sentAt: new Date(),
    status: success ? 'success' : 'failed',
    error,
  });
  this.status = success ? 'sent' : 'failed';
  this.sentAt = new Date();
  return this.save();
};

module.exports = mongoose.model('Notification', NotificationSchema);