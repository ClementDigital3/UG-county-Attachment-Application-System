require("dotenv").config();

const express = require("express");
const session = require("express-session");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const ALLOWED_EXTENSIONS = new Set([".pdf", ".jpg", ".jpeg", ".png"]);

const DATA_FILE = path.join(__dirname, "data", "applications.json");
const UPLOAD_DIR = path.join(__dirname, "uploads");

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const SESSION_SECRET = process.env.SESSION_SECRET || "change-this-secret";

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, "[]", "utf-8");
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return cb(new Error("Only PDF, JPG, JPEG and PNG files are allowed."));
    }
    return cb(null, true);
  }
});

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false
  })
);

function readApplications() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (error) {
    return [];
  }
}

function writeApplications(applications) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(applications, null, 2), "utf-8");
}

function cleanupUploadedFiles(files) {
  Object.values(files || {}).forEach((fileList) => {
    (fileList || []).forEach((file) => {
      const safeFilename = path.basename(file.filename);
      const target = path.join(UPLOAD_DIR, safeFilename);
      if (fs.existsSync(target)) {
        fs.unlinkSync(target);
      }
    });
  });
}

function cleanupApplicationDocuments(application) {
  Object.values(application?.documents || {}).forEach((filename) => {
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
      // Ignore cleanup failures so record deletion still succeeds.
    }
  });
}

function ensureAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) {
    return next();
  }

  return res.redirect("/admin/login");
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleString("en-KE", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

app.get("/", (_req, res) => {
  const applications = readApplications();
  const pending = applications.filter((a) => a.status === "Pending").length;

  res.render("index", {
    total: applications.length,
    pending
  });
});

app.get("/apply", (_req, res) => {
  res.render("apply", { error: null });
});

app.post(
  "/apply",
  upload.fields([
    { name: "nationalId", maxCount: 1 },
    { name: "introLetter", maxCount: 1 },
    { name: "cv", maxCount: 1 }
  ]),
  (req, res) => {
    const {
      fullName,
      email,
      phone,
      institution,
      course,
      startDate,
      endDate,
      coverNote
    } = req.body;

    const files = req.files || {};

    const requiredText = [fullName, email, phone, institution, course, startDate, endDate];
    const hasMissingText = requiredText.some((field) => !field || !field.trim());
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (hasMissingText || !files.nationalId || !files.introLetter || !files.cv) {
      cleanupUploadedFiles(files);
      return res.status(400).render("apply", {
        error: "Please fill all required fields and upload all required documents."
      });
    }

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
      cleanupUploadedFiles(files);
      return res.status(400).render("apply", {
        error: "Please provide valid attachment dates. End date must be after start date."
      });
    }

    const applications = readApplications();
    const newApplication = {
      id: `ATT-${Date.now()}`,
      fullName: fullName.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      institution: institution.trim(),
      course: course.trim(),
      startDate,
      endDate,
      coverNote: (coverNote || "").trim(),
      documents: {
        nationalId: files.nationalId[0].filename,
        introLetter: files.introLetter[0].filename,
        cv: files.cv[0].filename
      },
      status: "Pending",
      reviewerComment: "",
      submittedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    applications.push(newApplication);
    writeApplications(applications);

    return res.redirect(`/application/${newApplication.id}`);
  }
);

app.get("/track", (_req, res) => {
  res.render("track", {
    error: null,
    result: null,
    formatDate
  });
});

app.post("/track", (req, res) => {
  const applicationId = (req.body.applicationId || "").trim();
  const email = (req.body.email || "").trim().toLowerCase();

  if (!applicationId || !email) {
    return res.status(400).render("track", {
      error: "Enter both application ID and email.",
      result: null,
      formatDate
    });
  }

  const applications = readApplications();
  const result = applications.find(
    (item) => item.id.toLowerCase() === applicationId.toLowerCase() && item.email === email
  );

  if (!result) {
    return res.status(404).render("track", {
      error: "No application found with the provided details.",
      result: null,
      formatDate
    });
  }

  return res.render("track", {
    error: null,
    result,
    formatDate
  });
});

app.get("/application/:id", (req, res) => {
  const applications = readApplications();
  const application = applications.find((item) => item.id === req.params.id);

  if (!application) {
    return res.status(404).render("not-found");
  }

  return res.render("status", {
    application,
    formatDate
  });
});

app.get("/admin/login", (req, res) => {
  if (req.session && req.session.isAdmin) {
    return res.redirect("/admin/applications");
  }

  return res.render("admin-login", { error: null });
});

app.post("/admin/login", (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.redirect("/admin/applications");
  }

  return res.status(401).render("admin-login", {
    error: "Invalid login credentials."
  });
});

