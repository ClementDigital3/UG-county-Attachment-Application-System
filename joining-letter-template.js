const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const PAGE_SIZE = [595.28, 841.89];
const PAGE_MARGIN = 52;
const BODY_FONT_SIZE = 11;
const LINE_GAP = 5;

async function embedLogo(pdfDoc, logoPath) {
  if (!logoPath || !fs.existsSync(logoPath)) {
    return null;
  }

  const bytes = fs.readFileSync(logoPath);
  const extension = path.extname(logoPath).toLowerCase();
  return extension === ".png" ? pdfDoc.embedPng(bytes) : pdfDoc.embedJpg(bytes);
}

function formatLetterDate(value, timeZone = "Africa/Nairobi") {
  if (!value) {
    return "";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-KE", {
    timeZone,
    year: "numeric",
    month: "long",
    day: "2-digit"
  }).format(parsed);
}

function sanitizeText(value, fallback = "........................................") {
  const text = (value || "").toString().trim().replace(/\s+/g, " ");
  return text || fallback;
}

function wrapText(text, font, fontSize, maxWidth) {
  const value = (text || "").toString();
  if (!value.trim()) {
    return [""];
  }

  const words = value.split(/\s+/).filter(Boolean);
  const lines = [];
  let currentLine = "";

  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;
    const nextWidth = font.widthOfTextAtSize(nextLine, fontSize);

    if (nextWidth <= maxWidth || !currentLine) {
      currentLine = nextLine;
      continue;
    }

    lines.push(currentLine);
    currentLine = word;
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length ? lines : [""];
}

function drawWrappedText(page, text, {
  x,
  y,
  maxWidth,
  font,
  fontSize = BODY_FONT_SIZE,
  color = rgb(0.1, 0.1, 0.1),
  lineGap = LINE_GAP
}) {
  const lines = wrapText(text, font, fontSize, maxWidth);
  let currentY = y;

  lines.forEach((line) => {
    page.drawText(line, {
      x,
      y: currentY,
      size: fontSize,
      font,
      color
    });
    currentY -= fontSize + lineGap;
  });

  return currentY;
}

function drawLabelValueLine(page, {
  label,
  value,
  x,
  y,
  labelWidth,
  valueWidth,
  fonts,
  fontSize = BODY_FONT_SIZE
}) {
  const safeLabel = sanitizeText(label, "");
  const safeValue = sanitizeText(value);

  page.drawText(safeLabel, {
    x,
    y,
    size: fontSize,
    font: fonts.bold,
    color: rgb(0.08, 0.12, 0.1)
  });

  return drawWrappedText(page, safeValue, {
    x: x + labelWidth,
    y,
    maxWidth: valueWidth,
    font: fonts.regular,
    fontSize,
    color: rgb(0.08, 0.12, 0.1),
    lineGap: 3
  });
}

function drawBulletList(page, items, {
  x,
  y,
  maxWidth,
  fonts
}) {
  let currentY = y;
  const bulletIndent = 14;

  items.forEach((item) => {
    page.drawText("-", {
      x,
      y: currentY,
      size: BODY_FONT_SIZE,
      font: fonts.regular,
      color: rgb(0.1, 0.1, 0.1)
    });

    currentY = drawWrappedText(page, item, {
      x: x + bulletIndent,
      y: currentY,
      maxWidth: maxWidth - bulletIndent,
      font: fonts.regular,
      fontSize: BODY_FONT_SIZE,
      color: rgb(0.1, 0.1, 0.1),
      lineGap: 4
    }) - 2;
  });

  return currentY;
}

