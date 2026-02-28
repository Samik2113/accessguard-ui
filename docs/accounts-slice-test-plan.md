# Accounts Slice — Test Plan

## Scope
- Reads: `GET /api/accounts-get`, `GET /api/accounts-get-by-user`
- Writes: `POST /api/accounts-import`
- Frontend: selected-app account hydration in `App` and user-centric view in `MyAccess`

## Backend automated checks
Run:
- `npm run test:backend`

Covers:
1. `ETag`/`Last-Modified` validator generation for accounts reads.
2. Conditional helper logic for `If-None-Match` style 304 path.
3. Ajv request validation rejects invalid account-import rows.
4. Deterministic `If-Match` mismatch helper behavior for update preconditions.

## Frontend verification steps
1. Sign in and open an application with accounts loaded.
2. In Network tab, verify first `accounts-get` is `200` with `ETag` and `Last-Modified`.
3. Trigger the same read key (same app/filter) again.
   - Expect `304` (or cached reuse with no stale UI overwrite).
4. Open My Access page.
   - Verify data comes from `accounts-get-by-user` and renders server risk flags.
5. Retry account import update with stale `If-Match`.
   - Expect `412` + normalized `ETAG_MISMATCH` shape.

## Before vs after timeline
### Before
- Repeated account reads returned full `200` payloads for identical filters.
- My Access recomputed SoD/risk in client and did ad-hoc fetch lifecycle handling.

### After
- Identical account reads can short-circuit on `304` with validator reuse.
- My Access uses query hook and backend-derived risk flags, reducing client business logic.
- Selected-app account loading in App uses query-backed data path.

## Rollback plan
1. Revert `accounts` query hooks wiring in UI components.
2. Revert conditional header handling in accounts read endpoints.
3. Revert `If-Match` update precheck in `accounts-import` if emergency compatibility is needed.
4. Re-run `npm run test:backend` and `npm run build` to confirm baseline behavior.
