/**
 * Call Automation Service
 *
 * Business logic for automated SIM call verification system.
 * Handles configuration management, role determination, and target rotation.
 *
 * UPDATED: Now supports per-target caller assignment where each target SIM
 * can have its own set of caller SIMs.
 *
 * BACKWARD COMPATIBLE: Works with both old format (callerSimIds/targetSimIds)
 * and new format (targetCallerMappings).
 */

const CallAutomationConfig = require('../../models/callAutomation/callAutomation.model');
const Sim = require('../../models/sim/sim.model');
const mongoose = require('mongoose');
const { NotFoundError, ValidationError, ForbiddenError } = require('../../utils/errors');
const { buildPhoneQuery } = require('../../utils/response');
const logger = require('../../utils/logger');

class CallAutomationService {
  /**
   * Save or update call automation configuration
   * Supports both old format (callerSimIds/targetSimIds) and new format (targetCallerMappings)
   * @param {Object} data - Configuration data
   * @param {Object} user - User making the request
   * @returns {Object} Saved configuration
   */
  async saveConfig(data, user, explicitCompanyId) {
    const companyId = explicitCompanyId || (user.role === 'super_admin' ? data.companyId : user.companyId);

    logger.info('[CALL AUTOMATION] saveConfig called', {
      userId: user._id?.toString(),
      userRole: user.role,
      companyId: companyId?.toString(),
      companyIdType: typeof companyId,
      userCompanyId: user.companyId?.toString(),
      mappingsCount: data.targetCallerMappings?.length || 0,
    });

    if (!companyId) {
      throw new ForbiddenError('Company ID is required');
    }

    // Determine which format we're receiving
    const isNewFormat = data.targetCallerMappings && Array.isArray(data.targetCallerMappings) && data.targetCallerMappings.length > 0;
    const isOldFormat = data.callerSimIds && Array.isArray(data.callerSimIds) && data.callerSimIds.length > 0 &&
                        data.targetSimIds && Array.isArray(data.targetSimIds) && data.targetSimIds.length > 0;

    // Validate based on format
    if (isNewFormat) {
      // Validate new format
      for (const mapping of data.targetCallerMappings) {
        if (!mapping.targetSimId) {
          throw new ValidationError('Each mapping must have a target SIM');
        }
        if (!mapping.callerSimIds || mapping.callerSimIds.length === 0) {
          throw new ValidationError('Each target must have at least one caller SIM');
        }
      }

      // Check for overlap
      const allTargetIds = data.targetCallerMappings.map(m => m.targetSimId.toString());
      const allCallerIds = data.targetCallerMappings.flatMap(m => m.callerSimIds.map(id => id.toString()));
      const overlap = allTargetIds.filter(id => allCallerIds.includes(id));
      if (overlap.length > 0) {
        throw new ValidationError('A SIM cannot be both a caller and a target');
      }

      // Verify all SIMs exist and belong to company
      const allSimIds = [...new Set([...allTargetIds, ...allCallerIds])];
      const sims = await Sim.find({ _id: { $in: allSimIds }, companyId });
      if (sims.length !== allSimIds.length) {
        throw new ValidationError('One or more SIMs not found or not active');
      }

    } else if (isOldFormat) {
      // Validate old format
      if (data.callerSimIds.length === 0) {
        throw new ValidationError('At least one caller SIM is required');
      }
      if (data.targetSimIds.length === 0) {
        throw new ValidationError('At least one target SIM is required');
      }

      // Check for overlap
      const overlap = data.callerSimIds.filter(id =>
        data.targetSimIds.some(targetId => targetId.toString() === id.toString())
      );
      if (overlap.length > 0) {
        throw new ValidationError('A SIM cannot be both Caller and Target');
      }

      // Verify all SIMs exist and belong to company
      const allSimIds = [...data.callerSimIds, ...data.targetSimIds];
      const sims = await Sim.find({ _id: { $in: allSimIds }, companyId });
      if (sims.length !== allSimIds.length) {
        throw new ValidationError('One or more SIMs not found or not active');
      }
    } else {
      throw new ValidationError('Either targetCallerMappings or callerSimIds/targetSimIds are required');
    }

    // Validate call duration
    const callDuration = data.callDuration || 10;
    if (callDuration < 10 || callDuration > 60) {
      throw new ValidationError('Call duration must be between 10 and 60 seconds');
    }

    // Validate scheduled time format
    if (data.scheduledTime && !/^([01]\d|2[0-3]):([0-5]\d)$/.test(data.scheduledTime)) {
      throw new ValidationError('Scheduled time must be in HH:MM format');
    }

    // Validate hourly shift times
    if (data.hourlyShiftStartTime && !/^([01]\d|2[0-3]):([0-5]\d)$/.test(data.hourlyShiftStartTime)) {
      throw new ValidationError('Hourly shift start time must be in HH:MM format');
    }
    if (data.hourlyShiftEndTime && !/^([01]\d|2[0-3]):([0-5]\d)$/.test(data.hourlyShiftEndTime)) {
      throw new ValidationError('Hourly shift end time must be in HH:MM format');
    }
    if (data.hourlyShiftStartTime && data.hourlyShiftEndTime && data.hourlyShiftStartTime === data.hourlyShiftEndTime) {
      throw new ValidationError('Hourly shift start time and end time cannot be the same');
    }

    // Check for existing config
    let config = await CallAutomationConfig.findOne({ companyId });

    logger.info('[CALL AUTOMATION] saveConfig called with:', {
      companyId,
      isNewFormat,
      isOldFormat,
      frequency: data.frequency,
      scheduledTime: data.scheduledTime,
      scheduledDay: data.scheduledDay,
      callDuration,
      isActive: data.isActive,
      existingConfig: config ? config._id : 'new',
    });

    if (config) {
      // Update existing config
      if (isNewFormat) {
        // Use new format
        config.targetCallerMappings = data.targetCallerMappings.map(mapping => ({
          targetSimId: mapping.targetSimId,
          callerSimIds: mapping.callerSimIds,
          callDuration: mapping.callDuration || callDuration,
        }));
        config.migrated = true;
      } else {
        // Convert old format to new format
        config.targetCallerMappings = data.targetSimIds.map(targetId => ({
          targetSimId: targetId,
          callerSimIds: data.callerSimIds,
          callDuration: callDuration,
        }));
        config.migrated = true;
      }

      config.callDuration = callDuration;
      config.frequency = data.frequency || 'daily';
      config.scheduledTime = data.scheduledTime || '09:00';
      config.scheduledDay = data.scheduledDay || 'monday';
      config.hourlyShiftStartTime = data.hourlyShiftStartTime || config.hourlyShiftStartTime || '08:00';
      config.hourlyShiftEndTime = data.hourlyShiftEndTime || config.hourlyShiftEndTime || '20:00';
      config.isActive = data.isActive !== undefined ? data.isActive : true;
      config.maxRetryAttempts = data.maxRetryAttempts !== undefined ? data.maxRetryAttempts : (config.maxRetryAttempts ?? 24);
      config.retryIntervalMinutes = data.retryIntervalMinutes !== undefined ? data.retryIntervalMinutes : (config.retryIntervalMinutes ?? 60);
      config.updatedBy = user._id;
      config.nextRunAt = config.calculateNextRunTime();
    } else {
      // Create new config
      let targetCallerMappings;
      if (isNewFormat) {
        targetCallerMappings = data.targetCallerMappings.map(mapping => ({
          targetSimId: mapping.targetSimId,
          callerSimIds: mapping.callerSimIds,
          callDuration: mapping.callDuration || callDuration,
        }));
      } else {
        // Convert old format to new format
        targetCallerMappings = data.targetSimIds.map(targetId => ({
          targetSimId: targetId,
          callerSimIds: data.callerSimIds,
          callDuration: callDuration,
        }));
      }

      config = new CallAutomationConfig({
        companyId,
        targetCallerMappings,
        callerSimIds: [], // Keep empty, using new format
        targetSimIds: [], // Keep empty, using new format
        callDuration,
        frequency: data.frequency || 'daily',
        scheduledTime: data.scheduledTime || '09:00',
        scheduledDay: data.scheduledDay || 'monday',
        hourlyShiftStartTime: data.hourlyShiftStartTime || '08:00',
        hourlyShiftEndTime: data.hourlyShiftEndTime || '20:00',
        isActive: data.isActive !== undefined ? data.isActive : true,
        maxRetryAttempts: data.maxRetryAttempts ?? 24,
        retryIntervalMinutes: data.retryIntervalMinutes ?? 60,
        createdBy: user._id,
        migrated: true,
        nextRunAt: new Date(Date.now() + 60 * 1000),
      });
    }

    await config.save();

    logger.info('[CALL AUTOMATION] Config saved successfully:', {
      configId: config._id?.toString(),
      companyId: companyId?.toString(),
      isNew: !config.isNew ? 'update' : 'create',
      mappingsCount: config.targetCallerMappings?.length || 0,
      mappings: config.targetCallerMappings?.map(m => ({
        targetSimId: m.targetSimId?.toString(),
        callerSimIds: m.callerSimIds?.map(c => c?.toString()),
        callDuration: m.callDuration,
      })),
      frequency: config.frequency,
      scheduledTime: config.scheduledTime,
      isActive: config.isActive,
    });

    // Populate for response
    await this.populateConfig(config);

    return config;
  }

