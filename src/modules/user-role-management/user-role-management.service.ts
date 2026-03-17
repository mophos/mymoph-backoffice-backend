import { StatusCodes } from 'http-status-codes';
import type { AuthContext } from '../../shared/types/auth';
import { UserRoleManagementModel } from './user-role-management.model';

interface AdminUpsertInput {
  cid: string;
  roleCodes: string[];
  hospcodes: string[];
}

export class UserRoleManagementService {
  constructor(private readonly model: UserRoleManagementModel) {}

  async list(actor: AuthContext, query: {
    search?: string;
    roleCode?: string;
    page: number;
    pageSize: number;
    offset: number;
  }) {
    return this.model.listHrOfficeAdmins({
      ...query,
      actorScopeType: actor.scopeType,
      actorHospcodes: actor.hospcodes
    });
  }

  async create(actor: AuthContext, input: AdminUpsertInput) {
    const validation = this.validateScope(actor, input.hospcodes, input.roleCodes);
    if (!validation.ok) return validation;

    const missingHospcodes = await this.findMissingHospcodes(input.hospcodes);
    if (missingHospcodes.length) {
      return {
        ok: false,
        status: StatusCodes.BAD_REQUEST,
        error: 'INVALID_HOSPCODE',
        missingHospcodes
      };
    }

    const roles = await this.model.getRolesByCodes(input.roleCodes);
    const roleIds = roles.map((role) => role.id);
    if (roleIds.length !== input.roleCodes.length) {
      const existingCodes = new Set(roles.map((role) => String(role.code)));
      const missingRoleCodes = input.roleCodes.filter((code) => !existingCodes.has(code));
      return {
        ok: false,
        status: StatusCodes.BAD_REQUEST,
        error: 'ROLE_NOT_FOUND',
        missingRoleCodes
      };
    }

    const user = await this.model.upsertUserByCid({
      cid: input.cid,
      createdBy: actor.userId
    });

    await this.model.syncUserRoles({
      userId: user.id,
      roleIds,
      assignedBy: actor.userId
    });

    await this.model.replaceUserScopes({
      userId: user.id,
      hospcodes: input.hospcodes,
      updatedBy: actor.userId
    });

    return { ok: true, status: StatusCodes.CREATED, data: { userId: user.id } };
  }

  async update(actor: AuthContext, userId: string, input: AdminUpsertInput) {
    const validation = this.validateScope(actor, input.hospcodes, input.roleCodes);
    if (!validation.ok) return validation;

    const missingHospcodes = await this.findMissingHospcodes(input.hospcodes);
    if (missingHospcodes.length) {
      return {
        ok: false,
        status: StatusCodes.BAD_REQUEST,
        error: 'INVALID_HOSPCODE',
        missingHospcodes
      };
    }

    const user = await this.model.getUserById(userId);
    if (!user) {
      return { ok: false, status: StatusCodes.NOT_FOUND, error: 'USER_NOT_FOUND' };
    }

    const roles = await this.model.getRolesByCodes(input.roleCodes);
    const roleIds = roles.map((role) => role.id);
    if (roleIds.length !== input.roleCodes.length) {
      const existingCodes = new Set(roles.map((role) => String(role.code)));
      const missingRoleCodes = input.roleCodes.filter((code) => !existingCodes.has(code));
      return {
        ok: false,
        status: StatusCodes.BAD_REQUEST,
        error: 'ROLE_NOT_FOUND',
        missingRoleCodes
      };
    }

    await this.model.upsertUserByCid({
      cid: input.cid,
      createdBy: actor.userId
    });

    await this.model.syncUserRoles({
      userId,
      roleIds,
      assignedBy: actor.userId
    });

    await this.model.replaceUserScopes({
      userId,
      hospcodes: input.hospcodes,
      updatedBy: actor.userId
    });

    return { ok: true, status: StatusCodes.OK };
  }

  async deactivate(actor: AuthContext, userId: string, roleCode?: string) {
    if (actor.scopeType !== 'ALL' && !actor.permissions.includes('role_admin.manage')) {
      return { ok: false, status: StatusCodes.FORBIDDEN, error: 'FORBIDDEN' };
    }

    await this.model.deactivateUserRole({
      userId,
      roleCode,
      updatedBy: actor.userId
    });

    return { ok: true, status: StatusCodes.OK };
  }

  private validateScope(actor: AuthContext, targetHospcodes: string[], roleCodes: string[]) {
    if (roleCodes.includes('super_admin') && !actor.permissions.includes('role_admin.manage')) {
      return { ok: false, status: StatusCodes.FORBIDDEN, error: 'ONLY_ROLE_ADMIN_CAN_ASSIGN_SUPER_ADMIN' };
    }

    if (actor.scopeType === 'ALL') {
      return { ok: true };
    }

    const denied = targetHospcodes.filter((hospcode) => !actor.hospcodes.includes(hospcode));
    if (denied.length) {
      return {
        ok: false,
        status: StatusCodes.FORBIDDEN,
        error: 'TARGET_SCOPE_OUT_OF_BOUND',
        deniedHospcodes: denied
      };
    }

    return { ok: true };
  }

  private async findMissingHospcodes(hospcodes: string[]): Promise<string[]> {
    if (!hospcodes.length) return [];

    const uniqueHospcodes = [...new Set(hospcodes)];
    const existing = await this.model.getExistingHospcodes(uniqueHospcodes);
    const existingSet = new Set(existing);
    return uniqueHospcodes.filter((hospcode) => !existingSet.has(hospcode));
  }
}
