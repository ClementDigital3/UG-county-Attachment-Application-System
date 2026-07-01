# County Attachment Application System

Digital attachment application portal for the County Government of Uasin Gishu.

The system handles the full attachment workflow: student application, department review, HR final review, NITA processing, supervisor assignment, joining-letter release, reporting, and student tracking.

## Current Status

The system is ready for demos, pilots, and controlled internal deployment.

Before full public county-wide production use, the items in `Production Readiness` and `ROADMAP.md` should be completed or formally accepted by county IT and HR leadership.

## Main Users

- Students applying for county attachment.
- Department reviewers checking applications under HR control.
- HR officers managing intake periods, decisions, NITA workflow, supervisors, reports, communication, and joining letters.
- County IT or developers maintaining deployment, configuration, security, and integrations.

## Main Features

- Student online application and tracking dashboard.
- Intake period control with quarterly windows and deadline auto-closure.
- Department review workflow controlled from the HR side.
- HR final review queue and admission/rejection decisions.
- NITA document workflow with county-endorsed document generation.
- MongoDB GridFS storage for uploaded and generated files.
- Joining-letter generation and student download.
- Supervisor directory, demo supervisor loading, assignment, and CSV export.
- HR reports for department, institution, and education-level distribution.
- Email/SMS notification integration points.
- Public AI assistant widget for student guidance and general questions when OpenAI is configured.

## System Architecture

### Application

- Node.js
- Express
- EJS server-rendered views
- MongoDB for data, sessions, and files
- MongoDB GridFS for uploaded/generated documents

### Storage & Performance Indexes

MongoDB is the only active storage backend (supporting GridFS for files). 

To ensure sub-millisecond query performance and high system capacity (holding 100 to 10,000+ records), the database is configured with the following optimized indexes:
- **`idx_applications_idNumber`:** Index on `{ idNumber: 1 }` to optimize student status tracking queries.
- **`idx_applications_submitted_placement`:** Composite index on `{ submittedAt: -1, placementNumber: -1 }` to offload sorting for HR and Admin queue lists.
- **`idx_sessions_expires`:** MongoDB TTL (Time-To-Live) index on `{ expiresAt: 1 }` configured with `expireAfterSeconds: 0`. This offloads session pruning to a native background thread in MongoDB, removing blocking write operations from the page-load pathway.

`STORAGE_ROOT` is only a temporary workspace used while files are being uploaded or generated before being stored in MongoDB GridFS.

### Notifications

The code supports:

- SMTP email
- Twilio SMS

Email should be treated as the primary official notification channel unless SMS delivery is fully validated in production.

### AI Assistant and Testing Feedback Widgets

The student-facing pages include two floating, circular action widgets positioned on the bottom-left of the screen:

- **Ask County Assistant:** A green circular toggle button (`bottom: 1.2rem; left: 1.2rem;`) that opens an AI chat panel directly above it. It works in two modes:
  - live AI mode when `OPENAI_API_KEY` is configured.
  - fallback guidance mode when the live AI provider is unavailable.
- **System Feedback:** A gold circular toggle button (`bottom: 5.2rem; left: 1.2rem;`) that opens a tester feedback form. Feedback submissions are transmitted via AJAX, protected by CSRF, rate-limited, and recorded directly to the HR audit trail for review.

Both widgets are highly optimized for mobile devices (including Xiaomi/Redmi viewports) utilizing direct inline `onclick` event handlers and pointer-events locks to prevent event swallowing.

## Application Workflow

1. HR opens an application period and sets the deadline.
2. Student opens the public site and confirms that an intake window is open.
3. Student accepts county terms and conditions.
4. Student fills the application form and uploads the required documents.
5. The system creates the application record and tracking number.
6. The system generates the county-endorsed NITA document.
7. Department reviewer checks the application and either verifies, rejects, or requests correction.
8. Verified applications move to the HR queue.
9. HR checks NITA completion and makes the final decision.
10. HR admits or rejects the student.
11. HR assigns a supervisor where applicable.
12. Student downloads the joining letter after admission.

## Required Student Documents

Student uploads are restricted to supported document formats.

General student documents:

- PDF
- DOCX

NITA workflow documents:

- PDF

NITA remains PDF-only because the system processes and generates PDF-based NITA documents.

## Intake Periods

The system uses four attachment windows:

- January - March (3rd Quarter)
- April - June (4th Quarter)
- July - September (1st Quarter)
- October - December (2nd Quarter)

HR can open or close each period. Once the saved deadline is reached, the student application flow closes automatically even if the period was marked open.

## HR Portal

HR can:

- manage application periods and deadlines
- manage department reviewer access
- review verified applications
- admit or reject applications
- manage NITA workflow completion
- assign supervisors
- send communications
- download reports and CSV exports
- manage HR account credentials

