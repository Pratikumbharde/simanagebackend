const agentService = require('../../services/cctv/agent.service');
const auditLogService = require('../../services/auditLog/auditLog.service');
const { successResponse, paginatedResponse } = require('../../utils/response');

class AgentController {
  /**
   * Generate activation code (admin only)
   */
  async generateActivationCode(req, res, next) {
    try {
      const code = await agentService.generateActivationCode(req.body, req.user);

      await auditLogService.logAction({
        action: 'ACTIVATION_CODE_GENERATE',
        module: 'CCTV',
        description: `Generated activation code: ${code.code}`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: code.companyId,
        entityId: code._id,
        entityType: 'ActivationCode',
        metadata: { code: code.code, expiresInHours: req.body.expiresInHours || 72 },
        req,
      });

      return successResponse(res, code, 'Activation code generated successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Activate agent (public with activation code)
   */
  async activateAgent(req, res, next) {
    try {
      const result = await agentService.activateAgent(req.body);

      await auditLogService.logAction({
        action: 'AGENT_ACTIVATE',
        module: 'CCTV',
        description: `Agent activated: ${result.agent.name}`,
        performedBy: null,
        role: 'agent',
        companyId: result.agent.companyId || undefined,
        entityId: result.agent.id,
        entityType: 'Agent',
        metadata: { machineId: req.body.machineId, hostname: req.body.hostname },
        req,
      });

      return successResponse(res, result, 'Agent activated successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Agent heartbeat (agent auth)
   */
  async heartbeat(req, res, next) {
    try {
      const result = await agentService.heartbeat(req.agent._id, req.body);
      return successResponse(res, result, 'Heartbeat received');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get agent config (agent auth)
   */
  async getConfig(req, res, next) {
    try {
      const cameras = await agentService.getAgentCameras(req.agent);
      return successResponse(res, {
        agent: {
          id: req.agent._id,
          name: req.agent.name,
          configVersion: req.agent.configVersion,
        },
        cameras,
        serverTime: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update camera statuses (agent auth)
   */
  async updateCameraStatus(req, res, next) {
    try {
      const results = await agentService.updateCameraStatuses(req.agent._id, req.body.cameras);
      return successResponse(res, results, 'Camera statuses updated');
    } catch (error) {
      next(error);
    }
  }

  /**
   * List agents (admin)
   */
  async getAll(req, res, next) {
    try {
      const result = await agentService.getAllAgents(req.query, req.user);
      return paginatedResponse(res, result.data, result.total, result.page, result.limit);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get agent by ID (admin)
   */
  async getById(req, res, next) {
    try {
      const agent = await agentService.getAgentById(req.params.id, req.user);
      return successResponse(res, agent);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Revoke agent (admin)
   */
  async revoke(req, res, next) {
    try {
      const agent = await agentService.revokeAgent(req.params.id, req.user);

      await auditLogService.logAction({
        action: 'AGENT_REVOKE',
        module: 'CCTV',
        description: `Revoked agent: ${agent.name}`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: agent.companyId,
        entityId: agent._id,
        entityType: 'Agent',
        metadata: { agentName: agent.name, machineId: agent.machineId },
        req,
      });

      return successResponse(res, null, 'Agent revoked successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get agent status (admin)
   */
  async getStatus(req, res, next) {
    try {
      const status = await agentService.getAgentStatus(req.params.id);
      return successResponse(res, status);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AgentController();