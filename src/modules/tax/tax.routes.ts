import { NextFunction, Request, Response, Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { systemDb } from '../../db/knex';
import { authMiddleware } from '../../middleware/auth.middleware';
import { auditMiddleware } from '../../middleware/audit.middleware';
import { requirePermission } from '../../middleware/permission.middleware';
import { requireAssignedScopeMiddleware } from '../../middleware/scope-required.middleware';
import { parsePagination } from '../../shared/utils/pagination';
import { TaxModel } from './tax.model';
import { TaxService } from './tax.service';

const router = Router();
const service = new TaxService(new TaxModel(systemDb));
const TAX_UPLOAD_MAX_FILE_SIZE = 300 * 1024 * 1024; // 300MB
const asyncHandler = (handler: (req: Request, res: Response, next: NextFunction) => Promise<void>) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
};

const uploadIndividual = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: TAX_UPLOAD_MAX_FILE_SIZE
  }
});

const uploadBatch = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: TAX_UPLOAD_MAX_FILE_SIZE
  }
});

const yearSchema = z.object({
  yearBe: z.coerce.number().int(),
  hospcode: z.string().trim().min(1).max(10).optional()
});
const documentIdSchema = z.string().uuid();

const isPdfFile = (file?: Express.Multer.File) => {
  if (!file) return false;
  const lowerName = String(file.originalname || '').toLowerCase();
  const mime = String(file.mimetype || '').toLowerCase();
  return mime === 'application/pdf' || lowerName.endsWith('.pdf');
};

const isTxtFile = (file?: Express.Multer.File) => {
  if (!file) return false;
  const lowerName = String(file.originalname || '').toLowerCase();
  const mime = String(file.mimetype || '').toLowerCase();
  return mime === 'text/plain' || lowerName.endsWith('.txt');
};

router.get(
  '/years',
  authMiddleware,
  requirePermission('payroll.read'),
  requireAssignedScopeMiddleware,
  auditMiddleware('tax', 'list_years'),
  asyncHandler(async (req, res) => {
    const data = await service.listYears(req.auth!);
    res.json({ ok: true, data });
  })
);

router.post(
  '/years',
  authMiddleware,
  requirePermission('payroll.export'),
  requireAssignedScopeMiddleware,
  auditMiddleware('tax', 'create_year'),
  asyncHandler(async (req, res) => {
    const payload = yearSchema.parse(req.body);
    if (payload.hospcode) {
      req.effectiveHospcodes = [payload.hospcode];
    }

    const result = await service.createYear(req.auth!, payload);
    if (!result.ok) {
      res.status(Number(result.status ?? 400)).json(result);
      return;
    }

    res.status(Number(result.status ?? 201)).json(result);
  })
);

router.put(
  '/years/:yearId',
  authMiddleware,
  requirePermission('payroll.export'),
  requireAssignedScopeMiddleware,
  auditMiddleware('tax', 'update_year'),
  asyncHandler(async (req, res) => {
    const yearId = Number(req.params.yearId);

    if (!Number.isInteger(yearId) || yearId <= 0) {
      res.status(400).json({ ok: false, error: 'INVALID_YEAR_ID' });
      return;
    }

    res.status(403).json({ ok: false, error: 'TAX_YEAR_EDIT_DISABLED' });
  })
);

router.delete(
  '/years/:yearId',
  authMiddleware,
  requirePermission('payroll.export'),
  requireAssignedScopeMiddleware,
  auditMiddleware('tax', 'delete_year'),
  asyncHandler(async (req, res) => {
    const yearId = Number(req.params.yearId);
    if (!Number.isInteger(yearId) || yearId <= 0) {
      res.status(400).json({ ok: false, error: 'INVALID_YEAR_ID' });
      return;
    }

    const result = await service.deleteYear(req.auth!, yearId);
    if (!result.ok) {
      res.status(Number(result.status ?? 400)).json(result);
      return;
    }

    res.status(Number(result.status ?? 200)).json(result);
  })
);

