const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const NITA_TEMPLATE_PAGE_SIZE = {
  width: 792,
  height: 612
};

const NITA_TEMPLATE_PART_C_ANCHORS = {
  pageIndex: 1,
  providerName: { x: 401.09, y: 571.2 },
  postal: { x: 401.09, y: 544.9 },
  physical: { x: 401.09, y: 518.62 },
  telephone: { x: 401.09, y: 492.22 },
  officer: { x: 401.09, y: 465.22 },
  signedBy: { x: 401.09, y: 438.94 },
  signedAndStamped: { x: 401.09, y: 401.35 }
};

function formatStampDate(dateValue, timeZone = "Africa/Nairobi") {
  const safeDate = dateValue ? new Date(dateValue) : new Date();
  if (Number.isNaN(safeDate.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-KE", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(safeDate);
}

function formatShortStampDate(dateValue, timeZone = "Africa/Nairobi") {
  const safeDate = dateValue ? new Date(dateValue) : new Date();
  if (Number.isNaN(safeDate.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-KE", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "2-digit"
  }).format(safeDate);
}

function getSourceExtension(file) {
  return path.extname((file?.originalname || file?.filename || "").toString()).toLowerCase();
}

function clampLine(text, maxLength = 64) {
  const normalized = (text || "").toString().replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }

  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1).trim()}...`;
}

function buildCountyPartCDetails(details = {}) {
  const providerName = clampLine(
    details.providerName || "County Government of Uasin Gishu",
    44
  );
  const postalAddress = clampLine(details.postalAddress || "P.O. Box 40", 18);
  const postalCode = clampLine(details.postalCode || "30100", 8);
  const town = clampLine(details.town || "Eldoret", 14);
  const physicalAddress = clampLine(details.physicalAddress || "County Headquarters", 20);
  const region = clampLine(details.region || "Uasin Gishu", 14);
  const telephone = clampLine(details.telephone || "05320160000", 16);
  const email = clampLine(details.email || "info@uasingishu.go.ke", 28);
  const fax = clampLine(details.fax || "N/A", 10);
  const officerInCharge = clampLine(
    details.officerInCharge || "Director, Human Resource Management",
    36
  );
  const officerTelephone = clampLine(
    details.officerTelephone || telephone,
    16
  );
  const signatoryName = clampLine(
    details.signatoryName || officerInCharge,
    32
  );
  const designation = clampLine(
    details.designation || "Authorized County HR Signatory",
    28
  );

  return {
    providerName,
    postalAddress,
    postalCode,
    town,
    physicalAddress,
    region,
    telephone,
    email,
    fax,
    officerInCharge,
    officerTelephone,
    signatoryName,
    designation
  };
}

function scaleAnchorPoint(point, pageWidth, pageHeight) {
  return {
    x: (point.x / NITA_TEMPLATE_PAGE_SIZE.width) * pageWidth,
    y: (point.y / NITA_TEMPLATE_PAGE_SIZE.height) * pageHeight
  };
}

async function embedLogo(pdfDoc, logoPath) {
  if (!logoPath || !fs.existsSync(logoPath)) {
    return null;
  }

  const logoBytes = fs.readFileSync(logoPath);
  const extension = path.extname(logoPath).toLowerCase();

  if (extension === ".png") {
    return pdfDoc.embedPng(logoBytes);
  }

  return pdfDoc.embedJpg(logoBytes);
}

function drawGenericStampBlock(page, {
  fonts,
  logoImage,
  applicantName,
  placementNumber,
  stampDate
}) {
  const { width } = page.getSize();
  const stampWidth = Math.min(220, Math.max(180, width * 0.34));
  const stampHeight = 92;
  const x = Math.max(18, width - stampWidth - 18);
  const y = 20;

  page.drawRectangle({
    x,
    y,
    width: stampWidth,
    height: stampHeight,
    color: rgb(0.96, 0.985, 0.965),
    borderColor: rgb(0.15, 0.43, 0.24),
    borderWidth: 1.2,
    opacity: 0.94
  });

  page.drawRectangle({
    x,
    y: y + stampHeight - 17,
    width: stampWidth,
    height: 17,
    color: rgb(0.13, 0.42, 0.23)
  });

  page.drawText("COUNTY ENDORSEMENT", {
    x: x + 10,
    y: y + stampHeight - 13,
    size: 9.5,
    font: fonts.bold,
    color: rgb(1, 1, 1)
  });

  if (logoImage) {
    const scaled = logoImage.scaleToFit(26, 26);
    page.drawImage(logoImage, {
      x: x + 10,
      y: y + stampHeight - 46,
      width: scaled.width,
      height: scaled.height
    });
  }

  const textStartX = x + (logoImage ? 42 : 10);
  page.drawText("Uasin Gishu County HR", {
    x: textStartX,
    y: y + stampHeight - 31,
    size: 8.3,
    font: fonts.bold,
    color: rgb(0.08, 0.18, 0.12)
  });

  page.drawText("Auto-generated for NITA follow-up", {
    x: textStartX,
    y: y + stampHeight - 43,
    size: 7.2,
    font: fonts.regular,
    color: rgb(0.21, 0.29, 0.25)
  });

  const applicantLine = applicantName
    ? `Applicant: ${applicantName}`.slice(0, 38)
    : "Applicant: County attachment student";
  const trackingLine = placementNumber
    ? `Tracking: ${placementNumber}`.slice(0, 38)
    : "Tracking: Pending";

  page.drawText(applicantLine, {
    x: x + 10,
    y: y + 28,
    size: 7.2,
    font: fonts.regular,
    color: rgb(0.18, 0.22, 0.19)
  });
  page.drawText(trackingLine, {
    x: x + 10,
    y: y + 17,
    size: 7.2,
    font: fonts.regular,
    color: rgb(0.18, 0.22, 0.19)
  });
  page.drawText(`Stamped: ${stampDate}`.slice(0, 40), {
    x: x + 10,
    y: y + 6,
    size: 7.2,
    font: fonts.regular,
    color: rgb(0.18, 0.22, 0.19)
  });
}

function drawFieldEntry(page, {
  x,
  y,
  text,
  font,
  size = 8.1,
  color = rgb(0.08, 0.18, 0.12)
}) {
  if (!text) {
    return;
  }

  page.drawText(text, {
    x,
    y,
    size,
    font,
    color
  });
}

function drawPartCSignatureStamp(page, {
  x,
  y,
  width,
  height,
  fonts,
  logoImage,
  stampDateShort
}) {
  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: rgb(1, 1, 1),
    borderColor: rgb(0.15, 0.43, 0.24),
    borderWidth: 0.8,
    opacity: 0.9
  });

  const logoInset = logoImage ? 10 : 0;

  if (logoImage) {
    const scaled = logoImage.scaleToFit(11.5, 11.5);
    page.drawImage(logoImage, {
      x: x + 4,
      y: y + 3.5,
      width: scaled.width,
      height: scaled.height
    });
  }

  const textX = x + 4 + logoInset;
  page.drawText("UG COUNTY HR", {
    x: textX,
    y: y + height - 7.5,
    size: 5.7,
    font: fonts.bold,
    color: rgb(0.08, 0.18, 0.12)
  });
  page.drawText("ENDORSED", {
    x: textX,
    y: y + 4,
    size: 5.2,
    font: fonts.bold,
    color: rgb(0.14, 0.36, 0.22)
  });
  page.drawText(stampDateShort || "", {
    x: x + width - 31,
    y: y + 4,
    size: 4.9,
    font: fonts.regular,
    color: rgb(0.24, 0.31, 0.28)
  });
}

function drawPartCOverlay(page, {
  fonts,
  logoImage,
  anchors,
  pageSize,
  countyDetails,
  placementNumber,
  stampDate,
  stampDateShort
}) {
  const provider = anchors.providerName;
  const postal = anchors.postal;
  const physical = anchors.physical;
  const telephone = anchors.telephone;
  const officer = anchors.officer;
  const signedBy = anchors.signedBy;
  const signedAndStamped = anchors.signedAndStamped;
  const scaleX = pageSize.width / NITA_TEMPLATE_PAGE_SIZE.width;
  const scaleY = pageSize.height / NITA_TEMPLATE_PAGE_SIZE.height;
  const fontColor = rgb(0.07, 0.39, 0.2);
  const mutedColor = rgb(0.48, 0.35, 0.08);

  drawFieldEntry(page, {
    x: provider.x + (134 * scaleX),
    y: provider.y + (1.5 * scaleY),
    text: countyDetails.providerName,
    font: fonts.bold,
    size: 8.2 * scaleY,
    color: fontColor
  });

  drawFieldEntry(page, {
    x: postal.x + (86 * scaleX),
    y: postal.y + (1.5 * scaleY),
    text: countyDetails.postalAddress,
    font: fonts.regular,
    size: 7.4 * scaleY,
    color: fontColor
  });
  drawFieldEntry(page, {
    x: postal.x + (190 * scaleX),
    y: postal.y + (1.5 * scaleY),
    text: countyDetails.postalCode,
    font: fonts.regular,
    size: 7.2 * scaleY,
    color: fontColor
  });
  drawFieldEntry(page, {
    x: postal.x + (264 * scaleX),
    y: postal.y + (1.5 * scaleY),
    text: countyDetails.town,
    font: fonts.regular,
    size: 7.4 * scaleY,
    color: fontColor
  });

  drawFieldEntry(page, {
    x: physical.x + (166 * scaleX),
    y: physical.y + (1.5 * scaleY),
    text: countyDetails.physicalAddress,
    font: fonts.regular,
    size: 7.1 * scaleY,
    color: fontColor
  });
  drawFieldEntry(page, {
    x: physical.x + (292 * scaleX),
    y: physical.y + (1.5 * scaleY),
    text: countyDetails.region,
    font: fonts.regular,
    size: 7.1 * scaleY,
    color: fontColor
  });

  drawFieldEntry(page, {
    x: telephone.x + (68 * scaleX),
    y: telephone.y + (1.5 * scaleY),
    text: countyDetails.telephone,
    font: fonts.regular,
    size: 7.1 * scaleY,
    color: fontColor
  });
  drawFieldEntry(page, {
    x: telephone.x + (168 * scaleX),
    y: telephone.y + (1.5 * scaleY),
    text: countyDetails.email,
    font: fonts.regular,
    size: 6.8 * scaleY,
    color: fontColor
  });
  drawFieldEntry(page, {
    x: telephone.x + (295 * scaleX),
    y: telephone.y + (1.5 * scaleY),
    text: countyDetails.fax,
    font: fonts.regular,
    size: 7.1 * scaleY,
    color: fontColor
  });

  drawFieldEntry(page, {
    x: officer.x + (166 * scaleX),
    y: officer.y + (1.5 * scaleY),
    text: countyDetails.officerInCharge,
    font: fonts.regular,
    size: 6.7 * scaleY,
    color: fontColor
  });
  drawFieldEntry(page, {
    x: officer.x + (293 * scaleX),
    y: officer.y + (1.5 * scaleY),
    text: countyDetails.officerTelephone,
    font: fonts.regular,
    size: 7.1 * scaleY,
    color: fontColor
  });

  drawFieldEntry(page, {
    x: signedBy.x + (106 * scaleX),
    y: signedBy.y + (1.5 * scaleY),
    text: countyDetails.signatoryName,
    font: fonts.bold,
    size: 6.4 * scaleY,
    color: fontColor
  });
  drawFieldEntry(page, {
    x: signedBy.x + (255 * scaleX),
    y: signedBy.y + (1.5 * scaleY),
    text: countyDetails.designation,
    font: fonts.regular,
    size: 5.9 * scaleY,
    color: mutedColor
  });

  drawFieldEntry(page, {
    x: signedAndStamped.x + (255 * scaleX),
    y: signedAndStamped.y + (1.5 * scaleY),
    text: stampDateShort || stampDate,
    font: fonts.regular,
    size: 6.4 * scaleY,
    color: mutedColor
  });

  drawPartCSignatureStamp(page, {
    x: signedAndStamped.x + (132 * scaleX),
    y: signedAndStamped.y - (3 * scaleY),
    width: 90 * scaleX,
    height: 20 * scaleY,
    fonts,
    logoImage,
    stampDateShort
  });
}

async function loadPdfTextAnchors(sourceBytes) {
  try {
    const pdfjsModuleUrl = pathToFileURL(
      path.join(__dirname, "node_modules", "pdfjs-dist", "legacy", "build", "pdf.mjs")
    ).href;
    const pdfjsLib = await import(pdfjsModuleUrl);
    const standardFontDataUrl =
      pathToFileURL(path.join(__dirname, "node_modules", "pdfjs-dist", "standard_fonts")).href + "/";
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(sourceBytes),
      disableWorker: true,
      standardFontDataUrl,
      verbosity: pdfjsLib.VerbosityLevel.ERRORS
    });
    const document = await loadingTask.promise;
    const anchorMatchers = [
      ["providerName", /^Name of Attachment Provider/i],
      ["postal", /^Postal Address/i],
      ["physical", /^Physical Address/i],
      ["telephone", /^Telephone:/i],
      ["officer", /^Name of Officer in charge of Training/i],
      ["signedBy", /^Signed by \(Name\)/i],
      ["signedAndStamped", /^Signed and Stamped/i]
    ];

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent();
      const items = textContent.items
        .map((item) => ({
          str: (item.str || "").trim(),
          x: item.transform[4],
          y: item.transform[5],
          width: item.width,
          height: item.height
        }))
        .filter((item) => item.str);
      const partCLabel = items.find((item) => /^PART C$/i.test(item.str));
      const partDLabel = items.find((item) => /^PART D/i.test(item.str));
      const regionXMin = partCLabel ? partCLabel.x - 6 : viewport.width * 0.48;
      const regionYMax = partCLabel ? partCLabel.y + 18 : viewport.height;
      const regionYMin = partDLabel ? partDLabel.y + 8 : 0;
      const anchors = {};

      for (const [key, matcher] of anchorMatchers) {
        const regionMatches = items
          .filter(
            (item) =>
              matcher.test(item.str) &&
              item.x >= regionXMin &&
              item.y >= regionYMin &&
              item.y <= regionYMax
          )
          .sort((a, b) => b.x - a.x || b.y - a.y);

        const fallbackMatches = items
          .filter((item) => matcher.test(item.str))
          .sort((a, b) => b.x - a.x || b.y - a.y);

        const selected = regionMatches[0] || fallbackMatches[0] || null;
        if (selected) {
          anchors[key] = {
            x: selected.x,
            y: selected.y,
            width: selected.width,
            height: selected.height
          };
        }
      }

      if (anchorMatchers.every(([key]) => anchors[key])) {
        return {
          pageIndex: pageNumber - 1,
          anchors
        };
      }
    }
  } catch (_error) {
    return null;
  }

  return null;
}

function resolvePartCTarget(pdfAnchors, pageIndex, page) {
  if (pdfAnchors?.pageIndex === pageIndex) {
    return {
      anchors: pdfAnchors.anchors,
      pageSize: page.getSize()
    };
  }

  if (pageIndex === NITA_TEMPLATE_PART_C_ANCHORS.pageIndex) {
    const pageSize = page.getSize();
    return {
      anchors: {
        providerName: scaleAnchorPoint(NITA_TEMPLATE_PART_C_ANCHORS.providerName, pageSize.width, pageSize.height),
        postal: scaleAnchorPoint(NITA_TEMPLATE_PART_C_ANCHORS.postal, pageSize.width, pageSize.height),
        physical: scaleAnchorPoint(NITA_TEMPLATE_PART_C_ANCHORS.physical, pageSize.width, pageSize.height),
        telephone: scaleAnchorPoint(NITA_TEMPLATE_PART_C_ANCHORS.telephone, pageSize.width, pageSize.height),
        officer: scaleAnchorPoint(NITA_TEMPLATE_PART_C_ANCHORS.officer, pageSize.width, pageSize.height),
        signedBy: scaleAnchorPoint(NITA_TEMPLATE_PART_C_ANCHORS.signedBy, pageSize.width, pageSize.height),
        signedAndStamped: scaleAnchorPoint(
          NITA_TEMPLATE_PART_C_ANCHORS.signedAndStamped,
          pageSize.width,
          pageSize.height
        )
      },
      pageSize
    };
  }

  return null;
}

async function createCountyEndorsedNitaPdf({
  sourceFile,
  uploadDir,
  applicantName,
  placementNumber,
  generatedAt,
  timeZone = "Africa/Nairobi",
  logoPath,
  countyPartCDetails
}) {
  if (!sourceFile?.path || !fs.existsSync(sourceFile.path)) {
    throw new Error("The original NITA document is missing before county endorsement.");
  }

  const ext = getSourceExtension(sourceFile);
  const sourceBytes = fs.readFileSync(sourceFile.path);
  const pdfDoc = await PDFDocument.create();
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const logoImage = await embedLogo(pdfDoc, logoPath);
  const stampDate = formatStampDate(generatedAt, timeZone);
  const stampDateShort = formatShortStampDate(generatedAt, timeZone);
  const partCDetails = buildCountyPartCDetails(countyPartCDetails);

  if (ext === ".pdf" || (sourceFile.mimetype || "").toLowerCase() === "application/pdf") {
    const sourcePdf = await PDFDocument.load(sourceBytes);
    const pdfAnchors = await loadPdfTextAnchors(sourceBytes);
    const sourcePages = await pdfDoc.copyPages(sourcePdf, sourcePdf.getPageIndices());
    let drewPartCOverlay = false;

    sourcePages.forEach((page, index) => {
      pdfDoc.addPage(page);
      const partCTarget = resolvePartCTarget(pdfAnchors, index, page);

      if (partCTarget) {
        drawPartCOverlay(page, {
          fonts: { regular: regularFont, bold: boldFont },
          logoImage,
          anchors: partCTarget.anchors,
          pageSize: partCTarget.pageSize,
          countyDetails: partCDetails,
          placementNumber,
          stampDate,
          stampDateShort
        });
        drewPartCOverlay = true;
      }
    });

    if (!drewPartCOverlay && sourcePages[0]) {
      drawGenericStampBlock(sourcePages[0], {
        fonts: { regular: regularFont, bold: boldFont },
        logoImage,
        applicantName,
        placementNumber,
        stampDate
      });
    }
  } else if (ext === ".jpg" || ext === ".jpeg" || (sourceFile.mimetype || "").toLowerCase() === "image/jpeg") {
    const image = await pdfDoc.embedJpg(sourceBytes);
    const page = pdfDoc.addPage([image.width, image.height]);
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: image.width,
      height: image.height
    });
    drawGenericStampBlock(page, {
      fonts: { regular: regularFont, bold: boldFont },
      logoImage,
      applicantName,
      placementNumber,
      stampDate
    });
  } else if (ext === ".png" || (sourceFile.mimetype || "").toLowerCase() === "image/png") {
    const image = await pdfDoc.embedPng(sourceBytes);
    const page = pdfDoc.addPage([image.width, image.height]);
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: image.width,
      height: image.height
    });
    drawGenericStampBlock(page, {
      fonts: { regular: regularFont, bold: boldFont },
      logoImage,
      applicantName,
      placementNumber,
      stampDate
    });
  } else {
    throw new Error("Automatic county endorsement supports PDF, JPG, and PNG NITA documents only.");
  }

  const finalBytes = await pdfDoc.save();
  const outputName = `${Date.now()}-${crypto.randomUUID()}-county-endorsed-nita.pdf`;
  const outputPath = path.join(uploadDir, outputName);
  fs.writeFileSync(outputPath, finalBytes);

  return {
    path: outputPath,
    filename: outputName,
    originalname: `County-Endorsed-NITA-${placementNumber || "application"}.pdf`,
    mimetype: "application/pdf",
    size: finalBytes.length
  };
}

module.exports = {
  createCountyEndorsedNitaPdf
};
