import path from 'path';
import { promises as fs } from 'fs';
import { systemDb } from '../db/knex';
import { TaxModel } from '../modules/tax/tax.model';
import { TaxService } from '../modules/tax/tax.service';
import type { AuthContext } from '../shared/types/auth';

interface CliOptions {
  sourceDir: string;
  yearBe: number;
  hospcode?: string;
  hospcodeMapPath?: string;
  actorUserId: string;
  dryRun: boolean;
  limit?: number;
  reportPath: string;
}

interface PairItem {
  baseName: string;
  pdfPath: string;
  txtPath: string;
}

interface HospcodeMapRule {
  pattern: string;
  hospcode: string;
  matcher: RegExp;
}

const usage = `
Usage:
  npx tsx src/scripts/tax-migrate-legacy.ts \\
    --source=/abs/path/to/source \\
    --year=68 \\
    --actor=USER_UUID \\
    [--hospcode=41227] \\
    [--hospcode-map=/abs/path/hospcode-map.csv] \\
    [--dry-run] \\
    [--limit=20] \\
    [--report=/abs/path/report.json]
`;

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;

    const raw = item.slice(2);
    if (!raw) continue;

    if (raw.includes('=')) {
      const [key, ...rest] = raw.split('=');
      result[key] = rest.join('=');
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      result[raw] = next;
      index += 1;
      continue;
    }

    result[raw] = true;
  }

  return result;
}

function normalizeYearBe(rawYear: string | undefined): number {
  const value = Number(rawYear);
  if (!Number.isInteger(value)) {
    throw new Error('INVALID --year (must be integer)');
  }

  if (value >= 2400 && value <= 2700) return value;
  if (value >= 0 && value <= 99) return 2500 + value;

  throw new Error('INVALID --year (accepted: 0-99 or 2400-2700)');
}

async function findPairs(sourceDir: string): Promise<PairItem[]> {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });

  const pdfByBase = new Map<string, PairItem>();
  const txtByBase = new Map<string, PairItem>();

  for (const entry of entries) {
    if (!entry.isFile()) continue;

    const ext = path.extname(entry.name).toLowerCase();
    const baseName = entry.name.slice(0, entry.name.length - ext.length);
    const baseKey = baseName.toLowerCase();
    const fullPath = path.join(sourceDir, entry.name);

    if (ext === '.pdf') {
      pdfByBase.set(baseKey, { baseName, pdfPath: fullPath, txtPath: '' });
      continue;
    }

    if (ext === '.txt') {
      txtByBase.set(baseKey, { baseName, txtPath: fullPath, pdfPath: '' });
    }
  }

  const pairs: PairItem[] = [];
  for (const [baseKey, txtItem] of txtByBase.entries()) {
    const pdfItem = pdfByBase.get(baseKey);
    if (!pdfItem) continue;

    pairs.push({
      baseName: txtItem.baseName,
      pdfPath: pdfItem.pdfPath,
      txtPath: txtItem.txtPath
    });
  }

  pairs.sort((a, b) => a.baseName.localeCompare(b.baseName));
  return pairs;
}

