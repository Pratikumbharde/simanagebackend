const Sim = require('../../models/sim/sim.model');
const User = require('../../models/auth/user.model');
const Company = require('../../models/company/company.model');
const WhatsAppMessage = require('../../models/whatsapp/whatsapp.model');
const TelegramMessage = require('../../models/telegram/telegram.model');
const mongoose = require('mongoose');
const crypto = require('crypto');
const { NotFoundError, ConflictError, ForbiddenError, ValidationError } = require('../../utils/errors');
const notificationHelper = require('../../utils/notificationHelper');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');

class SimService {
  // Check if a user has reached the SIM assignment limit (max 2 per user)
  async validateSimAssignmentLimit(userId, excludeSimId = null) {
    const filter = { assignedTo: userId };
    if (excludeSimId) {
      filter._id = { $ne: excludeSimId };
    }
    const assignedCount = await Sim.countDocuments(filter);
    if (assignedCount >= 2) {
      throw new ValidationError(`User is already assigned to ${assignedCount} SIMs. Maximum 2 SIMs allowed per user.`);
    }
  }

  async createSim(data, user) {
    const { mobileNumber, operator, companyId, assignedTo } = data;

    // Determine companyId
    const targetCompanyId = user.role === 'super_admin' ? companyId : user.companyId;

    if (!targetCompanyId) {
      throw new ForbiddenError('Company ID is required');
    }

    // Check if Contact Number exists
    const existingMobile = await Sim.findOne({ mobileNumber, companyId: targetCompanyId });
    if (existingMobile) {
      throw new ConflictError('Contact Number already exists in your company');
    }

    // Validate assignedTo if provided
    let assignedUser = null;
    if (assignedTo) {
      assignedUser = await User.findById(assignedTo);
      if (!assignedUser || assignedUser.companyId.toString() !== targetCompanyId.toString()) {
        throw new ValidationError('Invalid user assignment. User must belong to the same company.');
      }
      // Check SIM assignment limit (max 2 per user)
      await this.validateSimAssignmentLimit(assignedTo);
    }

    const sim = new Sim({
      ...data,
      companyId: targetCompanyId,
      createdBy: user.id,
      assignedTo: assignedTo || null,
    });

    await sim.save();

    // Update company stats
    await this.updateCompanyStats(targetCompanyId);

    // Send notification to assigned user if SIM was assigned during creation
    if (assignedTo && assignedUser) {
      try {
        const company = await Company.findById(targetCompanyId);
        await notificationHelper.notifySimAssigned(sim, assignedUser, user, company);
      } catch (notificationError) {
        // Don't fail SIM creation if notification fails
        console.error('Failed to send SIM assignment notification:', notificationError.message);
      }
    }

    return sim;
  }

