const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const BACKUP_DIR = path.join(__dirname, "backups");
const MAX_BACKUPS = 10;

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

async function createAutomaticBackup(database) {
  try {
    ensureBackupDir();

    console.log("Generating automatic database backup...");
    const applications = await database.readApplications();
    const settings = await database.readSettings();
    const departmentAdmins = await database.readDepartmentAdmins();

    const backupData = {
      timestamp: new Date().toISOString(),
      version: "1.0",
      settings,
      departmentAdmins,
      applications
    };

    const backupString = JSON.stringify(backupData);
    const compressed = zlib.gzipSync(Buffer.from(backupString));

    const dateStr = new Date().toISOString().replace(/:/g, "-").slice(0, 19);
    const filename = `auto-backup-${dateStr}.json.gz`;
    const filepath = path.join(BACKUP_DIR, filename);

    fs.writeFileSync(filepath, compressed);
    console.log(`Automatic database backup successfully saved to: ${filepath}`);

    await pruneOldBackups();
  } catch (error) {
    console.error("Failed to create automatic database backup:", error);
  }
}

async function pruneOldBackups() {
  try {
    ensureBackupDir();
    const files = fs.readdirSync(BACKUP_DIR)
      .filter((file) => file.startsWith("auto-backup-") && file.endsWith(".json.gz"))
      .map((file) => {
        const filepath = path.join(BACKUP_DIR, file);
        const stats = fs.statSync(filepath);
        return { file, filepath, mtime: stats.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime); // Newest first

    if (files.length > MAX_BACKUPS) {
      const filesToDelete = files.slice(MAX_BACKUPS);
      for (const f of filesToDelete) {
        fs.unlinkSync(f.filepath);
        console.log(`Pruned old backup file: ${f.filepath}`);
      }
    }
  } catch (error) {
    console.error("Failed to prune old database backups:", error);
  }
}

module.exports = {
  createAutomaticBackup,
  pruneOldBackups,
  BACKUP_DIR
};
