const mongoose = require('mongoose');
const { Schema } = mongoose;

const PaymentSchema = new Schema({
  // Company that made the payment (null for registration payments, updated after verification)
  companyId: {
    type: Schema.Types.ObjectId,
    ref: 'Company',
    required: false,
    index: true,
  },

  // User who initiated the payment (null for registration payments, updated after verification)
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: false,
  },

  // Denormalized company/user info — preserves names even if company/user is deleted
  companyName: {
    type: String,
    required: false,
  },
  companyEmail: {
    type: String,
    required: false,
  },
  userName: {
    type: String,
    required: false,
  },
  userEmail: {
    type: String,
    required: false,
  },

  // Subscription plan purchased
  subscriptionId: {
    type: Schema.Types.ObjectId,
    ref: 'Subscription',
    required: true,
  },

  // Plan details at time of purchase
  planName: {
    type: String,
    required: true,
  },
  planDuration: {
    type: Number,
    required: true, // in days
  },

  // Amount details
  amount: {
    type: Number,
    required: true,
  },
  currency: {
    type: String,
    default: 'INR',
  },
  billingCycle: {
    type: String,
    enum: ['monthly', 'yearly'],
    required: true,
  },

  // Razorpay IDs
  razorpayOrderId: {
    type: String,
    required: true,
    index: true,
  },
  razorpayPaymentId: {
    type: String,
    sparse: true,
  },
  razorpaySignature: {
    type: String,
    sparse: true,
  },

  // Payment status
  status: {
    type: String,
    enum: ['created', 'pending', 'completed', 'failed', 'refunded'],
    default: 'created',
    index: true,
  },

  // Payment method (from Razorpay)
  paymentMethod: {
    type: String,
    enum: ['card', 'netbanking', 'wallet', 'upi', 'emi', 'card_emi', 'other'],
    sparse: true,
  },

  // Bank/Card info (from Razorpay)
  bank: String,
  wallet: String,
  vpa: String, // UPI ID
  cardId: String,
  cardLast4: String,
  cardNetwork: String,

  // Timestamps
  paidAt: Date,
  failedAt: Date,
  refundedAt: Date,

  // Refund details
  refundAmount: Number,
  refundReason: String,

  // Invoice
  invoiceNumber: {
    type: String,
    sparse: true,
    unique: true,
  },

  // Notes
  notes: String,
}, {
  timestamps: true,
});

// Indexes
PaymentSchema.index({ companyId: 1, status: 1 });
PaymentSchema.index({ createdAt: -1 });
// razorpayOrderId index is already created by index: true in schema definition

// Generate invoice number before saving
PaymentSchema.pre('save', async function(next) {
  if (this.status === 'completed' && !this.invoiceNumber) {
    const count = await mongoose.models.Payment.countDocuments({
      status: 'completed',
      invoiceNumber: { $exists: true }
    });
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    this.invoiceNumber = `INV-${year}${month}-${String(count + 1).padStart(5, '0')}`;
  }
  next();
});

// Static methods
PaymentSchema.statics.findByCompany = function(companyId, options = {}) {
  const query = { companyId };
  if (options.status) query.status = options.status;

  return this.find(query)
    .populate('subscriptionId', 'name')
    .populate('userId', 'name email')
    .sort({ createdAt: -1 })
    .limit(options.limit || 50);
};

PaymentSchema.statics.findCompletedByCompany = function(companyId) {
  return this.findOne({ companyId, status: 'completed' })
    .sort({ createdAt: -1 })
    .populate('subscriptionId');
};

PaymentSchema.statics.getTotalRevenue = async function() {
  const result = await this.aggregate([
    { $match: { status: 'completed' } },
    { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
  ]);
  return result[0] || { total: 0, count: 0 };
};

PaymentSchema.statics.getMonthlyRevenue = async function(year, month) {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);

  const result = await this.aggregate([
    {
      $match: {
        status: 'completed',
        paidAt: { $gte: startDate, $lte: endDate }
      }
    },
    { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
  ]);
  return result[0] || { total: 0, count: 0 };
};

// Instance methods
PaymentSchema.methods.markCompleted = function(paymentData) {
  this.status = 'completed';
  this.razorpayPaymentId = paymentData.razorpay_payment_id;
  this.razorpaySignature = paymentData.razorpay_signature;
  this.paymentMethod = paymentData.paymentMethod;
  this.bank = paymentData.bank;
  this.wallet = paymentData.wallet;
  this.vpa = paymentData.vpa;
  this.cardId = paymentData.card_id;
  this.cardLast4 = paymentData.card_last4;
  this.cardNetwork = paymentData.card_network;
  this.paidAt = new Date();
  return this.save();
};

PaymentSchema.methods.markFailed = function(reason) {
  this.status = 'failed';
  this.notes = reason;
  this.failedAt = new Date();
  return this.save();
};

PaymentSchema.methods.markRefunded = function(amount, reason) {
  this.status = 'refunded';
  this.refundAmount = amount;
  this.refundReason = reason;
  this.refundedAt = new Date();
  return this.save();
};

module.exports = mongoose.model('Payment', PaymentSchema);