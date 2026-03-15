require("dotenv").config();

const express = require("express");
const session = require("express-session");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createDatabase } = require("./database");

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024;
const APP_ROOT = __dirname;
const STORAGE_ROOT = process.env.STORAGE_ROOT
  ? path.resolve(process.env.STORAGE_ROOT)
  : APP_ROOT;
const DATA_DIR = path.join(STORAGE_ROOT, "data");
const UPLOAD_DIR = path.join(STORAGE_ROOT, "uploads");
const PUBLIC_DIR = path.join(APP_ROOT, "public");
const VIEWS_DIR = path.join(APP_ROOT, "views");

const FILE_TYPE_HEADERS = {
  pdf: Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]), // %PDF-
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpeg: Buffer.from([0xff, 0xd8, 0xff]),
  exe: Buffer.from([0x4d, 0x5a]) // MZ
};

const EICAR_SIGNATURE =
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
const STATUS_OPTIONS = ["Pending", "Needs Correction", "Verified", "Approved", "Rejected"];
const HR_VISIBLE_STATUSES = new Set(["Verified", "Approved", "Rejected"]);
const DEFAULT_INSTITUTION_MAX_SHARE_PERCENT = 40;
const DATABASE_FILE = process.env.DATABASE_FILE
  ? path.resolve(process.env.DATABASE_FILE)
  : path.join(DATA_DIR, "attachment-application-system.db");

const PERIODS = [
  { key: "JAN_APR", label: "January - April" },
  { key: "MAY_AUG", label: "May - August" },
  { key: "SEP_DEC", label: "September - December" }
];

const DEPARTMENTS = [
  { key: "ict", label: "ICT, E-Governonance & Innovation" },
  { key: "finance", label: "Finance and Economic Planning" },
  { key: "health", label: "Health Services" },
  { key: "agriculture", label: "Agriculture, Livestock and Fisheries" },
  { key: "roads", label: "Roads, Transport and Public Works" },
  { key: "education", label: "Education, Vocational Training, Youth and Sports" },
  { key: "lands", label: "Lands, Housing, Physical Planning and Urban Development" },
  { key: "water", label: "Water, Irrigation, Environment and Climate Change" },
  { key: "trade", label: "Trade, Cooperatives, Tourism and Industrialization" },
  { key: "public_service", label: "Public Service Management and Administration" }
];

const DOCUMENT_DEFINITIONS = [
  {
    key: "passportPhoto",
    label: "Sized Passport Photo",
    accept: ".jpg,.jpeg,.png,image/jpeg,image/png",
    allowedExtensions: new Set([".jpg", ".jpeg", ".png"]),
    allowedMimeTypes: new Set(["image/jpeg", "image/png"]),
    allowedDetectedTypes: new Set(["jpeg", "png"])
  },
  {
    key: "applicationLetter",
    label: "Application Letter",
    accept: ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png",
    allowedExtensions: new Set([".pdf", ".jpg", ".jpeg", ".png"]),
    allowedMimeTypes: new Set(["application/pdf", "image/jpeg", "image/png"]),
    allowedDetectedTypes: new Set(["pdf", "jpeg", "png"])
  },
  {
    key: "schoolCoverLetter",
    label: "School Cover Letter",
    accept: ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png",
    allowedExtensions: new Set([".pdf", ".jpg", ".jpeg", ".png"]),
    allowedMimeTypes: new Set(["application/pdf", "image/jpeg", "image/png"]),
    allowedDetectedTypes: new Set(["pdf", "jpeg", "png"])
  },
  {
    key: "insuranceCopy",
    label: "Insurance Copy",
    accept: ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png",
    allowedExtensions: new Set([".pdf", ".jpg", ".jpeg", ".png"]),
    allowedMimeTypes: new Set(["application/pdf", "image/jpeg", "image/png"]),
    allowedDetectedTypes: new Set(["pdf", "jpeg", "png"])
  },
  {
    key: "idCopyBothSides",
    label: "Copy of Both Sides of National ID / School ID",
    accept: ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png",
    allowedExtensions: new Set([".pdf", ".jpg", ".jpeg", ".png"]),
    allowedMimeTypes: new Set(["application/pdf", "image/jpeg", "image/png"]),
    allowedDetectedTypes: new Set(["pdf", "jpeg", "png"])
  },
  {
    key: "nitaCopy",
    label: "NITA Copy with School Stamp",
    accept: ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png",
    allowedExtensions: new Set([".pdf", ".jpg", ".jpeg", ".png"]),
    allowedMimeTypes: new Set(["application/pdf", "image/jpeg", "image/png"]),
    allowedDetectedTypes: new Set(["pdf", "jpeg", "png"])
  }
];

const COMBINED_DOCUMENT_FIELD = "combinedDocuments";
const COMBINED_DOCUMENT_DEFINITION = {
  key: COMBINED_DOCUMENT_FIELD,
  label: "Combined Scanned Document (All Required Documents)",
  accept: ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png",
  allowedExtensions: new Set([".pdf", ".jpg", ".jpeg", ".png"]),
  allowedMimeTypes: new Set(["application/pdf", "image/jpeg", "image/png"]),
  allowedDetectedTypes: new Set(["pdf", "jpeg", "png"])
};

const JOINING_LETTER_FIELD = "joiningLetter";
const JOINING_LETTER_POLICY = {
  key: JOINING_LETTER_FIELD,
  label: "Joining letter",
  accept: ".pdf,application/pdf",
  allowedExtensions: new Set([".pdf"]),
  allowedMimeTypes: new Set(["application/pdf"]),
  allowedDetectedTypes: new Set(["pdf"])
};

const REQUIRED_DOCUMENT_FIELDS = DOCUMENT_DEFINITIONS.map((document) => document.key);
const DOCUMENT_SECURITY_POLICY = Object.fromEntries(
  DOCUMENT_DEFINITIONS.map((document) => [document.key, document])
);
const UPLOAD_SECURITY_POLICY = {
  ...DOCUMENT_SECURITY_POLICY,
  [COMBINED_DOCUMENT_FIELD]: COMBINED_DOCUMENT_DEFINITION,
  [JOINING_LETTER_FIELD]: JOINING_LETTER_POLICY
};

const HR_USERNAME = process.env.HR_USERNAME || "hr_admin";
const HR_PASSWORD = process.env.HR_PASSWORD || "hr123";
const PRESENTATION_LOGIN_USERNAME = process.env.PRESENTATION_LOGIN_USERNAME || "";
const PRESENTATION_LOGIN_PASSWORD = process.env.PRESENTATION_LOGIN_PASSWORD || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "change-this-secret";
const SESSION_COOKIE_MAX_AGE_HOURS = Number(process.env.SESSION_COOKIE_MAX_AGE_HOURS || 12);
const ADMIN_PORTAL_PATH = process.env.ADMIN_PORTAL_PATH || "/staff-portal";
const HR_PORTAL_PATH = process.env.HR_PORTAL_PATH || "/hr-portal";
const DISPLAY_TIMEZONE = process.env.DISPLAY_TIMEZONE || "Africa/Nairobi";
const ALLOW_ANY_TEST_UPLOADS = process.env.ALLOW_ANY_TEST_UPLOADS === "true";
const DEFAULT_DEPARTMENT_ADMIN_PASSWORD =
  process.env.DEFAULT_DEPARTMENT_ADMIN_PASSWORD || "change_me";

function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

ensureDirectoryExists(DATA_DIR);
ensureDirectoryExists(UPLOAD_DIR);

function createDefaultDepartmentCapacities(defaultCapacity = 10) {
  return DEPARTMENTS.reduce((acc, department) => {
    acc[department.key] = defaultCapacity;
    return acc;
  }, {});
}

function createDefaultSettings() {
  const departmentCapacities = createDefaultDepartmentCapacities();
  const totalCapacity = Object.values(departmentCapacities).reduce((sum, value) => sum + value, 0);

  return {
    openPeriods: PERIODS.reduce((acc, period) => {
      acc[period.key] = false;
      return acc;
    }, {}),
    maxApplicants: totalCapacity,
    institutionMaxSharePercent: DEFAULT_INSTITUTION_MAX_SHARE_PERCENT,
    departmentCapacities,
    updatedAt: new Date().toISOString()
  };
}

function createDefaultDepartmentAdmins() {
  return DEPARTMENTS.map((department) => ({
    username: `${department.key}_admin`,
    password: DEFAULT_DEPARTMENT_ADMIN_PASSWORD,
    role: "department_admin",
    department: department.key,
    displayName: `${department.label} Admin`
  }));
}

const database = createDatabase({
  dataDir: DATA_DIR,
  databaseFile: DATABASE_FILE,
  createDefaultSettings,
  createDefaultDepartmentAdmins
});

class SqliteSessionStore extends session.Store {
  constructor(db) {
    super();
    this.db = db;
  }

  get(sid, callback) {
    try {
      const sessionData = this.db.readSession(sid);
      callback(null, sessionData);
    } catch (error) {
      callback(error);
    }
  }

  set(sid, sessionData, callback) {
    try {
      this.db.writeSession(sid, sessionData);
      callback?.(null);
    } catch (error) {
      callback?.(error);
    }
  }

  destroy(sid, callback) {
    try {
      this.db.deleteSession(sid);
      callback?.(null);
    } catch (error) {
      callback?.(error);
    }
  }

  touch(sid, sessionData, callback) {
    try {
      this.db.writeSession(sid, sessionData);
      callback?.(null);
    } catch (error) {
      callback?.(error);
    }
  }
}

const sessionStore = new SqliteSessionStore(database);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_UPLOAD_SIZE_BYTES
  },
  fileFilter: (_req, file, cb) => {
    const policy = UPLOAD_SECURITY_POLICY[file.fieldname];
    const ext = path.extname(file.originalname).toLowerCase();

    if (!policy) {
      return cb(new Error("Unexpected upload field."));
    }

    if (
      ALLOW_ANY_TEST_UPLOADS &&
      (REQUIRED_DOCUMENT_FIELDS.includes(file.fieldname) || file.fieldname === COMBINED_DOCUMENT_FIELD)
    ) {
      return cb(null, true);
    }

    if (!policy.allowedExtensions.has(ext)) {
      return cb(new Error(`${policy.label} has an invalid file extension.`));
    }

    if (file.mimetype && !policy.allowedMimeTypes.has(file.mimetype.toLowerCase())) {
      return cb(new Error(`${policy.label} has an invalid file type.`));
    }

    return cb(null, true);
  }
});

const studentDocumentsUploadMiddleware = upload.fields(
  [...REQUIRED_DOCUMENT_FIELDS, COMBINED_DOCUMENT_FIELD].map((fieldName) => ({
    name: fieldName,
    maxCount: 1
  }))
);

const joiningLetterUploadMiddleware = upload.single(JOINING_LETTER_FIELD);

