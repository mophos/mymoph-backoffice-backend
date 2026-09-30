import { StatusCodes } from 'http-status-codes';
import type { AuthContext } from '../../shared/types/auth';
import { UserRoleManagementModel, type OfficeCode } from './user-role-management.model';

/** รูปแบบผลลัพธ์เมื่อการตรวจขอบเขตไม่ผ่าน ใช้ส่งกลับเป็น response ได้ตรง ๆ */
interface ScopeError {
  ok: false;
  status: number;
  error: string;
  message?: string;
  missingHospcodes?: string[];
  deniedHospcodes?: string[];
}

interface AdminUpsertInput {
  cid: string;
  roleCodes: string[];
  hospcodes: string[];
}

const FINANCE_ADMIN_ROLE_CODE = 'admin_affairs';
const FINANCE_PAGE_REQUIRED_ROLE = 'super_admin_affairs';

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
    const scopeInput = await this.resolveScopeInput(actor, input.hospcodes, input.roleCodes);
    if (!scopeInput.ok) return scopeInput;

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
      offices: scopeInput.offices,
      updatedBy: actor.userId
    });

    return { ok: true, status: StatusCodes.CREATED, data: { userId: user.id } };
  }

  async update(actor: AuthContext, userId: string, input: AdminUpsertInput) {
    const targetCheck = await this.validateTargetInScope(actor, userId);
    if (!targetCheck.ok) return targetCheck;

    const scopeInput = await this.resolveScopeInput(actor, input.hospcodes, input.roleCodes);
    if (!scopeInput.ok) return scopeInput;

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

    // ADMIN-01: ไม่ upsert ตาม CID ที่ส่งมา เพราะบัญชีเป้าหมายระบุด้วย userId อยู่แล้ว
    // ของเดิมเรียก upsertUserByCid แยกจาก userId ทำให้การแก้ CID ในฟอร์ม
    // ไปสร้างบัญชีใหม่ตาม CID นั้น แล้วเอา Role/Scope ไปลงที่ userId เดิม
    // เกิดบัญชีค้างที่ไม่มีใครใช้ และ upsert ยังตั้ง is_active = 1 ให้บัญชีที่ถูกปิดไว้ด้วย
    if (input.cid && String(user.cid ?? '') !== input.cid) {
      return {
        ok: false,
        status: StatusCodes.BAD_REQUEST,
        error: 'CID_MISMATCH',
        message: 'เลขบัตรประชาชนไม่ตรงกับบัญชีเป้าหมาย การแก้เลขบัตรต้องทำผ่านการปิดบัญชีเดิมแล้วเพิ่มใหม่'
      };
    }

    await this.model.syncUserRoles({
      userId,
      roleIds,
      assignedBy: actor.userId
    });

    await this.model.replaceUserScopes({
      userId,
      offices: scopeInput.offices,
      updatedBy: actor.userId
    });

    return { ok: true, status: StatusCodes.OK };
  }

  async deactivate(actor: AuthContext, userId: string, roleCode?: string) {
    if (actor.scopeType !== 'ALL' && !actor.permissions.includes('role_admin.manage')) {
      return { ok: false, status: StatusCodes.FORBIDDEN, error: 'FORBIDDEN' };
    }

    const targetCheck = await this.validateTargetInScope(actor, userId);
    if (!targetCheck.ok) return targetCheck;

    return this.removeRoles(userId, roleCode, actor.userId);
  }

  async listFinanceAdmins(actor: AuthContext, query: {
    search?: string;
    page: number;
    pageSize: number;
    offset: number;
  }) {
    if (!this.hasFinanceAdminAccess(actor)) {
      return { ok: false, status: StatusCodes.FORBIDDEN, error: 'FORBIDDEN' };
    }

    const data = await this.model.listHrOfficeAdmins({
      ...query,
      roleCode: FINANCE_ADMIN_ROLE_CODE,
      actorScopeType: actor.scopeType,
      actorHospcodes: actor.hospcodes
    });

    return { ok: true, status: StatusCodes.OK, data };
  }

  async createFinanceAdmin(actor: AuthContext, input: { cid: string; hospcodes: string[] }) {
    if (!this.hasFinanceAdminAccess(actor)) {
      return { ok: false, status: StatusCodes.FORBIDDEN, error: 'FORBIDDEN' };
    }

    const scopeInput = await this.resolveScopeInput(actor, input.hospcodes, [FINANCE_ADMIN_ROLE_CODE]);
    if (!scopeInput.ok) return scopeInput;

    const role = await this.model.getRoleByCode(FINANCE_ADMIN_ROLE_CODE);
    if (!role) {
      return {
        ok: false,
        status: StatusCodes.BAD_REQUEST,
        error: 'ROLE_NOT_FOUND',
        missingRoleCodes: [FINANCE_ADMIN_ROLE_CODE]
      };
    }

    const user = await this.model.upsertUserByCid({
      cid: input.cid,
      createdBy: actor.userId
    });

    await this.model.upsertUserRole({
      userId: user.id,
      roleId: String(role.id),
      assignedBy: actor.userId
    });

    await this.model.replaceUserScopes({
      userId: user.id,
      offices: scopeInput.offices,
      updatedBy: actor.userId
    });

    return { ok: true, status: StatusCodes.CREATED, data: { userId: user.id } };
  }

  async updateFinanceAdmin(actor: AuthContext, userId: string, input: { cid: string; hospcodes: string[] }) {
    if (!this.hasFinanceAdminAccess(actor)) {
      return { ok: false, status: StatusCodes.FORBIDDEN, error: 'FORBIDDEN' };
    }

    const targetCheck = await this.validateTargetInScope(actor, userId);
    if (!targetCheck.ok) return targetCheck;

    const scopeInput = await this.resolveScopeInput(actor, input.hospcodes, [FINANCE_ADMIN_ROLE_CODE]);
    if (!scopeInput.ok) return scopeInput;

    const user = await this.model.getUserById(userId);
    if (!user) {
      return { ok: false, status: StatusCodes.NOT_FOUND, error: 'USER_NOT_FOUND' };
    }

    const role = await this.model.getRoleByCode(FINANCE_ADMIN_ROLE_CODE);
    if (!role) {
      return {
        ok: false,
        status: StatusCodes.BAD_REQUEST,
        error: 'ROLE_NOT_FOUND',
        missingRoleCodes: [FINANCE_ADMIN_ROLE_CODE]
      };
    }

    // ADMIN-01: ไม่ upsert ตาม CID ที่ส่งมา เพราะบัญชีเป้าหมายระบุด้วย userId อยู่แล้ว
    // ของเดิมเรียก upsertUserByCid แยกจาก userId ทำให้การแก้ CID ในฟอร์ม
    // ไปสร้างบัญชีใหม่ตาม CID นั้น แล้วเอา Role/Scope ไปลงที่ userId เดิม
    // เกิดบัญชีค้างที่ไม่มีใครใช้ และ upsert ยังตั้ง is_active = 1 ให้บัญชีที่ถูกปิดไว้ด้วย
    if (input.cid && String(user.cid ?? '') !== input.cid) {
      return {
        ok: false,
        status: StatusCodes.BAD_REQUEST,
        error: 'CID_MISMATCH',
        message: 'เลขบัตรประชาชนไม่ตรงกับบัญชีเป้าหมาย การแก้เลขบัตรต้องทำผ่านการปิดบัญชีเดิมแล้วเพิ่มใหม่'
      };
    }

    await this.model.upsertUserRole({
      userId,
      roleId: String(role.id),
      assignedBy: actor.userId
    });

    await this.model.replaceUserScopes({
      userId,
      offices: scopeInput.offices,
      updatedBy: actor.userId
    });

    return { ok: true, status: StatusCodes.OK };
  }

  async deactivateFinanceAdmin(actor: AuthContext, userId: string) {
    if (!this.hasFinanceAdminAccess(actor)) {
      return { ok: false, status: StatusCodes.FORBIDDEN, error: 'FORBIDDEN' };
    }

    // เดิมฟังก์ชันนี้ไม่ตรวจขอบเขตของเป้าหมายเลย ตรวจแค่บทบาทของผู้กระทำ
    const targetCheck = await this.validateTargetInScope(actor, userId);
    if (!targetCheck.ok) return targetCheck;

    return this.removeRoles(userId, FINANCE_ADMIN_ROLE_CODE, actor.userId);
  }

  /**
   * ADMIN-02: ล้างขอบเขตหน่วยงาน **เฉพาะเมื่อไม่เหลือบทบาทที่ใช้งานได้แล้ว**
   *
   * เดิมการถอดบทบาทเดียวจะล้างขอบเขตทั้งหมดของบัญชีเสมอ
   * บทบาทอื่นที่ยังเหลือจึงใช้งานไม่ได้เพราะเจอ NO_SCOPE_ASSIGNED
   * ทั้งที่ผู้กดตั้งใจถอดแค่บทบาทเดียว
   *
   * ขอบเขตเป็นของบัญชีรวมทุกบทบาท การล้างจึงต้องเกิดต่อเมื่อบัญชีนั้น
   * ไม่เหลือบทบาทใดเลย ซึ่งเท่ากับเลิกใช้ระบบจริง ๆ
   */
  private async removeRoles(userId: string, roleCode: string | undefined, actorUserId: string) {
    const remainingRoles = await this.model.deactivateUserRoles({
      userId,
      roleCode,
      updatedBy: actorUserId
    });

    const scopesCleared = remainingRoles === 0;
    if (scopesCleared) {
      await this.model.deactivateUserScopes({ userId, updatedBy: actorUserId });
    }

    return {
      ok: true,
      status: StatusCodes.OK,
      data: { remainingRoles, scopesCleared }
    };
  }

  /**
   * ADMIN-03: ตรวจว่าผู้กระทำมีสิทธิ์แตะบัญชีเป้าหมายหรือไม่
   *
   * เดิมตรวจแค่ว่า hospcode "ชุดใหม่" ที่ส่งมาอยู่ใน Scope ของผู้กระทำ
   * แต่ไม่ได้ตรวจว่าบัญชีเป้าหมายเป็นของหน่วยงานตัวเองหรือเปล่า
   * ทำให้ยิง PUT ใส่ userId ของใครก็ได้พร้อมหน่วยงานของตัวเอง แล้วยึดบัญชีนั้นมาได้
   *
   * กติกา: ผู้มี Scope ALL ผ่านเสมอ ส่วนผู้มี Scope LIST ต้องมีหน่วยงานทับซ้อน
   * กับขอบเขตปัจจุบันของเป้าหมายอย่างน้อยหนึ่งแห่ง
   *
   * ข้อยกเว้น: บัญชีที่ยังไม่มีขอบเขต active เลย ถือว่ายังไม่มีเจ้าของ จึงมอบหมายได้
   * เพื่อไม่ให้บัญชีที่เพิ่งสร้างหรือถูกปิดไปแล้วกลายเป็นบัญชีที่ไม่มีใครแก้ได้
   */
  private async validateTargetInScope(actor: AuthContext, userId: string) {
    if (actor.scopeType === 'ALL') {
      return { ok: true } as const;
    }

    const targetScopes = await this.model.getActiveScopes(userId);
    if (!targetScopes.length) {
      return { ok: true } as const;
    }

    const overlaps = targetScopes.some((hospcode) => actor.hospcodes.includes(hospcode));
    if (!overlaps) {
      return {
        ok: false,
        status: StatusCodes.FORBIDDEN,
        error: 'TARGET_OUT_OF_SCOPE',
        targetHospcodes: targetScopes
      } as const;
    }

    return { ok: true } as const;
  }

  private validateScope(actor: AuthContext, targetHospcodes: string[], roleCodes: string[]) {
    if (roleCodes.includes('super_admin') && !actor.permissions.includes('role_admin.manage')) {
      return { ok: false, status: StatusCodes.FORBIDDEN, error: 'ONLY_ROLE_ADMIN_CAN_ASSIGN_SUPER_ADMIN' };
    }

    // ADMIN-04: การบันทึกโดยไม่มีหน่วยงานจะไปล้างขอบเขตเดิมทั้งหมดผ่าน replaceUserScopes
    // ซึ่งเป็นการถอนสิทธิ์เงียบ ๆ ที่ผู้ใช้ไม่ได้ตั้งใจ จึงต้องปฏิเสธไปเลย
    // การถอนสิทธิ์ที่ตั้งใจให้ใช้เส้นทาง deactivate ซึ่งบอกผลกระทบชัดเจนกว่า
    if (!targetHospcodes.length) {
      return {
        ok: false,
        status: StatusCodes.BAD_REQUEST,
        error: 'HOSPCODES_REQUIRED',
        message: 'ต้องระบุหน่วยงานอย่างน้อยหนึ่งแห่ง หากต้องการถอนสิทธิ์ให้ใช้การปิดการใช้งานแทน'
      };
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

  /**
   * แปลงรหัสที่รับเข้ามาเป็นคู่ code5/hcode9 แล้วตรวจสิทธิ์ด้วย code5
   *
   * ต้องแปลงก่อนตรวจสิทธิ์ เพราะขอบเขตของผู้กระทำเก็บเป็น code5
   * ถ้าเอา hcode9 ที่ส่งมาไปเทียบตรง ๆ จะถูกปฏิเสธทั้งที่เป็นหน่วยงานเดียวกัน
   *
   * เดิมตรวจแค่ว่ารหัสมีอยู่ในทะเบียนไหม แล้วเขียนค่าที่รับมาลงฐานดิบ ๆ
   * การส่ง hcode9 จึงถูกบันทึกลงคอลัมน์ที่ทุกโมดูลคาดว่าเป็น code5
   * ไม่มี error ให้เห็น แต่ผู้ใช้จะมองไม่เห็นข้อมูลของหน่วยงานตัวเองเลย
   */
  private async resolveScopeInput(
    actor: AuthContext,
    hospcodes: string[],
    roleCodes: string[]
  ): Promise<{ ok: true; offices: OfficeCode[] } | ScopeError> {
    const requested = [...new Set(hospcodes.map((code) => String(code ?? '').trim()).filter(Boolean))];

    const resolved = await this.model.resolveOfficeCodes(requested);

    const missingHospcodes = requested.filter((code) => !resolved.has(code));
    if (missingHospcodes.length) {
      return {
        ok: false,
        status: StatusCodes.BAD_REQUEST,
        error: 'INVALID_HOSPCODE',
        missingHospcodes
      };
    }

    const offices = requested.map((code) => resolved.get(code)!);

    // ขอบเขตยังบันทึกเป็น code5 หน่วยงานที่ไม่มีรหัสนั้นจึงยังมอบหมายไม่ได้
    // ปฏิเสธให้ชัดดีกว่าเขียนแถวที่ทุกโมดูลกรองไม่เจอ
    const withoutCode5 = offices.filter((office) => !office.code5).map((office) => office.hcode9);
    if (withoutCode5.length) {
      return {
        ok: false,
        status: StatusCodes.BAD_REQUEST,
        error: 'OFFICE_WITHOUT_CODE5',
        missingHospcodes: withoutCode5,
        message: 'หน่วยงานนี้ยังไม่มีรหัส 5 หลัก จึงยังมอบหมายผู้ดูแลไม่ได้'
      };
    }

    const code5List = offices.map((office) => office.code5 as string);
    const validation = this.validateScope(actor, code5List, roleCodes);
    if (!validation.ok) return validation as ScopeError;

    return { ok: true, offices };
  }


  private hasFinanceAdminAccess(actor: AuthContext): boolean {
    return actor.roles.includes(FINANCE_PAGE_REQUIRED_ROLE);
  }
}
