const userService = require('../../services/user/user.service');
const auditLogService = require('../../services/auditLog/auditLog.service');
const { successResponse, errorResponse, paginatedResponse } = require('../../utils/response');

class UserController {
  async getAll(req, res, next) {
    try {
      const result = await userService.getUsers(req.query, req.user);
      return paginatedResponse(res, result.data, result.total, result.page, result.limit, 'Users fetched successfully');
    } catch (error) {
      next(error);
    }
  }

  async getById(req, res, next) {
    try {
      const user = await userService.getUserById(req.params.id, req.user);
      return successResponse(res, user, 'User fetched successfully');
    } catch (error) {
      next(error);
    }
  }

  async create(req, res, next) {
    try {
      const user = await userService.createUser(req.body, req.user);

      // Audit log: USER_CREATE
      await auditLogService.logAction({
        action: 'USER_CREATE',
        module: 'USER',
        description: `Created user ${user.name} (${user.email})`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: user.companyId,
        entityId: user._id,
        entityType: 'USER',
        metadata: { email: user.email, role: user.role },
        req,
      });

      return successResponse(res, user, 'User created successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  async update(req, res, next) {
    try {
      const { user, originalValues } = await userService.updateUser(req.params.id, req.body, req.user);

      // Audit log: USER_UPDATE
      await auditLogService.logAction({
        action: 'USER_UPDATE',
        module: 'USER',
        description: `Updated user ${user.name} (${user.email})`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: user.companyId,
        entityId: user._id,
        entityType: 'USER',
        metadata: {
          previousValues: originalValues,
          newValues: req.body,
        },
        req,
      });

      return successResponse(res, user, 'User updated successfully.');
    } catch (error) {
      next(error);
    }
  }

  async delete(req, res, next) {
    try {
      const user = await userService.deleteUser(req.params.id, req.user);

      // Audit log: USER_DELETE
      await auditLogService.logAction({
        action: 'USER_DELETE',
        module: 'USER',
        description: `Deleted user ${user.name} (${user.email})`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: user.companyId,
        entityId: user._id,
        entityType: 'USER',
        metadata: { email: user.email, userName: user.name },
        req,
      });

      return successResponse(res, null, 'User deleted successfully.');
    } catch (error) {
      next(error);
    }
  }

  async resetPassword(req, res, next) {
    try {
      const user = await userService.resetUserPassword(req.params.id, req.body.password, req.user);

      // Audit log: USER_PASSWORD_RESET
      await auditLogService.logAction({
        action: 'USER_PASSWORD_RESET',
        module: 'USER',
        description: `Reset password for user ${user.name} (${user.email})`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: user.companyId,
        entityId: user._id,
        entityType: 'USER',
        metadata: { email: user.email, userName: user.name },
        req,
      });

      return successResponse(res, null, 'Password reset successfully');
    } catch (error) {
      next(error);
    }
  }

  async getCompanyUsers(req, res, next) {
    try {
      const users = await userService.getCompanyUsers(req.user.companyId);
      return successResponse(res, users, 'Company users fetched successfully');
    } catch (error) {
      next(error);
    }
  }

  async getStats(req, res, next) {
    try {
      const stats = await userService.getUserStats(req.user.companyId);
      return successResponse(res, stats, 'User stats fetched successfully');
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new UserController();