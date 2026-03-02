# AccessGuard UI – Manual Test Cases (End-to-End)

## 1) Scope
This document provides manual test cases and expected outcomes for full functional validation of the AccessGuard application.

## 2) Test Preconditions
- Environment is deployed and accessible.
- Backend APIs are reachable.
- Tester has at least one `ADMIN`, one `MANAGER/USER`, and one `AUDITOR` account.
- Data files available from `test-data/e2e/`:
  - `01_hr_users_inventory.csv`
  - `02_application_onboarding_bulk.csv`
  - `03_accounts_APP_FIN.csv`, `03_accounts_APP_HCM.csv`, `03_accounts_APP_CRM.csv`
  - `04_entitlements_APP_FIN.csv`, `04_entitlements_APP_HCM.csv`, `04_entitlements_APP_CRM.csv`
  - `05_bulk_sod_policies.csv`

## 3) Execution Notes
- Capture evidence per case: screenshot + timestamp + result (Pass/Fail).
- If a step fails, record actual behavior and API error message shown in UI.
- Run in Chrome latest and Edge latest (sanity subset).

---

## A. Authentication & Session

### AUTH-001: Valid Login (Admin)
**Steps**
1. Open login page.
2. Enter valid admin email/password.
3. Click `Sign In`.

**Expected**
- Login succeeds.
- User lands on Dashboard.
- Header shows logged-in user identity.

### AUTH-002: Invalid Login
**Steps**
1. Enter invalid email/password.
2. Click `Sign In`.

**Expected**
- Login blocked.
- Clear error shown (invalid credentials).
- No dashboard data loaded.

### AUTH-003: First User Setup (fresh environment)
**Steps**
1. On login screen, trigger first-user setup.
2. Enter valid details and matching passwords.
3. Submit.

**Expected**
- First admin user created.
- Success confirmation shown.
- User can log in with created credentials.

### AUTH-004: Password Validation
**Steps**
1. In first-user or reset flow, enter short password (<8).
2. Submit.

**Expected**
- Validation error shown.
- Request not submitted.

### AUTH-005: Idle Timeout
**Steps**
1. Log in.
2. Stay inactive beyond idle timeout window.

**Expected**
- Session expires.
- User is logged out and returned to login page.

### AUTH-006: Activity-based Session Extension
**Steps**
1. Log in.
2. Keep interacting (click/scroll/type) periodically.

**Expected**
- Session remains active.
- No forced logout while active.

---

## B. Platform Customization (Admin)

### CUST-001: Update Platform Name and Color
**Steps**
1. Open Admin customization dialog.
2. Change platform name and primary color.
3. Save.

**Expected**
- Header/login branding updates.
- Primary CTA buttons reflect selected color.
- Values persist after refresh.

### CUST-002: Update Environment Label and Login Subtitle
**Steps**
1. Edit environment label and login subtitle.
2. Save.
3. Log out and view login page.

**Expected**
- Updated environment label shown.
- Login subtitle updated.

### CUST-003: Invalid Color Input Handling
**Steps**
1. Enter invalid color (non-hex).
2. Save.

**Expected**
- System falls back to default valid color.
- No UI break.

---

## C. Inventory – HR Identities

### INV-HR-001: Upload HR Data
**Steps**
1. Go to Inventory > Identity Inventory.
2. Upload `01_hr_users_inventory.csv`.

**Expected**
- Users grid populates.
- Count and rows match CSV.

### INV-HR-002: Role Update (Single User)
**Steps**
1. Change one user role from dropdown in row actions.

**Expected**
- Role updates successfully.
- Updated role persists after refresh.

### INV-HR-003: Bulk Role Assignment Modal UX
**Steps**
1. Select multiple users.
2. Click `Set Role` (header).
3. In modal, choose role and click `Apply Role`.

**Expected**
- Modal opens only after `Set Role` click.
- Role applied to selected users.
- Selection clears after success.

### INV-HR-004: Bulk Role Assignment Guard
**Steps**
1. Do not select any users.
2. Observe `Set Role`.

