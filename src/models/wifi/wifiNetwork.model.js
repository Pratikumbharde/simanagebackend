const mongoose = require('mongoose');
const { Schema } = mongoose;

const WifiNetworkSchema = new Schema({
  companyId: {
    type: Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company ID is required'],
    index: true,
  },
  wifiName: {
    type: String,
    required: [true, 'WiFi name is required'],
    trim: true,
    maxlength: [100, 'WiFi name cannot exceed 100 characters'],
  },
  expectedSpeed: {
    type: Number,
    required: [true, 'Expected speed is required'],
    min: [0, 'Expected speed cannot be negative'],
  },
  alertThreshold: {
    type: Number,
    required: [true, 'Alert threshold is required'],
    min: [0, 'Alert threshold cannot be negative'],
  },
  emailAlertEnabled: {
    type: Boolean,
    default: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
  },
  // [SIM-BASED WIFI ACCESS CONTROL] - Optional field for restricting WiFi access to specific SIMs
  // If empty or undefined, all SIMs in the company can access this WiFi (backward compatible)
  assignedSims: [{
    type: Schema.Types.ObjectId,
    ref: 'Sim',
  }],
  // WiFi identifiers for device validation
  ssid: {
    type: String,
    trim: true,
    default: '',
  },
  bssid: {
    type: String,
    trim: true,
    default: '',
  },
  location: {
    type: String,
    trim: true,
    default: '',
  },
  // WiFi network password for admin reference
  // select: false excludes it from default queries (list endpoints won't leak it)
  // Use .select('+password') to include it in create/update/get-by-id responses
  password: {
    type: String,
    trim: true,
    default: '',
    select: false,
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Indexes
WifiNetworkSchema.index({ companyId: 1, wifiName: 1 }, { unique: true });
WifiNetworkSchema.index({ companyId: 1, isActive: 1 });
WifiNetworkSchema.index({ createdAt: -1 });
WifiNetworkSchema.index({ assignedSims: 1 }); // [SIM-BASED WIFI ACCESS CONTROL]
WifiNetworkSchema.index({ companyId: 1, ssid: 1, bssid: 1 }); // For device validation

// Virtual for status based on latest metrics
WifiNetworkSchema.virtual('status').get(function () {
  return this._status || 'unknown';
});

// Static method to find by company
WifiNetworkSchema.statics.findByCompany = function (companyId) {
  return this.find({ companyId, isActive: true }).sort({ createdAt: -1 });
};

// Static method to count by company
WifiNetworkSchema.statics.countByCompany = function (companyId) {
  return this.countDocuments({ companyId, isActive: true });
};

// [SIM-BASED WIFI ACCESS CONTROL] - Find WiFi networks accessible by a SIM
// Returns networks where: assignedSims is empty/undefined OR SIM is in assignedSims
WifiNetworkSchema.statics.findAccessibleBySim = function (companyId, simId) {
  return this.find({
    companyId,
    isActive: true,
    $or: [
      { assignedSims: { $exists: false } },
      { assignedSims: { $size: 0 } },
      { assignedSims: simId }
    ]
  }).sort({ createdAt: -1 });
};

// [SIM-BASED WIFI ACCESS CONTROL] - Find WiFi by SSID and BSSID with company
WifiNetworkSchema.statics.findBySsidBssid = function (companyId, ssid, bssid) {
  return this.findOne({
    companyId,
    isActive: true,
    $or: [
      { ssid, bssid },
      { wifiName: ssid } // fallback to wifiName if ssid not set
    ]
  });
};

module.exports = mongoose.model('WifiNetwork', WifiNetworkSchema);