app.set("view engine", "ejs");
app.set("views", VIEWS_DIR);
app.set("trust proxy", 1);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(PUBLIC_DIR));
app.use(
  session({
    store: sessionStore,
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: Math.max(1, SESSION_COOKIE_MAX_AGE_HOURS) * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production"
    }
  })
);

function createDefaultDocumentsReview() {
  return REQUIRED_DOCUMENT_FIELDS.reduce((acc, fieldName) => {
    acc[fieldName] = {
      status: "Pending",
      comment: ""
    };
    return acc;
  }, {});
}

function createDefaultCombinedDocumentReview() {
  return {
    status: "Pending",
    comment: ""
  };
}

function normalizeDocumentsReview(documentsReview) {
  const defaults = createDefaultDocumentsReview();
  const source = documentsReview || {};

  REQUIRED_DOCUMENT_FIELDS.forEach((fieldName) => {
    const rawStatus = source[fieldName]?.status;
    const safeStatus = ["Pending", "Accepted", "Rejected"].includes(rawStatus)
      ? rawStatus
      : defaults[fieldName].status;

    defaults[fieldName] = {
      status: safeStatus,
      comment: (source[fieldName]?.comment || "").toString().trim()
    };
  });

  return defaults;
}

function normalizeCombinedDocumentReview(review) {
  const defaults = createDefaultCombinedDocumentReview();
  const rawStatus = review?.status;
  const safeStatus = ["Pending", "Accepted", "Rejected"].includes(rawStatus)
    ? rawStatus
    : defaults.status;

  return {
    status: safeStatus,
    comment: (review?.comment || "").toString().trim()
  };
}

function getDocumentDefinition(fieldName) {
  return DOCUMENT_DEFINITIONS.find((document) => document.key === fieldName) || null;
}

function getDocumentLabel(fieldName) {
  if (fieldName === COMBINED_DOCUMENT_FIELD) {
    return COMBINED_DOCUMENT_DEFINITION.label;
  }

  return getDocumentDefinition(fieldName)?.label || fieldName;
}

function ensureApplicationDefaults(application) {
  const appliedDepartment = application.appliedDepartment || application.department || "";

  return {
    ...application,
    placementNumber: application.placementNumber || application.id || "",
    appliedDepartment,
    assignedDepartment: application.assignedDepartment || "",
    documents: application.documents || {},
    documentSecurity: application.documentSecurity || {},
    documentsReview: normalizeDocumentsReview(application.documentsReview),
    combinedDocument: application.combinedDocument || null,
    combinedDocumentReview: normalizeCombinedDocumentReview(application.combinedDocumentReview),
    joiningLetter: application.joiningLetter || null
  };
}

function readApplications() {
  return database.readApplications().map((application) => ensureApplicationDefaults(application));
}

function writeApplications(applications) {
  database.writeApplications(applications);
}

function readSettings() {
  const parsed = database.readSettings();
  const normalized = createDefaultSettings();

  PERIODS.forEach((period) => {
    normalized.openPeriods[period.key] = Boolean(parsed?.openPeriods?.[period.key]);
  });

  DEPARTMENTS.forEach((department) => {
    const rawCapacity = Number(parsed?.departmentCapacities?.[department.key]);
    normalized.departmentCapacities[department.key] =
      Number.isInteger(rawCapacity) && rawCapacity >= 0
        ? rawCapacity
        : normalized.departmentCapacities[department.key];
  });

  normalized.maxApplicants = Object.values(normalized.departmentCapacities).reduce(
    (sum, value) => sum + value,
    0
  );
  const institutionShare = Number(parsed?.institutionMaxSharePercent);
  normalized.institutionMaxSharePercent =
    Number.isInteger(institutionShare) && institutionShare >= 1 && institutionShare <= 100
      ? institutionShare
      : DEFAULT_INSTITUTION_MAX_SHARE_PERCENT;

  normalized.updatedAt = parsed?.updatedAt || normalized.updatedAt;
  return normalized;
}

function writeSettings(settings) {
  database.writeSettings(settings);
}

function getCapacitySummary(settings, applications) {
  const applicationsByDepartment = DEPARTMENTS.reduce((acc, department) => {
    acc[department.key] = applications.filter(
      (application) => application.appliedDepartment === department.key
    ).length;
    return acc;
  }, {});

  const departmentCapacities = settings.departmentCapacities || createDefaultDepartmentCapacities(0);
  const departmentRemaining = DEPARTMENTS.reduce((acc, department) => {
    const capacity = Number(departmentCapacities[department.key]) || 0;
    const used = applicationsByDepartment[department.key] || 0;
    acc[department.key] = Math.max(0, capacity - used);
    return acc;
  }, {});

  const totalCapacity = DEPARTMENTS.reduce(
    (sum, department) => sum + (Number(departmentCapacities[department.key]) || 0),
    0
  );
  const totalRemaining = DEPARTMENTS.reduce(
    (sum, department) => sum + (departmentRemaining[department.key] || 0),
    0
  );

  return {
    departmentCapacities,
    applicationsByDepartment,
    departmentRemaining,
    totalCapacity,
    totalRemaining
  };
}

function normalizeAdminUsername(username) {
  return (username || "").toString().trim().toLowerCase();
}

function isPresentationLogin(usernameInput, passwordInput) {
  const configuredUsername = normalizeAdminUsername(PRESENTATION_LOGIN_USERNAME);
  const configuredPassword = (PRESENTATION_LOGIN_PASSWORD || "").toString();
  const username = normalizeAdminUsername(usernameInput);
  const password = (passwordInput || "").toString();

  if (!configuredUsername || !configuredPassword) {
    return false;
  }

  return username === configuredUsername && password === configuredPassword;
}

function normalizeDepartmentAdminUser(user) {
  const username = normalizeAdminUsername(user?.username);
  const password = (user?.password || "").toString();
  const role = (user?.role || "department_admin").toString().trim();
  const department = (user?.department || "").toString().trim();
  const displayName = (user?.displayName || "").toString().trim();

  if (!username || !password) {
    return null;
  }

  if (role !== "department_admin") {
    return null;
  }

  if (!isValidDepartment(department)) {
    return null;
  }

  return {
    username,
    password,
    role: "department_admin",
    department,
    displayName: displayName || `${getDepartmentLabel(department)} Admin`
  };
}

function readDepartmentAdmins() {
  const normalized = database
    .readDepartmentAdmins()
    .map((item) => normalizeDepartmentAdminUser(item))
    .filter(Boolean);

  if (normalized.length) {
    return normalized;
  }

  const defaults = createDefaultDepartmentAdmins();
  database.writeDepartmentAdmins(defaults);
  return defaults.map((item) => normalizeDepartmentAdminUser(item)).filter(Boolean);
}

function findAdminUserByCredentials(usernameInput, passwordInput) {
  const username = normalizeAdminUsername(usernameInput);
  const password = (passwordInput || "").toString();

  if (!username || !password) {
    return null;
  }

  if (username === normalizeAdminUsername(HR_USERNAME) && password === HR_PASSWORD) {
    return {
      username,
      role: "hr_admin",
      department: null,
      displayName: "HR Administrator"
    };
  }

  const departmentAdmin = readDepartmentAdmins().find(
    (item) => item.username === username && item.password === password
  );

  return departmentAdmin || null;
}

function isSuperAdminSession(req) {
  if (!req.session?.isAdmin) {
    return false;
  }

  return (req.session.adminRole || "hr_admin") === "hr_admin";
}

function getAdminScopeDepartment(req) {
  if (!req.session?.isAdmin) {
    return null;
  }

  const department = (
    req.session.adminScopeDepartment ||
    req.session.adminDepartment ||
    ""
  ).toString().trim();
  return isValidDepartment(department) ? department : null;
}

function filterApplicationsForAdmin(req, applications) {
  const scopedDepartment = getAdminScopeDepartment(req);
  if (!scopedDepartment) {
    return applications;
  }

  return applications.filter((application) => application.appliedDepartment === scopedDepartment);
}

function canAdminAccessApplication(req, application) {
  const scopedDepartment = getAdminScopeDepartment(req);
  if (!scopedDepartment) {
    return true;
  }

  return application.appliedDepartment === scopedDepartment;
}

function doesApplicationReferenceFile(application, filename) {
  const safeFilename = path.basename(filename || "");
  if (!safeFilename) {
    return false;
  }

  const documentFiles = Object.values(application.documents || {}).map((value) =>
    path.basename(value || "")
  );

  return (
    documentFiles.includes(safeFilename) ||
    path.basename(application.combinedDocument?.filename || "") === safeFilename ||
    path.basename(application.joiningLetter?.filename || "") === safeFilename
  );
}

function getPeriodOptions(settings) {
  return PERIODS.map((period) => ({
    ...period,
    isOpen: Boolean(settings.openPeriods[period.key])
  }));
}

function getPeriodLabel(periodKey) {
  return PERIODS.find((period) => period.key === periodKey)?.label || periodKey;
}

function getDepartmentLabel(departmentKey) {
  return DEPARTMENTS.find((department) => department.key === departmentKey)?.label || "Not set";
}

function isValidDepartment(departmentKey) {
  return DEPARTMENTS.some((department) => department.key === departmentKey);
}

function normalizeInstitutionName(institutionName) {
  return (institutionName || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ");
}

function getInstitutionLimitForDepartment(settings, departmentKey) {
  const departmentCapacity = Number(settings?.departmentCapacities?.[departmentKey] || 0);
  if (departmentCapacity <= 0) {
    return 0;
  }

  const ratio = Number(settings?.institutionMaxSharePercent || DEFAULT_INSTITUTION_MAX_SHARE_PERCENT);
  const safeRatio = Number.isFinite(ratio) ? Math.max(1, Math.min(100, ratio)) : DEFAULT_INSTITUTION_MAX_SHARE_PERCENT;
  return Math.max(1, Math.floor((departmentCapacity * safeRatio) / 100));
}

function getInstitutionUsageCount(applications, departmentKey, institutionName, excludeId = null) {
  const institutionKey = normalizeInstitutionName(institutionName);
  if (!institutionKey) {
    return 0;
  }

  return applications.filter((application) => {
    if (excludeId && application.id === excludeId) {
      return false;
    }

    return (
      application.appliedDepartment === departmentKey &&
      normalizeInstitutionName(application.institution) === institutionKey
    );
  }).length;
}

function buildInstitutionCatalog(applications) {
  const buckets = new Map();

  applications.forEach((application) => {
    const key = normalizeInstitutionName(application.institution);
    if (!key) {
      return;
    }

    const label = (application.institution || "").toString().trim();
    if (!buckets.has(key)) {
      buckets.set(key, {
        key,
        label,
        count: 0
      });
    }

    const current = buckets.get(key);
    current.count += 1;

    if (!current.label && label) {
      current.label = label;
    }
  });

  return Array.from(buckets.values()).sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label)
  );
}

function getInstitutionDistribution(applications, { departmentKey = null, limit = 6 } = {}) {
  const catalog = buildInstitutionCatalog(
    departmentKey
      ? applications.filter((application) => application.appliedDepartment === departmentKey)
      : applications
  );

  return catalog
    .slice(0, Math.max(1, limit));
}