  /**
   * Populate config with SIM details
   * @param {Object} config - Config document
   */
  async populateConfig(config) {
    try {
      if (config.targetCallerMappings && config.targetCallerMappings.length > 0) {
        await config.populate('targetCallerMappings.targetSimId', 'mobileNumber operator status assignedTo');
        await config.populate('targetCallerMappings.callerSimIds', 'mobileNumber operator status assignedTo');

        // Log populated mapping details for debugging
        logger.info('[CALL AUTOMATION] populateConfig: Mappings after population', {
          configId: config._id?.toString(),
          mappingsCount: config.targetCallerMappings.length,
          mappings: config.targetCallerMappings.map(m => ({
            targetSimId: m.targetSimId?._id?.toString() || m.targetSimId?.toString() || 'null',
            targetMobileNumber: m.targetSimId?.mobileNumber || 'N/A',
            callerCount: m.callerSimIds?.length || 0,
            callerIds: m.callerSimIds?.map(c => c?._id?.toString() || c?.toString() || 'null'),
            callDuration: m.callDuration,
          })),
        });
      }
      await config.populate('callerSimIds', 'mobileNumber operator status');
      await config.populate('targetSimIds', 'mobileNumber operator status');
    } catch (error) {
      logger.warn('[CALL AUTOMATION] Could not populate config', { error: error.message });
    }
    return config;
  }

