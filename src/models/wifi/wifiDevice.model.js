const mongoose = require('mongoose');
const { Schema } = mongoose;

const WifiDeviceSchema = new Schema({
  deviceId: {
    type: String,
    required: [true, 'Device ID is required'],
    unique: true,
    trim: true,
    index: true,
  },
  companyId: {
    type: Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company ID is required'],
    index: true,
  },
  deviceName: {
    type: String,
    required: [true, 'Device name is required'],
    trim: true,
    maxlength: [100, 'Device name cannot exceed 100 characters'],
  },
  wifiId: {
    type: Schema.Types.ObjectId,
    ref: 'WifiNetwork',
    default: null,
  },
  isActive: {
    type: Boolean,
    default: false,
  },
  lastSeen: {
    type: Date,
    default: null,
  },
  // Track last successful metrics submission
  lastMetricAt: {
    type: Date,
    default: null,
  },
  // Track WiFi connection status
  lastWifiConnected: {
    type: Boolean,
    default: true,
  },
  // Offline tracking
  isOffline: {
    type: Boolean,
    default: false,
  },
  offlineSince: {
    type: Date,
    default: null,
  },
  // Alert sent tracking for offline alerts
  offlineAlertSent: {
    type: Boolean,
    default: false,
  },
  registeredAt: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Indexes
WifiDeviceSchema.index({ companyId: 1, isActive: 1 });
WifiDeviceSchema.index({ deviceId: 1 });
WifiDeviceSchema.index({ wifiId: 1 });
WifiDeviceSchema.index({ lastSeen: -1 });

// Virtual for assigned status
WifiDeviceSchema.virtual('isAssigned').get(function () {
  return this.wifiId !== null;
});

// Virtual for online status (active in last 10 minutes)
WifiDeviceSchema.virtual('isOnline').get(function () {
  if (!this.lastSeen) return false;
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  return this.lastSeen > tenMinutesAgo;
});

// Static method to find by company
WifiDeviceSchema.statics.findByCompany = function (companyId) {
  return this.find({ companyId })
    .populate('wifiId', 'wifiName expectedSpeed alertThreshold')
    .sort({ createdAt: -1 });
};

// Static method to find active devices
WifiDeviceSchema.statics.findActiveByWifi = function (wifiId) {
  return this.find({ wifiId, isActive: true });
};

// Static method to count by company
WifiDeviceSchema.statics.countByCompany = function (companyId) {
  return this.countDocuments({ companyId });
};

// Static method to count active by wifi
WifiDeviceSchema.statics.countActiveByWifi = function (wifiId) {
  return this.countDocuments({ wifiId, isActive: true });
};

// Method to update last seen
WifiDeviceSchema.methods.updateLastSeen = function () {
  this.lastSeen = new Date();
  return this.save();
};

// Method to assign to wifi
WifiDeviceSchema.methods.assignToWifi = function (wifiId, isActive = true) {
  this.wifiId = wifiId;
  this.isActive = isActive;
  return this.save();
};

// Method to unassign
WifiDeviceSchema.methods.unassign = function () {
  this.wifiId = null;
  this.isActive = false;
  return this.save();
};

module.exports = mongoose.model('WifiDevice', WifiDeviceSchema);