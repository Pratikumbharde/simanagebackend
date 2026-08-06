const cameraService = require('../../services/cctv/camera.service');
const auditLogService = require('../../services/auditLog/auditLog.service');
const { successResponse, paginatedResponse } = require('../../utils/response');

class CameraController {
  async create(req, res, next) {
    try {
      console.log('[CameraController] CREATE - Request body:', JSON.stringify(req.body, null, 2));
      console.log('[CameraController] CREATE - User:', req.user?._id, 'Role:', req.user?.role, 'Company:', req.user?.companyId);

      const camera = await cameraService.createCamera(req.body, req.user);

      console.log('[CameraController] CREATE - Camera created successfully, ID:', camera._id);

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

      return successResponse(res, camera, 'Camera created successfully', 201);
    } catch (error) {
      console.error('[CameraController] CREATE - Error:', error.message);
      console.error('[CameraController] CREATE - Error stack:', error.stack);
      if (error.errors) {
        console.error('[CameraController] CREATE - Validation errors:', JSON.stringify(error.errors, null, 2));
      }
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
      console.error('[CameraController] GET_ALL - Error:', error.message);
      next(error);
    }
  }

  async getById(req, res, next) {
    try {
      const camera = await cameraService.getCameraById(req.params.id, req.user);
      return successResponse(res, camera);
    } catch (error) {
      console.error('[CameraController] GET_BY_ID - Error:', error.message);
      next(error);
    }
  }

  async update(req, res, next) {
    try {
      console.log('[CameraController] UPDATE - Camera ID:', req.params.id);
      console.log('[CameraController] UPDATE - Request body:', JSON.stringify(req.body, null, 2));

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
      console.error('[CameraController] UPDATE - Error:', error.message);
      console.error('[CameraController] UPDATE - Error stack:', error.stack);
      if (error.errors) {
        console.error('[CameraController] UPDATE - Validation errors:', JSON.stringify(error.errors, null, 2));
      }
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
      console.error('[CameraController] DELETE - Error:', error.message);
      next(error);
    }
  }

  async getStats(req, res, next) {
    try {
      const companyId = req.user.role === 'super_admin' ? req.query.companyId : req.user.companyId;
      const stats = await cameraService.getCameraStats(companyId);
      return successResponse(res, stats);
    } catch (error) {
      console.error('[CameraController] GET_STATS - Error:', error.message);
      next(error);
    }
  }

  async testConnection(req, res, next) {
    try {
      console.log('[CameraController] TEST_CONNECTION - Request body:', JSON.stringify(req.body, null, 2));
      const result = await cameraService.testConnection(req.body);
      return successResponse(res, result, 'Connection test completed');
    } catch (error) {
      console.error('[CameraController] TEST_CONNECTION - Error:', error.message);
      console.error('[CameraController] TEST_CONNECTION - Error stack:', error.stack);
      next(error);
    }
  }
}

module.exports = new CameraController();