## Department Review

Department review is controlled from the HR portal.

Department reviewers can:

- view applications for their assigned department
- edit applicant details where allowed
- review documents
- request corrections
- verify applications
- reject applications
- freeze or restore records

Department reviewers cannot:

- make final HR admission decisions
- bypass their department scope
- upload or release joining letters

## Supervisor Workflow

The system includes a supervisor assignment workflow.

Current capabilities:

- HR supervisor page
- demo supervisor loader for testing
- future HR-system API sync placeholders
- supervisor assignment on admitted student records
- assignment CSV export for printing

Future integration:

- the main HR system should expose an API for active staff supervisors
- this system will sync that supervisor list and allow HR to assign students to staff

Expected HR API configuration:

```env
HR_SUPERVISOR_API_URL=
HR_SUPERVISOR_API_TOKEN=
HR_SUPERVISOR_API_HEADER=Authorization
HR_SUPERVISOR_API_TOKEN_PREFIX=Bearer
```

## Reports

HR reports include:

- application totals
- department distribution
- institution distribution
- education-level distribution
- department capacity snapshot
- downloadable distribution CSV
- supervisor assignment CSV

These reports are intended to help HR view placement distribution and print summary documents.

## Local Setup

Install dependencies:

```bash
npm install
```

Create the environment file:

```bash
copy .env.example .env
```

Start the app:

```bash
npm start
```

PowerShell may block `npm.ps1` depending on execution policy. In that case use:

```powershell
npm.cmd start
```

or:

```powershell
node server.js
```

Open:

- `http://localhost:3000`
- `http://localhost:3000/apply`
- `http://localhost:3000/track`
- `http://localhost:3000/hr-portal`

## Environment Variables

Use `.env.example` as the source of truth for environment names.

Core required values:

- `PORT`
- `SESSION_SECRET`
- `MONGODB_URI`
- `MONGODB_DB_NAME`
- `HR_USERNAME`
- `HR_PASSWORD`
- `DEFAULT_DEPARTMENT_ADMIN_PASSWORD`
- `DISPLAY_TIMEZONE`
- `HR_PORTAL_PATH`
- `ADMIN_PORTAL_PATH`

Optional integrations:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `NOTIFICATIONS_EMAIL_FROM`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER`
- `OPENAI_API_KEY`
- `OPENAI_ASSISTANT_MODEL`
- `HR_SUPERVISOR_API_URL`
- `HR_SUPERVISOR_API_TOKEN`

County NITA defaults are also configured through `.env.example`.

## County Server Deployment

The county server uses the project as a Windows service through NSSM.

Typical update flow:

```cmd
cd C:\Users\user\Desktop\UG-county-Attachment-Application-System
git pull origin main
C:\Users\user\Downloads\nssm-2.24-101-g897c7ad\win64\nssm.exe restart UGCountyAttachmentApp
```

The NSSM restart command must be run from Command Prompt as Administrator.

Check service status:

```cmd
C:\Users\user\Downloads\nssm-2.24-101-g897c7ad\win64\nssm.exe status UGCountyAttachmentApp
```

Expected status:

```text
SERVICE_RUNNING
```

## Render Deployment

For Render:

- set all required environment variables
- set MongoDB connection values
- set SMTP values if email is required
- set OpenAI values if the AI assistant should answer general questions
- redeploy after changing environment variables

## Production Readiness

Before county-wide production, confirm:

- domain and HTTPS are configured
- all exposed credentials and tokens are rotated
- MongoDB backups are enabled and tested
- HR and department password policy is agreed
- audit retention policy is agreed
- email delivery is tested
- SMS delivery is tested if SMS will be used
- supervisor API ownership is agreed with the main HR system team
- support and escalation contacts are documented

## Key Files

- `server.js` - main routes, workflow rules, AI assistant, reports, and HR logic
- `database.js` - MongoDB access and GridFS support
- `file-storage.js` - file storage and download handling
- `notification-service.js` - email and SMS integration
- `joining-letter-template.js` - joining-letter generation
- `county-nita-pdf.js` - NITA PDF generation
- `views/apply.ejs` - student application form
- `views/track.ejs` - student tracking dashboard
- `views/hr-detail.ejs` - HR application review page
- `views/hr-supervisors.ejs` - supervisor sync and assignment page
- `views/admin-periods.ejs` - period, slot, and deadline settings
- `.env.example` - environment configuration template

## Maintenance Notes

- Do not commit `.env`.
- Keep MongoDB credentials private.
- Rotate any token that was shared in chat, screenshots, or terminal logs.
- Use GitHub `main` for county server pulls unless the deployment process changes.
- Use GitLab `county-deploy` for county GitLab collaboration.
- Restart the NSSM service after pulling code on the county server.
