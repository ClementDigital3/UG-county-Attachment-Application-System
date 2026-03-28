const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

async function embedLogo(pdfDoc, logoPath) {
  if (!logoPath || !fs.existsSync(logoPath)) {
    return null;
  }

  const bytes = fs.readFileSync(logoPath);
  const extension = path.extname(logoPath).toLowerCase();

  if (extension === ".png") {
    return pdfDoc.embedPng(bytes);
  }

  return pdfDoc.embedJpg(bytes);
}

function drawField(page, label, value, x, y, width, fonts) {
  page.drawText(label, {
    x,
    y,
    size: 10,
    font: fonts.bold,
    color: rgb(0.16, 0.2, 0.18)
  });

  page.drawRectangle({
    x,
    y: y - 18,
    width,
    height: 18,
    color: rgb(0.986, 0.992, 0.988),
    borderColor: rgb(0.7, 0.78, 0.73),
    borderWidth: 0.8
  });

  page.drawText((value || "Pending").toString(), {
    x: x + 6,
    y: y - 13,
    size: 10,
    font: fonts.regular,
    color: rgb(0.08, 0.16, 0.12)
  });
}

async function createJoiningLetterTemplatePdf({
  uploadDir,
  applicant = {},
  generatedAt,
  timeZone = "Africa/Nairobi",
  logoPath,
  countyName = "County Government of Uasin Gishu",
  signatoryName = "Director, Human Resource Management",
  signatoryDesignation = "Authorized County HR Signatory"
} = {}) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]);
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const logoImage = await embedLogo(pdfDoc, logoPath);
  const fonts = { regular: regularFont, bold: boldFont };

  page.drawRectangle({
    x: 28,
    y: 28,
    width: page.getWidth() - 56,
    height: page.getHeight() - 56,
    borderColor: rgb(0.12, 0.39, 0.2),
    borderWidth: 1.5
  });

  page.drawRectangle({
    x: 28,
    y: page.getHeight() - 120,
    width: page.getWidth() - 56,
    height: 92,
    color: rgb(0.96, 0.985, 0.968)
  });

  if (logoImage) {
    const scaled = logoImage.scaleToFit(58, 58);
    page.drawImage(logoImage, {
      x: 44,
      y: page.getHeight() - 98,
      width: scaled.width,
      height: scaled.height
    });
  }

  page.drawText(countyName, {
    x: 114,
    y: page.getHeight() - 62,
    size: 18,
    font: boldFont,
    color: rgb(0.11, 0.34, 0.19)
  });
  page.drawText("Official Attachment Joining Letter", {
    x: 114,
    y: page.getHeight() - 84,
    size: 13,
    font: boldFont,
    color: rgb(0.41, 0.3, 0.08)
  });

  const dateLabel = new Intl.DateTimeFormat("en-KE", {
    timeZone,
    year: "numeric",
    month: "long",
    day: "2-digit"
  }).format(generatedAt ? new Date(generatedAt) : new Date());

  page.drawText(`Generated: ${dateLabel}`, {
    x: 44,
    y: page.getHeight() - 142,
    size: 10,
    font: regularFont,
    color: rgb(0.25, 0.28, 0.26)
  });

  page.drawText("Applicant Details", {
    x: 44,
    y: page.getHeight() - 182,
    size: 13,
    font: boldFont,
    color: rgb(0.11, 0.34, 0.19)
  });

  drawField(page, "Full Name", applicant.fullName, 44, page.getHeight() - 210, 240, fonts);
  drawField(page, "Tracking Number", applicant.placementNumber || applicant.id, 302, page.getHeight() - 210, 248, fonts);
  drawField(page, "ID Number", applicant.idNumber, 44, page.getHeight() - 252, 160, fonts);
  drawField(page, "Email Address", applicant.email, 220, page.getHeight() - 252, 330, fonts);
  drawField(page, "Phone Number", applicant.phone, 44, page.getHeight() - 294, 160, fonts);
  drawField(page, "Institution", applicant.institution, 220, page.getHeight() - 294, 330, fonts);
  drawField(page, "Course / Programme", applicant.course, 44, page.getHeight() - 336, 240, fonts);
  drawField(page, "Department", applicant.appliedDepartmentLabel || applicant.appliedDepartment, 302, page.getHeight() - 336, 248, fonts);
  drawField(page, "Attachment Period", applicant.periodLabel || applicant.period, 44, page.getHeight() - 378, 160, fonts);
  drawField(page, "Requested Dates", applicant.requestedDates, 220, page.getHeight() - 378, 330, fonts);

  page.drawText("Joining Letter Body", {
    x: 44,
    y: page.getHeight() - 430,
    size: 13,
    font: boldFont,
    color: rgb(0.11, 0.34, 0.19)
  });

  const recipientName = (applicant.fullName || "Attachment Applicant").toString();
  const departmentLabel = (applicant.appliedDepartmentLabel || applicant.appliedDepartment || "the assigned department").toString();
  const periodLabel = (applicant.periodLabel || applicant.period || "the approved attachment period").toString();
  const requestedDates = (applicant.requestedDates || "the scheduled attachment dates").toString();
  const bodyLines = [
    `To: ${recipientName}`,
    "",
    "RE: COUNTY ATTACHMENT ADMISSION",
    "",
    `You have been admitted for attachment placement with the County Government of Uasin Gishu in ${departmentLabel}.`,
    `Your placement period is ${periodLabel}, covering ${requestedDates}.`,
    "Report on the date communicated by HR together with all required supporting documents,",
    "including the stamped NITA form and valid student identification documents.",
    "",
    "This letter is system-generated for official county attachment processing and student download."
  ];

  let currentY = page.getHeight() - 456;
  bodyLines.forEach((line) => {
    page.drawText(line, {
      x: 44,
      y: currentY,
      size: 11,
      font: line.includes("RE:") ? boldFont : regularFont,
      color: rgb(0.14, 0.18, 0.16)
    });
    currentY -= 18;
  });

  page.drawLine({
    start: { x: 44, y: 168 },
    end: { x: 264, y: 168 },
    thickness: 0.9,
    color: rgb(0.35, 0.41, 0.38)
  });
  page.drawText(signatoryName, {
    x: 44,
    y: 150,
    size: 11,
    font: boldFont,
    color: rgb(0.08, 0.16, 0.12)
  });
  page.drawText(signatoryDesignation, {
    x: 44,
    y: 134,
    size: 10,
    font: regularFont,
    color: rgb(0.28, 0.33, 0.31)
  });

  page.drawText("System-generated HR template. Review before release.", {
    x: 44,
    y: 74,
    size: 9,
    font: regularFont,
    color: rgb(0.42, 0.32, 0.1)
  });

  page.drawText("System-generated and published through the county attachment portal.", {
    x: 44,
    y: 60,
    size: 9,
    font: regularFont,
    color: rgb(0.42, 0.32, 0.1)
  });

  const finalBytes = await pdfDoc.save();
  const outputName = `${Date.now()}-${crypto.randomUUID()}-joining-letter.pdf`;
  const outputPath = path.join(uploadDir, outputName);
  fs.writeFileSync(outputPath, finalBytes);

  return {
    path: outputPath,
    filename: outputName,
    originalname: `Joining-Letter-${applicant.placementNumber || applicant.id || "application"}.pdf`,
    mimetype: "application/pdf",
    size: finalBytes.length
  };
}

module.exports = {
  createJoiningLetterTemplatePdf
};
