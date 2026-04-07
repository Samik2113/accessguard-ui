# Governance Module Design Specification

## Scope
- System types in scope: Applications, Databases, Servers, Shared Mailboxes, Shared Folders.
- Identity types in scope: Human, Privileged, Service/System, Shared, Orphan, Dormant.
- Primary consumers: CISO, CIO, Head of Security, Audit leadership, Risk leadership, Board read-only users.
- Primary analytic grain: access grant, review item, remediation action, unresolved risk finding, approved exception.

## Common Metric Conventions
- Reporting period default: trailing 12 months unless overridden by dashboard filter.
- Active access grant: access record where access_status = `ACTIVE` and revoked_at is null.
- Open risk: risk record where risk_status in (`OPEN`, `IN_PROGRESS`, `ESCALATED`, `ACCEPTED`) and resolved_at is null.
- Overdue review: review item where due_at < current_timestamp and review_decision_status in (`PENDING`, `REASSIGNED`).
- Overdue remediation: remediation action where remediation_due_at < current_timestamp and action_status not in (`COMPLETED`, `CANCELLED`).
- Dormant account: access record where last_used_at is null or days_between(current_date, last_used_at) >= dormant_days_threshold from system policy.
- Orphan account: access record where correlated_identity_id is null and owner_identity_id is null.
- Shared account: access record where identity_type = `SHARED` or account_type = `SHARED_ACCOUNT`.
- Excessive access: risk record where risk_category = `EXCESSIVE_ACCESS`.

## Risk Weighting Model
- Severity weight mapping:
  - `CRITICAL` = 10
  - `HIGH` = 7
  - `MEDIUM` = 4
  - `LOW` = 1
- Per-access capped weighted risk:
  - `access_weighted_risk` = least(15, sum(severity_weight for all open risks linked to the same access_id))
- Enterprise overall access risk score:
  - `overall_access_risk_score` = least(100, round(100 * sum(access_weighted_risk) / nullif(count(distinct active access_id) * 15, 0), 1))
- Identity risk score:
  - `identity_risk_score` = sum(severity_weight for open risks linked to identity_id) + 2 * overdue_review_item_count + 3 * overdue_remediation_count
- System risk score:
  - `system_risk_score` = sum(severity_weight for open risks linked to system_id) / nullif(count(distinct active access_id for system_id), 0)

## Global Filter Framework
- Time period
- System type
- System / application
- Business unit
- Geography / country / region
- Identity type
- Reviewer type
- Risk category
- Risk severity
- Remediation owner group
- Exception status

## A. Executive Governance Dashboard

### Dashboard Name
- Executive Governance Dashboard

### Target Audience
- CISO, CIO, Head of Security, Audit leadership, Board read-only users

### Purpose
- Present the current enterprise access governance posture, review execution health, and the most material access risks requiring leadership attention.

### Layout
- Top row: 4 KPI tiles
- Middle row: privileged exposure, orphan/dormant exposure, completion/SLA
- Bottom row: system and business unit heatmap, monthly trend

### Widgets / Sections Included

