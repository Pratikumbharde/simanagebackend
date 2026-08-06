const Camera = require('../../models/cctv/camera.model');
const Company = require('../../models/company/company.model');
const { NotFoundError, ForbiddenError, ConflictError, ValidationError, SubscriptionLimitError } = require('../../utils/errors');
const { CameraNotFoundError } = require('../../utils/cctvErrors');

class CameraService {
  /**
   * Create a new camera
   */
  async createCamera(data, user) {
    console.log('[CameraService] CREATE_CAMERA - Starting creation');
    console.log('[CameraService] CREATE_CAMERA - Input data:', JSON.stringify(data, null, 2));
    console.log('[CameraService] CREATE_CAMERA - User:', { id: user._id, role: user.role, companyId: user.companyId });

    const companyId = user.role === 'super_admin' ? data.companyId : user.companyId;
    console.log('[CameraService] CREATE_CAMERA - Resolved companyId:', companyId);

    if (!companyId) {
      console.error('[CameraService] CREATE_CAMERA - FAILED: No companyId resolved. User role:', user.role, 'data.companyId:', data.companyId, 'user.companyId:', user.companyId);
      throw new ForbiddenError('Company ID is required');
    }

    // Check subscription camera limit
    console.log('[CameraService] CREATE_CAMERA - Checking subscription limits for company:', companyId);
    try {
      const company = await Company.findById(companyId).populate('subscriptionId');
      console.log('[CameraService] CREATE_CAMERA - Company found:', !!company, 'Subscription:', !!company?.subscriptionId);
      if (company && company.subscriptionId) {
        const limits = company.subscriptionId.limits || {};
        const maxCameras = limits.maxCameras || 5;
        console.log('[CameraService] CREATE_CAMERA - Max cameras allowed:', maxCameras);

        if (maxCameras !== -1) {
          const currentCount = await Camera.countDocuments({ companyId, isActive: true });
          console.log('[CameraService] CREATE_CAMERA - Current camera count:', currentCount);
          if (currentCount >= maxCameras) {
            console.error('[CameraService] CREATE_CAMERA - FAILED: Subscription limit reached. Current:', currentCount, 'Max:', maxCameras);
            throw new SubscriptionLimitError('cameras', maxCameras);
          }
        }
      }
    } catch (err) {
      if (err instanceof SubscriptionLimitError) throw err;
      console.error('[CameraService] CREATE_CAMERA - Error checking subscription:', err.message);
      // Continue - don't block camera creation if subscription check fails
    }

    // Check for duplicate name within company
    console.log('[CameraService] CREATE_CAMERA - Checking for duplicate name:', data.name);
    const escapedName = data.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const existing = await Camera.findOne({
      companyId,
      name: { $regex: `^${escapedName}$`, $options: 'i' },
      isActive: true,
    });

    if (existing) {
      console.error('[CameraService] CREATE_CAMERA - FAILED: Duplicate camera name found. Existing camera ID:', existing._id, 'Name:', existing.name);
      throw new ConflictError('A camera with this name already exists in your company');
    }
    console.log('[CameraService] CREATE_CAMERA - No duplicate found, proceeding');

    // Validate assignedAgentId if provided
    if (data.assignedAgentId) {
      console.log('[CameraService] CREATE_CAMERA - Validating assignedAgentId:', data.assignedAgentId);
      const Agent = require('../../models/cctv/agent.model');
      const agent = await Agent.findOne({ _id: data.assignedAgentId, companyId, isActive: true });
      if (!agent) {
        console.error('[CameraService] CREATE_CAMERA - FAILED: Agent not found or does not belong to company. AgentId:', data.assignedAgentId, 'CompanyId:', companyId);
        throw new ValidationError('Agent not found or does not belong to your company');
      }
      console.log('[CameraService] CREATE_CAMERA - Agent validated:', agent._id, agent.name);
    }

    // Only allow specific fields from user input
    const allowedFields = [
      'name', 'description', 'type', 'ipAddress',
      'rtspPort', 'rtspUrl', 'username', 'password', 'captureInterval',
      'imageQuality', 'resolution', 'assignedAgentId',
    ];
    const cameraData = { companyId, createdBy: user._id };
    allowedFields.forEach(field => {
      if (data[field] !== undefined) cameraData[field] = data[field];
    });
    if (cameraData.rtspUrl) {
    cameraData.rtspUrl = sanitizeRtspUrl(cameraData.rtspUrl);
}

    console.log('[CameraService] CREATE_CAMERA - Camera data to save:', JSON.stringify({ ...cameraData, password: cameraData.password ? '***' : undefined }, null, 2));

    const camera = new Camera(cameraData);

    try {
      await camera.save();
      console.log('[CameraService] CREATE_CAMERA - Camera saved successfully. ID:', camera._id);
    } catch (saveError) {
      console.error('[CameraService] CREATE_CAMERA - FAILED: Mongoose save error:', saveError.message);
      console.error('[CameraService] CREATE_CAMERA - Error name:', saveError.name);
      console.error('[CameraService] CREATE_CAMERA - Error code:', saveError.code);
      if (saveError.errors) {
        console.error('[CameraService] CREATE_CAMERA - Mongoose validation errors:');
        Object.keys(saveError.errors).forEach(key => {
          console.error(`  - ${key}: ${saveError.errors[key].message} (kind: ${saveError.errors[key].kind}, value: ${saveError.errors[key].value})`);
        });
      }
      throw saveError;
    }

    // Update company camera stats
    try {
      console.log('[CameraService] CREATE_CAMERA - Updating company camera stats for:', companyId);
      await this.updateCompanyCameraStats(companyId);
      console.log('[CameraService] CREATE_CAMERA - Company stats updated');
    } catch (statsError) {
      console.error('[CameraService] CREATE_CAMERA - WARNING: Failed to update company stats:', statsError.message);
      // Don't fail the creation for stats update failure
    }

    // Increment agent's configVersion so agent picks up the new camera
    if (data.assignedAgentId) {
      try {
        console.log('[CameraService] CREATE_CAMERA - Incrementing configVersion for agent:', data.assignedAgentId);
        const Agent = require('../../models/cctv/agent.model');
        await Agent.findByIdAndUpdate(data.assignedAgentId, { $inc: { configVersion: 1 } });
        console.log('[CameraService] CREATE_CAMERA - Agent configVersion incremented');
      } catch (agentUpdateError) {
        console.error('[CameraService] CREATE_CAMERA - WARNING: Failed to increment agent configVersion:', agentUpdateError.message);
        // Don't fail creation for this
      }
    }

    // Strip sensitive fields from response
    const cameraObj = camera.toObject();
    delete cameraObj.password;
    console.log('[CameraService] CREATE_CAMERA - Camera creation complete. Returning camera:', camera._id);
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
      'name', 'description', 'type', 'ipAddress',
      'rtspPort', 'rtspUrl', 'username', 'password', 'captureInterval',
      'imageQuality', 'resolution', 'assignedAgentId', 'isActive',
    ];
    const updates = {};

