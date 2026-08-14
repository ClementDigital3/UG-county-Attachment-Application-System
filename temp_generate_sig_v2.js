const path = require("path");
const fs = require("fs");
const { createJoiningLetterTemplatePdf } = require("./joining-letter-template");

const COUNTY_LOGO_JPG_FILE = path.join(__dirname, "public", "uasin-gishu-logo.jpg");
const COUNTY_SIGNATURE_PNG_FILE = path.join(__dirname, "public", "director-signature.png");
const ARTIFACTS_DIR = "C:\\Users\\Real Sylph\\.gemini\\antigravity\\brain\\f5685f0f-f222-44eb-bb4d-55e19e0e6c4d";

async function run() {
  console.log("Generating sample joining letter with exact pixel-cropped signature...");
  
  try {
    const result = await createJoiningLetterTemplatePdf({
      uploadDir: __dirname,
      applicant: {
        fullName: "LIVINGSTONE ARTHUR",
        idNumber: "35492817",
        institution: "MOI UNIVERSITY",
        course: "BACHELOR OF SCIENCE IN COMPUTER SCIENCE",
        appliedDepartmentLabel: "ICT, E-GOVERNANCE & INNOVATION",
        startDate: "2026-05-02T00:00:00.000Z",
        endDate: "2026-07-31T00:00:00.000Z",
        submittedAt: "2026-04-12T09:15:00.000Z"
      },
      generatedAt: new Date().toISOString(),
      timeZone: "Africa/Nairobi",
      logoPath: COUNTY_LOGO_JPG_FILE,
      signaturePath: COUNTY_SIGNATURE_PNG_FILE,
      countyName: "COUNTY GOVERNMENT OF UASIN GISHU"
    });

    const destinationPath = path.join(ARTIFACTS_DIR, "sample_joining_letter_v3.pdf");
    if (fs.existsSync(destinationPath)) {
      fs.unlinkSync(destinationPath);
    }
    fs.renameSync(result.path, destinationPath);
    console.log("PDF generated successfully and copied to:", destinationPath);
  } catch (error) {
    console.error("Error generating PDF:", error);
  }
}

run();