**Expected**
- Button disabled or action blocked with clear message.

### INV-HR-005: Reset Password
**Steps**
1. Click `Reset Password` for one user.
2. Copy temporary password.
3. Close modal.

**Expected**
- Temporary password shown once.
- Copy action works.

---

## D. Inventory – Applications, Accounts, Entitlements, SoD

### INV-APP-001: Upload Applications
**Steps**
1. Inventory > App Configurations.
2. Upload `02_application_onboarding_bulk.csv`.

**Expected**
- App list created.
- Each app visible with owner.

### INV-APP-002: Add Application Manually
**Steps**
1. Click `Add Application`.
2. Fill required fields and save.

**Expected**
- New app appears in list.
- Missing required fields are validated.

### INV-ACC-001: Upload Accounts per App
**Steps**
1. Select APP_FIN; upload `03_accounts_APP_FIN.csv`.
2. Repeat for APP_HCM and APP_CRM.

**Expected**
- Account rows appear under each app.
- Correlation/orphan indicators computed correctly.

### INV-ENT-001: Upload Entitlements per App
**Steps**
1. For each app, upload corresponding `04_entitlements_*.csv`.

**Expected**
- Entitlement catalog updates.
- Privileged tags align with uploaded values.

### INV-SOD-001: Upload Global SoD Policies
**Steps**
1. Inventory > Global SoD Policies.
2. Upload `05_bulk_sod_policies.csv`.

**Expected**
- Policies list populated.
- Conflicts evaluated in impacted user/account views.

### INV-SOD-002: Create SoD Policy Manually
**Steps**
1. Click `New Policy`.
2. Fill both conditions and risk level.
3. Save.

**Expected**
- New policy appears in list.
- Duplicate policy name blocked.

### INV-SOD-003: Delete SoD Policy
**Steps**
1. Delete one existing SoD policy.

**Expected**
- Policy removed from list.
- No stale reference in policy detail modal.

### INV-ORPHAN-001: Orphan Detection
**Steps**
1. Review imported account records not present in HR.

**Expected**
- Expected orphan accounts marked (per e2e README examples).

---

## E. Campaign Launch & Dashboard

### UAR-LAUNCH-001: Launch Campaign for App with Accounts
**Steps**
1. Dashboard > `Launch Campaign`.
2. Pick app that has accounts.
3. Set due date and launch.

**Expected**
- Campaign launches successfully.
- Campaign visible in active list.

### UAR-LAUNCH-002: Launch Campaign for App with No Accounts
**Steps**
1. Pick an app that has zero accounts in backend.
2. Attempt launch.

**Expected**
- Launch blocked.
- Message: no accounts found for selected app.

### UAR-LAUNCH-003: Launch Campaign for Different Non-First Apps
**Steps**
1. Launch modal: try second/third app (not first in list).

**Expected**
- Works correctly for any app with accounts.
- No false “No accounts found” for valid apps.

### UAR-LAUNCH-004: Duplicate Active Campaign Guard
**Steps**
1. Launch campaign for app A.
2. Try launching again for app A before completion.

**Expected**
- Second launch blocked with already-running message.

### UAR-DASH-001: Campaign Detail Filters
**Steps**
1. Open campaign details.
2. Apply User/Entitlement/Decision/Remediation filters.

**Expected**
- Grid filters correctly.
- Empty state shown when no matches.

### UAR-DASH-002: Export Campaign
**Steps**
1. Open campaign detail.
2. Click `Export Campaign`.

**Expected**
- CSV downloads.
- Contains expected columns and current campaign data.

---

## F. Manager Portal Actions

### MGR-001: Approve Item
**Steps**
1. Login as manager.
2. Open pending item.
3. Approve with/without comment.

**Expected**
- Item status becomes `APPROVED`.
- Action logged in audit trail.

### MGR-002: Revoke Item
**Steps**
1. Revoke a pending item.

**Expected**
- Item status becomes `REVOKED`.
- Moves into remediation tracking.