  /**
   * Get configuration for a company
   * @param {Object} user - User making the request
   * @param {String} companyId - Optional company ID (for super admin)
   * @returns {Object|null} Configuration or null
   */
  async getConfig(user, companyId = null, explicitCompanyId = null) {
    const targetCompanyId = explicitCompanyId || companyId || user.companyId;

    if (!targetCompanyId) {
      throw new ForbiddenError('Company ID is required');
    }

    logger.info('[CALL AUTOMATION] getConfig called', {
      userId: user._id?.toString(),
      userRole: user.role,
      targetCompanyId: targetCompanyId?.toString(),
      targetCompanyIdType: typeof targetCompanyId,
      userCompanyId: user.companyId?.toString(),
      paramCompanyId: companyId?.toString?.() || 'not provided',
    });

    let config = await CallAutomationConfig.findOne({ companyId: targetCompanyId });

    // If not found, try with ObjectId cast
    if (!config) {
      try {
        const objectCompanyId = new mongoose.Types.ObjectId(targetCompanyId.toString());
        config = await CallAutomationConfig.findOne({ companyId: objectCompanyId });
        if (config) {
          logger.info('[CALL AUTOMATION] getConfig: Found config by ObjectId cast');
        }
      } catch (e) {
        // Ignore cast errors
      }
    }

    // Last resort: find any config
    if (!config) {
      const allConfigs = await CallAutomationConfig.find({}).select('_id companyId').lean();
      logger.warn('[CALL AUTOMATION] getConfig: Config not found by companyId. DB dump:', {
        totalConfigs: allConfigs.length,
        configs: allConfigs.map(c => ({ _id: c._id?.toString(), companyId: c.companyId?.toString() })),
        searchedCompanyId: targetCompanyId?.toString(),
      });
    }

    if (config) {
      // Populate
      await this.populateConfig(config);

      // Check if migration is needed (old format to new format)
      if (!config.migrated && config.callerSimIds?.length > 0 && config.targetSimIds?.length > 0) {
        logger.info('[CALL AUTOMATION] Migrating old config format to new format', {
          configId: config._id,
          companyId: targetCompanyId
        });

        // Convert old format to new format
        config.targetCallerMappings = config.targetSimIds.map(targetId => ({
          targetSimId: targetId,
          callerSimIds: [...config.callerSimIds],
          callDuration: config.callDuration || 10,
        }));
        config.migrated = true;
        await config.save();
      }

      logger.info('[CALL AUTOMATION] getConfig returning:', {
        configId: config._id,
        companyId: config.companyId,
        mappingsCount: config.targetCallerMappings?.length || 0,
        frequency: config.frequency,
        scheduledTime: config.scheduledTime,
        isActive: config.isActive,
      });
    } else {
      logger.info('[CALL AUTOMATION] No config found for company:', targetCompanyId);
    }

    return config;
  }