| Widget Name | Widget Type | Exact Metric Definition | Required Data Fields | Filters Available | Risk Thresholds | Drill-down Path |
| --- | --- | --- | --- | --- | --- | --- |
| Overall Access Risk Score | KPI tile with delta trend | `least(100, round(100 * sum(least(15, severity_weight_sum_per_access)) / nullif(count(distinct active_access.access_id) * 15, 0), 1))`; prior period delta = current score minus previous period score | `access.access_id`, `access.access_status`, `risk.access_id`, `risk.risk_status`, `risk.risk_severity`, `calendar.period_start`, `calendar.period_end` | Time, system type, business unit, geography | Green `<=20`; Amber `>20 and <=40`; Red `>40` | Click opens Access Risk Governance Dashboard filtered to current scope and sorted by highest weighted open risks |
| Privileged Access Risk Summary | Stacked KPI tile group | `privileged_open_risks = count(distinct risk_id where is_privileged=true and risk_status in open states)`; `privileged_orphan_count = count(distinct access_id where is_privileged=true and orphan_flag=true)`; `privileged_dormant_count = count(distinct access_id where is_privileged=true and dormant_flag=true)` | `access.access_id`, `access.is_privileged`, `access.orphan_flag`, `access.dormant_flag`, `risk.risk_id`, `risk.risk_status` | Time, system type, system, business unit | Green `<2%` of privileged access population flagged; Amber `2%-5%`; Red `>5%` | Click opens Privileged Access Governance Dashboard with current filter context |
| Orphan and Dormant Account Exposure | KPI tile with stacked sub-counts | `orphan_exposure = count(distinct active access_id where orphan_flag=true)`; `dormant_exposure = count(distinct active access_id where dormant_flag=true)`; `orphan_privileged = count(distinct access_id where orphan_flag=true and is_privileged=true)` | `access.access_id`, `access.access_status`, `access.orphan_flag`, `access.dormant_flag`, `access.is_privileged`, `access.last_used_at` | Time, system type, system, identity type, geography | Green `<1%` of active access grants; Amber `1%-3%`; Red `>3%` | Click opens Access Risk Governance Dashboard filtered to `ORPHAN` and `DORMANT` categories |
| Review Completion and SLA Status | KPI tile group | `completion_rate = completed_review_items / total_review_items_due_in_period * 100`; `overdue_rate = overdue_review_items / total_open_review_items * 100`; `sla_met_rate = review_items_completed_within_sla / completed_review_items * 100` | `review.review_item_id`, `review.due_at`, `review.completed_at`, `review.review_decision_status`, `review.sla_due_at` | Time, reviewer type, system type, business unit | Green `completion_rate >=95 and overdue_rate <5`; Amber `completion_rate 85-95 or overdue_rate 5-10`; Red otherwise | Click opens Access Review Effectiveness Dashboard filtered to overdue and SLA views |
| High-Risk Systems and Business Units | Dual-axis heatmap | Heatmap cell value = `sum(severity_weight for open risks)` by `system_name x business_unit`; alternate view by `system_name x geography`; top labels = highest 10 cells | `risk.risk_id`, `risk.risk_status`, `risk.risk_severity`, `system.system_id`, `system.system_name`, `identity.business_unit`, `identity.geography` | Time, system type, risk category, severity | Green `system_risk_score <0.10`; Amber `0.10-0.25`; Red `>0.25` | Click on cell opens Access Risk Governance Dashboard filtered to selected system and business unit/geography |
| Enterprise Risk Trend | Line chart | Monthly point = `sum(severity_weight for open risks at month end)` and secondary line = `overall_access_risk_score`; quarterly toggle aggregates by fiscal quarter end | `risk.risk_id`, `risk.opened_at`, `risk.resolved_at`, `risk.risk_severity`, `calendar.month_end`, `calendar.quarter_end`, `access.access_id`, `access.access_status` | Time granularity, system type, business unit, risk category | Green declining `>=10%` over last 3 periods; Amber flat `-10% to +10%`; Red rising `>10%` | Click on month or quarter opens period snapshot with top deltas by risk category |

### Suggested Refresh Frequency
- Executive landing metrics every 4 hours
- Trend aggregations nightly

### Drill-down Path
- Executive Dashboard -> Access Risk Governance / Review Effectiveness / Privileged Governance -> system -> identity -> access grant -> review item / action / exception detail

## B. Access Risk Governance Dashboard

### Dashboard Name
- Access Risk Governance Dashboard

### Target Audience
- CISO staff, Security leadership, Risk leadership, IAM leadership

### Purpose
- Show where access risk is concentrated, how it is distributed, and which identities and systems require prioritization.

### Layout
- Top row: category mix and aging
- Middle row: system heatmap and business unit/geography concentration
- Bottom row: top identities table and risk backlog trend

### Widgets / Sections Included

| Widget Name | Widget Type | Exact Metric Definition | Required Data Fields | Filters Available | Risk Thresholds | Drill-down Path |
| --- | --- | --- | --- | --- | --- | --- |
| Risk by Category | Stacked bar chart | `count(distinct risk_id)` and `sum(severity_weight)` grouped by `risk_category in (PRIVILEGED, ORPHAN, EXCESSIVE_ACCESS, DORMANT, SHARED)` for open risks | `risk.risk_id`, `risk.risk_category`, `risk.risk_status`, `risk.risk_severity` | Time, system type, business unit, geography, severity | Green no category above `20%` of total weighted risk; Amber any category `20%-35%`; Red any category `>35%` | Click category opens filtered risk list by category |
| Risk Heatmap by System | Heatmap | Cell value = `sum(severity_weight for open risks linked to system_id)`; tooltip also shows `count(distinct impacted identities)` and `count(distinct access_id)` | `risk.system_id`, `risk.risk_severity`, `risk.risk_status`, `risk.identity_id`, `risk.access_id`, `system.system_name` | Time, system type, business unit, geography, category | Green `<25` weighted points; Amber `25-75`; Red `>75` per system-period cell | Click cell opens system detail page with risk inventory |
| Risk by Business Unit and Geography | Treemap or matrix | Node size = `sum(severity_weight)`; node label count = `count(distinct risk_id)` by `business_unit` and `geography` | `risk.risk_id`, `risk.risk_severity`, `risk.risk_status`, `identity.business_unit`, `identity.geography` | Time, system type, category, severity | Green `<10%` enterprise weighted share; Amber `10%-20%`; Red `>20%` | Click node opens identity and system breakdown for selected unit/geography |
| Top 10 Riskiest Identities | Ranked table | Rank by `identity_risk_score = sum(severity_weight for open risks linked to identity_id) + 2 * overdue_review_items + 3 * overdue_remediation_items`; show count of critical risks and privileged flags | `identity.identity_id`, `identity.display_name`, `identity.identity_type`, `risk.identity_id`, `risk.risk_severity`, `review.review_item_id`, `review.review_decision_status`, `review.due_at`, `action.action_id`, `action.action_status`, `action.remediation_due_at`, `access.is_privileged` | Time, business unit, geography, identity type, system type | Green top identity score `<10`; Amber `10-24`; Red `>=25` | Click identity opens identity risk profile and all linked access grants |
| Risk Aging | Histogram / stacked bar | Bucket open risks by `days_open = current_date - risk_opened_at` into `0-30`, `31-60`, `61-90`, `91-180`, `180+`; value = `count(distinct risk_id)` and weighted risk sum | `risk.risk_id`, `risk.opened_at`, `risk.resolved_at`, `risk.risk_status`, `risk.risk_severity` | Time, category, severity, system type, business unit | Green `<=10%` of risks in `91+`; Amber `10%-20%`; Red `>20%` | Click bucket opens unresolved risks aged in selected band |
| Access Risk Backlog Trend | Trend graph | Period value = `count(distinct open risk_id)`; secondary value = `count(distinct resolved risk_id)`; net change = open minus resolved per period | `risk.risk_id`, `risk.opened_at`, `risk.resolved_at`, `risk.risk_status`, `calendar.period_start` | Time granularity, category, severity, system type | Green resolved/open ratio `>=1.0`; Amber `0.8-0.99`; Red `<0.8` | Click period opens opened vs resolved inventory by category |

