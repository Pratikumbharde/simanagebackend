const mongoose = require('mongoose');
const { Schema } = mongoose;

const LeadSchema = new Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    maxlength: [100, 'Name cannot exceed 100 characters'],
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    trim: true,
    lowercase: true,
    match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address'],
  },
  phone: {
    type: String,
    trim: true,
    match: [/^\+?\d{10,15}$/, 'Phone number must be 10-15 digits'],
  },
  company: {
    type: String,
    trim: true,
    maxlength: [100, 'Company name cannot exceed 100 characters'],
  },
  message: {
    type: String,
    required: [true, 'Message is required'],
    trim: true,
    maxlength: [1000, 'Message cannot exceed 1000 characters'],
  },
  status: {
    type: String,
    enum: {
      values: ['new', 'contacted', 'qualified', 'lost'],
      message: '{VALUE} is not a valid status',
    },
    default: 'new',
  },
  source: {
    type: String,
    default: 'contact-form',
  },
  notes: {
    type: String,
    trim: true,
    maxlength: [2000, 'Notes cannot exceed 2000 characters'],
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Indexes for efficient querying
LeadSchema.index({ email: 1 });
LeadSchema.index({ status: 1 });
LeadSchema.index({ createdAt: -1 });
LeadSchema.index({ source: 1 });

module.exports = mongoose.model('Lead', LeadSchema);