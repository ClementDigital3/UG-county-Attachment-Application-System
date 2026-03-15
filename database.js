const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function createDatabase({
  dataDir,
  databaseFile,
  createDefaultSettings,
  createDefaultDepartmentAdmins
}) {
  ensureDirectoryExists(dataDir);
  ensureDirectoryExists(path.dirname(databaseFile));

  const db = new Database(databaseFile);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS department_admins (
      username TEXT PRIMARY KEY,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      department TEXT NOT NULL,
      displayName TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS applications (
      id TEXT PRIMARY KEY,
      placementNumber TEXT,
      fullName TEXT,
      email TEXT,
      institution TEXT,
      appliedDepartment TEXT,
      assignedDepartment TEXT,
      period TEXT,
      status TEXT,
      submittedAt TEXT,
      data TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
    CREATE INDEX IF NOT EXISTS idx_applications_department ON applications(appliedDepartment);
    CREATE INDEX IF NOT EXISTS idx_applications_tracking ON applications(placementNumber);
    CREATE INDEX IF NOT EXISTS idx_applications_email ON applications(email);

    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      expiresAt INTEGER,
      data TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expiresAt);
  `);

  const getSettingsRow = db.prepare("SELECT value FROM settings WHERE key = ?");
  const setSettingsRow = db.prepare(`
    INSERT INTO settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  const countDepartmentAdmins = db.prepare("SELECT COUNT(*) AS total FROM department_admins");
  const selectDepartmentAdmins = db.prepare(`
    SELECT username, password, role, department, displayName
    FROM department_admins
    ORDER BY department, username
  `);
  const clearDepartmentAdmins = db.prepare("DELETE FROM department_admins");
  const insertDepartmentAdmin = db.prepare(`
    INSERT INTO department_admins (username, password, role, department, displayName)
    VALUES (@username, @password, @role, @department, @displayName)
  `);
  const countApplications = db.prepare("SELECT COUNT(*) AS total FROM applications");
  const selectApplications = db.prepare(`
    SELECT data
    FROM applications
    ORDER BY COALESCE(submittedAt, '') DESC, id DESC
  `);
  const clearApplications = db.prepare("DELETE FROM applications");
  const insertApplication = db.prepare(`
    INSERT INTO applications (
      id,
      placementNumber,
      fullName,
      email,
      institution,
      appliedDepartment,
      assignedDepartment,
      period,
      status,
      submittedAt,
      data
    )
    VALUES (
      @id,
      @placementNumber,
      @fullName,
      @email,
      @institution,
      @appliedDepartment,
      @assignedDepartment,
      @period,
      @status,
      @submittedAt,
      @data
    )
  `);

  const writeDepartmentAdminsTransaction = db.transaction((admins) => {
    clearDepartmentAdmins.run();
    admins.forEach((admin) => {
      insertDepartmentAdmin.run({
        username: (admin.username || "").toString().trim().toLowerCase(),
        password: (admin.password || "").toString(),
        role: (admin.role || "department_admin").toString(),
        department: (admin.department || "").toString(),
        displayName: (admin.displayName || "").toString()
      });
    });
  });

  const writeApplicationsTransaction = db.transaction((applications) => {
    clearApplications.run();
    applications.forEach((application) => {
      const payload = JSON.stringify(application);
      insertApplication.run({
        id: (application.id || "").toString(),
        placementNumber: (application.placementNumber || application.id || "").toString(),
        fullName: (application.fullName || "").toString(),
        email: (application.email || "").toString(),
        institution: (application.institution || "").toString(),
        appliedDepartment: (application.appliedDepartment || application.department || "").toString(),
        assignedDepartment: (application.assignedDepartment || "").toString(),
        period: (application.period || "").toString(),
        status: (application.status || "").toString(),
        submittedAt: (application.submittedAt || "").toString(),
        data: payload
      });
    });
  });

  const getSessionRow = db.prepare("SELECT data, expiresAt FROM sessions WHERE sid = ?");
  const upsertSessionRow = db.prepare(`
    INSERT INTO sessions (sid, expiresAt, data, updatedAt)
    VALUES (@sid, @expiresAt, @data, @updatedAt)
    ON CONFLICT(sid) DO UPDATE SET
      expiresAt = excluded.expiresAt,
      data = excluded.data,
      updatedAt = excluded.updatedAt
  `);
  const deleteSessionRow = db.prepare("DELETE FROM sessions WHERE sid = ?");
  const deleteExpiredSessionsRow = db.prepare(
    "DELETE FROM sessions WHERE expiresAt IS NOT NULL AND expiresAt > 0 AND expiresAt <= ?"
  );

  function writeSettings(settings) {
    setSettingsRow.run("portal_settings", JSON.stringify(settings));
  }

  function readSettings() {
    const row = getSettingsRow.get("portal_settings");
    if (!row) {
      const defaults = createDefaultSettings();
      writeSettings(defaults);
      return defaults;
    }

    try {
      return JSON.parse(row.value);
    } catch (_error) {
      const defaults = createDefaultSettings();
      writeSettings(defaults);
      return defaults;
    }
  }

  function writeDepartmentAdmins(admins) {
    writeDepartmentAdminsTransaction(Array.isArray(admins) ? admins : []);
  }

  function readDepartmentAdmins() {
    return selectDepartmentAdmins.all();
  }

  function writeApplications(applications) {
    writeApplicationsTransaction(Array.isArray(applications) ? applications : []);
  }

  function readApplications() {
    return selectApplications
      .all()
      .map((row) => {
        try {
          return JSON.parse(row.data);
        } catch (_error) {
          return null;
        }
      })
      .filter(Boolean);
  }

  function getSessionExpiry(sessionData) {
    const expiresValue = sessionData?.cookie?.expires;
    if (expiresValue) {
      const dateValue = new Date(expiresValue);
      if (!Number.isNaN(dateValue.getTime())) {
        return dateValue.getTime();
      }
    }

    const maxAge = Number(sessionData?.cookie?.maxAge);
    if (Number.isFinite(maxAge) && maxAge > 0) {
      return Date.now() + maxAge;
    }

    return null;
  }

  function pruneExpiredSessions(now = Date.now()) {
    deleteExpiredSessionsRow.run(now);
  }

  function readSession(sid) {
    pruneExpiredSessions();
    const row = getSessionRow.get(sid);
    if (!row) {
      return null;
    }

    if (row.expiresAt && row.expiresAt > 0 && row.expiresAt <= Date.now()) {
      deleteSessionRow.run(sid);
      return null;
    }

    try {
      return JSON.parse(row.data);
    } catch (_error) {
      deleteSessionRow.run(sid);
      return null;
    }
  }

  function writeSession(sid, sessionData) {
    pruneExpiredSessions();
    upsertSessionRow.run({
      sid,
      expiresAt: getSessionExpiry(sessionData),
      data: JSON.stringify(sessionData || {}),
      updatedAt: new Date().toISOString()
    });
  }

  function deleteSession(sid) {
    deleteSessionRow.run(sid);
  }

  function initializeDefaults() {
    if (!getSettingsRow.get("portal_settings")) {
      writeSettings(createDefaultSettings());
    }

    if ((countDepartmentAdmins.get().total || 0) === 0) {
      writeDepartmentAdmins(createDefaultDepartmentAdmins());
    }
  }

  initializeDefaults();

  return {
    databaseFile,
    readSettings,
    writeSettings,
    readDepartmentAdmins,
    writeDepartmentAdmins,
    readApplications,
    writeApplications,
    readSession,
    writeSession,
    deleteSession,
    pruneExpiredSessions
  };
}

module.exports = {
  createDatabase
};
