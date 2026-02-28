import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const reviewCyclesGet = require('../reviewcycles-get/index.js');
const reviewCycleDetail = require('../reviews-cycle-detail/index.js');
const reviewItemAction = require('../reviews-item-action/index.js');

test('reviewcycles list validators generate RFC1123 and weak etag', () => {
  const rows = [
    { _etag: '"a"', _ts: 1700000000 },
    { _etag: '"b"', _ts: 1700000100 }
  ];
  const { etag, lastModified } = reviewCyclesGet.__test.listValidators(rows);
  assert.ok(etag.startsWith('W/"reviewcycles-'));
  assert.match(lastModified, /GMT$/);
});

test('conditional helper returns true for matching If-None-Match', () => {
  const etag = 'W/"abc"';
  const req = { headers: { 'if-none-match': etag } };
  assert.equal(reviewCyclesGet.__test.isNotModified(req, etag, new Date().toUTCString()), true);
});

test('composite helper derives etag and 304 decision by If-Modified-Since', () => {
  const etag = reviewCycleDetail.__test.makeCompositeEtag('"etag-parent"', 1700000500, 5);
  const lastModified = reviewCycleDetail.__test.toRfc1123(1700000500);
  const req = { headers: { 'if-modified-since': lastModified } };
  assert.ok(etag.startsWith('W/"cycle-detail-'));
  assert.equal(reviewCycleDetail.__test.isNotModified(req, etag, lastModified), true);
});

test('AJV validator rejects missing itemId/managerId', () => {
  const valid = reviewItemAction.__test.validateRequest({ status: 'APPROVED' });
  assert.equal(valid, false);
  assert.ok(Array.isArray(reviewItemAction.__test.validateRequest.errors));
});
