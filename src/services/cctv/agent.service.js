const Agent = require('../../models/cctv/agent.model');
const ActivationCode = require('../../models/cctv/activationCode.model');
const Camera = require('../../models/cctv/camera.model');
const Company = require('../../models/company/company.model');
const AgentLog = require('../../models/cctv/agentLog.model');
const CameraAlert = require('../../models/cctv/cameraAlert.model');
const { NotFoundError, ForbiddenError, ConflictError, ValidationError } = require('../../utils/errors');
const { AgentNotFoundError, ActivationCodeError, AgentAlreadyActiveError } = require('../../utils/cctvErrors');
const { emitToCompany } = require('../../config/socket');

class AgentService {
  /**
   * Generate a new activation code
   */
  async generateActivationCode(data, user) {
    const companyId = user.role === 'super_admin' ? data.companyId : user.companyId;

    if (!companyId) {
      throw new ForbiddenError('Company ID is required');
    }

    const expiresInHours = data.expiresInHours || 72;
    const maxUses = data.maxUses || 1;

    const activationCode = await ActivationCode.generateCode(companyId, {
      expiresInHours,
      maxUses,
      createdBy: user._id,
    });

    return activationCode;
  }

  /**
   * Activate an agent using an activation code
   */
  async activateAgent(data) {
    const { activationCode, machineId, hostname, osVersion, agentVersion } = data;

    // Find and validate activation code
    const code = await ActivationCode.findByCode(activationCode);
    if (!code) {
      throw new ActivationCodeError('Invalid activation code');
    }

    if (!code.isUsable) {
      if (code.isExpired) {
        throw new ActivationCodeError('Activation code has expired');
      }
      if (code.status === 'used' || code.currentUses >= code.maxUses) {
        throw new ActivationCodeError('Activation code has already been used');
      }
      if (code.status === 'revoked') {
        throw new ActivationCodeError('Activation code has been revoked');
      }
      throw new ActivationCodeError('Activation code is not valid');
    }

    // Check if machine ID is already registered
    const existingAgent = await Agent.findByMachineId(machineId);
    if (existingAgent && existingAgent.status === 'active') {
      throw new AgentAlreadyActiveError('This machine is already registered with an active agent');
    }

    // Create agent
    const agent = new Agent({
      companyId: code.companyId,
      name: hostname || `Agent-${machineId.substring(0, 8)}`,
      machineId,
      hostname: hostname || '',
      osVersion: osVersion || '',
      agentVersion: agentVersion || '1.0.0',
      activationCodeId: code._id,
      status: 'active',
      lastHeartbeat: new Date(),
      configVersion: 1,
      createdBy: code.createdBy,
    });

    await agent.save();

    // Activate the code
    await code.activate(agent._id);

    // Generate JWT token for the agent
    const token = await agent.generateAuthToken();

    // Get cameras assigned to this agent
    const cameraFilter = {
      companyId: code.companyId,
      isActive: true,
      status: { $ne: 'disabled' },
      assignedAgentId: agent._id,
    };

    // Must use .select('+password') because password has select:false in schema
    const cameras = await Camera.find(cameraFilter)
      .select('+password')
      .sort({ name: 1 });

    // Log activation event
    await AgentLog.create({
      companyId: code.companyId,
      agentId: agent._id,
      level: 'info',
      event: 'agent_started',
      message: 'Agent activated successfully',
      metadata: { activationCode: activationCode.substring(0, 7) + '***', machineId, hostname },
    });

    return {
      agent: {
        id: agent._id,
        name: agent.name,
        machineId: agent.machineId,
        status: agent.status,
        configVersion: agent.configVersion,
      },
      token,
      cameras: cameras.map(cam => ({
        id: cam._id,
        name: cam.name,
        type: cam.type,
        ipAddress: cam.ipAddress,
        rtspPort: cam.rtspPort,
        rtspUrl: cam.rtspUrl,
        username: cam.username,
        password: cam.password,
        captureInterval: cam.captureInterval,
        imageQuality: cam.imageQuality,
        resolution: cam.resolution,
      })),
    };
  }