router.get(
  '/years/:yearId/documents',
  authMiddleware,
  requirePermission('payroll.read'),
  requireAssignedScopeMiddleware,
  auditMiddleware('tax', 'list_documents'),
  asyncHandler(async (req, res) => {
    const yearId = Number(req.params.yearId);
    if (!Number.isInteger(yearId) || yearId <= 0) {
      res.status(400).json({ ok: false, error: 'INVALID_YEAR_ID' });
      return;
    }

    const pagination = parsePagination(req.query as Record<string, unknown>);
    const result = await service.listDocuments(req.auth!, yearId, {
      search: req.query.search ? String(req.query.search) : undefined,
      ...pagination
    });

    if (!result.ok) {
      res.status(Number(result.status ?? 400)).json(result);
      return;
    }

    res.json(result);
  })
);

router.post(
  '/years/:yearId/upload-individual/preview',
  authMiddleware,
  requirePermission('payroll.export'),
  requireAssignedScopeMiddleware,
  uploadIndividual.array('files', 200),
  auditMiddleware('tax', 'preview_upload_individual'),
  asyncHandler(async (req, res) => {
    const yearId = Number(req.params.yearId);
    if (!Number.isInteger(yearId) || yearId <= 0) {
      res.status(400).json({ ok: false, error: 'INVALID_YEAR_ID' });
      return;
    }

    const files = (req.files as Express.Multer.File[]) || [];
    const rawCids = req.body.cids;
    const cids = Array.isArray(rawCids) ? rawCids : rawCids ? [rawCids] : [];

    if (!files.length || !cids.length) {
      res.status(400).json({ ok: false, error: 'FILES_AND_CIDS_REQUIRED' });
      return;
    }

    if (files.length !== cids.length) {
      res.status(400).json({ ok: false, error: 'FILES_CIDS_LENGTH_MISMATCH' });
      return;
    }

    const invalidPdf = files.find((file) => !isPdfFile(file));
    if (invalidPdf) {
      res.status(400).json({ ok: false, error: 'ONLY_PDF_ALLOWED' });
      return;
    }

    const items = files.map((file, index) => ({
      cid: String(cids[index] ?? '').trim(),
      originalName: file.originalname,
      buffer: file.buffer
    }));

    const result = await service.previewIndividualUpload(req.auth!, yearId, items);
    if (!result.ok) {
      res.status(Number(result.status ?? 400)).json(result);
      return;
    }

    res.status(Number(result.status ?? 200)).json(result);
  })
);

router.post(
  '/years/:yearId/upload-individual',
  authMiddleware,
  requirePermission('payroll.export'),
  requireAssignedScopeMiddleware,
  uploadIndividual.array('files', 200),
  auditMiddleware('tax', 'upload_individual'),
  asyncHandler(async (req, res) => {
    const yearId = Number(req.params.yearId);
    if (!Number.isInteger(yearId) || yearId <= 0) {
      res.status(400).json({ ok: false, error: 'INVALID_YEAR_ID' });
      return;
    }

    const files = (req.files as Express.Multer.File[]) || [];
    const rawCids = req.body.cids;
    const cids = Array.isArray(rawCids) ? rawCids : rawCids ? [rawCids] : [];

    if (!files.length || !cids.length) {
      res.status(400).json({ ok: false, error: 'FILES_AND_CIDS_REQUIRED' });
      return;
    }

    if (files.length !== cids.length) {
      res.status(400).json({ ok: false, error: 'FILES_CIDS_LENGTH_MISMATCH' });
      return;
    }

    const invalidPdf = files.find((file) => !isPdfFile(file));
    if (invalidPdf) {
      res.status(400).json({ ok: false, error: 'ONLY_PDF_ALLOWED' });
      return;
    }

    const items = files.map((file, index) => ({
      cid: String(cids[index] ?? '').trim(),
      originalName: file.originalname,
      buffer: file.buffer
    }));

    const result = await service.uploadIndividual(req.auth!, yearId, items);
    if (!result.ok) {
      res.status(Number(result.status ?? 400)).json(result);
      return;
    }

    res.status(Number(result.status ?? 201)).json(result);
  })
);

