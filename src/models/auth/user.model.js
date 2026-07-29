const mongoose = require('mongoose');
const { Schema } = mongoose;
const bcrypt = require('bcryptjs');

const UserSchema = new Schema({
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true, // [GLOBAL UNIQUE] - One email = one user across entire system
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email'],
  },
  password: {
    type: String,
    select: false, // Don't return password by default
  },
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    maxlength: [50, 'Name cannot exceed 50 characters'],
  },
  role: {
    type: String,
    enum: ['super_admin', 'admin', 'user'],
    required: [true, 'Role is required'],
    default: 'user',
  },
  companyId: {
    type: Schema.Types.ObjectId,
    ref: 'Company',
    default: null,
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
  location: {
    type: String,
    trim: true,
    maxlength: [200, 'Location cannot exceed 200 characters'],
    default: '',
  },
  // [PHONE NORMALIZATION FIX] - Contact Number for OTP authentication (unique identifier)
  // Accepts both: 10-digit format (9876543210) or with country code (+91XXXXXXXXXX)
  mobileNumber: {
    type: String,
    unique: true,
    sparse: true, // Allow null/undefined values
    trim: true,
    validate: {
      validator: function (v) {
        // [PHONE NORMALIZATION FIX] - Accept 10 digits OR international format (+XXX...)
        if (!v) return true; // Allow empty
        // 10 digits only
        if (/^\d{10}$/.test(v)) return true;
        // International format: + followed by Must be 10-15 digits
        if (/^\+\d{10,15}$/.test(v)) return true;
        return false;
      },
      message: 'Contact Number must be 10 digits or in international format (e.g., +91XXXXXXXXXX)',
    },
  },
  // OTP authentication fields
  otp: {
    type: String,
    select: false, // Don't return OTP by default
  },
  otpExpires: {
    type: Date,
    default: null,
  },
  otpAttempts: {
    type: Number,
    default: 0,
  },
  lastOtpSentAt: {
    type: Date,
    default: null,
  },
  mobileVerified: {
    type: Boolean,
    default: false,
  },
  avatar: {
    type: String,
    default: null,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  // Controls whether the user's mobile app can sync call logs and SMS data
  // When false, sync endpoints will reject requests for this user's SIMs
  dataSync: {
    type: Boolean,
    default: true,
  },
  emailVerified: {
    type: Boolean,
    default: false,
  },
  lastLogin: {
    type: Date,
    default: null,
  },
  passwordChangedAt: {
    type: Date,
    default: null,
  },
  resetPasswordToken: {
    type: String,
    default: null,
  },
  resetPasswordExpires: {
    type: Date,
    default: null,
  },
  // Forgot Password OTP fields (for admin password reset)
  forgotPasswordOTP: {
    type: String,
    default: null,
    select: false,
  },
  forgotPasswordOTPExpires: {
    type: Date,
    default: null,
  },
  forgotPasswordOTPVerified: {
    type: Boolean,
    default: false,
  },
  forgotPasswordOTPAttempts: {
    type: Number,
    default: 0,
  },
  // Email change fields
  emailChangeOTP: {
    type: String,
    default: null,
    select: false,
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
    trim: true,
  },
  refreshToken: {
    type: String,
    default: null,
  },
  preferences: {
    notifications: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: false },
      inApp: { type: Boolean, default: true },
    },
    timezone: {
      type: String,
      default: 'Asia/Kolkata',
    },
    language: {
      type: String,
      default: 'en',
    },
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Indexes
// NOTE: If deploying to existing DB with old compound index, run this in MongoDB shell first:
// db.users.dropIndex({ "email": 1, "companyId": 1 })
// db.users.dropIndex({ "email": 1 })
// This drops old indexes before Mongoose creates the new unique index on email field
// IMPORTANT: email already has unique: true in schema, so we don't need to declare it again here
UserSchema.index({ companyId: 1 });
UserSchema.index({ role: 1 });
UserSchema.index({ isActive: 1 });
UserSchema.index({ dataSync: 1 });

// [EMAIL OTP FIX] - TTL index for automatic OTP cleanup (expires after 5 minutes)
// This ensures expired OTPs are automatically removed from the database
UserSchema.index({ otpExpires: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { otpExpires: { $ne: null } } });

// Hash password before saving
UserSchema.pre('save', async function (next) {
  // Only hash if password is modified and exists
  if (!this.isModified('password') || !this.password) {
    return next();
  }

  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
UserSchema.methods.comparePassword = async function (candidatePassword) {
  // Safety check: if password is not set, comparison fails
  if (!this.password) {
    return false;
  }
  return await bcrypt.compare(candidatePassword, this.password);
};

// Update passwordChangedAt when password is changed
UserSchema.pre('save', function (next) {
  if (!this.isModified('password') || this.isNew) {
    return next();
  }
  this.passwordChangedAt = Date.now() - 1000; // 1 second buffer
  next();
});

// Check if password was changed after token was issued
UserSchema.methods.changedPasswordAfter = function (JWTTimestamp) {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(this.passwordChangedAt.getTime() / 1000, 10);
    return JWTTimestamp < changedTimestamp;
  }
  return false;
};

// Static method to find by company
UserSchema.statics.findByCompany = function (companyId) {
  return this.find({ companyId, isActive: true });
};

// Static method to find admins
UserSchema.statics.findAdmins = function (companyId) {
  return this.find({ companyId, role: 'admin', isActive: true });
};

// Virtual for full info
UserSchema.virtual('fullInfo').get(function () {
  return `${this.name} (${this.email}) - ${this.role}`;
});

// Ensure super_admin has no companyId
UserSchema.pre('save', function (next) {
  if (this.role === 'super_admin') {
    this.companyId = null;
  }
  next();
});

module.exports = mongoose.model('User', UserSchema);