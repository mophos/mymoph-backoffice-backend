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

    const [{ total }] = await base.clone().countDistinct<{ total: number }[]>({ total: 'ur.user_id' });

    const userRows = await base
      .clone()
      .select('ur.user_id')
      .max<{ user_id: string; latest_assigned_at: string }[]>({ latest_assigned_at: 'ur.created_at' })
      .groupBy('ur.user_id')
      .orderBy('latest_assigned_at', 'desc')
      .limit(input.pageSize)
      .offset(input.offset);

    const userIds = userRows.map((row) => String(row.user_id));
    if (!userIds.length) {
      return {
        total: Number(total ?? 0),
        rows: []
      };
    }

    const rows = await this.db('user_roles as ur')
      .innerJoin('users as u', 'u.id', 'ur.user_id')
      .innerJoin('roles as r', 'r.id', 'ur.role_id')
      .where('ur.is_active', 1)
      .where('u.is_active', 1)
      .where('r.is_active', 1)
      .whereIn('ur.user_id', userIds)
      .modify((queryBuilder) => {
        if (input.roleCode) {
          queryBuilder.andWhere('r.code', input.roleCode);
        }
      })
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
      .orderBy('ur.created_at', 'desc');

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

    const grouped = new Map<
      string,
      {
        user_id: string;
        cid: string;
        first_name: string | null;
        last_name: string | null;
        email: string | null;
        role_codes: string[];
        hospcodes: string[];
        latest_assigned_at: string;
      }
    >();

    for (const row of rows) {
      const userId = String(row.user_id);
      const current = grouped.get(userId) ?? {
        user_id: userId,
        cid: String(row.cid ?? ''),
        first_name: row.first_name ?? null,
        last_name: row.last_name ?? null,
        email: row.email ?? null,
        role_codes: [] as string[],
        hospcodes: (scopeMap.get(userId) ?? []) as string[],
        latest_assigned_at: String(row.assigned_at ?? '')
      };

      const roleCode = String(row.role_code ?? '').trim();
      if (roleCode && !current.role_codes.includes(roleCode)) {
        current.role_codes.push(roleCode);
      }

      if (String(row.assigned_at ?? '') > current.latest_assigned_at) {
        current.latest_assigned_at = String(row.assigned_at ?? '');
      }

      grouped.set(userId, current);
    }

    const userOrder = new Map<string, number>();
    userIds.forEach((userId, index) => {
      userOrder.set(userId, index);
    });

    const normalized = [...grouped.values()]
      .sort((left, right) => (userOrder.get(left.user_id) ?? 0) - (userOrder.get(right.user_id) ?? 0))
      .map((item) => ({
        user_id: item.user_id,
        cid: item.cid,
        first_name: item.first_name,
        last_name: item.last_name,
        email: item.email,
        role_codes: item.role_codes,
        hospcodes: item.hospcodes
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