app.post("/admin/logout", ensureAdmin, (req, res) => {
  req.session.destroy(() => {
    res.redirect("/admin/login");
  });
});

app.get("/admin/applications", ensureAdmin, (req, res) => {
  const statusFilterRaw = (req.query.status || "All").toString();
  const allowedFilters = new Set(["All", "Pending", "Verified", "Rejected"]);
  const statusFilter = allowedFilters.has(statusFilterRaw) ? statusFilterRaw : "All";

  const allApplications = readApplications().sort(
    (a, b) => new Date(b.submittedAt) - new Date(a.submittedAt)
  );
  const applications =
    statusFilter === "All"
      ? allApplications
      : allApplications.filter((item) => item.status === statusFilter);
  const stats = {
    total: allApplications.length,
    pending: allApplications.filter((a) => a.status === "Pending").length,
    verified: allApplications.filter((a) => a.status === "Verified").length,
    rejected: allApplications.filter((a) => a.status === "Rejected").length
  };

  res.render("admin-list", {
    applications,
    formatDate,
    statusFilter,
    stats
  });
});

app.get("/admin/applications/:id", ensureAdmin, (req, res) => {
  const applications = readApplications();
  const application = applications.find((item) => item.id === req.params.id);

  if (!application) {
    return res.status(404).render("not-found");
  }

  return res.render("admin-detail", {
    application,
    formatDate,
    error: null
  });
});

app.get("/admin/files/:filename", ensureAdmin, (req, res) => {
  const safeFilename = path.basename(req.params.filename);
  const filePath = path.join(UPLOAD_DIR, safeFilename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send("File not found");
  }

  return res.sendFile(filePath);
});

app.post("/admin/applications/:id/status", ensureAdmin, (req, res) => {
  const { status, reviewerComment } = req.body;

  if (!["Verified", "Rejected", "Pending"].includes(status)) {
    return res.status(400).send("Invalid status");
  }

  const applications = readApplications();
  const index = applications.findIndex((item) => item.id === req.params.id);

  if (index === -1) {
    return res.status(404).render("not-found");
  }

  applications[index].status = status;
  applications[index].reviewerComment = (reviewerComment || "").trim();
  applications[index].updatedAt = new Date().toISOString();

  writeApplications(applications);

  return res.redirect(`/admin/applications/${req.params.id}`);
});

app.post("/admin/applications/:id/edit", ensureAdmin, (req, res) => {
  const { fullName, email, phone, institution, course, startDate, endDate, coverNote } = req.body;
  const applications = readApplications();
  const index = applications.findIndex((item) => item.id === req.params.id);

  if (index === -1) {
    return res.status(404).render("not-found");
  }

  const requiredText = [fullName, email, phone, institution, course, startDate, endDate];
  const hasMissingText = requiredText.some((field) => !field || !field.trim());
  const start = new Date(startDate);
  const end = new Date(endDate);

  const draftApplication = {
    ...applications[index],
    fullName: (fullName || "").trim(),
    email: (email || "").trim().toLowerCase(),
    phone: (phone || "").trim(),
    institution: (institution || "").trim(),
    course: (course || "").trim(),
    startDate,
    endDate,
    coverNote: (coverNote || "").trim()
  };

  if (hasMissingText) {
    return res.status(400).render("admin-detail", {
      application: draftApplication,
      formatDate,
      error: "All required applicant fields must be filled."
    });
  }

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return res.status(400).render("admin-detail", {
      application: draftApplication,
      formatDate,
      error: "Please provide valid attachment dates. End date must be after start date."
    });
  }

  applications[index] = {
    ...applications[index],
    ...draftApplication,
    updatedAt: new Date().toISOString()
  };
  writeApplications(applications);

  return res.redirect(`/admin/applications/${req.params.id}`);
});

app.post("/admin/applications/:id/delete", ensureAdmin, (req, res) => {
  const applications = readApplications();
  const index = applications.findIndex((item) => item.id === req.params.id);

  if (index === -1) {
    return res.status(404).render("not-found");
  }

  const [removed] = applications.splice(index, 1);
  writeApplications(applications);
  cleanupApplicationDocuments(removed);

  return res.redirect("/admin/applications");
});

app.use((error, _req, res, next) => {
  if (!error) {
    return next();
  }

  if (error instanceof multer.MulterError) {
    return res.status(400).render("apply", {
      error: "Upload failed: each file must be 5MB or less."
    });
  }

  if (error && error.message) {
    return res.status(400).render("apply", {
      error: error.message
    });
  }

  return res.status(500).render("apply", {
    error: "Unexpected error while processing your application."
  });
});

app.use((_req, res) => {
  res.status(404).render("not-found");
});

app.listen(PORT, () => {
  console.log(`Attachment application system running on http://localhost:${PORT}`);
});