### Suggested Refresh Frequency
- Every 2 hours for open risk views
- Nightly for historical aging and trend materializations

### Drill-down Path
- Risk category / system / geography -> risk inventory -> identity -> access grant -> review item -> remediation action or exception record

## C. Access Review Effectiveness Dashboard

### Dashboard Name
- Access Review Effectiveness Dashboard

### Target Audience
- Security operations leadership, IAM program leadership, Audit leadership

### Purpose
- Measure whether review campaigns are broad enough, completed on time, and producing decision quality rather than administrative approvals.

### Layout
- Top row: coverage, completion, approval ratio
- Middle row: reviewer quality and cycle time
- Bottom row: reviewer analytics table and behavior outliers

### Widgets / Sections Included

| Widget Name | Widget Type | Exact Metric Definition | Required Data Fields | Filters Available | Risk Thresholds | Drill-down Path |
| --- | --- | --- | --- | --- | --- | --- |
| Review Coverage | Dual KPI tiles | `system_coverage_pct = count(distinct system_id reviewed in period) / count(distinct in-scope system_id) * 100`; `identity_coverage_pct = count(distinct identity_id reviewed in period) / count(distinct in-scope identity_id) * 100` | `review.review_campaign_id`, `review.system_id`, `review.identity_id`, `review.campaign_start_at`, `system.in_scope_flag`, `identity.review_scope_flag` | Time, system type, business unit, geography, reviewer type | Green `>=95%`; Amber `85%-94.9%`; Red `<85%` | Click tile opens uncovered systems or uncovered identities list |
| Completion vs Overdue Reviews | Stacked bar / KPI combo | `completed = count(review_item_id where review_decision_status in completed statuses)`; `overdue = count(review_item_id where due_at < now and review_decision_status in pending statuses)`; `open_not_due = open total - overdue` | `review.review_item_id`, `review.review_decision_status`, `review.due_at`, `review.completed_at` | Time, campaign, reviewer type, system type, business unit | Green overdue `<5%` of due review items; Amber `5%-10%`; Red `>10%` | Click status segment opens campaign and reviewer backlog |
| Approval vs Revoke Ratio | Donut or bar chart | `approval_rate = approved_review_items / total_completed_review_items * 100`; `revoke_rate = revoked_review_items / total_completed_review_items * 100`; ratio displayed as `approved : revoked` | `review.review_item_id`, `review.review_decision_status`, `review.completed_at` | Time, system, system type, business unit, reviewer type, risk category | Green revoke rate `>=3% and <=25%`; Amber revoke rate `1%-3% or 25%-35%`; Red revoke rate `<1%` with high-risk population or `>35%` | Click segment opens decision distribution by system and reviewer |
| Rubber-Stamp Indicator | KPI tile with threshold bands | `rubber_stamp_rate = count(review_item_id where review_decision_status='APPROVED' and coalesce(comment_length,0)=0 and datediff(second, assigned_at, completed_at) <= 30 and evidence_open_count = 0) / count(completed_review_items) * 100` | `review.review_item_id`, `review.review_decision_status`, `review.assigned_at`, `review.completed_at`, `review.comment_text`, `review.evidence_open_count` | Time, reviewer, reviewer type, system, business unit | Green `<10%`; Amber `10%-20%`; Red `>20%` | Click KPI opens reviewer outlier list ranked by rubber-stamp rate |
| Average Review Completion Time | Line chart / KPI | `avg_review_completion_hours = avg(datediff(hour, assigned_at, completed_at))` for completed review items; compare by period and by reviewer type | `review.review_item_id`, `review.assigned_at`, `review.completed_at`, `review.reviewer_type`, `review.review_decision_status` | Time, reviewer type, system type, business unit, geography | Green `<=72h`; Amber `>72h and <=120h`; Red `>120h` | Click line point opens completion time distribution and outliers |
| Reviewer Behavior Analytics | Table with sparkbars | Per reviewer: `items_completed`, `approval_rate`, `revoke_rate`, `avg_completion_hours`, `rubber_stamp_rate`, `reassignment_rate = reassigned_items / assigned_items * 100`; sorted by highest risk of weak review behavior | `review.reviewer_id`, `review.review_item_id`, `review.review_decision_status`, `review.assigned_at`, `review.completed_at`, `review.reassigned_flag`, `review.comment_text`, `review.evidence_open_count`, `identity.display_name` | Time, reviewer organization, system type, business unit | Green reviewer quality score `>=80`; Amber `60-79`; Red `<60`; score formula = `100 - rubber_stamp_rate - overdue_rate*2 - reassignment_rate` floored at 0 | Click reviewer opens reviewer profile with campaign history |