### MGR-003: Reassign Item
**Steps**
1. Reassign a pending item to another manager.

**Expected**
- New reviewer set.
- Reassignment count updates.
- Email notification triggered (if configured).

### MGR-004: Bulk Reassign
**Steps**
1. In campaign detail, select multiple eligible items.
2. Bulk reassign.

**Expected**
- Eligible items reassigned.
- Ineligible items blocked/skipped per max limit.

### MGR-005: Confirm Review with Pending Remediation
**Steps**
1. Manager confirms while revoked/pending remediation items still exist.

**Expected**
- Campaign does NOT become `COMPLETED` prematurely.
- Remediation stage semantics remain correct.

---

## G. Remediation Verification

### REM-001: Revoke Then Remove in Source Accounts
**Steps**
1. Revoke entitlement in campaign.
2. Re-upload account data with entitlement removed.

**Expected**
- Item transitions to remediated/verified state per workflow.
- Pending remediation count decreases.

### REM-002: Revoke But Entitlement Still Present
**Steps**
1. Revoke entitlement.
2. Re-upload accounts where entitlement still exists.

**Expected**
- Item remains pending verification/remediation.
- Campaign not marked completed due to unresolved remediation.

---

## H. Notifications

### NOTIF-001: Launch Assignment Notifications
**Steps**
1. Launch new campaign with multiple reviewers.

**Expected**
- Assignment notifications attempted per reviewer.
- No app crash if provider not configured.

### NOTIF-002: Send Reminder (Admin)
**Steps**
1. Open campaign detail.
2. Click `Send Reminder`.

**Expected**
- Completion summary shown (`sent`, `skipped`).

### NOTIF-003: Escalate Pending (Admin)
**Steps**
1. Click `Escalate Pending`.

**Expected**
- Escalation summary shown.
- Pending review owners are targeted.

---

## I. Governance / Audit / My Access

### GOV-001: Audit Log Generation
**Steps**
1. Perform key actions: import, launch, approve/revoke, role change.
2. Open governance/audit view.

**Expected**
- Actions appear with actor, timestamp, and detail.

### GOV-002: Audit Filters
**Steps**
1. Filter by user, action, and date range.

**Expected**
- Results match filters.

### MYA-001: End-user My Access View
**Steps**
1. Login as normal user.
2. Open My Access.

**Expected**
- Only user’s own access displayed.
- No admin-only controls visible.

---

## J. Negative / Error Handling

### ERR-001: Upload Wrong CSV Header
**Steps**
1. Upload malformed file in HR/Accounts/Entitlements.

**Expected**
- Validation error shown.
- No partial destructive update.

### ERR-002: API Failure Handling
**Steps**
1. Temporarily make backend endpoint unavailable (or simulate).
2. Trigger related UI action.

**Expected**
- Friendly error shown.
- UI remains usable, no hard crash.

### ERR-003: Unauthorized Access
**Steps**
1. Login as non-admin.
2. Try admin-only actions (role update, app config, launch campaign).

**Expected**
- Admin actions hidden or blocked.

---

## K. Cross-Browser + Responsive Sanity

### UX-001: Browser Sanity
**Steps**
1. Run smoke suite in Chrome and Edge.

**Expected**
- No blocking visual/function differences.

### UX-002: Resolution Check
**Steps**
1. Validate key screens at 1366x768 and 1920x1080.

**Expected**
- No clipped critical controls.
- Modals remain usable.

---

## 4) Suggested Smoke Subset (Fast Regression)
Run these first on every build:
- AUTH-001, AUTH-002
- INV-HR-001, INV-APP-001, INV-ACC-001, INV-SOD-001
- UAR-LAUNCH-001, UAR-LAUNCH-002
- MGR-001, MGR-002, MGR-005
- GOV-001

## 5) Defect Logging Template
For each failed case, capture:
- Test Case ID
- Build/version
- Environment URL
- User role used
- Exact steps
- Actual result
- Expected result
- Screenshot / recording
- API response payload (if visible)