  /**
   * Get configuration for mobile device
   * Determines role based on SIM number and returns appropriate data
   * @param {String} simNumber - SIM phone number from device
   * @returns {Object} Device configuration with role and targets
   */
  async getDeviceConfig(simNumber) {
    if (!simNumber) {
      throw new ValidationError('SIM number is required');
    }

    logger.info('[CALL AUTOMATION] Getting device config for SIM:', simNumber);

    // Build phone query to handle different formats
    const phoneQuery = buildPhoneQuery(simNumber);
    if (!phoneQuery) {
      logger.warn('[CALL AUTOMATION] Invalid SIM number format:', simNumber);
      return {
        role: 'NONE',
        targets: [],
        callDuration: 10,
        frequency: 'daily',
        hourlyShiftStartTime: '08:00',
        hourlyShiftEndTime: '20:00',
        isActive: false,
      };
    }

    // Find the SIM
    const sim = await Sim.findOne(phoneQuery).populate('companyId');

    if (!sim) {
      logger.warn('[CALL AUTOMATION] SIM not found:', simNumber);
      return {
        role: 'NONE',
        targets: [],
        callDuration: 10,
        frequency: 'daily',
        scheduledTime: '09:00',
        scheduledDay: 'monday',
        hourlyShiftStartTime: '08:00',
        hourlyShiftEndTime: '20:00',
        isActive: false,
      };
    }

    logger.info('[CALL AUTOMATION] SIM found:', {
      simId: sim._id,
      mobileNumber: sim.mobileNumber,
      isActive: sim.isActive,
      status: sim.status,
      companyId: sim.companyId?._id || sim.companyId,
    });

    if (!sim.isActive || sim.status !== 'active') {
      logger.warn('[CALL AUTOMATION] SIM not active:', simNumber, {
        isActive: sim.isActive,
        status: sim.status,
      });
      return {
        role: 'NONE',
        targets: [],
        callDuration: 10,
        frequency: 'daily',
        scheduledTime: '09:00',
        scheduledDay: 'monday',
        hourlyShiftStartTime: '08:00',
        hourlyShiftEndTime: '20:00',
        isActive: false,
        simId: sim._id,
        mobileNumber: sim.mobileNumber,
      };
    }

    // Get company's call automation config
    const configCompanyId = sim.companyId?._id || sim.companyId;
    logger.info('[CALL AUTOMATION] Looking for config with companyId:', configCompanyId);

    const config = await CallAutomationConfig.findOne({
      companyId: configCompanyId,
      isActive: true
    });

    if (!config) {
      logger.info('[CALL AUTOMATION] No active config for company:', configCompanyId);
      return {
        role: 'NONE',
        targets: [],
        callDuration: 10,
        frequency: 'daily',
        scheduledTime: '09:00',
        scheduledDay: 'monday',
        hourlyShiftStartTime: '08:00',
        hourlyShiftEndTime: '20:00',
        isActive: false,
        simId: sim._id,
        mobileNumber: sim.mobileNumber,
      };
    }

    // Migrate if needed
    if (!config.migrated && config.callerSimIds?.length > 0 && config.targetSimIds?.length > 0) {
      config.targetCallerMappings = config.targetSimIds.map(targetId => ({
        targetSimId: targetId,
        callerSimIds: [...config.callerSimIds],
        callDuration: config.callDuration || 10,
      }));
      config.migrated = true;
      await config.save();
    }

    // Determine role
    const simIdStr = sim._id.toString();
    let isCaller = false;
    let isTarget = false;
    let callerTargets = [];

    // Check new format
    if (config.targetCallerMappings && config.targetCallerMappings.length > 0) {
      for (const mapping of config.targetCallerMappings) {
        const targetId = (mapping.targetSimId._id || mapping.targetSimId).toString();
        const isCallerForThisTarget = mapping.callerSimIds.some(
          id => (id._id || id).toString() === simIdStr
        );

        if (isCallerForThisTarget) {
          isCaller = true;
          callerTargets.push({
            targetSimId: mapping.targetSimId,
            callDuration: mapping.callDuration || config.callDuration
          });
        }

        if (targetId === simIdStr) {
          isTarget = true;
        }
      }
    } else {
      // Fallback to old format
      isCaller = config.callerSimIds?.some(id => id.toString() === simIdStr);
      isTarget = config.targetSimIds?.some(id => id.toString() === simIdStr);
    }

    let role = 'NONE';
    if (isCaller && isTarget) {
      role = 'CALLER'; // Caller takes precedence
    } else if (isCaller) {
      role = 'CALLER';
    } else if (isTarget) {
      role = 'RECEIVER';
    }

    logger.info('[CALL AUTOMATION] Role determined:', {
      simNumber,
      role,
      isCaller,
      isTarget,
      callerTargetsCount: callerTargets.length,
    });

    // If caller, get target phone numbers
    let targets = [];
    if (role === 'CALLER' && callerTargets.length > 0) {
      const targetIds = callerTargets.map(t => (t.targetSimId._id || t.targetSimId));
      logger.info('[CALL AUTOMATION] Fetching mobile numbers for target IDs:', {
        targetIds: targetIds.map(id => id.toString()),
      });

      const targetSims = await Sim.find({
        _id: { $in: targetIds },
      }).select('mobileNumber');

      logger.info('[CALL AUTOMATION] Found target SIMs:', {
        foundCount: targetSims.length,
        mobileNumbers: targetSims.map(s => s.mobileNumber),
      });

      targets = callerTargets.map(t => {
        const targetId = (t.targetSimId._id || t.targetSimId).toString();
        const targetSim = targetSims.find(s => s._id.toString() === targetId);
        const result = {
          mobileNumber: targetSim?.mobileNumber,
          callDuration: t.callDuration
        };
        logger.info('[CALL AUTOMATION] Mapping target:', {
          targetId,
          mobileNumber: targetSim?.mobileNumber,
          callDuration: t.callDuration,
        });
        return result;
      }).filter(t => {
        const hasNumber = !!t.mobileNumber;
        if (!hasNumber) {
          logger.warn('[CALL AUTOMATION] Filtered out target without mobileNumber');
        }
        return hasNumber;
      });
    }

    const result = {
      role,
      targets,
      callDuration: config.callDuration,
      frequency: config.frequency,
      scheduledTime: config.scheduledTime || '09:00',
      scheduledDay: config.scheduledDay || 'monday',
      hourlyShiftStartTime: config.hourlyShiftStartTime || '08:00',
      hourlyShiftEndTime: config.hourlyShiftEndTime || '20:00',
      isActive: config.isActive,
      maxRetryAttempts: config.maxRetryAttempts ?? 24,
      retryIntervalMinutes: config.retryIntervalMinutes ?? 60,
      simId: sim._id,
      mobileNumber: sim.mobileNumber,
      configId: config._id,
    };

    logger.info('[CALL AUTOMATION] Returning device config:', {
      simNumber,
      role,
      targetsCount: targets.length,
      targets: targets.map(t => ({ mobileNumber: t.mobileNumber, callDuration: t.callDuration })),
      isActive: result.isActive,
    });

    return result;
  }