  async bulkCreateSims(simsData, user) {
    const targetCompanyId = user.role === 'super_admin' ? simsData[0]?.companyId : user.companyId;

    if (!targetCompanyId) {
      throw new ForbiddenError('Company ID is required');
    }

    const validOperators = ['Jio', 'Airtel', 'Vi', 'BSNL', 'MTNL', 'Other'];
    const validStatuses = ['active', 'inactive'];
    const errors = [];
    const simsToInsert = [];
    // [BULK UPLOAD FIX] Track created users for response
    const createdUsers = [];
    // [SIM ASSIGNMENT EMAIL] Track existing users who were assigned SIMs
    const assignedExistingUsers = [];
    // Track per-user SIM count within this batch for assignment limit validation
    const batchUserAssignmentCount = {};

    // Combine country code with Contact Number for each SIM
    const processedData = simsData.map(row => ({
      ...row,
      mobileNumber: (row.countryCode || '+91') + row.mobileNumber
    }));

    const mobileNumbers = processedData.map(s => s.mobileNumber);

    // Check for duplicate Contact Numbers within the batch
    const duplicates = mobileNumbers.filter((item, index) => mobileNumbers.indexOf(item) !== index);
    if (duplicates.length > 0) {
      throw new ValidationError(`Duplicate Contact Numbers in batch: ${[...new Set(duplicates)].join(', ')}`);
    }

    // Check existing Contact Numbers
    const existingSims = await Sim.find({
      mobileNumber: { $in: mobileNumbers },
      companyId: targetCompanyId,
    });

    const existingMobileNumbers = existingSims.map(s => s.mobileNumber);

    // [BULK UPLOAD FIX] Collect unique emails for user lookup
    const emails = processedData
      .map(s => s.assignedUserEmail)
      .filter(email => email && email.trim() !== '')
      .map(email => email.toLowerCase());

    const uniqueEmails = [...new Set(emails)];

    // [GLOBAL UNIQUE EMAIL] Look up users by email globally
    // One email can only belong to one user across all companies
    let userEmailMap = {};
    let userMap = {}; // [BULK UPLOAD FIX] Store full user objects for name lookup
    let emailsInOtherCompanies = new Set(); // [GLOBAL UNIQUE EMAIL] Track emails in OTHER companies
    if (uniqueEmails.length > 0) {
      // [HARD DELETE] Removed isActive: true filter - users are now hard deleted
      const existingUsers = await User.find({
        email: { $in: uniqueEmails },
      }).select('_id email name companyId');

      existingUsers.forEach(u => {
        const emailKey = u.email.toLowerCase();
        // Check if this user belongs to THIS company
        if (u.companyId && u.companyId.toString() === targetCompanyId.toString()) {
          // User belongs to this company - can be used
          userEmailMap[emailKey] = u._id;
          userMap[emailKey] = u;
        } else {
          // [GLOBAL UNIQUE EMAIL] User exists in ANOTHER company - CANNOT be used
          emailsInOtherCompanies.add(emailKey);
        }
      });
    }

    for (let i = 0; i < processedData.length; i++) {
      const row = processedData[i];
      const originalRow = simsData[i];
      const rowErrors = [];

      // Validate Contact Number (10 digits without country code)
      if (!originalRow.mobileNumber || !/^\d{10}$/.test(originalRow.mobileNumber)) {
        rowErrors.push('Invalid 10-digit Contact Number');
      }

      // Validate operator
      if (row.operator && !validOperators.includes(row.operator)) {
        rowErrors.push(`Invalid operator. Must be one of: ${validOperators.join(', ')}`);
      }

      // Validate status
      if (row.status && !validStatuses.includes(row.status)) {
        rowErrors.push(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
      }

      // Check if Contact Number already exists
      if (existingMobileNumbers.includes(row.mobileNumber)) {
        rowErrors.push('Contact Number already exists');
      }

      // [BULK UPLOAD FIX] Handle assigned user - create if not exists
      let assignedTo = null;
      let assignedToName = null;
      if (row.assignedUserEmail && row.assignedUserEmail.trim() !== '') {
        const email = row.assignedUserEmail.toLowerCase();

        // [GLOBAL UNIQUE EMAIL] Check if email exists in ANOTHER company
        if (emailsInOtherCompanies.has(email)) {
          rowErrors.push(`Email "${email}" is already registered in another company. Each email can only be used once in the system.`);
        } else if (userEmailMap[email]) {
          // [GLOBAL UNIQUE EMAIL] User exists in THIS company - use existing
          assignedTo = userEmailMap[email];
          assignedToName = userMap[email]?.name || 'Unknown';
          // [SIM ASSIGNMENT EMAIL] Track existing users who were assigned SIMs
          assignedExistingUsers.push({
            userId: assignedTo,
            simMobileNumber: row.mobileNumber,
            simOperator: row.operator || 'Jio',
          });
        } else {
          // [BULK UPLOAD FIX] User does not exist - create new user
          const userName = row.assignedUserName;
          const userPhone = row.assignedUserPhone || null;

          // [BULK UPLOAD FIX] Name is required when creating new user
          if (!userName || userName.trim() === '') {
            rowErrors.push('Assigned User Name is required when creating new user');
          } else {
            // [OTP EMAIL FIX] - Normalize phone number for mobile login (moved outside try for catch block access)
            let normalizedPhone = userPhone;
            if (userPhone) {
              normalizedPhone = userPhone.replace(/[\s-]/g, '');
              if (/^\d{10}$/.test(normalizedPhone)) {
                normalizedPhone = '+91' + normalizedPhone;
              }
              if (/^91\d{10}$/.test(normalizedPhone)) {
                normalizedPhone = '+' + normalizedPhone;
              }
            }

            try {
              // [BULK UPLOAD FIX] Create new user with provided name
              const newUser = new User({
                email: email,
                name: userName.trim(),
                phone: userPhone,
                mobileNumber: normalizedPhone, // [OTP EMAIL FIX] - Set mobileNumber for OTP login
                role: 'user',
                companyId: targetCompanyId,
                isActive: true,
                emailVerified: false,
              });

              await newUser.save();

              // [BULK UPLOAD FIX] Update maps for subsequent rows with same email
              userEmailMap[email] = newUser._id;
              userMap[email] = newUser;

              // [BULK UPLOAD FIX] Track created user for response
              createdUsers.push({
                email: email,
                name: userName.trim(),
                userId: newUser._id
              });

              assignedTo = newUser._id;
              assignedToName = userName.trim();
            } catch (userCreateError) {
              // [GLOBAL UNIQUE EMAIL] Handle duplicate email error
              if (userCreateError.code === 11000) {
                // Duplicate key error - email already exists somewhere in the system
                rowErrors.push(`Email "${email}" is already registered in the system. Each email can only be used once.`);
              } else {
                rowErrors.push(`Failed to create user: ${userCreateError.message}`);
              }
            }
          }
        }
      }

      // Check SIM assignment limit (max 2 per user) for this assigned user
      if (assignedTo) {
        const userIdStr = assignedTo.toString();
        const currentCount = await Sim.countDocuments({ assignedTo: assignedTo });
        const batchCount = batchUserAssignmentCount[userIdStr] || 0;
        if (currentCount + batchCount >= 2) {
          const totalCount = currentCount + batchCount;
          rowErrors.push(`User is already assigned to ${totalCount} SIM${totalCount > 1 ? 's' : ''}. Maximum 2 SIMs allowed per user.`);
        } else {
          batchUserAssignmentCount[userIdStr] = batchCount + 1;
        }
      }

      if (rowErrors.length > 0) {
        errors.push({ row: i + 1, mobileNumber: row.mobileNumber, errors: rowErrors });
      } else {
        simsToInsert.push({
          mobileNumber: row.mobileNumber,
          operator: row.operator || 'Jio',
          circle: row.circle || '',
          simOwnerName: row.simOwnerName || '',
          status: row.status || 'active',
          notes: row.notes || '',
          assignedTo: assignedTo,
          // [BULK UPLOAD FIX] Include assigned user name for response
          _assignedToName: assignedToName,
          companyId: targetCompanyId,
          createdBy: user.id,
          isActive: true,
          whatsappEnabled: false,
          telegramEnabled: false,
        });
      }
    }

    if (errors.length > 0) {
      // throw new ValidationError('Validation errors', { errors });
      throw new ValidationError(errors);
    }

    // Bulk insert
    const result = await Sim.insertMany(simsToInsert, { ordered: false });

    // Update company stats
    await this.updateCompanyStats(targetCompanyId);

    // [BULK UPLOAD EMAIL FIX] Send welcome emails to newly created users
    let emailsFailed = 0;
    if (createdUsers.length > 0) {
      try {
        // Get company info for email
        const company = await Company.findById(targetCompanyId);

        // Send welcome emails asynchronously using Promise.allSettled
        const emailPromises = createdUsers.map(async (createdUser) => {
          try {
            // Get full user object for email
            const user = await User.findById(createdUser.userId);
            if (user && company) {
              // Send welcome email (auto-generated password for new users)
              const autoPassword = crypto.randomBytes(8).toString('hex');
              await notificationHelper.notifyUserCreated(user, company, autoPassword);
            }
          } catch (emailError) {
            console.error(`[BULK UPLOAD] Failed to send welcome email to ${createdUser.email}:`, emailError.message);
            return { success: false, email: createdUser.email, error: emailError.message };
          }
          return { success: true, email: createdUser.email };
        });

        const emailResults = await Promise.allSettled(emailPromises);
        emailsFailed = emailResults.filter(r => r.status === 'rejected' || (r.value && !r.value.success)).length;

        if (emailsFailed > 0) {
          console.log(`[BULK UPLOAD] Welcome emails sent: ${createdUsers.length - emailsFailed}, failed: ${emailsFailed}`);
        }
      } catch (emailError) {
        console.error('[BULK UPLOAD] Error sending welcome emails:', emailError.message);
        // Don't fail the upload if emails fail
      }
    }

    // [SIM ASSIGNMENT EMAIL] Send SIM assignment notifications to existing users
    if (assignedExistingUsers.length > 0) {
      try {
        const company = await Company.findById(targetCompanyId);
        const adminUser = await User.findById(user.id);

        const assignmentPromises = assignedExistingUsers.map(async (assignment) => {
          try {
            const assignedUser = await User.findById(assignment.userId);
            if (assignedUser && company && adminUser) {
              const simData = {
                _id: null, // We don't have the SIM ID after insertMany
                mobileNumber: assignment.simMobileNumber,
                operator: assignment.simOperator,
                status: 'active',
              };
              await notificationHelper.notifySimAssigned(simData, assignedUser, adminUser, company);
            }
          } catch (emailError) {
            console.error(`[BULK UPLOAD] Failed to send SIM assignment email to user ${assignment.userId}:`, emailError.message);
            return { success: false, userId: assignment.userId, error: emailError.message };
          }
          return { success: true, userId: assignment.userId };
        });

        const assignmentResults = await Promise.allSettled(assignmentPromises);
        const assignmentEmailsFailed = assignmentResults.filter(r => r.status === 'rejected' || (r.value && !r.value.success)).length;

        if (assignmentEmailsFailed > 0) {
          console.log(`[BULK UPLOAD] SIM assignment emails sent: ${assignedExistingUsers.length - assignmentEmailsFailed}, failed: ${assignmentEmailsFailed}`);
        }
      } catch (emailError) {
        console.error('[BULK UPLOAD] Error sending SIM assignment emails:', emailError.message);
        // Don't fail the upload if emails fail
      }
    }

    // [BULK UPLOAD FIX] Build response with assigned user names
    const insertedSims = result.map((sim, index) => ({
      _id: sim._id,
      mobileNumber: sim.mobileNumber,
      operator: sim.operator,
      status: sim.status,
      assignedTo: sim.assignedTo,
      // [BULK UPLOAD FIX] Include assigned user name in response
      assignedToName: simsToInsert[index]._assignedToName || null
    }));

    return {
      inserted: result.length,
      total: simsData.length,
      // [BULK UPLOAD FIX] Include created users and sim details in response
      createdUsers: createdUsers,
      sims: insertedSims,
      // [BULK UPLOAD EMAIL FIX] Include email failure count
      emailsFailed,
    };
  }

  async bulkImport(file, user, companyId) {
    const targetCompanyId = user.role === 'super_admin' ? companyId : user.companyId;

    if (!targetCompanyId) {
      throw new ForbiddenError('Company ID is required');
    }

    // Read Excel file
    const workbook = xlsx.readFile(file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(sheet);

    const results = {
      success: [],
      failed: [],
      total: data.length,
      // [BULK UPLOAD FIX] Track created users for response
      createdUsers: [],
      // [SIM ASSIGNMENT EMAIL] Track existing users who were assigned SIMs
      assignedExistingUsers: [],
    };

    // Track per-user SIM count within this batch for assignment limit validation
    const batchUserAssignmentCount = {};

    for (const row of data) {
      try {
        const countryCode = row['Country Code'] || row.countryCode || row.country_code || '+91';
        const mobileNumberRaw = row['Contact Number'] || row.mobileNumber || row.mobile_number;
        const assignedUserEmail = row['User Email'] || row['Assigned User Email'] || row.assignedUserEmail || row.assigned_user_email || '';
        // [BULK UPLOAD FIX] Read additional user fields from Excel
        const assignedUserName = row['User Name'] || row['Assigned User Name'] || row.assignedUserName || row.assigned_user_name || '';
        const assignedUserPhone = row['User Contact Number'] || row['Assigned User Phone'] || row.assignedUserPhone || row.assigned_user_phone || '';

        // Combine country code with Contact Number
        const mobileNumber = countryCode + mobileNumberRaw;

        const simData = {
          mobileNumber: mobileNumber,
          operator: row['Operator'] || row.operator || 'Jio',
          circle: row['Circle'] || row.circle || '',
          simOwnerName: row['SIM Owner Name'] || row.simOwnerName || row.sim_owner_name || '',
          notes: row['Notes'] || row.notes || '',
          status: row['Status'] || row.status || 'active',
          companyId: targetCompanyId,
          createdBy: user.id,
        };

        // [BULK UPLOAD FIX] Track assigned user name for response
        let assignedToName = null;

        if (!mobileNumberRaw) {
          throw new Error('Missing Contact Number');
        }

        // Check duplicates
        const existing = await Sim.findOne({
          mobileNumber: simData.mobileNumber,
          companyId: targetCompanyId,
        });

        if (existing) {
          throw new Error('Contact Number already exists');
        }

        // [GLOBAL UNIQUE EMAIL] Handle assigned user - create if not exists
        if (assignedUserEmail && assignedUserEmail.trim() !== '') {
          const email = assignedUserEmail.toLowerCase();
          // [HARD DELETE] Removed isActive: true filter - users are now hard deleted
          const existingUser = await User.findOne({
            email: email,
          });

          if (existingUser) {
            // [GLOBAL UNIQUE EMAIL] Email exists - check if it belongs to THIS company
            if (existingUser.companyId && existingUser.companyId.toString() === targetCompanyId.toString()) {
              // User exists in this company - use existing
              simData.assignedTo = existingUser._id;
              assignedToName = existingUser.name;
              // [SIM ASSIGNMENT EMAIL] Track existing users who were assigned SIMs
              results.assignedExistingUsers.push({
                userId: existingUser._id,
                simMobileNumber: simData.mobileNumber,
                simOperator: simData.operator,
              });
            } else {
              // Email exists in another company - NOT ALLOWED
              throw new Error(`Email "${email}" is already registered in the system. Each email can only be used once.`);
            }
          } else {
            // [BULK UPLOAD FIX] User does not exist - create new user
            const userName = assignedUserName;
            const userPhone = assignedUserPhone || null;

            // [BULK UPLOAD FIX] Name is required when creating new user
            if (!userName || userName.trim() === '') {
              throw new Error('Assigned User Name is required when creating new user');
            }

            // [OTP EMAIL FIX] - Normalize phone number for mobile login (moved outside try for catch block access)
            let normalizedPhone = userPhone;
            if (userPhone) {
              normalizedPhone = userPhone.replace(/[\s-]/g, '');
              if (/^\d{10}$/.test(normalizedPhone)) {
                normalizedPhone = '+91' + normalizedPhone;
              }
              if (/^91\d{10}$/.test(normalizedPhone)) {
                normalizedPhone = '+' + normalizedPhone;
              }
            }

            try {
              // [BULK UPLOAD FIX] Create new user with provided name
              const newUser = new User({
                email: email,
                name: userName.trim(),
                phone: userPhone,
                mobileNumber: normalizedPhone, // [OTP EMAIL FIX] - Set mobileNumber for OTP login
                role: 'user',
                companyId: targetCompanyId,
                isActive: true,
                emailVerified: false,
              });

              await newUser.save();

              // [BULK UPLOAD FIX] Track created user for response
              results.createdUsers.push({
                email: email,
                name: userName.trim(),
                userId: newUser._id
              });

              simData.assignedTo = newUser._id;
              assignedToName = userName.trim();
            } catch (userCreateError) {
              // [GLOBAL UNIQUE EMAIL] Handle duplicate email error
              if (userCreateError.code === 11000) {
                // Duplicate key error - email already exists somewhere in the system
                const existingUser = await User.findOne({ email: email });

                if (existingUser) {
                  // Check if existing user belongs to this company
                  if (existingUser.companyId && existingUser.companyId.toString() === targetCompanyId.toString()) {
                    // User exists in THIS company - use existing user
                    simData.assignedTo = existingUser._id;
                    assignedToName = existingUser.name;
                  } else {
                    // [GLOBAL UNIQUE EMAIL] Email exists in another company - NOT ALLOWED
                    throw new Error(`Email "${email}" is already registered in the system. Each email can only be used once.`);
                  }
                } else {
                  // Shouldn't happen, but handle gracefully
                  throw new Error(`Email "${email}" is already registered in the system. Please use a different email.`);
                }
              } else {
                throw new Error(`Failed to create user: ${userCreateError.message}`);
              }
            }
          }
        }

        // Check SIM assignment limit (max 2 per user) for this assigned user
        if (simData.assignedTo) {
          const userIdStr = simData.assignedTo.toString();
          const currentCount = await Sim.countDocuments({ assignedTo: simData.assignedTo });
          const batchCount = batchUserAssignmentCount[userIdStr] || 0;
          if (currentCount + batchCount >= 2) {
            const totalCount = currentCount + batchCount;
            throw new Error(`User is already assigned to ${totalCount} SIM${totalCount > 1 ? 's' : ''}. Maximum 2 SIMs allowed per user.`);
          }
          batchUserAssignmentCount[userIdStr] = batchCount + 1;
        }

        const sim = new Sim(simData);
        await sim.save();

        // [BULK UPLOAD FIX] Include assigned user name in success response
        results.success.push({
          _id: sim._id,
          mobileNumber: sim.mobileNumber,
          operator: sim.operator,
          status: sim.status,
          assignedTo: sim.assignedTo,
          assignedToName: assignedToName,
        });
      } catch (error) {
        results.failed.push({
          row,
          error: error.message,
        });
      }
    }

    // Update company stats
    await this.updateCompanyStats(targetCompanyId);

    // [BULK UPLOAD EMAIL FIX] Send welcome emails to newly created users
    if (results.createdUsers.length > 0) {
      try {
        // Get company info for email
        const company = await Company.findById(targetCompanyId);

        // Send welcome emails asynchronously using Promise.allSettled
        const emailPromises = results.createdUsers.map(async (createdUser) => {
          try {
            // Get full user object for email
            const user = await User.findById(createdUser.userId);
            if (user && company) {
              // Send welcome email (auto-generated password for new users)
              const autoPassword = crypto.randomBytes(8).toString('hex');
              await notificationHelper.notifyUserCreated(user, company, autoPassword);
            }
          } catch (emailError) {
            console.error(`[BULK IMPORT] Failed to send welcome email to ${createdUser.email}:`, emailError.message);
            return { success: false, email: createdUser.email, error: emailError.message };
          }
          return { success: true, email: createdUser.email };
        });

        const emailResults = await Promise.allSettled(emailPromises);
        results.emailsFailed = emailResults.filter(r => r.status === 'rejected' || (r.value && !r.value.success)).length;

        if (results.emailsFailed > 0) {
          console.log(`[BULK IMPORT] Welcome emails sent: ${results.createdUsers.length - results.emailsFailed}, failed: ${results.emailsFailed}`);
        }
      } catch (emailError) {
        console.error('[BULK IMPORT] Error sending welcome emails:', emailError.message);
        // Don't fail the import if emails fail
      }
    }

    // [SIM ASSIGNMENT EMAIL] Send SIM assignment notifications to existing users
    if (results.assignedExistingUsers.length > 0) {
      try {
        const company = await Company.findById(targetCompanyId);
        const adminUser = await User.findById(user.id);

        const assignmentPromises = results.assignedExistingUsers.map(async (assignment) => {
          try {
            const assignedUser = await User.findById(assignment.userId);
            if (assignedUser && company && adminUser) {
              const simData = {
                _id: null,
                mobileNumber: assignment.simMobileNumber,
                operator: assignment.simOperator,
                status: 'active',
              };
              await notificationHelper.notifySimAssigned(simData, assignedUser, adminUser, company);
            }
          } catch (emailError) {
            console.error(`[BULK IMPORT] Failed to send SIM assignment email to user ${assignment.userId}:`, emailError.message);
            return { success: false, userId: assignment.userId, error: emailError.message };
          }
          return { success: true, userId: assignment.userId };
        });

        const assignmentResults = await Promise.allSettled(assignmentPromises);
        const assignmentEmailsFailed = assignmentResults.filter(r => r.status === 'rejected' || (r.value && !r.value.success)).length;

        if (assignmentEmailsFailed > 0) {
          console.log(`[BULK IMPORT] SIM assignment emails sent: ${results.assignedExistingUsers.length - assignmentEmailsFailed}, failed: ${assignmentEmailsFailed}`);
        }
      } catch (emailError) {
        console.error('[BULK IMPORT] Error sending SIM assignment emails:', emailError.message);
        // Don't fail the import if emails fail
      }
    }

    // Cleanup file
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }

    return results;
  }

  async getAllSims(query, user) {
    const {
      page = 1,
      limit = 10,
      search,
      status,
      operator,
      assignedTo,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    // [HARD DELETE] Removed isActive: true filter - SIMs are hard deleted
    const filter = {};

    // Data isolation
    let companyId = null;
    if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
      companyId = user.companyId;
    } else if (query.companyId) {
      filter.companyId = query.companyId;
      companyId = query.companyId;
    }

    // [SEARCH BY ASSIGNED USER] - Find users matching search to include in SIM filter
    let matchedUserIds = [];
    if (search) {
      // Find users whose name matches the search term (within the same company)
      const userQuery = { name: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } };
      if (companyId) {
        userQuery.companyId = companyId;
      }
      const matchedUsers = await User.find(userQuery).select('_id');
      matchedUserIds = matchedUsers.map(u => u._id);
    }

    // [PHONE SEARCH FIX] - Escape special regex characters in search
    if (search) {
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchConditions = [
        { mobileNumber: { $regex: escapedSearch, $options: 'i' } },
        { operator: { $regex: escapedSearch, $options: 'i' } },
      ];
      // [ASSIGNED USER SEARCH] - Also search by assigned user name
      if (matchedUserIds.length > 0) {
        searchConditions.push({ assignedTo: { $in: matchedUserIds } });
      }
      filter.$or = searchConditions;
    }

    if (status) filter.status = status;
    if (operator) filter.operator = operator;
    if (assignedTo) filter.assignedTo = assignedTo;
    if (assignedTo === 'unassigned') filter.assignedTo = null;

    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const sims = await Sim.find(filter)
      .populate('assignedTo', 'name email')
      .populate('companyId', 'name')
      .skip(skip)
      .limit(parseInt(limit))
      .sort(sort);

    const total = await Sim.countDocuments(filter);

    // [WHATSAPP/TELEGRAM TOGGLE SYNC] - Fetch latest active status from message logs
    let simsDerivedStatus = sims;
    if (companyId && sims.length > 0) {
      simsDerivedStatus = await this.enrichSimsWithMessagingStatus(sims, companyId);
    }

    return { data: simsDerivedStatus, total, page: parseInt(page), limit: parseInt(limit) };
  }

