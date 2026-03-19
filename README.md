# County Attachment Application System

Portal for managing county government attachment applications from student submission through department verification and HR final approval.

## Presentation Summary

This project is a digital attachment application portal for the County Government of Uasin Gishu.

It was designed to solve the manual attachment application process by:

- allowing students to apply online
- allowing department admins to verify applications in their own departments
- allowing HR to approve verified applications centrally
- allowing students to track application progress and download joining letters

In summary, the system moves the process from manual document submission to a structured online workflow.

## What To Say During Presentation

You can present the system in this order:

1. Problem:
   - attachment applications are often manual, slow, and difficult to track
   - students may not know whether their documents were received or approved
2. Solution:
   - this portal allows online application, department-level verification, and HR final approval
3. Main users:
   - student
   - department admin
   - HR
4. Main benefit:
   - easier application
   - easier review
   - clearer tracking
   - better control of departmental slots and fairness

## Database Explanation For Presentation

This system now uses SQLite as its database.

You can explain it like this:

- the first version used JSON files for storage during early development
- the current version uses SQLite, which is a real relational database
- SQLite stores:
  - student applications
  - portal settings
  - department admin accounts
- SQLite was chosen because it is lightweight, easy to deploy, and suitable for the current project stage

If asked how the application connects to the database, explain:

- the Node.js backend connects directly to a SQLite database file
- the database is accessed through the `better-sqlite3` package
- the application reads and writes data through a dedicated storage layer

If asked about future growth, explain:

- SQLite is appropriate for the current prototype and demonstration stage
- for larger production use with many simultaneous users, the next step would be PostgreSQL or another managed server database

## Short Demo Script

You can use this short script:

1. Open the landing page and explain the system purpose.
2. Open `Apply` and show how a student submits an attachment application.
3. Mention that the student must choose a department and can later track the application.
4. Open the Department Admin Portal and show that each department reviews only its own applicants.
5. Verify one application and explain that verified applications move to HR.
6. Open the HR Portal and show final approval.
7. Upload the joining letter and return to the student tracking page.
8. Show that the student can see the status and download the joining letter.

## Current Scope

This project currently covers:

- Public landing page with county branding, shared navigation, and footer.
- Student application portal.
- Student self-service dashboard for tracking, correction follow-up, NITA workflow follow-up, and joining letter download.
- Department admin portal with department-scoped access.
- HR portal for final approval and joining letter upload.
- HR admin account management UI for department admins.
- Reports and analytics pages for HR and department admins.
- Period control, department slot control, and institution fairness control.
- SQLite database storage for applications, settings, department accounts, and login sessions.
- File storage abstraction with local storage by default and optional Cloudinary cloud storage.

## End-To-End Workflow

1. Student opens `/apply`.
2. Student fills personal details, institution, course, department, period, dates, uploads one combined scanned document for the main documents, and uploads the NITA document separately.
3. System generates:
   - `id`
   - `placementNumber`
4. Department admin logs in through the Admin Portal.
5. Department admin reviews only applications for that department.
6. Department admin can:
   - edit applicant details
   - review documents
   - request corrections
   - assign placement department
   - mark valid applications as `Verified`
7. HR logs in through the HR Portal.
8. HR only sees applications already in the HR review queue:
   - `Verified`
   - `Approved`
   - `Rejected`
9. HR uploads the county-signed NITA document for the student.
10. Student downloads the county-signed NITA document, takes it for stamping, and re-submits the stamped copy through `/track`.
11. HR confirms the stamped NITA document, then approves or rejects the application.
12. HR uploads a joining letter for approved students.
13. Student uses `/track` to:
   - check status
   - see comments
   - re-upload rejected documents
   - download the county-signed NITA document
   - re-submit the stamped NITA document
   - download the joining letter after HR approval

## Portals And Navigation

The shared top navigation currently provides:

- `Home` -> landing page `/`
- `Apply` -> student application page `/apply`
- `Admin Portal` -> department admin login path from `ADMIN_PORTAL_PATH`
- `HR Portal` -> HR login path from `HR_PORTAL_PATH`

The interface now includes:

- County Government of Uasin Gishu branding in the header
- Local county logo image with SVG fallback
- Shared footer across pages
- Consistent layout and form spacing across public, admin, and HR pages

## Student Portal

### Student application form

The student form collects:

- Full name
- Email address
- Phone number
- Institution name
- Course or program
- Department applied for
- Attachment period
- Start date
- End date
- Required cover note / self introduction
- One combined scanned file containing the main required documents except NITA
- One separate NITA document upload with school stamp

### Required document bundle

The combined scanned upload is meant to contain:

- Passport photo
- School cover letter
- Insurance copy
- National ID or school ID copy
- A required cover note is typed directly in the form, so a separate application letter is not required

The separate NITA upload is meant to contain:

- NITA document with school stamp
- later, HR returns a county-signed version for the student to download
- the student then takes that document to the NITA office for stamping and re-submits it to HR through the dashboard