### Suggested Refresh Frequency
- Every hour for operational completion metrics
- Nightly for reviewer quality and history trends

### Drill-down Path
- Coverage / completion / reviewer widgets -> campaign -> reviewer -> review item -> access grant -> remediation outcome

## D. Privileged Access Governance Dashboard

### Dashboard Name
- Privileged Access Governance Dashboard

### Target Audience
- CISO, Head of Security, PAM owners, Audit leadership

### Purpose
- Provide executive oversight of elevated access exposure across human and non-human identities, including inactivity, orphaning, and standing privilege.

### Layout
- Top row: privileged population, orphan privileged, standing vs time-bound
- Middle row: inactive privileged exposure and trend
- Bottom row: top privileged systems and non-human privileged inventory

### Widgets / Sections Included

| Widget Name | Widget Type | Exact Metric Definition | Required Data Fields | Filters Available | Risk Thresholds | Drill-down Path |
| --- | --- | --- | --- | --- | --- | --- |
| Total Privileged Accounts | KPI tile split by identity class | `count(distinct access_id where is_privileged=true and access_status='ACTIVE')`; segment into `human`, `service/system`, `shared`, `orphan` by identity_type and orphan_flag | `access.access_id`, `access.is_privileged`, `access.access_status`, `identity.identity_type`, `access.orphan_flag` | Time, system type, system, business unit, geography | Green privileged population stable or declining vs prior period; Amber increase `0%-10%`; Red increase `>10%` without approved exception | Click opens privileged inventory list by identity class |
| Orphan Privileged IDs | KPI tile | `count(distinct access_id where is_privileged=true and orphan_flag=true and access_status='ACTIVE')`; secondary metric `orphan_privileged_pct = orphan_privileged / total_privileged * 100` | `access.access_id`, `access.is_privileged`, `access.orphan_flag`, `access.access_status` | Time, system, system type, business unit | Green `<0.5%`; Amber `0.5%-2%`; Red `>2%` | Click opens orphan privileged access detail list |
| Standing vs Time-Bound Privileged Access | Stacked bar chart | `standing = count(distinct access_id where is_privileged=true and privilege_assignment_type='STANDING')`; `time_bound = count(distinct access_id where is_privileged=true and privilege_assignment_type='TIME_BOUND' and privilege_end_at >= current_date)` | `access.access_id`, `access.is_privileged`, `access.privilege_assignment_type`, `access.privilege_start_at`, `access.privilege_end_at` | Time, system, identity type, business unit | Green standing `<=30%` of privileged population; Amber `30%-50%`; Red `>50%` | Click segment opens privileged grants with assignment type filter |
| Privileged Access Without Recent Usage | Bar chart / KPI | `unused_privileged = count(distinct access_id where is_privileged=true and (last_used_at is null or datediff(day,last_used_at,current_date) >= 30) and access_status='ACTIVE')` | `access.access_id`, `access.is_privileged`, `access.last_used_at`, `access.access_status`, `system.dormant_days_threshold` | Time, system, identity type, business unit, geography | Green `<5%`; Amber `5%-10%`; Red `>10%` | Click opens privileged dormant inventory and last usage details |
| Privileged Risk Trend | Line chart | Period value = `sum(severity_weight for open risks where risk_category in ('PRIVILEGED','ORPHAN') and is_privileged=true)`; secondary line = `orphan privileged count` | `risk.risk_id`, `risk.risk_category`, `risk.risk_severity`, `risk.risk_status`, `access.is_privileged`, `access.orphan_flag`, `calendar.period_start` | Time granularity, system type, business unit | Green declining `>=10%` over 3 periods; Amber flat; Red increasing `>10%` | Click period opens privileged risk breakdown by system |
| Top Privileged Systems | Ranked table | Rank systems by `count(distinct privileged access_id)` and `sum(severity_weight for open privileged risks)` | `system.system_id`, `system.system_name`, `access.access_id`, `access.is_privileged`, `risk.risk_id`, `risk.risk_severity`, `risk.risk_status` | Time, system owner, geography | Green `system_risk_score <0.10`; Amber `0.10-0.20`; Red `>0.20` | Click system opens privileged system detail with identity inventory |