  /**
   * [WHATSAPP/TELEGRAM TOGGLE SYNC]
   * Enrich SIMs with their latest WhatsApp/Telegram active status from message logs
   * @param {Array} sims - Array of SIM documents
   * @param {ObjectId} companyId - Company ID
   * @returns {Array} - SIMs with derived whatsappActiveStatus and telegramActiveStatus
   */
  async enrichSimsWithMessagingStatus(sims, companyId) {
    const simIds = sims.map(s => s._id);

    // [PHONE NUMBER FIX] - Get all WhatsApp messages for this company and match in JS
    // This handles phone number format variations (with/without +, country codes, etc.)
    const whatsappMessages = await WhatsAppMessage.find({
      companyId: new mongoose.Types.ObjectId(companyId),
      isActive: { $ne: null }, // Only consider messages with definitive isActive status
    }).sort({ sentAt: -1 }).lean();

    // Build a map by last 10 digits of phone number
    const whatsappMap = {};
    whatsappMessages.forEach(msg => {
      const last10Digits = msg.phoneNumber.replace(/\D/g, '').slice(-10);
      if (!whatsappMap[last10Digits]) {
        whatsappMap[last10Digits] = { isActive: msg.isActive, lastMessageAt: msg.sentAt };
      }
    });

    // Get latest Telegram message for each SIM
    const telegramPipeline = [
      {
        $match: {
          companyId: new mongoose.Types.ObjectId(companyId),
          simId: { $in: simIds.map(id => new mongoose.Types.ObjectId(id)) },
          isActive: { $ne: null }, // Only consider messages with definitive isActive status
        }
      },
      {
        $sort: { sentAt: -1 }
      },
      {
        $group: {
          _id: '$simId',
          isActive: { $first: '$isActive' },
          lastMessageAt: { $first: '$sentAt' }
        }
      }
    ];

    const telegramStatuses = await TelegramMessage.aggregate(telegramPipeline);
    const telegramMap = {};
    telegramStatuses.forEach(t => {
      telegramMap[t._id.toString()] = { isActive: t.isActive, lastMessageAt: t.lastMessageAt };
    });

    // Enrich SIMs with derived status
    return sims.map(sim => {
      const simObj = sim.toObject ? sim.toObject() : sim;

      // [PHONE NUMBER FIX] - WhatsApp: Match by last 10 digits of phone number
      const simLast10Digits = sim.mobileNumber.replace(/\D/g, '').slice(-10);
      const whatsappStatus = whatsappMap[simLast10Digits];
      simObj.whatsappActiveStatus = whatsappStatus ? whatsappStatus.isActive : false;
      simObj.whatsappLastMessageAt = whatsappStatus ? whatsappStatus.lastMessageAt : null;

      // Telegram: Check by SIM ID, default to false if no message found
      const telegramStatus = telegramMap[sim._id.toString()];
      simObj.telegramActiveStatus = telegramStatus ? telegramStatus.isActive : false;
      simObj.telegramLastMessageAt = telegramStatus ? telegramStatus.lastMessageAt : null;

      return simObj;
    });
  }