function buildAuthContext(options: CliOptions): AuthContext {
  return {
    userId: options.actorUserId,
    cid: '',
    roles: ['super_admin'],
    permissions: ['payroll.read', 'payroll.export'],
    hospcodes: options.hospcode ? [options.hospcode] : [],
    scopeType: 'ALL',
    displayName: 'Legacy Tax Migration Script'
  };
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

async function loadHospcodeMap(mapPath: string): Promise<HospcodeMapRule[]> {
  const fullPath = path.resolve(mapPath);
  const content = await fs.readFile(fullPath, 'utf8');
  const ext = path.extname(fullPath).toLowerCase();

  if (ext === '.json') {
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) {
      throw new Error('INVALID_HOSPCODE_MAP_JSON: expected array');
    }

    return parsed
      .map((item: any) => ({
        pattern: String(item.pattern ?? '').trim(),
        hospcode: String(item.hospcode ?? '').trim()
      }))
      .filter((item) => item.pattern && item.hospcode)
      .map((item) => ({
        ...item,
        matcher: wildcardToRegExp(item.pattern)
      }));
  }

  // CSV/TXT: pattern,hospcode
  const lines = content
    .split(/\r\n|\n|\r/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  const rules: HospcodeMapRule[] = [];
  for (const line of lines) {
    const [patternRaw, hospcodeRaw] = line.split(',').map((v) => String(v ?? '').trim());
    if (!patternRaw || !hospcodeRaw) continue;

    if (/^pattern$/i.test(patternRaw) && /^hospcode$/i.test(hospcodeRaw)) continue;

    rules.push({
      pattern: patternRaw,
      hospcode: hospcodeRaw,
      matcher: wildcardToRegExp(patternRaw)
    });
  }

  return rules;
}

function resolveHospcodeByBaseName(baseName: string, rules: HospcodeMapRule[], fallbackHospcode?: string): string | null {
  for (const rule of rules) {
    if (rule.matcher.test(baseName)) {
      return rule.hospcode;
    }
  }

  return fallbackHospcode ?? null;
}

function parseCliOptions(argv: string[]): CliOptions {
  const args = parseArgs(argv);

  const sourceDir = String(args.source ?? '').trim();
  const hospcode = String(args.hospcode ?? '').trim() || undefined;
  const hospcodeMapPath = String(args['hospcode-map'] ?? '').trim() || undefined;
  const actorUserId = String(args.actor ?? '').trim();
  const dryRun = Boolean(args['dry-run']);
  const limit = args.limit ? Number(args.limit) : undefined;

  if (!sourceDir || !actorUserId || !args.year) {
    throw new Error(`Missing required args.\n${usage}`);
  }

  if (!hospcode && !hospcodeMapPath) {
    throw new Error(`Missing required args.\n${usage}`);
  }

  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    throw new Error('INVALID --limit (must be positive integer)');
  }

  const yearBe = normalizeYearBe(String(args.year));
  const reportPath =
    String(args.report ?? '').trim() ||
    path.resolve(
      process.cwd(),
      `tax-migration-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    );

  return {
    sourceDir: path.resolve(sourceDir),
    yearBe,
    hospcode,
    hospcodeMapPath,
    actorUserId,
    dryRun,
    limit,
    reportPath
  };
}

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const auth = buildAuthContext(options);

  const service = new TaxService(new TaxModel(systemDb));
  const mapRules = options.hospcodeMapPath ? await loadHospcodeMap(options.hospcodeMapPath) : [];
  const yearIdByHospcode = new Map<string, number>();

  const refreshYearCache = async () => {
    const years = await service.listYears(auth);
    yearIdByHospcode.clear();
    years
      .filter((item) => item.yearBe === options.yearBe)
      .forEach((item) => {
        yearIdByHospcode.set(item.hospcode, item.id);
      });
  };

  const getOrCreateYearId = async (hospcode: string) => {
    const exists = yearIdByHospcode.get(hospcode);
    if (exists) return exists;

    const createYearResult = await service.createYear(auth, {
      yearBe: options.yearBe,
      hospcode
    });

    if (!(createYearResult as any).ok && (createYearResult as any).error !== 'TAX_YEAR_ALREADY_EXISTS') {
      throw new Error(`CREATE_YEAR_FAILED(${hospcode}): ${(createYearResult as any).error}`);
    }

    await refreshYearCache();
    const createdYearId = yearIdByHospcode.get(hospcode);
    if (!createdYearId) {
      throw new Error(`YEAR_NOT_FOUND_AFTER_CREATE(${hospcode})`);
    }

    return createdYearId;
  };

  await refreshYearCache();

  const allPairs = await findPairs(options.sourceDir);
  const pairs = options.limit ? allPairs.slice(0, options.limit) : allPairs;

  const summary = {
    sourceDir: options.sourceDir,
    yearBe: options.yearBe,
    defaultHospcode: options.hospcode ?? null,
    hospcodeMapPath: options.hospcodeMapPath ?? null,
    dryRun: options.dryRun,
    totalPairsFound: allPairs.length,
    totalPairsProcessed: pairs.length,
    successCount: 0,
    failCount: 0,
    failures: [] as Array<{ baseName: string; error: string }>,
    createdDocuments: 0,
    byHospcode: {} as Record<string, { pairs: number; documents: number }>
  };

  for (let index = 0; index < pairs.length; index += 1) {
    const pair = pairs[index];
    const progress = `[${index + 1}/${pairs.length}]`;

    try {
      const hospcode = resolveHospcodeByBaseName(pair.baseName, mapRules, options.hospcode);
      if (!hospcode) {
        summary.failCount += 1;
        summary.failures.push({
          baseName: pair.baseName,
          error: 'HOSPCODE_MAPPING_NOT_FOUND'
        });
        console.log(`${progress} FAIL ${pair.baseName} -> HOSPCODE_MAPPING_NOT_FOUND`);
        continue;
      }

      const yearId = await getOrCreateYearId(hospcode);
      const [pdfBuffer, txtBuffer] = await Promise.all([
        fs.readFile(pair.pdfPath),
        fs.readFile(pair.txtPath)
      ]);

      const result = options.dryRun
        ? await service.previewBatchUpload(auth, yearId, pdfBuffer, txtBuffer)
        : await service.uploadBatch(auth, yearId, pdfBuffer, txtBuffer);

      if (!(result as any).ok) {
        const errorCode = String((result as any).error ?? 'UNKNOWN_ERROR');
        summary.failCount += 1;
        summary.failures.push({
          baseName: pair.baseName,
          error: errorCode
        });
        console.log(`${progress} FAIL ${pair.baseName} -> ${errorCode}`);
        continue;
      }

      const createdCount = Number((result as any).data?.createdCount ?? (result as any).data?.rows?.length ?? 0);
      summary.successCount += 1;
      summary.createdDocuments += createdCount;
      if (!summary.byHospcode[hospcode]) {
        summary.byHospcode[hospcode] = { pairs: 0, documents: 0 };
      }
      summary.byHospcode[hospcode].pairs += 1;
      summary.byHospcode[hospcode].documents += createdCount;
      console.log(`${progress} OK   ${pair.baseName} -> ${createdCount} documents (hospcode=${hospcode})`);
    } catch (error: any) {
      summary.failCount += 1;
      summary.failures.push({
        baseName: pair.baseName,
        error: String(error?.message ?? error)
      });
      console.log(`${progress} FAIL ${pair.baseName} -> ${String(error?.message ?? error)}`);
    }
  }

  await fs.writeFile(options.reportPath, JSON.stringify(summary, null, 2), 'utf8');

  console.log('\nMigration finished');
  console.log(`- source: ${summary.sourceDir}`);
  console.log(`- year: ${summary.yearBe}`);
  console.log(`- default hospcode: ${summary.defaultHospcode ?? '-'}`);
  console.log(`- hospcode map: ${summary.hospcodeMapPath ?? '-'}`);
  console.log(`- dry-run: ${summary.dryRun}`);
  console.log(`- processed: ${summary.totalPairsProcessed}`);
  console.log(`- success: ${summary.successCount}`);
  console.log(`- fail: ${summary.failCount}`);
  console.log(`- created documents: ${summary.createdDocuments}`);
  console.log(`- report: ${options.reportPath}`);

  if (summary.failCount > 0) {
    process.exitCode = 2;
  }
}

main()
  .catch((error) => {
    console.error('\nMigration script failed');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await systemDb.destroy();
  });