### Student tracking

Students track an application using:

- Tracking number or placement number
- Email used during application

From the student dashboard, a student can:

- see whether the application is `Pending`, `Needs Correction`, `Verified`, `Approved`, or `Rejected`
- see a progress timeline from submission to final decision
- see reviewer comments and the submitted cover note
- re-upload rejected documents
- download the county-signed NITA document when HR uploads it
- re-submit the stamped NITA document to HR
- download the joining letter when available

## Department Admin Portal

Department admins log in through the admin portal and are scoped to their own department.

Department admin capabilities:

- view department applications
- filter applications
- edit applicant details
- assign placement department
- review uploaded documents
- request corrections
- delete an applicant
- mark an application as `Verified`

Department admins cannot:

- give final approval
- upload joining letters
- bypass department scope

## HR Portal

HR logs in through a separate HR portal.

HR capabilities:

- manage period opening and closing
- manage department slot capacities
- manage institution fairness ratio
- review only HR-queue applications
- approve or reject verified applications
- upload joining letters for approved students

HR queue is limited to:

- `Verified`
- `Approved`
- `Rejected`

HR does not process:

- `Pending`
- `Needs Correction`

## Application Status Model

Application statuses currently used:

- `Pending`
- `Needs Correction`
- `Verified`
- `Approved`
- `Rejected`

Intended flow:

- `Pending` -> department review
- `Needs Correction` -> student re-upload
- `Verified` -> sent to HR queue
- `Approved` -> student can download joining letter
- `Rejected` -> final rejection

## Period Windows And Department Capacity

Three attachment windows are implemented:

- `JAN_MAR` -> January to March
- `APR_JUN` -> April to June
- `JUL_SEP` -> July to September
- `OCT_DEC` -> October to December

Current behavior:

- HR opens or closes periods
- students can only apply for an open period
- slot capacity is controlled per department
- landing page shows remaining total slots
- application is blocked if the selected department has no remaining slots

## Institution Name Rule

Students are required to write institution names in full.

Examples of valid input:

- `University of Nairobi`
- `Moi University`

Examples that should not be used:

- `UON`
- `MKU`

Reason:

- institution balancing depends on consistent full names
- abbreviations would allow the same institution to appear as multiple different entries

## Institution Fairness Balancing

Institution fairness was added to prevent one institution from taking too many slots in one department.

### How it works

- HR sets `Institution Fairness Ratio (%)` in the settings page.
- The system converts that ratio into a per-department institution limit.
- Example:
  - ICT capacity = `10`
  - fairness ratio = `40`
  - one institution can take at most `4` ICT slots

### Where it is enforced

- during new student application
- during admin edit of applicant details

### Where it is visible

- Apply page shows the fairness rule
- Landing page shows institution distribution and per-department institution count
- HR settings page allows changing the ratio

## Security And Upload Handling

Current upload/security controls:

- 5MB file size limit
- extension validation
- MIME validation
- magic-number signature validation
- executable file blocking
- basic EICAR malware signature detection
- safe download handling
- upload path safety checks

Testing support:

- `ALLOW_ANY_TEST_UPLOADS=true` relaxes student upload type restrictions for demonstrations

## Branding And UI Work Completed

The interface has been redesigned from the earlier simple pages to a shared branded layout.

Completed UI work:

- shared header on all pages
- shared footer on all pages
- county logo embedded locally
- navigation bar across student, admin, and HR pages
- `Home` link added to the navigation bar
- `Apply` nav entry added
- Apply page includes a subsection for tracking status and downloading joining letters
- form spacing and alignment improved

## Credentials Model

### Department admin accounts

Department admin accounts are stored in the SQLite database.

Default first-run pattern:

- username format: `<department>_admin`
- password: value from `DEFAULT_DEPARTMENT_ADMIN_PASSWORD`
- HR can now create, edit, activate, deactivate, delete, and reset department admin accounts from the portal.

### HR account

HR account uses:

- `HR_USERNAME`
- `HR_PASSWORD`

### Presentation shortcut

For demos, the same credentials can be used on both Admin and HR portals through:

- `PRESENTATION_LOGIN_USERNAME`
- `PRESENTATION_LOGIN_PASSWORD`

Do not store real production credentials in `README.md`.

## Departments Implemented

- ICT, E-Governance and Innovation
- Finance and Economic Planning
- Health Services
- Agriculture, Livestock and Fisheries
- Roads, Transport and Public Works
- Education, Vocational Training, Youth and Sports
- Lands, Housing, Physical Planning and Urban Development
- Water, Irrigation, Environment and Climate Change
- Trade, Cooperatives, Tourism and Industrialization
- Public Service Management and Administration

## Data And Storage

Main project data files:

- `data/attachment-application-system.db` -> SQLite database for applications, settings, department admin accounts, and login sessions
- `uploads/` -> uploaded documents and joining letters when local file storage is active

