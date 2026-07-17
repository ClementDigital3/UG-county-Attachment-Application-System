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
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  return isPng ? pdfDoc.embedPng(bytes) : pdfDoc.embedJpg(bytes);
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

function drawCenteredText(page, text, {
  centerX,
  y,
  font,
  fontSize = BODY_FONT_SIZE,
  color = rgb(0, 0, 0)
}) {
  const value = (text || "").toString();
  const width = font.widthOfTextAtSize(value, fontSize);
  const x = centerX - width / 2;
  page.drawText(value, {
    x,
    y,
    size: fontSize,
    font,
    color
  });
  return y - fontSize;
}

function drawInlineFieldLine(page, label, value, x, y, labelWidth, contentWidth, fonts) {
  page.drawText(label, {
    x,
    y,
    size: 10,
    font: fonts.bold,
    color: rgb(0, 0, 0)
  });

  const lineStartX = x + labelWidth;
  const lineEndX = x + contentWidth;
  page.drawLine({
    start: { x: lineStartX, y: y - 2 },
    end: { x: lineEndX, y: y - 2 },
    thickness: 0.5,
    color: rgb(0, 0, 0)
  });

  page.drawText(value, {
    x: lineStartX + 5,
    y: y + 1,
    size: 10,
    font: fonts.regular,
    color: rgb(0.1, 0.1, 0.1)
  });

  return y - 18;
}

function drawArrowBullet(page, x, y, color = rgb(0, 0, 0)) {
  page.drawLine({
    start: { x: x, y: y + 2 },
    end: { x: x + 4, y: y + 5 },
    thickness: 1.0,
    color
  });
  page.drawLine({
    start: { x: x + 4, y: y + 5 },
    end: { x: x, y: y + 8 },
    thickness: 1.0,
    color
  });
}

