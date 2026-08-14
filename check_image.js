const { Jimp } = require("jimp");

async function check() {
  try {
    const image = await Jimp.read("C:\\Users\\Real Sylph\\.gemini\\antigravity\\brain\\f5685f0f-f222-44eb-bb4d-55e19e0e6c4d\\media__1784185685724.jpg");
    console.log("Image width:", image.bitmap.width);
    console.log("Image height:", image.bitmap.height);
  } catch (error) {
    console.error("Error reading image:", error);
  }
}

check();