### Suggested Refresh Frequency
- Hourly for operational counts
- Nightly for trend rollups

### Drill-down Path
- Privileged population -> privileged system -> identity -> access grant -> review history -> remediation / exception

## E. Remediation and Action Governance Dashboard

### Dashboard Name
- Remediation and Action Governance Dashboard

### Target Audience
- IAM leadership, IT operations leadership, application owners, Audit leadership

### Purpose
- Prove that review outcomes and risk decisions are being executed, tracked to closure, and escalated when action owners miss deadlines.

### Layout
- Top row: initiated vs completed, SLA adherence, open actions
- Middle row: owner breakdown and escalation trend
- Bottom row: aged backlog and failed actions

### Widgets / Sections Included

| Widget Name | Widget Type | Exact Metric Definition | Required Data Fields | Filters Available | Risk Thresholds | Drill-down Path |
| --- | --- | --- | --- | --- | --- | --- |
| Revoke Actions Initiated vs Completed | Dual bar chart | `initiated = count(action_id where action_type='REVOKE' and created_at in period)`; `completed = count(action_id where action_type='REVOKE' and action_status='COMPLETED' and completed_at in period)`; `completion_ratio = completed / initiated * 100` | `action.action_id`, `action.action_type`, `action.created_at`, `action.action_status`, `action.completed_at` | Time, system type, system, owner group, business unit | Green `completion_ratio >=90%`; Amber `75%-89.9%`; Red `<75%` | Click bar opens remediation queue by status |
| Action SLA Adherence | KPI tile | `sla_adherence_pct = count(action_id where completed_at <= remediation_due_at) / count(action_id where completed_at is not null) * 100`; also show `overdue_open_actions` | `action.action_id`, `action.remediation_due_at`, `action.completed_at`, `action.action_status` | Time, owner group, system type, severity | Green `>=95%`; Amber `85%-94.9%`; Red `<85%` | Click opens overdue action list |
| Open Remediation Items | KPI tile with backlog mix | `open_remediation = count(action_id where action_status in ('OPEN','IN_PROGRESS','FAILED','ESCALATED'))`; split by severity and action owner group | `action.action_id`, `action.action_status`, `action.risk_severity`, `action.owner_group`, `action.system_id` | Time, owner group, system type, business unit, severity | Green backlog age median `<=15 days`; Amber `16-30`; Red `>30` | Click opens open action inventory |
| Ownership Breakdown | Horizontal stacked bar | `count(action_id)` grouped by `owner_group in (IAM, IT_OPS, APP_OWNER, SECURITY_OPS, DB_ADMIN, SERVER_ADMIN, MAIL_ADMIN, FILE_OWNER)` with open/completed split | `action.action_id`, `action.owner_group`, `action.action_status` | Time, system type, business unit, severity | Green no owner group has overdue ratio `>5%`; Amber any owner group `5%-15%`; Red any owner group `>15%` | Click owner group opens owner workload and SLA profile |
| Escalations Triggered Due to Non-Closure | Line chart | `count(action_id where escalation_count > 0 and escalation_triggered_at in period)`; secondary metric `avg days to first escalation` | `action.action_id`, `action.escalation_count`, `action.escalation_triggered_at`, `action.created_at` | Time, owner group, system type, severity | Green declining `>=10%`; Amber flat; Red increasing `>10%` | Click period opens escalated actions and responsible owners |
| Remediation Aging Backlog | Aging table / bar chart | Bucket open remediation by `days_open = current_date - created_at` into `0-15`, `16-30`, `31-60`, `61-90`, `90+`; value = `count(action_id)` and `sum(weighted risk linked)` | `action.action_id`, `action.created_at`, `action.action_status`, `action.risk_id`, `risk.risk_severity` | Time, owner group, severity, system type | Green `90+` bucket `<5%`; Amber `5%-10%`; Red `>10%` | Click bucket opens aged remediation queue |

### Suggested Refresh Frequency
- Every 30 minutes for action status
- Nightly for aging and trend metrics

### Drill-down Path
- Owner group / status / escalation -> action queue -> action detail -> linked review item -> linked access grant -> linked risk / exception

## F. Exception and Risk Acceptance Dashboard

### Dashboard Name
- Exception and Risk Acceptance Dashboard

### Target Audience
- Risk leadership, Security leadership, Audit leadership, Board read-only users

### Purpose
- Govern business-approved risk acceptance decisions, their duration, concentration, and cumulative residual exposure.

### Layout
- Top row: active exceptions and expiring windows
- Middle row: repeat exceptions and approver concentration
- Bottom row: accepted risk exposure and system concentration

### Widgets / Sections Included

