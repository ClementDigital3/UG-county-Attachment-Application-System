const crypto = require("crypto");
const { MongoClient } = require("mongodb");

const DEFAULT_MONGODB_DB_NAME = "attachment_application_system";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function buildApplicationRecord(application) {
  const safeId = (application?.id || application?.placementNumber || crypto.randomUUID()).toString();
  return {
    _id: safeId,
    placementNumber: (application?.placementNumber || safeId).toString(),
    fullName: (application?.fullName || "").toString(),
    email: (application?.email || "").toString(),
    institution: (application?.institution || "").toString(),
    appliedDepartment: (application?.appliedDepartment || application?.department || "").toString(),
    assignedDepartment: (application?.assignedDepartment || "").toString(),
    period: (application?.period || "").toString(),
    status: (application?.status || "").toString(),
    submittedAt: (application?.submittedAt || "").toString(),
    data: clonePlain(application)
  };
}

function buildDepartmentAdminRecord(admin) {
  const timestamp = new Date().toISOString();
  const username = (admin?.username || "").toString().trim().toLowerCase();
  return {
    _id: username,
    username,
    password: (admin?.password || "").toString(),
    role: (admin?.role || "department_admin").toString(),
    department: (admin?.department || "").toString(),
    displayName: (admin?.displayName || "").toString(),
    isActive: admin?.isActive === false ? false : true,
    createdAt: (admin?.createdAt || timestamp).toString(),
    updatedAt: (admin?.updatedAt || timestamp).toString()
  };
}

function buildSettingsRecord(settings) {
  return {
    _id: "portal_settings",
    value: clonePlain(settings),
    updatedAt: new Date().toISOString()
  };
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

async function createDatabase({
  createDefaultSettings,
  createDefaultDepartmentAdmins
}) {
  const mongoUri = (process.env.MONGODB_URI || process.env.MONGO_URI || "").toString().trim();
  const databaseName = (process.env.MONGODB_DB_NAME || DEFAULT_MONGODB_DB_NAME).toString().trim();

  if (!mongoUri) {
    throw new Error("MONGODB_URI is required when using MongoDB storage.");
  }

  const client = new MongoClient(mongoUri);
  await client.connect();

  const db = client.db(databaseName);
  const settingsCollection = db.collection("settings");
  const departmentAdminsCollection = db.collection("department_admins");
  const applicationsCollection = db.collection("applications");
  const sessionsCollection = db.collection("sessions");

  await Promise.all([
    applicationsCollection.createIndex({ status: 1 }, { name: "idx_applications_status" }),
    applicationsCollection.createIndex(
      { appliedDepartment: 1 },
      { name: "idx_applications_department" }
    ),
    applicationsCollection.createIndex(
      { placementNumber: 1 },
      { name: "idx_applications_tracking" }
    ),
    applicationsCollection.createIndex({ email: 1 }, { name: "idx_applications_email" }),
    departmentAdminsCollection.createIndex(
      { department: 1, username: 1 },
      { name: "idx_department_admins_department_username" }
    ),
    sessionsCollection.createIndex({ expiresAt: 1 }, { name: "idx_sessions_expires" })
  ]);

  async function writeSettings(settings) {
    await settingsCollection.replaceOne(
      { _id: "portal_settings" },
      buildSettingsRecord(settings),
      { upsert: true }
    );
  }

  async function readSettings() {
    const row = await settingsCollection.findOne({ _id: "portal_settings" });
    if (!row || !isPlainObject(row.value)) {
      const defaults = createDefaultSettings();
      await writeSettings(defaults);
      return defaults;
    }

    return clonePlain(row.value);
  }

  async function writeDepartmentAdmins(admins) {
    const records = (Array.isArray(admins) ? admins : [])
      .map((admin) => buildDepartmentAdminRecord(admin))
      .filter((admin) => admin.username);

    await departmentAdminsCollection.deleteMany({});
    if (records.length) {
      await departmentAdminsCollection.insertMany(records, { ordered: true });
    }
  }

  async function readDepartmentAdmins() {
    const records = await departmentAdminsCollection
      .find({}, { projection: { _id: 0 } })
      .sort({ department: 1, username: 1 })
      .toArray();

    return clonePlain(records);
  }

  async function writeApplications(applications) {
    const records = (Array.isArray(applications) ? applications : [])
      .map((application) => buildApplicationRecord(application));

    await applicationsCollection.deleteMany({});
    if (records.length) {
      await applicationsCollection.insertMany(records, { ordered: true });
    }
  }

  async function readApplications() {
    const records = await applicationsCollection
      .find({}, { projection: { _id: 0, data: 1, submittedAt: 1 } })
      .sort({ submittedAt: -1, placementNumber: -1 })
      .toArray();

    return records
      .map((record) => clonePlain(record.data))
      .filter(Boolean);
  }

  async function pruneExpiredSessions(now = Date.now()) {
    await sessionsCollection.deleteMany({
      expiresAt: { $ne: null, $lte: now }
    });
  }

  async function readSession(sid) {
    await pruneExpiredSessions();
    const row = await sessionsCollection.findOne(
      { _id: sid },
      { projection: { _id: 0, data: 1, expiresAt: 1 } }
    );

    if (!row) {
      return null;
    }

    if (row.expiresAt && row.expiresAt > 0 && row.expiresAt <= Date.now()) {
      await sessionsCollection.deleteOne({ _id: sid });
      return null;
    }

    return clonePlain(row.data);
  }

  async function writeSession(sid, sessionData) {
    await pruneExpiredSessions();
    await sessionsCollection.replaceOne(
      { _id: sid },
      {
        _id: sid,
        sid,
        expiresAt: getSessionExpiry(sessionData),
        data: clonePlain(sessionData || {}),
        updatedAt: new Date().toISOString()
      },
      { upsert: true }
    );
  }

  async function deleteSession(sid) {
    await sessionsCollection.deleteOne({ _id: sid });
  }

  async function initializeDefaults() {
    const [settingsRow, departmentAdminCount] = await Promise.all([
      settingsCollection.findOne({ _id: "portal_settings" }, { projection: { _id: 1 } }),
      departmentAdminsCollection.countDocuments()
    ]);

    if (!settingsRow) {
      await writeSettings(createDefaultSettings());
    }

    if (!departmentAdminCount) {
      await writeDepartmentAdmins(createDefaultDepartmentAdmins());
    }
  }

  await initializeDefaults();

  return {
    client,
    databaseName,
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
