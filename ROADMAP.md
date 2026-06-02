# Project Roadmap

Roadmap for the County Attachment Application System.

This document separates completed work from remaining production work so another developer, county IT officer, or HR owner can quickly understand what still needs attention.

## Delivery Snapshot

The core application workflow is implemented.

The system currently supports:

- student online applications
- student tracking dashboard
- HR-controlled department review
- HR final review and admission flow
- automatic deadline-based closure
- MongoDB-only storage with GridFS files
- NITA document generation and completion workflow
- joining-letter generation/download
- supervisor assignment workflow
- HR reports and CSV exports
- email/SMS integration points
- public AI assistant widget

The main remaining work is production hardening, formal operations, and external HR-system integration.

## Completed Work

### Application Workflow

Status: complete baseline

- Student application form
- Terms and conditions checkpoint
- Department and institution selection
- Course level capture
- PWD and special applicant handling
- Student tracking using ID/email
- Correction re-upload workflow

### HR and Department Review

Status: complete baseline

- HR portal
- HR application queue
- HR period and deadline settings
- HR-controlled department access
- Department review pages
- Department verification, rejection, correction, freeze, and restore actions
- HR final admission/rejection workflow

### Document Storage

Status: complete baseline

- MongoDB stores application data
- MongoDB stores sessions
- MongoDB GridFS stores uploaded documents
- MongoDB GridFS stores generated documents
- external file storage providers are no longer part of the active workflow

### NITA Workflow

Status: complete baseline

- Initial NITA PDF upload
- County-endorsed NITA PDF generation
- Student download of endorsed NITA
- Stamped NITA re-upload
- HR confirmation of NITA completion

### Joining Letter Workflow

Status: complete baseline

- County joining-letter generation
- Student-specific field filling
- Student download after admission

Current limitation:

- exact pixel-for-pixel template filling still requires the final county template as PDF or DOCX

### Reports

Status: complete baseline

- Department distribution
- Institution distribution
- Education-level distribution
- Department capacity snapshot
- Distribution CSV export
- Supervisor assignment CSV export

### Supervisor Workflow

Status: complete baseline, API pending

- HR supervisors page
- Demo supervisor loader
- Supervisor assignment on admitted applications
- Assignment export for printing
- Environment placeholders for future HR API sync

Remaining dependency:

- main HR system API URL, token, and response format

### AI Assistant

Status: complete baseline

- Floating public chat widget
- Assistant icon and green launcher
- OpenAI API support
- Portal fallback helper
- General-question support when live AI is configured

Remaining dependency:

- production OpenAI API key and stable outbound internet access

## Production Blockers

These items should be completed or formally accepted before full public production.

### 1. HTTPS and Domain

Status: required

Why it matters:

- protects student data and HR sessions in transit
- removes browser `Not secure` warnings
- provides a professional live URL

Expected work:

- assign domain or subdomain
- configure DNS
- configure HTTPS certificate
- place IIS, Nginx, or another reverse proxy in front of Node if required

### 2. Credential Rotation

Status: required

Why it matters:

- several credentials and tokens have been used during setup and testing
- production should start with clean secrets

Expected work:

- rotate MongoDB database password
- rotate GitLab tokens that were shared during setup
- rotate OpenAI key if exposed
- rotate HR bootstrap password
- rotate department bootstrap password
- update Render and county server environment files

### 3. Security Hardening

Status: partially implemented

Why it matters:

- public-facing systems need stronger request and session protection

What is now in place:

- production startup blocks weak default secrets
- sessions regenerate after successful HR login
- session cookies use a project-specific name
- baseline browser security headers are applied
- cross-origin state-changing requests are rejected when origin data is present

Expected work:

- review public application/document routes
- add full CSRF tokens for state-changing forms
- tune rate limiting for production traffic

### 4. Backup and Restore

Status: required

Why it matters:

- MongoDB now stores both records and files
- production handover is incomplete without a restore plan

Expected work:

- confirm MongoDB backup schedule
- test restore procedure
- document who owns recovery
- define retention period

### 5. Audit and Governance

Status: required

Why it matters:

- HR decisions and document changes need accountability

Expected work:

- confirm audit retention policy
- add/export audit review reports if required
- document who can review audit history

## High-Value Next Improvements

### 6. Manual Supervisor Management

Status: recommended

Goal:

- allow HR to create, edit, deactivate, or remove supervisor records manually

Reason:

- HR should not be blocked if the main HR API is offline or delayed

### 7. HR API Supervisor Sync

Status: planned

Goal:

- sync supervisor staff from the main county HR system

Needed from the HR-system developer:

- API URL
- authentication method
- sample JSON response
- supervisor eligibility rules
- staff department/station fields

### 8. Assignment Printing Package

Status: recommended

Goal:

- produce cleaner printable supervisor assignment sheets

Possible outputs:

- Excel export
- PDF assignment sheet
- department-level print view

### 9. Notifications Dashboard

Status: recommended

Goal:

- help HR see whether email/SMS messages were sent successfully

Expected work:

- delivery status display
- retry option
- failed-notification list

### 10. Student Placement Tracking

Status: planned

Goal:

- track what happens after admission

Possible fields:

- assigned supervisor
- reporting station
- reporting date
- reported/not reported
- completion status

## Long-Term Strategic Work

### 11. API-First Refactor

Status: future

Goal:

- expose cleaner JSON APIs for integrations with county systems

Expected direction:

- keep current EJS portal working
- extract business logic into services
- add `/api/v1/...` routes
- document endpoints
- add API authentication

### 12. Role Expansion

Status: future

Goal:

- support more detailed access control if county operations require it

Possible roles:

- HR admin
- HR officer
- department reviewer
- records officer
- system administrator

### 13. Advanced Analytics

Status: future

Goal:

- improve reporting for planning and fairness oversight

Possible reports:

- supervisor workload distribution
- admitted vs reported students
- institution capacity pressure
- department completion report
- period-to-period comparison

### 14. Database Strategy Review

Status: future

Goal:

- decide whether MongoDB remains the long-term county storage strategy

Current position:

- MongoDB is the active storage backend
- no immediate database migration is required

## Deployment Notes

GitHub:

- branch: `main`
- used by the county server pull workflow

GitLab:

- branch: `county-deploy`
- used for county GitLab collaboration

County server update command:

```cmd
cd C:\Users\user\Desktop\UG-county-Attachment-Application-System
git pull origin main
C:\Users\user\Downloads\nssm-2.24-101-g897c7ad\win64\nssm.exe restart UGCountyAttachmentApp
```

The NSSM restart command must run in Administrator Command Prompt.

## Immediate Recommended Order

1. Finish security hardening.
2. Rotate production credentials.
3. Confirm HTTPS and domain setup.
4. Confirm MongoDB backup and restore.
5. Add manual supervisor management.
6. Connect the main HR supervisor API.
7. Improve printable assignment reports.
8. Finalize HR handover guide and support ownership.