function getInstitutionSuggestions(applications, settings, departmentKey, query, limit = 6) {
  const trimmedQuery = (query || "").toString().trim();
  const normalizedQuery = normalizeInstitutionName(trimmedQuery);
  const institutionLimit = getInstitutionLimitForDepartment(settings, departmentKey);
  const catalog = buildInstitutionCatalog(applications);

  const createSuggestion = (item) => {
    const usedSlots = getInstitutionUsageCount(applications, departmentKey, item.label);
    const remainingSlots =
      institutionLimit > 0 ? Math.max(0, institutionLimit - usedSlots) : 0;

    return {
      label: item.label,
      usedSlots,
      remainingSlots,
      institutionLimit,
      isFull: institutionLimit > 0 && remainingSlots <= 0
    };
  };

  const matches = catalog
    .filter((item) => !normalizedQuery || item.key.includes(normalizedQuery))
    .map((item) => createSuggestion(item))
    .sort(
      (a, b) =>
        Number(a.isFull) - Number(b.isFull) ||
        b.remainingSlots - a.remainingSlots ||
        a.label.localeCompare(b.label)
    )
    .slice(0, Math.max(1, limit));

  const exactMatchItem = catalog.find((item) => item.key === normalizedQuery);
  const exactMatch = exactMatchItem ? createSuggestion(exactMatchItem) : null;

  return {
    institutionLimit,
    exactMatch,
    suggestions: matches
  };
}

function getInstitutionFullNameError(institutionName) {
  const raw = (institutionName || "").toString().trim();
  if (!raw) {
    return "Please provide the institution name.";
  }

  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length < 2) {
    return "Please enter the institution name in full without abbreviations (for example: University of Nairobi).";
  }

  const hasAbbreviationToken = words.some((word) => {
    const lettersOnly = word.replace(/[^A-Za-z]/g, "");
    if (!lettersOnly) {
      return false;
    }

    if (word.includes(".")) {
      return true;
    }

    if (lettersOnly.length === 1) {
      return true;
    }

    return /^[A-Z]{2,6}$/.test(lettersOnly);
  });

  if (hasAbbreviationToken) {
    return "Please enter the institution name in full without abbreviations (for example: University of Nairobi).";
  }

  return null;
}

function getStatusClass(status) {
  return (status || "").toLowerCase().replace(/\s+/g, "-");
}

function generateApplicationId(applications) {
  let id = "";

  do {
    id = `ATT-${Date.now()}-${crypto.randomInt(100, 1000)}`;
  } while (applications.some((item) => (item.id || "").toUpperCase() === id));

  return id;
}

function generatePlacementNumber(applications) {
  const year = new Date().getFullYear();
  let placementNumber = "";

  do {
    placementNumber = `UG-ATT-${year}-${crypto.randomInt(100000, 1000000)}`;
  } while (
    applications.some(
      (item) => (item.placementNumber || "").toUpperCase() === placementNumber
    )
  );

  return placementNumber;
}

function getTrackingNumber(application) {
  return (application?.placementNumber || application?.id || "").toString().trim();
}

function matchesTrackingNumber(application, trackingNumber) {
  const probe = (trackingNumber || "").toString().trim().toLowerCase();
  if (!probe) {
    return false;
  }

  const appId = (application.id || "").toString().trim().toLowerCase();
  const placementNumber = (application.placementNumber || "")
    .toString()
    .trim()
    .toLowerCase();

  return appId === probe || placementNumber === probe;
}

function findApplicationIndexByTrackingAndEmail(applications, trackingNumber, email) {
  const normalizedEmail = (email || "").toString().trim().toLowerCase();

  return applications.findIndex(
    (item) =>
      matchesTrackingNumber(item, trackingNumber) &&
      (item.email || "").toString().trim().toLowerCase() === normalizedEmail
  );
}

function removeStoredFile(filename) {
  if (!filename) {
    return;
  }

  const safeFilename = path.basename(filename);
  const target = path.join(UPLOAD_DIR, safeFilename);

  if (!fs.existsSync(target)) {
    return;
  }

  try {
    fs.unlinkSync(target);
  } catch (_error) {
    // Ignore cleanup failures so core flow can proceed.
  }
}

function cleanupUploadedFiles(files) {
  Object.values(files || {}).forEach((fileList) => {
    (fileList || []).forEach((file) => {
      removeStoredFile(file.filename);
    });
  });
}

function cleanupApplicationDocuments(application) {
  Object.values(application?.documents || {}).forEach((filename) => {
    removeStoredFile(filename);
  });

  removeStoredFile(application?.combinedDocument?.filename);
  removeStoredFile(application?.joiningLetter?.filename);
}

function detectFileTypeFromHeader(headerBuffer) {
  if (headerBuffer.subarray(0, FILE_TYPE_HEADERS.exe.length).equals(FILE_TYPE_HEADERS.exe)) {
    return "exe";
  }

  if (headerBuffer.subarray(0, FILE_TYPE_HEADERS.pdf.length).equals(FILE_TYPE_HEADERS.pdf)) {
    return "pdf";
  }

  if (headerBuffer.subarray(0, FILE_TYPE_HEADERS.png.length).equals(FILE_TYPE_HEADERS.png)) {
    return "png";
  }

  if (headerBuffer.subarray(0, FILE_TYPE_HEADERS.jpeg.length).equals(FILE_TYPE_HEADERS.jpeg)) {
    return "jpeg";
  }

  return "unknown";
}

function getPngDimensions(buffer) {
  if (buffer.length < 24) {
    return null;
  }

  if (!buffer.subarray(0, FILE_TYPE_HEADERS.png.length).equals(FILE_TYPE_HEADERS.png)) {
    return null;
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function getJpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }

  const sofMarkers = new Set([
    0xc0,
    0xc1,
    0xc2,
    0xc3,
    0xc5,
    0xc6,
    0xc7,
    0xc9,
    0xca,
    0xcb,
    0xcd,
    0xce,
    0xcf
  ]);

  let offset = 2;

  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    offset += 2;

    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      continue;
    }

    if (offset + 2 > buffer.length) {
      break;
    }

    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) {
      break;
    }

    if (sofMarkers.has(marker)) {
      if (segmentLength < 7) {
        return null;
      }

      return {
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5)
      };
    }

    offset += segmentLength;
  }

  return null;
}

function getImageDimensions(fileBuffer, detectedType) {
  if (detectedType === "png") {
    return getPngDimensions(fileBuffer);
  }

  if (detectedType === "jpeg") {
    return getJpegDimensions(fileBuffer);
  }

  return null;
}

function scanUploadedFile(file) {
  const policy = UPLOAD_SECURITY_POLICY[file.fieldname];

  if (!policy) {
    throw new Error("Unexpected upload field.");
  }

  const safePath = path.resolve(file.path);
  if (!safePath.startsWith(path.resolve(UPLOAD_DIR))) {
    throw new Error(`${policy.label} failed path security validation.`);
  }

  const stats = fs.statSync(safePath);
  if (!stats.isFile() || stats.size <= 0) {
    throw new Error(`${policy.label} appears empty or invalid.`);
  }

  if (stats.size > MAX_UPLOAD_SIZE_BYTES) {
    throw new Error(`${policy.label} exceeds the maximum allowed size of 5MB.`);
  }

  if (
    ALLOW_ANY_TEST_UPLOADS &&
    (REQUIRED_DOCUMENT_FIELDS.includes(file.fieldname) || file.fieldname === COMBINED_DOCUMENT_FIELD)
  ) {
    const fileBufferForTest = fs.readFileSync(safePath);
    const testSha256 = crypto.createHash("sha256").update(fileBufferForTest).digest("hex");
    return {
      size: stats.size,
      detectedType: "test-bypass",
      sha256: testSha256,
      dimensions: null,
      scannedAt: new Date().toISOString(),
      bypassed: true
    };
  }

  const ext = path.extname(file.originalname).toLowerCase();
  if (!policy.allowedExtensions.has(ext)) {
    throw new Error(`${policy.label} has an invalid file extension.`);
  }

  const fileBuffer = fs.readFileSync(safePath);
  const detectedType = detectFileTypeFromHeader(fileBuffer.subarray(0, 16));

  if (detectedType === "exe") {
    throw new Error(`${policy.label} failed security scan: executable content detected.`);
  }

  if (!policy.allowedDetectedTypes.has(detectedType)) {
    throw new Error(`${policy.label} failed file signature validation.`);
  }

  if (fileBuffer.includes(Buffer.from(EICAR_SIGNATURE, "utf-8"))) {
    throw new Error(`${policy.label} failed malware scan.`);
  }

  let dimensions = null;
  if (policy.requiredImageSize) {
    dimensions = getImageDimensions(fileBuffer, detectedType);

    if (!dimensions) {
      throw new Error(`${policy.label} image dimensions could not be read.`);
    }

    if (
      dimensions.width !== policy.requiredImageSize.width ||
      dimensions.height !== policy.requiredImageSize.height
    ) {
      throw new Error(
        `${policy.label} must be exactly ${policy.requiredImageSize.width}px by ${policy.requiredImageSize.height}px.`
      );
    }
  }

  const sha256 = crypto.createHash("sha256").update(fileBuffer).digest("hex");

  return {
    size: stats.size,
    detectedType,
    sha256,
    dimensions,
    scannedAt: new Date().toISOString()
  };
}

function scanUploadedFiles(files, fieldNames) {
  const securityMeta = {};

  fieldNames.forEach((fieldName) => {
    const uploaded = files[fieldName]?.[0];
    if (!uploaded) {
      return;
    }

    securityMeta[fieldName] = scanUploadedFile(uploaded);
  });

  return securityMeta;
}

function getUploadErrorMessage(uploadError) {
  if (!uploadError) {
    return "Upload failed. Please check your files and try again.";
  }

  if (uploadError instanceof multer.MulterError) {
    if (uploadError.code === "LIMIT_FILE_SIZE") {
      return "Upload failed: each file must be 5MB or less.";
    }

    if (uploadError.code === "LIMIT_UNEXPECTED_FILE") {
      return "Upload failed: unexpected document field was uploaded.";
    }

    return "Upload failed: please check your document files and try again.";
  }

  if (uploadError.message) {
    return uploadError.message;
  }

  return "Upload failed. Please check your files and try again.";
}

function getRejectedDocuments(application) {
  const normalized = ensureApplicationDefaults(application);
  const acceptAll = ALLOW_ANY_TEST_UPLOADS ? "*/*" : undefined;

  if (normalized.combinedDocument?.filename) {
    if (normalized.combinedDocumentReview.status !== "Rejected") {
      return [];
    }

    return [
      {
        ...COMBINED_DOCUMENT_DEFINITION,
        accept: acceptAll || COMBINED_DOCUMENT_DEFINITION.accept,
        review: normalized.combinedDocumentReview
      }
    ];
  }

  return DOCUMENT_DEFINITIONS
    .filter((document) => normalized.documentsReview[document.key].status === "Rejected")
    .map((document) => ({
      ...document,
      accept: acceptAll || document.accept,
      review: normalized.documentsReview[document.key]
    }));
}

