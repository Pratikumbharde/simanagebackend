const Camera = require('../../models/cctv/camera.model');
const Office = require('../../models/cctv/office.model');
const Company = require('../../models/company/company.model');
const { NotFoundError, ForbiddenError, ConflictError, ValidationError, SubscriptionLimitError } = require('../../utils/errors');
const { CameraNotFoundError } = require('../../utils/cctvErrors');

class CameraService {
  /**
   * Create a new camera
   */
  async createCamera(data, user) {
    const companyId = user.role === 'super_admin' ? data.companyId : user.companyId;

    if (!companyId) {
      throw new ForbiddenError('Company ID is required');
    }

    // Check subscription camera limit
    const company = await Company.findById(companyId).populate('subscriptionId');
    if (company && company.subscriptionId) {
      const limits = company.subscriptionId.limits || {};
      const maxCameras = limits.maxCameras || 5;

      if (maxCameras !== -1) {
        const currentCount = await Camera.countDocuments({ companyId, isActive: true });
        if (currentCount >= maxCameras) {
          throw new SubscriptionLimitError('cameras', maxCameras);
        }
      }
    }

    // Check for duplicate name within company
    const escapedName = data.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const existing = await Camera.findOne({
      companyId,
      name: { $regex: `^${escapedName}$`, $options: 'i' },
      isActive: true,
    });

    if (existing) {
      throw new ConflictError('A camera with this name already exists in your company');
    }

    // Validate officeId if provided
    if (data.officeId) {
      const office = await Office.findOne({ _id: data.officeId, companyId, isActive: true });
      if (!office) {
        throw new ValidationError('Office not found or does not belong to your company');
      }
    }

    // Validate assignedAgentId if provided
    if (data.assignedAgentId) {
      const Agent = require('../../models/cctv/agent.model');
      const agent = await Agent.findOne({ _id: data.assignedAgentId, companyId, isActive: true });
      if (!agent) {
        throw new ValidationError('Agent not found or does not belong to your company');
      }
    }

    // Only allow specific fields from user input
    const allowedFields = [
      'name', 'description', 'type', 'officeId', 'ipAddress',
      'rtspPort', 'rtspUrl', 'username', 'password', 'captureInterval',
      'imageQuality', 'resolution', 'assignedAgentId',
    ];
    const cameraData = { companyId, createdBy: user._id };
    allowedFields.forEach(field => {
      if (data[field] !== undefined) cameraData[field] = data[field];
    });

    const camera = new Camera(cameraData);

    await camera.save();

    // Update company camera stats
    await this.updateCompanyCameraStats(companyId);

    // Update office camera count if office assigned
    if (data.officeId) {
      const officeService = require('./office.service');
      await officeService.updateCameraCount(data.officeId);
    }

    // Increment agent's configVersion so agent picks up the new camera
    if (data.assignedAgentId) {
      const Agent = require('../../models/cctv/agent.model');
      await Agent.findByIdAndUpdate(data.assignedAgentId, { $inc: { configVersion: 1 } });
    }

    // Strip sensitive fields from response
    const cameraObj = camera.toObject();
    delete cameraObj.password;
    return cameraObj;
  }

