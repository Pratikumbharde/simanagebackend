const officeService = require('../../services/cctv/office.service');
const auditLogService = require('../../services/auditLog/auditLog.service');
const { successResponse, paginatedResponse } = require('../../utils/response');

class OfficeController {
  async create(req, res, next) {
    try {
      const office = await officeService.createOffice(req.body, req.user);

      await auditLogService.logAction({
        action: 'OFFICE_CREATE',
        module: 'CCTV',
        description: `Created office: ${office.name}`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: office.companyId,
        entityId: office._id,
        entityType: 'Office',
        metadata: { name: office.name, city: office.address?.city },
        req,
      });

      return successResponse(res, office, 'Office created successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  async getAll(req, res, next) {
    try {
      const result = await officeService.getAllOffices(req.query, req.user);
      return paginatedResponse(res, result.data, result.total, result.page, result.limit);
    } catch (error) {
      next(error);
    }
  }

  async getById(req, res, next) {
    try {
      const office = await officeService.getOfficeById(req.params.id, req.user);
      return successResponse(res, office);
    } catch (error) {
      next(error);
    }
  }

  async update(req, res, next) {
    try {
      const office = await officeService.updateOffice(req.params.id, req.body, req.user);

      await auditLogService.logAction({
        action: 'OFFICE_UPDATE',
        module: 'CCTV',
        description: `Updated office: ${office.name}`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: office.companyId,
        entityId: office._id,
        entityType: 'Office',
        metadata: { changes: req.body },
        req,
      });

      return successResponse(res, office, 'Office updated successfully');
    } catch (error) {
      next(error);
    }
  }

  async delete(req, res, next) {
    try {
      const office = await officeService.deleteOffice(req.params.id, req.user);

      await auditLogService.logAction({
        action: 'OFFICE_DELETE',
        module: 'CCTV',
        description: `Deleted office: ${office.name}`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: office.companyId,
        entityId: office._id,
        entityType: 'Office',
        metadata: { name: office.name },
        req,
      });

      return successResponse(res, null, 'Office deleted successfully');
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new OfficeController();