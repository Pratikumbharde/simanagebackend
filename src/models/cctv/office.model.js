const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Office Model
 * Represents a physical office location where cameras and agents are deployed.
 * Each company can have multiple offices.
 */
const OfficeSchema = new Schema({
  companyId: {
    type: Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company ID is required'],
    index: true,
  },
  name: {
    type: String,
    required: [true, 'Office name is required'],
    trim: true,
    maxlength: [100, 'Office name cannot exceed 100 characters'],
  },
  address: {
    street: {
      type: String,
      trim: true,
      default: '',
    },
    city: {
      type: String,
      trim: true,
      default: '',
    },
    state: {
      type: String,
      trim: true,
      default: '',
    },
    country: {
      type: String,
      trim: true,
      default: 'India',
    },
    zipCode: {
      type: String,
      trim: true,
      default: '',
    },
  },
  contactPerson: {
    type: String,
    trim: true,
    maxlength: [100, 'Contact person name cannot exceed 100 characters'],
    default: '',
  },
  contactPhone: {
    type: String,
    trim: true,
    validate: {
      validator: function (v) {
        if (!v) return true; // Allow empty
        return /^\+?\d{10,15}$/.test(v);
      },
      message: 'Invalid phone number (Must be 10-15 digits)',
    },
    default: '',
  },
  timezone: {
    type: String,
    default: 'Asia/Kolkata',
    trim: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  // Denormalized counts for quick access
  cameraCount: {
    type: Number,
    default: 0,
    min: 0,
  },
  agentCount: {
    type: Number,
    default: 0,
    min: 0,
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
OfficeSchema.index({ companyId: 1, isActive: 1 });
OfficeSchema.index({ companyId: 1, name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

// Static method to find by company
OfficeSchema.statics.findByCompany = function (companyId, options = {}) {
  const query = { companyId, isActive: true };
  if (options.search) {
    query.$or = [
      { name: { $regex: options.search, $options: 'i' } },
      { 'address.city': { $regex: options.search, $options: 'i' } },
      { 'address.state': { $regex: options.search, $options: 'i' } },
    ];
  }
  const { page = 1, limit = 20 } = options;
  const skip = (page - 1) * limit;
  return this.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));
};

// Static method to count by company
OfficeSchema.statics.countByCompany = function (companyId) {
  return this.countDocuments({ companyId, isActive: true });
};

// Static method to find active by ID
OfficeSchema.statics.findActiveById = function (officeId, companyId) {
  return this.findOne({ _id: officeId, companyId, isActive: true });
};

module.exports = mongoose.model('Office', OfficeSchema);