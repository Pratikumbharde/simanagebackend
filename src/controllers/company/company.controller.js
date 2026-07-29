const companyService = require('../../services/company/company.service');
const auditLogService = require('../../services/auditLog/auditLog.service');
const { successResponse, paginatedResponse } = require('../../utils/response');

class CompanyController {
  /**
   * Check if a company name is available
   * GET /api/companies/check-name?name=CompanyName&excludeId=xxx
   */
  async checkCompanyName(req, res, next) {
    try {
      const { name } = req.query;
      if (!name || !name.trim()) {
        return successResponse(res, { available: false, message: 'Company name is required' });
      }

      const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const existingCompany = await require('../../models/company/company.model').findOne({
        name: { $regex: new RegExp(`^${escapeRegex(name.trim())}$`, 'i') }
      });

      return successResponse(res, {
        available: !existingCompany,
        message: existingCompany ? 'A company with this name already exists' : 'Company name is available',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Check if an admin email is already registered
   * GET /api/companies/check-admin-email?email=user@example.com
   */
  async checkAdminEmail(req, res, next) {
    try {
      const { email } = req.query;
      if (!email || !email.trim()) {
        return successResponse(res, { exists: false, message: 'Email is required' });
      }

      const User = require('../../models/user/user.model');
      const existingUser = await User.findOne({ email: email.trim().toLowerCase() });

      return successResponse(res, {
        exists: !!existingUser,
        message: existingUser ? 'This email is already registered' : 'Email is available',
      });
    } catch (error) {
      next(error);
    }
  }

  async create(req, res, next) {
    try {
      const company = await companyService.createCompany(req.body, req.user.id);

      // Audit log: COMPANY_CREATE
      await auditLogService.logAction({
        action: 'COMPANY_CREATE',
        module: 'COMPANY',
        description: `Created company ${company.name}`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: company._id,
        entityId: company._id,
        entityType: 'COMPANY',
        metadata: { name: company.name, email: company.email },
        req,
      });

      return successResponse(res, company, 'Company created successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  async getAll(req, res, next) {
    try {
      const result = await companyService.getAllCompanies(req.query);
      return paginatedResponse(res, result.data, result.total, result.page, result.limit);
    } catch (error) {
      next(error);
    }
  }

  async getList(req, res, next) {
    try {
      const companies = await companyService.getCompanyList();
      return successResponse(res, companies);
    } catch (error) {
      next(error);
    }
  }

  async getById(req, res, next) {
    try {
      const company = await companyService.getCompanyById(req.params.id);
      return successResponse(res, company);
    } catch (error) {
      next(error);
    }
  }

  async update(req, res, next) {
    try {
      const company = await companyService.updateCompany(req.params.id, req.body);

      // Audit log: COMPANY_UPDATE
      await auditLogService.logAction({
        action: 'COMPANY_UPDATE',
        module: 'COMPANY',
        description: `Updated company ${company.name}`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: company._id,
        entityId: company._id,
        entityType: 'COMPANY',
        metadata: { changes: req.body },
        req,
      });

      return successResponse(res, company, 'Company updated successfully');
    } catch (error) {
      next(error);
    }
  }

  async delete(req, res, next) {
    try {
      const company = await companyService.deleteCompany(req.params.id);

      // Audit log: COMPANY_DELETE
      await auditLogService.logAction({
        action: 'COMPANY_DELETE',
        module: 'COMPANY',
        description: `Deleted company ${company.name}`,
        performedBy: req.user._id,
        role: req.user.role,
        entityId: company._id,
        entityType: 'COMPANY',
        metadata: { name: company.name },
        req,
      });

      return successResponse(res, null, 'Company deleted successfully');
    } catch (error) {
      next(error);
    }
  }

  async renewSubscription(req, res, next) {
    try {
      const { subscriptionId, billingCycle = 'monthly' } = req.body;
      const result = await companyService.renewSubscription(
        req.params.id,
        subscriptionId,
        billingCycle,
        req.user._id // Pass admin ID for history tracking
      );

      // Audit log: COMPANY_SUBSCRIPTION_RENEW
      await auditLogService.logAction({
        action: 'COMPANY_SUBSCRIPTION_RENEW',
        module: 'COMPANY',
        description: `Renewed subscription for company ${result.company.name} to plan ${result.company.subscriptionId}`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: result.company._id,
        entityId: result.company._id,
        entityType: 'COMPANY',
        metadata: {
          subscriptionId,
          billingCycle,
          changeType: result.type,
          bonusDays: result.bonusDays,
          remainingDays: result.remainingDays,
        },
        req,
      });

      return successResponse(res, result.company, result.message);
    } catch (error) {
      next(error);
    }
  }

  async extendTrial(req, res, next) {
    try {
      const { days } = req.body;
      const company = await companyService.extendTrial(req.params.id, days);

      // Audit log: COMPANY_TRIAL_EXTEND
      await auditLogService.logAction({
        action: 'COMPANY_TRIAL_EXTEND',
        module: 'COMPANY',
        description: `Extended trial for company ${company.name} by ${days} days`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: company._id,
        entityId: company._id,
        entityType: 'COMPANY',
        metadata: { days },
        req,
      });

      return successResponse(res, company, 'Trial extended successfully');
    } catch (error) {
      next(error);
    }
  }

  async getStats(req, res, next) {
    try {
      const stats = await companyService.getCompanyStats(req.params.id);
      return successResponse(res, stats);
    } catch (error) {
      next(error);
    }
  }

  async getExpiring(req, res, next) {
    try {
      const { days } = req.query;
      const companies = await companyService.getExpiringSubscriptions(days || 7);
      return successResponse(res, companies);
    } catch (error) {
      next(error);
    }
  }

  async getDashboardOverview(req, res, next) {
    try {
      const overview = await companyService.getDashboardOverview();
      return successResponse(res, overview);
    } catch (error) {
      next(error);
    }
  }

  // Admin Management
  async createAdmin(req, res, next) {
    try {
      const { companyId } = req.params;
      const result = await companyService.createAdmin(companyId, req.body, req.user.id);

      // Audit log: COMPANY_ADMIN_CREATE
      await auditLogService.logAction({
        action: 'COMPANY_ADMIN_CREATE',
        module: 'COMPANY',
        description: `Created admin ${result.user.name} for company`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: companyId,
        entityId: result.user._id,
        entityType: 'USER',
        metadata: { email: result.user.email },
        req,
      });

      // [ADMIN EMAIL FIX] Return appropriate message based on email status
      const message = result.emailSent
        ? 'Admin created successfully. Login credentials sent to email.'
        : 'Admin created successfully.';

      return successResponse(res, { ...result.user, accessToken: result.accessToken, emailSent: result.emailSent }, message, 201);
    } catch (error) {
      next(error);
    }
  }

  async getCompanyAdmins(req, res, next) {
    try {
      const { companyId } = req.params;
      const admins = await companyService.getCompanyAdmins(companyId);
      return successResponse(res, admins);
    } catch (error) {
      next(error);
    }
  }

  async getAdminById(req, res, next) {
    try {
      const admin = await companyService.getAdminById(req.params.adminId);
      return successResponse(res, admin);
    } catch (error) {
      next(error);
    }
  }

  async updateAdmin(req, res, next) {
    try {
      const admin = await companyService.updateAdmin(req.params.adminId, req.body);

      // Audit log: COMPANY_ADMIN_UPDATE
      await auditLogService.logAction({
        action: 'COMPANY_ADMIN_UPDATE',
        module: 'COMPANY',
        description: `Updated admin ${admin.name}`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: admin.companyId,
        entityId: admin._id,
        entityType: 'USER',
        metadata: { changes: req.body },
        req,
      });

      return successResponse(res, admin, 'Admin updated successfully');
    } catch (error) {
      next(error);
    }
  }

  async deleteAdmin(req, res, next) {
    try {
      const admin = await companyService.deleteAdmin(req.params.adminId);

      // Audit log: COMPANY_ADMIN_DELETE
      await auditLogService.logAction({
        action: 'COMPANY_ADMIN_DELETE',
        module: 'COMPANY',
        description: `Deleted admin ${admin.name}`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: admin.companyId,
        entityId: admin._id,
        entityType: 'USER',
        metadata: { email: admin.email },
        req,
      });

      return successResponse(res, null, 'Admin deleted successfully');
    } catch (error) {
      next(error);
    }
  }

  async resetAdminPassword(req, res, next) {
    try {
      const result = await companyService.resetAdminPassword(req.params.adminId, req.body.password, req.user);

      // Audit log: USER_PASSWORD_RESET
      await auditLogService.logAction({
        action: 'USER_PASSWORD_RESET',
        module: 'USER',
        description: `Reset password for admin`,
        performedBy: req.user._id,
        role: req.user.role,
        entityId: req.params.adminId,
        entityType: 'USER',
        req,
      });

      return successResponse(res, result);
    } catch (error) {
      next(error);
    }
  }

  async getMySubscription(req, res, next) {
    try {
      const subscription = await companyService.getMySubscription(req.user.companyId);
      return successResponse(res, subscription);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get company details for logged-in user
   * GET /api/company/my
   */
  async getMyCompany(req, res, next) {
    try {
      const company = await companyService.getMyCompany(req.user.companyId);
      return successResponse(res, company);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update own company profile (for company admins)
   * PUT /api/companies/my
   * Admins can only update name, email, phone, website, and address
   */
  async updateMyCompany(req, res, next) {
    try {
      const company = await companyService.updateMyCompany(req.user.companyId, req.body, req.user);

      // Audit log: COMPANY_PROFILE_UPDATE
      await auditLogService.logAction({
        action: 'COMPANY_PROFILE_UPDATE',
        module: 'COMPANY',
        description: `Updated company profile ${company.name}`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: company._id,
        entityId: company._id,
        entityType: 'COMPANY',
        metadata: { changes: req.body },
        req,
      });

      return successResponse(res, company, 'Company profile updated successfully.');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get company details by ID
   * GET /api/company/:companyId
   * Note: Users can only access their own company, super_admin can access any
   */
  async getCompanyDetailsById(req, res, next) {
    try {
      const company = await companyService.getCompanyDetailsById(
        req.params.companyId,
        req.user.companyId,
        req.user.role
      );
      return successResponse(res, company);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Request company email change
   * POST /api/companies/my/email-change/request
   */
  async requestCompanyEmailChange(req, res, next) {
    try {
      const { newEmail, password } = req.body;
      const result = await companyService.requestCompanyEmailChange(
        req.user.companyId,
        newEmail,
        password,
        req.user
      );

      // Audit log
      await auditLogService.logAction({
        action: 'COMPANY_EMAIL_CHANGE_REQUEST',
        module: 'COMPANY',
        description: `Requested email change for company to ${newEmail}`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: req.user.companyId,
        entityId: req.user.companyId,
        entityType: 'COMPANY',
        metadata: { newEmail },
        req,
      });

      return successResponse(res, result, 'Verification code sent to current company email');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Verify old email OTP for company email change
   * POST /api/companies/my/email-change/verify-old
   */
  async verifyCompanyEmailOld(req, res, next) {
    try {
      const { otp } = req.body;
      const result = await companyService.verifyCompanyEmailOld(req.user.companyId, otp);

      return successResponse(res, result, 'Verification code sent to new email');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Verify new email OTP and complete company email change
   * POST /api/companies/my/email-change/verify-new
   */
  async verifyCompanyEmailNew(req, res, next) {
    try {
      const { otp } = req.body;
      const result = await companyService.verifyCompanyEmailNew(req.user.companyId, otp, req.user);

      // Audit log
      await auditLogService.logAction({
        action: 'COMPANY_EMAIL_CHANGE_COMPLETE',
        module: 'COMPANY',
        description: `Completed company email change to ${result.email}`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: req.user.companyId,
        entityId: req.user.companyId,
        entityType: 'COMPANY',
        metadata: { newEmail: result.email },
        req,
      });

      return successResponse(res, result, 'Company email updated successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Cancel company email change
   * POST /api/companies/my/email-change/cancel
   */
  async cancelCompanyEmailChange(req, res, next) {
    try {
      await companyService.cancelCompanyEmailChange(req.user.companyId);

      // Audit log
      await auditLogService.logAction({
        action: 'COMPANY_EMAIL_CHANGE_CANCEL',
        module: 'COMPANY',
        description: 'Cancelled company email change request',
        performedBy: req.user._id,
        role: req.user.role,
        companyId: req.user.companyId,
        entityId: req.user.companyId,
        entityType: 'COMPANY',
        req,
      });

      return successResponse(res, null, 'Email change request cancelled');
    } catch (error) {
      next(error);
    }
  }

  async resendCompanyEmailChangeOTP(req, res, next) {
    try {
      await companyService.resendCompanyEmailChangeOTP(req.user.companyId);

      // Audit log: COMPANY_EMAIL_CHANGE_RESEND
      try {
        await auditLogService.logAction({
          action: 'COMPANY_EMAIL_CHANGE_RESEND',
          module: 'COMPANY',
          description: `Company email change verification code resent`,
          performedBy: req.user.id,
          role: req.user.role,
          companyId: req.user.companyId,
          entityType: 'COMPANY',
          entityId: req.user.companyId,
          req,
        });
      } catch (auditError) {
        // Don't fail resend if audit log fails
      }

      return successResponse(res, null, 'Verification code resent');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get subscription history for a company
   * GET /api/companies/:id/subscription-history
   */
  async getSubscriptionHistory(req, res, next) {
    try {
      const { page = 1, limit = 20 } = req.query;
      const history = await companyService.getSubscriptionHistory(req.params.id, { page, limit });
      return successResponse(res, history);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new CompanyController();