async function createJoiningLetterTemplatePdf({
  uploadDir,
  applicant = {},
  generatedAt,
  timeZone = "Africa/Nairobi",
  logoPath,
  countyName = "COUNTY GOVERNMENT OF UASIN GISHU",
  signatoryName = "Ruth Samoei",
  signatoryDesignation = "CHIEF OFFICER",
  signatoryDepartment = "PUBLIC SERVICE MANAGEMENT"
} = {}) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage(PAGE_SIZE);
  const regularFont = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const boldFont = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
  const italicFont = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);
  const fonts = {
    regular: regularFont,
    bold: boldFont,
    italic: italicFont
  };

  const logoImage = await embedLogo(pdfDoc, logoPath);
  const pageWidth = page.getWidth();
  const contentWidth = pageWidth - PAGE_MARGIN * 2;
  const generatedDateLabel = formatLetterDate(generatedAt || new Date().toISOString(), timeZone);
  const requestDateLabel = formatLetterDate(applicant.submittedAt, timeZone) || generatedDateLabel;
  const startDateLabel = formatLetterDate(applicant.startDate, timeZone);
  const endDateLabel = formatLetterDate(applicant.endDate, timeZone);
  const attachmentRange = `${sanitizeText(startDateLabel)} to ${sanitizeText(endDateLabel)}`;
  const applicantName = sanitizeText(applicant.fullName);
  const applicantInstitution = sanitizeText(applicant.institution);
  const applicantCourse = sanitizeText(applicant.course);
  const applicantDepartment = sanitizeText(applicant.appliedDepartmentLabel || applicant.appliedDepartment);
  const applicantIdNumber = sanitizeText(applicant.idNumber);
  const referenceNumber = `UGC/PSM/HR/T&D/${sanitizeText(applicant.placementNumber || applicant.id, "ATT")}`;
  const declarationSentence = `I ${applicantName} ID/No ${applicantIdNumber} hereby declare that I have read and understood the conditions set out in this letter dated ${generatedDateLabel} and hereby agree to abide by the conditions.`;

  let currentY = page.getHeight() - PAGE_MARGIN;

  if (logoImage) {
    const logo = logoImage.scaleToFit(62, 62);
    page.drawImage(logoImage, {
      x: PAGE_MARGIN,
      y: currentY - logo.height + 8,
      width: logo.width,
      height: logo.height
    });
  }

  page.drawText("REPUBLIC OF KENYA", {
    x: PAGE_MARGIN + 86,
    y: currentY - 8,
    size: 14,
    font: boldFont,
    color: rgb(0, 0, 0)
  });
  page.drawText(countyName, {
    x: PAGE_MARGIN + 46,
    y: currentY - 28,
    size: 15,
    font: boldFont,
    color: rgb(0, 0, 0)
  });

  currentY -= 76;

  page.drawText("PUBLIC SERVICE MANAGEMENT", {
    x: PAGE_MARGIN,
    y: currentY,
    size: 13,
    font: boldFont,
    color: rgb(0, 0, 0)
  });

  currentY -= 30;

  page.drawText(`OUR REF: ${referenceNumber}`, {
    x: PAGE_MARGIN,
    y: currentY,
    size: BODY_FONT_SIZE,
    font: boldFont,
    color: rgb(0, 0, 0)
  });
  page.drawText(`DATE: ${generatedDateLabel}`, {
    x: PAGE_MARGIN + 290,
    y: currentY,
    size: BODY_FONT_SIZE,
    font: boldFont,
    color: rgb(0, 0, 0)
  });

  currentY -= 28;

  currentY = drawLabelValueLine(page, {
    label: "NAME:",
    value: applicantName,
    x: PAGE_MARGIN,
    y: currentY,
    labelWidth: 84,
    valueWidth: contentWidth - 84,
    fonts
  }) - 8;

  currentY = drawLabelValueLine(page, {
    label: "INSTITUTION:",
    value: applicantInstitution,
    x: PAGE_MARGIN,
    y: currentY,
    labelWidth: 84,
    valueWidth: contentWidth - 84,
    fonts
  }) - 8;

  currentY = drawLabelValueLine(page, {
    label: "COURSE:",
    value: applicantCourse,
    x: PAGE_MARGIN,
    y: currentY,
    labelWidth: 84,
    valueWidth: contentWidth - 84,
    fonts
  }) - 18;

  page.drawText("RE: REQUEST FOR ATTACHMENT", {
    x: PAGE_MARGIN,
    y: currentY,
    size: 12,
    font: boldFont,
    color: rgb(0, 0, 0)
  });

  currentY -= 26;

  currentY = drawWrappedText(
    page,
    `Reference is made to your letter dated ${requestDateLabel} on the above subject.`,
    {
      x: PAGE_MARGIN,
      y: currentY,
      maxWidth: contentWidth,
      font: regularFont
    }
  ) - 10;

  currentY = drawWrappedText(
    page,
    `This is to inform you that your request to be attached at the County Government of Uasin Gishu has been approved. Subsequently, you will be attached to the Department of ${applicantDepartment} with effect from ${attachmentRange} subject to the following conditions:-`,
    {
      x: PAGE_MARGIN,
      y: currentY,
      maxWidth: contentWidth,
      font: regularFont
    }
  ) - 8;

  currentY = drawBulletList(page, [
    "You must have general personal accident insurance cover for the period of the attachment.",
    "This is not an offer for employment and the County Government will not pay you any remuneration for the duties performed.",
    "The County will not be held liable for any injury during the attachment period.",
    "You will adhere to all County regulations and maintain high discipline.",
    "You will arrange for your own accommodation.",
    "You will be required to dress officially while performing County duties."
  ], {
    x: PAGE_MARGIN,
    y: currentY,
    maxWidth: contentWidth,
    fonts
  }) - 8;

  currentY = drawWrappedText(
    page,
    "If you accept these conditions, please signify your acceptance of the conditions set out in this offer by signing the declaration of acceptance. Retain the original letter and return the duplicate on the reporting date.",
    {
      x: PAGE_MARGIN,
      y: currentY,
      maxWidth: contentWidth,
      font: regularFont
    }
  ) - 34;

  page.drawLine({
    start: { x: PAGE_MARGIN, y: currentY + 18 },
    end: { x: PAGE_MARGIN + 190, y: currentY + 18 },
    thickness: 0.6,
    color: rgb(0, 0, 0)
  });
  page.drawText(signatoryName, {
    x: PAGE_MARGIN,
    y: currentY,
    size: BODY_FONT_SIZE,
    font: regularFont,
    color: rgb(0, 0, 0)
  });
  page.drawText(signatoryDesignation, {
    x: PAGE_MARGIN,
    y: currentY - 16,
    size: BODY_FONT_SIZE,
    font: boldFont,
    color: rgb(0, 0, 0)
  });
  page.drawText(signatoryDepartment, {
    x: PAGE_MARGIN,
    y: currentY - 32,
    size: BODY_FONT_SIZE,
    font: boldFont,
    color: rgb(0, 0, 0)
  });

  currentY -= 92;

  page.drawText("DECLARATION OF ACCEPTANCE", {
    x: PAGE_MARGIN,
    y: currentY,
    size: 12,
    font: boldFont,
    color: rgb(0, 0, 0)
  });

  currentY -= 24;

  currentY = drawWrappedText(page, declarationSentence, {
    x: PAGE_MARGIN,
    y: currentY,
    maxWidth: contentWidth,
    font: regularFont
  }) - 18;

  page.drawText("Signature: ........................................", {
    x: PAGE_MARGIN,
    y: currentY,
    size: BODY_FONT_SIZE,
    font: regularFont,
    color: rgb(0, 0, 0)
  });
  page.drawText("Date: ........................................", {
    x: PAGE_MARGIN + 280,
    y: currentY,
    size: BODY_FONT_SIZE,
    font: regularFont,
    color: rgb(0, 0, 0)
  });

  currentY -= 34;

  page.drawText("System-generated county attachment joining letter.", {
    x: PAGE_MARGIN,
    y: currentY,
    size: 9,
    font: italicFont,
    color: rgb(0.25, 0.25, 0.25)
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