async function createJoiningLetterTemplatePdf({
  uploadDir,
  applicant = {},
  generatedAt,
  timeZone = "Africa/Nairobi",
  logoPath,
  signaturePath,
  countyName = "COUNTY GOVERNMENT OF UASIN GISHU",
  signatoryName = "Josephat K Rotich",
  signatoryDesignation = "DIRECTOR, PERFORMANCE MANAGEMENT,",
  signatoryDepartment = "TRAINING & DEVELOPMENT"
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
  const signatureImage = await embedLogo(pdfDoc, signaturePath);
  const pageWidth = page.getWidth();
  const contentWidth = pageWidth - PAGE_MARGIN * 2;
  const generatedDateLabel = formatLetterDate(generatedAt || new Date().toISOString(), timeZone);
  const requestDateLabel = formatLetterDate(applicant.submittedAt, timeZone) || generatedDateLabel;
  const startDateLabel = formatLetterDate(applicant.startDate, timeZone);
  const endDateLabel = formatLetterDate(applicant.endDate, timeZone);
  const applicantName = sanitizeText(applicant.fullName);
  const applicantInstitution = sanitizeText(applicant.institution);
  const applicantCourse = sanitizeText(applicant.course);
  const applicantDepartment = sanitizeText(applicant.appliedDepartmentLabel || applicant.appliedDepartment);
  const referenceNumber = `UGC/PSM/HR/T&D`;
  const headerCenterX = pageWidth / 2;

  let currentY = page.getHeight() - PAGE_MARGIN;

  // 1. Center Title Header
  drawCenteredText(page, "REPUBLIC OF KENYA", {
    centerX: headerCenterX,
    y: currentY,
    font: boldFont,
    fontSize: 12
  });
  
  drawCenteredText(page, countyName, {
    centerX: headerCenterX,
    y: currentY - 18,
    font: boldFont,
    fontSize: 14
  });

  currentY -= 32;

  // 2. Logo & Address Columns
  const addressYStart = currentY;
  const addressFontSize = 8.5;
  const addressLineGap = 11;

  // Draw Left Address
  const leftAddressLines = [
    "County Headquarters – Town Hall Offices",
    "P.O. Box 40-30100",
    "ELDORET-Kenya",
    "Website: www.uasingishu.go.ke"
  ];
  let leftY = addressYStart;
  leftAddressLines.forEach((line) => {
    page.drawText(line, {
      x: PAGE_MARGIN,
      y: leftY,
      size: addressFontSize,
      font: regularFont,
      color: rgb(0.1, 0.1, 0.1)
    });
    leftY -= addressLineGap;
  });

  // Draw Right Address
  const rightAddressLines = [
    "When Replying, Please Address to:",
    "County Human Resources Manager",
    "Tel. +254-053-2016306",
    "Email: countyhrm@uasingishu.go.ke"
  ];
  let rightY = addressYStart;
  rightAddressLines.forEach((line) => {
    if (line) {
      page.drawText(line, {
        x: pageWidth - PAGE_MARGIN - 170,
        y: rightY,
        size: addressFontSize,
        font: regularFont,
        color: rgb(0.1, 0.1, 0.1)
      });
    }
    rightY -= addressLineGap;
  });

  // Draw Center Logo
  if (logoImage) {
    const logoSize = 64;
    page.drawImage(logoImage, {
      x: headerCenterX - logoSize / 2,
      y: addressYStart - logoSize + 12,
      width: logoSize,
      height: logoSize
    });
  }

  currentY = Math.min(leftY, rightY) - 14;

  // 3. Public Service Management Sub-Header
  drawCenteredText(page, "PUBLIC SERVICE MANAGEMENT", {
    centerX: headerCenterX,
    y: currentY,
    font: boldFont,
    fontSize: 11
  });

  currentY -= 8;

  // 4. Horizontal Dividers (Thick & Thin)
  page.drawLine({
    start: { x: PAGE_MARGIN, y: currentY },
    end: { x: pageWidth - PAGE_MARGIN, y: currentY },
    thickness: 1.5,
    color: rgb(0, 0, 0)
  });
  page.drawLine({
    start: { x: PAGE_MARGIN, y: currentY - 2.5 },
    end: { x: pageWidth - PAGE_MARGIN, y: currentY - 2.5 },
    thickness: 0.5,
    color: rgb(0, 0, 0)
  });

  currentY -= 16;

  // 5. Ref and Date Labels
  page.drawText(`OUR REF: ${referenceNumber}`, {
    x: PAGE_MARGIN,
    y: currentY,
    size: 10,
    font: boldFont,
    color: rgb(0, 0, 0)
  });

  const dateStr = generatedDateLabel.toUpperCase();
  page.drawText(`DATE: ${dateStr}`, {
    x: pageWidth - PAGE_MARGIN - 140,
    y: currentY,
    size: 10,
    font: boldFont,
    color: rgb(0, 0, 0)
  });

  currentY -= 24;

  // 6. Name, Institution, Course
  currentY = drawInlineFieldLine(page, "NAME:", applicantName, PAGE_MARGIN, currentY, 45, contentWidth, fonts);
  currentY = drawInlineFieldLine(page, "INSTITUTION:", applicantInstitution, PAGE_MARGIN, currentY, 84, contentWidth, fonts);
  currentY = drawInlineFieldLine(page, "COURSE:", applicantCourse, PAGE_MARGIN, currentY, 55, contentWidth, fonts);

  currentY -= 10;

  // 7. Subject Line
  page.drawText("RE: REQUEST FOR ATTACHMENT", {
    x: PAGE_MARGIN,
    y: currentY,
    size: 10.5,
    font: boldFont,
    color: rgb(0, 0, 0)
  });
  const subjectWidth = boldFont.widthOfTextAtSize("RE: REQUEST FOR ATTACHMENT", 10.5);
  page.drawLine({
    start: { x: PAGE_MARGIN, y: currentY - 2 },
    end: { x: PAGE_MARGIN + subjectWidth, y: currentY - 2 },
    thickness: 0.8,
    color: rgb(0, 0, 0)
  });

  currentY -= 20;

  // 8. Reference Sentence
  const textPart1 = "Reference is made to your letter dated ";
  const textPart2 = `  ${requestDateLabel}  `;
  const textPart3 = " on the above subject.";

  const w1 = regularFont.widthOfTextAtSize(textPart1, 10);
  const w2 = regularFont.widthOfTextAtSize(textPart2, 10);
  const w3 = regularFont.widthOfTextAtSize(textPart3, 10);

  page.drawText(textPart1, { x: PAGE_MARGIN, y: currentY, size: 10, font: regularFont });
  page.drawLine({
    start: { x: PAGE_MARGIN + w1, y: currentY - 2 },
    end: { x: PAGE_MARGIN + w1 + w2, y: currentY - 2 },
    thickness: 0.5,
    color: rgb(0, 0, 0)
  });
  page.drawText(textPart2, { x: PAGE_MARGIN + w1, y: currentY, size: 10, font: regularFont });
  page.drawText(textPart3, { x: PAGE_MARGIN + w1 + w2, y: currentY, size: 10, font: regularFont });

  currentY -= 18;

  // 9. Main Body Paragraph
  page.drawText("This is to inform you that your request to be attached at the County Government of Uasin Gishu has been", {
    x: PAGE_MARGIN,
    y: currentY,
    size: 10,
    font: regularFont,
    color: rgb(0.1, 0.1, 0.1)
  });
  currentY -= 15;

  const line2Start = "approved. Subsequently, you will be attached to the Department of ";
  const wLine2Start = regularFont.widthOfTextAtSize(line2Start, 10);
  page.drawText(line2Start, { x: PAGE_MARGIN, y: currentY, size: 10, font: regularFont });
  
  const deptStartX = PAGE_MARGIN + wLine2Start;
  const deptEndX = pageWidth - PAGE_MARGIN;
  page.drawLine({
    start: { x: deptStartX, y: currentY - 2 },
    end: { x: deptEndX, y: currentY - 2 },
    thickness: 0.5,
    color: rgb(0, 0, 0)
  });
  page.drawText(applicantDepartment, { x: deptStartX + 5, y: currentY, size: 10, font: regularFont });

  currentY -= 15;

  const part3_1 = "with effect from ";
  const part3_2 = `  ${startDateLabel}  `;
  const part3_3 = " to ";
  const part3_4 = `  ${endDateLabel}  `;
  const part3_5 = " subject to the following conditions:-";

  const w3_1 = regularFont.widthOfTextAtSize(part3_1, 10);
  const w3_2 = regularFont.widthOfTextAtSize(part3_2, 10);
  const w3_3 = regularFont.widthOfTextAtSize(part3_3, 10);
  const w3_4 = regularFont.widthOfTextAtSize(part3_4, 10);

  page.drawText(part3_1, { x: PAGE_MARGIN, y: currentY, size: 10, font: regularFont });
  page.drawLine({
    start: { x: PAGE_MARGIN + w3_1, y: currentY - 2 },
    end: { x: PAGE_MARGIN + w3_1 + w3_2, y: currentY - 2 },
    thickness: 0.5,
    color: rgb(0, 0, 0)
  });
  page.drawText(part3_2, { x: PAGE_MARGIN + w3_1, y: currentY, size: 10, font: regularFont });
  page.drawText(part3_3, { x: PAGE_MARGIN + w3_1 + w3_2, y: currentY, size: 10, font: regularFont });
  page.drawLine({
    start: { x: PAGE_MARGIN + w3_1 + w3_2 + w3_3, y: currentY - 2 },
    end: { x: PAGE_MARGIN + w3_1 + w3_2 + w3_3 + w3_4, y: currentY - 2 },
    thickness: 0.5,
    color: rgb(0, 0, 0)
  });
  page.drawText(part3_4, { x: PAGE_MARGIN + w3_1 + w3_2 + w3_3, y: currentY, size: 10, font: regularFont });
  page.drawText(part3_5, { x: PAGE_MARGIN + w3_1 + w3_2 + w3_3 + w3_4, y: currentY, size: 10, font: regularFont });

  currentY -= 20;

  // 10. Conditions List
  const conditions = [
    "You must have general personal accident insurance cover for the period of the attachment.",
    "This is not an offer for employment & the County Government will not pay you any remuneration for the duties performed.",
    "The County will not be held liable for any injury during attachment period.",
    "You will adhere to all County regulations and maintain high discipline.",
    "You will arrange for your own accommodation.",
    "You will be required to dress officially while performing County duties."
  ];

  conditions.forEach((cond) => {
    drawArrowBullet(page, PAGE_MARGIN + 6, currentY);
    currentY = drawWrappedText(page, cond, {
      x: PAGE_MARGIN + 22,
      y: currentY,
      maxWidth: contentWidth - 22,
      font: regularFont,
      fontSize: 10,
      lineGap: 3
    }) - 2;
  });

  currentY -= 10;

  // 11. Signature Paragraph
  currentY = drawWrappedText(page, "If you accept these conditions, please signify your acceptance of the conditions set out in this offer by signing the declaration of acceptance. Retain the original letter and return the duplicate on the reporting date.", {
    x: PAGE_MARGIN,
    y: currentY,
    maxWidth: contentWidth,
    font: regularFont,
    fontSize: 10,
    lineGap: 3
  }) - 20;

  // 12. Ink Signature Graphic
  if (signatureImage) {
    const sig = signatureImage.scaleToFit(110, 45);
    page.drawImage(signatureImage, {
      x: PAGE_MARGIN + 10,
      y: currentY + 12,
      width: sig.width,
      height: sig.height
    });
  } else {
    page.drawLine({
      start: { x: PAGE_MARGIN + 2, y: currentY + 16 },
      end: { x: PAGE_MARGIN + 100, y: currentY + 16 },
      thickness: 0.8,
      color: rgb(0, 0, 0)
    });
  }

  // Signatory details
  page.drawText(signatoryName, {
    x: PAGE_MARGIN,
    y: currentY,
    size: 10,
    font: regularFont,
    color: rgb(0, 0, 0)
  });
  page.drawText(signatoryDesignation, {
    x: PAGE_MARGIN,
    y: currentY - 14,
    size: 10,
    font: boldFont,
    color: rgb(0, 0, 0)
  });
  page.drawText(signatoryDepartment, {
    x: PAGE_MARGIN,
    y: currentY - 28,
    size: 10,
    font: boldFont,
    color: rgb(0, 0, 0)
  });

  currentY -= 54;

  // 13. Declaration section
  page.drawText("DECLARATION OF ACCEPTANCE", {
    x: PAGE_MARGIN,
    y: currentY,
    size: 11,
    font: boldFont,
    color: rgb(0, 0, 0)
  });
  
  currentY -= 16;

  const decLine1 = "I ..............................................................ID/No...............................................Hereby declare that, I have read";
  const decLine2 = `and understood the conditions set out in this letter dated ${generatedDateLabel} and hereby agree to abide by the`;
  const decLine3 = "conditions.";
  const decLine4 = "Signature:............................................................Date:........................................";

  page.drawText(decLine1, { x: PAGE_MARGIN, y: currentY, size: 10, font: regularFont });
  currentY -= 14;
  page.drawText(decLine2, { x: PAGE_MARGIN, y: currentY, size: 10, font: regularFont });
  currentY -= 14;
  page.drawText(decLine3, { x: PAGE_MARGIN, y: currentY, size: 10, font: regularFont });
  currentY -= 20;
  page.drawText(decLine4, { x: PAGE_MARGIN, y: currentY, size: 10, font: regularFont });

  currentY -= 28;

  // CC line
  page.drawText("CC; Chief Officer:________________________________________", {
    x: PAGE_MARGIN,
    y: currentY,
    size: 10,
    font: regularFont,
    color: rgb(0.1, 0.1, 0.1)
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