function hasAnyRejectedDocuments(application) {
  const normalized = ensureApplicationDefaults(application);
  if (normalized.combinedDocument?.filename) {
    return normalized.combinedDocumentReview.status === "Rejected";
  }

  return REQUIRED_DOCUMENT_FIELDS.some(
    (fieldName) => normalized.documentsReview[fieldName].status === "Rejected"
  );
}

function getViewDocumentDefinitions() {
  return DOCUMENT_DEFINITIONS.map((document) => ({
    ...document,
    accept: ALLOW_ANY_TEST_UPLOADS ? "*/*" : document.accept
  }));
}

function getViewCombinedDocumentDefinition() {
  return {
    ...COMBINED_DOCUMENT_DEFINITION,
    accept: ALLOW_ANY_TEST_UPLOADS ? "*/*" : COMBINED_DOCUMENT_DEFINITION.accept
  };
}

function ensureDepartmentAdmin(req, res, next) {
  if (req.session?.isAdmin && req.session.adminRole === "department_admin") {
    return next();
  }

  if (req.session?.isAdmin && req.session.adminRole === "hr_admin") {
    return res.redirect("/hr/applications");
  }

  return res.redirect(ADMIN_PORTAL_PATH);
}

function ensureHrAdmin(req, res, next) {
  if (req.session?.isAdmin && req.session.adminRole === "hr_admin") {
    return next();
  }

  if (req.session?.isAdmin && req.session.adminRole === "department_admin") {
    return res.redirect("/admin/applications");
  }

  return res.redirect(HR_PORTAL_PATH);
}

function formatDate(dateStr) {
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) {
    return "Not available";
  }

  return parsed.toLocaleString("en-KE", {
    timeZone: DISPLAY_TIMEZONE,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short"
  });
}

function renderApplyPage(res, { error = null, formData = {}, statusCode = 200 } = {}) {
  const settings = readSettings();
  const periodOptions = getPeriodOptions(settings);
  const hasOpenPeriods = periodOptions.some((period) => period.isOpen);
  const applications = readApplications();
  const capacitySummary = getCapacitySummary(settings, applications);
  const maxApplicants = capacitySummary.totalCapacity;
  const remainingApplicants = capacitySummary.totalRemaining;
  const slotsFull = remainingApplicants <= 0;

  return res.status(statusCode).render("apply", {
    error,
    formData,
    periodOptions,
    hasOpenPeriods,
    maxApplicants,
    remainingApplicants,
    slotsFull,
    institutionMaxSharePercent:
      Number(settings.institutionMaxSharePercent) || DEFAULT_INSTITUTION_MAX_SHARE_PERCENT,
    departmentOptions: DEPARTMENTS,
    documentDefinitions: getViewDocumentDefinitions(),
    combinedDocumentDefinition: getViewCombinedDocumentDefinition()
  });
}

function renderTrackPage(res, {
  error = null,
  message = null,
  result = null,
  statusCode = 200
} = {}) {
  const safeResult = result ? ensureApplicationDefaults(result) : null;

  return res.status(statusCode).render("track", {
    error,
    message,
    result: safeResult,
    rejectedDocuments: safeResult ? getRejectedDocuments(safeResult) : [],
    formatDate,
    getPeriodLabel,
    getDepartmentLabel,
    getStatusClass
  });
}

function renderAdminDetailPage(res, {
  application,
  error = null,
  notice = null,
  statusCode = 200
}) {
  const settings = readSettings();
  const periodOptions = getPeriodOptions(settings);
  const normalized = ensureApplicationDefaults(application);
  const scopedDepartment = res.locals.adminScopeDepartment;
  const departmentOptions = scopedDepartment
    ? DEPARTMENTS.filter((department) => department.key === scopedDepartment)
    : DEPARTMENTS;
  const statusOptions = STATUS_OPTIONS.filter((status) => status !== "Approved");

  return res.status(statusCode).render("admin-detail", {
    application: normalized,
    formatDate,
    getPeriodLabel,
    getDepartmentLabel,
    getStatusClass,
    periodOptions,
    departmentOptions,
    documentDefinitions: DOCUMENT_DEFINITIONS,
    combinedDocumentDefinition: COMBINED_DOCUMENT_DEFINITION,
    statusOptions,
    error,
    notice
  });
}

app.locals.adminPortalPath = ADMIN_PORTAL_PATH;
app.locals.hrPortalPath = HR_PORTAL_PATH;
app.locals.documentDefinitions = getViewDocumentDefinitions();
app.locals.getStatusClass = getStatusClass;
app.locals.getDepartmentLabel = getDepartmentLabel;

app.use((req, res, next) => {
  const adminScopeDepartment = getAdminScopeDepartment(req);
  const currentAdminRole = req.session?.adminRole || "";
  const isHrAdmin = currentAdminRole === "hr_admin";
  res.locals.isSuperAdmin = isSuperAdminSession(req);
  res.locals.canManageOpenPeriods = isSuperAdminSession(req);
  res.locals.isHrAdmin = isHrAdmin;
  res.locals.isDepartmentAdmin = currentAdminRole === "department_admin";
  res.locals.currentAdminRole = currentAdminRole;
  res.locals.adminScopeDepartment = adminScopeDepartment;
  res.locals.adminScopeDepartmentLabel = adminScopeDepartment
    ? getDepartmentLabel(adminScopeDepartment)
    : null;
  res.locals.currentAdminUsername = req.session?.adminUsername || "";
  next();
});

app.get("/", (_req, res) => {
  const applications = readApplications();
  const pending = applications.filter((application) => application.status === "Pending").length;
  const settings = readSettings();
  const periodOptions = getPeriodOptions(settings);
  const capacitySummary = getCapacitySummary(settings, applications);
  const institutionDepartmentLimits = DEPARTMENTS.map((department) => ({
    key: department.key,
    label: department.label,
    capacity: Number(settings.departmentCapacities?.[department.key] || 0),
    institutionLimit: getInstitutionLimitForDepartment(settings, department.key)
  })).filter((department) => department.capacity > 0);

  res.render("index", {
    total: applications.length,
    pending,
    maxApplicants: capacitySummary.totalCapacity,
    remainingApplicants: capacitySummary.totalRemaining,
    institutionMaxSharePercent:
      Number(settings.institutionMaxSharePercent) || DEFAULT_INSTITUTION_MAX_SHARE_PERCENT,
    institutionDepartmentLimits,
    periodOptions,
    openPeriodOptions: periodOptions.filter((period) => period.isOpen)
  });
});

app.get("/apply", (_req, res) => {
  return renderApplyPage(res);
});

app.get("/api/institution-suggestions", (req, res) => {
  const departmentKey = (req.query.department || "").toString().trim();
  const query = (req.query.q || "").toString().trim().slice(0, 120);

  if (!departmentKey || !isValidDepartment(departmentKey)) {
    return res.json({
      departmentSelected: false,
      departmentLabel: "",
      institutionLimit: 0,
      exactMatch: null,
      suggestions: []
    });
  }

  const applications = readApplications();
  const settings = readSettings();
  const suggestions = getInstitutionSuggestions(applications, settings, departmentKey, query, 8);

  return res.json({
    departmentSelected: true,
    departmentKey,
    departmentLabel: getDepartmentLabel(departmentKey),
    typedQuery: query,
    ...suggestions
  });
});

