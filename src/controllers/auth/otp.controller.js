const otpService = require('../../services/auth/otp.service');
const logger = require('../../utils/logger');
const auditLogService = require('../../services/auditLog/auditLog.service');
const User = require('../../models/auth/user.model');

/**
 * Send OTP to email
 * [EMAIL OTP FIX] - Changed from mobile-based to email-based OTP authentication
 * POST /api/auth/send-otp
 */
const sendOTP = async (req, res) => {
  try {
    const { email } = req.body;

    // Validate email
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required',
      });
    }

    // Validate email format
    const emailRegex = /^\S+@\S+\.\S+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid Email ID',
      });
    }

    const result = await otpService.sendOTP(email);

    // Log OTP send attempt
    try {
      // Look up user for better audit data
      let userForAudit = null;
      try {
        userForAudit = await User.findOne({ email: email.toLowerCase() }).select('companyId role _id');
      } catch (e) { /* ignore lookup failure */ }

      await auditLogService.logAction({
        action: 'OTP_SEND',
        module: 'AUTH',
        description: `OTP sent to email ${email}`,
        performedBy: userForAudit?._id || null,
        role: userForAudit?.role || 'anonymous',
        companyId: userForAudit?.companyId || null,
        metadata: {
          email,
          success: result.success,
          retryAfter: result.retryAfter || null,
        },
        req,
      });
    } catch (auditError) {
      // Don't fail OTP send if audit log fails
    }

    // Handle different response scenarios
    if (!result.success) {
      if (result.retryAfter) {
        return res.status(429).json(result);
      }
      return res.status(400).json(result);
    }

    return res.status(200).json(result);
  } catch (error) {
    logger.error('[EMAIL OTP FIX] Send OTP error', { error: error.message });
    return res.status(500).json({
      success: false,
      message: 'Failed to send OTP. Please try again.',
    });
  }
};

/**
 * Verify OTP and login
 * [EMAIL OTP FIX] - Changed from mobile-based to email-based OTP verification
 * POST /api/auth/verify-otp
 */
const verifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    // Validate inputs
    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Email and OTP are required',
      });
    }

    // Validate email format
    const emailRegex = /^\S+@\S+\.\S+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid Email ID',
      });
    }

    // Validate OTP format (6 digits)
    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP format. OTP must be 6 digits.',
      });
    }

    const result = await otpService.verifyOTP(email, otp);

    if (!result.success) {
      return res.status(401).json(result);
    }

    // Fetch user's actual companyId from database for audit log accuracy
    const userForAudit = await User.findById(result.user.id).select('companyId role');
    const actualCompanyId = userForAudit?.companyId || null;

    // Audit log: OTP_VERIFY
    try {
      await auditLogService.logAction({
        action: 'OTP_VERIFY',
        module: 'AUTH',
        description: `OTP verified for ${result.user.email}`,
        performedBy: result.user.id,
        role: userForAudit?.role || result.user.role,
        companyId: actualCompanyId,
        metadata: {
          loginMethod: 'otp_email',
          email: result.user.email,
        },
        req,
      });
    } catch (auditError) {
      // Don't fail login if audit log fails
    }

    // Log user login
    await auditLogService.logAction({
      action: 'USER_LOGIN',
      module: 'AUTH',
      description: `User logged in via OTP (${result.user.email})`,
      performedBy: result.user.id,
      role: userForAudit?.role || result.user.role,
      companyId: actualCompanyId,
      metadata: {
        loginMethod: 'otp_email',
        email: result.user.email,
        userAgent: req.headers['user-agent'],
      },
      req,
    });

    return res.status(200).json(result);
  } catch (error) {
    logger.error('[EMAIL OTP FIX] Verify OTP error', { error: error.message });
    return res.status(500).json({
      success: false,
      message: 'Failed to verify OTP. Please try again.',
    });
  }
};

/**
 * Resend OTP
 * [EMAIL OTP FIX] - Changed from mobile-based to email-based
 * POST /api/auth/resend-otp
 */
const resendOTP = async (req, res) => {
  try {
    const { email } = req.body;

    // Validate email
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required',
      });
    }

    // Validate email format
    const emailRegex = /^\S+@\S+\.\S+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid Email ID',
      });
    }

    const result = await otpService.resendOTP(email);

    // Log OTP resend attempt
    try {
      // Look up user for better audit data
      let userForAudit = null;
      try {
        userForAudit = await User.findOne({ email: email.toLowerCase() }).select('companyId role _id');
      } catch (e) { /* ignore lookup failure */ }

      await auditLogService.logAction({
        action: 'OTP_RESEND',
        module: 'AUTH',
        description: `OTP resent to email ${email}`,
        performedBy: userForAudit?._id || null,
        role: userForAudit?.role || 'anonymous',
        companyId: userForAudit?.companyId || null,
        metadata: {
          email,
          success: result.success,
        },
        req,
      });
    } catch (auditError) {
      // Don't fail OTP resend if audit log fails
    }

    // Handle different response scenarios
    if (!result.success) {
      if (result.retryAfter) {
        return res.status(429).json(result);
      }
      return res.status(400).json(result);
    }

    return res.status(200).json(result);
  } catch (error) {
    logger.error('[EMAIL OTP FIX] Resend OTP error', { error: error.message });
    return res.status(500).json({
      success: false,
      message: 'Failed to resend OTP. Please try again.',
    });
  }
};

module.exports = {
  sendOTP,
  verifyOTP,
  resendOTP,
};