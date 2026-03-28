# County Attachment Application System

Digital attachment application portal for the County Government of Uasin Gishu. The system manages the workflow from student application, through department review under HR control, to final HR admission and joining-letter release.

## Handover Status

The current system is suitable for:

- demo and presentation use
- pilot or controlled deployment
- hosted operation with MongoDB persistence

The current system is not yet ready for full county-wide production without the security and governance items listed in `Production-Readiness Gaps`.

## Project Overview

This system was built to replace a manual attachment application process with a structured online workflow.

Main users:

- students applying for county attachment
- department reviewers operating under HR authorization
- HR officers managing intake windows, review flow, NITA workflow, communications, and joining letters

Main outcomes:

- online application instead of manual paper submission
- controlled departmental intake and fairness balancing
- student self-service tracking
- centralized HR final decision making
- persistent hosted storage through MongoDB

## End-To-End Workflow

1. Student opens the landing page and confirms whether an application window is open.
2. Student opens `Apply`, accepts the county terms, chooses a department and institution, and completes the application.
3. Student uploads:
   - one combined supporting-document file
   - one separate NITA document
4. The system generates:
   - an internal application record
   - a tracking number based on the student ID number, for example `ATT-12345678`
   - an automatically county-endorsed NITA document
5. Student receives notification guidance and can track the application using:
   - ID number
   - email used during application
6. Department review is done from the HR-controlled department access flow.
7. Department review can:
   - edit applicant information
   - review documents
   - request corrections
   - verify or reject applications
   - freeze or restore records
8. Verified applications move to the HR queue.
9. HR manages:
   - NITA workflow completion
   - final decision as `Admitted` or `Rejected`
   - joining-letter upload
10. Student returns to the dashboard to:
    - view progress
    - re-upload corrected documents
    - download the county-endorsed NITA document
    - re-upload the stamped NITA document
    - download the joining letter after admission

## Current Live Architecture

### Application stack

- Node.js + Express backend
- EJS server-rendered views
- shared layout, county branding, and portal navigation

### Database

- MongoDB is the active database
- MongoDB stores:
  - applications
  - settings
  - department access records
  - HR account settings
  - sessions

This means hosted applications now remain available after Render refreshes and redeploys.

### File storage

The system supports two file-storage modes:

- `local`
  - files are stored on the app filesystem
  - suitable for local development
- `cloudinary`
  - files are stored in Cloudinary
  - recommended for durable hosted document storage

Documents handled by the system include:

- combined application documents
- initial NITA uploads
- auto-generated county-endorsed NITA documents
- stamped NITA re-submissions
- joining letters

### Notifications

The system includes notification integration through:

- email via SMTP
- SMS via Twilio

Current practical position:

- email is the primary reliable notification channel
- SMS provider integration exists, but Kenyan SMS delivery depends on Twilio sender support and production configuration

## Functional Modules

### 1. Landing page and intake windows

The landing page presents:

- county-branded introduction
- live intake runner and deadline countdown
- application window status
- quarterly intake windows:
  - January - March
  - April - June
  - July - September
  - October - December
- fair-distribution guidance
- quick application instructions

HR controls:

- open and closed windows
- application deadline
- landing runner message
- department slot capacities
- institution fairness ratio

### 2. Student application flow

The apply page now enforces this order:

1. read and accept county terms and conditions
2. choose department
3. choose institution
4. complete the rest of the form

The form collects:

- full name
- email
- phone number
- ID number
- institution
- course or program
- department
- intake period
- attachment dates
- cover note
- combined supporting document
- NITA document

The system also records:

- terms acceptance
- terms acceptance time
- recorded source/IP
- terms version

### 3. Student tracking flow

The student tracking/dashboard flow allows a student to:

- open the dashboard using ID number and email
- view current status
- follow the review timeline
- see reviewer comments
- re-upload corrected documents
- download the county-endorsed NITA document
- re-upload the stamped NITA document
- download the joining letter after admission

### 4. Department review under HR control