  /**
   * Update last run timestamp
   * @param {String} configId - Configuration ID
   * @param {Object} metadata - Additional metadata (simNumber, successCount, failCount, results)
   */
  async updateLastRun(configId, metadata = {}) {
    const config = await CallAutomationConfig.findById(configId);

    if (!config) {
      logger.warn('[CALL AUTOMATION] Config not found for updateLastRun', { configId });
      return { lastRunAt: null, nextRunAt: null };
    }

    config.lastRunAt = new Date();
    config.lastTargetIndex = config.getNextTargetIndex ? config.getNextTargetIndex() : 0;
    config.nextRunAt = config.calculateNextRunTime();

    if (metadata.simNumber) {
      config.lastCallerSim = metadata.simNumber;
    }
    if (metadata.successCount !== undefined) {
      config.lastSuccessCount = metadata.successCount;
    }
    if (metadata.failCount !== undefined) {
      config.lastFailCount = metadata.failCount;
    }

    await config.save();

    // Record per-target call attempt results if provided
    if (metadata.results && Array.isArray(metadata.results) && metadata.results.length > 0) {
      try {
        const callAttemptService = require('../callAttempt/callAttempt.service');
        await callAttemptService.recordAttempts({
          configId,
          companyId: config.companyId,
          callerSimNumber: metadata.simNumber || '',
          results: metadata.results,
        });
      } catch (err) {
        logger.error('[CALL AUTOMATION] Error recording call attempts:', err.message);
      }
    }

    logger.info('[CALL AUTOMATION] Last run updated', {
      configId,
      simNumber: metadata.simNumber,
      successCount: metadata.successCount,
      failCount: metadata.failCount,
      resultsCount: metadata.results?.length || 0,
      lastRunAt: config.lastRunAt,
      nextRunAt: config.nextRunAt
    });

    return {
      lastRunAt: config.lastRunAt,
      nextRunAt: config.nextRunAt
    };
  }

