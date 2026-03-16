# Project Roadmap

This backlog tracks the next build steps for the County Attachment Application System so work can continue in small, controlled releases.

## How To Use This Backlog

- Build from top to bottom unless a production issue forces a different priority.
- Keep one feature focused per commit where possible.
- After each finished item:
  - update this file
  - commit
  - push
  - redeploy if the change affects the hosted app

## Current Priority

1. PostgreSQL migration
2. Notifications
3. Audit trail
4. Search and advanced filtering
5. Student self-service dashboard
6. Security hardening

## Phase 1: Immediate Practical Improvements

### 1. Cloud file storage

Status:
- [x] Implemented

Goal:
- move uploaded documents and joining letters away from local disk

Why it matters:
- Render free hosting does not keep local files permanently
- uploaded documents should survive restarts and redeploys

Possible options:
- Cloudinary
- Amazon S3
- Supabase Storage

### 2. Admin account management UI

Status:
- [x] Implemented

Goal:
- let HR create, edit, reset, activate, and deactivate department admin accounts from the portal

Why it matters:
- removes manual backend editing
- makes departmental administration realistic for county use

### 3. Analytics and reporting dashboard

Status:
- [x] Implemented

Goal:
- show operational summaries for HR and department admins

Suggested outputs:
- total applications by department
- total applications by institution
- pending, verified, approved, rejected counts
- remaining slots by department

## Phase 2: Hosted Production Readiness

### 4. PostgreSQL migration

Status:
- [ ] Planned

Goal:
- move from SQLite file-based storage to PostgreSQL for hosted production use

Why it matters:
- better persistence for hosted deployments
- better fit for multi-user production workloads
- cleaner path for reporting and scaling

### 5. Notifications

Status:
- [ ] Planned

Goal:
- notify students when key application events happen

Suggested triggers:
- application received
- correction requested
- application approved
- application rejected
- joining letter ready

Possible channels:
- email
- SMS

### 6. Audit trail

Status:
- [ ] Planned

Goal:
- record important system actions for accountability

Examples:
- who verified an application
- who approved or rejected an application
- when a document was re-uploaded
- when portal settings were changed

### 7. Search and advanced filtering

Status:
- [ ] Planned

Goal:
- make admin and HR review faster as application volume grows

Suggested filters:
- department
- period
- institution
- status
- date range

## Phase 3: User Experience And Workflow

### 8. Student self-service dashboard

Status:
- [ ] Planned

Goal:
- give students a clearer post-application experience

Suggested content:
- application status
- reviewer comments
- correction requests
- joining letter download

### 9. Document review workflow improvement

Status:
- [ ] Planned

Goal:
- make document correction and review more structured

Suggested improvements:
- standard correction reasons
- clearer review notes
- review history per application

### 10. Attachment slot dashboard

Status:
- [ ] Planned

Goal:
- make slot usage and institution balancing more visible

Suggested outputs:
- live slot usage by department
- remaining slot count by department
- institution fairness pressure indicators

### 11. Joining letter templates

Status:
- [ ] Planned

Goal:
- allow HR to generate a standard joining letter from a template instead of uploading each one manually

### 12. Public application verification page

Status:
- [ ] Planned

Goal:
- allow safer public tracking using placement number and supporting identity details

Why it matters:
- reduces confusion during follow-up
- makes status confirmation easier for students

## Phase 4: Governance And Security

### 13. Role expansion

Status:
- [ ] Planned

Goal:
- support more structured access control

Suggested roles:
- super admin
- HR admin
- department admin
- records officer

### 14. Security hardening

Status:
- [ ] Planned

Goal:
- improve production safety before real county rollout

Suggested work:
- password hashing
- rate limiting
- CSRF protection
- login lockout after repeated failures
- stricter upload controls in production mode

### 15. Timezone and activity consistency

Status:
- [ ] Planned

Goal:
- make displayed dates and times match county local time consistently

Why it matters:
- review history should reflect the actual action time in East Africa Time
- users should not see delayed or misleading timestamps

## Working Notes

- SQLite is the current active database.
- Sessions are also stored in SQLite.
- On free Render, local database files and uploads are still temporary.
- For real hosted use, cloud file storage and a managed database are the next major upgrades.
