# Extended E2E Test Data Pack

This pack is designed to validate the recent enhancements:
- App list scalability (group by app type + search)
- Upload-time mapping selectors (correlation and entitlement)
- App-specific mapping save
- Account status normalization
- Custom columns and ignore columns
- SoD conflict detection across app types

## Files

1. `06_hr_users_inventory_extended.csv`
2. `07_application_onboarding_bulk_grouped.csv`
3. `08_accounts_APP_APL_001_feed_with_mapping.csv`
4. `09_accounts_APP_DB_001_feed_with_mapping.csv`
5. `10_accounts_APP_SRV_001_feed_with_mapping.csv`
6. `11_bulk_sod_policies_extended.csv`
7. `12_entitlements_APP_APL_001_optional.csv` (optional because entitlements auto-sync from account upload)

## Recommended execution order

1. Upload HR users:
- Inventory > Identities > Upload HR
- Use `06_hr_users_inventory_extended.csv`

2. Upload applications:
- Inventory > Applications > Upload
- Use `07_application_onboarding_bulk_grouped.csv`
- Verify left panel is grouped by `Application`, `Database`, `Servers`, `Shared Mailbox`
- Test search using keywords like `oracle`, `jumpbox`, `shared mailbox`, `Finance`

3. Upload accounts for app `APP_APL_001`:
- Select app `Finance Access Hub`
- Upload `08_accounts_APP_APL_001_feed_with_mapping.csv`
- In mapping modal set:
  - Correlation Column -> `Emp_Code`
  - Entitlement Column -> `Access_Role`
- Suggested canonical mappings:
  - `loginId` -> `Login_Name`
  - `email` -> `Mail_Address`
  - `employeeId` -> `Emp_Code`
  - `role` -> `Access_Role`
  - `lastLoginAt` -> `Last_Login_TS`
  - `accountStatus` -> `Acct_Status`
  - `accountOwnerName` -> `Owner_Display`
- Set custom columns: `CostCenter`, `Location`, `Account_Owner_ID`
- Ignore column: `IgnoreMe`
- **Note**: `Account_Owner_ID` is a new column that maps generic accounts to their managing owners. When selected as custom, these appear in the accounts table so you can trace who manages each service/bot account.

4. Upload accounts for app `APP_DB_001`:
- Select app `FIN_ORACLE_PROD`
- Upload `09_accounts_APP_DB_001_feed_with_mapping.csv`
- In mapping modal set:
  - Correlation Column -> `DB_Login`
  - Entitlement Column -> `Role_Name`
- Suggested canonical mappings:
  - `loginName` -> `DB_Login`
  - `userType` -> `Account_Type`
  - `dbRole` -> `Role_Name`
  - `accountStatus` -> `State`
  - `createDate` -> `Created_On`
  - `userDetails` -> `Display_Name`
- Set custom columns: `DataCenter`, `Ticket_Number`, `Managed_By_Owner_ID`
- Ignore column: `Drop_Column`
- **Note**: `Managed_By_Owner_ID` shows which owner manages service/external database accounts.

5. Upload accounts for app `APP_SRV_001`:
- Select app `LINUX_JUMPBOX_PROD`
- Upload `10_accounts_APP_SRV_001_feed_with_mapping.csv`
- In mapping modal set:
  - Correlation Column -> `User_Identifier`
  - Entitlement Column -> `Privilege`
- Suggested canonical mappings:
  - `userId` -> `User_Identifier`
  - `userName` -> `User_Display`
  - `privilegeLevel` -> `Privilege`
  - `accountStatus` -> `Status_Text`
- Set custom columns: `Server_Host`, `OS_Family`, `Managed_By_Owner`
- Ignore column: `Ignore_Column`
- **Note**: `Managed_By_Owner` shows which admin manages service/bot server accounts.

6. Upload SoD policies:
- Inventory > SoD > Upload
- Use `11_bulk_sod_policies_extended.csv`

7. Optional entitlement upload:
- Select app `APP_APL_001`
- Upload `12_entitlements_APP_APL_001_optional.csv`

