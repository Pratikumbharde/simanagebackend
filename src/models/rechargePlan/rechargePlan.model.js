const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * RechargePlan Model
 *
 * Stores predefined recharge plans per operator and circle.
 * When a user selects a SIM card, the frontend fetches available
 * plans for that SIM's operator (and optionally circle) so the
 * user can pick a plan instead of manually entering all details.
 */
const RechargePlanSchema = new Schema({
  operator: {
    type: String,
    required: [true, 'Operator is required'],
    trim: true,
    index: true,
    // Support Indian and international operators
    // e.g. Jio, Airtel, Vi, BSNL, MTNL, Other
  },
  circle: {
    type: String,
    trim: true,
    default: 'all',
    index: true,
    // Telecom circle / region, e.g. Delhi, Mumbai, Karnataka
    // 'all' means the plan applies to all circles for that operator
  },
  amount: {
    type: Number,
    required: [true, 'Plan amount is required'],
    min: [1, 'Amount must be at least ₹1'],
  },
  validity: {
    type: Number,
    required: [true, 'Validity (days) is required'],
    min: [1, 'Validity must be at least 1 day'],
  },
  planType: {
    type: String,
    enum: ['popular', 'data', 'unlimited', 'talktime', 'combo', 'annual', 'other'],
    default: 'popular',
    index: true,
  },
  plan: {
    name: {
      type: String,
      required: [true, 'Plan name is required'],
      trim: true,
    },
    data: { type: String, default: '' },   // e.g. "1.5GB/day", "2GB"
    calls: { type: String, default: '' },   // e.g. "Unlimited", "1000 min"
    sms: { type: String, default: '' },     // e.g. "100/day", "Unlimited"
    description: { type: String, default: '' }, // Brief description
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true,
  },
  sortOrder: {
    type: Number,
    default: 0,
    // Lower = shown first; 0 = default ordering
  },
  tags: [{
    type: String,
    trim: true,
    // e.g. "bestseller", "5G", "student", "unlimited"
  }],
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Compound indexes for efficient plan lookups
RechargePlanSchema.index({ operator: 1, circle: 1, isActive: 1, sortOrder: 1 });
RechargePlanSchema.index({ operator: 1, planType: 1, isActive: 1 });
RechargePlanSchema.index({ operator: 1, amount: 1, isActive: 1 });

// Static: find plans for an operator and circle
RechargePlanSchema.statics.findByOperatorAndCircle = function (operator, circle = 'all') {
  // Return plans that match the specific circle OR have circle='all'
  return this.find({
    operator: { $regex: new RegExp(`^${operator}$`, 'i') },
    isActive: true,
    $or: [
      { circle: { $regex: new RegExp(`^${circle}$`, 'i') } },
      { circle: 'all' },
    ],
  }).sort({ sortOrder: 1, amount: 1 });
};

// Static: find plans by mobile number (infers operator from SIM collection)
RechargePlanSchema.statics.findByMobileNumber = async function (mobileNumber) {
  const Sim = require('../sim/sim.model');
  const sim = await Sim.findByMobileNumber(mobileNumber);
  if (!sim) {
    return { sim: null, plans: [] };
  }
  const circle = sim.circle || 'all';
  const plans = await this.findByOperatorAndCircle(sim.operator, circle);
  return { sim, plans };
};

// Static: get all unique operators that have active plans
RechargePlanSchema.statics.getOperators = function () {
  return this.distinct('operator', { isActive: true });
};

// Static: get all unique circles for a given operator
RechargePlanSchema.statics.getCircles = function (operator) {
  return this.distinct('circle', { operator: { $regex: new RegExp(`^${operator}$`, 'i') }, isActive: true });
};

module.exports = mongoose.model('RechargePlan', RechargePlanSchema);