router.post(
  '/years/:yearId/upload-batch/preview',
  authMiddleware,
  requirePermission('payroll.export'),
  requireAssignedScopeMiddleware,
  uploadBatch.fields([
    { name: 'pdf', maxCount: 1 },
    { name: 'txt', maxCount: 1 }
  ]),
  auditMiddleware('tax', 'preview_upload_batch'),
  asyncHandler(async (req, res) => {
    const yearId = Number(req.params.yearId);
    if (!Number.isInteger(yearId) || yearId <= 0) {
      res.status(400).json({ ok: false, error: 'INVALID_YEAR_ID' });
      return;
    }

    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const pdf = files?.pdf?.[0];
    const txt = files?.txt?.[0];

    if (!pdf || !txt) {
      res.status(400).json({ ok: false, error: 'PDF_AND_TXT_REQUIRED' });
      return;
    }

    if (!isPdfFile(pdf)) {
      res.status(400).json({ ok: false, error: 'INVALID_PDF_FILE' });
      return;
    }

    if (!isTxtFile(txt)) {
      res.status(400).json({ ok: false, error: 'INVALID_TXT_FILE' });
      return;
    }

    const result = await service.previewBatchUpload(req.auth!, yearId, pdf.buffer, txt.buffer);
    if (!result.ok) {
      res.status(Number(result.status ?? 400)).json(result);
      return;
    }

    res.status(Number(result.status ?? 200)).json(result);
  })
);

router.post(
  '/years/:yearId/upload-batch',
  authMiddleware,
  requirePermission('payroll.export'),
  requireAssignedScopeMiddleware,
  uploadBatch.fields([
    { name: 'pdf', maxCount: 1 },
    { name: 'txt', maxCount: 1 }
  ]),
  auditMiddleware('tax', 'upload_batch'),
  asyncHandler(async (req, res) => {
    const yearId = Number(req.params.yearId);
    if (!Number.isInteger(yearId) || yearId <= 0) {
      res.status(400).json({ ok: false, error: 'INVALID_YEAR_ID' });
      return;
    }

    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const pdf = files?.pdf?.[0];
    const txt = files?.txt?.[0];

    if (!pdf || !txt) {
      res.status(400).json({ ok: false, error: 'PDF_AND_TXT_REQUIRED' });
      return;
    }

    if (!isPdfFile(pdf)) {
      res.status(400).json({ ok: false, error: 'INVALID_PDF_FILE' });
      return;
    }

    if (!isTxtFile(txt)) {
      res.status(400).json({ ok: false, error: 'INVALID_TXT_FILE' });
      return;
    }

    const result = await service.uploadBatch(req.auth!, yearId, pdf.buffer, txt.buffer);
    if (!result.ok) {
      res.status(Number(result.status ?? 400)).json(result);
      return;
    }

    res.status(Number(result.status ?? 201)).json(result);
  })
);

router.get(
  '/documents/:id/download',
  authMiddleware,
  requirePermission('payroll.read'),
  requireAssignedScopeMiddleware,
  auditMiddleware('tax', 'download_document'),
  asyncHandler(async (req, res) => {
    const parsedDocumentId = documentIdSchema.safeParse(req.params.id);
    if (!parsedDocumentId.success) {
      res.status(400).json({ ok: false, error: 'INVALID_DOCUMENT_ID' });
      return;
    }

    const result = await service.getDownloadPayload(req.auth!, parsedDocumentId.data);
    if (!result.ok || !result.data) {
      res.status(Number(result.status ?? 400)).json(result);
      return;
    }

    res.download(result.data.absolutePath, result.data.fileName);
  })
);

router.put(
  '/documents/:id',
  authMiddleware,
  requirePermission('payroll.export'),
  requireAssignedScopeMiddleware,
  auditMiddleware('tax', 'update_document'),
  asyncHandler(async (req, res) => {
    const parsedDocumentId = documentIdSchema.safeParse(req.params.id);
    if (!parsedDocumentId.success) {
      res.status(400).json({ ok: false, error: 'INVALID_DOCUMENT_ID' });
      return;
    }

    res.status(403).json({ ok: false, error: 'TAX_DOCUMENT_EDIT_DISABLED' });
  })
);

router.delete(
  '/documents/:id',
  authMiddleware,
  requirePermission('payroll.export'),
  requireAssignedScopeMiddleware,
  auditMiddleware('tax', 'delete_document'),
  asyncHandler(async (req, res) => {
    const parsedDocumentId = documentIdSchema.safeParse(req.params.id);
    if (!parsedDocumentId.success) {
      res.status(400).json({ ok: false, error: 'INVALID_DOCUMENT_ID' });
      return;
    }

    const result = await service.deleteDocument(req.auth!, parsedDocumentId.data);
    if (!result.ok) {
      res.status(Number(result.status ?? 400)).json(result);
      return;
    }

    res.status(Number(result.status ?? 200)).json(result);
  })
);

export const taxRoutes = router;
