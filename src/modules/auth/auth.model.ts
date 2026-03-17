import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

interface UpsertUserInput {
  cid: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}

interface UsersTableMeta {
  columns: Set<string>;
  hasId: boolean;
  idAutoIncrement: boolean;
}

const isMissingTableError = (error: unknown) => {
  const code = (error as any)?.code;
  return code === 'ER_NO_SUCH_TABLE' || code === 'ER_BAD_TABLE_ERROR';
};

export class AuthModel {
  private usersMetaPromise?: Promise<UsersTableMeta>;

  constructor(
    private readonly db: Knex,
    private readonly mymophDb?: Knex
  ) { }

  async upsertUser(input: UpsertUserInput): Promise<{ id: string; cid: string; firstName?: string; lastName?: string; email?: string; defaultHospcode?: string; }> {
    const meta = await this.getUsersTableMeta();
    const existing = await this.db('users').where({ cid: input.cid }).first();

    const updatePayload = this.buildUsersPayload(meta, input, false);

    if (existing) {
      if (Object.keys(updatePayload).length > 0) {
        await this.db('users').where({ cid: input.cid }).update(updatePayload);
      }

      const updated = await this.db('users').where({ cid: input.cid }).first();

      return {
        id: String(updated?.id ?? existing.id ?? input.cid),
        cid: input.cid,
        firstName: updated?.first_name ?? updated?.fname ?? existing.first_name ?? existing.fname ?? input.firstName,
        lastName: updated?.last_name ?? updated?.lname ?? existing.last_name ?? existing.lname ?? input.lastName,
        email: updated?.email ?? existing.email ?? input.email,
        defaultHospcode: updated?.default_hospcode ?? updated?.hospcode ?? existing.default_hospcode ?? existing.hospcode ?? undefined
      };
    }

    const insertPayload: Record<string, unknown> = {
      cid: input.cid,
      ...this.buildUsersPayload(meta, input, true)
    };

    if (meta.hasId && !meta.idAutoIncrement) {
      insertPayload.id = uuidv4();
    }

    await this.db('users').insert(insertPayload);

    const inserted = await this.db('users').where({ cid: input.cid }).first();
    return {
      id: String(inserted?.id ?? insertPayload.id ?? input.cid),
      cid: input.cid,
      firstName: inserted?.first_name ?? inserted?.fname ?? input.firstName,
      lastName: inserted?.last_name ?? inserted?.lname ?? input.lastName,
      email: inserted?.email ?? input.email,
      defaultHospcode: inserted?.default_hospcode ?? inserted?.hospcode ?? undefined
    };
  }

  async getMyMophProfileByCid(cid: string): Promise<UpsertUserInput> {
    if (!this.mymophDb) return { cid };

    try {
      const row = await this.mymophDb('users').where({ cid }).first();
      if (!row) return { cid };

      const firstName = this.pickNonEmpty(row, [
        'first_name',
        'firstName',
        'fname',
        'given_name',
        'givenName',
        'name'
      ]);
      const lastName = this.pickNonEmpty(row, [
        'last_name',
        'lastName',
        'lname',
        'family_name',
        'familyName',
        'surname'
      ]);
      const email = this.pickNonEmpty(row, ['email', 'mail', 'emailAddress']);

      return { cid, firstName, lastName, email };
    } catch (error) {
      if (isMissingTableError(error)) return { cid };
      throw error;
    }
  }

  async upsertIdentityMapping(input: {
    userId: string;
    cid: string;
    provider: string;
    providerSubject: string;
  }): Promise<void> {
    try {


      const existing = await this.db('oauth_identity_mappings')
        .where({ provider: input.provider, provider_subject: input.providerSubject })
        .first();

      const payload = {
        user_id: input.userId,
        cid: input.cid,
        updated_at: this.db.fn.now()
      };


      if (existing) {
        await this.db('oauth_identity_mappings').where({ id: existing.id }).update(payload);
        return;
      }

      await this.db('oauth_identity_mappings').insert({
        id: uuidv4(),
        provider: input.provider,
        provider_subject: input.providerSubject,
        ...payload,
        created_at: this.db.fn.now()
      });
    } catch (error) {
      if (!isMissingTableError(error)) throw error;
    }
  }

  async getUserById(userId: string): Promise<any> {
    const meta = await this.getUsersTableMeta();
    const query = this.db('users');

    if (meta.hasId) {
      query.where({ id: userId });
    } else {
      query.where({ cid: userId });
    }

    if (meta.columns.has('is_active')) {
      query.andWhere({ is_active: 1 });
    }

    return query.first();
  }