Department review is not an independent public portal anymore.

Current behavior:

- department review access is opened from HR
- the legacy staff path redirects into the HR-controlled flow
- reviewers only work within the department scope granted by HR

Department review capabilities:

- review applications by department
- edit applicant details
- review submitted documents
- request corrections
- verify or reject
- freeze or restore records

Department review does not:

- make final HR admission decisions
- upload joining letters
- bypass department scope

### 5. HR queue, NITA workflow, and joining-letter workflow

HR manages:

- intake windows and deadlines
- department access records
- final application queue
- NITA workflow completion
- final admission decision
- joining-letter upload

The final decision model is:

- `Pending`
- `Needs Correction`
- `Verified`
- `Admitted`
- `Rejected`

Important workflow rules:

- only verified applications reach the HR queue
- HR cannot admit an application before the NITA workflow is completed
- joining-letter upload happens after admission

### 6. HR communications and HR account management

HR can:

- access a dedicated communications page
- broadcast updates to applicant contacts
- review communication history for an application
- change HR username
- change HR password

This gives HR direct operational control without editing environment files after first setup.

## Operational Guide for HR

### Open or close intake windows

1. Sign in to the HR portal.
2. Open `Period and Slot Settings`.
3. Open or close the required quarter.
4. Set the application deadline.
5. Save the settings.

### Set the landing runner and deadline

1. Open `Period and Slot Settings`.
2. Enter the landing-page runner message.
3. Set the deadline date.
4. Save changes.

### Manage department review access

1. Open the HR portal.
2. Go to the department/admin management section.
3. Create, edit, activate, deactivate, or reset department access records.

### Review applications

1. Open `HR Applications Queue`.
2. Filter or select the application.
3. Open the application detail page.
4. Review:
   - applicant details
   - review comments
   - NITA workflow state
   - communication history
   - terms acceptance record

### Manage the NITA workflow

1. Student uploads an initial NITA document.
2. System generates a county-endorsed NITA document automatically.
3. Student downloads it, takes it to NITA, and re-uploads the stamped copy.
4. HR confirms NITA completion.
5. HR proceeds to final admission or rejection.

### Send communications

1. Open `Communications` in the HR portal.
2. Choose email, SMS, or both.
3. Enter the subject and message.
4. Send the communication.

### Upload joining letters

1. Open an admitted application in the HR queue.
2. Confirm the NITA workflow is complete.
3. Upload the joining letter.
4. Student then downloads the letter from the dashboard.

## Deployment and Environment

### Core hosted requirements

The hosted system expects:

- Node.js application hosting
- MongoDB connection
- environment variables
- document storage strategy

### Required environment values

Core:

- `SESSION_SECRET`
- `SESSION_COOKIE_MAX_AGE_HOURS`
- `MONGODB_URI`
- `MONGODB_DB_NAME`
- `HR_USERNAME`
- `HR_PASSWORD`
- `DEFAULT_DEPARTMENT_ADMIN_PASSWORD`
- `DISPLAY_TIMEZONE`
- `HR_PORTAL_PATH`
- `ADMIN_PORTAL_PATH`

File storage:

- `FILE_STORAGE_PROVIDER`
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- `CLOUDINARY_FOLDER`

Email notifications:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `NOTIFICATIONS_EMAIL_FROM`

