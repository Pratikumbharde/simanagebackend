/**
 * Call Attempt Controller
 *
 * Handles HTTP requests for call attempt history.
 */

const callAttemptService = require('../../services/callAttempt/callAttempt.service');
const { successResponse, paginatedResponse } = require('../../utils/response');
const logger = require('../../utils/logger');

class CallAttemptController {
  /**
   * Get call attempts for the authenticated user's company
   * GET /api/call-automation/call-attempts?page=1&limit=50&status=connected&targetSimNumber=XXX&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
   */
  async getCallAttempts(req, res, next) {
    try {
      const companyId = req.companyId || req.user.companyId;
      const { page = 1, limit = 50, status, callerSimNumber, targetSimNumber, startDate, endDate } = req.query;

      const result = await callAttemptService.getAttempts(companyId, {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        status,
        callerSimNumber,
        targetSimNumber,
        startDate,
        endDate,
      });

      return paginatedResponse(res, result.data, result.total, result.page, result.limit, 'Call attempts retrieved successfully');
    } catch (error) {
      logger.error('[CallAttemptController] Error getting attempts:', error);
      next(error);
    }
  }

  /**
   * Get connection status for each target SIM in the authenticated user's company.
   * Returns whether each target is "connected" or "not_connected" based on the latest call attempt.
   * GET /api/call-automation/connection-status
   */
  async getConnectionStatus(req, res, next) {
    try {
      const companyId = req.companyId || req.user.companyId;

      const result = await callAttemptService.getConnectionStatus(companyId);

      return successResponse(res, result);
    } catch (error) {
      logger.error('[CallAttemptController] Error getting connection status:', error);
      next(error);
    }
  }
}

module.exports = new CallAttemptController();