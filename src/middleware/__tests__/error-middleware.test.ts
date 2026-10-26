import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import * as mongodb from 'mongodb';
import { ZodError } from 'zod';
import { errorMiddleware } from '../error.middleware';
import { MymophMongoConfigurationError } from '../../db/mongodb';

/**
 * MONGO-01 — error ของ mongo ทุกตัวต้องกลายเป็น 503 ไม่ใช่เฉพาะ 3 ชื่อที่เขียนไว้ตายตัว
 * OBS-01   — ชื่อ error ต้องถูกส่งต่อให้ audit บันทึกลงฐาน
 */

function fakeRes() {
  const state: { status?: number; body?: any } = {};
  const res: any = {
    status(code: number) { state.status = code; return res; },
    json(body: any) { state.body = body; return res; }
  };
  return { res, state };
}

const fakeReq = () => ({ originalUrl: '/api/v1/test', method: 'GET' }) as any;

function run(error: unknown) {
  const req = fakeReq();
  const { res, state } = fakeRes();
  errorMiddleware(error, req, res, () => {});
  return { req, state };
}

describe('MONGO-01 แยก "ปลายทางล่ม" ออกจาก "บั๊กของเราเอง"', () => {
  const unavailable: [string, () => unknown][] = [
    ['MongoNetworkError', () => new mongodb.MongoNetworkError('socket')],
    ['MongoNetworkTimeoutError (subclass)', () => new mongodb.MongoNetworkTimeoutError('timeout')],
    ['MongoServerSelectionError', () => new mongodb.MongoServerSelectionError('เลือก server ไม่ได้', new Map() as never)],
    ['MongoTopologyClosedError', () => new mongodb.MongoTopologyClosedError()],
    ['MongoNotConnectedError (เดิมตกเป็น 500)', () => new mongodb.MongoNotConnectedError('ยังไม่เชื่อม')],
    ['MongoServerClosedError (เดิมตกเป็น 500)', () => new mongodb.MongoServerClosedError()],
    ['MongoClientClosedError (เดิมตกเป็น 500)', () => new mongodb.MongoClientClosedError()],
    ['MongoOperationTimeoutError (เดิมตกเป็น 500)', () => new mongodb.MongoOperationTimeoutError('หมดเวลา')],
    ['MymophMongoConfigurationError ของแอปเอง', () => new MymophMongoConfigurationError()]
  ];

  for (const [label, make] of unavailable) {
    test(`${label} ต้องได้ 503`, () => {
      const { state } = run(make());
      assert.equal(state.status, 503, `${label} ต้องเป็น 503 ไม่ใช่ ${state.status}`);
      assert.equal(state.body.error, 'MYMOPH_MONGO_UNAVAILABLE');
    });
  }

  // สำคัญพอกัน — error ของ mongo ที่เป็นบั๊กของเราเองต้องไม่ถูกกลบเป็น "ปลายทางล่ม"
  // ไม่งั้นผู้ดูแลจะไปไล่หาที่ MongoDB ทั้งที่ความจริงคือโค้ดเราส่ง argument ผิด
  const ourFault: [string, () => unknown][] = [
    ['MongoInvalidArgumentError', () => new mongodb.MongoInvalidArgumentError('argument ผิด')],
    ['MongoParseError', () => new mongodb.MongoParseError('uri ผิดรูปแบบ')],
    ['MongoCursorExhaustedError', () => new mongodb.MongoCursorExhaustedError()],
    ['MongoCompatibilityError', () => new mongodb.MongoCompatibilityError('เวอร์ชันไม่เข้ากัน')]
  ];

  for (const [label, make] of ourFault) {
    test(`${label} ต้องยังเป็น 500 ไม่ใช่ 503`, () => {
      const { state } = run(make());
      assert.equal(state.status, 500, `${label} ไม่ใช่เรื่องปลายทางล่ม`);
      assert.equal(state.body.error, 'INTERNAL_SERVER_ERROR');
    });
  }

  test('error ทั่วไปที่ไม่เกี่ยวกับ mongo ต้องยังเป็น 500', () => {
    const { state } = run(new Error('อย่างอื่น'));
    assert.equal(state.status, 500);
  });

  test('ZodError ต้องยังเป็น 400 ไม่ถูกกลืน', () => {
    const zod = new ZodError([{ code: 'custom', path: ['cid'], message: 'ผิด' } as never]);
    const { state } = run(zod);
    assert.equal(state.status, 400);
    assert.equal(state.body.error, 'INVALID_PAYLOAD');
  });
});

describe('OBS-01 ส่งชื่อ error ต่อให้ audit', () => {
  test('ตั้ง req.errorName ให้ตรงกับชนิดของ error', () => {
    assert.equal(run(new mongodb.MongoNotConnectedError('x')).req.errorName, 'MongoNotConnectedError');
  });

  test('error ธรรมดาก็ต้องบันทึกชื่อไว้ เพื่อสืบ 500 ย้อนหลังได้', () => {
    class TimeoutError extends Error { constructor() { super('t'); this.name = 'TimeoutError'; } }
    assert.equal(run(new TimeoutError()).req.errorName, 'TimeoutError');
  });

  test('สิ่งที่โยนมาโดยไม่ใช่ Error ก็ต้องมีค่าบันทึก', () => {
    assert.equal(run('ข้อความเปล่า').req.errorName, 'UnknownError');
  });
});
