import type { Knex } from 'knex';
import { config } from '../../config/env';

export class PayrollModel {
  constructor(private readonly db: Knex) {}

  async listPayrollSummary(hospcodes: string[], scopeType: 'ALL' | 'LIST') {
    const query = this.db(config.mymophTables.payrollRuns)
      .select('id', 'hospcode', 'pay_month', 'status', 'created_at')
      .orderBy('pay_month', 'desc')
      .limit(50);

    if (scopeType === 'LIST') {
      query.whereIn('hospcode', hospcodes.length ? hospcodes : ['']);
    }

    return query;
  }
}
