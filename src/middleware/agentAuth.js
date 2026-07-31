/**
 * Agent JWT Authentication Middleware
 * Validates agent tokens for agent-specific routes (heartbeat, config, camera status, upload)
 * Agents use a separate JWT from regular users, with role 'agent'
 */

const jwt = require('jsonwebtoken');
const Agent = require('../models/cctv/agent.model');
const config = require('../config');

const agentAuth = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided. Agent authentication required.',
      });
    }

    const decoded = jwt.verify(token, config.jwt.secret);
    const agent = await Agent.findById(decoded.id);

    if (!agent || agent.status !== 'active' || !agent.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or inactive agent.',
      });
    }

    req.agent = agent;
    req.user = { _id: agent._id, role: 'agent', companyId: agent.companyId, name: agent.name, machineId: agent.machineId };
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid token. Please re-activate your agent.',
    });
  }
};

module.exports = agentAuth;