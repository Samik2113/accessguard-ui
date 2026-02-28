# Review Cycles + Review Items Slice — Test Plan

## Scope
- Endpoints: `GET /api/reviewcycles-get`, `GET /api/reviews-cycle-detail`
- Writes: `POST /api/reviews-item-action`, `POST /api/reviews-confirm`
- Frontend: Dashboard campaign list/detail and manager actions

## Backend automated checks
Run:
- `npm run test:backend`

Covers:
1. Conditional helper behavior (`If-None-Match`, `If-Modified-Since`) for 304 decisions.
2. Composite validator generation (`weak ETag`, `Last-Modified`).
3. Ajv payload rejection for invalid write payload.

## Frontend verification steps (manual, Playwright/Cypress-ready)
1. Open app and sign in as admin.
2. Navigate to Dashboard.
3. Open DevTools Network tab, disable cache.
4. Load campaign list once.
   - Expect one `GET /api/reviewcycles-get` = `200` with `ETag` + `Last-Modified`.
5. Open a campaign detail modal.
   - Expect one `GET /api/reviews-cycle-detail?...` = `200` with `ETag` + `Last-Modified`.
6. Close and reopen the same campaign detail.
   - Expect `GET /api/reviews-cycle-detail?...` = `304` and UI data rendered from cached payload.
7. Trigger a review item action from Manager Portal.
   - Request must include `If-Match`.
   - If stale ETag is forced, expect `412` with `{ code: "ETAG_MISMATCH" }`.

## Before vs after network timeline (expected)
### Before this PR
- Dashboard load: `reviewcycles-get` (1) + `reviewitems-get` (1 full list).
- Open detail: no dedicated endpoint (client filters full list).
- Revisit detail: often repeats broad fetches after writes.
- Typical sequence (list -> detail -> revisit): **3-5 full responses**.

### After this PR
- Dashboard load: `reviewcycles-get` (1, usually `200`).
- Open detail: `reviews-cycle-detail` (1, `200`).
- Revisit same detail key: `reviews-cycle-detail` (`304`).
- Typical sequence (list -> detail -> revisit): **3 requests total, 1 is 304; payload bytes reduced on revisit**.

## Stale overwrite protection checks
- Frontend: verify rapid repeated navigations do not show older data after newer detail fetch completes.
- Backend: stale `If-Match` on item action returns `412` and does not mutate data.

## Rollback plan
1. Revert frontend to prior fetch flow:
   - Remove `useReviewCycles`/`useReviewCycleDetail` wiring and keep legacy direct calls.
2. Revert backend endpoint additions:
   - Disable `reviews-cycle-detail` function.
3. Keep write-path compatibility:
   - If needed temporarily relax `If-Match` requirement behind feature flag for emergency rollback.
4. Validate by rerunning baseline flow and ensuring no 5xx regressions.
