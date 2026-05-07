const fs = require("fs");
const path = require("path");

function getFileExtension(originalName) {
  return path.extname((originalName || "").toString()).toLowerCase();
}

function createLocalEntry(file) {
  const safeFilename = path.basename((file?.filename || file?.originalname || "").toString());
  return {
    storage: "local",
    filename: safeFilename,
    originalName: (file?.originalname || file?.originalName || safeFilename).toString(),
    mimeType: (file?.mimetype || file?.mimeType || "").toString(),
    size: Number(file?.size || 0),
    extension: getFileExtension(file?.originalname || file?.originalName || safeFilename)
  };
}

function createFileStorage({
  uploadDir,
  databasePromise
}) {
  async function persistUploadedFile(file, { folder = "applications" } = {}) {
    if (!file) {
      return null;
    }

    const safeLocalPath = (file.path || "").toString().trim();

    try {
      if (!safeLocalPath || !fs.existsSync(safeLocalPath)) {
        throw new Error("Uploaded file is missing on disk before MongoDB storage.");
      }

      const database = await databasePromise;
      return await database.writeStoredFile({
        localPath: safeLocalPath,
        filename: (file.filename || file.originalname || "upload").toString(),
        originalName: (file.originalname || file.filename || "upload").toString(),
        mimeType: (file.mimetype || "application/octet-stream").toString(),
        folder,
        extension: getFileExtension(file.originalname || file.filename)
      });
    } finally {
      removeTemporaryFile(file);
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

    if (fileEntry.storage === "mongodb" && fileEntry.fileId) {
      const database = await databasePromise;
      await database.deleteStoredFile(fileEntry.fileId);
      return;
    }

    const safeFilename = path.basename((fileEntry.filename || "").toString());
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

  async function sendStoredFile(res, fileEntry, { downloadName } = {}) {
    if (!fileEntry) {
      return res.status(404).send("File not found");
    }

    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");

    if (fileEntry.storage === "mongodb" && fileEntry.fileId) {
      const database = await databasePromise;
      const opened = await database.openStoredFile(fileEntry.fileId);

      if (!opened?.stream) {
        return res.status(404).send("File not found");
      }

      const resolvedName =
        (downloadName || fileEntry.originalName || opened.fileDocument?.filename || "download").toString();
      const contentType =
        (fileEntry.mimeType || opened.fileDocument?.contentType || "application/octet-stream").toString();

      res.type(contentType);
      res.attachment(resolvedName);

      return await new Promise((resolve, reject) => {
        const stream = opened.stream;
        let finished = false;

        function finish(result) {
          if (!finished) {
            finished = true;
            resolve(result);
          }
        }

        stream.on("error", (error) => {
          if (!res.headersSent) {
            finish(res.status(404).send("File not found"));
            return;
          }

          reject(error);
        });

        res.on("finish", () => finish(undefined));
        res.on("close", () => finish(undefined));
        stream.pipe(res);
      });
    }

    const safeFilename = path.basename((fileEntry.filename || "").toString());
    const localPath = path.join(uploadDir, safeFilename);

    if (!safeFilename || !fs.existsSync(localPath)) {
      return res.status(404).send("File not found");
    }

    return res.download(localPath, downloadName || fileEntry.originalName || safeFilename);
  }

  return {
    provider: "mongodb",
    requestedProvider: "mongodb",
    getProviderWarning() {
      return null;
    },
    persistUploadedFile,
    removeStoredFile,
    removeTemporaryFile,
    sendStoredFile,
    createLocalEntry
  };
}

module.exports = {
  createFileStorage,
  createLocalEntry
};
