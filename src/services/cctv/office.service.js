const Office = require('../../models/cctv/office.model');
const Camera = require('../../models/cctv/camera.model');
const Agent = require('../../models/cctv/agent.model');
const { NotFoundError, ForbiddenError, ConflictError } = require('../../utils/errors');

class OfficeService {
  /**
   * Create a new office
   */
  async createOffice(data, user) {
    const { name, address, contactPerson, contactPhone, timezone } = data;
    const companyId = user.role === 'super_admin' ? data.companyId : user.companyId;

    if (!companyId) {
      throw new ForbiddenError('Company ID is required');
    }

    // Check for duplicate name within company (escape regex special chars)
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const existing = await Office.findOne({
      companyId,
      name: { $regex: `^${escapedName}$`, $options: 'i' },
      isActive: true,
    });

    if (existing) {
      throw new ConflictError('An office with this name already exists in your company');
    }

    const office = new Office({
      companyId,
      name,
      address: address || {},
      contactPerson: contactPerson || '',
      contactPhone: contactPhone || '',
      timezone: timezone || 'Asia/Kolkata',
      createdBy: user._id,
    });

    await office.save();
    return office;
  }

  /**
   * Get all offices for a company (paginated)
   */
  async getAllOffices(query, user) {
    const {
      page = 1,
      limit = 10,
      search,
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

    // Search
    if (search) {
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: { $regex: escapedSearch, $options: 'i' } },
        { 'address.city': { $regex: escapedSearch, $options: 'i' } },
        { 'address.state': { $regex: escapedSearch, $options: 'i' } },
        { contactPerson: { $regex: escapedSearch, $options: 'i' } },
      ];
    }

    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const offices = await Office.find(filter)
      .populate('createdBy', 'name email')
      .skip(skip)
      .limit(parseInt(limit))
      .sort(sort);

    const total = await Office.countDocuments(filter);

    return { data: offices, total, page: parseInt(page), limit: parseInt(limit) };
  }

  /**
   * Get office by ID
   */
  async getOfficeById(officeId, user) {
    const filter = { _id: officeId, isActive: true };

    if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    }

    const office = await Office.findOne(filter).populate('createdBy', 'name email');

    if (!office) {
      throw new NotFoundError('Office');
    }

    return office;
  }

  /**
   * Update an office
   */
  async updateOffice(officeId, updateData, user) {
    const filter = { _id: officeId, isActive: true };

    if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    }

    const allowedUpdates = ['name', 'address', 'contactPerson', 'contactPhone', 'timezone', 'isActive'];
    const updates = {};

    Object.keys(updateData).forEach((key) => {
      if (allowedUpdates.includes(key)) {
        updates[key] = updateData[key];
      }
    });

    // Check for duplicate name if name is being updated
    if (updates.name) {
      const office = await Office.findOne(filter);
      if (!office) {
        throw new NotFoundError('Office');
      }

      const escapedName = updates.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const duplicate = await Office.findOne({
        companyId: office.companyId,
        name: { $regex: `^${escapedName}$`, $options: 'i' },
        _id: { $ne: officeId },
        isActive: true,
      });

      if (duplicate) {
        throw new ConflictError('An office with this name already exists');
      }
    }

    const office = await Office.findOneAndUpdate(filter, updates, {
      new: true,
      runValidators: true,
    }).populate('createdBy', 'name email');

    if (!office) {
      throw new NotFoundError('Office');
    }

    return office;
  }

  /**
   * Soft delete an office
   */
  async deleteOffice(officeId, user) {
    const filter = { _id: officeId, isActive: true };

    if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    }

    const office = await Office.findOne(filter);

    if (!office) {
      throw new NotFoundError('Office');
    }

    // Check if office has active cameras
    const cameraCount = await Camera.countDocuments({
      officeId: officeId,
      isActive: true,
    });

    if (cameraCount > 0) {
      throw new ConflictError(`Cannot delete office. It has ${cameraCount} active camera(s). Please reassign or delete cameras first.`);
    }

    // Check if office has active agents
    const agentCount = await Agent.countDocuments({
      officeId: officeId,
      isActive: true,
    });

    if (agentCount > 0) {
      throw new ConflictError(`Cannot delete office. It has ${agentCount} active agent(s). Please reassign or delete agents first.`);
    }

    office.isActive = false;
    await office.save();

    return office;
  }

  /**
   * Update office camera count
   */
  async updateCameraCount(officeId) {
    const count = await Camera.countDocuments({ officeId, isActive: true });
    await Office.findByIdAndUpdate(officeId, { cameraCount: count });
  }

  /**
   * Update office agent count
   */
  async updateAgentCount(officeId) {
    const count = await Agent.countDocuments({ officeId, isActive: true });
    await Office.findByIdAndUpdate(officeId, { agentCount: count });
  }
}

module.exports = new OfficeService();