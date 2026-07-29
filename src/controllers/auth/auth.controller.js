const authService = require('../../services/auth/auth.service');
const auditLogService = require('../../services/auditLog/auditLog.service');
const { successResponse } = require('../../utils/response');
const User = require('../../models/auth/user.model');
const logger = require('../../utils/logger');

class AuthController {
  async register(req, res, next) {
    try {
      const result = await authService.register(req.body);

      // Audit log: USER_REGISTER
      try {
        await auditLogService.logAction({
          action: 'USER_REGISTER',
          module: 'AUTH',
          description: `New user registered: ${result.user?.name || result.user?.email || 'Unknown'}`,
          performedBy: result.user?._id || null,
          role: result.user?.role || 'user',
          companyId: result.user?.companyId || result.company?._id || null,
          metadata: {
            email: result.user?.email || req.body.email,
            companyName: req.body.companyName || null,
          },
          req,
        });
      } catch (auditError) {
        // Don't fail registration if audit log fails
      }

      return successResponse(res, result, 'User registered successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  async login(req, res, next) {
    try {
      const { email, password } = req.body;
      const result = await authService.login(email, password);

      // [AUDIT LOG FIX] - Fetch user's actual companyId from database to ensure accuracy
      const userForAudit = await User.findById(result.user._id).select('companyId role');
      const actualCompanyId = userForAudit?.companyId || null;

      // Audit log: USER_LOGIN
      await auditLogService.logAction({
        action: 'USER_LOGIN',
        module: 'AUTH',
        description: `User ${result.user.name} (${result.user.email}) logged in successfully`,
        performedBy: result.user._id,
        role: userForAudit?.role || result.user.role,
        companyId: actualCompanyId,
        req,
      });

      return successResponse(res, result, 'Login successful');
    } catch (error) {
      next(error);
    }
  }

  async refreshToken(req, res, next) {
    try {
      const { refreshToken } = req.body;
      const result = await authService.refreshToken(refreshToken);
      return successResponse(res, result, 'Token refreshed successfully');
    } catch (error) {
      next(error);
    }
  }

  async logout(req, res, next) {
    try {
      await authService.logout(req.user.id);

      // [AUDIT LOG FIX] - Fetch user's actual companyId from database to ensure accuracy
      // JWT token might have been issued before companyId was assigned
      const userForAudit = await User.findById(req.user.id).select('companyId role');
      const actualCompanyId = userForAudit?.companyId || null;

      // Determine login method from user info or request
      const loginMethod = req.user.mobileNumber ? 'otp' : 'email';
      const userType = req.user.mobileNumber ? 'mobile' : 'web';

      // Audit log: USER_LOGOUT
      await auditLogService.logAction({
        action: 'USER_LOGOUT',
        module: 'AUTH',
        description: `User logged out (${userType}${loginMethod === 'otp' ? ' - OTP login' : ''})`,
        performedBy: req.user.id,
        role: userForAudit?.role || req.user.role,
        companyId: actualCompanyId,
        metadata: {
          loginMethod,
          userType,
          mobileNumber: req.user.mobileNumber || null,
          email: req.user.email || null,
        },
        req,
      });

      return successResponse(res, null, 'Logged out successfully');
    } catch (error) {
      next(error);
    }
  }

  async forgotPassword(req, res, next) {
    try {
      const { email } = req.body;
      const result = await authService.forgotPassword(email);
      return successResponse(res, result, 'Password reset initiated');
    } catch (error) {
      next(error);
    }
  }

  // Forgot Password OTP - Step 1: Send OTP to admin email
  async forgotPasswordOTP(req, res, next) {
    try {
      const { email, isResend } = req.body;
      const result = await authService.forgotPasswordOTP(email);

      // Audit log
      try {
        // Look up user for better audit data (performedBy, companyId, role)
        let userForAudit = null;
        try {
          userForAudit = await User.findOne({ email: email.toLowerCase() }).select('companyId role _id');
        } catch (e) { /* ignore lookup failure */ }

        const action = isResend ? 'FORGOT_PASSWORD_OTP_RESEND' : 'FORGOT_PASSWORD_OTP_REQUEST';
        await auditLogService.logAction({
          action,
          module: 'AUTH',
          description: isResend
            ? `Password reset OTP resent for ${email}`
            : `Password reset OTP requested for ${email}`,
          performedBy: userForAudit?._id || null,
          role: userForAudit?.role || 'anonymous',
          companyId: userForAudit?.companyId || null,
          metadata: { email, isResend: !!isResend },
          req,
        });
      } catch (auditError) {
        // Don't fail forgot password if audit log fails
      }

      return successResponse(res, result, 'If an admin account exists with this email, a verification code will be sent');
    } catch (error) {
      next(error);
    }
  }

  // Forgot Password OTP - Step 2: Verify OTP
  async verifyForgotPasswordOTP(req, res, next) {
    try {
      const { email, otp } = req.body;
      const result = await authService.verifyForgotPasswordOTP(email, otp);

      if (!result.success) {
        // Audit log: failed verification attempt
        try {
          await auditLogService.logAction({
            action: 'FORGOT_PASSWORD_OTP_VERIFIED',
            module: 'AUTH',
            description: `Failed password reset OTP verification for ${email}: ${result.message}`,
            performedBy: null,
            role: 'anonymous',
            companyId: null,
            metadata: { email, success: false, reason: result.message },
            req,
          });
        } catch (auditError) {
          // Don't fail verification if audit log fails
        }

        return res.status(400).json(result);
      }

      // Audit log: successful verification
      try {
        // Look up user for better audit data
        let userForAudit = null;
        try {
          userForAudit = await User.findOne({ email: email.toLowerCase() }).select('companyId role _id');
        } catch (e) { /* ignore lookup failure */ }

        await auditLogService.logAction({
          action: 'FORGOT_PASSWORD_OTP_VERIFIED',
          module: 'AUTH',
          description: `Password reset OTP verified for ${email}`,
          performedBy: userForAudit?._id || null,
          role: userForAudit?.role || 'anonymous',
          companyId: userForAudit?.companyId || null,
          metadata: { email, success: true },
          req,
        });
      } catch (auditError) {
        // Don't fail verification if audit log fails
      }

      return successResponse(res, result, 'Verification successful');
    } catch (error) {
      next(error);
    }
  }

  // Forgot Password OTP - Step 3: Reset Password
  async resetPasswordWithOTP(req, res, next) {
    try {
      const { email, otp, newPassword } = req.body;
      const result = await authService.resetPasswordWithOTP(email, otp, newPassword);

      // Audit log: successful password reset
      try {
        // Look up user for better audit data
        let userForAudit = null;
        try {
          userForAudit = await User.findOne({ email: email.toLowerCase() }).select('companyId role _id');
        } catch (e) { /* ignore lookup failure */ }

        await auditLogService.logAction({
          action: 'PASSWORD_RESET',
          module: 'AUTH',
          description: `Password reset successfully for ${email}`,
          performedBy: userForAudit?._id || null,
          role: userForAudit?.role || 'anonymous',
          companyId: userForAudit?.companyId || null,
          metadata: { email, method: 'otp' },
          req,
        });
      } catch (auditError) {
        // Don't fail password reset if audit log fails
      }

      return successResponse(res, result, 'Password reset successfully');
    } catch (error) {
      // Audit log: failed password reset attempt
      try {
        await auditLogService.logAction({
          action: 'PASSWORD_RESET',
          module: 'AUTH',
          description: `Failed password reset attempt for ${req.body.email}: ${error.message}`,
          performedBy: null,
          role: 'anonymous',
          companyId: null,
          metadata: { email: req.body.email, success: false, error: error.message, method: 'otp' },
          req,
        });
      } catch (auditError) {
        // Don't fail error handling if audit log fails
      }

      next(error);
    }
  }

  async resetPassword(req, res, next) {
    try {
      const { token } = req.params;
      const { password } = req.body;
      const result = await authService.resetPassword(token, password);

      // Audit log: PASSWORD_RESET
      try {
        await auditLogService.logAction({
          action: 'PASSWORD_RESET',
          module: 'AUTH',
          description: 'Password reset via token completed',
          performedBy: null,
          role: 'anonymous',
          companyId: null,
          metadata: { method: 'token_reset' },
          req,
        });
      } catch (auditError) {
        // Don't fail password reset if audit log fails
      }

      return successResponse(res, result, 'Password reset successful');
    } catch (error) {
      next(error);
    }
  }

  async changePassword(req, res, next) {
    try {
      const { currentPassword, newPassword } = req.body;
      const result = await authService.changePassword(req.user.id, currentPassword, newPassword);

      // Audit log: PASSWORD_CHANGE
      try {
        const userForAudit = await User.findById(req.user.id).select('companyId role email name');
        await auditLogService.logAction({
          action: 'PASSWORD_CHANGE',
          module: 'AUTH',
          description: `Password changed for ${userForAudit?.email || req.user.email}`,
          performedBy: req.user.id,
          role: userForAudit?.role || req.user.role,
          companyId: userForAudit?.companyId || req.user.companyId,
          metadata: { email: userForAudit?.email || req.user.email },
          req,
        });
      } catch (auditError) {
        // Don't fail password change if audit log fails
      }

      return successResponse(res, result, 'Password changed successfully.');
    } catch (error) {
      next(error);
    }
  }

  async getProfile(req, res, next) {
    try {
      const user = await authService.getProfile(req.user.id);
      return successResponse(res, user, 'Profile fetched successfully');
    } catch (error) {
      next(error);
    }
  }

  async updateProfile(req, res, next) {
    try {
      const user = await authService.updateProfile(req.user.id, req.body);

      // Audit log: SETTINGS_UPDATE
      try {
        await auditLogService.logAction({
          action: 'SETTINGS_UPDATE',
          module: 'SETTINGS',
          description: `User ${user.name || user.email} updated their profile settings`,
          performedBy: req.user.id,
          role: req.user.role,
          companyId: req.user.companyId,
          entityId: req.user.id,
          entityType: 'USER',
          metadata: { updatedFields: Object.keys(req.body) },
          req,
        });
      } catch (auditError) {
        logger.error('[AUDIT LOG] Failed to log SETTINGS_UPDATE', { error: auditError.message });
      }

      return successResponse(res, user, 'Profile updated successfully.');
    } catch (error) {
      next(error);
    }
  }

  async initSuperAdmin(req, res, next) {
    try {
      // Pass request body credentials to the service
      // If no credentials provided, defaults will be used
      const credentials = {
        email: req.body?.email,
        password: req.body?.password,
        name: req.body?.name,
      };
      const result = await authService.createSuperAdmin(credentials);
      return successResponse(res, result, 'Super admin initialized');
    } catch (error) {
      next(error);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // EMAIL CHANGE - Multi-step verification
  // ═══════════════════════════════════════════════════════════════════════════════

  async requestEmailChange(req, res, next) {
    try {
      const { newEmail, password } = req.body;
      const result = await authService.requestEmailChange(req.user.id, newEmail, password);

      // Audit log
      await auditLogService.logAction({
        action: 'EMAIL_CHANGE_REQUESTED',
        module: 'AUTH',
        description: `Email change requested from ${req.user.email} to ${newEmail}`,
        performedBy: req.user.id,
        role: req.user.role,
        companyId: req.user.companyId,
        metadata: { oldEmail: req.user.email, newEmail },
        req,
      });

      return successResponse(res, result, 'Verification code sent to your current email');
    } catch (error) {
      next(error);
    }
  }

  async verifyOldEmailOTP(req, res, next) {
    try {
      const { otp } = req.body;
      const result = await authService.verifyOldEmailOTP(req.user.id, otp);

      // Audit log
      await auditLogService.logAction({
        action: 'EMAIL_CHANGE_OLD_VERIFIED',
        module: 'AUTH',
        description: 'Old email verified for email change',
        performedBy: req.user.id,
        role: req.user.role,
        companyId: req.user.companyId,
        req,
      });

      return successResponse(res, result, 'Verification code sent to your new email');
    } catch (error) {
      next(error);
    }
  }

  async verifyNewEmailOTP(req, res, next) {
    try {
      const { otp } = req.body;
      const result = await authService.verifyNewEmailOTP(req.user.id, otp);

      // Audit log
      await auditLogService.logAction({
        action: 'EMAIL_CHANGE_COMPLETED',
        module: 'AUTH',
        description: `Email changed from ${req.user.email} to ${result.newEmail}`,
        performedBy: req.user.id,
        role: req.user.role,
        companyId: req.user.companyId,
        metadata: { oldEmail: req.user.email, newEmail: result.newEmail },
        req,
      });

      return successResponse(res, result, 'Email updated successfully');
    } catch (error) {
      next(error);
    }
  }

  async cancelEmailChange(req, res, next) {
    try {
      const result = await authService.cancelEmailChange(req.user.id);
      return successResponse(res, result, 'Email change cancelled');
    } catch (error) {
      next(error);
    }
  }

  async resendEmailChangeOTP(req, res, next) {
    try {
      const result = await authService.resendEmailChangeOTP(req.user.id);

      // Audit log: EMAIL_CHANGE_RESEND
      try {
        await auditLogService.logAction({
          action: 'EMAIL_CHANGE_RESEND',
          module: 'AUTH',
          description: `Email change verification code resent for ${req.user.email}`,
          performedBy: req.user.id,
          role: req.user.role,
          companyId: req.user.companyId,
          metadata: { email: req.user.email },
          req,
        });
      } catch (auditError) {
        // Don't fail resend if audit log fails
      }

      return successResponse(res, result, 'Verification code resent');
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AuthController();