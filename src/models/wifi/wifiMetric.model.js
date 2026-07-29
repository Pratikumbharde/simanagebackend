const mongoose = require('mongoose');
const { Schema } = mongoose;

const WifiMetricSchema = new Schema({
  wifiId: {
    type: Schema.Types.ObjectId,
    ref: 'WifiNetwork',
    required: [true, 'WiFi ID is required'],
    index: true,
  },
  companyId: {
    type: Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company ID is required'],
    index: true,
  },
  deviceId: {
    type: String,
    required: [true, 'Device ID is required'],
    index: true,
  },
  deviceObjectId: {
    type: Schema.Types.ObjectId,
    ref: 'WifiDevice',
    index: true,
  },
  // [SIM-BASED WIFI ACCESS CONTROL] - Track which SIM submitted the metrics
  simId: {
    type: Schema.Types.ObjectId,
    ref: 'Sim',
    index: true,
  },
  downloadSpeed: {
    type: Number,
    required: [true, 'Download speed is required'],
    min: [0, 'Download speed cannot be negative'],
  },
  uploadSpeed: {
    type: Number,
    required: [true, 'Upload speed is required'],
    min: [0, 'Upload speed cannot be negative'],
  },
  latency: {
    type: Number,
    required: [true, 'Latency is required'],
    min: [0, 'Latency cannot be negative'],
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true,
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Indexes for efficient querying
WifiMetricSchema.index({ wifiId: 1, timestamp: -1 });
WifiMetricSchema.index({ companyId: 1, timestamp: -1 });
WifiMetricSchema.index({ deviceId: 1, timestamp: -1 });
WifiMetricSchema.index({ deviceObjectId: 1, timestamp: -1 });
WifiMetricSchema.index({ simId: 1, timestamp: -1 }); // [SIM-BASED WIFI ACCESS CONTROL]
WifiMetricSchema.index({ timestamp: 1 });

// Compound index for aggregation queries
WifiMetricSchema.index({ wifiId: 1, companyId: 1, timestamp: -1 });

// Virtual for average speed
WifiMetricSchema.virtual('avgSpeed').get(function () {
  return (this.downloadSpeed + this.uploadSpeed) / 2;
});

// Static method to get latest metrics for a wifi
WifiMetricSchema.statics.getLatestByWifi = function (wifiId, limit = 100) {
  return this.find({ wifiId })
    .sort({ timestamp: -1 })
    .limit(limit)
    .populate('deviceObjectId', 'deviceName');
};

// Static method to get metrics for a time range
WifiMetricSchema.statics.getByWifiAndTimeRange = function (wifiId, startDate, endDate) {
  return this.find({
    wifiId,
    timestamp: { $gte: startDate, $lte: endDate },
  }).sort({ timestamp: 1 });
};

// Static method to get average speed for a wifi in last N minutes
WifiMetricSchema.statics.getAverageSpeed = async function (wifiId, minutes = 5) {
  const startDate = new Date(Date.now() - minutes * 60 * 1000);
  const result = await this.aggregate([
    {
      $match: {
        wifiId: new mongoose.Types.ObjectId(wifiId),
        timestamp: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: '$wifiId',
        avgDownload: { $avg: '$downloadSpeed' },
        avgUpload: { $avg: '$uploadSpeed' },
        avgLatency: { $avg: '$latency' },
        count: { $sum: 1 },
      },
    },
  ]);
  return result[0] || null;
};

// Static method to get latest metrics for a wifi (most recent speed test)
WifiMetricSchema.statics.getLatestSpeed = async function (wifiId) {
  const result = await this.findOne({
    wifiId: new mongoose.Types.ObjectId(wifiId),
  })
    .sort({ timestamp: -1 })
    .select('downloadSpeed uploadSpeed latency timestamp');
  return result;
};

// Static method to get average speed in last N minutes, or latest metric if no recent data
WifiMetricSchema.statics.getRecentOrLatestSpeed = async function (wifiId, minutes = 30) {
  // First try to get average from last N minutes
  const startDate = new Date(Date.now() - minutes * 60 * 1000);
  const result = await this.aggregate([
    {
      $match: {
        wifiId: new mongoose.Types.ObjectId(wifiId),
        timestamp: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: '$wifiId',
        avgDownload: { $avg: '$downloadSpeed' },
        avgUpload: { $avg: '$uploadSpeed' },
        avgLatency: { $avg: '$latency' },
        count: { $sum: 1 },
        lastTimestamp: { $max: '$timestamp' },
      },
    },
  ]);

  if (result.length > 0) {
    return result[0];
  }

  // If no recent data, get the latest metric (regardless of time)
  const latest = await this.findOne({
    wifiId: new mongoose.Types.ObjectId(wifiId),
  })
    .sort({ timestamp: -1 })
    .select('downloadSpeed uploadSpeed latency timestamp');

  if (latest) {
    return {
      _id: wifiId,
      avgDownload: latest.downloadSpeed,
      avgUpload: latest.uploadSpeed,
      avgLatency: latest.latency,
      count: 1,
      lastTimestamp: latest.timestamp,
      isLatest: true, // Flag to indicate this is the latest single metric
    };
  }

  return null;
};

// Static method to get metrics by company
WifiMetricSchema.statics.getByCompany = function (companyId, limit = 100) {
  return this.find({ companyId })
    .sort({ timestamp: -1 })
    .limit(limit)
    .populate('wifiId', 'wifiName')
    .populate('deviceObjectId', 'deviceName');
};

// Static method to get hourly average for a wifi
WifiMetricSchema.statics.getHourlyAverage = async function (wifiId, hours = 24) {
  const startDate = new Date(Date.now() - hours * 60 * 60 * 1000);
  const result = await this.aggregate([
    {
      $match: {
        wifiId: new mongoose.Types.ObjectId(wifiId),
        timestamp: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: {
          year: { $year: '$timestamp' },
          month: { $month: '$timestamp' },
          day: { $dayOfMonth: '$timestamp' },
          hour: { $hour: '$timestamp' },
        },
        avgDownload: { $avg: '$downloadSpeed' },
        avgUpload: { $avg: '$uploadSpeed' },
        avgLatency: { $avg: '$latency' },
        count: { $sum: 1 },
      },
    },
    { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1, '_id.hour': 1 } },
  ]);
  return result;
};

// Static method to clean old metrics (for data cleanup)
WifiMetricSchema.statics.cleanOldMetrics = async function (daysToKeep = 30) {
  const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);
  return this.deleteMany({ timestamp: { $lt: cutoffDate } });
};

module.exports = mongoose.model('WifiMetric', WifiMetricSchema);