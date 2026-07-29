const pageContentService = require('../services/pageContent.service');
const auditLogService = require('../services/auditLog/auditLog.service');
const logger = require('../utils/logger');

/**
 * Get page content by slug (public)
 */
const getPageBySlug = async (req, res) => {
  try {
    const { slug } = req.params
    const page = await pageContentService.getPageBySlug(slug)

    if (!page) {
      return res.status(404).json({
        success: false,
        message: 'Page not found',
      })
    }

    res.json({
      success: true,
      data: page,
    })
  } catch (error) {
    console.error('Error fetching page:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch page',
    })
  }
}

/**
 * Get all pages (super_admin only)
 */
const getAllPages = async (req, res) => {
  try {
    const pages = await pageContentService.getAllPages()

    res.json({
      success: true,
      data: pages,
    })
  } catch (error) {
    console.error('Error fetching pages:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pages',
    })
  }
}

/**
 * Get page details for editing (super_admin only)
 */
const getPageDetails = async (req, res) => {
  try {
    const { slug } = req.params
    const page = await pageContentService.getPageDetailsBySlug(slug)

    if (!page) {
      return res.status(404).json({
        success: false,
        message: 'Page not found',
      })
    }

    res.json({
      success: true,
      data: page,
    })
  } catch (error) {
    console.error('Error fetching page details:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch page details',
    })
  }
}

/**
 * Create or update page content (super_admin only)
 */
const upsertPage = async (req, res) => {
  try {
    const { slug } = req.params
    const { title, content, metaDescription } = req.body

    if (!title || !content) {
      return res.status(400).json({
        success: false,
        message: 'Title and content are required',
      })
    }

    const page = await pageContentService.upsertPage(slug, {
      title,
      content,
      metaDescription,
    })

    // Audit log: CONTENT_UPDATE
    try {
      await auditLogService.logAction({
        action: 'CONTENT_UPDATE',
        module: 'SETTINGS',
        description: `Updated page content: ${slug}`,
        performedBy: req.user._id,
        role: req.user.role,
        metadata: { slug, title, operation: 'upsert' },
        req,
      });
    } catch (auditError) {
      logger.error('[AUDIT LOG] Failed to log CONTENT_UPDATE', { error: auditError.message });
    }

    res.json({
      success: true,
      message: 'Page saved successfully',
      data: page,
    })
  } catch (error) {
    console.error('Error saving page:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to save page',
    })
  }
}

/**
 * Initialize default pages (super_admin only)
 */
const initializePages = async (req, res) => {
  try {
    await pageContentService.initializeDefaultPages()

    // Audit log: CONTENT_CREATE
    try {
      await auditLogService.logAction({
        action: 'CONTENT_CREATE',
        module: 'SETTINGS',
        description: 'Initialized default pages',
        performedBy: req.user._id,
        role: req.user.role,
        metadata: { operation: 'initialize_defaults' },
        req,
      });
    } catch (auditError) {
      logger.error('[AUDIT LOG] Failed to log CONTENT_CREATE', { error: auditError.message });
    }

    res.json({
      success: true,
      message: 'Default pages initialized',
    })
  } catch (error) {
    console.error('Error initializing pages:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to initialize pages',
    })
  }
}

module.exports = {
  getPageBySlug,
  getAllPages,
  getPageDetails,
  upsertPage,
  initializePages,
}