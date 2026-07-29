const mongoose = require('mongoose');
const { Schema } = mongoose;

const SubscriptionSchema = new Schema({
  name: {
    type: String,
    required: [true, 'Plan name is required'],
    trim: true,
    maxlength: [50, 'Plan name cannot exceed 50 characters'],
  },
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description cannot exceed 500 characters'],
  },
  price: {
    monthly: {
      type: Number,
      required: [true, 'Monthly price is required'],
      min: [0, 'Price cannot be negative'],
    },
    yearly: {
      type: Number,
      required: [true, 'Yearly price is required'],
      min: [0, 'Price cannot be negative'],
    },
  },
  billingCycle: {
    type: String,
    enum: ['monthly', 'yearly'],
    default: 'monthly',
  },
  features: {
    callLogSync: { type: Boolean, default: false },
    whatsappStatus: { type: Boolean, default: false },
    telegramStatus: { type: Boolean, default: false },
    wifiMonitor: { type: Boolean, default: false },
    callAutomation: { type: Boolean, default: false },
    smsLogs: { type: Boolean, default: false },
    emailNotifications: { type: Boolean, default: true },
    smsNotifications: { type: Boolean, default: false },
    advancedReports: { type: Boolean, default: false },
    excelExport: { type: Boolean, default: true },
    apiAccess: { type: Boolean, default: false },
    prioritySupport: { type: Boolean, default: false },
  },
  limits: {
    maxSims: {
      type: Number,
      default: 10,
      validate: {
        validator: function(v) {
          return v === -1 || v >= 0;
        },
        message: 'Max SIMs must be -1 (unlimited), 0, or a positive number'
      }
    },
    maxUsers: {
      type: Number,
      default: 5,
      validate: {
        validator: function(v) {
          return v === -1 || v >= 0;
        },
        message: 'Max Users must be -1 (unlimited), 0, or a positive number'
      }
    },
    maxRecharges: {
      type: Number,
      default: 100,
      validate: {
        validator: function(v) {
          return v === -1 || v >= 0;
        },
        message: 'Max Recharges must be -1 (unlimited), 0, or a positive number'
      }
    },
    callLogSync: { type: Boolean, default: true },
    whatsappStatus: { type: Boolean, default: false },
    reports: { type: Boolean, default: true },
  },
  // Plan type: 'free_trial' for free trial plan, 'paid' for regular plans
  planType: {
    type: String,
    enum: ['free_trial', 'paid'],
    default: 'paid',
  },
  // Duration in days (monthly = 28 days, yearly = 336 days)
  // For free_trial plan, this is the trial duration (14 days)
  // Note: Free trial plans should always have durationDays.monthly = 14 and yearly = 14
  durationDays: {
    monthly: { type: Number, default: 28 },
    yearly: { type: Number, default: 336 },
  },
  isPopular: {
    type: Boolean,
    default: false,
  },
  sortOrder: {
    type: Number,
    default: 0,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Indexes
SubscriptionSchema.index({ name: 1 });
SubscriptionSchema.index({ isActive: 1, sortOrder: 1 });
SubscriptionSchema.index({ planType: 1 });

// Pre-save hook: ensure free trial plans always have 14-day duration
SubscriptionSchema.pre('save', function (next) {
  if (this.planType === 'free_trial') {
    this.durationDays = { monthly: 14, yearly: 14 };
  }
  next();
});

// Virtual for formatted price
SubscriptionSchema.virtual('formattedPrice').get(function () {
  if (this.planType === 'free_trial') {
    return {
      monthly: 'Free',
      yearly: 'Free',
    };
  }
  return {
    monthly: `₹${this.price.monthly}/month`,
    yearly: `₹${this.price.yearly}/year`,
  };
});

// Virtual for duration in days based on billing cycle
SubscriptionSchema.virtual('durationInDays').get(function () {
  if (this.planType === 'free_trial') {
    return 14; // Free trial is always 14 days
  }
  return this.billingCycle === 'yearly' ? this.durationDays.yearly : this.durationDays.monthly;
});

// Static method to find active plans
SubscriptionSchema.statics.findActive = function () {
  return this.find({ isActive: true }).sort({ sortOrder: 1 });
};

// Static method to find popular plans
SubscriptionSchema.statics.findPopular = function () {
  return this.find({ isActive: true, isPopular: true }).sort({ sortOrder: 1 });
};

// Static method to find free trial plan
SubscriptionSchema.statics.findFreeTrialPlan = async function () {
  let plan = await this.findOne({ planType: 'free_trial', isActive: true });
  if (!plan) {
    // Create default free trial plan if not exists
    plan = await this.createFreeTrialPlan();
  }
  return plan;
};

// Static method to create default free trial plan
SubscriptionSchema.statics.createFreeTrialPlan = async function () {
  const existing = await this.findOne({ planType: 'free_trial' });
  if (existing) return existing;

  const freeTrialPlan = new this({
    name: 'Free Trial',
    description: '14-day free trial to explore all features. No credit card required.',
    price: { monthly: 0, yearly: 0 },
    billingCycle: 'monthly',
    planType: 'free_trial',
    features: {
      callLogSync: true,
      whatsappStatus: false,
      telegramStatus: false,
      wifiMonitor: false,
      callAutomation: false,
      smsLogs: false,
      emailNotifications: true,
      smsNotifications: false,
      advancedReports: true,
      excelExport: true,
      apiAccess: false,
      prioritySupport: false,
    },
    limits: {
      maxSims: 10,
      maxUsers: 5,
      maxRecharges: 50,
      callLogSync: true,
      whatsappStatus: false,
      reports: true,
    },
    durationDays: { monthly: 14, yearly: 14 }, // 14 days for free trial
    isPopular: false,
    sortOrder: 0, // First plan
    isActive: true,
  });

  await freeTrialPlan.save();
  return freeTrialPlan;
};

// Method to calculate savings for yearly plan
SubscriptionSchema.methods.calculateYearlySavings = function () {
  if (this.planType === 'free_trial') return 0;
  const monthlyCost = this.price.monthly * 12;
  const yearlyCost = this.price.yearly;
  return monthlyCost - yearlyCost;
};

// Method to get duration for billing cycle
SubscriptionSchema.methods.getDuration = function (billingCycle = 'monthly') {
  if (this.planType === 'free_trial') {
    return 14; // Free trial is always 14 days
  }
  return billingCycle === 'yearly' ? this.durationDays.yearly : this.durationDays.monthly;
};

// Predefined subscription plans (paid plans only)
const defaultPlans = [
  {
    name: 'Starter',
    description: 'Perfect for small teams getting started',
    price: { monthly: 999, yearly: 9990 },
    features: {
      callLogSync: false,
      whatsappStatus: false,
      telegramStatus: false,
      wifiMonitor: false,
      callAutomation: false,
      smsLogs: false,
      emailNotifications: true,
      smsNotifications: false,
      advancedReports: false,
      excelExport: true,
      apiAccess: false,
      prioritySupport: false,
    },
    limits: { maxSims: 10, maxUsers: 3, maxRecharges: 50, callLogSync: false, whatsappStatus: false, reports: true },
    durationDays: { monthly: 28, yearly: 336 },
    planType: 'paid',
    isPopular: false,
    sortOrder: 1,
  },
  {
    name: 'Professional',
    description: 'Great for growing businesses',
    price: { monthly: 2499, yearly: 24990 },
    features: {
      callLogSync: true,
      whatsappStatus: true,
      telegramStatus: false,
      wifiMonitor: true,
      callAutomation: true,
      smsLogs: true,
      emailNotifications: true,
      smsNotifications: true,
      advancedReports: true,
      excelExport: true,
      apiAccess: false,
      prioritySupport: false,
    },
    limits: { maxSims: 50, maxUsers: 10, maxRecharges: 500, callLogSync: true, whatsappStatus: true, reports: true },
    durationDays: { monthly: 28, yearly: 336 },
    planType: 'paid',
    isPopular: true,
    sortOrder: 2,
  },
  {
    name: 'Enterprise',
    description: 'For large Organisations with advanced needs',
    price: { monthly: 4999, yearly: 49990 },
    features: {
      callLogSync: true,
      whatsappStatus: true,
      telegramStatus: true,
      wifiMonitor: true,
      callAutomation: true,
      smsLogs: true,
      emailNotifications: true,
      smsNotifications: true,
      advancedReports: true,
      excelExport: true,
      apiAccess: true,
      prioritySupport: true,
    },
    limits: { maxSims: -1, maxUsers: -1, maxRecharges: -1, callLogSync: true, whatsappStatus: true, reports: true },
    durationDays: { monthly: 28, yearly: 336 },
    planType: 'paid',
    isPopular: false,
    sortOrder: 3,
  },
];

module.exports = mongoose.model('Subscription', SubscriptionSchema);
module.exports.defaultPlans = defaultPlans;