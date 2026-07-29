const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Subscription History Schema
 * Tracks all subscription changes including upgrades, renewals, and downgrades
 */
const SubscriptionHistorySchema = new Schema({
  // Company that owns this subscription
  companyId: {
    type: Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    index: true,
  },

  // User who initiated the change
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },

  // Previous plan (null for new subscriptions)
  oldPlanId: {
    type: Schema.Types.ObjectId,
    ref: 'Subscription',
    required: false,
  },

  // New plan
  newPlanId: {
    type: Schema.Types.ObjectId,
    ref: 'Subscription',
    required: true,
  },

  // Previous plan name (for historical record)
  oldPlanName: {
    type: String,
    required: false,
  },

  // New plan name
  newPlanName: {
    type: String,
    required: true,
  },

  // Subscription dates
  startDate: {
    type: Date,
    required: true,
  },

  endDate: {
    type: Date,
    required: true,
  },

  // Bonus days applied (for upgrades)
  bonusDays: {
    type: Number,
    default: 0,
  },

  // Remaining days from previous plan (for upgrades)
  remainingDays: {
    type: Number,
    default: 0,
  },

  // Payment reference
  paymentId: {
    type: Schema.Types.ObjectId,
    ref: 'Payment',
    required: false,
  },

  // Type of change
  type: {
    type: String,
    enum: ['new', 'renewal', 'upgrade', 'downgrade', 'trial_convert'],
    required: true,
  },

  // Billing cycle
  billingCycle: {
    type: String,
    enum: ['monthly', 'yearly'],
    required: true,
  },

  // Amount paid
  amount: {
    type: Number,
    required: true,
  },

  // Currency
  currency: {
    type: String,
    default: 'INR',
  },

  // Additional notes
  notes: {
    type: String,
  },
}, {
  timestamps: true,
});

// Indexes for common queries
SubscriptionHistorySchema.index({ companyId: 1, createdAt: -1 });
SubscriptionHistorySchema.index({ type: 1 });
SubscriptionHistorySchema.index({ paymentId: 1 });

// Static method to get history for a company
SubscriptionHistorySchema.statics.getCompanyHistory = function(companyId, options = {}) {
  const { page = 1, limit = 20 } = options;
  const skip = (page - 1) * limit;

  return this.find({ companyId })
    .populate('oldPlanId', 'name')
    .populate('newPlanId', 'name')
    .populate('userId', 'name email')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
};

// Static method to get latest subscription change
SubscriptionHistorySchema.statics.getLatestChange = function(companyId) {
  return this.findOne({ companyId })
    .sort({ createdAt: -1 })
    .populate('oldPlanId', 'name')
    .populate('newPlanId', 'name');
};

// Static method to check for duplicate payment processing
SubscriptionHistorySchema.statics.isPaymentProcessed = async function(paymentId) {
  const history = await this.findOne({ paymentId });
  return !!history;
};

module.exports = mongoose.model('SubscriptionHistory', SubscriptionHistorySchema);