  /**
   * Process agent heartbeat
   */
  async heartbeat(agentId, data) {
    const agent = await Agent.findById(agentId);
    if (!agent) {
      throw new AgentNotFoundError();
    }

    if (agent.status === 'suspended') {
      throw new ForbiddenError('Agent is suspended');
    }

    // Update heartbeat (includes optional fields like agentVersion)
    await agent.updateHeartbeat(data);

    // Check if config has changed
    const cameras = await this.getAgentCameras(agent);

    // Log heartbeat
    await AgentLog.create({
      companyId: agent.companyId,
      agentId: agent._id,
      level: 'info',
      event: 'heartbeat',
      message: 'Heartbeat received',
      metadata: {
        cameraCount: data.cameraCount || cameras.length,
        queueSize: data.queueSize || 0,
        agentVersion: data.agentVersion || agent.agentVersion,
      },
    });

    // Emit Socket.IO event for real-time agent status
    emitToCompany(agent.companyId.toString(), 'agent:heartbeat', {
      agentId: agent._id,
      name: agent.name,
      isOnline: true,
      lastHeartbeat: agent.lastHeartbeat,
      configVersion: agent.configVersion,
    });

    return {
      configVersion: agent.configVersion,
      configChanged: false, // Will be compared by agent
      cameras,
      serverTime: new Date().toISOString(),
    };
  }

  /**
   * Get cameras assigned to an agent
   */
  async getAgentCameras(agent) {
    const filter = {
      companyId: agent.companyId,
      isActive: true,
      status: { $ne: 'disabled' },
      assignedAgentId: agent._id,
    };

    // Must use .select('+password') because password has select:false in schema
    const cameras = await Camera.find(filter)
      .select('+password')
      .sort({ name: 1 });

    return cameras.map(cam => ({
      id: cam._id,
      name: cam.name,
      type: cam.type,
      ipAddress: cam.ipAddress,
      rtspPort: cam.rtspPort,
      rtspUrl: cam.rtspUrl,
      username: cam.username,
      password: cam.password,
      captureInterval: cam.captureInterval,
      imageQuality: cam.imageQuality,
      resolution: cam.resolution,
    }));
  }

  /**
   * Update camera statuses from agent
   */
  async updateCameraStatuses(agentId, camerasData) {
    const agent = await Agent.findById(agentId);
    if (!agent) {
      throw new AgentNotFoundError();
    }

    const results = [];
    const skipped = [];

    for (const camData of camerasData) {
      const camera = await Camera.findOne({
        _id: camData.cameraId,
        companyId: agent.companyId,
        isActive: true,
      });

      if (!camera) {
        // Camera not found or doesn't belong to this agent's company
        skipped.push({ cameraId: camData.cameraId, reason: 'not_found' });
        continue;
      }

      const previousStatus = camera.status;

      if (camData.status === 'online') {
        await camera.markOnline();
      } else if (camData.status === 'offline') {
        await camera.markOffline();
      } else if (camData.status === 'error') {
        await camera.markError(camData.lastError || 'Unknown error');
      }

      // Create alert if camera just went offline
      if (previousStatus !== 'offline' && camData.status === 'offline') {
        await CameraAlert.createCameraOfflineAlert(
          agent.companyId,
          camData.cameraId,
          agent._id,
          camData.lastError || 'Camera went offline'
        );
      }

      // Auto-resolve alert if camera came back online
      if (previousStatus === 'offline' && camData.status === 'online') {
        await CameraAlert.updateMany(
          {
            cameraId: camData.cameraId,
            status: 'active',
            alertType: 'camera_offline',
          },
          {
            status: 'resolved',
            resolvedAt: new Date(),
            resolvedBy: null,
          }
        );
      }

      results.push({
        cameraId: camData.cameraId,
        previousStatus,
        newStatus: camData.status,
      });
    }

    // Update company camera stats
    const cameraService = require('./camera.service');
    await cameraService.updateCompanyCameraStats(agent.companyId);

    // Emit Socket.IO events for each camera status change
    for (const result of results) {
      if (result.previousStatus !== result.newStatus) {
        emitToCompany(agent.companyId.toString(), 'camera:status', {
          cameraId: result.cameraId,
          previousStatus: result.previousStatus,
          newStatus: result.newStatus,
          agentId: agent._id,
          timestamp: new Date().toISOString(),
        });
      }
    }

    return { updated: results, skipped };
  }