  async getRoleCodes(userId: string): Promise<string[]> {
    try {
      const rows = await this.db('user_roles as ur')
        .innerJoin('roles as r', 'r.id', 'ur.role_id')
        .where('ur.user_id', userId)
        .where('ur.is_active', 1)
        .where('r.is_active', 1)
        .select('r.code');

      return rows.map((item) => item.code);
    } catch (error) {
      if (isMissingTableError(error)) return [];
      throw error;
    }
  }

  async getPermissionCodes(userId: string): Promise<string[]> {
    try {
      const rows = await this.db('user_roles as ur')
        .innerJoin('role_permissions as rp', 'rp.role_id', 'ur.role_id')
        .innerJoin('permissions as p', 'p.id', 'rp.permission_id')
        .where('ur.user_id', userId)
        .where('ur.is_active', 1)
        .where('rp.is_active', 1)
        .where('p.is_active', 1)
        .distinct('p.code');

      return rows.map((item) => item.code);
    } catch (error) {
      if (isMissingTableError(error)) return [];
      throw error;
    }
  }

  async getHospcodeScopes(userId: string): Promise<string[]> {
    try {
      const rows = await this.db('user_office_scope')
        .where({ user_id: userId, is_active: 1 })
        .distinct('hospcode');

      return rows.map((item) => item.hospcode);
    } catch (error) {
      if (isMissingTableError(error)) return [];
      throw error;
    }
  }

  async createRefreshSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    try {
      await this.db('refresh_sessions').insert({
        id: uuidv4(),
        user_id: input.userId,
        token_hash: input.tokenHash,
        expires_at: input.expiresAt,
        ip_address: input.ipAddress ?? null,
        user_agent: input.userAgent ?? null,
        revoked_at: null,
        created_at: this.db.fn.now()
      });
    } catch (error) {
      if (!isMissingTableError(error)) throw error;
    }
  }

  async findActiveRefreshSessionByHash(tokenHash: string): Promise<any> {
    try {
      return this.db('refresh_sessions')
        .where({ token_hash: tokenHash })
        .whereNull('revoked_at')
        .where('expires_at', '>', this.db.fn.now())
        .first();
    } catch (error) {
      if (isMissingTableError(error)) return null;
      throw error;
    }
  }

  async revokeRefreshSessionByHash(tokenHash: string): Promise<void> {
    try {
      await this.db('refresh_sessions')
        .where({ token_hash: tokenHash })
        .whereNull('revoked_at')
        .update({ revoked_at: this.db.fn.now() });
    } catch (error) {
      if (!isMissingTableError(error)) throw error;
    }
  }

  private async getUsersTableMeta(): Promise<UsersTableMeta> {
    if (!this.usersMetaPromise) {
      this.usersMetaPromise = this.loadUsersTableMeta();
    }

    return this.usersMetaPromise;
  }

  private async loadUsersTableMeta(): Promise<UsersTableMeta> {
    const rows = await this.db('information_schema.columns')
      .select('COLUMN_NAME as column_name', 'EXTRA as extra')
      .whereRaw('TABLE_SCHEMA = DATABASE()')
      .andWhere('TABLE_NAME', 'users');

    const columns = new Set<string>(rows.map((row) => row.column_name));
    const idRow = rows.find((row) => row.column_name === 'id');

    return {
      columns,
      hasId: columns.has('id'),
      idAutoIncrement: String(idRow?.extra ?? '').includes('auto_increment')
    };
  }

  private buildUsersPayload(meta: UsersTableMeta, input: UpsertUserInput, isInsert: boolean): Record<string, unknown> {
    const payload: Record<string, unknown> = {};

    if (meta.columns.has('first_name') && input.firstName !== undefined) {
      payload.first_name = input.firstName;
    }
    if (meta.columns.has('fname') && input.firstName !== undefined) {
      payload.fname = input.firstName;
    }

    if (meta.columns.has('last_name') && input.lastName !== undefined) {
      payload.last_name = input.lastName;
    }
    if (meta.columns.has('lname') && input.lastName !== undefined) {
      payload.lname = input.lastName;
    }

    if (meta.columns.has('email') && input.email !== undefined) {
      payload.email = input.email;
    }

    if (meta.columns.has('is_active')) {
      payload.is_active = 1;
    }

    if (meta.columns.has('updated_at')) {
      payload.updated_at = this.db.fn.now();
    }

    if (isInsert && meta.columns.has('created_at')) {
      payload.created_at = this.db.fn.now();
    }

    return payload;
  }

  private pickNonEmpty(source: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return undefined;
  }
}