SMS notifications:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER`

County NITA defaults:

- `COUNTY_ATTACHMENT_PROVIDER_NAME`
- `COUNTY_ATTACHMENT_PROVIDER_POSTAL_ADDRESS`
- `COUNTY_ATTACHMENT_PROVIDER_POSTAL_CODE`
- `COUNTY_ATTACHMENT_PROVIDER_TOWN`
- `COUNTY_ATTACHMENT_PROVIDER_PHYSICAL_ADDRESS`
- `COUNTY_ATTACHMENT_PROVIDER_REGION`
- `COUNTY_ATTACHMENT_PROVIDER_TELEPHONE`
- `COUNTY_ATTACHMENT_PROVIDER_EMAIL`
- `COUNTY_ATTACHMENT_PROVIDER_FAX`
- `COUNTY_ATTACHMENT_OFFICER_IN_CHARGE`
- `COUNTY_ATTACHMENT_OFFICER_TELEPHONE`
- `COUNTY_ATTACHMENT_SIGNATORY_NAME`
- `COUNTY_ATTACHMENT_SIGNATORY_DESIGNATION`

### What persists after refresh or redeploy

With MongoDB configured:

- applications persist
- settings persist
- sessions persist
- department access records persist

With Cloudinary configured:

- uploaded documents persist
- generated NITA workflow files persist
- joining letters persist

If local file storage is used in hosted mode:

- database records may persist through MongoDB
- files on the host may still be lost if the host uses ephemeral storage

## Production-Readiness Gaps

These items are still required before real county-wide production handover.

### 1. Password hashing

Current state:

- stored HR and department access passwords are now hashed
- legacy plain-text records are upgraded after successful login

Remaining improvement:

- define a formal password reset and recovery policy
- rotate bootstrap credentials and secrets during handover

### 2. Rate limiting and login protection

Current state:

- baseline rate limiting now protects HR login and public tracking/verification routes

Remaining improvement:

- review thresholds for county-scale traffic
- add stronger lockout and monitoring policy
- harden session and authentication controls

### 3. Audit trail

Current state:

- application audit history now records major workflow changes
- HR system audit records settings, account, and communication actions

Remaining improvement:

- decide retention policy for audit entries
- define export/review procedure for county oversight

### 4. Backup and recovery plan

Current issue:

- the system depends on MongoDB and Cloudinary availability, but formal recovery guidance is not yet documented

Required improvement:

- confirm MongoDB backup policy
- confirm Cloudinary recovery expectations
- document restore and continuity process

### 5. HR handover and training package

Current issue:

- the product now has enough workflow depth that a short verbal explanation is not enough for real handover

Required improvement:

- provide HR operating instructions
- provide issue-escalation guidance
- provide user ownership and support expectations

## Known Constraints

### Twilio / Kenya SMS limitation

SMS integration exists, but Kenyan SMS delivery depends on supported sender configuration and provider rules. Email should be treated as the primary official notification channel unless SMS is validated in production.

### Cloudinary is required for durable hosted files

If hosted deployment uses local file storage instead of Cloudinary, uploaded documents may still be lost on ephemeral hosting environments.

### Credential hardening still needs operations policy

The system now hashes stored HR and department passwords, but production handover still needs secret rotation, reset ownership, and credential-recovery policy.

## Local Run Guide

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from `.env.example`.
3. Start the application:

```bash
npm start
```

4. Open:

- `/`
- `/apply`
- `/track`
- `/hr-portal`

## Render Hosting Notes

For Render:

- set the MongoDB values
- set file-storage values
- set SMTP values if email notifications are required
- do not rely on local storage unless a persistent disk is available

If auto-deploy is enabled, GitHub pushes should trigger deployment automatically. Otherwise use `Manual Deploy` and deploy the latest commit.

## Key File References

For reviewers or maintainers who want to inspect the implementation without scanning the whole codebase:

- `server.js`
  - main application routes, workflow rules, settings, notifications, and status handling
- `database.js`
  - MongoDB storage layer and session persistence
- `notification-service.js`
  - email and SMS notification integration
- `file-storage.js`
  - local versus Cloudinary file handling
- `county-nita-pdf.js`
  - automatic county endorsement for Part C of the NITA workflow
- `views/apply.ejs`
  - student application experience and terms checkpoint
- `views/hr-detail.ejs`
  - HR review page, NITA workflow, and communication history
- `views/admin-periods.ejs`
  - intake windows, deadline, runner message, and slot settings

## Handover Note

This project should be handed over as:

- a working county attachment workflow system
- a MongoDB-backed hosted application
- a system ready for pilot or controlled deployment

It should not be handed over as fully production-complete until the documented security, audit, backup, and operational hardening items are closed.
