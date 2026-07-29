const mongoose = require('mongoose');
const { Schema } = mongoose;

const CompanySchema = new Schema({
  name: {
    type: String,
    required: [true, 'Company name is required'],
    trim: true,
    maxlength: [100, 'Company name cannot exceed 100 characters'],
  },
  email: {
    type: String,
    required: [true, 'Company email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email'],
  },
  phone: {
    type: String,
    trim: true,
    validate: {
      validator: function (v) {
        // [PHONE VALIDATION FIX] - Accept phone with or without country code
        // Accepts: +9713211236540 (with country code) or 9876543210 (10 digits)
        return !v || /^\+?\d{10,15}$/.test(v);
      },
      message: 'Invalid phone number (Must be 10-15 digits)',
    },
  },
  address: {
    street: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    country: { type: String, trim: true },
    zipCode: { type: String, trim: true },
  },
  logo: {
    type: String,
    default: null,
  },
  subscriptionId: {
    type: Schema.Types.ObjectId,
    ref: 'Subscription',
    required: [true, 'Subscription is required'],
  },
  subscriptionStartDate: {
    type: Date,
    default: Date.now,
  },
  subscriptionEndDate: {
    type: Date,
    required: [true, 'Subscription end date is required'],
  },
  billingCycle: {
    type: String,
    enum: ['monthly', 'yearly'],
    default: 'monthly',
  },
  // Trial-related fields
  isTrial: {
    type: Boolean,
    default: true, // New companies start with trial
  },
  trialEndsAt: {
    type: Date,
    default: null, // Set when company is created (14 days from creation)
  },
  hasConverted: {
    type: Boolean,
    default: false, // True when trial converts to paid plan
  },
  trialConvertedAt: {
    type: Date,
    default: null, // When trial was converted to paid
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  settings: {
    currency: { type: String, default: 'INR' },
    timezone: { type: String, default: 'Asia/Kolkata' },
    dateFormat: { type: String, default: 'DD/MM/YYYY' },
    notificationsEnabled: { type: Boolean, default: true },
    rechargeReminderDays: { type: Number, default: 3 },
    inactiveSimDays: { type: Number, default: 7 },
  },
  stats: {
    totalSims: { type: Number, default: 0 },
    activeSims: { type: Number, default: 0 },
    totalRecharges: { type: Number, default: 0 },
    totalSpent: { type: Number, default: 0 },
  },
  // Email change verification fields
  emailChangeOTP: {
    type: String,
    default: null,
  },
  emailChangeOTPExpires: {
    type: Date,
    default: null,
  },
  emailChangeOTPVerified: {
    type: Boolean,
    default: false,
  },
  pendingNewEmail: {
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
CompanySchema.index({ email: 1 });
CompanySchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
CompanySchema.index({ isActive: 1 });
CompanySchema.index({ subscriptionEndDate: 1 });

// Virtual for subscription status
CompanySchema.virtual('subscriptionStatus').get(function () {
  if (!this.subscriptionEndDate) return 'inactive';
  const now = new Date();
  const endDate = new Date(this.subscriptionEndDate);
  if (endDate < now) return 'expired';
  const daysLeft = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));
  if (daysLeft <= 7) return 'expiring';
  return 'active';
});

// Virtual for trial status
CompanySchema.virtual('trialStatus').get(function () {
  if (!this.isTrial) return 'not_trial';
  if (!this.trialEndsAt) return 'trial_not_set';
  const now = new Date();
  const trialEnd = new Date(this.trialEndsAt);
  if (trialEnd < now) return 'trial_expired';
  const daysLeft = Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24));
  return `trial_active_${daysLeft}_days_left`;
});

// Virtual to check if company is on active trial
CompanySchema.virtual('isOnTrial').get(function () {
  if (!this.isTrial || !this.trialEndsAt) return false;
  return new Date(this.trialEndsAt) > new Date();
});

// Static method to find active companies
CompanySchema.statics.findActive = function () {
  return this.find({ isActive: true });
};

// Static method to find expiring subscriptions
CompanySchema.statics.findExpiring = function (days = 7) {
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + days);

  return this.find({
    isActive: true,
    subscriptionEndDate: {
      $lte: targetDate,
      $gt: new Date(),
    },
  });
};

// Method to check if subscription is valid
CompanySchema.methods.isSubscriptionValid = function () {
  return this.isActive && new Date(this.subscriptionEndDate) > new Date();
};

module.exports = mongoose.model('Company', CompanySchema);