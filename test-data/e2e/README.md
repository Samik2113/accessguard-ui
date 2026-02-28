# E2E Test Data Pack (Excel-ready CSV)

Use these files in this order:

1. `01_hr_users_inventory.csv`
2. `02_application_onboarding_bulk.csv`
3. For each app selected in Inventory > Applications:
   - `03_accounts_APP_FIN.csv` then `04_entitlements_APP_FIN.csv`
   - `03_accounts_APP_HCM.csv` then `04_entitlements_APP_HCM.csv`
   - `03_accounts_APP_CRM.csv` then `04_entitlements_APP_CRM.csv`
4. `05_bulk_sod_policies.csv`

Expected test outcomes:

- **Orphan accounts**: `ORP001`, `EXT901`, `EXT902`, `EXT903` should appear orphan (not in HR inventory).
- **Privileged markers**: rows with privileged entitlements (e.g. `FIN_AP_APPROVER`, `HCM_PAYROLL_ADMIN`, `CRM_ROLE_ADMIN`) should show privileged.
- **SoD conflicts (correlated)**:
  - `USR005` has `FIN_AP_APPROVER` + `HCM_PAYROLL_ADMIN`.
  - `USR006` has `FIN_VENDOR_MAINT` + `HCM_HR_MASTER_MAINT`.
  - `USR008` has `FIN_PAYMENT_RELEASE` + `CRM_ROLE_ADMIN`.
- **SoD conflicts (orphan)**:
  - `ORP001` / `orphan.ops@acme.com` has `FIN_PAYMENT_RELEASE` + `CRM_ROLE_ADMIN`.

Tip: open each `.csv` in Excel and save as `.xlsx` if needed for your test execution artifacts.