| Widget Name | Widget Type | Exact Metric Definition | Required Data Fields | Filters Available | Risk Thresholds | Drill-down Path |
| --- | --- | --- | --- | --- | --- | --- |
| Active Risk Exceptions | KPI tile | `count(exception_id where exception_status='APPROVED' and exception_start_at <= current_date and exception_end_at >= current_date)`; secondary `active_exception_weight = sum(severity_weight of linked risks)` | `exception.exception_id`, `exception.exception_status`, `exception_start_at`, `exception_end_at`, `exception.risk_id`, `risk.risk_severity` | Time, system, business unit, risk category, approver | Green active exception count stable or declining; Amber increase `0%-10%`; Red increase `>10%` | Click opens active exception register |
| Expiring Exceptions 30/60/90 | Stacked bar | `expiring_30 = count(exception_id where days_to_expiry between 0 and 30)`; `expiring_60 = count where 31-60`; `expiring_90 = count where 61-90` for approved active exceptions | `exception.exception_id`, `exception.exception_end_at`, `exception.exception_status` | Time, system, business unit, approver | Green no critical exception in `<30 days`; Amber any high-severity exception in `<30 days`; Red any critical exception in `<30 days` without renewal decision | Click bucket opens expiring exceptions list |
| Repeated Exceptions by System | Ranked bar chart | `repeat_exception_count = count(exception_id)` grouped by `system_id` over trailing 12 months where same `risk_category` recurs on same system more than once | `exception.exception_id`, `exception.system_id`, `exception.risk_category`, `exception.created_at`, `system.system_name` | Time, system type, business unit, category | Green no system with `>2` repeats; Amber any system with `3-4`; Red any system with `>=5` | Click system opens exception history and underlying risks |
| Risk Acceptance Approvers | Table / bar chart | Per approver: `approved_exception_count`, `weighted_exposure_approved = sum(severity_weight of linked risks)`, `avg exception duration days` | `exception.approver_identity_id`, `exception.exception_id`, `exception.exception_start_at`, `exception.exception_end_at`, `risk.risk_severity`, `identity.display_name` | Time, approver organization, system type, business unit | Green no approver above `20%` of accepted weighted exposure; Amber `20%-35%`; Red `>35%` concentration | Click approver opens approved exception portfolio |
| Risk Exposure from Accepted Risks | KPI tile plus trend | `accepted_risk_exposure = sum(severity_weight for risks linked to active approved exceptions)`; secondary `accepted_exposure_pct = accepted_risk_exposure / total_open_weighted_risk * 100` | `exception.exception_id`, `exception.exception_status`, `exception.exception_start_at`, `exception.exception_end_at`, `exception.risk_id`, `risk.risk_severity`, `risk.risk_status` | Time, system type, business unit, geography, category | Green `<10%`; Amber `10%-20%`; Red `>20%` | Click opens accepted-risk inventory by system and category |
| Exception Aging and Renewal Profile | Trend / histogram | `avg_exception_age_days = avg(current_date - exception_created_at for active exceptions)`; `renewal_rate = count(exception_id with renewal_count > 0) / active exceptions * 100` | `exception.exception_id`, `exception.created_at`, `exception.renewal_count`, `exception.exception_status` | Time, system, business unit, approver, category | Green renewal rate `<10%`; Amber `10%-20%`; Red `>20%` | Click opens renewal candidates and repeated approvals |

### Suggested Refresh Frequency
- Every 4 hours for active exception register
- Nightly for aging and recurrence models

### Drill-down Path
- Exception summary -> system / approver / category -> exception detail -> linked risk -> linked access grant -> review and remediation history

## Board and Audit Report Definitions

## 1. Quarterly Access Governance Board Report

### Intended Reader
- Board, Board Risk Committee, CIO, CISO

### Timeframe
- Quarterly, with prior-quarter comparison and trailing four-quarter trend

### Data Sources Used
- `system`, `identity`, `access`, `risk`, `review`, `action`, `exception`

### Report Sections
- Executive summary of enterprise risk posture
- Quarterly movement in overall access risk score
- Top 10 high-risk systems and business units
- Privileged, orphan, and dormant exposure summary
- Review completion and overdue position
- Remediation closure performance
- Exception and risk acceptance concentration
- Material changes since prior quarter

### KPIs Included
- Overall Access Risk Score
- Weighted open risk count
- Privileged orphan count
- Dormant privileged count
- Review coverage percentage
- Review overdue percentage
- Remediation SLA adherence
- Accepted risk exposure percentage

## 2. Privileged Access Oversight Report

### Intended Reader
- CISO, PAM leadership, Audit, Regulator on request

### Timeframe
- Monthly and quarterly views

### Data Sources Used
- `identity`, `access`, `risk`, `review`, `action`, `exception`, `system`

### Report Sections
- Total privileged population by identity type and system type
- Standing vs time-bound privileged access
- Orphan privileged and dormant privileged inventory summary
- Top privileged systems by weighted risk
- Unused privileged access older than policy threshold
- Review outcomes for privileged access
- Open privileged remediation backlog
- Active privileged exceptions

