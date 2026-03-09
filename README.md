# County Attachment Application System

Simple portal for county government attachment applications.

## Features
- Student application form
- Mandatory document upload (ID, intro letter, CV)
- Automatic application ID generation
- Applicant status tracking page (ID + email)
- Admin login
- Admin dashboard with status filters and verification actions
- Admin edit of submitted applicant details
- Admin delete of applicant records and uploaded documents

## Run
1. Install dependencies:
   ```bash
   npm.cmd install
   ```
2. Copy environment file:
   ```bash
   copy .env.example .env
   ```
3. Start server:
   ```bash
   npm.cmd start
   ```
4. Open:
   - Home: `http://localhost:3000`
   - Admin: `http://localhost:3000/admin/login`

## Default Admin Credentials
- Username: `admin`
- Password: `admin123`

Change these in `.env` before production use.

## Storage
- Application records: `data/applications.json`
- Uploaded files: `uploads/`

## Notes for production
- Add strong authentication and role management.
- Add DB (PostgreSQL/MySQL) instead of JSON file.
- Add email/SMS notifications.
- Validate and scan uploaded files for security.
