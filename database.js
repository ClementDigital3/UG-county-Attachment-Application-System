const crypto = require("crypto");
const fs = require("fs");
const { GridFSBucket, MongoClient, ObjectId } = require("mongodb");

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
  const filesBucket = new GridFSBucket(db, {
    bucketName: "application_files"
  });

  try {
    await sessionsCollection.dropIndex("idx_sessions_expires");
  } catch (err) {
    // Ignore error if it does not exist yet
  }

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
    applicationsCollection.createIndex({ idNumber: 1 }, { name: "idx_applications_idNumber" }),
    applicationsCollection.createIndex(
      { submittedAt: -1, placementNumber: -1 },
      { name: "idx_applications_submitted_placement" }
    ),
    departmentAdminsCollection.createIndex(
      { department: 1, username: 1 },
      { name: "idx_department_admins_department_username" }
    ),
    sessionsCollection.createIndex(
      { expiresAt: 1 },
      { name: "idx_sessions_expires", expireAfterSeconds: 0 }
    )
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
    const incomingList = Array.isArray(applications) ? applications : [];
    const ops = [];

    for (const app of incomingList) {
      if (!app) continue;
      const record = buildApplicationRecord(app);
      
      const originalStateStr = app.__originalState;
      const currentStateStr = JSON.stringify(app);

      if (!originalStateStr || originalStateStr !== currentStateStr) {
        ops.push({
          replaceOne: {
            filter: { _id: record._id },
            replacement: record,
            upsert: true
          }
        });
        
        // Update __originalState property so it is considered synced
        Object.defineProperty(app, "__originalState", {
          value: currentStateStr,
          writable: true,
          enumerable: false,
          configurable: true
        });
      }
    }

    if (ops.length > 0) {
      await applicationsCollection.bulkWrite(ops, { ordered: false });
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

  async function writeStoredFile({
    localPath,
    filename,
    originalName,
    mimeType,
    folder,
    extension
  }) {
    const safeLocalPath = (localPath || "").toString().trim();
    if (!safeLocalPath || !fs.existsSync(safeLocalPath)) {
      throw new Error("Stored file source path was not found.");
    }

    const stats = await fs.promises.stat(safeLocalPath);
    const fileId = new ObjectId();
    const uploadStream = filesBucket.openUploadStreamWithId(
      fileId,
      (filename || originalName || fileId.toString()).toString(),
      {
        contentType: (mimeType || "application/octet-stream").toString(),
        metadata: {
          originalName: (originalName || filename || fileId.toString()).toString(),
          folder: (folder || "applications").toString(),
          extension: (extension || "").toString()
        }
      }
    );

    await new Promise((resolve, reject) => {
      fs.createReadStream(safeLocalPath)
        .on("error", reject)
        .pipe(uploadStream)
        .on("error", reject)
        .on("finish", resolve);
    });

    return {
      storage: "mongodb",
      fileId: fileId.toString(),
      filename: (filename || originalName || fileId.toString()).toString(),
      originalName: (originalName || filename || fileId.toString()).toString(),
      mimeType: (mimeType || "application/octet-stream").toString(),
      size: Number(stats.size || 0),
      extension: (extension || "").toString()
    };
  }

  async function openStoredFile(fileId) {
    const normalizedId = (fileId || "").toString().trim();
    if (!normalizedId || !ObjectId.isValid(normalizedId)) {
      return null;
    }

    const objectId = new ObjectId(normalizedId);
    const fileDocument = await db.collection("application_files.files").findOne({ _id: objectId });
    if (!fileDocument) {
      return null;
    }

    return {
      fileDocument,
      stream: filesBucket.openDownloadStream(objectId)
    };
  }

  async function deleteStoredFile(fileId) {
    const normalizedId = (fileId || "").toString().trim();
    if (!normalizedId || !ObjectId.isValid(normalizedId)) {
      return false;
    }

    try {
      await filesBucket.delete(new ObjectId(normalizedId));
      return true;
    } catch (error) {
      if (error?.message?.includes("FileNotFound")) {
        return false;
      }

      throw error;
    }
  }

  async function restoreApplications(applications) {
    const records = (Array.isArray(applications) ? applications : [])
      .map((application) => buildApplicationRecord(application));

    await applicationsCollection.deleteMany({});
    if (records.length) {
      await applicationsCollection.insertMany(records, { ordered: true });
    }
  }

  async function queuePendingSms(sms) {
    const timestamp = new Date().toISOString();
    const record = {
      _id: (sms.id || crypto.randomUUID()).toString(),
      to: (sms.to || "").toString().trim(),
      message: (sms.message || "").toString().trim(),
      applicationId: (sms.applicationId || "").toString().trim(),
      status: "pending",
      queuedAt: timestamp,
      updatedAt: timestamp
    };
    await db.collection("pending_sms").insertOne(record);
    return record;
  }

  async function getPendingSmsList() {
    const records = await db.collection("pending_sms")
      .find({ status: "pending" })
      .sort({ queuedAt: 1 })
      .toArray();
    return clonePlain(records);
  }

  async function deletePendingSms(id) {
    await db.collection("pending_sms").deleteOne({ _id: id });
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
    restoreApplications,
    queuePendingSms,
    getPendingSmsList,
    deletePendingSms,
    readSession,
    writeSession,
    deleteSession,
    pruneExpiredSessions,
    writeStoredFile,
    openStoredFile,
    deleteStoredFile
  };
}

module.exports = {
  createDatabase
};
