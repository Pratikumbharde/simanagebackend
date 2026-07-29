const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const User = require('../../models/auth/user.model');
const emailService = require('../../utils/emailService');
const jwt = require('jsonwebtoken');
const config = require('../../config');
const logger = require('../../utils/logger');

class OTPService {
  constructor() {
    this.OTP_LENGTH = 6;
    this.OTP_EXPIRY_MINUTES = 5;
    this.MAX_OTP_ATTEMPTS = 5;
    this.OTP_COOLDOWN_SECONDS = 10;
    this.OTP_SALT_ROUNDS = 10; // For hashing OTP
    // Bypass email for testing (set BYPASS_EMAIL_OTP=true in environment)
    // ONLY use this for automated testing - NEVER in production
    this.BYPASS_EMAIL = process.env.BYPASS_EMAIL_OTP === 'true';
  }

  /**
   * Generate a random 6-digit OTP
   */
  generateOTP() {
    const otp = crypto.randomInt(100000, 999999).toString();
    return otp;
  }

  /**
   * Hash OTP for secure storage
   * [EMAIL OTP FIX] - Hash OTP before storing in database for security
   */
  async hashOTP(otp) {
    const salt = await bcrypt.genSalt(this.OTP_SALT_ROUNDS);
    return bcrypt.hash(otp, salt);
  }

  /**
   * Verify hashed OTP
   */
  async verifyHashedOTP(candidateOTP, hashedOTP) {
    if (!hashedOTP) return false;
    return bcrypt.compare(candidateOTP, hashedOTP);
  }

  /**
   * Send OTP to user's email
   * [EMAIL OTP FIX] - Changed from mobile-based to email-based OTP authentication
   * The OTP is sent ONLY via email and NOT returned in the response (unless BYPASS_EMAIL_OTP=true)
   */
  async sendOTP(email) {
    try {
      // Find user by email
      const user = await User.findOne({ email: email.toLowerCase() });

      // If user not found
      if (!user) {
        logger.warn('[EMAIL OTP FIX] User not found for email', { email });
        return {
          success: false,
          message: 'No account found with this email',
        };
      }

      // Check if user is active
      if (!user.isActive) {
        logger.warn('[EMAIL OTP FIX] User account is deactivated', { email });
        return {
          success: false,
          message: 'Your account has been deactivated. Please contact administrator.',
        };
      }

      // Check cooldown based on lastOtpSentAt
      if (user.lastOtpSentAt) {
        const timeSinceLastOtp = Date.now() - user.lastOtpSentAt.getTime();
        const cooldownMs = this.OTP_COOLDOWN_SECONDS * 1000;

        if (timeSinceLastOtp < cooldownMs) {
          const remainingSeconds = Math.ceil((cooldownMs - timeSinceLastOtp) / 1000);
          return {
            success: false,
            message: `Please wait ${remainingSeconds} seconds before requesting a new OTP`,
            retryAfter: remainingSeconds,
          };
        }
      }

      // Generate OTP
      const otp = this.generateOTP();
      const otpExpires = new Date(Date.now() + (this.OTP_EXPIRY_MINUTES * 60 * 1000));
      const now = new Date();

      // [EMAIL OTP FIX] - Hash OTP before storing for security
      const hashedOTP = await this.hashOTP(otp);

      // Save OTP to user record
      user.otp = hashedOTP;
      user.otpExpires = otpExpires;
      user.otpAttempts = 0;
      user.lastOtpSentAt = now;
      await user.save();

      logger.info('[EMAIL OTP FIX] OTP generated and saved', {
        email,
        userId: user._id,
        expiresAt: otpExpires
      });

      // Log OTP to console for testing/development (remove in production)
      console.log(`[OTP] Email: ${email}, OTP: ${otp}`);

      // Check if email bypass is EXPLICITLY enabled (set BYPASS_EMAIL_OTP=true in .env)
      // This should ONLY be used for automated testing purposes
      if (this.BYPASS_EMAIL) {
        logger.info('[EMAIL OTP FIX] Email bypass enabled - returning OTP directly', { email });
        return {
          success: true,
          message: 'OTP generated (email bypassed - for testing only)',
          otp: otp, // Only when bypass is enabled
          expiresAt: otpExpires,
          bypassed: true,
        };
      }

      // Send OTP via email
      try {
        const emailResult = await emailService.sendOTPEmail(email, otp, user.mobileNumber || user.phone || '');
        console.log("Login Otp : ", otp)
        if (!emailResult.success) {
          logger.error('[EMAIL OTP FIX] Failed to send OTP email', {
            email,
            error: emailResult.error
          });

          return {
            success: false,
            message: 'Failed to send OTP email. Please try again or contact support.',
          };
        }

        logger.info('[EMAIL OTP FIX] OTP sent successfully via email', {
          email,
          userId: user._id
        });

        // SUCCESS - OTP sent via email, do NOT return OTP in response
        return {
          success: true,
          message: 'OTP sent to your email. Please check your inbox.',
          expiresAt: otpExpires,
        };
      } catch (emailError) {
        logger.error('[EMAIL OTP FIX] Email sending error', {
          email,
          error: emailError.message
        });

        return {
          success: false,
          message: 'Failed to send OTP. Please try again later.',
        };
      }
    } catch (error) {
      logger.error('[EMAIL OTP FIX] Error sending OTP', { email, error: error.message });
      throw error;
    }
  }