app.post("/apply", (req, res) => {
  studentDocumentsUploadMiddleware(req, res, (uploadError) => {
    const files = req.files || {};
    const formData = req.body || {};

    if (uploadError) {
      cleanupUploadedFiles(files);
      return renderApplyPage(res, {
        statusCode: 400,
        error: getUploadErrorMessage(uploadError),
        formData
      });
    }

    const {
      fullName,
      email,
      phone,
      institution,
      course,
      appliedDepartment,
      period,
      startDate,
      endDate,
      coverNote
    } = formData;

    const settings = readSettings();
    const periodOptions = getPeriodOptions(settings);

    let finalFullName = (fullName || "").trim();
    let finalEmail = (email || "").trim().toLowerCase();
    let finalPhone = (phone || "").trim();
    let finalInstitution = (institution || "").trim();
    let finalCourse = (course || "").trim();
    let finalAppliedDepartment = (appliedDepartment || "").trim();
    let finalPeriod = (period || "").trim();
    let finalStartDate = (startDate || "").trim();
    let finalEndDate = (endDate || "").trim();

    const requiredText = [
      finalFullName,
      finalEmail,
      finalPhone,
      finalInstitution,
      finalCourse,
      finalAppliedDepartment,
      finalPeriod,
      finalStartDate,
      finalEndDate
    ];

    const hasMissingText = requiredText.some((field) => !field || !field.trim());
    const hasCombinedDocument = Boolean(files[COMBINED_DOCUMENT_FIELD]?.[0]);

    const start = new Date(finalStartDate);
    const end = new Date(finalEndDate);

    if (hasMissingText || !hasCombinedDocument) {
      cleanupUploadedFiles(files);
      return renderApplyPage(res, {
        statusCode: 400,
        error: "Please fill all required fields and upload one combined scanned document.",
        formData
      });
    }

    const institutionValidationError = getInstitutionFullNameError(finalInstitution);
    if (institutionValidationError) {
      cleanupUploadedFiles(files);
      return renderApplyPage(res, {
        statusCode: 400,
        error: institutionValidationError,
        formData
      });
    }

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
      cleanupUploadedFiles(files);
      return renderApplyPage(res, {
        statusCode: 400,
        error: "Please provide valid attachment dates. End date must be after start date.",
        formData
      });
    }

    if (!isValidDepartment(finalAppliedDepartment)) {
      cleanupUploadedFiles(files);
      return renderApplyPage(res, {
        statusCode: 400,
        error: "Please select a valid department.",
        formData
      });
    }

    const selectedPeriod = periodOptions.find((option) => option.key === finalPeriod);
    if (!selectedPeriod || !selectedPeriod.isOpen) {
      cleanupUploadedFiles(files);
      return renderApplyPage(res, {
        statusCode: 400,
        error: "Selected attachment period is currently closed. Choose an open period.",
        formData
      });
    }

    const applications = readApplications();
    const capacitySummary = getCapacitySummary(settings, applications);
    const selectedDepartmentCapacity = Number(
      capacitySummary.departmentCapacities[finalAppliedDepartment] || 0
    );
    const selectedDepartmentUsed = Number(
      capacitySummary.applicationsByDepartment[finalAppliedDepartment] || 0
    );

    if (selectedDepartmentUsed >= selectedDepartmentCapacity) {
      cleanupUploadedFiles(files);
      return renderApplyPage(res, {
        statusCode: 400,
        error: "Selected department has no remaining attachment slots. Choose another department or try later.",
        formData
      });
    }

    const institutionLimit = getInstitutionLimitForDepartment(settings, finalAppliedDepartment);
    const institutionUsage = getInstitutionUsageCount(
      applications,
      finalAppliedDepartment,
      finalInstitution
    );

    if (institutionLimit > 0 && institutionUsage >= institutionLimit) {
      cleanupUploadedFiles(files);
      const fairnessRatio =
        Number(settings.institutionMaxSharePercent) || DEFAULT_INSTITUTION_MAX_SHARE_PERCENT;
      return renderApplyPage(res, {
        statusCode: 400,
        error: `This department has reached the institution fairness limit for ${finalInstitution}. Maximum is ${institutionLimit} student(s) per institution (${fairnessRatio}% of department slots).`,
        formData
      });
    }

    REQUIRED_DOCUMENT_FIELDS.forEach((fieldName) => {
      const uploaded = files[fieldName]?.[0];
      if (!uploaded) {
        return;
      }

      removeStoredFile(uploaded.filename);
      files[fieldName] = [];
    });

    const uploadedFields = hasCombinedDocument ? [COMBINED_DOCUMENT_FIELD] : [];
    let documentSecurity = {};
    try {
      if (uploadedFields.length > 0) {
        documentSecurity = scanUploadedFiles(files, uploadedFields);
      }
    } catch (scanError) {
      cleanupUploadedFiles(files);
      return renderApplyPage(res, {
        statusCode: 400,
        error: scanError.message || "File security scan failed.",
        formData
      });
    }

    const applicationId = generateApplicationId(applications);
    const placementNumber = generatePlacementNumber(applications);
    const combinedUpload = files[COMBINED_DOCUMENT_FIELD]?.[0] || null;
    const newApplication = ensureApplicationDefaults({
      id: applicationId,
      placementNumber,
      fullName: finalFullName,
      email: finalEmail,
      phone: finalPhone,
      institution: finalInstitution,
      course: finalCourse,
      appliedDepartment: finalAppliedDepartment,
      assignedDepartment: "",
      period: finalPeriod,
      startDate: finalStartDate,
      endDate: finalEndDate,
      coverNote: (coverNote || "").trim(),
      documents: REQUIRED_DOCUMENT_FIELDS.reduce((acc, fieldName) => {
        acc[fieldName] = null;
        return acc;
      }, {}),
      documentSecurity,
      documentsReview: createDefaultDocumentsReview(),
      combinedDocument: combinedUpload
        ? {
          filename: combinedUpload.filename,
          originalName: combinedUpload.originalname,
          uploadedAt: new Date().toISOString(),
          security: documentSecurity[COMBINED_DOCUMENT_FIELD] || null
        }
        : null,
      combinedDocumentReview: createDefaultCombinedDocumentReview(),
      joiningLetter: null,
      status: "Pending",
      reviewerComment: "",
      submittedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    applications.push(newApplication);
    writeApplications(applications);

    return res.redirect(`/application/${newApplication.id}`);
  });
});

app.get("/track", (_req, res) => {
  return renderTrackPage(res);
});

app.post("/track", (req, res) => {
  const trackingNumber = (req.body.trackingNumber || req.body.applicationId || "").trim();
  const email = (req.body.email || "").trim().toLowerCase();

  if (!trackingNumber || !email) {
    return renderTrackPage(res, {
      statusCode: 400,
      error: "Enter both tracking number and email."
    });
  }

  const applications = readApplications();
  const resultIndex = findApplicationIndexByTrackingAndEmail(applications, trackingNumber, email);
  const result = resultIndex >= 0 ? applications[resultIndex] : null;

  if (!result) {
    return renderTrackPage(res, {
      statusCode: 404,
      error: "No application found with the provided details."
    });
  }

  return renderTrackPage(res, {
    result
  });
});

app.post("/track/resubmit", (req, res) => {
  studentDocumentsUploadMiddleware(req, res, (uploadError) => {
    const files = req.files || {};
    const trackingNumber = (req.body.trackingNumber || req.body.applicationId || "").trim();
    const email = (req.body.email || "").trim().toLowerCase();

    const applications = readApplications();
    const index = findApplicationIndexByTrackingAndEmail(applications, trackingNumber, email);

    const currentApplication = index >= 0 ? ensureApplicationDefaults(applications[index]) : null;

    if (uploadError) {
      cleanupUploadedFiles(files);
      return renderTrackPage(res, {
        statusCode: 400,
        error: getUploadErrorMessage(uploadError),
        result: currentApplication
      });
    }

    if (!trackingNumber || !email) {
      cleanupUploadedFiles(files);
      return renderTrackPage(res, {
        statusCode: 400,
        error: "Tracking number and email are required for re-upload.",
        result: currentApplication
      });
    }

    if (index === -1 || !currentApplication) {
      cleanupUploadedFiles(files);
      return renderTrackPage(res, {
        statusCode: 404,
        error: "No application found with the provided details."
      });
    }

    const rejectedDocuments = getRejectedDocuments(currentApplication);
    if (!rejectedDocuments.length) {
      cleanupUploadedFiles(files);
      return renderTrackPage(res, {
        statusCode: 400,
        error: "No documents are currently marked for correction.",
        result: currentApplication
      });
    }

    const rejectedFieldNames = rejectedDocuments.map((document) => document.key);
    const uploadedFieldNames = Object.keys(files).filter((fieldName) => (files[fieldName] || []).length);

    const invalidUploads = uploadedFieldNames.filter(
      (fieldName) => !rejectedFieldNames.includes(fieldName)
    );

    if (invalidUploads.length) {
      cleanupUploadedFiles(files);
      return renderTrackPage(res, {
        statusCode: 400,
        error: "Upload only the documents marked for correction by admin.",
        result: currentApplication
      });
    }

    const missingRejectedUploads = rejectedFieldNames.filter(
      (fieldName) => !files[fieldName] || !files[fieldName][0]
    );

    if (missingRejectedUploads.length) {
      cleanupUploadedFiles(files);
      return renderTrackPage(res, {
        statusCode: 400,
        error: `Please re-upload all rejected documents: ${missingRejectedUploads
          .map(getDocumentLabel)
          .join(", ")}.`,
        result: currentApplication
      });
    }

    let scannedSecurity;
    try {
      scannedSecurity = scanUploadedFiles(files, rejectedFieldNames);
    } catch (scanError) {
      cleanupUploadedFiles(files);
      return renderTrackPage(res, {
        statusCode: 400,
        error: scanError.message || "File security scan failed.",
        result: currentApplication
      });
    }

    const reuploadedAt = new Date().toISOString();
    rejectedFieldNames.forEach((fieldName) => {
      if (fieldName === COMBINED_DOCUMENT_FIELD) {
        const uploadedCombined = files[fieldName][0];
        removeStoredFile(currentApplication.combinedDocument?.filename);

        REQUIRED_DOCUMENT_FIELDS.forEach((docFieldName) => {
          removeStoredFile(currentApplication.documents?.[docFieldName]);
        });

        currentApplication.documents = REQUIRED_DOCUMENT_FIELDS.reduce((acc, docFieldName) => {
          acc[docFieldName] = null;
          return acc;
        }, {});
        currentApplication.documentsReview = createDefaultDocumentsReview();
        currentApplication.combinedDocument = {
          filename: uploadedCombined.filename,
          originalName: uploadedCombined.originalname,
          uploadedAt: reuploadedAt,
          security: scannedSecurity[fieldName] || null
        };
        currentApplication.combinedDocumentReview = {
          status: "Pending",
          comment: "Re-uploaded by student. Awaiting admin review."
        };
        currentApplication.documentSecurity[fieldName] = scannedSecurity[fieldName];
        return;
      }

      removeStoredFile(currentApplication.documents[fieldName]);
      currentApplication.documents[fieldName] = files[fieldName][0].filename;
      currentApplication.documentSecurity[fieldName] = scannedSecurity[fieldName];
      currentApplication.documentsReview[fieldName] = {
        status: "Pending",
        comment: "Re-uploaded by student. Awaiting admin review."
      };
    });

    const hasRejectedAfterResubmit = currentApplication.combinedDocument?.filename
      ? currentApplication.combinedDocumentReview.status === "Rejected"
      : REQUIRED_DOCUMENT_FIELDS.some(
        (fieldName) => currentApplication.documentsReview[fieldName].status === "Rejected"
      );

    if (!hasRejectedAfterResubmit && currentApplication.status === "Needs Correction") {
      currentApplication.status = "Pending";
    }

    currentApplication.updatedAt = new Date().toISOString();
    applications[index] = currentApplication;
    writeApplications(applications);

    return renderTrackPage(res, {
      message: "Documents re-uploaded successfully. Please wait for admin verification.",
      result: currentApplication
    });
  });
});

app.get("/application/:id", (req, res) => {
  const applications = readApplications();
  const application = applications.find((item) => item.id === req.params.id);

  if (!application) {
    return res.status(404).render("not-found");
  }

  return res.render("status", {
    application: ensureApplicationDefaults(application),
    formatDate,
    getPeriodLabel,
    getDepartmentLabel,
    getStatusClass
  });
});

app.get("/application/:id/joining-letter", (req, res) => {
  const email = (req.query.email || "").toString().trim().toLowerCase();

  if (!email) {
    return res.status(400).send("Email is required to download the joining letter.");
  }

  const applications = readApplications();
  const application = applications.find(
    (item) => item.id === req.params.id && item.email === email
  );

  if (!application) {
    return res.status(404).send("Application not found.");
  }

  const joiningLetter = application.joiningLetter;
  if (!joiningLetter || !joiningLetter.filename) {
    return res.status(404).send("Joining letter is not available yet.");
  }

  const safeFilename = path.basename(joiningLetter.filename);
  const filePath = path.join(UPLOAD_DIR, safeFilename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send("Joining letter file is missing.");
  }

  const extension = path.extname(joiningLetter.originalName || safeFilename) || ".pdf";
  const downloadName = `Joining-Letter-${application.id}${extension}`;

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  return res.download(filePath, downloadName);
});

app.get("/admin/login", (_req, res) => {
  return res.redirect(ADMIN_PORTAL_PATH);
});

app.post("/admin/login", (_req, res) => {
  return res.redirect(307, ADMIN_PORTAL_PATH);
});

app.get(ADMIN_PORTAL_PATH, (req, res) => {
  if (req.session?.isAdmin && req.session.adminRole === "department_admin") {
    return res.redirect("/admin/applications");
  }

  if (req.session?.isAdmin && req.session.adminRole === "hr_admin") {
    return res.redirect("/hr/applications");
  }

  return res.render("admin-login", {
    error: null,
    departmentOptions: DEPARTMENTS
  });
});

app.post(ADMIN_PORTAL_PATH, (req, res) => {
  const username = (req.body.username || "").toString();
  const password = (req.body.password || "").toString();
  const selectedDepartmentRaw = (req.body.department || "").toString().trim();
  const selectedDepartment =
    selectedDepartmentRaw && selectedDepartmentRaw !== "ALL" ? selectedDepartmentRaw : null;

  if (!selectedDepartmentRaw) {
    return res.status(400).render("admin-login", {
      error: "Please choose your department portal.",
      departmentOptions: DEPARTMENTS
    });
  }

  if (selectedDepartment && !isValidDepartment(selectedDepartment)) {
    return res.status(400).render("admin-login", {
      error: "Please select a valid department.",
      departmentOptions: DEPARTMENTS
    });
  }

  if (isPresentationLogin(username, password)) {
    req.session.isAdmin = true;
    req.session.adminUsername = normalizeAdminUsername(username);
    req.session.adminRole = "department_admin";
    req.session.adminDepartment = selectedDepartment;
    req.session.adminScopeDepartment = selectedDepartment;
    return res.redirect("/admin/applications");
  }

  const adminUser = findAdminUserByCredentials(username, password);

  if (adminUser) {
    if (adminUser.role === "hr_admin") {
      return res.status(401).render("admin-login", {
        error: "HR credentials are not valid on this portal. Use the HR portal login.",
        departmentOptions: DEPARTMENTS
      });
    }

    if (adminUser.role === "department_admin" && selectedDepartmentRaw === "ALL") {
      return res.status(401).render("admin-login", {
        error: "Department admin accounts must select their own department.",
        departmentOptions: DEPARTMENTS
      });
    }

    if (
      adminUser.role === "department_admin" &&
      selectedDepartment &&
      selectedDepartment !== adminUser.department
    ) {
      return res.status(401).render("admin-login", {
        error: "Selected department does not match your admin account.",
        departmentOptions: DEPARTMENTS
      });
    }

    const scopedDepartment =
      adminUser.role === "department_admin" ? adminUser.department : selectedDepartment;

    req.session.isAdmin = true;
    req.session.adminUsername = adminUser.username;
    req.session.adminRole = "department_admin";
    req.session.adminDepartment = adminUser.department;
    req.session.adminScopeDepartment = scopedDepartment || adminUser.department;
    return res.redirect("/admin/applications");
  }

  return res.status(401).render("admin-login", {
    error: "Invalid login credentials.",
    departmentOptions: DEPARTMENTS
  });
});

app.get("/hr/login", (_req, res) => {
  return res.redirect(HR_PORTAL_PATH);
});

app.post("/hr/login", (_req, res) => {
  return res.redirect(307, HR_PORTAL_PATH);
});

app.get(HR_PORTAL_PATH, (req, res) => {
  if (req.session?.isAdmin && req.session.adminRole === "hr_admin") {
    return res.redirect("/hr/applications");
  }

  if (req.session?.isAdmin && req.session.adminRole === "department_admin") {
    return res.redirect("/admin/applications");
  }

  return res.render("hr-login", {
    error: null
  });
});

app.post(HR_PORTAL_PATH, (req, res) => {
  const username = (req.body.username || "").toString();
  const password = (req.body.password || "").toString();

  if (isPresentationLogin(username, password)) {
    req.session.isAdmin = true;
    req.session.adminUsername = normalizeAdminUsername(username);
    req.session.adminRole = "hr_admin";
    req.session.adminDepartment = null;
    req.session.adminScopeDepartment = null;
    return res.redirect("/hr/applications");
  }

  const adminUser = findAdminUserByCredentials(username, password);

  if (!adminUser || adminUser.role !== "hr_admin") {
    return res.status(401).render("hr-login", {
      error: "Invalid HR login credentials."
    });
  }

  req.session.isAdmin = true;
  req.session.adminUsername = adminUser.username;
  req.session.adminRole = "hr_admin";
  req.session.adminDepartment = null;
  req.session.adminScopeDepartment = null;
  return res.redirect("/hr/applications");
});

app.post("/admin/logout", ensureDepartmentAdmin, (req, res) => {
  req.session.destroy(() => {
    res.redirect(ADMIN_PORTAL_PATH);
  });
});

app.post("/hr/logout", ensureHrAdmin, (req, res) => {
  req.session.destroy(() => {
    res.redirect(HR_PORTAL_PATH);
  });
});

app.get("/hr/periods", ensureHrAdmin, (req, res) => {
  const settings = readSettings();
  return res.render("admin-periods", {
    periodOptions: getPeriodOptions(settings),
    departmentCapacities: settings.departmentCapacities || createDefaultDepartmentCapacities(0),
    institutionMaxSharePercent:
      Number(settings.institutionMaxSharePercent) || DEFAULT_INSTITUTION_MAX_SHARE_PERCENT,
    editableDepartments: DEPARTMENTS,
    maxApplicants: Number(settings.maxApplicants) || 0,
    updatedAt: settings.updatedAt,
    saved: req.query.saved === "1",
    error: null,
    formatDate
  });
});

app.post("/hr/periods", ensureHrAdmin, (req, res) => {
  const settings = readSettings();
  const updated = {
    ...settings,
    openPeriods: {
      ...(settings.openPeriods || {})
    },
    departmentCapacities: {
      ...(settings.departmentCapacities || createDefaultDepartmentCapacities(0))
    }
  };

  const institutionRatio = Number(req.body.institutionMaxSharePercent);
  if (!Number.isInteger(institutionRatio) || institutionRatio < 1 || institutionRatio > 100) {
    return res.status(400).render("admin-periods", {
      periodOptions: getPeriodOptions(settings),
      departmentCapacities: settings.departmentCapacities || createDefaultDepartmentCapacities(0),
      institutionMaxSharePercent:
        Number(settings.institutionMaxSharePercent) || DEFAULT_INSTITUTION_MAX_SHARE_PERCENT,
      editableDepartments: DEPARTMENTS,
      maxApplicants: Number(settings.maxApplicants) || 0,
      updatedAt: settings.updatedAt,
      saved: false,
      error: "Institution fairness ratio must be a whole number between 1 and 100.",
      formatDate
    });
  }
  updated.institutionMaxSharePercent = institutionRatio;

  const selected = req.body.openPeriods;
  const selectedPeriods = new Set(Array.isArray(selected) ? selected : selected ? [selected] : []);
  PERIODS.forEach((period) => {
    updated.openPeriods[period.key] = selectedPeriods.has(period.key);
  });

  for (const department of DEPARTMENTS) {
    const rawValue = Number(req.body[`capacity_${department.key}`]);
    if (!Number.isInteger(rawValue) || rawValue < 0) {
      return res.status(400).render("admin-periods", {
        periodOptions: getPeriodOptions(settings),
        departmentCapacities: settings.departmentCapacities || createDefaultDepartmentCapacities(0),
        institutionMaxSharePercent:
          Number(settings.institutionMaxSharePercent) || DEFAULT_INSTITUTION_MAX_SHARE_PERCENT,
        editableDepartments: DEPARTMENTS,
        maxApplicants: Number(settings.maxApplicants) || 0,
        updatedAt: settings.updatedAt,
        saved: false,
        error: `Capacity for ${department.label} must be a whole number greater than or equal to 0.`,
        formatDate
      });
    }

    updated.departmentCapacities[department.key] = rawValue;
  }

  updated.maxApplicants = DEPARTMENTS.reduce((sum, department) => {
    const capacity = Number(updated.departmentCapacities[department.key]) || 0;
    return sum + capacity;
  }, 0);
  updated.updatedAt = new Date().toISOString();

  writeSettings(updated);
  return res.redirect("/hr/periods?saved=1");
});

app.get("/admin/periods", ensureDepartmentAdmin, (req, res) => {
  const settings = readSettings();
  const adminScopeDepartment = getAdminScopeDepartment(req);
  const editableDepartments = adminScopeDepartment
    ? DEPARTMENTS.filter((department) => department.key === adminScopeDepartment)
    : DEPARTMENTS;

  return res.render("admin-periods", {
    periodOptions: getPeriodOptions(settings),
    departmentCapacities: settings.departmentCapacities || createDefaultDepartmentCapacities(0),
    institutionMaxSharePercent:
      Number(settings.institutionMaxSharePercent) || DEFAULT_INSTITUTION_MAX_SHARE_PERCENT,
    editableDepartments,
    maxApplicants: Number(settings.maxApplicants) || 0,
    updatedAt: settings.updatedAt,
    saved: req.query.saved === "1",
    error: null,
    formatDate
  });
});

app.post("/admin/periods", ensureDepartmentAdmin, (req, res) => {
  const settings = readSettings();
  const adminScopeDepartment = getAdminScopeDepartment(req);
  const editableDepartments = adminScopeDepartment
    ? DEPARTMENTS.filter((department) => department.key === adminScopeDepartment)
    : DEPARTMENTS;
  const updated = {
    ...settings,
    openPeriods: {
      ...(settings.openPeriods || {})
    },
    departmentCapacities: {
      ...(settings.departmentCapacities || createDefaultDepartmentCapacities(0))
    }
  };

  if (isSuperAdminSession(req)) {
    const selected = req.body.openPeriods;
    const selectedPeriods = new Set(Array.isArray(selected) ? selected : selected ? [selected] : []);
    PERIODS.forEach((period) => {
      updated.openPeriods[period.key] = selectedPeriods.has(period.key);
    });
  }

  for (const department of editableDepartments) {
    const rawValue = Number(req.body[`capacity_${department.key}`]);
    if (!Number.isInteger(rawValue) || rawValue < 0) {
      return res.status(400).render("admin-periods", {
        periodOptions: getPeriodOptions(settings),
        departmentCapacities: settings.departmentCapacities || createDefaultDepartmentCapacities(0),
        institutionMaxSharePercent:
          Number(settings.institutionMaxSharePercent) || DEFAULT_INSTITUTION_MAX_SHARE_PERCENT,
        editableDepartments,
        maxApplicants: Number(settings.maxApplicants) || 0,
        updatedAt: settings.updatedAt,
        saved: false,
        error: `Capacity for ${department.label} must be a whole number greater than or equal to 0.`,
        formatDate
      });
    }

    updated.departmentCapacities[department.key] = rawValue;
  }

  const totalCapacity = DEPARTMENTS.reduce((sum, department) => {
    const capacity = Number(updated.departmentCapacities[department.key]) || 0;
    return sum + capacity;
  }, 0);

  if (!Number.isInteger(totalCapacity) || totalCapacity < 0) {
    return res.status(400).render("admin-periods", {
      periodOptions: getPeriodOptions(settings),
      departmentCapacities: settings.departmentCapacities || createDefaultDepartmentCapacities(0),
      institutionMaxSharePercent:
        Number(settings.institutionMaxSharePercent) || DEFAULT_INSTITUTION_MAX_SHARE_PERCENT,
      editableDepartments,
      maxApplicants: Number(settings.maxApplicants) || 0,
      updatedAt: settings.updatedAt,
      saved: false,
      error: "Invalid total capacity configuration.",
      formatDate
    });
  }

  updated.maxApplicants = totalCapacity;
  updated.updatedAt = new Date().toISOString();

  writeSettings(updated);
  return res.redirect("/admin/periods?saved=1");
});

app.get("/admin/applications", ensureDepartmentAdmin, (req, res) => {
  const adminScopeDepartment = getAdminScopeDepartment(req);
  const statusFilterRaw = (req.query.status || "All").toString();
  const allowedFilters = new Set(["All", ...STATUS_OPTIONS]);
  const statusFilter = allowedFilters.has(statusFilterRaw) ? statusFilterRaw : "All";
  const departmentFilterRaw = (req.query.department || "All").toString().trim();
  const requestedDepartmentFilter =
    departmentFilterRaw === "All" || isValidDepartment(departmentFilterRaw)
      ? departmentFilterRaw
      : "All";
  const departmentFilter = adminScopeDepartment || requestedDepartmentFilter;

  const allApplications = filterApplicationsForAdmin(req, readApplications()).sort(
    (a, b) => new Date(b.submittedAt) - new Date(a.submittedAt)
  );

  let applications =
    statusFilter === "All"
      ? allApplications
      : allApplications.filter((item) => item.status === statusFilter);

  if (departmentFilter !== "All") {
    applications = applications.filter((item) => item.appliedDepartment === departmentFilter);
  }

  const stats = {
    total: allApplications.length,
    pending: allApplications.filter((application) => application.status === "Pending").length,
    needsCorrection: allApplications.filter(
      (application) => application.status === "Needs Correction"
    ).length,
    verified: allApplications.filter((application) => application.status === "Verified").length,
    approved: allApplications.filter((application) => application.status === "Approved").length,
    rejected: allApplications.filter((application) => application.status === "Rejected").length
  };

  return res.render("admin-list", {
    applications,
    formatDate,
    getPeriodLabel,
    getDepartmentLabel,
    getStatusClass,
    statusFilter,
    departmentFilter,
    departmentOptions: adminScopeDepartment
      ? DEPARTMENTS.filter((department) => department.key === adminScopeDepartment)
      : DEPARTMENTS,
    stats
  });
});

app.get("/admin/departments", ensureDepartmentAdmin, (_req, res) => {
  const applications = filterApplicationsForAdmin(_req, readApplications());
  const adminScopeDepartment = getAdminScopeDepartment(_req);
  const availableDepartments = adminScopeDepartment
    ? DEPARTMENTS.filter((department) => department.key === adminScopeDepartment)
    : DEPARTMENTS;

  const departmentSummaries = availableDepartments.map((department) => {
    const applied = applications.filter((item) => item.appliedDepartment === department.key);
    const assigned = applications.filter((item) => item.assignedDepartment === department.key);

    return {
      ...department,
      appliedCount: applied.length,
      assignedCount: assigned.length,
      pendingCount: applied.filter((item) => item.status === "Pending").length
    };
  });

  return res.render("admin-departments", {
    departmentSummaries
  });
});

app.get("/admin/applications/:id", ensureDepartmentAdmin, (req, res) => {
  const applications = readApplications();
  const application = applications.find((item) => item.id === req.params.id);

  if (!application) {
    return res.status(404).render("not-found");
  }

  if (!canAdminAccessApplication(req, application)) {
    return res.status(403).send("Access denied for this department.");
  }

  let notice = null;
  if (req.query.docsReviewed === "1") {
    notice = "Document review updates saved.";
  } else if (req.query.joiningSaved === "1") {
    notice = "Joining letter uploaded successfully.";
  } else if (req.query.placementSaved === "1") {
    notice = "Department placement updated successfully.";
  }

  return renderAdminDetailPage(res, {
    application,
    notice
  });
});

app.post("/admin/applications/:id/placement", ensureDepartmentAdmin, (req, res) => {
  const assignedDepartment = (req.body.assignedDepartment || "").toString().trim();
  const adminScopeDepartment = getAdminScopeDepartment(req);
  const applications = readApplications();
  const index = applications.findIndex((item) => item.id === req.params.id);

  if (index === -1) {
    return res.status(404).render("not-found");
  }

  const application = ensureApplicationDefaults(applications[index]);

  if (!canAdminAccessApplication(req, application)) {
    return res.status(403).send("Access denied for this department.");
  }

  if (!isValidDepartment(assignedDepartment)) {
    return renderAdminDetailPage(res, {
      statusCode: 400,
      application,
      error: "Please select a valid department assignment."
    });
  }

  if (adminScopeDepartment && assignedDepartment !== adminScopeDepartment) {
    return renderAdminDetailPage(res, {
      statusCode: 400,
      application,
      error: "You can only assign students to your own department."
    });
  }

  application.assignedDepartment = assignedDepartment;
  application.updatedAt = new Date().toISOString();

  applications[index] = application;
  writeApplications(applications);

  return res.redirect(`/admin/applications/${req.params.id}?placementSaved=1`);
});

app.post("/admin/applications/:id/documents-review", ensureDepartmentAdmin, (req, res) => {
  const applications = readApplications();
  const index = applications.findIndex((item) => item.id === req.params.id);

  if (index === -1) {
    return res.status(404).render("not-found");
  }

  const application = ensureApplicationDefaults(applications[index]);

  if (!canAdminAccessApplication(req, application)) {
    return res.status(403).send("Access denied for this department.");
  }

  let hasRejected = false;

  if (application.combinedDocument?.filename) {
    const status = (req.body[`docStatus_${COMBINED_DOCUMENT_FIELD}`] || "Pending").toString().trim();
    const comment = (req.body[`docComment_${COMBINED_DOCUMENT_FIELD}`] || "").toString().trim();

    if (!["Pending", "Accepted", "Rejected"].includes(status)) {
      return renderAdminDetailPage(res, {
        statusCode: 400,
        application,
        error: `Invalid document status for ${getDocumentLabel(COMBINED_DOCUMENT_FIELD)}.`
      });
    }

    application.combinedDocumentReview = {
      status,
      comment
    };
    if (status === "Rejected") {
      hasRejected = true;
    }
  } else {
    const updatedReview = createDefaultDocumentsReview();

    for (const fieldName of REQUIRED_DOCUMENT_FIELDS) {
      const status = (req.body[`docStatus_${fieldName}`] || "Pending").toString().trim();
      const comment = (req.body[`docComment_${fieldName}`] || "").toString().trim();

      if (!["Pending", "Accepted", "Rejected"].includes(status)) {
        return renderAdminDetailPage(res, {
          statusCode: 400,
          application,
          error: `Invalid document status for ${getDocumentLabel(fieldName)}.`
        });
      }

      updatedReview[fieldName] = {
        status,
        comment
      };

      if (status === "Rejected") {
        hasRejected = true;
      }
    }

    application.documentsReview = updatedReview;
  }

  if (hasRejected) {
    application.status = "Needs Correction";
  } else if (application.status === "Needs Correction") {
    application.status = "Pending";
  }

  application.updatedAt = new Date().toISOString();

  applications[index] = application;
  writeApplications(applications);

  return res.redirect(`/admin/applications/${req.params.id}?docsReviewed=1`);
});

app.post("/admin/applications/:id/joining-letter", ensureDepartmentAdmin, (req, res) => {
  const applications = readApplications();
  const index = applications.findIndex((item) => item.id === req.params.id);

  if (index === -1) {
    return res.status(404).render("not-found");
  }

  const application = ensureApplicationDefaults(applications[index]);

  if (!canAdminAccessApplication(req, application)) {
    return res.status(403).send("Access denied for this department.");
  }

  return renderAdminDetailPage(res, {
    statusCode: 403,
    application,
    error: "Joining letter upload is done by HR after final approval."
  });
});

app.get("/admin/files/:filename", ensureDepartmentAdmin, (req, res) => {
  const safeFilename = path.basename(req.params.filename);
  const visibleApplications = filterApplicationsForAdmin(req, readApplications());
  const isFileAccessible = visibleApplications.some((application) =>
    doesApplicationReferenceFile(application, safeFilename)
  );

  if (!isFileAccessible) {
    return res.status(403).send("Access denied for this file.");
  }

  const filePath = path.join(UPLOAD_DIR, safeFilename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send("File not found");
  }

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  return res.download(filePath, safeFilename);
});

app.post("/admin/applications/:id/status", ensureDepartmentAdmin, (req, res) => {
  const { status, reviewerComment } = req.body;

  if (!STATUS_OPTIONS.includes(status)) {
    return res.status(400).send("Invalid status");
  }

  const applications = readApplications();
  const index = applications.findIndex((item) => item.id === req.params.id);

  if (index === -1) {
    return res.status(404).render("not-found");
  }

  const application = ensureApplicationDefaults(applications[index]);

  if (!canAdminAccessApplication(req, application)) {
    return res.status(403).send("Access denied for this department.");
  }

  if (status === "Approved") {
    return renderAdminDetailPage(res, {
      statusCode: 400,
      application,
      error: "Department admin cannot set final approval. Send verified applications to HR."
    });
  }

  if (status === "Verified") {
    if (hasAnyRejectedDocuments(application)) {
      return renderAdminDetailPage(res, {
        statusCode: 400,
        application,
        error: "Cannot mark as verified while some documents are still rejected."
      });
    }
  }

  application.status = status;
  application.reviewerComment = (reviewerComment || "").trim();
  application.updatedAt = new Date().toISOString();

  applications[index] = application;
  writeApplications(applications);

  return res.redirect(`/admin/applications/${req.params.id}`);
});

app.post("/admin/applications/:id/edit", ensureDepartmentAdmin, (req, res) => {
  const {
    fullName,
    email,
    phone,
    institution,
    course,
    appliedDepartment,
    period,
    startDate,
    endDate,
    coverNote
  } = req.body;

  const applications = readApplications();
  const index = applications.findIndex((item) => item.id === req.params.id);

  if (index === -1) {
    return res.status(404).render("not-found");
  }

  const existingApplication = ensureApplicationDefaults(applications[index]);
  if (!canAdminAccessApplication(req, existingApplication)) {
    return res.status(403).send("Access denied for this department.");
  }

  const requiredText = [
    fullName,
    email,
    phone,
    institution,
    course,
    appliedDepartment,
    period,
    startDate,
    endDate
  ];
  const hasMissingText = requiredText.some((field) => !field || !field.trim());
  const start = new Date(startDate);
  const end = new Date(endDate);
  const isValidPeriod = PERIODS.some((option) => option.key === period);
  const validDepartment = isValidDepartment(appliedDepartment);
  const adminScopeDepartment = getAdminScopeDepartment(req);

  const draftApplication = ensureApplicationDefaults({
    ...applications[index],
    fullName: (fullName || "").trim(),
    email: (email || "").trim().toLowerCase(),
    phone: (phone || "").trim(),
    institution: (institution || "").trim(),
    course: (course || "").trim(),
    appliedDepartment,
    period,
    startDate,
    endDate,
    coverNote: (coverNote || "").trim()
  });

  if (hasMissingText) {
    return renderAdminDetailPage(res, {
      statusCode: 400,
      application: draftApplication,
      error: "All required applicant fields must be filled."
    });
  }

  const institutionValidationError = getInstitutionFullNameError(draftApplication.institution);
  if (institutionValidationError) {
    return renderAdminDetailPage(res, {
      statusCode: 400,
      application: draftApplication,
      error: institutionValidationError
    });
  }

  if (!isValidPeriod) {
    return renderAdminDetailPage(res, {
      statusCode: 400,
      application: draftApplication,
      error: "Invalid attachment period selected."
    });
  }

  if (!validDepartment) {
    return renderAdminDetailPage(res, {
      statusCode: 400,
      application: draftApplication,
      error: "Invalid department selected."
    });
  }

  if (adminScopeDepartment && appliedDepartment !== adminScopeDepartment) {
    return renderAdminDetailPage(res, {
      statusCode: 400,
      application: draftApplication,
      error: "You can only keep applicants under your department."
    });
  }

  const settings = readSettings();
  const institutionLimit = getInstitutionLimitForDepartment(
    settings,
    draftApplication.appliedDepartment
  );
  const institutionUsage = getInstitutionUsageCount(
    applications,
    draftApplication.appliedDepartment,
    draftApplication.institution,
    draftApplication.id
  );

  if (institutionLimit > 0 && institutionUsage >= institutionLimit) {
    const fairnessRatio =
      Number(settings.institutionMaxSharePercent) || DEFAULT_INSTITUTION_MAX_SHARE_PERCENT;
    return renderAdminDetailPage(res, {
      statusCode: 400,
      application: draftApplication,
      error: `Institution fairness limit reached for this department. Maximum is ${institutionLimit} student(s) per institution (${fairnessRatio}% of department slots).`
    });
  }

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return renderAdminDetailPage(res, {
      statusCode: 400,
      application: draftApplication,
      error: "Please provide valid attachment dates. End date must be after start date."
    });
  }

  draftApplication.updatedAt = new Date().toISOString();
  applications[index] = draftApplication;
  writeApplications(applications);

  return res.redirect(`/admin/applications/${req.params.id}`);
});

