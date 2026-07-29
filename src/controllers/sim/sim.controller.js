const simService = require('../../services/sim/sim.service');
const auditLogService = require('../../services/auditLog/auditLog.service');
const { successResponse, paginatedResponse } = require('../../utils/response');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');

class SimController {
  async create(req, res, next) {
    try {
      const sim = await simService.createSim(req.body, req.user);

      // Audit log: SIM_CREATE
      await auditLogService.logAction({
        action: 'SIM_CREATE',
        module: 'SIM',
        description: `Created SIM ${sim.mobileNumber} (${sim.operator})`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: sim.companyId,
        entityId: sim._id,
        entityType: 'SIM',
        metadata: { mobileNumber: sim.mobileNumber, operator: sim.operator },
        req,
      });

      return successResponse(res, sim, 'SIM created successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  async bulkCreate(req, res, next) {
    try {
      const { sims } = req.body;
      const result = await simService.bulkCreateSims(sims, req.user);

      // Audit log: SIM_BULK_CREATE
      await auditLogService.logAction({
        action: 'SIM_BULK_CREATE',
        module: 'SIM',
        description: `Bulk created ${result.inserted} SIMs`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: req.user.companyId,
        metadata: { inserted: result.inserted, failed: result.failed },
        req,
      });

      return successResponse(res, result, `${result.inserted} SIMs created successfully`, 201);
    } catch (error) {
      next(error);
    }
  }

  async bulkImport(req, res, next) {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'Please upload an Excel file',
        });
      }

      const { companyId } = req.body;
      const result = await simService.bulkImport(req.file, req.user, companyId);

      // Audit log: SIM_BULK_IMPORT
      await auditLogService.logAction({
        action: 'SIM_BULK_IMPORT',
        module: 'SIM',
        description: `Imported ${result.inserted} SIMs from Excel file`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: req.user.companyId,
        metadata: { inserted: result.inserted, failed: result.failed, total: result.total },
        req,
      });