  async getSimById(simId, user) {
    // [HARD DELETE] Removed isActive: true filter - SIMs are hard deleted
    const filter = { _id: simId };

    if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    }

    const sim = await Sim.findOne(filter)
      .populate('assignedTo', 'name email phone')
      .populate('companyId', 'name email');

    if (!sim) {
      throw new NotFoundError('SIM');
    }

    return sim;
  }

  async updateSim(simId, updateData, user) {
    // [HARD DELETE] Removed isActive: true filter - SIMs are hard deleted
    const filter = { _id: simId };

    if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    }

    const allowedUpdates = ['mobileNumber', 'operator', 'circle', 'assignedTo', 'status', 'plan', 'notes', 'tags', 'isAdminCaller', 'simOwnerName'];
    const updates = {};

    Object.keys(updateData).forEach((key) => {
      if (allowedUpdates.includes(key)) {
        updates[key] = updateData[key];
      }
    });

    // [SIM ASSIGNMENT EMAIL FIX] Get SIM BEFORE update to track assignment changes
    const simBeforeUpdate = await Sim.findOne(filter).populate('assignedTo', 'name email');
    if (!simBeforeUpdate) {
      throw new NotFoundError('SIM');
    }

    const previousAssignedUser = simBeforeUpdate.assignedTo;
    const previousAssignedToId = previousAssignedUser ? previousAssignedUser._id.toString() : null;

    // Validate assignedTo if provided
    let newAssignedUser = null;
    if (updates.assignedTo !== undefined && updates.assignedTo !== null && updates.assignedTo !== '') {
      const assignedUser = await User.findById(updates.assignedTo);
      const companyIdForCheck = user.role === 'super_admin' ? filter.companyId : user.companyId;
      if (!assignedUser || (companyIdForCheck && assignedUser.companyId.toString() !== companyIdForCheck.toString())) {
        throw new ValidationError('Invalid user assignment. User must belong to the same company.');
      }
      newAssignedUser = assignedUser;
      // Check SIM assignment limit (max 2 per user), exclude current SIM from count
      await this.validateSimAssignmentLimit(updates.assignedTo, simId);
    }

    // Handle empty string as unassign
    if (updates.assignedTo === '') {
      updates.assignedTo = null;
    }

    if (updates.status === 'inactive') {
      updates.deactivationDate = new Date();
    }

    const sim = await Sim.findOneAndUpdate(filter, updates, {
      new: true,
      runValidators: true,
    }).populate('assignedTo', 'name email');

    if (!sim) {
      throw new NotFoundError('SIM');
    }

    // [SIM ASSIGNMENT EMAIL FIX] Send notifications for assignment changes
    const newAssignedToId = updates.assignedTo !== undefined
      ? (updates.assignedTo === null || updates.assignedTo === '' ? null : updates.assignedTo.toString())
      : previousAssignedToId;

    // Check if assignment changed
    const isAssignmentChanged = (previousAssignedToId !== newAssignedToId) && updates.assignedTo !== undefined;

    if (isAssignmentChanged) {
      try {
        const company = await Company.findById(sim.companyId);
        const adminUser = await User.findById(user.id);

        // Case 1: Unassigned (previous user exists, new is null)
        if (previousAssignedUser && newAssignedToId === null) {
          await notificationHelper.notifySimUnassigned(sim, previousAssignedUser, adminUser, company);
        }
        // Case 2: Assigned to new user (no previous user)
        else if (!previousAssignedUser && newAssignedUser) {
          await notificationHelper.notifySimAssigned(sim, newAssignedUser, adminUser, company);
        }
        // Case 3: Reassigned from one user to another
        else if (previousAssignedUser && newAssignedUser) {
          // Send unassignment notification to previous user
          await notificationHelper.notifySimUnassigned(sim, previousAssignedUser, adminUser, company);
          // Send assignment notification to new user
          await notificationHelper.notifySimAssigned(sim, newAssignedUser, adminUser, company);
        }
      } catch (notificationError) {
        console.error('Failed to send SIM assignment/unassignment notification:', notificationError.message);
      }
    }

    return sim;
  }

  async deleteSim(simId, user) {
    const filter = { _id: simId };

    if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    }

    const sim = await Sim.findOneAndDelete(filter);

    if (!sim) {
      throw new NotFoundError('SIM');
    }

    // Update company stats
    const companyId = sim.companyId;
    await this.updateCompanyStats(companyId);

    // [AUDIT LOG FIX] Return the deleted SIM document so the controller can access
    // sim.companyId, sim._id, sim.mobileNumber for the audit log
    return sim;
  }

  async updateStatus(simId, status, user) {
    // [HARD DELETE] Removed isActive: true filter - SIMs are hard deleted
    const filter = { _id: simId };

    if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    }

    const updates = { status };
    if (status === 'inactive') {
      updates.deactivationDate = new Date();
    } else if (status === 'active') {
      updates.activationDate = new Date();
      updates.lastActiveDate = new Date();
    }

    const sim = await Sim.findOneAndUpdate(filter, updates, { new: true });

    if (!sim) {
      throw new NotFoundError('SIM');
    }

    return sim;
  }

  async assignSim(simId, userId, user) {
    // [HARD DELETE] Removed isActive: true filter - SIMs are hard deleted
    const filter = { _id: simId };

    if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    }

    // Verify user exists and belongs to same company
    const targetUser = await User.findById(userId);
    if (!targetUser || (user.role !== 'super_admin' && targetUser.companyId.toString() !== user.companyId.toString())) {
      throw new NotFoundError('User');
    }

    // Check SIM assignment limit (max 2 per user), exclude current SIM from count
    await this.validateSimAssignmentLimit(userId, simId);

    const sim = await Sim.findOneAndUpdate(
      filter,
      { assignedTo: userId },
      { new: true }
    ).populate('assignedTo', 'name email');

    if (!sim) {
      throw new NotFoundError('SIM');
    }

    // Send notification to assigned user
    try {
      const company = await Company.findById(sim.companyId);
      await notificationHelper.notifySimAssigned(sim, targetUser, user, company);
    } catch (notificationError) {
      // Don't fail assignment if notification fails
      console.error('Failed to send SIM assignment notification:', notificationError.message);
    }

    return sim;
  }

  async unassignSim(simId, user) {
    // [HARD DELETE] Removed isActive: true filter - SIMs are hard deleted
    const filter = { _id: simId };

    if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    }

    // Get the SIM with assigned user before updating
    const simBeforeUpdate = await Sim.findOne(filter).populate('assignedTo', 'name email');
    if (!simBeforeUpdate) {
      throw new NotFoundError('SIM');
    }

    const previousUser = simBeforeUpdate.assignedTo;

    const sim = await Sim.findOneAndUpdate(
      filter,
      { assignedTo: null },
      { new: true }
    );

    // Send notification to previously assigned user
    if (previousUser) {
      try {
        const company = await Company.findById(sim.companyId);
        await notificationHelper.notifySimUnassigned(sim, previousUser, user, company);
      } catch (notificationError) {
        // Don't fail unassignment if notification fails
        console.error('Failed to send SIM unassignment notification:', notificationError.message);
      }
    }

    return sim;
  }

  async exportSims(query, user) {
    const { search, status, operator } = query;

    // [HARD DELETE] Removed isActive: true filter - SIMs are hard deleted
    const filter = {};

    if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    } else if (query.companyId) {
      filter.companyId = query.companyId;
    }

    // [PHONE SEARCH FIX] - Escape special regex characters in search
    if (search) {
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { mobileNumber: { $regex: escapedSearch, $options: 'i' } },
        { operator: { $regex: escapedSearch, $options: 'i' } },
      ];
    }

    if (status) filter.status = status;
    if (operator) filter.operator = operator;

    const sims = await Sim.find(filter)
      .populate('assignedTo', 'name email phoneNumber')
      .populate('companyId', 'name')
      .sort({ createdAt: -1 });

    return sims;
  }

  async getSimStats(companyId) {
    // [HARD DELETE] Removed isActive: true filter - SIMs are hard deleted
    const totalSims = await Sim.countDocuments({ companyId });
    const activeSims = await Sim.countDocuments({ companyId, status: 'active' });
    const inactiveSims = await Sim.countDocuments({ companyId, status: 'inactive' });

    const operatorStats = await Sim.aggregate([
      { $match: { companyId: companyId } },
      { $group: { _id: '$operator', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    return {
      total: totalSims,
      active: activeSims,
      inactive: inactiveSims,
      byOperator: operatorStats,
    };
  }

  async updateCompanyStats(companyId) {
    // [HARD DELETE] Removed isActive: true filter - SIMs are hard deleted
    const totalSims = await Sim.countDocuments({ companyId });
    const activeSims = await Sim.countDocuments({ companyId, status: 'active' });

    await Company.findByIdAndUpdate(companyId, {
      'stats.totalSims': totalSims,
      'stats.activeSims': activeSims,
    });
  }

  async generateImportTemplate() {
    const template = [
      {
        'Country Code': '+91',
        'Contact Number': '9876543210',
        'Operator': 'Jio',
        'Circle': 'Maharashtra',
        'SIM Owner Name': 'Jane Smith',
        'Status': 'active',
        'User Email': 'user@example.com',
        // [BULK UPLOAD FIX] Added columns for new user creation
        'User Name': 'John Doe',
        'User Contact Number': '+919876543210',
        'Notes': 'Optional notes',
      },
    ];

    const workbook = xlsx.utils.book_new();
    const sheet = xlsx.utils.json_to_sheet(template);
    xlsx.utils.book_append_sheet(workbook, sheet, 'SIM Import');

    return workbook;
  }

  async updateMessagingStatus(simId, platform, enabled, user) {
    const validPlatforms = ['whatsapp', 'telegram'];
    if (!validPlatforms.includes(platform)) {
      throw new ValidationError('Invalid platform. Use whatsapp or telegram');
    }

    const filter = { _id: simId };
    if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    }

    const updateField = `${platform}Enabled`;
    const lastActiveField = `${platform}LastActive`;

    const sim = await Sim.findOneAndUpdate(
      filter,
      {
        [updateField]: enabled,
        [lastActiveField]: enabled ? new Date() : null,
      },
      { new: true }
    ).populate('companyId', 'name').populate('assignedTo', 'name email');

    if (!sim) {
      throw new NotFoundError('SIM');
    }

    return sim;
  }

  async getMessagingStats(companyId) {
    // [HARD DELETE] Removed isActive: true filter - SIMs are now hard deleted
    const sims = await Sim.find({ companyId: new mongoose.Types.ObjectId(companyId) })
      .select('mobileNumber whatsappEnabled telegramEnabled whatsappLastActive telegramLastActive');

    const simIds = sims.map(s => s._id);

    // [PHONE NUMBER FIX] - Get all WhatsApp messages and match by last 10 digits
    const whatsappMessages = await WhatsAppMessage.find({
      companyId: new mongoose.Types.ObjectId(companyId),
      isActive: { $ne: null },
    }).sort({ sentAt: -1 }).lean();

    // Build a map by last 10 digits of phone number
    const whatsappMap = {};
    whatsappMessages.forEach(msg => {
      const last10Digits = msg.phoneNumber.replace(/\D/g, '').slice(-10);
      if (!whatsappMap[last10Digits]) {
        whatsappMap[last10Digits] = msg.isActive;
      }
    });

    // Get latest Telegram active status per SIM
    const telegramPipeline = [
      {
        $match: {
          companyId: new mongoose.Types.ObjectId(companyId),
          simId: { $in: simIds.map(id => new mongoose.Types.ObjectId(id)) },
          isActive: { $ne: null },
        }
      },
      { $sort: { sentAt: -1 } },
      {
        $group: {
          _id: '$simId',
          isActive: { $first: '$isActive' }
        }
      }
    ];
    const telegramStatuses = await TelegramMessage.aggregate(telegramPipeline);
    const telegramMap = {};
    telegramStatuses.forEach(t => {
      telegramMap[t._id.toString()] = t.isActive;
    });

    // Calculate stats based on derived status
    let whatsappActive = 0;
    let telegramActive = 0;
    let bothActive = 0;
    let neitherActive = 0;

    const simsDerivedStatus = sims.map(sim => {
      // [PHONE NUMBER FIX] - Match by last 10 digits
      const simLast10Digits = sim.mobileNumber.replace(/\D/g, '').slice(-10);
      const whatsappActiveStatus = whatsappMap[simLast10Digits] === true;
      const telegramActiveStatus = telegramMap[sim._id.toString()] === true;

      if (whatsappActiveStatus) whatsappActive++;
      if (telegramActiveStatus) telegramActive++;
      if (whatsappActiveStatus && telegramActiveStatus) bothActive++;
      if (!whatsappActiveStatus && !telegramActiveStatus) neitherActive++;

      return {
        _id: sim._id,
        mobileNumber: sim.mobileNumber,
        whatsapp: {
          enabled: whatsappActiveStatus,
          lastActive: sim.whatsappLastActive,
        },
        telegram: {
          enabled: telegramActiveStatus,
          lastActive: sim.telegramLastActive,
        },
      };
    });

    // Also get "recently active" stats (active in last 24 hours)
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setDate(twentyFourHoursAgo.getDate() - 1);

    const whatsappActiveRecently = sims.filter(s =>
      s.whatsappLastActive && s.whatsappLastActive >= twentyFourHoursAgo
    ).length;

    const telegramActiveRecently = sims.filter(s =>
      s.telegramLastActive && s.telegramLastActive >= twentyFourHoursAgo
    ).length;

    return {
      total: sims.length,
      whatsapp: {
        enabled: whatsappActive,
        activeRecently: whatsappActiveRecently,
      },
      telegram: {
        enabled: telegramActive,
        activeRecently: telegramActiveRecently,
      },
      both: bothActive,
      neither: neitherActive,
      sims: simsDerivedStatus,
    };
  }

  /**
   * Get SIMs assigned to the logged-in user
   * [MULTI-SIM SUPPORT] - For mobile app to get user's assigned SIMs
   */
  async getAssignedSims(user) {
    // [HARD DELETE] Removed isActive: true filter - SIMs are now hard deleted
    const filter = {
      assignedTo: user._id,
      companyId: user.companyId,
      status: 'active',
    };

    const sims = await Sim.find(filter)
      .select('_id mobileNumber operator circle status')
      .sort({ createdAt: -1 });

    return sims;
  }
}

module.exports = new SimService();