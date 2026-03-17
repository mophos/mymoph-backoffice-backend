import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

interface ListInput {
  search?: string;
  roleCode?: string;
  actorScopeType: 'ALL' | 'LIST';
  actorHospcodes: string[];
  page: number;
  pageSize: number;
  offset: number;
}

export class UserRoleManagementModel {
  constructor(private readonly db: Knex) {}

  async listHrOfficeAdmins(input: ListInput) {
    const base = this.db('user_roles as ur')
      .innerJoin('users as u', 'u.id', 'ur.user_id')
      .innerJoin('roles as r', 'r.id', 'ur.role_id')
      .where('ur.is_active', 1)
      .where('u.is_active', 1)
      .where('r.is_active', 1);

    if (input.roleCode) {
      base.andWhere('r.code', input.roleCode);
    }

    if (input.search) {
      base.andWhere((builder) => {
        builder
          .where('u.cid', 'like', `%${input.search}%`)
          .orWhere('u.first_name', 'like', `%${input.search}%`)
          .orWhere('u.last_name', 'like', `%${input.search}%`)
          .orWhere('u.email', 'like', `%${input.search}%`);
      });
    }

    if (input.actorScopeType === 'LIST') {
      base.whereExists((subquery) => {
        subquery
          .select(this.db.raw('1'))
          .from('user_office_scope as uos')
          .whereRaw('uos.user_id = ur.user_id')
          .where('uos.is_active', 1)
          .whereIn('uos.hospcode', input.actorHospcodes.length ? input.actorHospcodes : ['']);
      });
    }

    const [{ total }] = await base.clone().count<{ total: number }[]>({ total: '*' });

    const rows = await base
      .clone()
      .select(
        'u.id as user_id',
        'u.cid',
        'u.first_name',
        'u.last_name',
        'u.email',
        'r.code as role_code',
        'r.name as role_name',
        'ur.created_at as assigned_at'
      )
      .orderBy('ur.created_at', 'desc')
      .limit(input.pageSize)
      .offset(input.offset);

    const userIds = rows.map((row) => row.user_id);
    const scopeRows = userIds.length
      ? await this.db('user_office_scope')
          .select('user_id', 'hospcode')
          .whereIn('user_id', userIds)
          .where('is_active', 1)
      : [];

    const scopeMap = new Map<string, string[]>();
    for (const row of scopeRows) {
      const list = scopeMap.get(row.user_id) ?? [];
      list.push(row.hospcode);
      scopeMap.set(row.user_id, list);
    }

    const normalized = rows.map((row) => ({
      ...row,
      hospcodes: scopeMap.get(row.user_id) ?? []
    }));

    return {
      total: Number(total ?? 0),
      rows: normalized
    };
  }

  async getRoleByCode(code: string) {
    return this.db('roles').where({ code, is_active: 1 }).first();
  }

  async getRolesByCodes(codes: string[]) {
    if (!codes.length) return [];
    return this.db('roles')
      .whereIn('code', codes)
      .where({ is_active: 1 })
      .select('id', 'code', 'name');
  }

  async getExistingHospcodes(hospcodes: string[]): Promise<string[]> {
    if (!hospcodes.length) return [];

    const rows = await this.db('organizations')
      .whereIn('hospcode', hospcodes)
      .select('hospcode');

    return rows.map((row) => String(row.hospcode));
  }

  async getUserById(userId: string) {
    return this.db('users').where({ id: userId }).first();
  }

  async upsertUserByCid(input: {
    cid: string;
    createdBy?: string;
  }) {
    const existing = await this.db('users').where({ cid: input.cid }).first();

    if (existing) {
      await this.db('users').where({ id: existing.id }).update({
        is_active: 1,
        updated_at: this.db.fn.now()
      });

      return { id: existing.id, cid: input.cid };
    }

    const id = uuidv4();
    await this.db('users').insert({
      id,
      cid: input.cid,
      first_name: null,
      last_name: null,
      email: null,
      is_active: 1,
      created_by: input.createdBy ?? null,
      created_at: this.db.fn.now(),
      updated_at: this.db.fn.now()
    });

    return { id, cid: input.cid };
  }