  /**
   * Get eligible SIMs for selection (active SIMs)
   * @param {Object} user - User making the request
   * @returns {Object} Object with callers array and potentialTargets array
   */
  async getEligibleSims(user, explicitCompanyId) {
    const companyId = explicitCompanyId || user.companyId;

    if (!companyId) {
      throw new ForbiddenError('Company ID is required');
    }

    logger.info('[CALL AUTOMATION] getEligibleSims called', {
      userId: user._id?.toString(),
      userRole: user.role,
      companyId: companyId?.toString(),
      userCompanyId: user.companyId?.toString(),
    });

    // Get all active SIMs
    const sims = await Sim.find({
      companyId,
      status: 'active'
    }).select('mobileNumber operator status assignedTo isAdminCaller')
      .populate('assignedTo', 'name email')
      .sort({ mobileNumber: 1 });

    // Separate into callers (isAdminCaller = true) and potential targets (all active SIMs)
    const callers = sims.filter(sim => sim.isAdminCaller === true);
    const potentialTargets = sims; // All active SIMs can be targets

    logger.info('[CALL AUTOMATION] getEligibleSims result', {
      totalSims: sims.length,
      callers: callers.length,
      potentialTargets: potentialTargets.length,
      callerNumbers: callers.map(s => s.mobileNumber),
    });

    return {
      callers,
      potentialTargets,
      all: sims
    };
  }

  /**
   * Toggle automation active status
   * @param {Object} user - User making the request
   * @param {Boolean} isActive - Active status
   * @returns {Object} Updated configuration
   */
  async toggleActive(user, isActive, explicitCompanyId) {
    const companyId = explicitCompanyId || user.companyId;

    if (!companyId) {
      throw new ForbiddenError('Company ID is required');
    }

    logger.info('[CALL AUTOMATION] toggleActive called', {
      userId: user._id?.toString(),
      userRole: user.role,
      companyId: companyId?.toString(),
      isActive,
      userCompanyId: user.companyId?.toString(),
    });

    const config = await CallAutomationConfig.findOne({ companyId });

    if (!config) {
      logger.warn('[CALL AUTOMATION] toggleActive: Config not found', { companyId: companyId?.toString(), isActive });
      throw new NotFoundError('Call automation configuration');
    }

    const previousState = config.isActive;
    config.isActive = isActive;
    config.updatedBy = user._id;

    if (isActive) {
      config.nextRunAt = config.calculateNextRunTime();
    } else {
      config.nextRunAt = null;
    }

    await config.save();

    await this.populateConfig(config);

    logger.info('[CALL AUTOMATION] Active status toggled', {
      configId: config._id?.toString(),
      companyId: companyId?.toString(),
      previousState,
      newState: isActive,
    });

    return config;
  }