## Environment Configuration

Use `.env.example` as the template.

Current important keys:

- `PORT`
- `SESSION_SECRET`
- `SESSION_COOKIE_MAX_AGE_HOURS`
- `STORAGE_ROOT`
- `DATABASE_FILE`
- `FILE_STORAGE_PROVIDER`
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- `CLOUDINARY_FOLDER`
- `ADMIN_PORTAL_PATH`
- `HR_PORTAL_PATH`
- `HR_USERNAME`
- `HR_PASSWORD`
- `PRESENTATION_LOGIN_USERNAME`
- `PRESENTATION_LOGIN_PASSWORD`
- `DEFAULT_DEPARTMENT_ADMIN_PASSWORD`
- `ALLOW_ANY_TEST_UPLOADS`

### Storage root

- Leave `STORAGE_ROOT` empty for local development.
- For Render with a persistent disk, set `STORAGE_ROOT=/var/data`.
- The app will store the SQLite database and uploaded files inside the configured storage root.

### Database file

- Leave `DATABASE_FILE` empty to use the default path:
  - `<storage_root>/data/attachment-application-system.db`
- Set `DATABASE_FILE` only if you want the database file in a different location.

### File storage

- `FILE_STORAGE_PROVIDER=local` keeps uploaded files on the server filesystem.
- `FILE_STORAGE_PROVIDER=cloudinary` moves combined documents, NITA workflow documents, and joining letters to Cloudinary.
- When Cloudinary is selected, configure:
  - `CLOUDINARY_CLOUD_NAME`
  - `CLOUDINARY_API_KEY`
  - `CLOUDINARY_API_SECRET`
  - `CLOUDINARY_FOLDER`
- If Cloudinary is requested but not fully configured, the app falls back to local storage and logs a warning.

### Session storage

- Admin and HR login sessions are stored in the SQLite database instead of Express MemoryStore.
- This removes the default session warning and makes session handling consistent with the rest of the system.
- Session lifetime is controlled by:
  - `SESSION_COOKIE_MAX_AGE_HOURS`

## How To Run

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from `.env.example`.

3. Start the server:

```bash
npm start
```

4. Open the system:

- Home: `http://localhost:3000`
- Apply: `http://localhost:3000/apply`
- Track: `http://localhost:3000/track`
- Admin Portal: `http://localhost:3000/staff-portal`
- HR Portal: `http://localhost:3000/hr-portal`

## Render Deployment

This repository now includes `render.yaml` for Render deployment.

### Render setup

- Create a Render `Web Service`
- Connect the GitHub repository
- Use:
  - Build command: `npm install`
  - Start command: `npm start`
- On paid Render with a persistent disk:
  - attach the disk mounted at `/var/data`
  - set `STORAGE_ROOT=/var/data`
- On free Render without a disk:
  - leave `STORAGE_ROOT` empty
  - the SQLite database will run, but data will not persist across rebuilds or resets

### Required Render environment values

- `SESSION_SECRET`
- `DISPLAY_TIMEZONE`
- `HR_USERNAME`
- `HR_PASSWORD`
- `DEFAULT_DEPARTMENT_ADMIN_PASSWORD`

### Optional Render environment values

- `PRESENTATION_LOGIN_USERNAME`
- `PRESENTATION_LOGIN_PASSWORD`
- `ALLOW_ANY_TEST_UPLOADS`
- `DATABASE_FILE` if you want a custom SQLite path
- `SESSION_COOKIE_MAX_AGE_HOURS`
- `FILE_STORAGE_PROVIDER`
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- `CLOUDINARY_FOLDER`

### Why the disk is required

The application writes the SQLite database file and, when local storage is active, uploaded files to the filesystem. Without a persistent disk, redeploys or restarts can remove:

- applications
- portal settings
- department admin bootstrap data
- login sessions
- uploaded combined documents
- uploaded joining letters

If `FILE_STORAGE_PROVIDER=cloudinary` is configured correctly, uploaded documents and joining letters can persist in Cloudinary even when Render local storage is temporary. The SQLite database still needs a persistent disk or a managed database for full hosted persistence.

## What Has Been Removed

The system was simplified to keep the demo and workflow clear.

Removed or intentionally not active:

- SMS notifications
- email notification workflow
- demo notification messaging
- separate individual document upload as the main flow

## Security Notes

- Keep real credentials only in local `.env`
- `.env` should not be pushed to GitHub
- do not expose production usernames/passwords in documentation
- SQLite is a real database and is better than JSON files for this project stage
- on free Render without a persistent disk, the SQLite file is still temporary

## Recommended Future Work

- See the full build backlog in [ROADMAP.md](ROADMAP.md)
- move from SQLite file storage to PostgreSQL or another managed database for multi-user production deployment
- add audit logs
- improve institution balancing dashboards per department
- add stronger production authentication and authorization