## Generic Account IDs & Owner Mapping

This pack includes two account ownership scenarios:

### 1. Normal Users Own Themselves
- Regular HR-correlated users (USR001, USR002, etc.) have **empty owner ID** → system treats owner as the user themselves
- Active users with direct HR correlation
- Example: `USR001` owns the `FIN_USER` role on the Finance app

### 2. Special Accounts Need Explicit Owner Mapping
Only these special account types require explicit `Account_Owner_ID`, `Managed_By_Owner_ID`, or `Managed_By_Owner`:

**Application Feed (08_accounts_APP_APL_001_feed_with_mapping.csv)**

| Account ID | Type | Status | Owner Mapped To | Reason |
|--|--|--|--|--|
| SVC_FIN_AP | Service Account | Active | OWN001 | System automation, needs owner assignment |
| SVC_BATCH_PROC | Service Account | Active | OWN007 | Batch automation, needs owner assignment |
| USR008 | Disabled User | Inactive | OWN001 | Disabled account needs owner tracking |
| EXT901 | External/Contractor | Disabled | OWN001 | Third-party contractor needs owner |
| APP_BOT_VENDOR | Bot/Automation | Active | OWN001 | Automated process, needs owner assignment |

**Database Feed (09_accounts_APP_DB_001_feed_with_mapping.csv)**

| Account ID | Type | Status | Owner Mapped To | Reason |
|--|--|--|--|--|
| SVC_ETL_EXEC | Service Account | Active | OWN010 | ETL automation service |
| USR017 | Disabled User | Inactive | OWN010 | Inactive user needs ownership tracking |
| DBA_CONTRACTOR | External/Contractor | Active | OWN010 | Third-party contractor DBA |
| SVC_AUDIT_AUTO | Service Account | Active | OWN010 | Compliance automation service |
| BKP_MAINT_ACCT | Service Account | Active | OWN010 | Backup service account |

**Server Feed (10_accounts_APP_SRV_001_feed_with_mapping.csv)**

| Account ID | Type | Status | Owner Mapped To | Reason |
|--|--|--|--|--|
| SVC_BACKUP | Service Account | Active | OWN011 | Server backup service |
| USR025 | Disabled User | Inactive | OWN011 | Inactive user needs tracking |
| USR017 | Disabled User | Disabled | OWN011 | Disabled user needs tracking |
| SVC_MONITORING | Service Account | Active | OWN011 | Monitoring/alerting service |
| SVC_DEPLOY_BOT | Bot/Automation | Active | OWN011 | CI/CD automation bot |

### Testing Owner Mapping

When uploading accounts, the app should:
1. For normal users (empty owner ID): correlate via HR employee ID; owner = user themselves
2. For special accounts (owner ID populated): use the mapped owner for governance tracking
3. Render owner mapping column in the accounts table (when selected as custom column) to show who manages each special account

## Expected outcomes checklist

- App list shows grouped sections by app type with counts.
- Search quickly narrows app list across name and type keywords.
- Upload mapping modal requires explicit correlation and entitlement column selections.
- `Acct_Status`, `State`, `Status_Text` normalize to `ACTIVE` or `INACTIVE` where applicable.
- Custom columns render in the accounts table for each app (including owner mapping columns).
- Ignored columns do not appear in mapped account payloads.
- **Owner mapping**:
  - Normal users (USR001, USR002, etc.) own themselves; empty owner ID in feed
  - Disabled users (USR008, USR017, USR025) show explicit owner ID
  - Service accounts (SVC_*) show explicit owner ID
  - Bot/external accounts show explicit owner ID
  - Owner mapping columns are visible in accounts table when selected as custom columns
- SoD conflicts appear for combinations involving:
  - `FIN_ADMIN` + `DB_SUPERUSER`
  - `FIN_APPROVER` + `root`
  - `DB_DDL_ADMIN` + `admin`

## Notes

- CSV parser is simple; avoid commas inside field values.
- If needed for manual QA artifacts, open CSV in Excel and save as XLSX.