  /**
   * Get all agents for a company
   */
  async getAllAgents(query, user) {
    const {
      page = 1,
      limit = 10,
      search,
      status,
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

    if (status) filter.status = status;

    // Search
    if (search) {
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: { $regex: escapedSearch, $options: 'i' } },
        { hostname: { $regex: escapedSearch, $options: 'i' } },
        { machineId: { $regex: escapedSearch, $options: 'i' } },
      ];
    }

    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const agents = await Agent.find(filter)
      .populate('createdBy', 'name email')
      .select('-token -tokenExpires')
      .skip(skip)
      .limit(parseInt(limit))
      .sort(sort);

    const total = await Agent.countDocuments(filter);

    // Add assigned camera count for each agent
    const agentsWithCameras = await Promise.all(agents.map(async (agent) => {
      const assignedCameras = await Camera.countDocuments({
        assignedAgentId: agent._id,
        isActive: true,
      });
      return { ...agent.toObject(), assignedCameras };
    }));

    return { data: agentsWithCameras, total, page: parseInt(page), limit: parseInt(limit) };
  }

  /**
   * Get agent by ID
   */
  async getAgentById(agentId, user) {
    const filter = { _id: agentId, isActive: true };

    if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    }

    const agent = await Agent.findOne(filter)
      .populate('createdBy', 'name email')
      .select('-token -tokenExpires');

    if (!agent) {
      throw new AgentNotFoundError();
    }

    return agent;
  }

  /**
   * Revoke (deactivate) an agent
   */
  async revokeAgent(agentId, user) {
    const filter = { _id: agentId, isActive: true };

    if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    }

    const agent = await Agent.findOne(filter);
    if (!agent) {
      throw new AgentNotFoundError();
    }

    agent.status = 'suspended';
    agent.isActive = false;
    await agent.save();

    // Revoke activation code if exists
    if (agent.activationCodeId) {
      const code = await ActivationCode.findById(agent.activationCodeId);
      if (code) {
        await code.revoke();
      }
    }

    // Log revocation
    await AgentLog.create({
      companyId: agent.companyId,
      agentId: agent._id,
      level: 'warning',
      event: 'agent_stopped',
      message: 'Agent revoked by admin',
      metadata: { revokedBy: user._id },
    });

    // Emit Socket.IO event for agent revocation
    try {
      emitToCompany(agent.companyId.toString(), 'agent:status', {
        agentId: agent._id,
        name: agent.name,
        status: 'suspended',
        timestamp: new Date().toISOString(),
      });
    } catch (socketError) {
      // Socket.IO might not be initialized yet
    }

    return agent;
  }

  /**
   * Get agent status summary
   */
  async getAgentStatus(agentId) {
    const agent = await Agent.findById(agentId)
      .select('-token -tokenExpires');

    if (!agent) {
      throw new AgentNotFoundError();
    }

    // Get assigned cameras with details
    const assignedCamerasList = await Camera.find({
      assignedAgentId: agentId,
      isActive: true,
    }).select('name status ipAddress');

    const assignedCameras = assignedCamerasList.length;

    // Get recent logs count
    const recentErrors = await AgentLog.countDocuments({
      agentId,
      level: 'error',
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });

    return {
      agent: {
        id: agent._id,
        name: agent.name,
        status: agent.status,
        isOnline: agent.isOnline,
        lastHeartbeat: agent.lastHeartbeat,
        configVersion: agent.configVersion,
        totalSnapshotsUploaded: agent.totalSnapshotsUploaded,
        totalFailedUploads: agent.totalFailedUploads,
        agentVersion: agent.agentVersion,
      },
      assignedCameras,
      assignedCamerasList: assignedCamerasList.map(c => ({
        id: c._id,
        name: c.name,
        status: c.status,
        ipAddress: c.ipAddress,
      })),
      recentErrors,
    };
  }
}

module.exports = new AgentService();