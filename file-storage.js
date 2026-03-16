const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function createCloudinarySignature(parameters, apiSecret) {
  const payload = Object.keys(parameters)
    .filter((key) => parameters[key] !== undefined && parameters[key] !== null && parameters[key] !== "")
    .sort()
    .map((key) => `${key}=${parameters[key]}`)
    .join("&");

  return crypto.createHash("sha1").update(`${payload}${apiSecret}`).digest("hex");
}

function getFileExtension(originalName) {
  return path.extname((originalName || "").toString()).toLowerCase();
}

function ensureBlobConstructor() {
  if (typeof Blob === "undefined") {
    throw new Error("Blob is not available in this Node.js runtime. Cloud storage requires Node 18+.");
  }
}

function createFileStorage({
  uploadDir,
  provider,
  cloudinaryCloudName,
  cloudinaryApiKey,
  cloudinaryApiSecret,
  cloudinaryFolder
}) {
  const requestedProvider = (provider || "local").toString().trim().toLowerCase();
  const hasCloudinaryConfig =
    Boolean(cloudinaryCloudName) &&
    Boolean(cloudinaryApiKey) &&
    Boolean(cloudinaryApiSecret) &&
    typeof fetch === "function";

  const activeProvider =
    requestedProvider === "cloudinary" && hasCloudinaryConfig ? "cloudinary" : "local";

  function getProviderWarning() {
    if (requestedProvider !== "cloudinary") {
      return null;
    }

    if (activeProvider === "cloudinary") {
      return null;
    }

    return "Cloudinary storage was requested but is not fully configured. Falling back to local file storage.";
  }

  async function uploadToCloudinary(file, { folder = "applications" } = {}) {
    ensureBlobConstructor();

    if (!file?.path || !fs.existsSync(file.path)) {
      throw new Error("Uploaded file is missing on disk before cloud transfer.");
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const baseFolder = (cloudinaryFolder || "attachment-application-system").replace(/\/+$/, "");
    const finalFolder = `${baseFolder}/${folder}`.replace(/\/+/g, "/");
    const publicId = `${finalFolder}/${path.parse(file.filename || file.originalname || "upload").name}`;
    const uploadParams = {
      folder: finalFolder,
      public_id: path.parse(file.filename || file.originalname || "upload").name,
      timestamp
    };
    const signature = createCloudinarySignature(uploadParams, cloudinaryApiSecret);
    const endpoint = `https://api.cloudinary.com/v1_1/${cloudinaryCloudName}/auto/upload`;
    const buffer = fs.readFileSync(file.path);
    const formData = new FormData();

    formData.append(
      "file",
      new Blob([buffer], { type: file.mimetype || "application/octet-stream" }),
      file.originalname || file.filename || "upload"
    );
    formData.append("api_key", cloudinaryApiKey);
    formData.append("timestamp", String(timestamp));
    formData.append("folder", finalFolder);
    formData.append("public_id", path.parse(file.filename || file.originalname || "upload").name);
    formData.append("signature", signature);

    const response = await fetch(endpoint, {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(`Cloud upload failed: ${response.status} ${responseText}`.trim());
    }

    const payload = await response.json();
    return {
      storage: "cloudinary",
      filename: (file.filename || file.originalname || "").toString(),
      originalName: file.originalname || path.basename(file.path),
      mimeType: file.mimetype || "",
      size: Number(file.size || payload.bytes || 0),
      extension: getFileExtension(file.originalname),
      cloudUrl: payload.secure_url,
      publicId: payload.public_id || publicId,
      resourceType: payload.resource_type || "raw",
      version: payload.version || null
    };
  }

  function createLocalEntry(file) {
    return {
      storage: "local",
      filename: (file.filename || "").toString(),
      originalName: file.originalname || path.basename(file.filename || ""),
      mimeType: file.mimetype || "",
      size: Number(file.size || 0),
      extension: getFileExtension(file.originalname)
    };
  }

  async function persistUploadedFile(file, options = {}) {
    if (!file) {
      return null;
    }

    if (activeProvider === "cloudinary") {
      try {
        return await uploadToCloudinary(file, options);
      } finally {
        removeTemporaryFile(file);
      }
    }

    return createLocalEntry(file);
  }

  async function deleteCloudinaryAsset(fileEntry) {
    if (!fileEntry?.publicId) {
      return;
    }

    const resourceType = (fileEntry.resourceType || "raw").toString();
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createCloudinarySignature(
      {
        invalidate: "true",
        public_id: fileEntry.publicId,
        timestamp
      },
      cloudinaryApiSecret
    );

    const endpoint = `https://api.cloudinary.com/v1_1/${cloudinaryCloudName}/${resourceType}/destroy`;
    const body = new URLSearchParams();
    body.set("public_id", fileEntry.publicId);
    body.set("timestamp", String(timestamp));
    body.set("api_key", cloudinaryApiKey);
    body.set("invalidate", "true");
    body.set("signature", signature);

    const response = await fetch(endpoint, {
      method: "POST",
      body
    });

    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(`Cloud delete failed: ${response.status} ${responseText}`.trim());
    }
  }

  function removeTemporaryFile(file) {
    const localPath = file?.path || (file?.filename ? path.join(uploadDir, path.basename(file.filename)) : "");
    if (!localPath || !fs.existsSync(localPath)) {
      return;
    }

    try {
      fs.unlinkSync(localPath);
    } catch (_error) {
      // Ignore temporary cleanup failures.
    }
  }

  async function removeStoredFile(fileEntry) {
    if (!fileEntry) {
      return;
    }

    if (fileEntry.storage === "cloudinary") {
      await deleteCloudinaryAsset(fileEntry);
      return;
    }

    const safeFilename = path.basename(fileEntry.filename || "");
    if (!safeFilename) {
      return;
    }

    const localPath = path.join(uploadDir, safeFilename);
    if (!fs.existsSync(localPath)) {
      return;
    }

    try {
      fs.unlinkSync(localPath);
    } catch (_error) {
      // Ignore delete failures so the main workflow is not blocked.
    }
  }

  function sendStoredFile(res, fileEntry, { downloadName } = {}) {
    if (!fileEntry) {
      return res.status(404).send("File not found");
    }

    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");

    if (fileEntry.storage === "cloudinary" && fileEntry.cloudUrl) {
      return res.redirect(fileEntry.cloudUrl);
    }

    const safeFilename = path.basename(fileEntry.filename || "");
    const localPath = path.join(uploadDir, safeFilename);

    if (!safeFilename || !fs.existsSync(localPath)) {
      return res.status(404).send("File not found");
    }

    return res.download(localPath, downloadName || fileEntry.originalName || safeFilename);
  }

  return {
    provider: activeProvider,
    requestedProvider,
    getProviderWarning,
    persistUploadedFile,
    removeStoredFile,
    removeTemporaryFile,
    sendStoredFile
  };
}

module.exports = {
  createFileStorage
};
