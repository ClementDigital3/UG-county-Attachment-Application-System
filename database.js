const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function safeReadJson(filePath, fallback) {
  if (!filePath || !fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (_error) {
    return fallback;
  }
}

function createDatabase({
  dataDir,
  databaseFile,
  legacyPaths = {},
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

  function migrateLegacyData() {
    const hasSettings = Boolean(getSettingsRow.get("portal_settings"));
    if (!hasSettings) {
      const legacySettings = safeReadJson(legacyPaths.settings, null);
      writeSettings(legacySettings && typeof legacySettings === "object" ? legacySettings : createDefaultSettings());
    }

    if ((countDepartmentAdmins.get().total || 0) === 0) {
      const legacyAdmins = safeReadJson(legacyPaths.departmentAdmins, null);
      writeDepartmentAdmins(
        Array.isArray(legacyAdmins) && legacyAdmins.length
          ? legacyAdmins
          : createDefaultDepartmentAdmins()
      );
    }

    if ((countApplications.get().total || 0) === 0) {
      const legacyApplications = safeReadJson(legacyPaths.applications, null);
      if (Array.isArray(legacyApplications) && legacyApplications.length) {
        writeApplications(legacyApplications);
      }
    }
  }

  migrateLegacyData();

  return {
    databaseFile,
    readSettings,
    writeSettings,
    readDepartmentAdmins,
    writeDepartmentAdmins,
    readApplications,
    writeApplications
  };
}

module.exports = {
  createDatabase
};
