const leadService = require('../../services/lead/lead.service');
const { successResponse, paginatedResponse } = require('../../utils/response');

class LeadController {
  async create(req, res, next) {
    try {
      const lead = await leadService.create(req.body);
      return successResponse(res, lead, 'Thank you for contacting us! We will get back to you soon.', 201);
    } catch (error) {
      next(error);
    }
  }

  async getAll(req, res, next) {
    try {
      const result = await leadService.getAll(req.query);
      return paginatedResponse(res, result.data, result.total, result.page, result.limit);
    } catch (error) {
      next(error);
    }
  }

  async getById(req, res, next) {
    try {
      const lead = await leadService.getById(req.params.id);
      return successResponse(res, lead);
    } catch (error) {
      next(error);
    }
  }

  async update(req, res, next) {
    try {
      const lead = await leadService.update(req.params.id, req.body);
      return successResponse(res, lead, 'Lead updated successfully');
    } catch (error) {
      next(error);
    }
  }

  async delete(req, res, next) {
    try {
      await leadService.delete(req.params.id);
      return successResponse(res, null, 'Lead deleted successfully');
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new LeadController();