  /**
   * Delete a target-caller mapping
   * @param {Object} user - User making the request
   * @param {String} targetSimId - Target SIM ID to remove
   * @param {String} [explicitCompanyId] - Optional companyId override (from controller)
   * @returns {Object} Updated configuration
   */
  async removeTargetMapping(user, targetSimId, explicitCompanyId) {
    const companyId = explicitCompanyId || user.companyId;

    if (!companyId) {
      throw new ForbiddenError('Company ID is required');
    }

    logger.info('[CALL AUTOMATION] removeTargetMapping called', {
      userId: user._id?.toString(),
      userRole: user.role,
      companyId: companyId?.toString(),
      companyIdType: typeof companyId,
      targetSimId,
      targetSimIdType: typeof targetSimId,
      userCompanyId: user.companyId?.toString(),
      userCompanyIdType: typeof user.companyId,
      explicitCompanyId: explicitCompanyId?.toString?.() || 'not provided',
    });

    // Find config - try multiple methods in order
    let config = null;

    // Method 1: Find by companyId (string or ObjectId)
    config = await CallAutomationConfig.findOne({ companyId });

    // Method 2: Find by companyId as ObjectId
    if (!config) {
      try {
        const objectCompanyId = new mongoose.Types.ObjectId(companyId.toString());
        config = await CallAutomationConfig.findOne({ companyId: objectCompanyId });
        if (config) {
          logger.info('[CALL AUTOMATION] Found config by ObjectId cast');
        }
      } catch (castErr) {
        logger.warn('[CALL AUTOMATION] ObjectId cast failed', { castErr: castErr.message });
      }
    }

    // Method 3: Find by user.companyId directly (in case explicitCompanyId was wrong)
    if (!config && user.companyId && user.companyId.toString() !== companyId.toString()) {
      logger.info('[CALL AUTOMATION] Trying user.companyId as fallback', {
        userCompanyId: user.companyId.toString(),
        triedCompanyId: companyId.toString(),
      });
      config = await CallAutomationConfig.findOne({ companyId: user.companyId });
      if (config) {
        logger.info('[CALL AUTOMATION] Found config by user.companyId');
      }
    }

    // Method 4: Find by targetSimId in mappings
    if (!config) {
      try {
        const objectIdTarget = new mongoose.Types.ObjectId(targetSimId);
        config = await CallAutomationConfig.findOne({
          'targetCallerMappings.targetSimId': objectIdTarget
        });
        if (config) {
          logger.info('[CALL AUTOMATION] Found config by targetSimId lookup');
        }
      } catch (e) {
        config = await CallAutomationConfig.findOne({
          'targetCallerMappings.targetSimId': targetSimId
        });
      }
    }

    // Method 5: Last resort - find ANY config and log all for debugging
    if (!config) {
      const allConfigs = await CallAutomationConfig.find({}).select('companyId targetCallerMappings.targetSimId').lean();
      logger.error('[CALL AUTOMATION] Config not found by any method. DB dump:', {
        totalConfigs: allConfigs.length,
        configs: allConfigs.map(c => ({
          _id: c._id?.toString(),
          companyId: c.companyId?.toString(),
          targetSimIds: c.targetCallerMappings?.map(m => m.targetSimId?.toString?.() || 'null'),
        })),
        searchedCompanyId: companyId?.toString(),
        searchedTargetSimId: targetSimId,
      });
      throw new NotFoundError('Call automation configuration');
    }

    logger.info('[CALL AUTOMATION] Config found for removal', {
      configId: config._id?.toString(),
      configCompanyId: config.companyId?.toString(),
      mappingsCount: config.targetCallerMappings?.length,
    });

    // Remove the mapping (handle both populated and unpopulated targetSimId, plus null from deleted SIMs)
    config.targetCallerMappings = config.targetCallerMappings.filter(m => {
      // Skip null targetSimId entries (from deleted SIMs)
      if (!m.targetSimId) return false;
      const id = m.targetSimId._id ? m.targetSimId._id.toString() : m.targetSimId.toString();
      return id !== targetSimId;
    });

    if (config.targetCallerMappings.length === 0) {
      throw new ValidationError('Cannot remove the last target. At least one target is required.');
    }

    config.updatedBy = user._id;
    await config.save();

    await this.populateConfig(config);

    logger.info('[CALL AUTOMATION] Target mapping removed', {
      companyId,
      targetSimId,
      remainingMappings: config.targetCallerMappings.length
    });

    return config;
  }

  /**
   * Delete the entire call automation configuration for a company
   * @param {Object} user - User making the request
   * @param {String} [explicitCompanyId] - Optional companyId override (from controller)
   * @returns {Object} Deletion confirmation
   */
  async deleteConfig(user, explicitCompanyId) {
    const companyId = explicitCompanyId || user.companyId;

    if (!companyId) {
      throw new ForbiddenError('Company ID is required');
    }

    logger.info('[CALL AUTOMATION] deleteConfig called', {
      userId: user._id?.toString(),
      userRole: user.role,
      companyId: companyId?.toString(),
      explicitCompanyId: explicitCompanyId?.toString?.() || 'not provided',
      userCompanyId: user.companyId?.toString(),
    });

    let config = await CallAutomationConfig.findOne({ companyId });

    // Fallback: if not found by companyId, try finding any config for this user's company
    if (!config && user.companyId) {
      logger.warn('[CALL AUTOMATION] Config not found by companyId for deletion, trying user.companyId', {
        explicitCompanyId: explicitCompanyId?.toString?.() || 'not provided',
        userCompanyId: user.companyId?.toString(),
      });
      config = await CallAutomationConfig.findOne({ companyId: user.companyId });
    }

    if (!config) {
      logger.error('[CALL AUTOMATION] deleteConfig: Config not found', {
        companyId: companyId?.toString(),
        userCompanyId: user.companyId?.toString(),
      });
      throw new NotFoundError('Call automation configuration');
    }

    logger.info('[CALL AUTOMATION] Deleting config', {
      configId: config._id?.toString(),
      companyId: config.companyId?.toString(),
      mappingsCount: config.targetCallerMappings?.length || 0,
      isActive: config.isActive,
    });

    await CallAutomationConfig.deleteOne({ _id: config._id });

    logger.info('[CALL AUTOMATION] Config deleted successfully', { companyId: config.companyId?.toString() });

    return { message: 'Call automation configuration deleted successfully' };
  }

