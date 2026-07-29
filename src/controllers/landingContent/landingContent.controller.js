const landingContentService = require('../../services/landingContent/landingContent.service');
const auditLogService = require('../../services/auditLog/auditLog.service');
const { successResponse } = require('../../utils/response');

class LandingContentController {
  /**
   * Get public landing page content (no auth required)
   */
  async getPublicContent(req, res, next) {
    try {
      const content = await landingContentService.getPublicContent();
      return successResponse(res, content);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get full landing page content (Super Admin only)
   */
  async getFullContent(req, res, next) {
    try {
      const content = await landingContentService.getActiveContent();
      return successResponse(res, content);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update entire landing page content (Super Admin only)
   */
  async updateContent(req, res, next) {
    try {
      const content = await landingContentService.updateContent(req.body, req.user._id);

      // Audit log
      await auditLogService.logAction({
        action: 'LANDING_CONTENT_UPDATE',
        module: 'LANDING_CONTENT',
        description: 'Updated landing page content',
        performedBy: req.user._id,
        role: req.user.role,
        metadata: { sections: Object.keys(req.body) },
        req,
      });

      return successResponse(res, content, 'Landing page content updated successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update specific section (Super Admin only)
   */
  async updateSection(req, res, next) {
    try {
      const { section } = req.params;
      const content = await landingContentService.updateSection(section, req.body, req.user._id);

      // Audit log
      await auditLogService.logAction({
        action: 'LANDING_CONTENT_SECTION_UPDATE',
        module: 'LANDING_CONTENT',
        description: `Updated ${section} section`,
        performedBy: req.user._id,
        role: req.user.role,
        metadata: { section },
        req,
      });

      return successResponse(res, content, `${section} section updated successfully`);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Upload logo (Super Admin only)
   */
  async uploadLogo(req, res, next) {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No file uploaded',
        });
      }

      const { type } = req.body; // 'logo' or 'logoDark' or 'favicon'
      const logoType = type || 'logo';

      // Construct the URL - use relative path that works with the frontend API URL
      // The frontend will prepend the API base URL
      const logoUrl = `/uploads/branding/${req.file.filename}`;

      // Update the landing content with the new logo URL
      const content = await landingContentService.updateLogo(logoType, logoUrl, req.user._id);

      // Audit log
      await auditLogService.logAction({
        action: 'LOGO_UPLOAD',
        module: 'LANDING_CONTENT',
        description: `Uploaded ${logoType} logo`,
        performedBy: req.user._id,
        role: req.user.role,
        metadata: { logoType, filename: req.file.filename },
        req,
      });

      return successResponse(res, { logoUrl, branding: content.branding }, 'Logo uploaded successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete logo (Super Admin only)
   */
  async deleteLogo(req, res, next) {
    try {
      const { type } = req.params; // 'logo' or 'logoDark' or 'favicon'

      const content = await landingContentService.deleteLogo(type, req.user._id);

      // Audit log
      await auditLogService.logAction({
        action: 'LOGO_DELETE',
        module: 'LANDING_CONTENT',
        description: `Deleted ${type} logo`,
        performedBy: req.user._id,
        role: req.user.role,
        metadata: { logoType: type },
        req,
      });

      return successResponse(res, content, 'Logo deleted successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Reset to default content (Super Admin only)
   */
  async resetToDefault(req, res, next) {
    try {
      const content = await landingContentService.resetToDefault(req.user._id);

      // Audit log
      await auditLogService.logAction({
        action: 'LANDING_CONTENT_RESET',
        module: 'LANDING_CONTENT',
        description: 'Reset landing page content to default',
        performedBy: req.user._id,
        role: req.user.role,
        req,
      });

      return successResponse(res, content, 'Landing page content reset to default');
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new LandingContentController();