app.post("/admin/applications/:id/delete", ensureDepartmentAdmin, (req, res) => {
  const applications = readApplications();
  const index = applications.findIndex((item) => item.id === req.params.id);

  if (index === -1) {
    return res.status(404).render("not-found");
  }

  const application = ensureApplicationDefaults(applications[index]);
  if (!canAdminAccessApplication(req, application)) {
    return res.status(403).send("Access denied for this department.");
  }

  const [removed] = applications.splice(index, 1);
  writeApplications(applications);
  cleanupApplicationDocuments(removed);

  return res.redirect("/admin/applications");
});

app.get("/hr/applications", ensureHrAdmin, (req, res) => {
  const statusFilterRaw = (req.query.status || "Verified").toString();
  const allowedFilters = new Set(["All", ...HR_VISIBLE_STATUSES]);
  const statusFilter = allowedFilters.has(statusFilterRaw) ? statusFilterRaw : "Verified";

  const allApplications = readApplications()
    .filter((application) => HR_VISIBLE_STATUSES.has(application.status))
    .sort(
    (a, b) => new Date(b.submittedAt) - new Date(a.submittedAt)
  );

  const applications =
    statusFilter === "All"
      ? allApplications
      : allApplications.filter((item) => item.status === statusFilter);

  const stats = {
    total: allApplications.length,
    verified: allApplications.filter((application) => application.status === "Verified").length,
    approved: allApplications.filter((application) => application.status === "Approved").length,
    rejected: allApplications.filter((application) => application.status === "Rejected").length
  };

  return res.render("hr-list", {
    applications,
    stats,
    statusFilter,
    formatDate,
    getPeriodLabel,
    getDepartmentLabel,
    getStatusClass
  });
});

