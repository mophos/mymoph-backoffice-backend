import type { Router } from 'express';

export interface BackofficeModuleContract {
  moduleKey: string;
  basePath: string;
  registerRoutes(router: Router): void;
  defaultPermissions: string[];
  supportsHospcodeScope: boolean;
}
