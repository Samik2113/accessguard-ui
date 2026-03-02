# Excel Workbook Assembly (CSV Split Sheets)

Use this folder to create one `.xlsx` workbook with multiple sheets.

## Files
- `01_TestCases.csv` -> main test case sheet
- `02_SmokeSuite.csv` -> fast regression execution order
- `03_DefectLogTemplate.csv` -> defect tracker starter
- `04_RolePermissionsMatrix.csv` -> role-wise expected access matrix

## Steps (Excel Desktop)
1. Open Excel -> Blank workbook.
2. Go to **Data** -> **From Text/CSV**.
3. Import `01_TestCases.csv` -> click **Load To...** -> choose **Table** -> **New worksheet**.
4. Repeat for `02_SmokeSuite.csv`, `03_DefectLogTemplate.csv`, and `04_RolePermissionsMatrix.csv`, each to a **New worksheet**.
5. Rename sheets to:
   - `TestCases`
   - `SmokeSuite`
   - `Defects`
6. Save as `AccessGuard_Manual_TestSuite.xlsx`.

Suggested sheet names:
- `TestCases`
- `SmokeSuite`
- `Defects`
- `RolePermissionsMatrix`

## Optional formatting
- Freeze top row on all sheets.
- Add filter on headers.
- Set wrap text for `Steps` and `ExpectedOutcome` columns.
- Add data validation lists for `Status`, `Severity`, and `Priority` in `Defects`.
