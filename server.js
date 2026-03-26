require("dotenv").config();

const express = require("express");
const session = require("express-session");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createDatabase } = require("./database");
const { createFileStorage } = require("./file-storage");
const { createCountyEndorsedNitaPdf } = require("./county-nita-pdf");
const { createNotificationService } = require("./notification-service");

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024;
const APP_ROOT = __dirname;
const STORAGE_ROOT = process.env.STORAGE_ROOT
  ? path.resolve(process.env.STORAGE_ROOT)
  : APP_ROOT;
const UPLOAD_DIR = path.join(STORAGE_ROOT, "uploads");
const PUBLIC_DIR = path.join(APP_ROOT, "public");
const VIEWS_DIR = path.join(APP_ROOT, "views");
const KENYA_INSTITUTIONS_FILE = path.join(APP_ROOT, "data", "kenya-institutions.json");
const COUNTY_LOGO_JPG_FILE = path.join(PUBLIC_DIR, "uasin-gishu-logo.jpg");

const FILE_TYPE_HEADERS = {
  pdf: Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]), // %PDF-
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpeg: Buffer.from([0xff, 0xd8, 0xff]),
  exe: Buffer.from([0x4d, 0x5a]) // MZ
};

const EICAR_SIGNATURE =
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
const STATUS_OPTIONS = ["Pending", "Needs Correction", "Verified", "Admitted", "Rejected"];
const FINAL_DECISION_STATUSES = new Set(["Admitted", "Rejected"]);
const HR_VISIBLE_STATUSES = new Set(["Verified", "Admitted", "Rejected"]);
const DEFAULT_INSTITUTION_MAX_SHARE_PERCENT = 40;
const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI || "";
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || "attachment_application_system";

const PERIODS = [
  { key: "JAN_MAR", label: "January - March", shortLabel: "Jan - Mar" },
  { key: "APR_JUN", label: "April - June", shortLabel: "Apr - Jun" },
  { key: "JUL_SEP", label: "July - September", shortLabel: "Jul - Sep" },
  { key: "OCT_DEC", label: "October - December", shortLabel: "Oct - Dec" }
];

const LEGACY_PERIOD_LABELS = {
  JAN_APR: "January - April",
  MAY_AUG: "May - August",
  SEP_DEC: "September - December"
};

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
  }
];

const COMBINED_DOCUMENT_FIELD = "combinedDocuments";
const COMBINED_DOCUMENT_DEFINITION = {
  key: COMBINED_DOCUMENT_FIELD,
  label: "Combined Scanned Document (All Required Documents Except NITA)",
  accept: ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png",
  allowedExtensions: new Set([".pdf", ".jpg", ".jpeg", ".png"]),
  allowedMimeTypes: new Set(["application/pdf", "image/jpeg", "image/png"]),
  allowedDetectedTypes: new Set(["pdf", "jpeg", "png"])
};

const NITA_DOCUMENT_FIELD = "nitaDocument";
const NITA_DOCUMENT_DEFINITION = {
  key: NITA_DOCUMENT_FIELD,
  label: "NITA Document With School Stamp",
  accept: ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png",
  allowedExtensions: new Set([".pdf", ".jpg", ".jpeg", ".png"]),
  allowedMimeTypes: new Set(["application/pdf", "image/jpeg", "image/png"]),
  allowedDetectedTypes: new Set(["pdf", "jpeg", "png"])
};

const COUNTY_SIGNED_NITA_FIELD = "countySignedNitaDocument";
const COUNTY_SIGNED_NITA_DEFINITION = {
  key: COUNTY_SIGNED_NITA_FIELD,
  label: "County-Endorsed NITA Document",
  accept: ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png",
  allowedExtensions: new Set([".pdf", ".jpg", ".jpeg", ".png"]),
  allowedMimeTypes: new Set(["application/pdf", "image/jpeg", "image/png"]),
  allowedDetectedTypes: new Set(["pdf", "jpeg", "png"])
};

const NITA_RESUBMISSION_FIELD = "nitaResubmittedDocument";
const NITA_RESUBMISSION_DEFINITION = {
  key: NITA_RESUBMISSION_FIELD,
  label: "NITA Document Re-Submitted After NITA Office Stamping",
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
  [NITA_DOCUMENT_FIELD]: NITA_DOCUMENT_DEFINITION,
  [COUNTY_SIGNED_NITA_FIELD]: COUNTY_SIGNED_NITA_DEFINITION,
  [NITA_RESUBMISSION_FIELD]: NITA_RESUBMISSION_DEFINITION,
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
const FILE_STORAGE_PROVIDER = process.env.FILE_STORAGE_PROVIDER || "local";
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || "";
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || "";
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || "";
const CLOUDINARY_FOLDER = process.env.CLOUDINARY_FOLDER || "attachment-application-system";
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = process.env.SMTP_SECURE || "false";
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const NOTIFICATIONS_EMAIL_FROM = process.env.NOTIFICATIONS_EMAIL_FROM || "";
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER || "";
const COUNTY_ATTACHMENT_PROVIDER_NAME =
  process.env.COUNTY_ATTACHMENT_PROVIDER_NAME || "County Government of Uasin Gishu";
const COUNTY_ATTACHMENT_PROVIDER_POSTAL_ADDRESS =
  process.env.COUNTY_ATTACHMENT_PROVIDER_POSTAL_ADDRESS || "P.O. Box 40";
const COUNTY_ATTACHMENT_PROVIDER_POSTAL_CODE =
  process.env.COUNTY_ATTACHMENT_PROVIDER_POSTAL_CODE || "30100";
const COUNTY_ATTACHMENT_PROVIDER_TOWN =
  process.env.COUNTY_ATTACHMENT_PROVIDER_TOWN || "Eldoret";
const COUNTY_ATTACHMENT_PROVIDER_PHYSICAL_ADDRESS =
  process.env.COUNTY_ATTACHMENT_PROVIDER_PHYSICAL_ADDRESS || "County Headquarters";
const COUNTY_ATTACHMENT_PROVIDER_REGION =
  process.env.COUNTY_ATTACHMENT_PROVIDER_REGION || "Uasin Gishu";
const COUNTY_ATTACHMENT_PROVIDER_TELEPHONE =
  process.env.COUNTY_ATTACHMENT_PROVIDER_TELEPHONE || "05320160000";
const COUNTY_ATTACHMENT_PROVIDER_EMAIL =
  process.env.COUNTY_ATTACHMENT_PROVIDER_EMAIL || "info@uasingishu.go.ke";
const COUNTY_ATTACHMENT_PROVIDER_FAX = process.env.COUNTY_ATTACHMENT_PROVIDER_FAX || "N/A";
const COUNTY_ATTACHMENT_OFFICER_IN_CHARGE =
  process.env.COUNTY_ATTACHMENT_OFFICER_IN_CHARGE || "Director, Human Resource Management";
const COUNTY_ATTACHMENT_OFFICER_TELEPHONE =
  process.env.COUNTY_ATTACHMENT_OFFICER_TELEPHONE || COUNTY_ATTACHMENT_PROVIDER_TELEPHONE;
const COUNTY_ATTACHMENT_SIGNATORY_NAME =
  process.env.COUNTY_ATTACHMENT_SIGNATORY_NAME || COUNTY_ATTACHMENT_OFFICER_IN_CHARGE;
const COUNTY_ATTACHMENT_SIGNATORY_DESIGNATION =
  process.env.COUNTY_ATTACHMENT_SIGNATORY_DESIGNATION || "Authorized County HR Signatory";
const OTHER_INSTITUTION_VALUE = "__OTHER__";

const APPLICATION_REQUIREMENTS = [
  "Choose the department first, then select your institution before filling the rest of the form.",
  "Prepare a brief cover note introducing yourself and explaining why you need the attachment.",
  "Prepare one combined scanned document containing passport photo, school cover letter, a valid insurance copy from a recognisable insurance provider, and both sides of your national ID or school ID.",
  "Prepare the NITA document separately with your school stamp.",
  "Have a working email address, phone number, course/program, and attachment dates ready."
];

const APPLICATION_TERMS = [
  "I confirm that all information and documents submitted to the County Government of Uasin Gishu are true, correct, complete, and belong to me.",
  "I understand that false information, forged documents, altered records, or duplicate submissions may lead to rejection, freezing, withdrawal, or removal from the attachment programme.",
  "I understand that attachment placement depends on county intake windows, departmental capacity, and the institution fairness distribution rule applied by the county.",
  "I understand that the County Government of Uasin Gishu does not accept liability for injuries, illness, medical costs, or other health-related situations during attachment, and I must maintain valid insurance cover from a recognisable provider.",
  "I agree to follow all lawful instructions, reporting procedures, and attachment requirements issued by the County Government of Uasin Gishu during the attachment period.",
  "I agree to maintain professionalism, discipline, confidentiality, respect, teamwork, and proper conduct throughout the attachment placement.",
  "I understand that county attachment is a learning opportunity only and does not create a salary, wage, allowance, employment contract, or other payment obligation by the county.",
  "I understand that I am responsible for checking the student dashboard, email notifications, correction requests, NITA instructions, and joining-letter updates through the official county system.",
  "I understand that failure to comply with county attachment rules or conduct requirements may lead to withdrawal of placement or other county action."
];
const APPLICATION_TERMS_VERSION = "County Attachment Terms v3";

function loadKenyaInstitutionGroups() {
  if (!fs.existsSync(KENYA_INSTITUTIONS_FILE)) {
    return [];
  }

  try {
    const raw = JSON.parse(fs.readFileSync(KENYA_INSTITUTIONS_FILE, "utf-8"));
    const seen = new Set();

    return (Array.isArray(raw) ? raw : [])
      .map((group) => {
        const institutions = (Array.isArray(group?.institutions) ? group.institutions : [])
          .map((name) => (name || "").toString().trim().replace(/\s+/g, " "))
          .filter((name) => {
            const key = name
              .toLowerCase()
              .replace(/[^a-z0-9\s]/g, " ")
              .replace(/\s+/g, " ")
              .trim();

            if (!key || seen.has(key)) {
              return false;
            }

            seen.add(key);
            return true;
          })
          .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));

        return {
          category: (group?.category || "Institutions").toString().trim(),
          institutions
        };
      })
      .filter((group) => group.institutions.length > 0)
      .sort((a, b) => a.category.localeCompare(b.category, "en", { sensitivity: "base" }));
  } catch (_error) {
    return [];
  }
}

const KENYA_INSTITUTION_GROUPS = loadKenyaInstitutionGroups();

function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

ensureDirectoryExists(UPLOAD_DIR);

function createDefaultDepartmentCapacities(defaultCapacity = 10) {
  return DEPARTMENTS.reduce((acc, department) => {
    acc[department.key] = defaultCapacity;
    return acc;
  }, {});
}

function createDefaultHrAccount() {
  return {
    username: normalizeAdminUsername(HR_USERNAME),
    password: (HR_PASSWORD || "").toString(),
    updatedAt: new Date().toISOString()
  };
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
    landingTickerText: "Attachment application dates will appear here once HR opens the next county window.",
    applicationDeadline: "",
    communicationBroadcasts: [],
    departmentCapacities,
    hrAccount: createDefaultHrAccount(),
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

const databasePromise = createDatabase({
  createDefaultSettings,
  createDefaultDepartmentAdmins
});

const fileStorage = createFileStorage({
  uploadDir: UPLOAD_DIR,
  provider: FILE_STORAGE_PROVIDER,
  cloudinaryCloudName: CLOUDINARY_CLOUD_NAME,
  cloudinaryApiKey: CLOUDINARY_API_KEY,
  cloudinaryApiSecret: CLOUDINARY_API_SECRET,
  cloudinaryFolder: CLOUDINARY_FOLDER
});

const notificationService = createNotificationService({
  smtpHost: SMTP_HOST,
  smtpPort: SMTP_PORT,
  smtpSecure: SMTP_SECURE,
  smtpUser: SMTP_USER,
  smtpPass: SMTP_PASS,
  emailFrom: NOTIFICATIONS_EMAIL_FROM,
  twilioAccountSid: TWILIO_ACCOUNT_SID,
  twilioAuthToken: TWILIO_AUTH_TOKEN,
  twilioFromNumber: TWILIO_FROM_NUMBER
});

class MongoSessionStore extends session.Store {
  constructor(dbPromise) {
    super();
    this.dbPromise = dbPromise;
  }

  get(sid, callback) {
    Promise.resolve(this.dbPromise)
      .then((db) => db.readSession(sid))
      .then((sessionData) => callback(null, sessionData))
      .catch((error) => callback(error));
  }

  set(sid, sessionData, callback) {
    Promise.resolve(this.dbPromise)
      .then((db) => db.writeSession(sid, sessionData))
      .then(() => callback?.(null))
      .catch((error) => callback?.(error));
  }

  destroy(sid, callback) {
    Promise.resolve(this.dbPromise)
      .then((db) => db.deleteSession(sid))
      .then(() => callback?.(null))
      .catch((error) => callback?.(error));
  }

  touch(sid, sessionData, callback) {
    Promise.resolve(this.dbPromise)
      .then((db) => db.writeSession(sid, sessionData))
      .then(() => callback?.(null))
      .catch((error) => callback?.(error));
  }
}

const sessionStore = new MongoSessionStore(databasePromise);

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
      (
        REQUIRED_DOCUMENT_FIELDS.includes(file.fieldname) ||
        [
          COMBINED_DOCUMENT_FIELD,
          NITA_DOCUMENT_FIELD,
          COUNTY_SIGNED_NITA_FIELD,
          NITA_RESUBMISSION_FIELD
        ].includes(file.fieldname)
      )
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
  [...REQUIRED_DOCUMENT_FIELDS, COMBINED_DOCUMENT_FIELD, NITA_DOCUMENT_FIELD].map((fieldName) => ({
    name: fieldName,
    maxCount: 1
  }))
);

const joiningLetterUploadMiddleware = upload.single(JOINING_LETTER_FIELD);
const nitaResubmissionUploadMiddleware = upload.single(NITA_RESUBMISSION_FIELD);

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

function createDefaultNitaReview() {
  return {
    status: "Pending",
    comment: ""
  };
}

function createDefaultNitaWorkflow() {
  return {
    status: "Pending County Signature",
    comment: "",
    updatedAt: null
  };
}

function normalizeApplicationStatus(status) {
  const rawStatus = (status || "").toString().trim();
  if (rawStatus === "Approved") {
    return "Admitted";
  }

  return STATUS_OPTIONS.includes(rawStatus) ? rawStatus : "Pending";
}

function isAdmittedStatus(status) {
  return normalizeApplicationStatus(status) === "Admitted";
}