app.get("/hr/applications/:id", ensureHrAdmin, (req, res) => {
  const applications = readApplications();
  const application = applications.find((item) => item.id === req.params.id);

  if (!application) {
    return res.status(404).render("not-found");
  }

  if (!HR_VISIBLE_STATUSES.has(application.status)) {
    return res.status(403).send("This application is not yet verified by department admin.");
  }

  const notice =
    req.query.joiningSaved === "1"
      ? "Joining letter uploaded successfully."
      : req.query.statusSaved === "1"
        ? "HR status updated successfully."
        : null;

  return res.render("hr-detail", {
    application: ensureApplicationDefaults(application),
    notice,
    error: null,
    formatDate,
    getPeriodLabel,
    getDepartmentLabel,
    getStatusClass,
    hrStatusOptions: ["Verified", "Approved", "Rejected"],
    combinedDocumentDefinition: COMBINED_DOCUMENT_DEFINITION
  });
});

app.post("/hr/applications/:id/status", ensureHrAdmin, (req, res) => {
  const status = (req.body.status || "").toString().trim();
  const reviewerComment = (req.body.reviewerComment || "").toString().trim();
  const hrAllowedStatuses = new Set(HR_VISIBLE_STATUSES);

  if (!hrAllowedStatuses.has(status)) {
    return res.status(400).send("Invalid HR status.");
  }

  const applications = readApplications();
  const index = applications.findIndex((item) => item.id === req.params.id);

  if (index === -1) {
    return res.status(404).render("not-found");
  }

  const application = ensureApplicationDefaults(applications[index]);

  if (!HR_VISIBLE_STATUSES.has(application.status)) {
    return res.status(400).send("Application is not yet in HR review queue.");
  }

  if (status === "Approved" && !["Verified", "Approved"].includes(application.status)) {
    return res.status(400).render("hr-detail", {
      application,
      notice: null,
      error: "Only department-verified applications can be approved by HR.",
      formatDate,
      getPeriodLabel,
      getDepartmentLabel,
      getStatusClass,
      hrStatusOptions: ["Verified", "Approved", "Rejected"],
      combinedDocumentDefinition: COMBINED_DOCUMENT_DEFINITION
    });
  }

  if (status === "Approved" && hasAnyRejectedDocuments(application)) {
    return res.status(400).render("hr-detail", {
      application,
      notice: null,
      error: "Cannot approve while some documents are still rejected.",
      formatDate,
      getPeriodLabel,
      getDepartmentLabel,
      getStatusClass,
      hrStatusOptions: ["Verified", "Approved", "Rejected"],
      combinedDocumentDefinition: COMBINED_DOCUMENT_DEFINITION
    });
  }

  application.status = status;
  application.reviewerComment = reviewerComment;
  application.updatedAt = new Date().toISOString();

  applications[index] = application;
  writeApplications(applications);

  return res.redirect(`/hr/applications/${req.params.id}?statusSaved=1`);
});