  /**
   * Get all cameras for a company (paginated, filtered)
   */
  async getAllCameras(query, user) {
    const {
      page = 1,
      limit = 10,
      search,
      status,
      officeId,
      type,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    const filter = { isActive: true };

    // Data isolation
    if (user.role === 'super_admin' && query.companyId) {
      filter.companyId = query.companyId;
    } else if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    }

    // Filters
    if (status) filter.status = status;
    if (officeId) filter.officeId = officeId;
    if (type) filter.type = type;

    // Search
    if (search) {
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: { $regex: escapedSearch, $options: 'i' } },
        { ipAddress: { $regex: escapedSearch, $options: 'i' } },
        { description: { $regex: escapedSearch, $options: 'i' } },
      ];
    }

    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const cameras = await Camera.find(filter)
      .populate('officeId', 'name address.city')
      .populate('assignedAgentId', 'name hostname status')
      .populate('createdBy', 'name email')
      .skip(skip)
      .limit(parseInt(limit))
      .sort(sort);

    const total = await Camera.countDocuments(filter);

    return { data: cameras, total, page: parseInt(page), limit: parseInt(limit) };
  }

  /**
   * Get camera by ID
   */
  async getCameraById(cameraId, user) {
    const filter = { _id: cameraId, isActive: true };

    if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    }

    const camera = await Camera.findOne(filter)
      .populate('officeId', 'name address')
      .populate('assignedAgentId', 'name hostname status lastHeartbeat')
      .populate('createdBy', 'name email');

    if (!camera) {
      throw new CameraNotFoundError();
    }

    return camera;
  }

  /**
   * Update a camera
   */
  async updateCamera(cameraId, updateData, user) {
    const filter = { _id: cameraId, isActive: true };

    if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    }

    const allowedUpdates = [
      'name', 'description', 'type', 'officeId', 'ipAddress',
      'rtspPort', 'rtspUrl', 'username', 'password', 'captureInterval',
      'imageQuality', 'resolution', 'assignedAgentId', 'isActive',
    ];
    const updates = {};

    Object.keys(updateData).forEach((key) => {
      if (allowedUpdates.includes(key)) {
        updates[key] = updateData[key];
      }
    });

    // Fetch existing camera once (used for duplicate check, office tracking, and office validation)
    const existing = await Camera.findOne(filter);
    if (!existing) {
      throw new CameraNotFoundError();
    }

    // Validate officeId if being changed
    if (updates.officeId) {
      const companyId = user.role === 'super_admin'
        ? (updateData.companyId || existing.companyId)
        : user.companyId;
      const office = await Office.findOne({ _id: updates.officeId, companyId, isActive: true });
      if (!office) {
        throw new ValidationError('Office not found or does not belong to your company');
      }
    }

    // Validate assignedAgentId if being changed
    if (updates.assignedAgentId) {
      const Agent = require('../../models/cctv/agent.model');
      const companyId = user.role === 'super_admin'
        ? (updateData.companyId || existing.companyId)
        : user.companyId;
      const agent = await Agent.findOne({ _id: updates.assignedAgentId, companyId, isActive: true });
      if (!agent) {
        throw new ValidationError('Agent not found or does not belong to your company');
      }
    }
    // Allow setting assignedAgentId to null to unassign
    if (updateData.assignedAgentId === null || updateData.assignedAgentId === '') {
      updates.assignedAgentId = null;
    }

    // Check for duplicate name if name is being updated
    if (updates.name) {
      const escapedName = updates.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const duplicate = await Camera.findOne({
        companyId: existing.companyId,
        name: { $regex: `^${escapedName}$`, $options: 'i' },
        _id: { $ne: cameraId },
        isActive: true,
      });

      if (duplicate) {
        throw new ConflictError('A camera with this name already exists');
      }
    }

    // Capture old office and old agent BEFORE updating
    const oldOfficeId = existing.officeId ? existing.officeId.toString() : null;
    const oldAssignedAgentId = existing.assignedAgentId ? existing.assignedAgentId.toString() : null;

    const camera = await Camera.findOneAndUpdate(filter, updates, {
      new: true,
      runValidators: true,
    }).populate('officeId', 'name address.city')
      .populate('assignedAgentId', 'name hostname status');

    if (!camera) {
      throw new CameraNotFoundError();
    }

    // Increment configVersion for affected agents so they re-fetch cameras
    const Agent = require('../../models/cctv/agent.model');
    if (updates.assignedAgentId !== undefined) {
      const newAgentId = updates.assignedAgentId ? updates.assignedAgentId.toString() : null;
      // If agent changed, increment configVersion for both old and new agent
      if (newAgentId !== oldAssignedAgentId) {
        if (oldAssignedAgentId) {
          await Agent.findByIdAndUpdate(oldAssignedAgentId, { $inc: { configVersion: 1 } });
        }
        if (newAgentId) {
          await Agent.findByIdAndUpdate(newAgentId, { $inc: { configVersion: 1 } });
        }
      } else if (newAgentId) {
        // Agent didn't change, but camera settings (rtspUrl, interval, etc.) may have
        await Agent.findByIdAndUpdate(newAgentId, { $inc: { configVersion: 1 } });
      }
    } else if (oldAssignedAgentId) {
      // No agent change in request, but camera settings may have changed
      // Notify the existing assigned agent so it picks up config changes
      await Agent.findByIdAndUpdate(oldAssignedAgentId, { $inc: { configVersion: 1 } });
    }

    // Update office camera count if office changed
    const newOfficeId = updates.officeId ? updates.officeId.toString() : null;
    if (oldOfficeId && oldOfficeId !== newOfficeId) {
      // Camera moved from one office to another — decrement old office count
      const officeService = require('./office.service');
      await officeService.updateCameraCount(oldOfficeId);
    }
    if (newOfficeId && oldOfficeId !== newOfficeId) {
      // Camera moved to a new office — increment new office count
      const officeService = require('./office.service');
      await officeService.updateCameraCount(newOfficeId);
    }

    return camera;
  }

  /**
   * Soft delete a camera
   */
  async deleteCamera(cameraId, user) {
    const filter = { _id: cameraId, isActive: true };

    if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    }

    const camera = await Camera.findOne(filter);

    if (!camera) {
      throw new CameraNotFoundError();
    }

    camera.isActive = false;
    camera.status = 'disabled';
    await camera.save();

    // Update company camera stats
    await this.updateCompanyCameraStats(camera.companyId);

    // Update office camera count
    if (camera.officeId) {
      const officeService = require('./office.service');
      await officeService.updateCameraCount(camera.officeId);
    }

    // Increment configVersion for the assigned agent so it removes this camera
    if (camera.assignedAgentId) {
      const Agent = require('../../models/cctv/agent.model');
      await Agent.findByIdAndUpdate(camera.assignedAgentId, { $inc: { configVersion: 1 } });
    }

    return camera;
  }

  /**
   * Update camera status
   */
  async updateStatus(cameraId, status, errorInfo = {}) {
    const camera = await Camera.findById(cameraId);

    if (!camera) {
      throw new CameraNotFoundError();
    }

    if (status === 'online') {
      await camera.markOnline();
    } else if (status === 'offline') {
      await camera.markOffline();
    } else if (status === 'error') {
      await camera.markError(errorInfo.message || 'Unknown error');
    } else {
      camera.status = status;
      await camera.save();
    }

    // Update company camera stats
    await this.updateCompanyCameraStats(camera.companyId);

    return camera;
  }

  /**
   * Get camera stats for a company
   */
  async getCameraStats(companyId) {
    const totalCameras = await Camera.countDocuments({ companyId, isActive: true });
    const onlineCameras = await Camera.countDocuments({ companyId, status: 'online', isActive: true });
    const offlineCameras = await Camera.countDocuments({ companyId, status: 'offline', isActive: true });
    const errorCameras = await Camera.countDocuments({ companyId, status: 'error', isActive: true });
    const disabledCameras = await Camera.countDocuments({ companyId, status: 'disabled', isActive: true });

    return {
      total: totalCameras,
      online: onlineCameras,
      offline: offlineCameras,
      error: errorCameras,
      disabled: disabledCameras,
    };
  }

  /**
   * Update company camera stats
   */
  async updateCompanyCameraStats(companyId) {
    const totalCameras = await Camera.countDocuments({ companyId, isActive: true });
    const activeCameras = await Camera.countDocuments({ companyId, status: 'online', isActive: true });

    await Company.findByIdAndUpdate(companyId, {
      'stats.totalCameras': totalCameras,
      'stats.activeCameras': activeCameras,
    });
  }
}

module.exports = new CameraService();