function createAutomaticCountySignedNitaSecurity(sourceSecurity, generatedFile) {
  return {
    generatedBySystem: true,
    generatedFrom: sourceSecurity?.detectedType || "nita-upload",
    detectedType: "pdf",
    size: Number(generatedFile?.size || 0)
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

function normalizeNitaReview(review) {
  const defaults = createDefaultNitaReview();
  const rawStatus = review?.status;
  const safeStatus = ["Pending", "Accepted", "Rejected"].includes(rawStatus)
    ? rawStatus
    : defaults.status;

  return {
    status: safeStatus,
    comment: (review?.comment || "").toString().trim()
  };
}

function normalizeNitaWorkflow(workflow) {
  const defaults = createDefaultNitaWorkflow();
  const allowedStatuses = new Set([
    "Pending County Signature",
    "Awaiting Student NITA Resubmission",
    "Under HR NITA Review",
    "Completed"
  ]);
  const status = allowedStatuses.has((workflow?.status || "").toString())
    ? workflow.status
    : defaults.status;

  return {
    status,
    comment: (workflow?.comment || "").toString().trim(),
    updatedAt: workflow?.updatedAt || null
  };
}

function getDocumentDefinition(fieldName) {
  return DOCUMENT_DEFINITIONS.find((document) => document.key === fieldName) || null;
}

function getDocumentLabel(fieldName) {
  if (fieldName === COMBINED_DOCUMENT_FIELD) {
    return COMBINED_DOCUMENT_DEFINITION.label;
  }

  if (fieldName === NITA_DOCUMENT_FIELD) {
    return NITA_DOCUMENT_DEFINITION.label;
  }

  if (fieldName === COUNTY_SIGNED_NITA_FIELD) {
    return COUNTY_SIGNED_NITA_DEFINITION.label;
  }

  if (fieldName === NITA_RESUBMISSION_FIELD) {
    return NITA_RESUBMISSION_DEFINITION.label;
  }

  return getDocumentDefinition(fieldName)?.label || fieldName;
}

function normalizeStoredFileEntry(entry) {
  if (!entry) {
    return null;
  }

  if (typeof entry === "string") {
    const safeFilename = path.basename(entry);
    return safeFilename
      ? {
        storage: "local",
        filename: safeFilename,
        originalName: safeFilename,
        mimeType: "",
        size: 0,
        extension: path.extname(safeFilename).toLowerCase(),
        cloudUrl: null,
        publicId: null,
        resourceType: null
      }
      : null;
  }

  const safeFilename = path.basename((entry.filename || "").toString());
  return {
    storage: entry.storage === "cloudinary" ? "cloudinary" : "local",
    filename: safeFilename,
    originalName: (entry.originalName || safeFilename).toString(),
    mimeType: (entry.mimeType || "").toString(),
    size: Number(entry.size || 0),
    extension: (entry.extension || path.extname(entry.originalName || safeFilename)).toString(),
    cloudUrl: (entry.cloudUrl || "").toString() || null,
    publicId: (entry.publicId || "").toString() || null,
    resourceType: (entry.resourceType || "").toString() || null,
    uploadedAt: entry.uploadedAt || null,
    security: entry.security || null
  };
}

function normalizeStoredDocuments(documents) {
  const normalized = {};

  REQUIRED_DOCUMENT_FIELDS.forEach((fieldName) => {
    normalized[fieldName] = normalizeStoredFileEntry(documents?.[fieldName]);
  });

  return normalized;
}

function normalizeNotificationEntry(entry) {
  const channel = (entry?.channel || "").toString().trim().toLowerCase();
  const status = (entry?.status || "").toString().trim().toLowerCase();

  return {
    channel: channel === "sms" ? "sms" : "email",
    status: ["sent", "failed", "skipped"].includes(status) ? status : "skipped",
    subject: (entry?.subject || "").toString(),
    message: (entry?.message || "").toString(),
    recipient: (entry?.recipient || "").toString(),
    reason: (entry?.reason || "").toString(),
    initiatedBy: (entry?.initiatedBy || "system").toString(),
    eventType: (entry?.eventType || "manual").toString(),
    sentAt: (entry?.sentAt || new Date().toISOString()).toString()
  };
}

function normalizeNotificationHistory(history) {
  return (Array.isArray(history) ? history : [])
    .map((entry) => normalizeNotificationEntry(entry))
    .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
}

function normalizeTermsAcceptanceRecord(record) {
  const agreedAt = (record?.agreedAt || "").toString().trim();
  const ipAddress = (record?.ipAddress || "").toString().trim();
  const version = (record?.version || APPLICATION_TERMS_VERSION).toString().trim();

  return {
    agreed: record?.agreed === true,
    agreedAt: agreedAt || null,
    ipAddress: ipAddress || null,
    version: version || APPLICATION_TERMS_VERSION
  };
}

function normalizeBroadcastEntry(entry) {
  const channels = Array.from(
    new Set(
      (Array.isArray(entry?.channels) ? entry.channels : [])
        .map((channel) => (channel || "").toString().trim().toLowerCase())
        .filter((channel) => channel === "email" || channel === "sms")
    )
  );

  return {
    id: (entry?.id || crypto.randomUUID()).toString(),
    subject: (entry?.subject || "").toString(),
    message: (entry?.message || "").toString(),
    channels,
    initiatedBy: (entry?.initiatedBy || "hr").toString(),
    sentAt: (entry?.sentAt || new Date().toISOString()).toString(),
    totalTargets: Number(entry?.totalTargets || 0),
    deliveredCount: Number(entry?.deliveredCount || 0),
    failedCount: Number(entry?.failedCount || 0),
    skippedCount: Number(entry?.skippedCount || 0)
  };
}

function normalizeBroadcastHistory(history) {
  return (Array.isArray(history) ? history : [])
    .map((entry) => normalizeBroadcastEntry(entry))
    .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
}

function ensureApplicationDefaults(application) {
  const appliedDepartment = application.appliedDepartment || application.department || "";

  return {
    ...application,
    status: normalizeApplicationStatus(application.status),
    placementNumber: getTrackingNumber(application),
    idNumber: (application.idNumber || "").toString(),
    appliedDepartment,
    assignedDepartment: application.assignedDepartment || "",
    documents: normalizeStoredDocuments(application.documents || {}),
    documentSecurity: application.documentSecurity || {},
    documentsReview: normalizeDocumentsReview(application.documentsReview),
    combinedDocument: normalizeStoredFileEntry(application.combinedDocument),
    combinedDocumentReview: normalizeCombinedDocumentReview(application.combinedDocumentReview),
    nitaDocument: normalizeStoredFileEntry(application.nitaDocument),
    nitaDocumentReview: normalizeNitaReview(application.nitaDocumentReview),
    countySignedNitaDocument: normalizeStoredFileEntry(application.countySignedNitaDocument),
    nitaResubmittedDocument: normalizeStoredFileEntry(application.nitaResubmittedDocument),
    nitaWorkflow: normalizeNitaWorkflow(application.nitaWorkflow),
    joiningLetter: normalizeStoredFileEntry(application.joiningLetter),
    notificationHistory: normalizeNotificationHistory(application.notificationHistory),
    termsAcceptance: normalizeTermsAcceptanceRecord(application.termsAcceptance),
    isFrozen: Boolean(application.isFrozen),
    frozenAt: application.frozenAt || null,
    frozenByRole: (application.frozenByRole || "").toString(),
    frozenReason: (application.frozenReason || "").toString().trim()
  };
}

async function readApplications() {
  const database = await databasePromise;
  return (await database.readApplications()).map((application) => ensureApplicationDefaults(application));
}

async function writeApplications(applications) {
  const database = await databasePromise;
  await database.writeApplications(applications);
}

async function readSettings() {
  const database = await databasePromise;
  const parsed = await database.readSettings();
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

  normalized.landingTickerText = (parsed?.landingTickerText || normalized.landingTickerText)
    .toString()
    .trim();
  normalized.applicationDeadline = (parsed?.applicationDeadline || "").toString().trim();
  normalized.communicationBroadcasts = normalizeBroadcastHistory(parsed?.communicationBroadcasts);
  normalized.hrAccount = normalizeHrAccount(parsed?.hrAccount, normalized.hrAccount);
  normalized.updatedAt = parsed?.updatedAt || normalized.updatedAt;
  return normalized;
}

async function writeSettings(settings) {
  const database = await databasePromise;
  await database.writeSettings(settings);
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

function normalizeHrAccount(account, fallback = createDefaultHrAccount()) {
  return {
    username: normalizeAdminUsername(account?.username) || fallback.username,
    password: (account?.password || "").toString() || fallback.password,
    updatedAt: (account?.updatedAt || fallback.updatedAt || new Date().toISOString()).toString()
  };
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
  const createdAt = (user?.createdAt || "").toString().trim();
  const updatedAt = (user?.updatedAt || "").toString().trim();
  const isActive = user?.isActive === false || Number(user?.isActive) === 0 ? false : true;

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
    displayName: displayName || `${getDepartmentLabel(department)} Admin`,
    isActive,
    createdAt: createdAt || null,
    updatedAt: updatedAt || null
  };
}

async function readDepartmentAdmins() {
  const database = await databasePromise;
  const normalized = (await database.readDepartmentAdmins())
    .map((item) => normalizeDepartmentAdminUser(item))
    .filter(Boolean);

  if (normalized.length) {
    return normalized;
  }

  const defaults = createDefaultDepartmentAdmins();
  await database.writeDepartmentAdmins(defaults);
  return defaults.map((item) => normalizeDepartmentAdminUser(item)).filter(Boolean);
}

async function findAdminUserByCredentials(usernameInput, passwordInput) {
  const username = normalizeAdminUsername(usernameInput);
  const password = (passwordInput || "").toString();

  if (!username || !password) {
    return null;
  }

  const settings = await readSettings();
  const hrAccount = normalizeHrAccount(settings?.hrAccount);

  if (username === hrAccount.username && password === hrAccount.password) {
    return {
      username: hrAccount.username,
      role: "hr_admin",
      department: null,
      displayName: "HR Administrator"
    };
  }

  const departmentAdmin = (await readDepartmentAdmins()).find(
    (item) => item.username === username && item.password === password && item.isActive
  );

  return departmentAdmin || null;
}

async function updateHrAccount({
  username,
  currentPassword,
  newPassword,
  confirmPassword
}) {
  const nextUsername = normalizeAdminUsername(username);
  const current = (currentPassword || "").toString();
  const next = (newPassword || "").toString();
  const confirm = (confirmPassword || "").toString();
  const settings = await readSettings();
  const hrAccount = normalizeHrAccount(settings?.hrAccount);

  if (!current) {
    return { error: "Current password is required." };
  }

  if (current !== hrAccount.password) {
    return { error: "Current password is incorrect." };
  }

  if (!nextUsername) {
    return { error: "HR username is required." };
  }

  if (!/^[a-z0-9_]{3,40}$/.test(nextUsername)) {
    return {
      error: "HR username must be 3 to 40 characters and use only lowercase letters, numbers, or underscores."
    };
  }

  if (nextUsername === normalizeAdminUsername(PRESENTATION_LOGIN_USERNAME)) {
    return { error: "That username is reserved by the presentation login settings." };
  }

  const departmentAdmins = await readDepartmentAdmins();
  const usernameInUse = departmentAdmins.some((admin) => admin.username === nextUsername);
  if (usernameInUse) {
    return { error: "That username is already used by a department access record." };
  }

  const changingPassword = Boolean(next || confirm);
  if (changingPassword) {
    if (next.length < 6) {
      return { error: "New password must be at least 6 characters long." };
    }

    if (next !== confirm) {
      return { error: "New password and confirm password do not match." };
    }
  }

  const nextPassword = changingPassword ? next : hrAccount.password;
  if (nextUsername === hrAccount.username && nextPassword === hrAccount.password) {
    return { error: "No account changes were provided." };
  }

  const updated = {
    ...settings,
    hrAccount: {
      username: nextUsername,
      password: nextPassword,
      updatedAt: new Date().toISOString()
    },
    updatedAt: new Date().toISOString()
  };

  await writeSettings(updated);
  return {
    success: true,
    hrAccount: updated.hrAccount
  };
}

async function validateDepartmentAdminInput({
  username,
  password,
  department,
  displayName,
  existingUsername = null
}) {
  const normalizedUsername = normalizeAdminUsername(username);
  const normalizedDepartment = (department || "").toString().trim();
  const normalizedDisplayName = (displayName || "").toString().trim();
  const rawPassword = (password || "").toString();

  if (!normalizedUsername) {
    return { error: "Username is required." };
  }

  if (!/^[a-z0-9_]{3,40}$/.test(normalizedUsername)) {
    return {
      error: "Username must be 3 to 40 characters and use only lowercase letters, numbers, or underscores."
    };
  }

  if (!isValidDepartment(normalizedDepartment)) {
    return { error: "Please choose a valid department." };
  }

  if (!normalizedDisplayName) {
    return { error: "Display name is required." };
  }

  if (rawPassword && rawPassword.length < 6) {
    return { error: "Password must be at least 6 characters long." };
  }

  if (
    normalizedUsername === normalizeAdminUsername(HR_USERNAME) ||
    normalizedUsername === normalizeAdminUsername(PRESENTATION_LOGIN_USERNAME)
  ) {
    return { error: "This username is reserved and cannot be used for a department admin." };
  }

  const existingAdmins = await readDepartmentAdmins();
  const usernameTaken = existingAdmins.some(
    (admin) => admin.username === normalizedUsername && admin.username !== existingUsername
  );
  if (usernameTaken) {
    return { error: "That username is already in use." };
  }

  return {
    value: {
      username: normalizedUsername,
      password: rawPassword,
      department: normalizedDepartment,
      displayName: normalizedDisplayName
    }
  };
}

async function saveDepartmentAdmins(admins) {
  const normalized = (admins || [])
    .map((admin) => normalizeDepartmentAdminUser(admin))
    .filter(Boolean);
  const database = await databasePromise;
  await database.writeDepartmentAdmins(normalized);
}

async function createDepartmentAdminAccount({ username, password, department, displayName }) {
  const validation = await validateDepartmentAdminInput({
    username,
    password,
    department,
    displayName
  });

  if (validation.error) {
    return { error: validation.error };
  }

  const timestamp = new Date().toISOString();
  const admins = await readDepartmentAdmins();
  admins.push({
    ...validation.value,
    password: validation.value.password || DEFAULT_DEPARTMENT_ADMIN_PASSWORD,
    role: "department_admin",
    isActive: true,
    createdAt: timestamp,
    updatedAt: timestamp
  });
  await saveDepartmentAdmins(admins);
  return { success: true };
}

async function updateDepartmentAdminAccount(existingUsername, { department, displayName, username }) {
  const admins = await readDepartmentAdmins();
  const index = admins.findIndex((admin) => admin.username === normalizeAdminUsername(existingUsername));

  if (index === -1) {
    return { error: "Department admin account not found." };
  }

  const existing = admins[index];
  const validation = await validateDepartmentAdminInput({
    username: username || existing.username,
    password: existing.password,
    department,
    displayName,
    existingUsername: existing.username
  });

  if (validation.error) {
    return { error: validation.error };
  }

  admins[index] = {
    ...existing,
    username: validation.value.username,
    department: validation.value.department,
    displayName: validation.value.displayName,
    updatedAt: new Date().toISOString()
  };
  await saveDepartmentAdmins(admins);
  return { success: true };
}

async function setDepartmentAdminPassword(existingUsername, password) {
  const admins = await readDepartmentAdmins();
  const index = admins.findIndex((admin) => admin.username === normalizeAdminUsername(existingUsername));

  if (index === -1) {
    return { error: "Department admin account not found." };
  }

  if (!password || password.length < 6) {
    return { error: "Password must be at least 6 characters long." };
  }

  admins[index] = {
    ...admins[index],
    password: password.toString(),
    updatedAt: new Date().toISOString()
  };
  await saveDepartmentAdmins(admins);
  return { success: true };
}

async function setDepartmentAdminActiveState(existingUsername, isActive) {
  const admins = await readDepartmentAdmins();
  const index = admins.findIndex((admin) => admin.username === normalizeAdminUsername(existingUsername));

  if (index === -1) {
    return { error: "Department admin account not found." };
  }

  admins[index] = {
    ...admins[index],
    isActive: Boolean(isActive),
    updatedAt: new Date().toISOString()
  };
  await saveDepartmentAdmins(admins);
  return { success: true };
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

  const documentFiles = Object.values(application.documents || {})
    .map((value) => normalizeStoredFileEntry(value)?.filename || "")
    .filter(Boolean);

  return (
    documentFiles.includes(safeFilename) ||
    normalizeStoredFileEntry(application.combinedDocument)?.filename === safeFilename ||
    normalizeStoredFileEntry(application.nitaDocument)?.filename === safeFilename ||
    normalizeStoredFileEntry(application.countySignedNitaDocument)?.filename === safeFilename ||
    normalizeStoredFileEntry(application.nitaResubmittedDocument)?.filename === safeFilename ||
    normalizeStoredFileEntry(application.joiningLetter)?.filename === safeFilename
  );
}

function getApplicationStoredFileByFilename(application, filename) {
  const safeFilename = path.basename(filename || "");
  if (!safeFilename) {
    return null;
  }

  const normalizedApplication = ensureApplicationDefaults(application);
  const entries = [
    normalizedApplication.combinedDocument,
    normalizedApplication.nitaDocument,
    normalizedApplication.countySignedNitaDocument,
    normalizedApplication.nitaResubmittedDocument,
    normalizedApplication.joiningLetter,
    ...Object.values(normalizedApplication.documents || {})
  ].filter(Boolean);

  return entries.find((entry) => entry.filename === safeFilename) || null;
}

function getPeriodOptions(settings) {
  return PERIODS.map((period) => ({
    ...period,
    isOpen: Boolean(settings.openPeriods[period.key])
  }));
}

function getPeriodLabel(periodKey) {
  return (
    PERIODS.find((period) => period.key === periodKey)?.label ||
    LEGACY_PERIOD_LABELS[periodKey] ||
    periodKey
  );
}

function getPeriodShortLabel(periodKey) {
  return (
    PERIODS.find((period) => period.key === periodKey)?.shortLabel ||
    LEGACY_PERIOD_LABELS[periodKey] ||
    periodKey
  );
}

function resolveDeadlineDate(deadlineInput) {
  const deadline = (deadlineInput || "").toString().trim();
  if (!deadline) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
    return new Date(`${deadline}T23:59:59+03:00`);
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(deadline)) {
    return new Date(`${deadline}:00+03:00`);
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(deadline)) {
    return new Date(`${deadline}+03:00`);
  }

  const parsed = new Date(deadline);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildLandingRunner(settings) {
  const periodOptions = getPeriodOptions(settings);
  const openPeriods = periodOptions.filter((period) => period.isOpen);
  const customText = (settings?.landingTickerText || "").toString().trim();
  const deadline = (settings?.applicationDeadline || "").toString().trim();
  const deadlineDate = resolveDeadlineDate(deadline);
  const hasCountdown = openPeriods.length > 0 && Boolean(deadlineDate);
  const openPeriodText = openPeriods.length
    ? openPeriods.map((period) => period.shortLabel || period.label).join(" | ")
    : "No active attachment window";

  const message = openPeriods.length
    ? customText || `Attachment applications are ongoing. Apply within the active county window.`
    : `Attachment applications are currently closed. Watch this board for the next county window.`;

  return {
    isOpen: openPeriods.length > 0,
    openPeriods,
    openPeriodText,
    message,
    deadline,
    hasCountdown,
    deadlineIso: hasCountdown ? deadlineDate.toISOString() : "",
    deadlineLabel: hasCountdown ? formatDate(deadlineDate.toISOString()) : "To be announced"
  };
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

function findKnownInstitutionName(institutionName) {
  const institutionKey = normalizeInstitutionName(institutionName);
  if (!institutionKey) {
    return "";
  }

  for (const group of KENYA_INSTITUTION_GROUPS) {
    const match = group.institutions.find(
      (label) => normalizeInstitutionName(label) === institutionKey
    );

    if (match) {
      return match;
    }
  }

  return "";
}

function resolveInstitutionSelection(selectedInstitution, otherInstitution = "") {
  const selected = (selectedInstitution || "").toString().trim();
  const other = (otherInstitution || "").toString().trim();

  if (selected === OTHER_INSTITUTION_VALUE) {
    return {
      isOther: true,
      institution: other,
      knownInstitution: "",
      fullNameError: getInstitutionFullNameError(other)
    };
  }

  const knownInstitution = findKnownInstitutionName(selected);
  const directFullNameError = getInstitutionFullNameError(selected);

  return {
    isOther: !knownInstitution,
    institution: knownInstitution || selected,
    knownInstitution,
    fullNameError: knownInstitution ? null : directFullNameError
  };
}

function getInstitutionAvailability(
  settings,
  applications,
  departmentKey,
  institutionName,
  excludeId = null,
  options = {}
) {
  const departmentCapacity = Number(settings?.departmentCapacities?.[departmentKey] || 0);
  const departmentUsed = applications.filter((application) => {
    if (excludeId && application.id === excludeId) {
      return false;
    }

    return application.appliedDepartment === departmentKey;
  }).length;
  const departmentRemaining = Math.max(0, departmentCapacity - departmentUsed);
  const resolvedInstitution = resolveInstitutionSelection(
    institutionName,
    options.otherInstitution || ""
  );
  const institutionLabel = resolvedInstitution.fullNameError ? "" : resolvedInstitution.institution;
  const institutionLimit = getInstitutionLimitForDepartment(settings, departmentKey);
  const institutionUsed = institutionLabel
    ? getInstitutionUsageCount(applications, departmentKey, institutionLabel, excludeId)
    : 0;
  const institutionRemaining =
    institutionLimit > 0 ? Math.max(0, institutionLimit - institutionUsed) : 0;
  const departmentSelected = Boolean(departmentKey && isValidDepartment(departmentKey));
  const institutionSelected = Boolean(institutionLabel);

  return {
    departmentSelected,
    departmentKey: departmentSelected ? departmentKey : "",
    departmentLabel: departmentSelected ? getDepartmentLabel(departmentKey) : "",
    departmentCapacity,
    departmentUsed,
    departmentRemaining,
    institutionSelected,
    institutionLabel,
    institutionLimit,
    institutionUsed,
    institutionRemaining,
    institutionResolutionError: resolvedInstitution.fullNameError,
    isDepartmentFull: departmentSelected && departmentRemaining <= 0,
    isInstitutionFull: institutionSelected && institutionLimit > 0 && institutionRemaining <= 0,
    canApply:
      departmentSelected &&
      institutionSelected &&
      departmentRemaining > 0 &&
      (institutionLimit <= 0 || institutionRemaining > 0)
  };
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

function buildStatusSummary(applications) {
  return STATUS_OPTIONS.map((status) => ({
    status,
    count: applications.filter((application) => application.status === status).length
  }));
}

function buildPeriodSummary(applications) {
  return PERIODS.map((period) => {
    const count = applications.filter((application) => application.period === period.key).length;
    return {
      key: period.key,
      label: period.label,
      count
    };
  });
}

function buildDepartmentReportRows(applications, settings, scopedDepartment = null) {
  const departments = scopedDepartment
    ? DEPARTMENTS.filter((department) => department.key === scopedDepartment)
    : DEPARTMENTS;

  return departments.map((department) => {
    const departmentApplications = applications.filter(
      (application) => application.appliedDepartment === department.key
    );
    const capacity = Number(settings.departmentCapacities?.[department.key] || 0);
    const approved = departmentApplications.filter((application) => isAdmittedStatus(application.status)).length;
    const verified = departmentApplications.filter((application) => application.status === "Verified").length;
    const pending = departmentApplications.filter(
      (application) => application.status === "Pending" || application.status === "Needs Correction"
    ).length;
    const remaining = Math.max(0, capacity - departmentApplications.length);

    return {
      ...department,
      capacity,
      applications: departmentApplications.length,
      approved,
      verified,
      pending,
      remaining,
      fillRate: capacity > 0 ? Math.round((departmentApplications.length / capacity) * 100) : 0
    };
  });
}

function buildInstitutionReportRows(applications, scopedDepartment = null, limit = 10) {
  const filtered = scopedDepartment
    ? applications.filter((application) => application.appliedDepartment === scopedDepartment)
    : applications;
  const buckets = new Map();

  filtered.forEach((application) => {
    const key = normalizeInstitutionName(application.institution);
    if (!key) {
      return;
    }

    if (!buckets.has(key)) {
      buckets.set(key, {
        institution: application.institution,
        total: 0,
        approved: 0,
        verified: 0
      });
    }

    const current = buckets.get(key);
    current.total += 1;
    if (isAdmittedStatus(application.status)) {
      current.approved += 1;
    }
    if (application.status === "Verified") {
      current.verified += 1;
    }
  });

  return Array.from(buckets.values())
    .sort((a, b) => b.total - a.total || a.institution.localeCompare(b.institution))
    .slice(0, Math.max(1, limit));
}

function buildAnalyticsSummary(applications, settings, scopedDepartment = null) {
  const filtered = scopedDepartment
    ? applications.filter((application) => application.appliedDepartment === scopedDepartment)
    : applications.slice();
  const approvedCount = filtered.filter((application) => isAdmittedStatus(application.status)).length;
  const verifiedCount = filtered.filter((application) => application.status === "Verified").length;
  const pendingCount = filtered.filter(
    (application) => application.status === "Pending" || application.status === "Needs Correction"
  ).length;
  const averageProcessingHours = filtered.length
    ? Math.round(
      filtered.reduce((sum, application) => {
        const submittedAt = new Date(application.submittedAt || 0).getTime();
        const updatedAt = new Date(application.updatedAt || application.submittedAt || 0).getTime();
        if (!submittedAt || !updatedAt || updatedAt < submittedAt) {
          return sum;
        }
        return sum + (updatedAt - submittedAt) / (1000 * 60 * 60);
      }, 0) / filtered.length
    )
    : 0;

  return {
    applications: filtered,
    totals: {
      total: filtered.length,
      approved: approvedCount,
      verified: verifiedCount,
      pending: pendingCount,
      rejected: filtered.filter((application) => application.status === "Rejected").length,
      approvalRate: filtered.length ? Math.round((approvedCount / filtered.length) * 100) : 0,
      averageProcessingHours
    },
    statusSummary: buildStatusSummary(filtered),
    periodSummary: buildPeriodSummary(filtered),
    departmentSummary: buildDepartmentReportRows(filtered, settings, scopedDepartment),
    institutionSummary: buildInstitutionReportRows(filtered, scopedDepartment, 12),
    recentApplications: filtered
      .slice()
      .sort((a, b) => new Date(b.updatedAt || b.submittedAt) - new Date(a.updatedAt || a.submittedAt))
      .slice(0, 8)
  };
}

function convertApplicationsToCsv(applications) {
  const headers = [
    "Application ID",
    "Tracking Number",
    "Full Name",
    "Email",
    "Phone",
    "Institution",
    "Course",
    "Applied Department",
    "Assigned Department",
    "Period",
    "Status",
    "Submitted At",
    "Updated At"
  ];

  const rows = applications.map((application) => [
    application.id || "",
    getTrackingNumber(application),
    application.fullName || "",
    application.email || "",
    application.phone || "",
    application.institution || "",
    application.course || "",
    getDepartmentLabel(application.appliedDepartment || ""),
    getDepartmentLabel(application.assignedDepartment || ""),
    getPeriodLabel(application.period || ""),
    application.status || "",
    application.submittedAt || "",
    application.updatedAt || ""
  ]);

  return [headers, ...rows]
    .map((row) =>
      row
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(",")
    )
    .join("\n");
}

function getReportFilterState({ query = {}, allowDepartmentFilter = false, forcedDepartment = null } = {}) {
  const requestedStatus = (query.status || "All").toString().trim();
  const requestedPeriod = (query.period || "All").toString().trim();
  const requestedDepartment = (query.department || "All").toString().trim();
  const normalizedRequestedStatus =
    requestedStatus === "All" ? "All" : normalizeApplicationStatus(requestedStatus);
  const validStatuses = new Set(["All", ...STATUS_OPTIONS]);
  const validPeriods = new Set(["All", ...PERIODS.map((period) => period.key)]);

  return {
    status: validStatuses.has(normalizedRequestedStatus) ? normalizedRequestedStatus : "All",
    period: validPeriods.has(requestedPeriod) ? requestedPeriod : "All",
    department:
      forcedDepartment ||
      (allowDepartmentFilter &&
      (requestedDepartment === "All" || isValidDepartment(requestedDepartment))
        ? requestedDepartment
        : "All")
  };
}

function filterApplicationsForReports(applications, filters) {
  return applications.filter((application) => {
    if (filters.status !== "All" && application.status !== filters.status) {
      return false;
    }

    if (filters.period !== "All" && application.period !== filters.period) {
      return false;
    }

    if (filters.department !== "All" && application.appliedDepartment !== filters.department) {
      return false;
    }

    return true;
  });
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

function getCoverNoteError(coverNote) {
  const value = (coverNote || "").toString().trim();
  if (!value) {
    return "Please write a brief cover note introducing yourself and explaining your attachment request.";
  }

  const words = value.split(/\s+/).filter(Boolean);
  if (value.length < 30 || words.length < 6) {
    return "Cover note must briefly explain who you are, what you are studying, and why you are applying for attachment.";
  }

  return null;
}

function getStatusClass(status) {
  const normalized = normalizeApplicationStatus(status);
  if (normalized === "Admitted") {
    return "approved";
  }

  return normalized.toLowerCase().replace(/\s+/g, "-");
}

function getStudentDashboardStatus(application, rejectedDocuments) {
  const status = normalizeApplicationStatus(application?.status);
  const nitaWorkflow = normalizeNitaWorkflow(application?.nitaWorkflow);

  switch (status) {
    case "Needs Correction":
      return {
        tone: "warning",
        heading: "Correction Required",
        summary:
          "Department review found issues in your submitted documents. Re-upload the requested items below so the application can continue.",
        nextActionTitle: "Student action required",
        nextActionText:
          rejectedDocuments.length > 0
            ? "Re-upload every document listed in the correction section below."
            : "Review the admin comment and wait for further instruction."
      };
    case "Verified":
      if (nitaWorkflow.status === "Pending County Signature") {
        return {
          tone: "muted",
          heading: "Waiting For County-Endorsed NITA Form",
          summary:
            "Department verification is complete. The county-endorsed NITA document will appear here once it is generated.",
          nextActionTitle: "Next step",
          nextActionText:
            "No action is needed now. Check this dashboard for the county-endorsed NITA form."
        };
      }

      if (nitaWorkflow.status === "Awaiting Student NITA Resubmission") {
        return {
          tone: "warning",
          heading: "Download And Return The NITA Form",
          summary:
            "Your county-endorsed NITA document is ready. Download it, take it to the NITA office for stamping, then re-submit the stamped copy here.",
          nextActionTitle: "Student action required",
          nextActionText:
            "Download the county-endorsed NITA document and upload the stamped version from the NITA workflow section below."
        };
      }

      if (nitaWorkflow.status === "Under HR NITA Review") {
        return {
          tone: "muted",
          heading: "Stamped NITA Submitted",
          summary:
            "Your stamped NITA document has been sent back to HR and is now under review.",
          nextActionTitle: "Next step",
          nextActionText:
            "Wait for HR to confirm the NITA stage, then the application can move to the final admission decision."
        };
      }

      if (nitaWorkflow.status === "Completed") {
        return {
          tone: "success",
          heading: "NITA Stage Completed",
          summary:
            "Your NITA document workflow is complete and the application is now waiting for the final HR admission decision.",
          nextActionTitle: "Next step",
          nextActionText: "No action is needed now unless HR adds a further comment."
        };
      }

      return {
        tone: "success",
        heading: "Verified By Department",
        summary:
          "Your application passed department verification and is now waiting for HR final review.",
        nextActionTitle: "Next step",
        nextActionText: "No action is needed now. Wait for HR admission or rejection."
      };
    case "Admitted":
      return {
        tone: "success",
        heading: "Admitted",
        summary: application?.joiningLetter?.filename
          ? "HR admitted your application and your joining letter is ready."
          : "HR admitted your application. Your joining letter will appear here once uploaded.",
        nextActionTitle: application?.joiningLetter?.filename ? "Next step" : "Current status",
        nextActionText: application?.joiningLetter?.filename
          ? "Download your joining letter and keep the tracking number for reference."
          : "Wait for HR to upload the joining letter, then download it from this dashboard."
      };
    case "Rejected":
      return {
        tone: "danger",
        heading: "Application Rejected",
        summary:
          "Your application has been rejected. Review the final comment below for the reason.",
        nextActionTitle: "Next step",
        nextActionText: "Use the reviewer comment below to understand the final decision."
      };
    case "Pending":
    default:
      if (nitaWorkflow.status === "Awaiting Student NITA Resubmission") {
        return {
          tone: "warning",
          heading: "Application Received",
          summary:
            "Your application is in the department queue, and the county-endorsed NITA document is already ready for download.",
          nextActionTitle: "Student action available",
          nextActionText:
            "Download the county-endorsed NITA document, get it stamped by NITA, and upload the stamped copy while the rest of the application continues through review."
        };
      }

      return {
        tone: "muted",
        heading: "Application Received",
        summary:
          "Your application is in the queue and is waiting for department review.",
        nextActionTitle: "Next step",
        nextActionText: "No action is needed now unless the department requests corrections."
      };
  }
}

function buildStudentTimeline(application) {
  const status = normalizeApplicationStatus(application?.status);
  const updatedAt = application?.updatedAt || application?.submittedAt || null;
  const nitaWorkflow = normalizeNitaWorkflow(application?.nitaWorkflow);

  const departmentState =
    status === "Pending"
      ? "current"
      : ["Needs Correction", "Verified", "Admitted", "Rejected"].includes(status)
        ? "complete"
        : "upcoming";
  const hrState =
    status === "Verified"
      ? "current"
      : ["Admitted", "Rejected"].includes(status)
        ? "complete"
        : "upcoming";
  const nitaState =
    FINAL_DECISION_STATUSES.has(status) || nitaWorkflow.status === "Completed"
      ? "complete"
      : ["Pending", "Verified"].includes(status) &&
          [
            "Pending County Signature",
            "Awaiting Student NITA Resubmission",
            "Under HR NITA Review"
          ].includes(nitaWorkflow.status)
        ? "current"
        : "upcoming";
  const finalDecisionState = FINAL_DECISION_STATUSES.has(status) ? "current" : "upcoming";

  return [
    {
      key: "submitted",
      label: "Submitted",
      state: "complete",
      date: application?.submittedAt || null,
      note: "Application received and tracking number generated."
    },
    {
      key: "department_review",
      label: "Department Review",
      state: departmentState,
      date: departmentState === "complete" ? updatedAt : null,
      note:
        status === "Needs Correction"
          ? "Department review requested document corrections."
          : status === "Pending"
            ? "Waiting for the department to check your application."
            : "Department review completed."
    },
    {
      key: "hr_review",
      label: "HR Review",
      state: hrState,
      date: hrState === "complete" ? updatedAt : null,
      note:
        status === "Verified"
          ? "Your application is waiting for HR final review."
          : FINAL_DECISION_STATUSES.has(status)
            ? "HR review completed."
            : "This stage starts after department verification."
    },
    {
      key: "nita_workflow",
      label: "NITA Clearance",
      state: nitaState,
      date: nitaState === "complete" || nitaState === "current" ? nitaWorkflow.updatedAt : null,
      note:
        nitaWorkflow.status === "Pending County Signature"
          ? "County endorsement is pending for the NITA document."
          : nitaWorkflow.status === "Awaiting Student NITA Resubmission"
            ? "Student should download the county-endorsed NITA document, get it stamped, and re-submit it."
            : nitaWorkflow.status === "Under HR NITA Review"
              ? "HR is reviewing the stamped NITA document sent back by the student."
              : nitaWorkflow.status === "Completed"
                ? "NITA workflow completed."
                : "This stage starts once the NITA document is available."
    },
    {
      key: "final_decision",
      label: "Final Decision",
      state: finalDecisionState,
      date: finalDecisionState === "current" ? updatedAt : null,
      note:
        status === "Admitted"
          ? application?.joiningLetter?.filename
            ? "Admitted and joining letter uploaded."
            : "Admitted. Joining letter upload is pending."
          : status === "Rejected"
            ? "Final decision recorded."
            : "Final HR decision not reached yet."
    }
  ];
}

function normalizeIdNumber(idNumber) {
  return (idNumber || "").toString().trim().toLowerCase();
}

function getIdNumberDigits(idNumber) {
  return (idNumber || "").toString().trim().replace(/[^\d]/g, "");
}

function getIdNumberValidationError(idNumber) {
  const raw = (idNumber || "").toString().trim();
  if (!raw) {
    return "Please enter the applicant ID number.";
  }

  if (!/^\d{5,12}$/.test(raw)) {
    return "Please enter a valid ID number using digits only.";
  }

  return "";
}

function buildTrackingNumberBase(idNumber) {
  const digits = getIdNumberDigits(idNumber);
  return digits ? `ATT-${digits}` : "";
}

function isTrackingReferenceInUse(applications, reference, excludeId = "") {
  const probe = (reference || "").toString().trim().toUpperCase();
  if (!probe) {
    return false;
  }

  return applications.some((item) => {
    if ((item?.id || "").toString() === excludeId) {
      return false;
    }

    const itemId = (item?.id || "").toString().trim().toUpperCase();
    const itemTracking = (item?.placementNumber || "").toString().trim().toUpperCase();
    return itemId === probe || itemTracking === probe;
  });
}

function generateApplicationId(applications, idNumber) {
  const base = buildTrackingNumberBase(idNumber);
  if (!base) {
    let id = "";

    do {
      id = `ATT-${Date.now()}-${crypto.randomInt(100, 1000)}`;
    } while (applications.some((item) => (item.id || "").toUpperCase() === id));

    return id;
  }

  let candidate = base;
  let suffix = 2;
  while (isTrackingReferenceInUse(applications, candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

function generatePlacementNumber(applications, idNumber, excludeId = "") {
  const base = buildTrackingNumberBase(idNumber);
  if (!base) {
    return "";
  }

  let candidate = base;
  let suffix = 2;
  while (isTrackingReferenceInUse(applications, candidate, excludeId)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

function getTrackingNumber(application) {
  const storedTracking = (application?.placementNumber || "").toString().trim();
  if (/^ATT-/i.test(storedTracking)) {
    return storedTracking;
  }

  const derivedTracking = buildTrackingNumberBase(application?.idNumber);
  if (derivedTracking) {
    return derivedTracking;
  }

  return (storedTracking || application?.id || "").toString().trim();
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
  const derivedTrackingNumber = getTrackingNumber(application).toLowerCase();

  return appId === probe || placementNumber === probe || derivedTrackingNumber === probe;
}

function findApplicationIndexByTrackingAndEmail(applications, trackingNumber, email) {
  const normalizedEmail = (email || "").toString().trim().toLowerCase();

  return applications.findIndex(
    (item) =>
      matchesTrackingNumber(item, trackingNumber) &&
      (item.email || "").toString().trim().toLowerCase() === normalizedEmail
  );
}

function findApplicationIndexByIdNumberAndEmail(applications, idNumber, email) {
  const normalizedEmail = (email || "").toString().trim().toLowerCase();
  const normalizedIdNumber = normalizeIdNumber(idNumber);

  return applications.findIndex(
    (item) =>
      normalizeIdNumber(item.idNumber) === normalizedIdNumber &&
      (item.email || "").toString().trim().toLowerCase() === normalizedEmail
  );
}

function findApplicationIndexForStudentDashboard(applications, {
  idNumber,
  trackingNumber,
  email
} = {}) {
  const normalizedIdNumber = normalizeIdNumber(idNumber);
  if (normalizedIdNumber) {
    const idMatchIndex = findApplicationIndexByIdNumberAndEmail(applications, normalizedIdNumber, email);
    if (idMatchIndex !== -1) {
      return idMatchIndex;
    }

    return findApplicationIndexByTrackingAndEmail(applications, normalizedIdNumber, email);
  }

  return findApplicationIndexByTrackingAndEmail(applications, trackingNumber, email);
}

function removeStoredFile(filename) {
  if (!filename) {
    return;
  }

  fileStorage.removeTemporaryFile({ filename });
}

function cleanupUploadedFiles(files) {
  Object.values(files || {}).forEach((fileList) => {
    (fileList || []).forEach((file) => {
      fileStorage.removeTemporaryFile(file);
    });
  });
}

function cleanupApplicationDocuments(application) {
  Object.values(application?.documents || {}).forEach((fileEntry) => {
    Promise.resolve(fileStorage.removeStoredFile(normalizeStoredFileEntry(fileEntry))).catch(() => {});
  });

  Promise.resolve(fileStorage.removeStoredFile(normalizeStoredFileEntry(application?.combinedDocument))).catch(
    () => {}
  );
  Promise.resolve(fileStorage.removeStoredFile(normalizeStoredFileEntry(application?.nitaDocument))).catch(
    () => {}
  );
  Promise.resolve(
    fileStorage.removeStoredFile(normalizeStoredFileEntry(application?.countySignedNitaDocument))
  ).catch(() => {});
  Promise.resolve(
    fileStorage.removeStoredFile(normalizeStoredFileEntry(application?.nitaResubmittedDocument))
  ).catch(() => {});
  Promise.resolve(fileStorage.removeStoredFile(normalizeStoredFileEntry(application?.joiningLetter))).catch(
    () => {}
  );
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
    (
      REQUIRED_DOCUMENT_FIELDS.includes(file.fieldname) ||
      [
        COMBINED_DOCUMENT_FIELD,
        NITA_DOCUMENT_FIELD,
        COUNTY_SIGNED_NITA_FIELD,
        NITA_RESUBMISSION_FIELD
      ].includes(file.fieldname)
    )
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

async function persistUploadedApplicationFile(file, { folder, uploadedAt, security } = {}) {
  const stored = await fileStorage.persistUploadedFile(file, { folder });
  if (!stored) {
    return null;
  }

  return {
    ...stored,
    uploadedAt: uploadedAt || new Date().toISOString(),
    security: security || null
  };
}

async function generateCountySignedNitaDocument(sourceFile, {
  applicantName,
  placementNumber,
  uploadedAt,
  sourceSecurity
} = {}) {
  const generatedFile = await createCountyEndorsedNitaPdf({
    sourceFile,
    uploadDir: UPLOAD_DIR,
    applicantName,
    placementNumber,
    generatedAt: uploadedAt,
    timeZone: DISPLAY_TIMEZONE,
    logoPath: COUNTY_LOGO_JPG_FILE,
    countyPartCDetails: {
      providerName: COUNTY_ATTACHMENT_PROVIDER_NAME,
      postalAddress: COUNTY_ATTACHMENT_PROVIDER_POSTAL_ADDRESS,
      postalCode: COUNTY_ATTACHMENT_PROVIDER_POSTAL_CODE,
      town: COUNTY_ATTACHMENT_PROVIDER_TOWN,
      physicalAddress: COUNTY_ATTACHMENT_PROVIDER_PHYSICAL_ADDRESS,
      region: COUNTY_ATTACHMENT_PROVIDER_REGION,
      telephone: COUNTY_ATTACHMENT_PROVIDER_TELEPHONE,
      email: COUNTY_ATTACHMENT_PROVIDER_EMAIL,
      fax: COUNTY_ATTACHMENT_PROVIDER_FAX,
      officerInCharge: COUNTY_ATTACHMENT_OFFICER_IN_CHARGE,
      officerTelephone: COUNTY_ATTACHMENT_OFFICER_TELEPHONE,
      signatoryName: COUNTY_ATTACHMENT_SIGNATORY_NAME,
      designation: COUNTY_ATTACHMENT_SIGNATORY_DESIGNATION
    }
  });

  try {
    return await persistUploadedApplicationFile(generatedFile, {
      folder: "applications/nita-county-signed",
      uploadedAt,
      security: createAutomaticCountySignedNitaSecurity(sourceSecurity, generatedFile)
    });
  } catch (error) {
    fileStorage.removeTemporaryFile(generatedFile);
    throw error;
  }
}

function getRejectedDocuments(application) {
  const normalized = ensureApplicationDefaults(application);
  const acceptAll = ALLOW_ANY_TEST_UPLOADS ? "*/*" : undefined;
  const rejected = [];

  if (normalized.combinedDocument?.filename) {
    if (normalized.combinedDocumentReview.status === "Rejected") {
      rejected.push({
        ...COMBINED_DOCUMENT_DEFINITION,
        accept: acceptAll || COMBINED_DOCUMENT_DEFINITION.accept,
        review: normalized.combinedDocumentReview
      });
    }
  }

  if (normalized.nitaDocument?.filename && normalized.nitaDocumentReview.status === "Rejected") {
    rejected.push({
      ...NITA_DOCUMENT_DEFINITION,
      accept: acceptAll || NITA_DOCUMENT_DEFINITION.accept,
      review: normalized.nitaDocumentReview
    });
  }

  rejected.push(
    ...DOCUMENT_DEFINITIONS
      .filter((document) => normalized.documentsReview[document.key].status === "Rejected")
      .map((document) => ({
      ...document,
      accept: acceptAll || document.accept,
      review: normalized.documentsReview[document.key]
      }))
  );

  return rejected;
}

function hasAnyRejectedDocuments(application) {
  const normalized = ensureApplicationDefaults(application);

  return (
    (normalized.combinedDocument?.filename &&
      normalized.combinedDocumentReview.status === "Rejected") ||
    (normalized.nitaDocument?.filename && normalized.nitaDocumentReview.status === "Rejected") ||
    REQUIRED_DOCUMENT_FIELDS.some(
      (fieldName) => normalized.documentsReview[fieldName].status === "Rejected"
    )
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

function getViewNitaDocumentDefinition() {
  return {
    ...NITA_DOCUMENT_DEFINITION,
    accept: ALLOW_ANY_TEST_UPLOADS ? "*/*" : NITA_DOCUMENT_DEFINITION.accept
  };
}

function appendNotificationEntries(application, entries) {
  const existing = normalizeNotificationHistory(application?.notificationHistory);
  const nextEntries = (Array.isArray(entries) ? entries : []).map((entry) =>
    normalizeNotificationEntry(entry)
  );
  application.notificationHistory = normalizeNotificationHistory([...existing, ...nextEntries]);
  return application.notificationHistory;
}

function getNotificationOutcomeSummary(entries) {
  const results = Array.isArray(entries) ? entries : [];
  const sent = results.filter((entry) => entry.status === "sent").length;
  const failed = results.filter((entry) => entry.status === "failed").length;
  const skipped = results.filter((entry) => entry.status === "skipped").length;

  return {
    sent,
    failed,
    skipped,
    hasDelivered: sent > 0,
    hasAnyAttempt: results.length > 0
  };
}

function buildBroadcastRecipientTargets(applications) {
  const targets = new Map();

  (Array.isArray(applications) ? applications : []).forEach((item, index) => {
    const application = ensureApplicationDefaults(item);
    const email = (application.email || "").toString().trim().toLowerCase();
    const phone = (application.phone || "").toString().trim();
    const key = `${email}::${phone}`;

    if (!email && !phone) {
      return;
    }

    if (!targets.has(key)) {
      targets.set(key, {
        email,
        phone,
        indexes: []
      });
    }

    targets.get(key).indexes.push(index);
  });

  return Array.from(targets.values());
}

function createBroadcastHistoryEntry({
  subject,
  message,
  channels,
  initiatedBy,
  totalTargets,
  deliveredCount,
  failedCount,
  skippedCount
}) {
  return normalizeBroadcastEntry({
    subject,
    message,
    channels,
    initiatedBy,
    totalTargets,
    deliveredCount,
    failedCount,
    skippedCount,
    sentAt: new Date().toISOString()
  });
}

function getRequestBaseUrl(req) {
  const forwardedProto = (req.headers["x-forwarded-proto"] || "").toString().split(",")[0].trim();
  const protocol = forwardedProto || req.protocol || "http";
  const host = (req.get("host") || "").toString().trim();
  return host ? `${protocol}://${host}` : "";
}

function getRequestIpAddress(req) {
  const forwarded = (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim();
  return forwarded || (req.ip || "").toString().trim() || null;
}

function getStudentDashboardUrl(req, application) {
  const trackingNumber = (application?.placementNumber || application?.id || "").toString().trim();
  const email = (application?.email || "").toString().trim();

  if (!trackingNumber || !email) {
    return "";
  }

  const query = new URLSearchParams({
    trackingNumber,
    email
  }).toString();
  const relativeUrl = `/track?${query}`;
  const baseUrl = getRequestBaseUrl(req);
  return baseUrl ? `${baseUrl}${relativeUrl}` : relativeUrl;
}

function getNotificationGreeting(application) {
  return `Hello ${(application?.fullName || "Applicant").toString().trim()},`;
}

function buildApplicationNotificationContent(req, application, eventType) {
  const trackingNumber = getTrackingNumber(application);
  const dashboardUrl = getStudentDashboardUrl(req, application);
  const rejectedDocuments = getRejectedDocuments(application);
  const dashboardStatus = getStudentDashboardStatus(application, rejectedDocuments);
  const baseLines = [
    getNotificationGreeting(application),
    "",
    `Tracking number: ${trackingNumber}`,
    application.appliedDepartment
      ? `Department: ${getDepartmentLabel(application.appliedDepartment)}`
      : "",
    application.period ? `Attachment period: ${getPeriodLabel(application.period)}` : "",
    `Current status: ${application.status}`,
    "",
    `Next step: ${dashboardStatus.nextActionTitle}`,
    dashboardStatus.nextActionText
  ];

  let subject = `Attachment Application Update - ${trackingNumber}`;
  let introLines = [];
  let detailLines = [];

  switch (eventType) {
    case "application_submitted":
      subject = `Application Received - ${trackingNumber}`;
      introLines = [
        "Your attachment application has been received successfully.",
        "The county-endorsed NITA document is available in your student dashboard."
      ];
      detailLines = [
        "Download the county-endorsed NITA document, take it to the NITA office for stamping, then upload the stamped copy from the dashboard."
      ];
      break;
    case "documents_correction_requested":
      subject = `Corrections Required - ${trackingNumber}`;
      introLines = [
        "Department review requested corrections on one or more documents."
      ];
      detailLines = rejectedDocuments.length
        ? [
          "Documents requiring correction:",
          ...rejectedDocuments.map((document) =>
            `- ${document.label}${document.review?.comment ? `: ${document.review.comment}` : ""}`
          )
        ]
        : [];
      break;
    case "documents_resubmitted":
      subject = `Corrected Documents Received - ${trackingNumber}`;
      introLines = [
        "Your corrected documents were received successfully.",
        "Department review will continue from the student dashboard workflow."
      ];
      break;
    case "department_verified":
      subject = `Department Review Completed - ${trackingNumber}`;
      introLines = [
        "Your application has been verified by the department and is now in the HR workflow."
      ];
      break;
    case "department_rejected":
      subject = `Application Rejected - ${trackingNumber}`;
      introLines = [
        "Your application was marked as rejected during review."
      ];
      detailLines = application.reviewerComment
        ? [`Review note: ${application.reviewerComment}`]
        : [];
      break;
    case "nita_resubmitted":
      subject = `Stamped NITA Received - ${trackingNumber}`;
      introLines = [
        "Your stamped NITA document has been received and sent to HR for review."
      ];
      break;
    case "nita_completed":
      subject = `NITA Stage Completed - ${trackingNumber}`;
      introLines = [
        "HR confirmed the stamped NITA document."
      ];
      detailLines = [
        "Your application is now waiting for the final HR admission decision."
      ];
      break;
    case "hr_admitted":
      subject = `Application Admitted - ${trackingNumber}`;
      introLines = [
        application.joiningLetter?.filename
          ? "HR admitted your application and your joining letter is ready."
          : "HR admitted your application."
      ];
      detailLines = [
        application.joiningLetter?.filename
          ? "Open the student dashboard and download your joining letter."
          : "HR will upload the joining letter next. Watch the student dashboard for the download."
      ];
      break;
    case "hr_rejected":
      subject = `Application Rejected By HR - ${trackingNumber}`;
      introLines = [
        "HR marked your application as rejected."
      ];
      detailLines = application.reviewerComment
        ? [`HR note: ${application.reviewerComment}`]
        : [];
      break;
    case "joining_letter_ready":
      subject = `Joining Letter Ready - ${trackingNumber}`;
      introLines = [
        "Your joining letter is now ready for download."
      ];
      detailLines = [
        "Open the student dashboard and download the joining letter."
      ];
      break;
    default:
      break;
  }

  const lines = [...introLines, "", ...baseLines];

  if (detailLines.length) {
    lines.push("", ...detailLines);
  }

  if (dashboardUrl) {
    lines.push("", `Student dashboard: ${dashboardUrl}`);
  }

  return {
    subject,
    message: lines.join("\n")
  };
}

async function sendApplicationNotification({
  req,
  application,
  eventType,
  initiatedBy = "system",
  channels = ["email", "sms"],
  subject,
  message
}) {
  const notification = subject && message
    ? { subject, message }
    : buildApplicationNotificationContent(req, application, eventType);

  const entries = await notificationService.send({
    channels,
    toEmail: application.email,
    toPhone: application.phone,
    subject: notification.subject,
    message: notification.message,
    initiatedBy,
    eventType
  });

  appendNotificationEntries(application, entries);
  return entries;
}

async function sendAndPersistApplicationNotification({
  req,
  applications,
  index,
  eventType,
  initiatedBy = "system",
  channels,
  subject,
  message
}) {
  if (index < 0 || !applications[index]) {
    return [];
  }

  const application = ensureApplicationDefaults(applications[index]);
  const entries = await sendApplicationNotification({
    req,
    application,
    eventType,
    initiatedBy,
    channels,
    subject,
    message
  });

  applications[index] = application;
  await writeApplications(applications);
  return entries;
}

function ensureDepartmentAdmin(req, res, next) {
  if (req.session?.isAdmin && req.session.adminRole === "hr_admin") {
    return next();
  }

  return res.redirect(HR_PORTAL_PATH);
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

function setHrDepartmentScope(req, departmentKey) {
  if (!req.session?.isAdmin || req.session.adminRole !== "hr_admin") {
    return;
  }

  req.session.adminScopeDepartment = isValidDepartment(departmentKey) ? departmentKey : null;
}

function clearHrDepartmentScope(req) {
  setHrDepartmentScope(req, null);
}

function isApplicationFrozen(application) {
  return Boolean(application?.isFrozen);
}

function freezeApplicationRecord(application, byRole, reason = "") {
  return {
    ...application,
    isFrozen: true,
    frozenAt: new Date().toISOString(),
    frozenByRole: (byRole || "").toString(),
    frozenReason: (reason || "").toString().trim(),
    updatedAt: new Date().toISOString()
  };
}

function unfreezeApplicationRecord(application) {
  return {
    ...application,
    isFrozen: false,
    frozenAt: null,
    frozenByRole: "",
    frozenReason: "",
    updatedAt: new Date().toISOString()
  };
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

async function renderApplyPage(res, { error = null, formData = {}, statusCode = 200 } = {}) {
  const settings = await readSettings();
  const periodOptions = getPeriodOptions(settings);
  const hasOpenPeriods = periodOptions.some((period) => period.isOpen);
  const applications = await readApplications();
  const capacitySummary = getCapacitySummary(settings, applications);
  const maxApplicants = capacitySummary.totalCapacity;
  const remainingApplicants = capacitySummary.totalRemaining;
  const slotsFull = remainingApplicants <= 0;
  const selectedInstitutionAvailability = getInstitutionAvailability(
    settings,
    applications,
    (formData.appliedDepartment || "").toString().trim(),
    (formData.institution || "").toString().trim()
  );
  const canStartApplication = hasOpenPeriods && !slotsFull;
  const showApplicationFields = canStartApplication && selectedInstitutionAvailability.canApply;

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
    institutionGroups: KENYA_INSTITUTION_GROUPS,
    applicationRequirements: APPLICATION_REQUIREMENTS,
    applicationTerms: APPLICATION_TERMS,
    canStartApplication,
    showApplicationFields,
    selectedInstitutionAvailability,
    documentDefinitions: getViewDocumentDefinitions(),
    combinedDocumentDefinition: getViewCombinedDocumentDefinition(),
    nitaDocumentDefinition: getViewNitaDocumentDefinition()
  });
}

function renderTrackPage(res, {
  error = null,
  message = null,
  result = null,
  formData = {},
  statusCode = 200
} = {}) {
  const safeResult = result ? ensureApplicationDefaults(result) : null;
  const safeFormData = {
    idNumber: formData.idNumber || (safeResult ? safeResult.idNumber || "" : ""),
    email: formData.email || (safeResult ? safeResult.email || "" : "")
  };
  const rejectedDocuments = safeResult ? getRejectedDocuments(safeResult) : [];
  const studentDashboard = safeResult
    ? {
      status: getStudentDashboardStatus(safeResult, rejectedDocuments),
      timeline: buildStudentTimeline(safeResult)
    }
    : null;
  return res.status(statusCode).render("track", {
    error,
    message,
    result: safeResult,
    formData: safeFormData,
    rejectedDocuments,
    studentDashboard,
    formatDate,
    getPeriodLabel,
    getDepartmentLabel,
    getStatusClass,
    nitaDocumentDefinition: NITA_DOCUMENT_DEFINITION,
    countySignedNitaDefinition: COUNTY_SIGNED_NITA_DEFINITION,
    nitaResubmissionDefinition: {
      ...NITA_RESUBMISSION_DEFINITION,
      accept: ALLOW_ANY_TEST_UPLOADS ? "*/*" : NITA_RESUBMISSION_DEFINITION.accept
    }
  });
}

async function renderAdminDetailPage(res, {
  application,
  error = null,
  notice = null,
  statusCode = 200
}) {
  const settings = await readSettings();
  const periodOptions = getPeriodOptions(settings);
  const normalized = ensureApplicationDefaults(application);
  const scopedDepartment = res.locals.adminScopeDepartment;
  const departmentOptions = scopedDepartment
    ? DEPARTMENTS.filter((department) => department.key === scopedDepartment)
    : DEPARTMENTS;
  const statusOptions = STATUS_OPTIONS.filter((status) => status !== "Admitted");

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
    nitaDocumentDefinition: NITA_DOCUMENT_DEFINITION,
    statusOptions,
    error,
    notice
  });
}

function renderHrDetailPage(res, {
  application,
  error = null,
  notice = null,
  statusCode = 200
}) {
  return res.status(statusCode).render("hr-detail", {
    application: ensureApplicationDefaults(application),
    notice,
    error,
    formatDate,
    getPeriodLabel,
    getDepartmentLabel,
    getStatusClass,
    hrStatusOptions: ["Verified", "Admitted", "Rejected"],
    notificationProviderSummary: notificationService.getProviderSummary(),
    combinedDocumentDefinition: COMBINED_DOCUMENT_DEFINITION,
    nitaDocumentDefinition: NITA_DOCUMENT_DEFINITION,
    countySignedNitaDefinition: COUNTY_SIGNED_NITA_DEFINITION,
    nitaResubmissionDefinition: NITA_RESUBMISSION_DEFINITION
  });
}

async function renderHrCommunicationsPage(res, {
  error = null,
  notice = null,
  formData = {},
  statusCode = 200
} = {}) {
  const settings = await readSettings();
  const applications = await readApplications();
  const targets = buildBroadcastRecipientTargets(applications);

  return res.status(statusCode).render("hr-communications", {
    error,
    notice,
    formData: {
      subject: (formData.subject || "").toString(),
      message: (formData.message || "").toString(),
      channels: Array.isArray(formData.channels)
        ? formData.channels
        : formData.channels
          ? [formData.channels]
          : ["email"]
    },
    notificationProviderSummary: notificationService.getProviderSummary(),
    communicationBroadcasts: normalizeBroadcastHistory(settings.communicationBroadcasts),
    communicationStats: {
      totalApplications: applications.length,
      totalTargets: targets.length,
      emailTargets: targets.filter((target) => target.email).length,
      smsTargets: targets.filter((target) => target.phone).length
    },
    formatDate
  });
}

app.locals.hrPortalPath = HR_PORTAL_PATH;
app.locals.documentDefinitions = getViewDocumentDefinitions();
app.locals.getStatusClass = getStatusClass;
app.locals.getDepartmentLabel = getDepartmentLabel;
app.locals.fileStorageProvider = fileStorage.provider;

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
  res.locals.homePath = isHrAdmin ? "/hr/home" : "/";
  res.locals.fileStorageProvider = fileStorage.provider;
  res.locals.fileStorageWarning = fileStorage.getProviderWarning();
  next();
});

app.get("/", async (_req, res) => {
  const applications = await readApplications();
  const pending = applications.filter((application) => application.status === "Pending").length;
  const settings = await readSettings();
  const periodOptions = getPeriodOptions(settings);
  const capacitySummary = getCapacitySummary(settings, applications);
  const landingRunner = buildLandingRunner(settings);
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
    openPeriodOptions: periodOptions.filter((period) => period.isOpen),
    landingRunner
  });
});

app.get("/apply", async (_req, res) => {
  return renderApplyPage(res);
});

app.get("/api/institution-availability", async (req, res) => {
  const departmentKey = (req.query.department || "").toString().trim();
  const institutionName = (req.query.institution || "").toString().trim();
  const otherInstitution = (req.query.otherInstitution || "").toString().trim();

  if (!departmentKey || !isValidDepartment(departmentKey)) {
    return res.json({
      departmentSelected: false,
      institutionSelected: false,
      departmentLabel: "",
      institutionLabel: "",
      departmentCapacity: 0,
      departmentUsed: 0,
      departmentRemaining: 0,
      institutionLimit: 0,
      institutionUsed: 0,
      institutionRemaining: 0,
      institutionResolutionError: "",
      isDepartmentFull: false,
      isInstitutionFull: false,
      canApply: false
    });
  }

  const settings = await readSettings();
  const applications = await readApplications();
  const availability = getInstitutionAvailability(
    settings,
    applications,
    departmentKey,
    institutionName,
    null,
    { otherInstitution }
  );

  return res.json(availability);
});

app.get("/api/institution-suggestions", async (req, res) => {
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

  const applications = await readApplications();
  const settings = await readSettings();
  const suggestions = getInstitutionSuggestions(applications, settings, departmentKey, query, 8);

  return res.json({
    departmentSelected: true,
    departmentKey,
    departmentLabel: getDepartmentLabel(departmentKey),
    typedQuery: query,
    ...suggestions
  });
});

app.post("/apply", async (req, res) => {
  studentDocumentsUploadMiddleware(req, res, async (uploadError) => {
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
      idNumber,
      institution,
      course,
      appliedDepartment,
      period,
      startDate,
      endDate,
      coverNote,
      acceptedTerms
    } = formData;

    const settings = await readSettings();
    const periodOptions = getPeriodOptions(settings);

    let finalFullName = (fullName || "").trim();
    let finalEmail = (email || "").trim().toLowerCase();
    let finalPhone = (phone || "").trim();
    let finalIdNumber = (idNumber || "").trim();
    let finalInstitution = (institution || "").trim();
    let finalCourse = (course || "").trim();
    let finalAppliedDepartment = (appliedDepartment || "").trim();
    let finalPeriod = (period || "").trim();
    let finalStartDate = (startDate || "").trim();
    let finalEndDate = (endDate || "").trim();
    let finalCoverNote = (coverNote || "").trim();
    const termsAccepted = (acceptedTerms || "").toString().trim() === "yes";

    const requiredText = [
      finalFullName,
      finalEmail,
      finalPhone,
      finalIdNumber,
      finalInstitution,
      finalCourse,
      finalAppliedDepartment,
      finalPeriod,
      finalStartDate,
      finalEndDate,
      finalCoverNote
    ];

    const hasMissingText = requiredText.some((field) => !field || !field.trim());
    const hasCombinedDocument = Boolean(files[COMBINED_DOCUMENT_FIELD]?.[0]);
    const hasNitaDocument = Boolean(files[NITA_DOCUMENT_FIELD]?.[0]);

    const start = new Date(finalStartDate);
    const end = new Date(finalEndDate);

    if (hasMissingText || !hasCombinedDocument || !hasNitaDocument) {
      cleanupUploadedFiles(files);
      return renderApplyPage(res, {
        statusCode: 400,
        error: "Please fill all required fields, upload the combined document, and upload the NITA document separately.",
        formData
      });
    }

    if (!termsAccepted) {
      cleanupUploadedFiles(files);
      return renderApplyPage(res, {
        statusCode: 400,
        error: "You must accept the county application terms and conditions before submitting.",
        formData
      });
    }

    const coverNoteError = getCoverNoteError(finalCoverNote);
    if (coverNoteError) {
      cleanupUploadedFiles(files);
      return renderApplyPage(res, {
        statusCode: 400,
        error: coverNoteError,
        formData
      });
    }

    const idNumberError = getIdNumberValidationError(finalIdNumber);
    if (idNumberError) {
      cleanupUploadedFiles(files);
      return renderApplyPage(res, {
        statusCode: 400,
        error: idNumberError,
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

    const resolvedInstitution = resolveInstitutionSelection(finalInstitution);
    if (resolvedInstitution.fullNameError) {
      cleanupUploadedFiles(files);
      return renderApplyPage(res, {
        statusCode: 400,
        error: resolvedInstitution.fullNameError,
        formData
      });
    }
    finalInstitution = resolvedInstitution.institution;

    const applications = await readApplications();
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

    const uploadedFields = [COMBINED_DOCUMENT_FIELD, NITA_DOCUMENT_FIELD].filter(
      (fieldName) => Boolean(files[fieldName]?.[0])
    );
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

    return (async () => {
      const applicationId = generateApplicationId(applications, finalIdNumber);
      const placementNumber = generatePlacementNumber(applications, finalIdNumber) || applicationId;
      const combinedUpload = files[COMBINED_DOCUMENT_FIELD]?.[0] || null;
      const nitaUpload = files[NITA_DOCUMENT_FIELD]?.[0] || null;
      const storedAt = new Date().toISOString();
      const combinedDocument = await persistUploadedApplicationFile(combinedUpload, {
        folder: "applications/combined-documents",
        uploadedAt: storedAt,
        security: documentSecurity[COMBINED_DOCUMENT_FIELD] || null
      });
      const countySignedNitaDocument = await generateCountySignedNitaDocument(nitaUpload, {
        applicantName: finalFullName,
        placementNumber,
        uploadedAt: storedAt,
        sourceSecurity: documentSecurity[NITA_DOCUMENT_FIELD] || null
      });
      const nitaDocument = await persistUploadedApplicationFile(nitaUpload, {
        folder: "applications/nita-initial",
        uploadedAt: storedAt,
        security: documentSecurity[NITA_DOCUMENT_FIELD] || null
      });
      const termsAcceptance = normalizeTermsAcceptanceRecord({
        agreed: true,
        agreedAt: storedAt,
        ipAddress: getRequestIpAddress(req),
        version: APPLICATION_TERMS_VERSION
      });

      const newApplication = ensureApplicationDefaults({
        id: applicationId,
        placementNumber,
        fullName: finalFullName,
        email: finalEmail,
        phone: finalPhone,
        idNumber: finalIdNumber,
        institution: finalInstitution,
        course: finalCourse,
        appliedDepartment: finalAppliedDepartment,
        assignedDepartment: "",
        period: finalPeriod,
        startDate: finalStartDate,
        endDate: finalEndDate,
        coverNote: finalCoverNote,
        documents: REQUIRED_DOCUMENT_FIELDS.reduce((acc, fieldName) => {
          acc[fieldName] = null;
          return acc;
        }, {}),
        documentSecurity,
        documentsReview: createDefaultDocumentsReview(),
        combinedDocument,
        combinedDocumentReview: createDefaultCombinedDocumentReview(),
        nitaDocument,
        nitaDocumentReview: createDefaultNitaReview(),
        countySignedNitaDocument,
        nitaResubmittedDocument: null,
        nitaWorkflow: {
          status: "Awaiting Student NITA Resubmission",
          comment:
            "County-endorsed NITA document generated automatically. Download it, take it to the NITA office for stamping, then re-submit it through the student dashboard.",
          updatedAt: storedAt
        },
        joiningLetter: null,
        termsAcceptance,
        status: "Pending",
        reviewerComment: "",
        submittedAt: storedAt,
        updatedAt: storedAt
      });

      applications.push(newApplication);
      await writeApplications(applications);
      const newIndex = applications.findIndex((application) => application.id === newApplication.id);
      await sendAndPersistApplicationNotification({
        req,
        applications,
        index: newIndex,
        eventType: "application_submitted",
        initiatedBy: "system"
      });

      return res.redirect(`/application/${newApplication.id}`);
    })().catch((storageError) => {
      cleanupUploadedFiles(files);
      return renderApplyPage(res, {
        statusCode: 500,
        error: storageError.message || "Failed to store uploaded document.",
        formData
      });
    });
  });
});

app.get("/track", async (req, res) => {
  const idNumber = (req.query.idNumber || "").toString().trim();
  const trackingNumber = (req.query.trackingNumber || "").toString().trim();
  const email = (req.query.email || "").toString().trim().toLowerCase();

  if ((!idNumber && !trackingNumber) || !email) {
    return renderTrackPage(res, {
      formData: {
        idNumber,
        email
      }
    });
  }

  const applications = await readApplications();
  const resultIndex = findApplicationIndexForStudentDashboard(applications, {
    idNumber,
    trackingNumber,
    email
  });
  const result = resultIndex >= 0 ? applications[resultIndex] : null;

  if (!result) {
    return renderTrackPage(res, {
      statusCode: 404,
      error: "No application found with the provided details.",
      formData: {
        idNumber,
        email
      }
    });
  }

  return renderTrackPage(res, {
    result,
    formData: {
      idNumber: result.idNumber || idNumber,
      email
    }
  });
});

app.post("/track", async (req, res) => {
  const idNumber = (req.body.idNumber || "").trim();
  const trackingNumber = (req.body.trackingNumber || req.body.applicationId || "").trim();
  const email = (req.body.email || "").trim().toLowerCase();

  if ((!idNumber && !trackingNumber) || !email) {
    return renderTrackPage(res, {
      statusCode: 400,
      error: "Enter both ID number and email.",
      formData: {
        idNumber,
        email
      }
    });
  }

  const applications = await readApplications();
  const resultIndex = findApplicationIndexForStudentDashboard(applications, {
    idNumber,
    trackingNumber,
    email
  });
  const result = resultIndex >= 0 ? applications[resultIndex] : null;

  if (!result) {
    return renderTrackPage(res, {
      statusCode: 404,
      error: "No application found with the provided details.",
      formData: {
        idNumber,
        email
      }
    });
  }

  return renderTrackPage(res, {
    result,
    formData: {
      idNumber: result.idNumber || idNumber,
      email
    }
  });
});

app.post("/track/resubmit", async (req, res) => {
  studentDocumentsUploadMiddleware(req, res, async (uploadError) => {
    const files = req.files || {};
    const idNumber = (req.body.idNumber || "").trim();
    const trackingNumber = (req.body.trackingNumber || req.body.applicationId || "").trim();
    const email = (req.body.email || "").trim().toLowerCase();

    const applications = await readApplications();
    const index = findApplicationIndexForStudentDashboard(applications, {
      idNumber,
      trackingNumber,
      email
    });

    const currentApplication = index >= 0 ? ensureApplicationDefaults(applications[index]) : null;

    if (uploadError) {
      cleanupUploadedFiles(files);
      return renderTrackPage(res, {
        statusCode: 400,
        error: getUploadErrorMessage(uploadError),
        result: currentApplication,
        formData: {
          idNumber,
          email
        }
      });
    }

    if ((!idNumber && !trackingNumber) || !email) {
      cleanupUploadedFiles(files);
      return renderTrackPage(res, {
        statusCode: 400,
        error: "ID number and email are required for re-upload.",
        result: currentApplication,
        formData: {
          idNumber,
          email
        }
      });
    }

    if (index === -1 || !currentApplication) {
      cleanupUploadedFiles(files);
      return renderTrackPage(res, {
        statusCode: 404,
        error: "No application found with the provided details.",
        formData: {
          idNumber,
          email
        }
      });
    }

    const rejectedDocuments = getRejectedDocuments(currentApplication);
    if (!rejectedDocuments.length) {
      cleanupUploadedFiles(files);
      return renderTrackPage(res, {
        statusCode: 400,
        error: "No documents are currently marked for correction.",
        result: currentApplication,
        formData: {
          idNumber,
          email
        }
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
        result: currentApplication,
        formData: {
          idNumber,
          email
        }
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
        result: currentApplication,
        formData: {
          idNumber,
          email
        }
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
        result: currentApplication,
        formData: {
          idNumber,
          email
        }
      });
    }

    return (async () => {
      const reuploadedAt = new Date().toISOString();

      for (const fieldName of rejectedFieldNames) {
        if (fieldName === COMBINED_DOCUMENT_FIELD) {
          const uploadedCombined = files[fieldName][0];
          const previousCombinedDocument = currentApplication.combinedDocument;
          const previousDocuments = Object.values(currentApplication.documents || {});

          const storedCombinedDocument = await persistUploadedApplicationFile(uploadedCombined, {
            folder: "applications/combined-documents",
            uploadedAt: reuploadedAt,
            security: scannedSecurity[fieldName] || null
          });

          Promise.resolve(fileStorage.removeStoredFile(previousCombinedDocument)).catch(() => {});
          previousDocuments.forEach((entry) => {
            Promise.resolve(fileStorage.removeStoredFile(entry)).catch(() => {});
          });

          currentApplication.documents = REQUIRED_DOCUMENT_FIELDS.reduce((acc, docFieldName) => {
            acc[docFieldName] = null;
            return acc;
          }, {});
          currentApplication.documentsReview = createDefaultDocumentsReview();
          currentApplication.combinedDocument = storedCombinedDocument;
          currentApplication.combinedDocumentReview = {
            status: "Pending",
            comment: "Re-uploaded by student. Awaiting admin review."
          };
          currentApplication.documentSecurity[fieldName] = scannedSecurity[fieldName];
          continue;
        }

        if (fieldName === NITA_DOCUMENT_FIELD) {
          const uploadedNita = files[fieldName][0];
          const previousNitaDocument = currentApplication.nitaDocument;
          const previousCountySignedNita = currentApplication.countySignedNitaDocument;
          const previousResubmittedDocument = currentApplication.nitaResubmittedDocument;

          const regeneratedCountySignedNita = await generateCountySignedNitaDocument(uploadedNita, {
            applicantName: currentApplication.fullName,
            placementNumber: currentApplication.placementNumber || currentApplication.id,
            uploadedAt: reuploadedAt,
            sourceSecurity: scannedSecurity[fieldName] || null
          });

          currentApplication.nitaDocument = await persistUploadedApplicationFile(uploadedNita, {
            folder: "applications/nita-initial",
            uploadedAt: reuploadedAt,
            security: scannedSecurity[fieldName] || null
          });
          Promise.resolve(fileStorage.removeStoredFile(previousNitaDocument)).catch(() => {});
          Promise.resolve(fileStorage.removeStoredFile(previousCountySignedNita)).catch(() => {});
          Promise.resolve(fileStorage.removeStoredFile(previousResubmittedDocument)).catch(() => {});
          currentApplication.documentSecurity[fieldName] = scannedSecurity[fieldName];
          currentApplication.nitaDocumentReview = {
            status: "Pending",
            comment: "Re-uploaded by student. Awaiting admin review."
          };
          currentApplication.countySignedNitaDocument = regeneratedCountySignedNita;
          currentApplication.nitaResubmittedDocument = null;
          currentApplication.nitaWorkflow = {
            ...normalizeNitaWorkflow(currentApplication.nitaWorkflow),
            status: "Awaiting Student NITA Resubmission",
            comment:
              "County-endorsed NITA document refreshed automatically. Download the updated version, take it to the NITA office for stamping, then re-submit it.",
            updatedAt: reuploadedAt
          };
          continue;
        }

        const previousDocument = currentApplication.documents[fieldName];
        currentApplication.documents[fieldName] = await persistUploadedApplicationFile(
          files[fieldName][0],
          {
            folder: "applications/correction-documents",
            uploadedAt: reuploadedAt,
            security: scannedSecurity[fieldName] || null
          }
        );
        Promise.resolve(fileStorage.removeStoredFile(previousDocument)).catch(() => {});
        currentApplication.documentSecurity[fieldName] = scannedSecurity[fieldName];
        currentApplication.documentsReview[fieldName] = {
          status: "Pending",
          comment: "Re-uploaded by student. Awaiting admin review."
        };
      }

      const hasRejectedAfterResubmit = hasAnyRejectedDocuments(currentApplication);

      if (!hasRejectedAfterResubmit && currentApplication.status === "Needs Correction") {
        currentApplication.status = "Pending";
      }

      currentApplication.updatedAt = new Date().toISOString();
      applications[index] = currentApplication;
      await writeApplications(applications);
      await sendAndPersistApplicationNotification({
        req,
        applications,
        index,
        eventType: "documents_resubmitted",
        initiatedBy: "system"
      });

      return renderTrackPage(res, {
        message:
          rejectedFieldNames.includes(NITA_DOCUMENT_FIELD)
            ? "Documents re-uploaded successfully. A fresh county-endorsed NITA document is now ready in your dashboard."
            : "Documents re-uploaded successfully. Please wait for department verification.",
        result: currentApplication,
        formData: {
          idNumber: currentApplication.idNumber || idNumber,
          email
        }
      });
    })().catch((storageError) => {
      cleanupUploadedFiles(files);
      return renderTrackPage(res, {
        statusCode: 500,
        error: storageError.message || "Failed to store re-uploaded documents.",
        result: currentApplication,
        formData: {
          idNumber,
          email
        }
      });
    });
  });
});

app.post("/track/nita-resubmit", async (req, res) => {
  nitaResubmissionUploadMiddleware(req, res, async (uploadError) => {
    const idNumber = (req.body.idNumber || "").trim();
    const trackingNumber = (req.body.trackingNumber || req.body.applicationId || "").trim();
    const email = (req.body.email || "").trim().toLowerCase();
    const uploadedFile = req.file || null;

    const applications = await readApplications();
    const index = findApplicationIndexForStudentDashboard(applications, {
      idNumber,
      trackingNumber,
      email
    });
    const currentApplication = index >= 0 ? ensureApplicationDefaults(applications[index]) : null;

    if (uploadError) {
      cleanupUploadedFiles({ [NITA_RESUBMISSION_FIELD]: uploadedFile ? [uploadedFile] : [] });
      return renderTrackPage(res, {
        statusCode: 400,
        error: getUploadErrorMessage(uploadError),
        result: currentApplication,
        formData: {
          idNumber,
          email
        }
      });
    }

    if ((!idNumber && !trackingNumber) || !email) {
      cleanupUploadedFiles({ [NITA_RESUBMISSION_FIELD]: uploadedFile ? [uploadedFile] : [] });
      return renderTrackPage(res, {
        statusCode: 400,
        error: "ID number and email are required to submit the stamped NITA document.",
        result: currentApplication,
        formData: {
          idNumber,
          email
        }
      });
    }

    if (index === -1 || !currentApplication) {
      cleanupUploadedFiles({ [NITA_RESUBMISSION_FIELD]: uploadedFile ? [uploadedFile] : [] });
      return renderTrackPage(res, {
        statusCode: 404,
        error: "No application found with the provided details.",
        formData: {
          idNumber,
          email
        }
      });
    }

    if (!uploadedFile) {
      return renderTrackPage(res, {
        statusCode: 400,
        error: "Please upload the stamped NITA document before submitting.",
        result: currentApplication,
        formData: {
          idNumber,
          email
        }
      });
    }

    if (!currentApplication.countySignedNitaDocument?.filename) {
      cleanupUploadedFiles({ [NITA_RESUBMISSION_FIELD]: [uploadedFile] });
      return renderTrackPage(res, {
        statusCode: 400,
        error: "The county-endorsed NITA document is not ready yet.",
        result: currentApplication,
        formData: {
          idNumber,
          email
        }
      });
    }

    if (normalizeNitaWorkflow(currentApplication.nitaWorkflow).status === "Completed") {
      cleanupUploadedFiles({ [NITA_RESUBMISSION_FIELD]: [uploadedFile] });
      return renderTrackPage(res, {
        statusCode: 400,
        error: "The NITA workflow is already complete for this application.",
        result: currentApplication,
        formData: {
          idNumber,
          email
        }
      });
    }

    let nitaSecurity;
    try {
      nitaSecurity = scanUploadedFile(uploadedFile);
    } catch (scanError) {
      cleanupUploadedFiles({ [NITA_RESUBMISSION_FIELD]: [uploadedFile] });
      return renderTrackPage(res, {
        statusCode: 400,
        error: scanError.message || "Stamped NITA document security scan failed.",
        result: currentApplication,
        formData: {
          idNumber,
          email
        }
      });
    }

    return (async () => {
      const previousResubmittedDocument = currentApplication.nitaResubmittedDocument;
      const submittedAt = new Date().toISOString();

      currentApplication.nitaResubmittedDocument = await persistUploadedApplicationFile(uploadedFile, {
        folder: "applications/nita-resubmissions",
        uploadedAt: submittedAt,
        security: nitaSecurity
      });
      currentApplication.documentSecurity[NITA_RESUBMISSION_FIELD] = nitaSecurity;
      currentApplication.nitaWorkflow = {
        ...normalizeNitaWorkflow(currentApplication.nitaWorkflow),
        status: "Under HR NITA Review",
        comment: "Student submitted the stamped NITA document for HR review.",
        updatedAt: submittedAt
      };
      currentApplication.updatedAt = submittedAt;

      applications[index] = currentApplication;
      await writeApplications(applications);
      await sendAndPersistApplicationNotification({
        req,
        applications,
        index,
        eventType: "nita_resubmitted",
        initiatedBy: "system"
      });
      Promise.resolve(fileStorage.removeStoredFile(previousResubmittedDocument)).catch(() => {});

      return renderTrackPage(res, {
        message: "Stamped NITA document submitted successfully. HR will review it before the final admission decision.",
        result: currentApplication,
        formData: {
          idNumber: currentApplication.idNumber || idNumber,
          email
        }
      });
    })().catch((storageError) => {
      cleanupUploadedFiles({ [NITA_RESUBMISSION_FIELD]: [uploadedFile] });
      return renderTrackPage(res, {
        statusCode: 500,
        error: storageError.message || "Failed to store the stamped NITA document.",
        result: currentApplication,
        formData: {
          idNumber,
          email
        }
      });
    });
  });
});

app.get("/application/:id", async (req, res) => {
  const applications = await readApplications();
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

app.get("/application/:id/joining-letter", async (req, res) => {
  const email = (req.query.email || "").toString().trim().toLowerCase();

  if (!email) {
    return res.status(400).send("Email is required to download the joining letter.");
  }

  const applications = await readApplications();
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

  const extension = path.extname(joiningLetter.originalName || joiningLetter.filename) || ".pdf";
  const downloadName = `Joining-Letter-${application.id}${extension}`;

  return fileStorage.sendStoredFile(res, joiningLetter, {
    downloadName
  });
});

app.get("/application/:id/county-signed-nita", async (req, res) => {
  const email = (req.query.email || "").toString().trim().toLowerCase();

  if (!email) {
    return res.status(400).send("Email is required to download the county-endorsed NITA document.");
  }

  const applications = await readApplications();
  const application = applications.find(
    (item) => item.id === req.params.id && item.email === email
  );

  if (!application) {
    return res.status(404).send("Application not found.");
  }

  const countySignedNitaDocument = application.countySignedNitaDocument;
  if (!countySignedNitaDocument || !countySignedNitaDocument.filename) {
    return res.status(404).send("County-endorsed NITA document is not available yet.");
  }

  const extension =
    path.extname(countySignedNitaDocument.originalName || countySignedNitaDocument.filename) ||
    ".pdf";
  const downloadName = `County-Endorsed-NITA-${application.id}${extension}`;

  return fileStorage.sendStoredFile(res, countySignedNitaDocument, {
    downloadName
  });
});

app.get("/admin/login", async (_req, res) => {
  return res.redirect(HR_PORTAL_PATH);
});

app.post("/admin/login", async (_req, res) => {
  return res.redirect(307, HR_PORTAL_PATH);
});

app.get(ADMIN_PORTAL_PATH, async (_req, res) => {
  return res.redirect(HR_PORTAL_PATH);
});

app.post(ADMIN_PORTAL_PATH, async (_req, res) => {
  return res.redirect(307, HR_PORTAL_PATH);
});

app.get("/hr/login", async (_req, res) => {
  return res.redirect(HR_PORTAL_PATH);
});

app.post("/hr/login", async (_req, res) => {
  return res.redirect(307, HR_PORTAL_PATH);
});

app.get(HR_PORTAL_PATH, async (req, res) => {
  if (req.session?.isAdmin && req.session.adminRole === "hr_admin") {
    return res.redirect("/hr/applications");
  }

  return res.render("hr-login", {
    error: null
  });
});

app.post(HR_PORTAL_PATH, async (req, res) => {
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

  const adminUser = await findAdminUserByCredentials(username, password);

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

app.post("/admin/logout", ensureDepartmentAdmin, async (req, res) => {
  req.session.destroy(() => {
    res.redirect(HR_PORTAL_PATH);
  });
});

app.post("/hr/logout", ensureHrAdmin, async (req, res) => {
  req.session.destroy(() => {
    res.redirect(HR_PORTAL_PATH);
  });
});

app.get("/hr/home", async (req, res) => {
  if (req.session?.isAdmin && req.session.adminRole === "hr_admin") {
    return req.session.destroy(() => {
      res.redirect("/");
    });
  }

  return res.redirect("/");
});

app.get("/hr/periods", ensureHrAdmin, async (req, res) => {
  clearHrDepartmentScope(req);
  const settings = await readSettings();
  return res.render("admin-periods", {
    periodOptions: getPeriodOptions(settings),
    departmentCapacities: settings.departmentCapacities || createDefaultDepartmentCapacities(0),
    institutionMaxSharePercent:
      Number(settings.institutionMaxSharePercent) || DEFAULT_INSTITUTION_MAX_SHARE_PERCENT,
    landingTickerText: settings.landingTickerText || "",
    applicationDeadline: settings.applicationDeadline || "",
    editableDepartments: DEPARTMENTS,
    maxApplicants: Number(settings.maxApplicants) || 0,
    updatedAt: settings.updatedAt,
    saved: req.query.saved === "1",
    error: null,
    formatDate
  });
});

app.post("/hr/periods", ensureHrAdmin, async (req, res) => {
  clearHrDepartmentScope(req);
  const settings = await readSettings();
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
      landingTickerText: (req.body.landingTickerText || settings.landingTickerText || "").toString(),
      applicationDeadline: (req.body.applicationDeadline || settings.applicationDeadline || "").toString(),
      editableDepartments: DEPARTMENTS,
      maxApplicants: Number(settings.maxApplicants) || 0,
      updatedAt: settings.updatedAt,
      saved: false,
      error: "Institution fairness ratio must be a whole number between 1 and 100.",
      formatDate
    });
  }
  updated.institutionMaxSharePercent = institutionRatio;
  updated.landingTickerText = (req.body.landingTickerText || "").toString().trim();
  updated.applicationDeadline = (req.body.applicationDeadline || "").toString().trim();

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
        landingTickerText: updated.landingTickerText,
        applicationDeadline: updated.applicationDeadline,
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

  if (updated.applicationDeadline) {
    const deadlineProbe = new Date(updated.applicationDeadline);
    if (Number.isNaN(deadlineProbe.getTime())) {
      return res.status(400).render("admin-periods", {
        periodOptions: getPeriodOptions(settings),
        departmentCapacities: settings.departmentCapacities || createDefaultDepartmentCapacities(0),
        institutionMaxSharePercent:
          Number(settings.institutionMaxSharePercent) || DEFAULT_INSTITUTION_MAX_SHARE_PERCENT,
        landingTickerText: updated.landingTickerText,
        applicationDeadline: updated.applicationDeadline,
        editableDepartments: DEPARTMENTS,
        maxApplicants: Number(settings.maxApplicants) || 0,
        updatedAt: settings.updatedAt,
        saved: false,
        error: "Application deadline must be a valid date.",
        formatDate
      });
    }
  }

  updated.updatedAt = new Date().toISOString();

  await writeSettings(updated);
  return res.redirect("/hr/periods?saved=1");
});

async function renderAdminAccountsPage(res, {
  statusCode = 200,
  error = null,
  notice = null
} = {}) {
  const adminAccounts = (await readDepartmentAdmins()).sort(
    (a, b) =>
      Number(b.isActive) - Number(a.isActive) ||
      getDepartmentLabel(a.department).localeCompare(getDepartmentLabel(b.department)) ||
      a.username.localeCompare(b.username)
  );

  return res.status(statusCode).render("admin-accounts", {
    adminAccounts,
    departmentOptions: DEPARTMENTS,
    error,
    notice,
    formatDate
  });
}

async function renderHrAccountPage(res, {
  statusCode = 200,
  error = null,
  notice = null
} = {}) {
  const settings = await readSettings();
  const hrAccount = normalizeHrAccount(settings?.hrAccount);

  return res.status(statusCode).render("hr-account", {
    hrUsername: hrAccount.username,
    updatedAt: hrAccount.updatedAt,
    error,
    notice,
    formatDate
  });
}

function buildDepartmentAccessSummaries(applications) {
  return DEPARTMENTS.map((department) => {
    const applied = applications.filter((item) => item.appliedDepartment === department.key);
    const assigned = applications.filter((item) => item.assignedDepartment === department.key);

    return {
      ...department,
      appliedCount: applied.length,
      assignedCount: assigned.length,
      pendingCount: applied.filter(
        (item) => item.status === "Pending" || item.status === "Needs Correction"
      ).length
    };
  });
}

function renderDepartmentAccessPage(res, departmentSummaries) {
  return res.render("admin-departments", {
    departmentSummaries
  });
}

app.get("/hr/admin-accounts", ensureHrAdmin, async (req, res) => {
  clearHrDepartmentScope(req);
  let notice = null;
  if (req.query.created === "1") {
    notice = "Department access record created.";
  } else if (req.query.updated === "1") {
    notice = "Department access record updated.";
  } else if (req.query.passwordReset === "1") {
    notice = "Department record password updated.";
  } else if (req.query.toggled === "1") {
    notice = "Department record freeze status updated.";
  }

  return renderAdminAccountsPage(res, { notice });
});

app.get("/hr/account", ensureHrAdmin, async (req, res) => {
  clearHrDepartmentScope(req);
  let notice = null;
  if (req.query.passwordChanged === "1") {
    notice = "HR password updated successfully.";
  }

  return renderHrAccountPage(res, { notice });
});

app.post("/hr/account/password", ensureHrAdmin, async (req, res) => {
  clearHrDepartmentScope(req);
  const result = await updateHrAccount({
    username: req.body.username,
    currentPassword: req.body.currentPassword,
    newPassword: req.body.newPassword,
    confirmPassword: req.body.confirmPassword
  });

  if (result.error) {
    return renderHrAccountPage(res, {
      statusCode: 400,
      error: result.error
    });
  }

  req.session.adminUsername = result.hrAccount.username;
  return res.redirect("/hr/account?passwordChanged=1");
});

app.get("/hr/communications", ensureHrAdmin, async (req, res) => {
  clearHrDepartmentScope(req);
  const notice =
    req.query.sent === "1"
      ? "Broadcast communication sent successfully."
      : req.query.sent === "partial"
        ? "Broadcast communication reached some applicants. Check the history summary for partial delivery."
        : null;
  const error =
    req.query.sent === "failed"
      ? "No broadcast communication was delivered. Check the provider configuration or recipient restrictions."
      : null;

  return renderHrCommunicationsPage(res, {
    notice,
    error
  });
});

app.post("/hr/communications", ensureHrAdmin, async (req, res) => {
  clearHrDepartmentScope(req);
  const subject = (req.body.subject || "").toString().trim();
  const message = (req.body.message || "").toString().trim();
  const channels = Array.isArray(req.body.channels)
    ? req.body.channels
    : req.body.channels
      ? [req.body.channels]
      : [];
  const safeFormData = { subject, message, channels };

  if (!channels.length) {
    return renderHrCommunicationsPage(res, {
      statusCode: 400,
      error: "Select at least one channel for the broadcast.",
      formData: safeFormData
    });
  }

  if (channels.includes("email") && !subject) {
    return renderHrCommunicationsPage(res, {
      statusCode: 400,
      error: "An email subject is required when the broadcast includes email.",
      formData: safeFormData
    });
  }

  if (!message) {
    return renderHrCommunicationsPage(res, {
      statusCode: 400,
      error: "Enter the communication message before sending the broadcast.",
      formData: safeFormData
    });
  }

  const applications = await readApplications();
  const recipientTargets = buildBroadcastRecipientTargets(applications);

  if (!recipientTargets.length) {
    return renderHrCommunicationsPage(res, {
      statusCode: 400,
      error: "No applicant contacts are available yet. Submit at least one application first.",
      formData: safeFormData
    });
  }

  let deliveredCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (const target of recipientTargets) {
    const entries = await notificationService.send({
      channels,
      toEmail: target.email,
      toPhone: target.phone,
      subject,
      message,
      initiatedBy: "hr",
      eventType: "general_hr_broadcast"
    });
    const outcome = getNotificationOutcomeSummary(entries);
    deliveredCount += outcome.sent;
    failedCount += outcome.failed;
    skippedCount += outcome.skipped;

    target.indexes.forEach((index) => {
      const application = ensureApplicationDefaults(applications[index]);
      appendNotificationEntries(application, entries);
      applications[index] = application;
    });
  }

  await writeApplications(applications);

  const settings = await readSettings();
  settings.communicationBroadcasts = normalizeBroadcastHistory([
    createBroadcastHistoryEntry({
      subject,
      message,
      channels,
      initiatedBy: "hr",
      totalTargets: recipientTargets.length,
      deliveredCount,
      failedCount,
      skippedCount
    }),
    ...(Array.isArray(settings.communicationBroadcasts) ? settings.communicationBroadcasts : [])
  ]);
  settings.updatedAt = new Date().toISOString();
  await writeSettings(settings);

  if (deliveredCount > 0 && failedCount === 0 && skippedCount === 0) {
    return res.redirect("/hr/communications?sent=1");
  }

  if (deliveredCount > 0) {
    return res.redirect("/hr/communications?sent=partial");
  }

  return res.redirect("/hr/communications?sent=failed");
});

app.post("/hr/admin-accounts/create", ensureHrAdmin, async (req, res) => {
  const result = await createDepartmentAdminAccount({
    username: req.body.username,
    password: req.body.password || DEFAULT_DEPARTMENT_ADMIN_PASSWORD,
    department: req.body.department,
    displayName: req.body.displayName
  });

  if (result.error) {
    return renderAdminAccountsPage(res, {
      statusCode: 400,
      error: result.error
    });
  }

  return res.redirect("/hr/admin-accounts?created=1");
});

app.post("/hr/admin-accounts/:username/update", ensureHrAdmin, async (req, res) => {
  const result = await updateDepartmentAdminAccount(req.params.username, {
    username: req.body.username,
    department: req.body.department,
    displayName: req.body.displayName
  });

  if (result.error) {
    return renderAdminAccountsPage(res, {
      statusCode: 400,
      error: result.error
    });
  }

  return res.redirect("/hr/admin-accounts?updated=1");
});

app.post("/hr/admin-accounts/:username/password", ensureHrAdmin, async (req, res) => {
  const result = await setDepartmentAdminPassword(req.params.username, req.body.password);

  if (result.error) {
    return renderAdminAccountsPage(res, {
      statusCode: 400,
      error: result.error
    });
  }

  return res.redirect("/hr/admin-accounts?passwordReset=1");
});

app.post("/hr/admin-accounts/:username/toggle", ensureHrAdmin, async (req, res) => {
  const nextState = (req.body.isActive || "").toString() === "1";
  const result = await setDepartmentAdminActiveState(req.params.username, nextState);

  if (result.error) {
    return renderAdminAccountsPage(res, {
      statusCode: 400,
      error: result.error
    });
  }

  return res.redirect("/hr/admin-accounts?toggled=1");
});

function renderReportsPage(res, {
  statusCode = 200,
  title,
  actionPath,
  exportPath,
  applications,
  filters,
  departmentOptions,
  settings
}) {
  const scopedDepartment = filters.department !== "All" ? filters.department : null;
  const analytics = buildAnalyticsSummary(applications, settings, scopedDepartment);

  return res.status(statusCode).render("reports", {
    pageTitle: title,
    activePortal: res.locals.isHrAdmin ? "hr" : "admin",
    filters,
    departmentOptions,
    periodOptions: PERIODS,
    statusOptions: STATUS_OPTIONS,
    analytics,
    actionPath,
    exportPath,
    formatDate,
    getPeriodLabel,
    getDepartmentLabel,
    getStatusClass
  });
}

app.get("/hr/reports", ensureHrAdmin, async (req, res) => {
  clearHrDepartmentScope(req);
  const settings = await readSettings();
  const filters = getReportFilterState({
    query: req.query,
    allowDepartmentFilter: true
  });
  const applications = filterApplicationsForReports(await readApplications(), filters);

  return renderReportsPage(res, {
    title: "HR Reports and Analytics",
    actionPath: "/hr/reports",
    exportPath: "/hr/reports/export.csv",
    applications,
    filters,
    departmentOptions: DEPARTMENTS,
    settings
  });
});

app.get("/hr/reports/export.csv", ensureHrAdmin, async (req, res) => {
  clearHrDepartmentScope(req);
  const filters = getReportFilterState({
    query: req.query,
    allowDepartmentFilter: true
  });
  const applications = filterApplicationsForReports(await readApplications(), filters);
  const csv = convertApplicationsToCsv(applications);

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="hr-report.csv"');
  return res.send(csv);
});

app.get("/hr/departments", ensureHrAdmin, async (req, res) => {
  clearHrDepartmentScope(req);
  const applications = await readApplications();
  const departmentSummaries = buildDepartmentAccessSummaries(applications);
  return renderDepartmentAccessPage(res, departmentSummaries);
});

app.get("/hr/departments/:department/open", ensureHrAdmin, async (req, res) => {
  const departmentKey = (req.params.department || "").toString().trim();
  if (!isValidDepartment(departmentKey)) {
    return res.status(404).render("not-found");
  }

  setHrDepartmentScope(req, departmentKey);
  return res.redirect(`/admin/applications?status=All&department=${encodeURIComponent(departmentKey)}`);
});

app.get("/admin/periods", ensureDepartmentAdmin, async (req, res) => {
  const settings = await readSettings();
  const adminScopeDepartment = getAdminScopeDepartment(req);
  if (!adminScopeDepartment) {
    return res.redirect("/hr/periods");
  }
  const editableDepartments = adminScopeDepartment
    ? DEPARTMENTS.filter((department) => department.key === adminScopeDepartment)
    : DEPARTMENTS;

  return res.render("admin-periods", {
    periodOptions: getPeriodOptions(settings),
    departmentCapacities: settings.departmentCapacities || createDefaultDepartmentCapacities(0),
    institutionMaxSharePercent:
      Number(settings.institutionMaxSharePercent) || DEFAULT_INSTITUTION_MAX_SHARE_PERCENT,
    landingTickerText: settings.landingTickerText || "",
    applicationDeadline: settings.applicationDeadline || "",
    editableDepartments,
    maxApplicants: Number(settings.maxApplicants) || 0,
    updatedAt: settings.updatedAt,
    saved: req.query.saved === "1",
    error: null,
    formatDate
  });
});

app.post("/admin/periods", ensureDepartmentAdmin, async (req, res) => {
  const settings = await readSettings();
  const adminScopeDepartment = getAdminScopeDepartment(req);
  if (!adminScopeDepartment) {
    return res.redirect("/hr/periods");
  }
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
        landingTickerText: settings.landingTickerText || "",
        applicationDeadline: settings.applicationDeadline || "",
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
      landingTickerText: settings.landingTickerText || "",
      applicationDeadline: settings.applicationDeadline || "",
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

  await writeSettings(updated);
  return res.redirect("/admin/periods?saved=1");
});

app.get("/admin/reports", ensureDepartmentAdmin, async (req, res) => {
  const scopedDepartment = getAdminScopeDepartment(req);
  if (!scopedDepartment) {
    return res.redirect("/hr/reports");
  }
  const filters = getReportFilterState({
    query: req.query,
    allowDepartmentFilter: false,
    forcedDepartment: scopedDepartment || "All"
  });
  const applications = filterApplicationsForReports(filterApplicationsForAdmin(req, await readApplications()), filters);
  const settings = await readSettings();

  return renderReportsPage(res, {
    title: "Department Reports and Analytics",
    actionPath: "/admin/reports",
    exportPath: "/admin/reports/export.csv",
    applications,
    filters,
    departmentOptions: scopedDepartment
      ? DEPARTMENTS.filter((department) => department.key === scopedDepartment)
      : DEPARTMENTS,
    settings
  });
});

app.get("/admin/reports/export.csv", ensureDepartmentAdmin, async (req, res) => {
  const scopedDepartment = getAdminScopeDepartment(req);
  if (!scopedDepartment) {
    return res.redirect("/hr/reports");
  }
  const filters = getReportFilterState({
    query: req.query,
    allowDepartmentFilter: false,
    forcedDepartment: scopedDepartment || "All"
  });
  const applications = filterApplicationsForReports(filterApplicationsForAdmin(req, await readApplications()), filters);
  const csv = convertApplicationsToCsv(applications);

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="department-report.csv"');
  return res.send(csv);
});

app.get("/admin/applications", ensureDepartmentAdmin, async (req, res) => {
  let adminScopeDepartment = getAdminScopeDepartment(req);
  const statusFilterRaw = (req.query.status || "All").toString();
  const normalizedStatusFilter =
    statusFilterRaw === "All" ? "All" : normalizeApplicationStatus(statusFilterRaw);
  const allowedFilters = new Set(["All", ...STATUS_OPTIONS]);
  const statusFilter = allowedFilters.has(normalizedStatusFilter) ? normalizedStatusFilter : "All";
  const departmentFilterRaw = (req.query.department || "All").toString().trim();
  const requestedDepartmentFilter =
    departmentFilterRaw === "All" || isValidDepartment(departmentFilterRaw)
      ? departmentFilterRaw
      : "All";

  if (!adminScopeDepartment && requestedDepartmentFilter !== "All") {
    setHrDepartmentScope(req, requestedDepartmentFilter);
    adminScopeDepartment = getAdminScopeDepartment(req);
  }

  if (!adminScopeDepartment) {
    return res.redirect("/hr/departments");
  }

  const departmentFilter = adminScopeDepartment || requestedDepartmentFilter;

  const allApplications = filterApplicationsForAdmin(req, await readApplications()).sort(
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
    approved: allApplications.filter((application) => isAdmittedStatus(application.status)).length,
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

app.get("/admin/departments", ensureDepartmentAdmin, async (_req, res) => {
  const applications = await readApplications();
  const departmentSummaries = buildDepartmentAccessSummaries(applications);
  return renderDepartmentAccessPage(res, departmentSummaries);
});

app.get("/admin/applications/:id", ensureDepartmentAdmin, async (req, res) => {
  const applications = await readApplications();
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
  } else if (req.query.frozen === "1") {
    notice = "Application record frozen successfully.";
  } else if (req.query.unfrozen === "1") {
    notice = "Application record restored successfully.";
  }

  return renderAdminDetailPage(res, {
    application,
    notice
  });
});

app.post("/admin/applications/:id/placement", ensureDepartmentAdmin, async (req, res) => {
  const assignedDepartment = (req.body.assignedDepartment || "").toString().trim();
  const adminScopeDepartment = getAdminScopeDepartment(req);
  const applications = await readApplications();
  const index = applications.findIndex((item) => item.id === req.params.id);

  if (index === -1) {
    return res.status(404).render("not-found");
  }

  const application = ensureApplicationDefaults(applications[index]);

  if (!canAdminAccessApplication(req, application)) {
    return res.status(403).send("Access denied for this department.");
  }

  if (isApplicationFrozen(application)) {
    return renderAdminDetailPage(res, {
      statusCode: 400,
      application,
      error: "This application record is frozen. Unfreeze it before updating placement."
    });
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
  await writeApplications(applications);

  return res.redirect(`/admin/applications/${req.params.id}?placementSaved=1`);
});

app.post("/admin/applications/:id/documents-review", ensureDepartmentAdmin, async (req, res) => {
  const applications = await readApplications();
  const index = applications.findIndex((item) => item.id === req.params.id);

  if (index === -1) {
    return res.status(404).render("not-found");
  }

  const application = ensureApplicationDefaults(applications[index]);

  if (!canAdminAccessApplication(req, application)) {
    return res.status(403).send("Access denied for this department.");
  }

  if (isApplicationFrozen(application)) {
    return renderAdminDetailPage(res, {
      statusCode: 400,
      application,
      error: "This application record is frozen. Unfreeze it before updating document review."
    });
  }

  let hasRejected = false;

  if (application.combinedDocument?.filename) {
    const combinedStatus = (req.body[`docStatus_${COMBINED_DOCUMENT_FIELD}`] || "Pending")
      .toString()
      .trim();
    const combinedComment = (req.body[`docComment_${COMBINED_DOCUMENT_FIELD}`] || "")
      .toString()
      .trim();

    if (!["Pending", "Accepted", "Rejected"].includes(combinedStatus)) {
      return renderAdminDetailPage(res, {
        statusCode: 400,
        application,
        error: `Invalid document status for ${getDocumentLabel(COMBINED_DOCUMENT_FIELD)}.`
      });
    }

    application.combinedDocumentReview = {
      status: combinedStatus,
      comment: combinedComment
    };
    if (combinedStatus === "Rejected") {
      hasRejected = true;
    }

    if (application.nitaDocument?.filename) {
      const nitaStatus = (req.body[`docStatus_${NITA_DOCUMENT_FIELD}`] || "Pending")
        .toString()
        .trim();
      const nitaComment = (req.body[`docComment_${NITA_DOCUMENT_FIELD}`] || "")
        .toString()
        .trim();

      if (!["Pending", "Accepted", "Rejected"].includes(nitaStatus)) {
        return renderAdminDetailPage(res, {
          statusCode: 400,
          application,
          error: `Invalid document status for ${getDocumentLabel(NITA_DOCUMENT_FIELD)}.`
        });
      }

      application.nitaDocumentReview = {
        status: nitaStatus,
        comment: nitaComment
      };

      if (nitaStatus === "Rejected") {
        hasRejected = true;
      }
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
  await writeApplications(applications);
  if (application.status === "Needs Correction") {
    await sendAndPersistApplicationNotification({
      req,
      applications,
      index,
      eventType: "documents_correction_requested",
      initiatedBy: "department_review"
    });
  }

  return res.redirect(`/admin/applications/${req.params.id}?docsReviewed=1`);
});

app.post("/admin/applications/:id/joining-letter", ensureDepartmentAdmin, async (req, res) => {
  const applications = await readApplications();
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
      error: "Joining letter upload is done by HR after the final admission decision."
  });
});

app.get("/admin/files/:filename", ensureDepartmentAdmin, async (req, res) => {
  const safeFilename = path.basename(req.params.filename);
  const visibleApplications = filterApplicationsForAdmin(req, await readApplications());
  const matchedApplication = visibleApplications.find((application) =>
    doesApplicationReferenceFile(application, safeFilename)
  );

  if (!matchedApplication) {
    return res.status(403).send("Access denied for this file.");
  }

  const storedFile = getApplicationStoredFileByFilename(matchedApplication, safeFilename);
  return fileStorage.sendStoredFile(res, storedFile, {
    downloadName: storedFile?.originalName || safeFilename
  });
});

app.post("/admin/applications/:id/status", ensureDepartmentAdmin, async (req, res) => {
  const { status, reviewerComment } = req.body;

  if (!STATUS_OPTIONS.includes(status)) {
    return res.status(400).send("Invalid status");
  }

  const applications = await readApplications();
  const index = applications.findIndex((item) => item.id === req.params.id);

  if (index === -1) {
    return res.status(404).render("not-found");
  }

  const application = ensureApplicationDefaults(applications[index]);
  const previousStatus = application.status;

  if (!canAdminAccessApplication(req, application)) {
    return res.status(403).send("Access denied for this department.");
  }

  if (isApplicationFrozen(application)) {
    return renderAdminDetailPage(res, {
      statusCode: 400,
      application,
      error: "This application record is frozen. Unfreeze it before updating the application status."
    });
  }

  if (status === "Admitted") {
    return renderAdminDetailPage(res, {
      statusCode: 400,
      application,
      error: "Department review cannot set the final admission decision. Send verified applications to HR."
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
  await writeApplications(applications);
  if (status !== previousStatus && status === "Verified") {
    await sendAndPersistApplicationNotification({
      req,
      applications,
      index,
      eventType: "department_verified",
      initiatedBy: "department_review"
    });
  } else if (status !== previousStatus && status === "Rejected") {
    await sendAndPersistApplicationNotification({
      req,
      applications,
      index,
      eventType: "department_rejected",
      initiatedBy: "department_review"
    });
  }

  return res.redirect(`/admin/applications/${req.params.id}`);
});

app.post("/admin/applications/:id/edit", ensureDepartmentAdmin, async (req, res) => {
  const {
    fullName,
    email,
    phone,
    idNumber,
    institution,
    course,
    appliedDepartment,
    period,
    startDate,
    endDate,
    coverNote
  } = req.body;

  const applications = await readApplications();
  const index = applications.findIndex((item) => item.id === req.params.id);

  if (index === -1) {
    return res.status(404).render("not-found");
  }

  const existingApplication = ensureApplicationDefaults(applications[index]);
  if (!canAdminAccessApplication(req, existingApplication)) {
    return res.status(403).send("Access denied for this department.");
  }

  if (isApplicationFrozen(existingApplication)) {
    return renderAdminDetailPage(res, {
      statusCode: 400,
      application: existingApplication,
      error: "This application record is frozen. Unfreeze it before editing applicant information."
    });
  }

  const requiredText = [
    fullName,
    email,
    phone,
    idNumber,
    institution,
    course,
    appliedDepartment,
    period,
    startDate,
    endDate,
    coverNote
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
    idNumber: (idNumber || "").trim(),
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

  const coverNoteError = getCoverNoteError(draftApplication.coverNote);
  if (coverNoteError) {
    return renderAdminDetailPage(res, {
      statusCode: 400,
      application: draftApplication,
      error: coverNoteError
    });
  }

  const idNumberError = getIdNumberValidationError(draftApplication.idNumber);
  if (idNumberError) {
    return renderAdminDetailPage(res, {
      statusCode: 400,
      application: draftApplication,
      error: idNumberError
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

  const settings = await readSettings();
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

  draftApplication.placementNumber =
    generatePlacementNumber(applications, draftApplication.idNumber, draftApplication.id) ||
    draftApplication.placementNumber ||
    draftApplication.id;
  draftApplication.updatedAt = new Date().toISOString();
  applications[index] = draftApplication;
  await writeApplications(applications);

  return res.redirect(`/admin/applications/${req.params.id}`);
});

app.post("/admin/applications/:id/freeze", ensureDepartmentAdmin, async (req, res) => {
  const applications = await readApplications();
  const index = applications.findIndex((item) => item.id === req.params.id);

  if (index === -1) {
    return res.status(404).render("not-found");
  }

  const application = ensureApplicationDefaults(applications[index]);
  if (!canAdminAccessApplication(req, application)) {
    return res.status(403).send("Access denied for this department.");
  }

  applications[index] = freezeApplicationRecord(
    application,
    req.session?.adminRole || "hr_admin",
    "Record frozen by HR-managed department review."
  );
  await writeApplications(applications);

  return res.redirect(`/admin/applications/${req.params.id}?frozen=1`);
});

app.post("/admin/applications/:id/unfreeze", ensureDepartmentAdmin, async (req, res) => {
  const applications = await readApplications();
  const index = applications.findIndex((item) => item.id === req.params.id);

  if (index === -1) {
    return res.status(404).render("not-found");
  }

  const application = ensureApplicationDefaults(applications[index]);
  if (!canAdminAccessApplication(req, application)) {
    return res.status(403).send("Access denied for this department.");
  }

  applications[index] = unfreezeApplicationRecord(application);
  await writeApplications(applications);

  return res.redirect(`/admin/applications/${req.params.id}?unfrozen=1`);
});

app.get("/hr/applications", ensureHrAdmin, async (req, res) => {
  clearHrDepartmentScope(req);
  const statusFilterRaw = (req.query.status || "Verified").toString();
  const normalizedStatusFilter =
    statusFilterRaw === "All" ? "All" : normalizeApplicationStatus(statusFilterRaw);
  const allowedFilters = new Set(["All", ...HR_VISIBLE_STATUSES]);
  const statusFilter = allowedFilters.has(normalizedStatusFilter) ? normalizedStatusFilter : "Verified";
  const departmentFilterRaw = (req.query.department || "All").toString().trim();
  const departmentFilter =
    departmentFilterRaw === "All" || isValidDepartment(departmentFilterRaw)
      ? departmentFilterRaw
      : "All";

  const allApplications = (await readApplications())
    .filter((application) => HR_VISIBLE_STATUSES.has(application.status))
    .sort(
    (a, b) => new Date(b.submittedAt) - new Date(a.submittedAt)
  );

  let applications =
    statusFilter === "All"
      ? allApplications
      : allApplications.filter((item) => item.status === statusFilter);

  if (departmentFilter !== "All") {
    applications = applications.filter((item) => item.appliedDepartment === departmentFilter);
  }

  const settings = await readSettings();
  const departmentSummaries = buildDepartmentReportRows(await readApplications(), settings, null);

  const stats = {
    total: allApplications.length,
    verified: allApplications.filter((application) => application.status === "Verified").length,
    approved: allApplications.filter((application) => isAdmittedStatus(application.status)).length,
    rejected: allApplications.filter((application) => application.status === "Rejected").length
  };

  return res.render("hr-list", {
    applications,
    stats,
    statusFilter,
    departmentFilter,
    departmentOptions: DEPARTMENTS,
    departmentSummaries,
    formatDate,
    getPeriodLabel,
    getDepartmentLabel,
    getStatusClass
  });
});

app.get("/hr/applications/:id", ensureHrAdmin, async (req, res) => {
  const applications = await readApplications();
  const application = applications.find((item) => item.id === req.params.id);

  if (!application) {
    return res.status(404).render("not-found");
  }

  if (!HR_VISIBLE_STATUSES.has(application.status)) {
    return res.status(403).send("This application is not yet verified through department review.");
  }

  const notice =
    req.query.nitaCompleted === "1"
        ? "HR confirmed the stamped NITA document."
        : req.query.joiningSaved === "1"
      ? "Joining letter uploaded successfully."
        : req.query.statusSaved === "1"
      ? "HR status updated successfully."
        : null;

  return renderHrDetailPage(res, {
    application,
    notice
  });
});

app.post("/hr/applications/:id/nita-complete", ensureHrAdmin, async (req, res) => {
  const applications = await readApplications();
  const index = applications.findIndex((item) => item.id === req.params.id);

  if (index === -1) {
    return res.status(404).render("not-found");
  }

  const application = ensureApplicationDefaults(applications[index]);
  const previousStatus = application.status;

  if (!HR_VISIBLE_STATUSES.has(application.status)) {
    return res.status(400).send("Application is not yet in HR review queue.");
  }

  if (isApplicationFrozen(application)) {
    return renderHrDetailPage(res, {
      application,
      statusCode: 400,
      error: "This application record is frozen. Unfreeze it from department review before continuing the HR workflow."
    });
  }

  if (application.status === "Rejected") {
    return renderHrDetailPage(res, {
      application,
      statusCode: 400,
      error: "Cannot complete NITA workflow after the application has been rejected."
    });
  }

  if (!application.nitaResubmittedDocument?.filename) {
    return renderHrDetailPage(res, {
      application,
      statusCode: 400,
      error: "Student must re-submit the stamped NITA document before HR can complete this stage."
    });
  }

  application.nitaWorkflow = {
    ...normalizeNitaWorkflow(application.nitaWorkflow),
    status: "Completed",
    comment: "HR confirmed the stamped NITA document.",
    updatedAt: new Date().toISOString()
  };
  application.updatedAt = application.nitaWorkflow.updatedAt;

  applications[index] = application;
  await writeApplications(applications);
  await sendAndPersistApplicationNotification({
    req,
    applications,
    index,
    eventType: "nita_completed",
    initiatedBy: "hr"
  });

  return res.redirect(`/hr/applications/${req.params.id}?nitaCompleted=1`);
});

app.post("/hr/applications/:id/status", ensureHrAdmin, async (req, res) => {
  const status = (req.body.status || "").toString().trim();
  const reviewerComment = (req.body.reviewerComment || "").toString().trim();
  const hrAllowedStatuses = new Set(HR_VISIBLE_STATUSES);

  if (!hrAllowedStatuses.has(status)) {
    return res.status(400).send("Invalid HR status.");
  }

  const applications = await readApplications();
  const index = applications.findIndex((item) => item.id === req.params.id);

  if (index === -1) {
    return res.status(404).render("not-found");
  }

  const application = ensureApplicationDefaults(applications[index]);

  if (!HR_VISIBLE_STATUSES.has(application.status)) {
    return res.status(400).send("Application is not yet in HR review queue.");
  }

  if (isApplicationFrozen(application)) {
    return renderHrDetailPage(res, {
      application,
      statusCode: 400,
      error: "This application record is frozen. Unfreeze it from department review before continuing the HR workflow."
    });
  }

  if (status === "Admitted" && !["Verified", "Admitted"].includes(application.status)) {
    return renderHrDetailPage(res, {
      application,
      statusCode: 400,
      error: "Only department-verified applications can be admitted by HR."
    });
  }

  if (status === "Admitted" && hasAnyRejectedDocuments(application)) {
    return renderHrDetailPage(res, {
      application,
      statusCode: 400,
      error: "Cannot admit while some documents are still rejected."
    });
  }

  if (status === "Admitted" && normalizeNitaWorkflow(application.nitaWorkflow).status !== "Completed") {
    return renderHrDetailPage(res, {
      application,
      statusCode: 400,
      error:
        "Complete the NITA workflow first. The student must re-submit the stamped NITA copy and HR must confirm it before the final admission decision."
    });
  }

  application.status = status;
  application.reviewerComment = reviewerComment;
  application.updatedAt = new Date().toISOString();

  applications[index] = application;
  await writeApplications(applications);
  if (status !== previousStatus && status === "Admitted") {
    await sendAndPersistApplicationNotification({
      req,
      applications,
      index,
      eventType: "hr_admitted",
      initiatedBy: "hr"
    });
  } else if (status !== previousStatus && status === "Rejected") {
    await sendAndPersistApplicationNotification({
      req,
      applications,
      index,
      eventType: "hr_rejected",
      initiatedBy: "hr"
    });
  }

  return res.redirect(`/hr/applications/${req.params.id}?statusSaved=1`);
});

app.post("/hr/applications/:id/joining-letter", ensureHrAdmin, async (req, res) => {
  const applications = await readApplications();
  const index = applications.findIndex((item) => item.id === req.params.id);

  if (index === -1) {
    return res.status(404).render("not-found");
  }

  const application = ensureApplicationDefaults(applications[index]);

  if (!HR_VISIBLE_STATUSES.has(application.status)) {
    return res.status(400).send("Application is not yet in HR review queue.");
  }

  if (isApplicationFrozen(application)) {
    return renderHrDetailPage(res, {
      application,
      statusCode: 400,
      error: "This application record is frozen. Unfreeze it from department review before continuing the HR workflow."
    });
  }

  if (!isAdmittedStatus(application.status)) {
    return renderHrDetailPage(res, {
      application,
      statusCode: 400,
      error: "Admit the application first before uploading a joining letter."
    });
  }

  if (normalizeNitaWorkflow(application.nitaWorkflow).status !== "Completed") {
    return renderHrDetailPage(res, {
      application,
      statusCode: 400,
      error: "Complete the NITA workflow before uploading the joining letter."
    });
  }

  return joiningLetterUploadMiddleware(req, res, async (uploadError) => {
    if (uploadError) {
      cleanupUploadedFiles(req.files || {});
      if (req.file && req.file.filename) {
        removeStoredFile(req.file.filename);
      }

      return renderHrDetailPage(res, {
        application,
        statusCode: 400,
        error: getUploadErrorMessage(uploadError)
      });
    }

    if (!req.file) {
      return renderHrDetailPage(res, {
        application,
        statusCode: 400,
        error: "Please select a joining letter file to upload."
      });
    }

    let joiningLetterSecurity;
    try {
      joiningLetterSecurity = scanUploadedFile(req.file);
    } catch (scanError) {
      removeStoredFile(req.file.filename);
      return renderHrDetailPage(res, {
        application,
        statusCode: 400,
        error: scanError.message || "Joining letter security scan failed."
      });
    }

    return (async () => {
      const oldJoiningLetter = application.joiningLetter;
      application.joiningLetter = await persistUploadedApplicationFile(req.file, {
        folder: "joining-letters",
        uploadedAt: new Date().toISOString(),
        security: joiningLetterSecurity
      });
      application.updatedAt = new Date().toISOString();

      applications[index] = application;
      await writeApplications(applications);
      await sendAndPersistApplicationNotification({
        req,
        applications,
        index,
        eventType: "joining_letter_ready",
        initiatedBy: "hr"
      });
      Promise.resolve(fileStorage.removeStoredFile(oldJoiningLetter)).catch(() => {});

      return res.redirect(`/hr/applications/${req.params.id}?joiningSaved=1`);
    })().catch((storageError) => {
      cleanupUploadedFiles({ [JOINING_LETTER_FIELD]: [req.file] });
      return renderHrDetailPage(res, {
        application,
        statusCode: 500,
        error: storageError.message || "Failed to store the joining letter."
      });
    });
  });
});

app.get("/hr/files/:filename", ensureHrAdmin, async (req, res) => {
  const safeFilename = path.basename(req.params.filename);
  const application = (await readApplications()).find((item) => doesApplicationReferenceFile(item, safeFilename));
  if (!application) {
    return res.status(404).send("File not found");
  }

  const storedFile = getApplicationStoredFileByFilename(application, safeFilename);
  return fileStorage.sendStoredFile(res, storedFile, {
    downloadName: storedFile?.originalName || safeFilename
  });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  return res.status(500).send("Unexpected server error.");
});

app.use((_req, res) => {
  res.status(404).render("not-found");
});

async function startServer() {
  try {
    await databasePromise;
  } catch (error) {
    console.error("Failed to connect to MongoDB.");
    console.error(error);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`Attachment application system running on http://localhost:${PORT}`);
    console.log(`Department review redirect: http://localhost:${PORT}${ADMIN_PORTAL_PATH} -> ${HR_PORTAL_PATH}`);
    console.log(`HR portal entry: http://localhost:${PORT}${HR_PORTAL_PATH}`);
    console.log(`Storage root: ${STORAGE_ROOT}`);
    console.log(`MongoDB database: ${MONGODB_DB_NAME}`);
    console.log(`MongoDB connection configured: ${MONGODB_URI ? "yes" : "no"}`);
    console.log("Session store: MongoDB");
    console.log(`File storage provider: ${fileStorage.provider}`);
    const notificationProviders = notificationService.getProviderSummary();
    console.log(`Email notifications: ${notificationProviders.emailEnabled ? "configured" : "not configured"}`);
    console.log(`SMS notifications: ${notificationProviders.smsEnabled ? "configured" : "not configured"}`);

    const storageWarning = fileStorage.getProviderWarning();
    if (storageWarning) {
      console.warn(storageWarning);
    }

    if (process.env.NODE_ENV === "production" && !process.env.STORAGE_ROOT) {
      console.warn(
        "Persistent storage warning: STORAGE_ROOT is not set. Uploaded files, database data, and sessions will reset on ephemeral hosting."
      );
    }
  });
}

startServer();


