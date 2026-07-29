const mongoose = require('mongoose');
const { Schema } = mongoose;

const SimSchema = new Schema({
  companyId: {
    type: Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company ID is required'],
    index: true,
  },
  // simNumber: {
  //   type: String,
  //   trim: true,
  //   default: '',
  // },
  mobileNumber: {
    type: String,
    required: [true, 'Contact Number is required'],
    trim: true,
    match: [/^\+?\d{10,15}$/, 'Contact Number must be Must be 10-15 digits'],
  },
  // [INTERNATIONAL OPERATORS] - Operator field now accepts any value for international support
  operator: {
    type: String,
    required: [true, 'Operator is required'],
    trim: true,
    maxlength: [50, 'Operator name cannot exceed 50 characters'],
    default: 'Other',
  },
  circle: {
    type: String,
    trim: true,
    default: '',
  },
  simType: {
    type: String,
    enum: ['prepaid', 'postpaid'],
    default: 'prepaid',
  },
  imei: {
    type: String,
    trim: true,
    default: '',
    maxlength: [17, 'IMEI cannot exceed 17 characters'],
    match: [/^[0-9a-fA-F-]*$/, 'IMEI can only contain digits, letters A-F, and hyphens'],
  },
  assignedTo: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active',
  },
  activationDate: {
    type: Date,
    default: Date.now,
  },
  deactivationDate: {
    type: Date,
    default: null,
  },
  lastActiveDate: {
    type: Date,
    default: Date.now,
  },
  plan: {
    name: { type: String, trim: true },
    validity: { type: Number }, // in days
    data: { type: String }, // e.g., "1.5GB/day"
    calls: { type: String }, // e.g., "Unlimited"
    sms: { type: String }, // e.g., "100/day"
  },
  currentBalance: {
    type: Number,
    default: 0,
    min: [0, 'Balance cannot be negative'],
  },
  simOwnerName: {
    type: String,
    trim: true,
    maxlength: [100, 'SIM owner name cannot exceed 100 characters'],
    default: '',
  },
  notes: {
    type: String,
    trim: true,
    maxlength: [500, 'Notes cannot exceed 500 characters'],
  },
  tags: [{
    type: String,
    trim: true,
  }],
  whatsappEnabled: {
    type: Boolean,
    default: false,
  },
  isAdminCaller: {
    type: Boolean,
    default: false,
  },
  whatsappLastActive: {
    type: Date,
    default: null,
  },
  telegramEnabled: {
    type: Boolean,
    default: false,
  },
  telegramLastActive: {
    type: Date,
    default: null,
  },
  telegramChatId: {
    type: String,
    default: null,
    index: true,
  },
  // Telegram user info
  telegramUsername: {
    type: String,
    default: null,
  },
  telegramUserId: {
    type: Number,
    default: null,
  },
  telegramFirstName: {
    type: String,
    default: null,
  },
  telegramLastName: {
    type: String,
    default: null,
  },
  // Telegram phone verification
  telegramPhoneNumber: {
    type: String,
    default: null,
  },
  telegramPhoneVerified: {
    type: Boolean,
    default: false,
  },
  // [SIM-BASED WIFI ACCESS CONTROL] - Device binding fields
  deviceId: {
    type: String,
    default: null,
    index: true, // For quick lookup
  },
  deviceToken: {
    type: String,
    default: null,
  },
  deviceTokenExpires: {
    type: Date,
    default: null,
  },
  deviceLastSeen: {
    type: Date,
    default: null,
  },
  lastMetricAt: {
    type: Date,
    default: null,
  },
  isActive: {
    type: Boolean,
    default: true,
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
SimSchema.index({ companyId: 1, mobileNumber: 1 });
SimSchema.index({ companyId: 1, status: 1 });
SimSchema.index({ mobileNumber: 1 });
SimSchema.index({ assignedTo: 1 });
SimSchema.index({ createdAt: -1 });
SimSchema.index({ telegramChatId: 1 });

// Text index for search
SimSchema.index({ mobileNumber: 'text', operator: 'text' });

// Virtual for full SIM info
SimSchema.virtual('fullInfo').get(function () {
  return `${this.mobileNumber} (${this.operator}) - ${this.status}`;
});

// Virtual for days since last active
SimSchema.virtual('daysSinceActive').get(function () {
  if (!this.lastActiveDate) return null;
  return Math.floor((new Date() - this.lastActiveDate) / (1000 * 60 * 60 * 24));
});

// Static method to find by company
SimSchema.statics.findByCompany = function (companyId, status = null) {
  const query = { companyId, isActive: true };
  if (status) query.status = status;
  return this.find(query).populate('assignedTo', 'name email');
};

// Static method to count by status
SimSchema.statics.countByStatus = async function (companyId) {
  const result = await this.aggregate([
    { $match: { companyId: new mongoose.Types.ObjectId(companyId), isActive: true } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  return result.reduce((acc, item) => {
    acc[item._id] = item.count;
    return acc;
  }, {});
};

// Static method to find inactive SIMs
SimSchema.statics.findInactive = function (companyId, days = 7) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  return this.find({
    companyId,
    status: 'active',
    lastActiveDate: { $lt: cutoffDate },
  });
};

// [SIM-BASED WIFI ACCESS CONTROL] - Find SIM by Contact Number for device auth
// Handles both +91XXXXXXXXXX and XXXXXXXXXX formats
SimSchema.statics.findByMobileNumber = function (mobileNumber) {
  // Normalize phone number
  let normalized = mobileNumber.replace(/[\s-]/g, '');
  if (!normalized.startsWith('+') && normalized.length === 10) {
    normalized = '+91' + normalized;
  }

  return this.findOne({
    mobileNumber: { $in: [normalized, mobileNumber] },
    isActive: true,
  });
};

// [SIM-BASED WIFI ACCESS CONTROL] - Generate device token
SimSchema.methods.generateDeviceToken = function () {
  const crypto = require('crypto');
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

  this.deviceToken = token;
  this.deviceTokenExpires = expiresAt;

  return { token, expiresAt };
};

// [SIM-BASED WIFI ACCESS CONTROL] - Validate device token
SimSchema.methods.validateDeviceToken = function (token) {
  if (!this.deviceToken || this.deviceToken !== token) {
    return false;
  }
  if (this.deviceTokenExpires && this.deviceTokenExpires < new Date()) {
    return false;
  }
  return true;
};

// Method to check if SIM is assigned
SimSchema.methods.isAssigned = function () {
  return this.assignedTo !== null;
};

// Method to activate SIM
SimSchema.methods.activate = function () {
  this.status = 'active';
  this.activationDate = new Date();
  this.deactivationDate = null;
  return this.save();
};

// Method to deactivate SIM
SimSchema.methods.deactivate = function (reason = '') {
  this.status = 'inactive';
  this.deactivationDate = new Date();
  if (reason) this.notes = reason;
  return this.save();
};

module.exports = mongoose.model('Sim', SimSchema);