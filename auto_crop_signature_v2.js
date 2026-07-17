const { Jimp } = require("jimp");
const path = require("path");

async function run() {
  const inputPath = "C:\\Users\\Real Sylph\\.gemini\\antigravity\\brain\\f5685f0f-f222-44eb-bb4d-55e19e0e6c4d\\media__1784185685724.jpg";
  const outputPath = "c:\\Users\\Real Sylph\\Desktop\\Attachment Application System\\public\\director-signature.png";

  try {
    const image = await Jimp.read(inputPath);
    const width = image.bitmap.width; // 724
    const height = image.bitmap.height; // 1024

    // Limit scan to y=600 to y=720 to capture ONLY the handwritten scribble,
    // avoiding the printed name text below it.
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;

    for (let y = 600; y < 720; y++) {
      for (let x = 30; x < 320; x++) {
        const color = image.getPixelColor(x, y);
        
        const r = (color >> 24) & 0xff;
        const g = (color >> 16) & 0xff;
        const b = (color >> 8) & 0xff;
        const brightness = (r + g + b) / 3;
        
        // Threshold for dark signature ink
        if (brightness < 130) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    console.log(`Detected Scribble Bounding Box: x=[${minX}, ${maxX}], y=[${minY}, ${maxY}]`);
    
    if (maxX <= minX || maxY <= minY) {
      throw new Error("Could not detect any dark scribble pixels in the target region.");
    }

    // Pad the crop region
    const padX = 10;
    const padY = 5;
    const cropX = Math.max(0, minX - padX);
    const cropY = Math.max(0, minY - padY);
    const cropW = Math.min(width - cropX, (maxX - minX) + 2 * padX);
    const cropH = Math.min(height - cropY, (maxY - minY) + 2 * padY);

    console.log(`Cropping Scribble Region: x=${cropX}, y=${cropY}, w=${cropW}, h=${cropH}`);

    const cropped = image.clone().crop({ x: cropX, y: cropY, w: cropW, h: cropH });

    // Make the white background transparent
    for (let y = 0; y < cropH; y++) {
      for (let x = 0; x < cropW; x++) {
        const color = cropped.getPixelColor(x, y);
        const r = (color >> 24) & 0xff;
        const g = (color >> 16) & 0xff;
        const b = (color >> 8) & 0xff;
        const brightness = (r + g + b) / 3;
        
        if (brightness > 195) {
          cropped.setPixelColor(0x00000000, x, y);
        }
      }
    }

    await cropped.write(outputPath);
    console.log("Successfully wrote cropped signature PNG to:", outputPath);

  } catch (error) {
    console.error("Signature crop failed:", error);
  }
}

run();