### KPIs Included
- Total privileged active grants
- Orphan privileged percentage
- Standing privileged percentage
- Privileged access unused 30+ days
- Weighted privileged risk exposure
- Privileged revoke completion ratio
- Privileged exception count and exposure

## 3. Audit Evidence Report – Access Reviews

### Intended Reader
- Internal Audit, External Audit, Regulator

### Timeframe
- User-selectable period; default to specific audit quarter

### Data Sources Used
- `review`, `review campaign`, `access`, `identity`, `system`, `action`, `audit event`

### Report Sections
- Population in scope and coverage evidence
- Campaign register with launch and due dates
- Reviewer assignment and completion evidence
- Decision inventory: approved, revoked, remediated, pending
- Overdue review exceptions and rationale
- Reassignment log and reviewer trail
- Remediation evidence for revoked access
- Control exceptions and accepted risks impacting review scope

### KPIs Included
- Reviewed systems count
- Reviewed identities count
- Review item completion percentage
- Approval vs revoke counts
- Reassignment rate
- Overdue review count
- Revoked items completed through remediation
- Audit evidence completeness percentage

## 4. Orphan and Dormant Account Compliance Report

### Intended Reader
- Audit, Security Operations, Compliance, Regulator

### Timeframe
- Monthly with trend over trailing 12 months

### Data Sources Used
- `identity`, `access`, `risk`, `review`, `action`, `system`, `exception`

### Report Sections
- Current orphan account inventory by system type
- Current dormant account inventory by aging bucket
- Orphan and dormant privileged exposure
- Review status of orphan and dormant populations
- Open remediation backlog for orphan and dormant risks
- Systems with repeated orphan or dormant findings
- Approved exceptions affecting orphan and dormant access

### KPIs Included
- Orphan active access count
- Dormant active access count
- Orphan privileged count
- Dormant privileged count
- Orphan and dormant review coverage
- Orphan and dormant remediation overdue count
- Repeated orphan-risk systems
- Accepted orphan and dormant risk exposure

## Common Analytics Data Model

### Core Tables

| Table | Primary Key | Key Fields | Notes |
| --- | --- | --- | --- |
| Identity | `identity_id` | `identity_id`, `source_identity_key`, `display_name`, `email`, `identity_type`, `employment_status`, `business_unit`, `department`, `cost_center`, `manager_identity_id`, `geography`, `country`, `region`, `is_privileged_identity`, `is_service_identity`, `is_shared_identity`, `created_at`, `updated_at` | One record per logical identity, including non-human identities where ownership is known |
| System | `system_id` | `system_id`, `system_name`, `system_type`, `criticality`, `owner_identity_id`, `owner_group`, `business_unit`, `geography`, `in_scope_flag`, `dormant_days_threshold`, `privileged_policy_required`, `regulatory_tags`, `created_at`, `updated_at` | Covers applications, databases, servers, shared mailboxes, shared folders |
| Access | `access_id` | `access_id`, `system_id`, `identity_id`, `correlated_identity_id`, `owner_identity_id`, `account_native_id`, `account_name`, `account_type`, `identity_type`, `entitlement_name`, `entitlement_id`, `entitlement_owner_identity_id`, `access_status`, `granted_at`, `revoked_at`, `last_used_at`, `is_privileged`, `orphan_flag`, `dormant_flag`, `shared_flag`, `service_flag`, `standing_flag`, `privilege_assignment_type`, `privilege_start_at`, `privilege_end_at`, `access_source`, `created_at`, `updated_at` | Fact table at access-grant grain |
| Review Campaign | `review_campaign_id` | `review_campaign_id`, `campaign_name`, `scope_type`, `reviewer_type`, `campaign_owner_identity_id`, `risk_scope`, `campaign_status`, `launched_at`, `due_at`, `completed_at`, `period_label`, `system_scope_count`, `identity_scope_count`, `created_at`, `updated_at` | Parent campaign metadata |
| Review | `review_item_id` | `review_item_id`, `review_campaign_id`, `access_id`, `system_id`, `identity_id`, `reviewer_identity_id`, `reviewer_type`, `assigned_at`, `opened_at`, `completed_at`, `due_at`, `sla_due_at`, `review_decision_status`, `decision_type`, `comment_text`, `comment_length`, `evidence_open_count`, `reassigned_flag`, `reassignment_count`, `reassigned_at`, `reassigned_to_identity_id`, `is_high_risk_item`, `created_at`, `updated_at` | Fact table at review-item grain |
| Risk | `risk_id` | `risk_id`, `access_id`, `identity_id`, `system_id`, `risk_category`, `risk_subcategory`, `risk_severity`, `risk_status`, `risk_title`, `risk_description`, `risk_opened_at`, `risk_resolved_at`, `detected_at`, `source_rule_id`, `source_rule_name`, `weighted_risk_points`, `current_exception_id`, `created_at`, `updated_at` | One record per detected risk finding |
| Action | `action_id` | `action_id`, `risk_id`, `review_item_id`, `access_id`, `system_id`, `owner_group`, `owner_identity_id`, `action_type`, `action_status`, `created_at`, `started_at`, `completed_at`, `remediation_due_at`, `escalation_count`, `escalation_triggered_at`, `completion_evidence_ref`, `failure_reason`, `updated_at` | Remediation and follow-up execution fact |
| Exception | `exception_id` | `exception_id`, `risk_id`, `system_id`, `identity_id`, `exception_status`, `exception_reason_code`, `exception_reason_text`, `approver_identity_id`, `approver_role`, `created_at`, `exception_start_at`, `exception_end_at`, `renewal_count`, `approval_ticket_ref`, `compensating_control_text`, `updated_at` | Approved and pending risk acceptance records |
| Audit Event | `audit_event_id` | `audit_event_id`, `entity_type`, `entity_id`, `event_type`, `actor_identity_id`, `event_timestamp`, `old_value_json`, `new_value_json`, `evidence_ref`, `session_id` | Needed for audit evidence completeness and reviewer interaction metrics |
| Calendar | `date_key` | `date_key`, `calendar_date`, `month_start`, `month_end`, `quarter_start`, `quarter_end`, `fiscal_year`, `fiscal_quarter`, `is_month_end`, `is_quarter_end` | Standard time dimension |