  /**
   * Verify OTP and generate JWT token
   * [EMAIL OTP FIX] - Changed from mobile-based to email-based OTP verification
   */
  async verifyOTP(email, otp) {
    try {
      // Find user by email
      const user = await User.findOne({ email: email.toLowerCase() }).select('+otp +otpExpires +otpAttempts');

      if (!user) {
        return {
          success: false,
          message: 'No account found with this email',
        };
      }

      // Check if OTP exists
      if (!user.otp || !user.otpExpires) {
        return {
          success: false,
          message: 'No OTP found. Please request a new OTP.',
        };
      }

      // Check if OTP is expired
      if (user.otpExpires < Date.now()) {
        // Clear expired OTP
        user.otp = undefined;
        user.otpExpires = undefined;
        user.otpAttempts = 0;
        await user.save();

        return {
          success: false,
          message: 'OTP has expired. Please request a new OTP.',
        };
      }

      // Check attempts
      if (user.otpAttempts >= this.MAX_OTP_ATTEMPTS) {
        return {
          success: false,
          message: 'Maximum OTP attempts exceeded. Please request a new OTP.',
        };
      }

      // [EMAIL OTP FIX] - Verify hashed OTP
      const isOTPValid = await this.verifyHashedOTP(otp, user.otp);

      if (!isOTPValid) {
        user.otpAttempts += 1;
        await user.save();

        const remainingAttempts = this.MAX_OTP_ATTEMPTS - user.otpAttempts;
        return {
          success: false,
          message: `Invalid OTP. ${remainingAttempts} attempts remaining.`,
          remainingAttempts,
        };
      }

      // OTP is valid - clear OTP fields from database
      user.otp = undefined;
      user.otpExpires = undefined;
      user.otpAttempts = 0;
      user.emailVerified = true;
      user.lastLogin = new Date();

      await user.save();

      // Generate JWT token
      const token = this.generateToken(user);
      const refreshToken = this.generateRefreshToken(user);

      // Save refresh token
      user.refreshToken = refreshToken;
      await user.save();

      logger.info('[EMAIL OTP FIX] User logged in via OTP', {
        email,
        userId: user._id,
        name: user.name
      });

      return {
        success: true,
        message: 'Login successful',
        token,
        refreshToken,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          mobileNumber: user.mobileNumber,
          phone: user.phone,
          role: user.role,
          companyId: user.companyId,
          emailVerified: user.emailVerified,
        },
      };
    } catch (error) {
      logger.error('[EMAIL OTP FIX] Error verifying OTP', { email, error: error.message });
      throw error;
    }
  }

  /**
   * Generate JWT token
   */
  generateToken(user) {
    return jwt.sign(
      {
        id: user._id,
        role: user.role,
        companyId: user.companyId,
      },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );
  }

  /**
   * Generate refresh token
   */
  generateRefreshToken(user) {
    return jwt.sign(
      { id: user._id },
      config.jwt.secret,
      { expiresIn: config.jwt.refreshExpiresIn }
    );
  }

  /**
   * Resend OTP
   */
  async resendOTP(email) {
    return this.sendOTP(email);
  }
}

module.exports = new OTPService();