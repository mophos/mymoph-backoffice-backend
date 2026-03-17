import type { AuthContext } from '../../shared/types/auth';
import { PayrollModel } from './payroll.model';

export class PayrollService {
  constructor(private readonly payrollModel: PayrollModel) {}

  async list(auth: AuthContext, hospcodes: string[]) {
    return this.payrollModel.listPayrollSummary(hospcodes, auth.scopeType);
  }
}