### Primary Relationships

| From Table | From Field | To Table | To Field | Relationship |
| --- | --- | --- | --- | --- |
| Access | `identity_id` | Identity | `identity_id` | Many-to-one |
| Access | `system_id` | System | `system_id` | Many-to-one |
| Review | `review_campaign_id` | Review Campaign | `review_campaign_id` | Many-to-one |
| Review | `access_id` | Access | `access_id` | Many-to-one |
| Review | `reviewer_identity_id` | Identity | `identity_id` | Many-to-one |
| Risk | `access_id` | Access | `access_id` | Many-to-one |
| Risk | `identity_id` | Identity | `identity_id` | Many-to-one |
| Risk | `system_id` | System | `system_id` | Many-to-one |
| Action | `risk_id` | Risk | `risk_id` | Many-to-one |
| Action | `review_item_id` | Review | `review_item_id` | Many-to-one |
| Exception | `risk_id` | Risk | `risk_id` | Many-to-one |
| Exception | `approver_identity_id` | Identity | `identity_id` | Many-to-one |
| Audit Event | `entity_id` | Review / Action / Exception / Risk | `primary key` | Polymorphic |

### Fields Required to Compute All Metrics

| Metric Family | Required Fields |
| --- | --- |
| Risk scoring | `risk_id`, `risk_category`, `risk_severity`, `risk_status`, `risk_opened_at`, `risk_resolved_at`, `weighted_risk_points`, `access_id`, `identity_id`, `system_id` |
| Orphan and dormant exposure | `access_id`, `access_status`, `correlated_identity_id`, `owner_identity_id`, `orphan_flag`, `dormant_flag`, `last_used_at`, `system_id`, `identity_type`, `is_privileged` |
| Privileged governance | `access_id`, `is_privileged`, `privilege_assignment_type`, `privilege_start_at`, `privilege_end_at`, `last_used_at`, `orphan_flag`, `identity_type`, `system_id` |
| Review coverage and completion | `review_campaign_id`, `review_item_id`, `system_id`, `identity_id`, `reviewer_identity_id`, `assigned_at`, `due_at`, `completed_at`, `review_decision_status`, `reviewer_type`, `campaign_status` |
| Rubber-stamp and reviewer quality | `review_item_id`, `assigned_at`, `opened_at`, `completed_at`, `decision_type`, `comment_text`, `comment_length`, `evidence_open_count`, `reassigned_flag`, `reassignment_count`, `reviewer_identity_id` |
| Remediation performance | `action_id`, `action_type`, `action_status`, `created_at`, `completed_at`, `remediation_due_at`, `owner_group`, `owner_identity_id`, `escalation_count`, `escalation_triggered_at`, `risk_id`, `review_item_id` |
| Exception governance | `exception_id`, `risk_id`, `exception_status`, `exception_start_at`, `exception_end_at`, `renewal_count`, `approver_identity_id`, `reason_code`, `system_id`, `identity_id` |
| Board reporting | All above plus `business_unit`, `geography`, `system_type`, `criticality`, `calendar quarter fields` |
| Audit evidence | `audit_event_id`, `entity_type`, `entity_id`, `event_type`, `actor_identity_id`, `event_timestamp`, `evidence_ref`, `old_value_json`, `new_value_json` |

## Implementation Notes
- Materialize daily snapshot tables for `open_risk_snapshot`, `access_risk_snapshot`, and `review_sla_snapshot` to support board and trend reporting.
- Compute `severity_weight` and `identity_risk_score` in semantic models, not directly in frontend.
- Keep dashboard widgets backed by reusable metric views so Board, Audit, and operational dashboards use identical logic.