  async upsertUserRole(input: { userId: string; roleId: string; assignedBy?: string }) {
    const existing = await this.db('user_roles')
      .where({ user_id: input.userId, role_id: input.roleId })
      .first();

    if (existing) {
      await this.db('user_roles').where({ id: existing.id }).update({
        is_active: 1,
        assigned_by: input.assignedBy ?? null,
        updated_at: this.db.fn.now()
      });
      return;
    }

    await this.db('user_roles').insert({
      id: uuidv4(),
      user_id: input.userId,
      role_id: input.roleId,
      is_active: 1,
      assigned_by: input.assignedBy ?? null,
      created_at: this.db.fn.now(),
      updated_at: this.db.fn.now()
    });
  }

  async syncUserRoles(input: { userId: string; roleIds: string[]; assignedBy?: string }) {
    const targetRoleIds = [...new Set(input.roleIds)];

    await this.db.transaction(async (trx) => {
      await trx('user_roles')
        .where('user_id', input.userId)
        .where('is_active', 1)
        .whereNotIn('role_id', targetRoleIds)
        .update({
          is_active: 0,
          assigned_by: input.assignedBy ?? null,
          updated_at: trx.fn.now()
        });

      for (const roleId of targetRoleIds) {
        const existing = await trx('user_roles')
          .where({ user_id: input.userId, role_id: roleId })
          .first();

        if (existing) {
          await trx('user_roles').where({ id: existing.id }).update({
            is_active: 1,
            assigned_by: input.assignedBy ?? null,
            updated_at: trx.fn.now()
          });
          continue;
        }

        await trx('user_roles').insert({
          id: uuidv4(),
          user_id: input.userId,
          role_id: roleId,
          is_active: 1,
          assigned_by: input.assignedBy ?? null,
          created_at: trx.fn.now(),
          updated_at: trx.fn.now()
        });
      }
    });
  }

  async replaceUserScopes(input: { userId: string; hospcodes: string[]; updatedBy?: string }) {
    const uniqueHospcodes = [...new Set(input.hospcodes.map((hospcode) => hospcode.trim()).filter(Boolean))];

    await this.db.transaction(async (trx) => {
      await trx('user_office_scope')
        .where({ user_id: input.userId, is_active: 1 })
        .update({
          is_active: 0,
          updated_at: trx.fn.now(),
          updated_by: input.updatedBy ?? null
        });

      if (!uniqueHospcodes.length) return;

      const rows = uniqueHospcodes.map((hospcode) => ({
        id: uuidv4(),
        user_id: input.userId,
        hospcode,
        is_active: 1,
        created_by: input.updatedBy ?? null,
        updated_by: input.updatedBy ?? null,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now()
      }));

      await trx('user_office_scope')
        .insert(rows)
        .onConflict(['user_id', 'hospcode'])
        .merge({
          is_active: 1,
          updated_at: trx.fn.now(),
          updated_by: input.updatedBy ?? null
        });
    });
  }

  async deactivateUserRole(input: { userId: string; roleCode?: string; updatedBy?: string }) {
    const query = this.db('user_roles as ur')
      .innerJoin('roles as r', 'r.id', 'ur.role_id')
      .where('ur.user_id', input.userId)
      .where('ur.is_active', 1)
      .update({
        'ur.is_active': 0,
        'ur.updated_at': this.db.fn.now(),
        'ur.assigned_by': input.updatedBy ?? null
      });

    if (input.roleCode) {
      query.andWhere('r.code', input.roleCode);
    }

    await query;

    await this.db('user_office_scope')
      .where('user_id', input.userId)
      .where('is_active', 1)
      .update({
        is_active: 0,
        updated_at: this.db.fn.now(),
        updated_by: input.updatedBy ?? null
      });
  }
}
