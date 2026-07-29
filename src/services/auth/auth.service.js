const jwt = require('jsonwebtoken');
const User = require('../../models/auth/user.model');
const { AppError, UnauthorizedError, ConflictError, NotFoundError } = require('../../utils/errors');
const config = require('../../config');
const emailService = require('../../utils/emailService');
const crypto = require('crypto');

class AuthService {
  /**
   * Normalize phone number to international format for mobileNumber field.
   * - Strips spaces and dashes
   * - 10 digits → +91 prefix (Indian number)
   * - 12 digits starting with 91 → + prefix
   * - Already has + prefix → keep as-is
   * Returns null if phone is empty/falsy.
   */
  _normalizePhone(phone) {
    if (!phone) return null;
    let normalizedPhone = phone.replace(/[\s-]/g, '');
    if (/^\d{10}$/.test(normalizedPhone)) {
      normalizedPhone = '+91' + normalizedPhone;
    }
    if (/^91\d{10}$/.test(normalizedPhone)) {
      normalizedPhone = '+' + normalizedPhone;
    }
    return normalizedPhone;
  }

  async register(userData) {
    const { email, password, name, role, companyId, phone } = userData;

    // [GLOBAL UNIQUE EMAIL] Check if email exists anywhere in the system
    // One email can only belong to one user across all companies
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      throw new ConflictError('This Email ID is already registered in the system.');
    }

    // Validate role-specific requirements
    if (role === 'super_admin') {
      throw new AppError('Cannot create super admin through registration', 403);
    }

    if (role === 'admin' && !companyId) {
      throw new AppError('Company ID is required for admin role', 400);
    }

    // Create user
    const user = new User({
      email: email.toLowerCase(),
      password,
      name,
      role: role || 'user',
      companyId: companyId || null,
      phone,
      mobileNumber: phone ? this._normalizePhone(phone) : undefined,
    });

    try {
      await user.save();
    } catch (saveError) {
      // [GLOBAL UNIQUE EMAIL] Handle MongoDB duplicate key error
      if (saveError.code === 11000) {
        const field = Object.keys(saveError.keyValue)[0];
        if (field === 'email') {
          throw new ConflictError('This Email ID is already registered in the system. Each email can only be used once.');
        } else if (field === 'mobileNumber') {
          throw new ConflictError('This phone number is already registered in the system. Please use a different phone number.');
        } else {
          throw new ConflictError(`${field} is already in use.`);
        }
      }
      throw saveError;
    }

    // Generate tokens
    const { accessToken, refreshToken } = this.generateTokens(user);

    // Save refresh token
    user.refreshToken = refreshToken;
    await user.save();