    Object.keys(updateData).forEach((key) => {
      if (allowedUpdates.includes(key)) {
        updates[key] = updateData[key];
      }
    });
    if (updates.rtspUrl) {
    updates.rtspUrl = sanitizeRtspUrl(updates.rtspUrl);
}

    // Fetch existing camera once (used for duplicate check and agent validation)
    const existing = await Camera.findOne(filter);
    if (!existing) {
      throw new CameraNotFoundError();
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

    // Capture old agent BEFORE updating
    const oldAssignedAgentId = existing.assignedAgentId ? existing.assignedAgentId.toString() : null;

    const camera = await Camera.findOneAndUpdate(filter, updates, {
      new: true,
      runValidators: true,
    }).populate('assignedAgentId', 'name hostname status');

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

  /**
   * Test camera connection — checks TCP reachability and RTSP auth
   * @param {Object} data - { ipAddress, rtspPort, rtspUrl, username, password }
   * @returns {Object} { reachable, authValid, details }
   */
  async testConnection(data) {
    const net = require('net');
    const { spawn } = require('child_process');

    const ipAddress = data.ipAddress;
    const rtspPort = data.rtspPort || 554;
    const username = data.username || '';
    const password = data.password || '';
    const rtspUrl = data.rtspUrl;

    console.log('[CameraService] TEST_CONNECTION - Testing camera connection:', { ipAddress, rtspPort, hasRtspUrl: !!rtspUrl, hasUsername: !!username, hasPassword: !!password });

    const result = {
      reachable: false,
      rtspAuthValid: false,
      details: '',
      steps: [],
    };

    // ─── Step 1: TCP reachability check ───
    result.steps.push('Checking TCP connection...');
    const tcpResult = await new Promise((resolve) => {
      const socket = new net.Socket();
      const timeout = 5000; // 5 seconds

      socket.setTimeout(timeout);
      socket.on('connect', () => {
        socket.destroy();
        resolve({ success: true });
      });
      socket.on('timeout', () => {
        socket.destroy();
        resolve({ success: false, error: `Connection timed out after ${timeout / 1000}s` });
      });
      socket.on('error', (err) => {
        socket.destroy();
        resolve({ success: false, error: err.message });
      });

      socket.connect(rtspPort, ipAddress);
    });

    if (tcpResult.success) {
      result.reachable = true;
      result.steps.push(`✅ TCP connection to ${ipAddress}:${rtspPort} succeeded`);
      console.log('[CameraService] TEST_CONNECTION - TCP reachable');
    } else {
      result.reachable = false;
      result.details = `Cannot reach ${ipAddress}:${rtspPort} — ${tcpResult.error}`;
      result.steps.push(`❌ TCP connection to ${ipAddress}:${rtspPort} failed: ${tcpResult.error}`);
      console.log('[CameraService] TEST_CONNECTION - TCP not reachable:', tcpResult.error);
      // If TCP fails, no point testing RTSP auth
      return result;
    }

    // ─── Step 2: RTSP auth check using ffprobe ───
    // Build the full RTSP URL to test
    let testUrl = rtspUrl;
    if (!testUrl) {
      // Build URL from components if rtspUrl not provided
      let auth = '';
      if (username) {
        auth = username;
        if (password) auth += ':' + password;
        auth += '@';
      }
      testUrl = `rtsp://${auth}${ipAddress}:${rtspPort}/stream`;
    }

    const maskedUrl = testUrl.replace(/:([^@]+)@/, ':****@');
    result.steps.push(`Testing RTSP connection: ${maskedUrl}...`);

    console.log('[CameraService] TEST_CONNECTION - Testing RTSP:', maskedUrl);

    const ffprobeResult = await new Promise((resolve) => {
      // Try ffprobe first (lighter weight than ffmpeg)
      const ffprobePath = findExecutable('ffprobe');
      const ffmpegPath = findExecutable('ffmpeg');

      if (ffprobePath) {
        console.log('[CameraService] TEST_CONNECTION - Using ffprobe:', ffprobePath);
        const args = [
          '-v', 'error',
          '-rtsp_transport', 'tcp',
          '-i', testUrl,
          '-show_entries', 'stream=codec_type',
          '-of', 'default=noprint_wrappers=1',
        ];

        const proc = spawn(ffprobePath, args, { windowsHide: true });
        let stderr = '';
        let stdout = '';

        proc.stdout.on('data', (d) => { stdout += d.toString(); });
        proc.stderr.on('data', (d) => { stderr += d.toString(); });

        const timer = setTimeout(() => {
          proc.kill('SIGKILL');
          resolve({ success: false, error: 'ffprobe timed out', stderr });
        }, 15000);

        proc.on('close', (code) => {
          clearTimeout(timer);
          if (code === 0) {
            resolve({ success: true, output: stdout, stderr });
          } else {
            resolve({ success: false, error: `ffprobe exited with code ${code}`, stderr });
          }
        });

        proc.on('error', (err) => {
          clearTimeout(timer);
          resolve({ success: false, error: err.message, stderr });
        });
      } else if (ffmpegPath) {
        // Fallback: use ffmpeg to try capturing 1 frame
        console.log('[CameraService] TEST_CONNECTION - ffprobe not found, using ffmpeg');
        const args = [
          '-y',
          '-rtsp_transport', 'tcp',
          '-i', testUrl,
          '-frames:v', '1',
          '-update', '1',
          '-f', 'null',
          '-',
        ];

        const proc = spawn(ffmpegPath, args, { windowsHide: true });
        let stderr = '';

        proc.stderr.on('data', (d) => { stderr += d.toString(); });
        proc.stdout.on('data', () => {}); // drain stdout

        const timer = setTimeout(() => {
          proc.kill('SIGKILL');
          resolve({ success: false, error: 'ffmpeg timed out', stderr });
        }, 15000);

        proc.on('close', (code) => {
          clearTimeout(timer);
          if (code === 0) {
            resolve({ success: true, stderr });
          } else {
            resolve({ success: false, error: `ffmpeg exited with code ${code}`, stderr });
          }
        });

        proc.on('error', (err) => {
          clearTimeout(timer);
          resolve({ success: false, error: err.message, stderr });
        });
      } else {
        resolve({ success: false, error: 'Neither ffprobe nor ffmpeg found on server', notAvailable: true });
      }
    });

    if (ffprobeResult.notAvailable) {
      result.steps.push('⚠️ ffprobe/ffmpeg not available on server — cannot verify RTSP auth');
      result.rtspAuthValid = null; // unknown
      result.details = `Camera is reachable at ${ipAddress}:${rtspPort}, but RTSP auth could not be verified (no ffprobe/ffmpeg on server). The agent will verify when it connects.`;
      console.log('[CameraService] TEST_CONNECTION - No ffprobe/ffmpeg on server');
    } else if (ffprobeResult.success) {
      result.rtspAuthValid = true;
      result.steps.push('✅ RTSP connection and authentication successful');
      result.details = `Camera is reachable and RTSP stream is accessible with the provided credentials.`;
      console.log('[CameraService] TEST_CONNECTION - RTSP auth valid');
    } else {
      result.rtspAuthValid = false;
      const errLower = (ffprobeResult.stderr || '').toLowerCase();
      let reason = ffprobeResult.error || 'Unknown error';

      if (errLower.includes('401') || errLower.includes('unauthorized') || errLower.includes('authentication')) {
        reason = 'Authentication failed — wrong username or password';
        result.steps.push('❌ RTSP authentication failed: wrong username or password');
      } else if (errLower.includes('404') || errLower.includes('not found') || errLower.includes('no route') || errLower.includes('could not')) {
        reason = 'RTSP stream path not found — check the RTSP URL path';
        result.steps.push('❌ RTSP stream path not found — check the URL path (e.g. /stream, /live/ch00_0)');
      } else if (errLower.includes('timed out') || errLower.includes('timeout') || errLower.includes('connection refused')) {
        reason = 'RTSP connection timed out — camera may be on a different network or RTSP port is blocked';
        result.steps.push('❌ RTSP connection timed out — check network/firewall');
      } else {
        result.steps.push(`❌ RTSP connection failed: ${reason}`);
      }

      result.details = `Camera is reachable at ${ipAddress}:${rtspPort}, but RTSP failed: ${reason}`;
      console.log('[CameraService] TEST_CONNECTION - RTSP auth failed:', reason);
    }

    return result;
  }
}

/**
 * Find an executable in common locations and PATH
 */
function findExecutable(name) {
    // TEMP: Hardcoded paths for testing
    if (name === 'ffmpeg') {
        return "C:\\Users\\admin\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1.2-full_build\\bin\\ffmpeg.exe";
    }
    if (name === 'ffprobe') {
        return "C:\\Users\\admin\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1.2-full_build\\bin\\ffprobe.exe";
    }

    const fs = require('fs');
    const path = require('path');
    const { execSync } = require('child_process');

    // Check common locations
    const platform = process.platform;
    const ext = platform === 'win32' ? '.exe' : '';
    const executable = name + ext;

    const searchPaths = [
      // Bundled paths
      path.join(__dirname, '..', '..', 'ffmpeg', executable),
      path.join(__dirname, '..', '..', 'bin', executable),
      // Common install locations on Windows
      'C:\\ffmpeg\\bin\\' + executable,
      'C:\\Program Files\\ffmpeg\\bin\\' + executable,
      // Common install locations on Linux/Mac
      '/usr/bin/' + name,
      '/usr/local/bin/' + name,
      '/opt/ffmpeg/' + name,
    ];

    for (const p of searchPaths) {
      try {
        if (fs.existsSync(p)) return p;
      } catch (e) { /* skip */ }
    }

    // Check system PATH
    try {
      const result = execSync(
        platform === 'win32' ? `where ${name}` : `which ${name}`,
        { encoding: 'utf-8', timeout: 3000 }
      ).trim();
      if (result) return result.split('\n')[0].trim();
    } catch (e) { /* not found in PATH */ }

    return null;
  }

function sanitizeRtspUrl(rtspUrl) {
  if (!rtspUrl) return rtspUrl;

  try {
    const url = new URL(rtspUrl);

    // Only encode username/password if they contain characters that need encoding
    // Avoid double-encoding: the URL constructor already handles encoding
    // so we only re-encode if the decoded form differs (meaning it wasn't encoded)
    if (url.username) {
      const decodedUsername = decodeURIComponent(url.username);
      if (decodedUsername !== url.username) {
        // Already encoded — leave as-is
      } else {
        url.username = encodeURIComponent(decodedUsername);
      }
    }
    if (url.password) {
      const decodedPassword = decodeURIComponent(url.password);
      if (decodedPassword !== url.password) {
        // Already encoded — leave as-is
      } else {
        url.password = encodeURIComponent(decodedPassword);
      }
    }

    return url.toString();
  } catch (err) {
    console.warn("Invalid RTSP URL:", err.message);
    return rtspUrl;
  }
}

module.exports = new CameraService();