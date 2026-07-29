const mongoose = require('mongoose');
const { Schema } = mongoose;

const ReportScheduleSchema = new Schema({
  companyId: {
    type: Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company ID is required'],
    index: true,
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    trim: true,
    lowercase: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email'],
  },
  name: {
    type: String,
    trim: true,
    maxlength: [100, 'Name cannot exceed 100 characters'],
    default: '',
  },
  // Array of schedule frequencies — allows selecting multiple (e.g. ['weekly', 'monthly'])
  schedules: [{
    type: String,
    enum: ['daily', 'weekly', 'monthly'],
    required: [true, 'At least one schedule frequency is required'],
  }],
  time: {
    type: String,
    required: [true, 'Time is required'],
    default: '09:00',
    match: [/^([01]\d|2[0-3]):([0-5]\d)$/, 'Time must be in HH:mm format (24-hour)'],
  },
  timezone: {
    type: String,
    default: 'Asia/Kolkata',
  },
  // Array of days of week (for weekly schedules) — allows selecting multiple
  // 0=Sunday, 1=Monday, ..., 6=Saturday
  daysOfWeek: [{
    type: Number,
    min: [0, 'Day of week must be 0-6'],
    max: [6, 'Day of week must be 0-6'],
  }],
  // Array of days of month (for monthly schedules) — allows selecting multiple
  daysOfMonth: [{
    type: Number,
    min: [1, 'Day of month must be 1-31'],
    max: [31, 'Day of month must be 1-31'],
  }],
  // Array of report types — allows selecting multiple reports per schedule
  reportTypes: [{
    type: String,
    enum: ['overview', 'sims', 'recharges', 'callLogs'],
  }],
  isActive: {
    type: Boolean,
    default: true,
  },
  lastSentAt: {
    type: Date,
    default: null,
  },
  lastSendStatus: {
    type: String,
    enum: ['success', 'failed'],
    default: null,
  },
  lastSendError: {
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

// Indexes for efficient cron queries
ReportScheduleSchema.index({ companyId: 1, isActive: 1 });
ReportScheduleSchema.index({ isActive: 1, time: 1 });

// Static: find all schedules for a company
ReportScheduleSchema.statics.findByCompany = function (companyId, includeInactive = false) {
  const filter = { companyId };
  if (!includeInactive) filter.isActive = true;
  return this.find(filter).sort({ createdAt: 1 });
};

// Static: find all active schedules that should be sent at a given time
ReportScheduleSchema.statics.findActiveSchedules = function () {
  return this.find({ isActive: true }).populate('companyId', 'name email isActive');
};

// Virtual: human-readable schedule description
ReportScheduleSchema.virtual('scheduleDescription').get(function () {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const timeStr = this.time || '09:00';
  const tzLabel = this.timezone || 'Asia/Kolkata';

  if (!this.schedules || this.schedules.length === 0) return `No schedule at ${timeStr}`;

  const parts = [];

  if (this.schedules.includes('daily')) {
    parts.push('Daily');
  }
  if (this.schedules.includes('weekly') && this.daysOfWeek && this.daysOfWeek.length > 0) {
    const dayLabels = this.daysOfWeek.sort((a, b) => a - b).map(d => days[d]);
    parts.push(dayLabels.length <= 3 ? `Weekly on ${dayLabels.join(', ')}` : `Weekly (${dayLabels.length} days)`);
  } else if (this.schedules.includes('weekly')) {
    parts.push('Weekly');
  }
  if (this.schedules.includes('monthly') && this.daysOfMonth && this.daysOfMonth.length > 0) {
    const sorted = [...this.daysOfMonth].sort((a, b) => a - b);
    const dateLabels = sorted.map(d => {
      const suffix = d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th';
      return `${d}${suffix}`;
    });
    parts.push(dateLabels.length <= 3 ? `Monthly on ${dateLabels.join(', ')}` : `Monthly (${dateLabels.length} dates)`);
  } else if (this.schedules.includes('monthly')) {
    parts.push('Monthly');
  }

  return `${parts.join(' · ')} at ${timeStr}`;
});

// Pre-save validation
ReportScheduleSchema.pre('save', function (next) {
  // Must have at least one schedule
  if (!this.schedules || this.schedules.length === 0) {
    return next(new Error('At least one schedule frequency is required'));
  }

  // If weekly is selected, daysOfWeek must have at least one entry
  if (this.schedules.includes('weekly') && (!this.daysOfWeek || this.daysOfWeek.length === 0)) {
    return next(new Error('At least one day of week is required for weekly schedule'));
  }

  // If monthly is selected, daysOfMonth must have at least one entry
  if (this.schedules.includes('monthly') && (!this.daysOfMonth || this.daysOfMonth.length === 0)) {
    return next(new Error('At least one day of month is required for monthly schedule'));
  }

  // Must have at least one report type
  if (!this.reportTypes || this.reportTypes.length === 0) {
    return next(new Error('At least one report type is required'));
  }

  next();
});

module.exports = mongoose.model('ReportSchedule', ReportScheduleSchema);