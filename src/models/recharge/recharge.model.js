const mongoose = require('mongoose');
const { Schema } = mongoose;

const RechargeSchema = new Schema({
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
  amount: {
    type: Number,
    required: [true, 'Recharge amount is required'],
    min: [0, 'Amount cannot be negative'],
  },
  plan: {
    name: { type: String, trim: true },
    validity: { type: Number }, // in days
    data: { type: String },
    calls: { type: String },
    sms: { type: String },
  },
  rechargeDate: {
    type: Date,
    default: Date.now,
  },
  nextRechargeDate: {
    type: Date,
    index: true,
  },
  validity: {
    type: Number,
    min: [1, 'Validity must be at least 1 day'],
  },
  paymentMethod: {
    type: String,
    enum: ['cash', 'upi', 'card', 'netbanking', 'wallet', 'other'],
    default: 'cash',
  },
  transactionId: {
    type: String,
    trim: true,
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded'],
    default: 'completed',
  },
  source: {
    type: String,
    enum: ['manual', 'AUTO_SMS'],
    default: 'manual',
  },
  smsText: {
    type: String,
    trim: true,
    default: null,
  },
  operator: {
    type: String,
    trim: true,
    enum: ['Jio', 'Airtel', 'Vi', 'BSNL', 'MTNL', 'Other', null],
    default: null,
  },
  reminderSent: {
    type: Boolean,
    default: false,
  },
  reminderSentAt: {
    type: Date,
    default: null,
  },
  notes: {
    type: String,
    trim: true,
    maxlength: [500, 'Notes cannot exceed 500 characters'],
  },
  receiptImage: {
    type: String,
    default: null,
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
RechargeSchema.index({ companyId: 1, simId: 1 });
RechargeSchema.index({ companyId: 1, rechargeDate: -1 });
RechargeSchema.index({ companyId: 1, nextRechargeDate: 1 });
RechargeSchema.index({ simId: 1, rechargeDate: -1 });
RechargeSchema.index({ status: 1 });
RechargeSchema.index({ source: 1 });

// Compound index for upcoming recharges
RechargeSchema.index({ nextRechargeDate: 1, reminderSent: 1 });

// Compound index for duplicate detection (auto-recharge)
RechargeSchema.index({ simId: 1, source: 1, rechargeDate: -1 });

// Pre-save hook to calculate next recharge date
RechargeSchema.pre('save', function (next) {
  if (this.isModified('validity') || this.isNew) {
    if (this.validity && this.validity > 0) {
      this.nextRechargeDate = new Date(this.rechargeDate);
      this.nextRechargeDate.setDate(this.nextRechargeDate.getDate() + this.validity);
    }
  }
  next();
});

// Virtual for days until next recharge
RechargeSchema.virtual('daysUntilRecharge').get(function () {
  if (!this.nextRechargeDate) return null;
  const diff = this.nextRechargeDate - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
});

// Virtual for recharge status
RechargeSchema.virtual('rechargeStatus').get(function () {
  if (!this.nextRechargeDate) return 'unknown';
  const daysLeft = this.daysUntilRecharge;
  if (daysLeft < 0) return 'overdue';
  if (daysLeft <= 3) return 'due_soon';
  return 'active';
});

// Static method to find by company
RechargeSchema.statics.findByCompany = function (companyId, options = {}) {
  const query = { companyId };
  if (options.status) query.status = options.status;
  if (options.startDate || options.endDate) {
    query.rechargeDate = {};
    if (options.startDate) query.rechargeDate.$gte = options.startDate;
    if (options.endDate) query.rechargeDate.$lte = options.endDate;
  }
  return this.find(query)
    .populate('simId', 'mobileNumber operator')
    .sort({ rechargeDate: -1 });
};

// Static method to find upcoming recharges
RechargeSchema.statics.findUpcoming = function (companyId, days = 7) {
  const now = new Date();
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + days);

  return this.find({
    companyId,
    nextRechargeDate: {
      $gte: now,
      $lte: futureDate,
    },
    status: 'completed',
  }).populate('simId', 'mobileNumber operator');
};

// Static method to find overdue recharges
RechargeSchema.statics.findOverdue = function (companyId) {
  return this.find({
    companyId,
    nextRechargeDate: { $lt: new Date() },
    status: 'completed',
  }).populate('simId', 'mobileNumber operator');
};

// Static method to get total spent
RechargeSchema.statics.getTotalSpent = async function (companyId, startDate, endDate) {
  const query = { companyId, status: 'completed' };
  if (startDate || endDate) {
    query.rechargeDate = {};
    if (startDate) query.rechargeDate.$gte = startDate;
    if (endDate) query.rechargeDate.$lte = endDate;
  }

  const result = await this.aggregate([
    { $match: query },
    { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
  ]);

  return result.length > 0 ? result[0] : { total: 0, count: 0 };
};

// Static method to get recharge history for a SIM
RechargeSchema.statics.getSimHistory = function (simId, limit = 10) {
  return this.find({ simId })
    .sort({ rechargeDate: -1 })
    .limit(limit);
};

module.exports = mongoose.model('Recharge', RechargeSchema);