      return successResponse(res, result, 'Import completed');
    } catch (error) {
      next(error);
    }
  }

  async getAll(req, res, next) {
    try {
      const result = await simService.getAllSims(req.query, req.user);
      return paginatedResponse(res, result.data, result.total, result.page, result.limit);
    } catch (error) {
      next(error);
    }
  }

  async getById(req, res, next) {
    try {
      const sim = await simService.getSimById(req.params.id, req.user);
      return successResponse(res, sim);
    } catch (error) {
      next(error);
    }
  }

  async update(req, res, next) {
    try {
      const sim = await simService.updateSim(req.params.id, req.body, req.user);

      // Audit log: SIM_UPDATE
      await auditLogService.logAction({
        action: 'SIM_UPDATE',
        module: 'SIM',
        description: `Updated SIM ${sim.mobileNumber}`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: sim.companyId,
        entityId: sim._id,
        entityType: 'SIM',
        metadata: { mobileNumber: sim.mobileNumber, changes: req.body },
        req,
      });

      return successResponse(res, sim, 'SIM updated successfully.');
    } catch (error) {
      next(error);
    }
  }

  async delete(req, res, next) {
    try {
      const sim = await simService.deleteSim(req.params.id, req.user);

      // Audit log: SIM_DELETE
      await auditLogService.logAction({
        action: 'SIM_DELETE',
        module: 'SIM',
        description: `Deleted SIM ${sim.mobileNumber}`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: sim.companyId,
        entityId: sim._id,
        entityType: 'SIM',
        metadata: { mobileNumber: sim.mobileNumber },
        req,
      });

      return successResponse(res, null, 'SIM deleted successfully.');
    } catch (error) {
      next(error);
    }
  }

  async updateStatus(req, res, next) {
    try {
      const { status } = req.body;
      const sim = await simService.updateStatus(req.params.id, status, req.user);

      // Audit log: SIM_STATUS_CHANGE
      await auditLogService.logAction({
        action: 'SIM_STATUS_CHANGE',
        module: 'SIM',
        description: `Changed status of SIM ${sim.mobileNumber} to ${status}`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: sim.companyId,
        entityId: sim._id,
        entityType: 'SIM',
        metadata: { mobileNumber: sim.mobileNumber, newStatus: status },
        req,
      });

      return successResponse(res, sim, 'SIM status updated');
    } catch (error) {
      next(error);
    }
  }

  async assign(req, res, next) {
    try {
      const { userId } = req.body;
      const sim = await simService.assignSim(req.params.id, userId, req.user);

      // Audit log: SIM_ASSIGN
      await auditLogService.logAction({
        action: 'SIM_ASSIGN',
        module: 'SIM',
        description: `Assigned SIM ${sim.mobileNumber} to user`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: sim.companyId,
        entityId: sim._id,
        entityType: 'SIM',
        metadata: { mobileNumber: sim.mobileNumber, assignedTo: userId },
        req,
      });

      return successResponse(res, sim, 'SIM assigned successfully');
    } catch (error) {
      next(error);
    }
  }

  async unassign(req, res, next) {
    try {
      const sim = await simService.unassignSim(req.params.id, req.user);

      // Audit log: SIM_UNASSIGN
      await auditLogService.logAction({
        action: 'SIM_UNASSIGN',
        module: 'SIM',
        description: `Unassigned SIM ${sim.mobileNumber}`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: sim.companyId,
        entityId: sim._id,
        entityType: 'SIM',
        metadata: { mobileNumber: sim.mobileNumber },
        req,
      });

      return successResponse(res, sim, 'SIM unassigned successfully');
    } catch (error) {
      next(error);
    }
  }

  async export(req, res, next) {
    try {
      const sims = await simService.exportSims(req.query, req.user);

      // Create Excel file
      const workbook = xlsx.utils.book_new();
      const data = sims.map((sim) => ({
        'Company Contact Number': sim.mobileNumber,
        'Operator': sim.operator,
        'Circle': sim.circle || '',
        'SIM Owner Name': sim.simOwnerName || '',
        'Status': sim.status,
        'User Name': sim.assignedTo?.name || '',
        'User Email': sim.assignedTo?.email || '',
        'User Personal Contact Number': sim.assignedTo?.phoneNumber || '',
        'Notes': sim.notes || '',
        'Created At': sim.createdAt.toISOString().split('T')[0],
      }));

      const sheet = xlsx.utils.json_to_sheet(data);
      xlsx.utils.book_append_sheet(workbook, sheet, 'SIMs');

      // Write to buffer
      const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      // Audit log: SIM_EXPORT
      await auditLogService.logAction({
        action: 'SIM_EXPORT',
        module: 'SIM',
        description: `Exported ${sims.length} SIMs to Excel`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: req.user.companyId,
        metadata: { count: sims.length },
        req,
      });

      res.setHeader('Content-Disposition', 'attachment; filename=sims-export.xlsx');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-offreadml.document.spreadsheetml.sheet');
      res.send(buffer);
    } catch (error) {
      next(error);
    }
  }

  async getStats(req, res, next) {
    try {
      const companyId = req.user.role === 'super_admin' ? req.query.companyId : req.user.companyId;
      const stats = await simService.getSimStats(companyId);
      return successResponse(res, stats);
    } catch (error) {
      next(error);
    }
  }

  async downloadTemplate(req, res, next) {
    try {
      const workbook = await simService.generateImportTemplate();
      const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader('Content-Disposition', 'attachment; filename=sim-import-template.xlsx');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.send(buffer);
    } catch (error) {
      next(error);
    }
  }

  async updateMessagingStatus(req, res, next) {
    try {
      const { platform, enabled } = req.body;
      const sim = await simService.updateMessagingStatus(req.params.id, platform, enabled, req.user);
      return successResponse(res, sim, `${platform} status updated`);
    } catch (error) {
      next(error);
    }
  }

  async getMessagingStats(req, res, next) {
    try {
      const companyId = req.user.role === 'super_admin' ? req.query.companyId : req.user.companyId;
      const stats = await simService.getMessagingStats(companyId);
      return successResponse(res, stats);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get SIMs assigned to the logged-in user
   * [MULTI-SIM SUPPORT] - Mobile app uses this to get assigned SIMs
   * GET /api/sims/my
   */
  async getMySims(req, res, next) {
    try {
      const sims = await simService.getAssignedSims(req.user);
      return successResponse(res, sims);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Detect operator from Contact Number
   * [INTERNATIONAL OPERATORS] - Supports multiple countries
   * POST /api/sims/detect-operator
   * Body: { mobileNumber: string (with country code, e.g., +919876543210) }
   */
  async detectOperator(req, res, next) {
    try {
      const { mobileNumber } = req.body;

      if (!mobileNumber) {
        return res.status(400).json({
          success: false,
          message: 'Contact Number is required',
        });
      }

      // Normalize number
      let normalizedNumber = mobileNumber;
      if (!mobileNumber.startsWith('+')) {
        normalizedNumber = '+' + mobileNumber;
      }

      // [INTERNATIONAL OPERATORS] - Country-specific operator detection
      // Format: { countryCode: { country, operators, prefixes?, detectByPrefix?: boolean } }
      const countryOperatorConfig = {
        // India - Detect by number series
        '+91': {
          country: 'India',
          operators: ['Jio', 'Airtel', 'Vi', 'BSNL', 'MTNL', 'Other'],
          detectByPrefix: true,
          // Jio series
          jioPrefixes: ['700', '701', '702', '703', '704', '705', '706', '707', '708', '709',
            '727', '728', '729', '730', '731', '732', '733', '734', '735', '736', '737', '738', '739',
            '740', '741', '742', '743', '744', '745', '746', '747', '748', '749',
            '750', '751', '752', '753', '754', '755', '756', '757', '758', '759',
            '760', '761', '762', '763', '764', '765', '766', '767', '768', '769',
            '770', '771', '772', '773', '774', '775', '776', '777', '778', '779',
            '780', '781', '782', '783', '784', '785', '786', '787', '788', '789',
            '790', '791', '792', '793', '794', '795', '796', '797', '798', '799',
            '830', '831', '832', '833', '834', '835', '836', '837', '838', '839',
            '869', '870', '871', '872', '873', '874', '875', '876', '877', '878', '879',
            '880', '881', '882', '883', '884', '885', '886', '887', '888', '889',
            '890', '891', '892', '893', '894', '895', '896', '897', '898', '899',
            '910', '911', '912', '913', '914', '915', '916', '917', '918', '919',
            '920', '921', '922', '923', '924', '925', '926', '927', '928', '929',
            '930', '931', '932', '933', '934', '935', '936', '937', '938', '939',
            '940', '941', '942', '943', '944', '945', '946', '947', '948', '949',
            '950', '951', '952', '953', '954', '955', '956', '957', '958', '959',
            '960', '961', '962', '963', '964', '965', '966', '967', '968', '969',
            '970', '971', '972', '973', '974', '975', '976', '977', '978', '979',
            '980', '981', '982', '983', '984', '985', '986', '987', '988', '989',
            '990', '991', '992', '993', '994', '995', '996', '997', '998', '999',
            '600', '601', '602', '603', '604', '605', '606', '607', '608', '609',
            '610', '611', '612', '613', '614', '615', '616', '617', '618', '619',
            '620', '621', '622', '623', '624', '625', '626', '627', '628', '629'],
          // BSNL series
          bsnlPrefixes: ['940', '941', '942', '943', '944', '945', '946', '947', '948', '949',
            '800', '801', '802', '803', '804', '805', '806', '807', '808', '809',
            '810', '811', '812', '813', '814', '815', '816', '817', '818', '819',
            '850', '851', '852', '853', '854', '855', '856', '857', '858', '859',
            '860', '861', '862', '863', '864', '865', '866', '867', '868', '869'],
          // MTNL series
          mtnlPrefixes: ['991', '992', '993', '994', '995', '996', '997', '998', '999',
            '981', '982', '983', '984', '985', '986', '987', '988', '989', '990'],
        },
        // UAE
        '+971': {
          country: 'UAE',
          operators: ['Etisalat', 'Du', 'Virgin Mobile', 'Other'],
          detectByPrefix: true,
          etisalatPrefixes: ['50', '51', '52', '56', '58'], // Etisalat prefixes
          duPrefixes: ['52', '54', '55', '56', '58'], // Du prefixes
          virginPrefixes: ['56'], // Virgin Mobile
        },
        // Saudi Arabia
        '+966': {
          country: 'Saudi Arabia',
          operators: ['STC', 'Mobily', 'Zain', 'Other'],
          detectByPrefix: true,
          stcPrefixes: ['50', '53', '54', '55', '59'],
          mobilyPrefixes: ['53', '54', '56', '57'],
          zainPrefixes: ['50', '54', '55', '56', '59'],
        },
        // Qatar
        '+974': {
          country: 'Qatar',
          operators: ['Ooredoo', 'Vodafone Qatar', 'Other'],
          detectByPrefix: true,
          ooredooPrefixes: ['33', '44', '50', '51', '52', '55', '66', '77'],
          vodafonePrefixes: ['30', '31', '32', '33', '44', '50', '51', '52', '55', '66', '77'],
        },
        // Kuwait
        '+965': {
          country: 'Kuwait',
          operators: ['Zain', 'Ooredoo', 'STC', 'Other'],
          detectByPrefix: true,
          zainPrefixes: ['5', '6', '9'],
          ooredooPrefixes: ['5', '6', '9'],
          stcPrefixes: ['5', '6'],
        },
        // Bahrain
        '+973': {
          country: 'Bahrain',
          operators: ['Batelco', 'Zain Bahrain', 'STC Bahrain', 'Other'],
          detectByPrefix: false,
        },
        // Oman
        '+968': {
          country: 'Oman',
          operators: ['Omantel', 'Ooredoo', 'Other'],
          detectByPrefix: true,
          omantelPrefixes: ['9', '7'],
          ooredooPrefixes: ['9', '7'],
        },
        // Australia
        '+61': {
          country: 'Australia',
          operators: ['Telstra', 'Optus', 'Vodafone', 'TPG', 'Other'],
          detectByPrefix: false,
        },
        // USA/Canada
        '+1': {
          country: 'USA/Canada',
          operators: ['Verizon', 'AT&T', 'T-Mobile', 'Sprint', 'US Cellular', 'Other'],
          detectByPrefix: false,
        },
        // UK
        '+44': {
          country: 'United Kingdom',
          operators: ['EE', 'Vodafone', 'O2', 'Three', 'Virgin Mobile', 'Sky Mobile', 'Giffgaff', 'Other'],
          detectByPrefix: false,
        },
        // Singapore
        '+65': {
          country: 'Singapore',
          operators: ['Singtel', 'StarHub', 'M1', 'Circles.Life', 'Other'],
          detectByPrefix: true,
          singtelPrefixes: ['8', '9'],
          starhubPrefixes: ['8', '9'],
          m1Prefixes: ['8', '9'],
        },
      };

      // Detect country and operator
      let detectedCountry = 'Unknown';
      let detectedOperator = 'Other';
      let detectedCountryCode = '+1'; // Default fallback

      // Find matching country code (check longer codes first)
      const sortedCodes = Object.keys(countryOperatorConfig).sort((a, b) => b.length - a.length);
      for (const code of sortedCodes) {
        if (normalizedNumber.startsWith(code)) {
          detectedCountryCode = code;
          const config = countryOperatorConfig[code];
          detectedCountry = config.country;

          // Try to detect operator by prefix
          if (config.detectByPrefix && normalizedNumber.length >= 10) {
            const subscriberNumber = normalizedNumber.substring(code.length);
            const prefix3 = subscriberNumber.substring(0, 3);
            const prefix2 = subscriberNumber.substring(0, 2);

            // India-specific detection
            if (code === '+91') {
              if (config.jioPrefixes && config.jioPrefixes.includes(prefix3)) {
                detectedOperator = 'Jio';
              } else if (config.bsnlPrefixes && config.bsnlPrefixes.includes(prefix3)) {
                detectedOperator = 'BSNL';
              } else if (config.mtnlPrefixes && config.mtnlPrefixes.includes(prefix3)) {
                detectedOperator = 'MTNL';
              }
              // Airtel and Vi have overlapping series, return first match
              else {
                detectedOperator = 'Other'; // Will be refined based on more specific patterns
              }
            }
            // UAE detection
            else if (code === '+971') {
              if (config.etisalatPrefixes && config.etisalatPrefixes.includes(prefix2)) {
                detectedOperator = 'Etisalat';
              } else if (config.duPrefixes && config.duPrefixes.includes(prefix2)) {
                detectedOperator = 'Du';
              }
            }
            // Saudi detection
            else if (code === '+966') {
              if (config.stcPrefixes && config.stcPrefixes.includes(prefix2)) {
                detectedOperator = 'STC';
              } else if (config.mobilyPrefixes && config.mobilyPrefixes.includes(prefix2)) {
                detectedOperator = 'Mobily';
              } else if (config.zainPrefixes && config.zainPrefixes.includes(prefix2)) {
                detectedOperator = 'Zain';
              }
            }
            // Qatar detection
            else if (code === '+974') {
              if (config.ooredooPrefixes && config.ooredooPrefixes.includes(prefix2)) {
                detectedOperator = 'Ooredoo';
              } else if (config.vodafonePrefixes && config.vodafonePrefixes.includes(prefix2)) {
                detectedOperator = 'Vodafone Qatar';
              }
            }
          }
          break;
        }
      }

      return successResponse(res, {
        operator: detectedOperator,
        countryCode: detectedCountryCode,
        country: detectedCountry,
        mobileNumber: mobileNumber,
        suggestedOperators: countryOperatorConfig[detectedCountryCode]?.operators || ['Other'],
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new SimController();