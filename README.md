# County Attachment Application System

Portal for managing county government attachment applications from student submission through department verification and HR final approval.

## Current Scope

This project currently covers:

- Public landing page with county branding, shared navigation, and footer.
- Student application portal.
- Student tracking and document correction flow.
- Department admin portal with department-scoped access.
- HR portal for final approval and joining letter upload.
- Period control, department slot control, and institution fairness control.
- Local JSON storage for applications, settings, and department accounts.

## End-To-End Workflow

1. Student opens `/apply`.
2. Student fills personal details, institution, course, department, period, dates, and uploads one combined scanned document.
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
9. HR approves or rejects the application.
10. HR uploads a joining letter for approved students.
11. Student uses `/track` to:
   - check status
   - see comments
   - re-upload rejected documents
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
- Optional cover note
- One combined scanned file containing all required documents

### Required document bundle

The single combined scanned upload is meant to contain:

- Passport photo
- Application letter
- School cover letter
- Insurance copy
- National ID or school ID copy
- NITA copy with school stamp

### Student tracking

Students track an application using:

- Tracking number or placement number
- Email used during application

From the tracking page, a student can:

- see whether the application is `Pending`, `Needs Correction`, `Verified`, `Approved`, or `Rejected`
- see reviewer comments
- re-upload rejected documents
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

- `JAN_APR` -> January to April
- `MAY_AUG` -> May to August
- `SEP_DEC` -> September to December

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

Department admin accounts are stored in:

- `data/department-admins.json`

Default first-run pattern:

- username format: `<department>_admin`
- password: value from `DEFAULT_DEPARTMENT_ADMIN_PASSWORD`

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

- `data/applications.json` -> submitted applications
- `data/portal-settings.json` -> periods, slot capacities, institution fairness
- `data/department-admins.json` -> department admin accounts
- `uploads/` -> uploaded documents and joining letters

## Environment Configuration

Use `.env.example` as the template.

Current important keys:

- `PORT`
- `SESSION_SECRET`
- `ADMIN_PORTAL_PATH`
- `HR_PORTAL_PATH`
- `HR_USERNAME`
- `HR_PASSWORD`
- `PRESENTATION_LOGIN_USERNAME`
- `PRESENTATION_LOGIN_PASSWORD`
- `DEFAULT_DEPARTMENT_ADMIN_PASSWORD`
- `ALLOW_ANY_TEST_UPLOADS`

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
- current storage is JSON-based and suitable for development/demo, not production scale

## Recommended Future Work

- move from JSON files to a real database
- add admin account management UI instead of editing JSON manually
- add reporting and export tools
- add audit logs
- improve institution balancing dashboards per department
- add stronger production authentication and authorization
#   U G - c o u n t y - A t t a c h m e n t - A p p l i c a t i o n - S y s t e m  
 