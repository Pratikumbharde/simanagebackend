const cameraService = require('../../services/cctv/camera.service');
const auditLogService = require('../../services/auditLog/auditLog.service');
const { successResponse, paginatedResponse } = require('../../utils/response');

class CameraController {
  async create(req, res, next) {
    try {
      const camera = await cameraService.createCamera(req.body, req.user);

      await auditLogService.logAction({
        action: 'CAMERA_CREATE',
        module: 'CCTV',
        description: `Created camera: ${camera.name}`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: camera.companyId,
        entityId: camera._id,
        entityType: 'Camera',
        metadata: { name: camera.name, ipAddress: camera.ipAddress, type: camera.type },
        req,
      });

      // Remove password from response
      const cameraObj = camera.toObject();
      delete cameraObj.password;

      return successResponse(res, cameraObj, 'Camera created successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  async getAll(req, res, next) {
    try {
      const result = await cameraService.getAllCameras(req.query, req.user);
      // Remove passwords from response
      result.data = result.data.map(c => {
        const obj = c.toObject ? c.toObject() : c;
        delete obj.password;
        return obj;
      });
      return paginatedResponse(res, result.data, result.total, result.page, result.limit);
    } catch (error) {
      next(error);
    }
  }

  async getById(req, res, next) {
    try {
      const camera = await cameraService.getCameraById(req.params.id, req.user);
      const cameraObj = camera.toObject();
      delete cameraObj.password;
      return successResponse(res, cameraObj);
    } catch (error) {
      next(error);
    }
  }

  async update(req, res, next) {
    try {
      const camera = await cameraService.updateCamera(req.params.id, req.body, req.user);

      await auditLogService.logAction({
        action: 'CAMERA_UPDATE',
        module: 'CCTV',
        description: `Updated camera: ${camera.name}`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: camera.companyId,
        entityId: camera._id,
        entityType: 'Camera',
        metadata: { changes: req.body },
        req,
      });

      const cameraObj = camera.toObject();
      delete cameraObj.password;
      return successResponse(res, cameraObj, 'Camera updated successfully');
    } catch (error) {
      next(error);
    }
  }

  async delete(req, res, next) {
    try {
      const camera = await cameraService.deleteCamera(req.params.id, req.user);

      await auditLogService.logAction({
        action: 'CAMERA_DELETE',
        module: 'CCTV',
        description: `Deleted camera: ${camera.name}`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: camera.companyId,
        entityId: camera._id,
        entityType: 'Camera',
        metadata: { name: camera.name },
        req,
      });

      return successResponse(res, null, 'Camera deleted successfully');
    } catch (error) {
      next(error);
    }
  }

  async getStats(req, res, next) {
    try {
      const companyId = req.user.role === 'super_admin' ? req.query.companyId : req.user.companyId;
      const stats = await cameraService.getCameraStats(companyId);
      return successResponse(res, stats);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new CameraController();