app.post("/hr/applications/:id/joining-letter", ensureHrAdmin, (req, res) => {
  const applications = readApplications();
  const index = applications.findIndex((item) => item.id === req.params.id);

  if (index === -1) {
    return res.status(404).render("not-found");
  }

  const application = ensureApplicationDefaults(applications[index]);

  if (!HR_VISIBLE_STATUSES.has(application.status)) {
    return res.status(400).send("Application is not yet in HR review queue.");
  }

  if (application.status !== "Approved") {
    return res.status(400).render("hr-detail", {
      application,
      notice: null,
      error: "Approve the application first before uploading a joining letter.",
      formatDate,
      getPeriodLabel,
      getDepartmentLabel,
      getStatusClass,
      hrStatusOptions: ["Verified", "Approved", "Rejected"],
      combinedDocumentDefinition: COMBINED_DOCUMENT_DEFINITION
    });
  }

  return joiningLetterUploadMiddleware(req, res, (uploadError) => {
    if (uploadError) {
      cleanupUploadedFiles(req.files || {});
      if (req.file && req.file.filename) {
        removeStoredFile(req.file.filename);
      }

      return res.status(400).render("hr-detail", {
        application,
        notice: null,
        error: getUploadErrorMessage(uploadError),
        formatDate,
        getPeriodLabel,
        getDepartmentLabel,
        getStatusClass,
        hrStatusOptions: ["Verified", "Approved", "Rejected"],
        combinedDocumentDefinition: COMBINED_DOCUMENT_DEFINITION
      });
    }

    if (!req.file) {
      return res.status(400).render("hr-detail", {
        application,
        notice: null,
        error: "Please select a joining letter file to upload.",
        formatDate,
        getPeriodLabel,
        getDepartmentLabel,
        getStatusClass,
        hrStatusOptions: ["Verified", "Approved", "Rejected"],
        combinedDocumentDefinition: COMBINED_DOCUMENT_DEFINITION
      });
    }

    let joiningLetterSecurity;
    try {
      joiningLetterSecurity = scanUploadedFile(req.file);
    } catch (scanError) {
      removeStoredFile(req.file.filename);
      return res.status(400).render("hr-detail", {
        application,
        notice: null,
        error: scanError.message || "Joining letter security scan failed.",
        formatDate,
        getPeriodLabel,
        getDepartmentLabel,
        getStatusClass,
        hrStatusOptions: ["Verified", "Approved", "Rejected"],
        combinedDocumentDefinition: COMBINED_DOCUMENT_DEFINITION
      });
    }

    const oldJoiningLetterFilename = application.joiningLetter?.filename;
    application.joiningLetter = {
      filename: req.file.filename,
      originalName: req.file.originalname,
      uploadedAt: new Date().toISOString(),
      security: joiningLetterSecurity
    };
    application.updatedAt = new Date().toISOString();

    applications[index] = application;
    writeApplications(applications);
    removeStoredFile(oldJoiningLetterFilename);

    return res.redirect(`/hr/applications/${req.params.id}?joiningSaved=1`);
  });
});

app.get("/hr/files/:filename", ensureHrAdmin, (req, res) => {
  const safeFilename = path.basename(req.params.filename);
  const filePath = path.join(UPLOAD_DIR, safeFilename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send("File not found");
  }

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  return res.download(filePath, safeFilename);
});

app.use((error, _req, res, _next) => {
  console.error(error);
  return res.status(500).send("Unexpected server error.");
});

app.use((_req, res) => {
  res.status(404).render("not-found");
});

app.listen(PORT, () => {
  console.log(`Attachment application system running on http://localhost:${PORT}`);
  console.log(`Department admin portal: http://localhost:${PORT}${ADMIN_PORTAL_PATH}`);
  console.log(`HR portal entry: http://localhost:${PORT}${HR_PORTAL_PATH}`);
  console.log(`Storage root: ${STORAGE_ROOT}`);
  console.log(`Database file: ${DATABASE_FILE}`);
  console.log("Session store: SQLite");

  if (process.env.NODE_ENV === "production" && !process.env.STORAGE_ROOT) {
    console.warn(
      "Persistent storage warning: STORAGE_ROOT is not set. Uploaded files, database data, and sessions will reset on ephemeral hosting."
    );
  }
});
