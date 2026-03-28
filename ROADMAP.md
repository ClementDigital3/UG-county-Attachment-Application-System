# Project Roadmap

This roadmap now reflects the current state of the County Attachment Application System. It separates what is already implemented from what still blocks a real county-wide production handover.

## Current Delivery Status

Implemented:

- MongoDB migration for applications, settings, department access records, and sessions
- Cloud file storage abstraction with Cloudinary support
- Student application portal
- Student self-service dashboard
- HR-controlled department review flow
- HR final review queue
- NITA workflow with automatic county-endorsed document generation
- Joining-letter upload and student download
- HR department access management
- Analytics and reporting pages
- HR communications page
- Email and SMS notification integration points
- Landing-page intake windows, deadline runner, and countdown
- County terms and conditions checkpoint with recorded acceptance

Partially implemented or operationally limited:

- email notifications depend on SMTP configuration
- SMS notifications depend on Twilio and valid production sender support for Kenya
- Cloudinary durability depends on proper environment configuration

## Top Priority Before Real County Production Use

These items should be treated as production blockers, not optional polish.

### 1. Password hashing

Status:

- [x] Baseline implemented

Why it matters:

- HR and department credentials should not remain dependent on plain-text password handling

What is now in place:

- stored HR and department passwords are hashed
- legacy plain-text credentials are upgraded on successful login
- password change flow works against hashed credentials

Remaining work:

- define secure password reset and recovery policy
- rotate bootstrap credentials during handover

### 2. Rate limiting and login protection

Status:

- [~] Partially implemented

Why it matters:

- HR login and student tracking endpoints should be protected from brute force and abuse

What is now in place:

- rate limiting on HR login
- rate limiting on student tracking and public verification
- temporary repeated-failure blocking

Remaining work:

- tune thresholds for production traffic
- add stronger monitoring, alerting, and lockout policy
- review session-security hardening

### 3. Audit trail

Status:

- [~] Partially implemented

Why it matters:

- county operations need accountability for sensitive actions

What is now in place:

- application audit trail for major workflow actions
- system audit trail for settings, account, and communication changes
- HR audit page for operational review

Remaining work:

- define audit retention policy
- add export/archive policy for county oversight

### 4. Backup and recovery strategy

Status:

- [ ] Required

Why it matters:

- production handover is incomplete without recoverability

Expected work:

- confirm MongoDB backup process
- confirm Cloudinary recovery expectations
- document restore steps and ownership

### 5. HR handover and operating guide

Status:

- [~] Documentation drafted, operations handover still required

Why it matters:

- HR needs a formal operating guide, not only code or demo knowledge

Expected work:

- provide portal operating instructions
- define ownership and support contacts
- document routine workflows and escalation paths

## Next Operational Improvements

These are valuable next steps after the production blockers above.

### 6. Search and advanced filtering

Status:

- [x] Implemented

Goal:

- speed up HR and department review for larger volumes

### 7. Document review workflow improvement

Status:

- [x] Implemented baseline

Goal:

- standardize correction reasons and make document review easier to understand

### 8. Joining letter templates

Status:

- [x] Implemented baseline

Goal:

- allow HR to generate joining letters from standard templates instead of uploading each one manually

### 9. Public application verification page

Status:

- [x] Implemented baseline

Goal:

- provide a safer public follow-up path using tracking number plus identity verification inputs

### 10. Timezone and activity consistency cleanup

Status:

- [ ] Planned

Goal:

- ensure all activity and timestamps consistently reflect county local time

## Longer-Term Strategic Work

### 11. Database strategy review

Status:

- [ ] Planned

Goal:

- review MongoDB versus PostgreSQL for long-term county production scale, reporting needs, and operations

Current note:

- MongoDB is the active live database today
- this item is now a strategic review, not an immediate migration requirement

### 12. Role expansion

Status:

- [ ] Planned

Goal:

- introduce more structured access control if the county later requires more separation of duties

Possible future roles:

- super admin
- HR admin
- department reviewer
- records officer

### 13. Advanced slot and fairness dashboard

Status:

- [ ] Planned

Goal:

- provide stronger visibility into departmental capacity pressure and institution distribution

## Working Notes

- MongoDB is the current active application database.
- Sessions are also stored in MongoDB.
- Cloudinary should be treated as the preferred hosted file-storage path.
- Email is the most reliable notification channel in the current system.
- SMS support exists in the codebase, but Kenyan production delivery depends on provider/sender readiness.
- The system is currently suitable for demo, pilot, and controlled deployment.
- A real county-wide handover still requires the production-blocker items above to be completed.
