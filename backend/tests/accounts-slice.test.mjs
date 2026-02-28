import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const accountsGet = require('../accounts-get/index.js');
const accountsByUser = require('../accounts-get-by-user/index.js');
const accountsImport = require('../accounts-import/index.js');

test('accounts-get list validators generate weak etag and RFC1123 date', () => {
  const rows = [
    { _etag: '"a"', _ts: 1700000000 },
    { _etag: '"b"', _ts: 1700000100 }
  ];
  const { etag, lastModified } = accountsGet.__test.listValidators(rows);
  assert.ok(etag.startsWith('W/"accounts-'));
  assert.match(lastModified, /GMT$/);
});

test('accounts-get conditional helper returns true for If-None-Match', () => {
  const etag = 'W/"abc"';
  const req = { headers: { 'if-none-match': etag } };
  assert.equal(accountsGet.__test.isNotModified(req, etag, new Date().toUTCString()), true);
});

test('accounts-get-by-user validators return empty sentinel for no rows', () => {
  const { etag, lastModified } = accountsByUser.__test.listValidators([]);
  assert.equal(etag, 'W/"accounts-by-user-empty"');
  assert.match(lastModified, /GMT$/);
});

test('accounts-import AJV validator rejects missing required fields', () => {
  const valid = accountsImport.__test.validateAccount({ appId: 'APP1' });
  assert.equal(valid, false);
  assert.ok(Array.isArray(accountsImport.__test.validateAccount.errors));
});

test('accounts-import detects etag mismatch', () => {
  assert.equal(accountsImport.__test.isEtagMismatch('"one"', '"two"'), true);
  assert.equal(accountsImport.__test.isEtagMismatch('"same"', '"same"'), false);
});