    return {
      user: this.sanitizeUser(user),
      accessToken,
      refreshToken,
    };
  }

  async login(email, password) {
    // Find user
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user) {
      throw new UnauthorizedError('Invalid credentials');
    }

    // Check if active
    if (!user.isActive) {
      throw new UnauthorizedError('Account is deactivated. Please contact administrator.');
    }

    // Check if user's company is active (skip for super_admin who has no company)
    if (user.role !== 'super_admin' && user.companyId) {
      const Company = require('../../models/company/company.model');
      const company = await Company.findById(user.companyId).select('isActive');
      if (!company || !company.isActive) {
        throw new UnauthorizedError('Company account has been deactivated. Please contact your administrator.');
      }
    }

    // Verify password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      throw new UnauthorizedError('Invalid credentials');
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate tokens
    const { accessToken, refreshToken } = this.generateTokens(user);

    // Save refresh token
    user.refreshToken = refreshToken;
    await user.save();

    return {
      user: this.sanitizeUser(user),
      accessToken,
      refreshToken,
    };
  }

  async refreshToken(refreshToken) {
    // Verify refresh token
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, config.jwt.secret);
    } catch (error) {
      throw new UnauthorizedError('Invalid refresh token');
    }

    // Find user
    const user = await User.findById(decoded.id);
    if (!user || user.refreshToken !== refreshToken) {
      throw new UnauthorizedError('Invalid refresh token');
    }

    // Check if user is active
    if (!user.isActive) {
      throw new UnauthorizedError('Account is deactivated. Please contact administrator.');
    }

    // Check if user's company is active (skip for super_admin who has no company)
    if (user.role !== 'super_admin' && user.companyId) {
      const Company = require('../../models/company/company.model');
      const company = await Company.findById(user.companyId).select('isActive');
      if (!company || !company.isActive) {
        throw new UnauthorizedError('Company account has been deactivated. Please contact your administrator.');
      }
    }

    // Generate new tokens
    const tokens = this.generateTokens(user);

    // Update refresh token
    user.refreshToken = tokens.refreshToken;
    await user.save();

    return tokens;
  }

  async logout(userId) {
    const user = await User.findById(userId);
    if (user) {
      user.refreshToken = null;
      await user.save();
    }
    return true;
  }

  async forgotPassword(email) {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      // Don't reveal if user exists
      return { message: 'If user exists, password reset email will be sent' };
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpires = Date.now() + 3600000; // 1 hour
    await user.save();

    // Send email
    await emailService.sendPasswordResetEmail(user, resetToken);

    return { message: 'Password reset email sent' };
  }

  // Forgot Password OTP - For Admin users only
  async forgotPasswordOTP(email) {
    const user = await User.findOne({ email: email.toLowerCase() });

    // Always return same message to not reveal if email exists
    const genericMessage = 'If an admin account exists with this email, a verification code will be sent';

    if (!user) {
      return { success: true, message: genericMessage };
    }

    // Only allow for admin role
    if (user.role !== 'admin' && user.role !== 'super_admin') {
      return { success: true, message: genericMessage };
    }

    // Check if user is active
    if (!user.isActive) {
      return { success: true, message: genericMessage };
    }

    // Generate 6-digit OTP
    const otp = crypto.randomInt(100000, 999999).toString();
    const otpExpires = Date.now() + 10 * 60 * 1000; // 10 minutes

    // Store OTP (hashed for security)
    const hashedOTP = crypto.createHash('sha256').update(otp).digest('hex');

    user.forgotPasswordOTP = hashedOTP;
    user.forgotPasswordOTPExpires = otpExpires;
    user.forgotPasswordOTPVerified = false;
    user.forgotPasswordOTPAttempts = 0;
    await user.save();

    // Send OTP email
    try {
      await emailService.sendForgotPasswordOTPEmail(user.email, otp, user.name);
    } catch (error) {
      // In development, still return success but log error
      if (config.app.env === 'development') {
        console.log('[DEV] Forgot Password OTP:', otp);
        return { success: true, message: genericMessage, devOTP: otp };
      }
      throw new AppError('Failed to send OTP email', 500);
    }

    return { success: true, message: genericMessage };
  }

  // Verify Forgot Password OTP
  async verifyForgotPasswordOTP(email, otp) {
    const user = await User.findOne({ email: email.toLowerCase() }).select('+forgotPasswordOTP');

    if (!user) {
      return { success: false, message: 'Invalid verification code' };
    }

    // Only allow for admin role
    if (user.role !== 'admin' && user.role !== 'super_admin') {
      return { success: false, message: 'Invalid verification code' };
    }

    // Check if OTP exists and not expired
    if (!user.forgotPasswordOTP || !user.forgotPasswordOTPExpires) {
      return { success: false, message: 'No verification code found. Please request a new one.' };
    }

    if (user.forgotPasswordOTPExpires < Date.now()) {
      // Clear expired OTP
      user.forgotPasswordOTP = null;
      user.forgotPasswordOTPExpires = null;
      user.forgotPasswordOTPAttempts = 0;
      await user.save();
      return { success: false, message: 'Verification code has expired. Please request a new one.' };
    }

    // Check attempts
    if (user.forgotPasswordOTPAttempts >= 3) {
      user.forgotPasswordOTP = null;
      user.forgotPasswordOTPExpires = null;
      user.forgotPasswordOTPAttempts = 0;
      await user.save();
      return { success: false, message: 'Maximum attempts exceeded. Please request a new verification code.' };
    }

    // Verify OTP
    const hashedOTP = crypto.createHash('sha256').update(otp).digest('hex');
    if (user.forgotPasswordOTP !== hashedOTP) {
      user.forgotPasswordOTPAttempts += 1;
      await user.save();
      const remaining = 3 - user.forgotPasswordOTPAttempts;
      return { success: false, message: `Invalid verification code. ${remaining} attempts remaining.` };
    }

    // OTP verified - mark as verified
    user.forgotPasswordOTPVerified = true;
    await user.save();

    return { success: true, message: 'Verification successful' };
  }

  // Reset Password with OTP
  async resetPasswordWithOTP(email, otp, newPassword) {
    const user = await User.findOne({ email: email.toLowerCase() }).select('+forgotPasswordOTP');

    if (!user) {
      throw new AppError('Password reset failed', 400);
    }

    // Only allow for admin role
    if (user.role !== 'admin' && user.role !== 'super_admin') {
      throw new AppError('Password reset failed', 400);
    }

    // Check if OTP was verified
    if (!user.forgotPasswordOTPVerified) {
      throw new AppError('Please verify your email first', 400);
    }

    // Re-verify OTP is still valid
    if (!user.forgotPasswordOTP || !user.forgotPasswordOTPExpires) {
      throw new AppError('Verification code expired. Please start over.', 400);
    }

    if (user.forgotPasswordOTPExpires < Date.now()) {
      throw new AppError('Verification code expired. Please start over.', 400);
    }

    // Verify OTP again
    const hashedOTP = crypto.createHash('sha256').update(otp).digest('hex');
    if (user.forgotPasswordOTP !== hashedOTP) {
      throw new AppError('Invalid verification code', 400);
    }

    // Validate new password
    if (!newPassword || newPassword.length < 8) {
      throw new AppError('Password must be at least 8 characters', 400);
    }

    // Update password
    user.password = newPassword;
    user.passwordChangedAt = Date.now();

    // Clear OTP fields
    user.forgotPasswordOTP = null;
    user.forgotPasswordOTPExpires = null;
    user.forgotPasswordOTPVerified = false;
    user.forgotPasswordOTPAttempts = 0;

    await user.save();

    return { success: true, message: 'Password reset successfully' };
  }

  async resetPassword(token, newPassword) {
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      throw new AppError('Invalid or expired reset token', 400);
    }

    user.password = newPassword;
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    user.passwordChangedAt = Date.now();
    await user.save();

    return { message: 'Password reset successful' };
  }

  async changePassword(userId, currentPassword, newPassword) {
    const user = await User.findById(userId).select('+password');
    if (!user) {
      throw new NotFoundError('User');
    }

    const isPasswordValid = await user.comparePassword(currentPassword);
    if (!isPasswordValid) {
      throw new UnauthorizedError('Current password is incorrect');
    }

    user.password = newPassword;
    user.passwordChangedAt = Date.now();
    await user.save();

    return { message: 'Password changed successfully.' };
  }

  async getProfile(userId) {
    const user = await User.findById(userId).populate('companyId', 'name email');
    if (!user) {
      throw new NotFoundError('User');
    }
    return this.sanitizeUser(user);
  }

  async updateProfile(userId, updateData) {
    const allowedUpdates = ['name', 'phone', 'preferences'];
    const updates = {};

    Object.keys(updateData).forEach((key) => {
      if (allowedUpdates.includes(key)) {
        updates[key] = updateData[key];
      }
    });

    // [PHONE SYNC FIX] - When phone is updated, sync mobileNumber for OTP login and uniqueness
    if ('phone' in updateData) {
      if (updates.phone) {
        const normalizedPhone = this._normalizePhone(updates.phone);

        // Pre-check uniqueness before the MongoDB unique index error
        const existingUser = await User.findOne({
          mobileNumber: normalizedPhone,
          _id: { $ne: userId },
        });
        if (existingUser) {
          throw new ConflictError('This phone number is already registered in the system. Please use a different phone number.');
        }

        updates.mobileNumber = normalizedPhone;
      } else {
        // Phone cleared — free the old mobileNumber so it can be reused
        updates.mobileNumber = null;
      }
    }

    const user = await User.findByIdAndUpdate(userId, updates, {
      new: true,
      runValidators: true,
    }).populate('companyId', 'name email');

    if (!user) {
      throw new NotFoundError('User');
    }

    return this.sanitizeUser(user);
  }

  async createSuperAdmin(credentials = {}) {
    // Use provided credentials or fall back to environment variables or defaults
    const superAdminEmail = credentials.email || process.env.SUPER_ADMIN_EMAIL || 'admin@simmanagement.com';
    const superAdminPassword = credentials.password || process.env.SUPER_ADMIN_PASSWORD || 'SuperAdmin@123';
    const superAdminName = credentials.name || process.env.SUPER_ADMIN_NAME || 'Super Admin';

    const existingSuperAdmin = await User.findOne({ role: 'super_admin' });
    if (existingSuperAdmin) {
      return { message: 'Super admin already exists', user: this.sanitizeUser(existingSuperAdmin) };
    }

    // Validate email format
    const emailRegex = /^\S+@\S+\.\S+$/;
    if (!emailRegex.test(superAdminEmail)) {
      throw new AppError('Invalid email format', 400);
    }

    // Validate password length
    if (!superAdminPassword || superAdminPassword.length < 8) {
      throw new AppError('Password must be at least 8 characters', 400);
    }

    // Validate name
    if (!superAdminName || superAdminName.trim().length === 0) {
      throw new AppError('Name is required', 400);
    }

    const user = new User({
      email: superAdminEmail.toLowerCase().trim(),
      password: superAdminPassword,
      name: superAdminName.trim(),
      role: 'super_admin',
      companyId: null,
      isActive: true,
      emailVerified: true,
    });

    await user.save();
    return { message: 'Super admin created', user: this.sanitizeUser(user) };
  }

  generateTokens(user) {
    const accessToken = jwt.sign(
      { id: user._id, role: user.role, companyId: user.companyId },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    const refreshToken = jwt.sign(
      { id: user._id },
      config.jwt.secret,
      { expiresIn: config.jwt.refreshExpiresIn }
    );

    return { accessToken, refreshToken };
  }

  sanitizeUser(user) {
    const userObj = user.toObject ? user.toObject() : user;
    delete userObj.password;
    delete userObj.refreshToken;
    delete userObj.resetPasswordToken;
    delete userObj.resetPasswordExpires;
    delete userObj.__v;
    delete userObj.emailChangeOTP;
    delete userObj.emailChangeOTPExpires;
    delete userObj.emailChangeOTPVerified;
    delete userObj.pendingNewEmail;
    return userObj;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // EMAIL CHANGE FEATURE - Secure multi-step verification
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Step 1: Request email change
   * - Verifies password
   * - Checks new email is not already used
   * - Sends OTP to OLD email for verification
   */
  async requestEmailChange(userId, newEmail, password) {
    const user = await User.findById(userId).select('+password');
    if (!user) {
      throw new NotFoundError('User');
    }

    // Verify password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      throw new UnauthorizedError('Incorrect password');
    }

    // Check if new email is same as current
    if (newEmail.toLowerCase() === user.email.toLowerCase()) {
      throw new AppError('New email cannot be the same as your current email', 400);
    }

    // Check if new email is already used
    const existingUser = await User.findOne({ email: newEmail.toLowerCase() });
    if (existingUser) {
      throw new ConflictError('This email is already registered in the system');
    }

    // Generate 6-digit OTP for old email verification
    const otp = crypto.randomInt(100000, 999999).toString();
    const otpExpires = Date.now() + 10 * 60 * 1000; // 10 minutes

    // Store OTP and pending new email
    user.emailChangeOTP = crypto.createHash('sha256').update(otp).digest('hex');
    user.emailChangeOTPExpires = otpExpires;
    user.emailChangeOTPVerified = false;
    user.pendingNewEmail = newEmail.toLowerCase();
    await user.save();

    // Send OTP to OLD email
    try {
      await emailService.sendEmailChangeOTPOld(user.email, otp, user.name, newEmail);
    } catch (error) {
      // Clear the OTP if email fails
      user.emailChangeOTP = undefined;
      user.emailChangeOTPExpires = undefined;
      user.pendingNewEmail = undefined;
      await user.save();
      throw new AppError('Failed to send verification email. Please try again.', 500);
    }

    return {
      success: true,
      message: 'Verification code sent to your current email',
      oldEmail: user.email,
      newEmail: newEmail,
    };
  }

  /**
   * Step 2: Verify OTP sent to OLD email
   * - Validates the OTP
   * - Sends OTP to NEW email for verification
   */
  async verifyOldEmailOTP(userId, otp) {
    const user = await User.findById(userId).select('+emailChangeOTP');
    if (!user) {
      throw new NotFoundError('User');
    }

    // Check if email change was initiated
    if (!user.emailChangeOTP || !user.emailChangeOTPExpires || !user.pendingNewEmail) {
      throw new AppError('No pending email change request. Please start over.', 400);
    }

    // Check if OTP expired
    if (user.emailChangeOTPExpires < Date.now()) {
      user.emailChangeOTP = undefined;
      user.emailChangeOTPExpires = undefined;
      user.pendingNewEmail = undefined;
      await user.save();
      throw new AppError('Verification code has expired. Please start over.', 400);
    }

    // Verify OTP
    const hashedOTP = crypto.createHash('sha256').update(otp).digest('hex');
    if (user.emailChangeOTP !== hashedOTP) {
      throw new AppError('Invalid verification code', 400);
    }

    // Mark old email as verified
    user.emailChangeOTPVerified = true;
    await user.save();

    // Generate new OTP for NEW email verification
    const newOTP = crypto.randomInt(100000, 999999).toString();
    const newOTPExpires = Date.now() + 10 * 60 * 1000; // 10 minutes

    // Update OTP for new email verification
    user.emailChangeOTP = crypto.createHash('sha256').update(newOTP).digest('hex');
    user.emailChangeOTPExpires = newOTPExpires;
    await user.save();

    // Send OTP to NEW email
    try {
      await emailService.sendEmailChangeOTPNew(user.pendingNewEmail, newOTP, user.name, user.email);
    } catch (error) {
      throw new AppError('Failed to send verification email to new address. Please try again.', 500);
    }

    return {
      success: true,
      message: 'Verification code sent to your new email',
    };
  }

  /**
   * Step 3: Verify OTP sent to NEW email and complete email change
   */
  async verifyNewEmailOTP(userId, otp) {
    const user = await User.findById(userId).select('+emailChangeOTP');
    if (!user) {
      throw new NotFoundError('User');
    }

    // Check if email change was initiated and old email was verified
    if (!user.emailChangeOTP || !user.emailChangeOTPExpires || !user.pendingNewEmail || !user.emailChangeOTPVerified) {
      throw new AppError('No pending email change request. Please start over.', 400);
    }

    // Check if OTP expired
    if (user.emailChangeOTPExpires < Date.now()) {
      user.emailChangeOTP = undefined;
      user.emailChangeOTPExpires = undefined;
      user.emailChangeOTPVerified = undefined;
      user.pendingNewEmail = undefined;
      await user.save();
      throw new AppError('Verification code has expired. Please start over.', 400);
    }

    // Verify OTP
    const hashedOTP = crypto.createHash('sha256').update(otp).digest('hex');
    if (user.emailChangeOTP !== hashedOTP) {
      throw new AppError('Invalid verification code', 400);
    }

    // Double-check new email is still available
    const existingUser = await User.findOne({ email: user.pendingNewEmail });
    if (existingUser) {
      user.emailChangeOTP = undefined;
      user.emailChangeOTPExpires = undefined;
      user.emailChangeOTPVerified = undefined;
      user.pendingNewEmail = undefined;
      await user.save();
      throw new ConflictError('This email is now registered by another user. Please try a different email.');
    }

    const oldEmail = user.email;
    const newEmail = user.pendingNewEmail;

    // Update email
    user.email = newEmail;
    user.emailChangeOTP = undefined;
    user.emailChangeOTPExpires = undefined;
    user.emailChangeOTPVerified = undefined;
    user.pendingNewEmail = undefined;
    user.emailVerified = true;
    await user.save();

    // Send confirmation emails
    try {
      await emailService.sendEmailChangeConfirmationOld(oldEmail, user.name, newEmail);
      await emailService.sendEmailChangeConfirmationNew(newEmail, user.name, oldEmail);
    } catch (error) {
      // Don't fail if confirmation emails fail
      console.error('Failed to send confirmation emails:', error.message);
    }

    return {
      success: true,
      message: 'Email updated successfully',
      newEmail: newEmail,
    };
  }

  /**
   * Cancel pending email change
   */
  async cancelEmailChange(userId) {
    const user = await User.findById(userId);
    if (!user) {
      throw new NotFoundError('User');
    }

    user.emailChangeOTP = undefined;
    user.emailChangeOTPExpires = undefined;
    user.emailChangeOTPVerified = undefined;
    user.pendingNewEmail = undefined;
    await user.save();

    return { success: true, message: 'Email change cancelled' };
  }

  async resendEmailChangeOTP(userId) {
    const user = await User.findById(userId).select('+emailChangeOTP');
    if (!user) {
      throw new NotFoundError('User');
    }

    if (!user.emailChangeOTP || !user.emailChangeOTPExpires || !user.pendingNewEmail) {
      throw new AppError('No pending email change request. Please start over.', 400);
    }

    // Generate new OTP
    const otp = crypto.randomInt(100000, 999999).toString();
    const otpExpires = Date.now() + 10 * 60 * 1000; // 10 minutes

    user.emailChangeOTP = crypto.createHash('sha256').update(otp).digest('hex');
    user.emailChangeOTPExpires = otpExpires;
    await user.save();

    // Resend to appropriate email based on verification status
    try {
      if (!user.emailChangeOTPVerified) {
        // Old email not yet verified — resend to old email
        await emailService.sendEmailChangeOTPOld(user.email, otp, user.name, user.pendingNewEmail);
      } else {
        // Old email verified — resend to new email
        await emailService.sendEmailChangeOTPNew(user.pendingNewEmail, otp, user.name, user.email);
      }
    } catch (error) {
      throw new AppError('Failed to send verification email. Please try again.', 500);
    }

    return { success: true, message: 'Verification code resent successfully' };
  }
}

module.exports = new AuthService();