  /**
   * Add a new target-caller mapping
   * @param {Object} user - User making the request
   * @param {Object} mapping - Mapping with targetSimId and callerSimIds
   * @returns {Object} Updated configuration
   */
  async addTargetMapping(user, mapping, explicitCompanyId) {
    const companyId = explicitCompanyId || user.companyId;

    if (!companyId) {
      throw new ForbiddenError('Company ID is required');
    }

    logger.info('[CALL AUTOMATION] addTargetMapping called', {
      userId: user._id?.toString(),
      userRole: user.role,
      companyId: companyId?.toString(),
      targetSimId: mapping.targetSimId,
      callersCount: mapping.callerSimIds?.length || 0,
      callerSimIds: mapping.callerSimIds,
      callDuration: mapping.callDuration,
      userCompanyId: user.companyId?.toString(),
      explicitCompanyId: explicitCompanyId?.toString?.() || 'not provided',
    });

    let config = await CallAutomationConfig.findOne({ companyId });

    // Fallback: try finding config that contains any of the target/caller SIM IDs
    if (!config && mapping.targetSimId) {
      logger.warn('[CALL AUTOMATION] Config not found by companyId for addMapping, trying targetSimId lookup', {
        companyId: companyId?.toString(),
        targetSimId: mapping.targetSimId,
      });
      try {
        const objectIdTarget = new mongoose.Types.ObjectId(mapping.targetSimId);
        config = await CallAutomationConfig.findOne({
          $or: [
            { 'targetCallerMappings.targetSimId': objectIdTarget },
            { 'targetCallerMappings.callerSimIds': objectIdTarget }
          ]
        });
      } catch (e) {
        config = await CallAutomationConfig.findOne({
          $or: [
            { 'targetCallerMappings.targetSimId': mapping.targetSimId },
            { 'targetCallerMappings.callerSimIds': mapping.targetSimId }
          ]
        });
      }
      if (config) {
        logger.info('[CALL AUTOMATION] addMapping: Found config by targetSimId lookup');
      }
    }

    if (!config) {
      logger.error('[CALL AUTOMATION] addTargetMapping: Config not found', {
        companyId: companyId?.toString(),
        targetSimId: mapping.targetSimId,
      });
      throw new NotFoundError('Call automation configuration not found. Please create one first.');
    }

    // Validate mapping
    if (!mapping.targetSimId) {
      throw new ValidationError('Target SIM ID is required');
    }
    if (!mapping.callerSimIds || mapping.callerSimIds.length === 0) {
      throw new ValidationError('At least one caller SIM is required');
    }

    // Check if target already exists (handle populated and null targetSimId)
    const existingIndex = config.targetCallerMappings.findIndex(m => {
      if (!m.targetSimId) return false;
      const id = m.targetSimId._id ? m.targetSimId._id.toString() : m.targetSimId.toString();
      return id === mapping.targetSimId;
    });

    if (existingIndex >= 0) {
      // Update existing mapping
      logger.info('[CALL AUTOMATION] addTargetMapping: Updating existing mapping', {
        configId: config._id?.toString(),
        targetSimId: mapping.targetSimId,
        existingIndex,
        newCallerSimIds: mapping.callerSimIds,
        newCallDuration: mapping.callDuration || config.callDuration,
      });
      config.targetCallerMappings[existingIndex].callerSimIds = mapping.callerSimIds;
      config.targetCallerMappings[existingIndex].callDuration = mapping.callDuration || config.callDuration;
    } else {
      // Add new mapping
      logger.info('[CALL AUTOMATION] addTargetMapping: Adding new mapping', {
        configId: config._id?.toString(),
        targetSimId: mapping.targetSimId,
        callerSimIds: mapping.callerSimIds,
        callDuration: mapping.callDuration || config.callDuration,
        totalMappingsAfter: config.targetCallerMappings.length + 1,
      });
      config.targetCallerMappings.push({
        targetSimId: mapping.targetSimId,
        callerSimIds: mapping.callerSimIds,
        callDuration: mapping.callDuration || config.callDuration
      });
    }

    config.updatedBy = user._id;
    await config.save();

    logger.info('[CALL AUTOMATION] addTargetMapping: Config saved successfully', {
      configId: config._id?.toString(),
      companyId: config.companyId?.toString(),
      totalMappings: config.targetCallerMappings?.length || 0,
      mappings: config.targetCallerMappings?.map(m => ({
        targetSimId: m.targetSimId?.toString(),
        callerSimIds: m.callerSimIds?.map(c => c?.toString()),
        callDuration: m.callDuration,
      })),
    });

    await this.populateConfig(config);

    logger.info('[CALL AUTOMATION] Target mapping added/updated (after populate)', {
      configId: config._id?.toString(),
      companyId,
      targetSimId: mapping.targetSimId,
      callersCount: mapping.callerSimIds.length,
      totalMappings: config.targetCallerMappings?.length || 0,
    });

    return config;
  }
}

module.exports = new CallAutomationService();