const Lead = require('../../models/lead/lead.model');
const { AppError, NotFoundError, ConflictError } = require('../../utils/errors');

class LeadService {
  async create(data) {
    // Prevent spam: check if same email submitted in last 24 hours
    const recentLead = await Lead.findOne({
      email: data.email.toLowerCase(),
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });

    if (recentLead) {
      throw new ConflictError('You have already submitted a request recently. We will get back to you soon.');
    }

    const lead = new Lead({
      name: data.name,
      email: data.email.toLowerCase(),
      phone: data.phone,
      company: data.company,
      message: data.message,
      source: data.source || 'contact-form',
    });

    await lead.save();
    return lead;
  }

  async getAll(query = {}) {
    const { page = 1, limit = 10, search, status, sortBy = 'createdAt', sortOrder = 'desc' } = query;

    const filter = {};
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { company: { $regex: search, $options: 'i' } },
      ];
    }
    if (status) {
      filter.status = status;
    }

    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const data = await Lead.find(filter)
      .skip(skip)
      .limit(parseInt(limit))
      .sort(sort);

    const total = await Lead.countDocuments(filter);

    return { data, total, page: parseInt(page), limit: parseInt(limit) };
  }

  async getById(id) {
    const lead = await Lead.findById(id);
    if (!lead) {
      throw new NotFoundError('Lead');
    }
    return lead;
  }

  async update(id, updateData) {
    const allowedUpdates = ['status', 'notes'];
    const updates = {};

    Object.keys(updateData).forEach((key) => {
      if (allowedUpdates.includes(key)) {
        updates[key] = updateData[key];
      }
    });

    const lead = await Lead.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    });

    if (!lead) {
      throw new NotFoundError('Lead');
    }

    return lead;
  }

  async delete(id) {
    const lead = await Lead.findById(id);
    if (!lead) {
      throw new NotFoundError('Lead');
    }

    await Lead.findByIdAndDelete(id);
    return true;
  }
}

module.exports = new LeadService();