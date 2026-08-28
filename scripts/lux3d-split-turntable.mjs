import { access, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import sharp from 'sharp';

const [inputPath, outputPath] = process.argv.slice(2);
const cols = 3;
const rows = 2;
const viewNames = ['front', 'front-right', 'right', 'back-left', 'back-right', 'right-profile'];

if (!inputPath) {
  console.error('Usage: pnpm lux3d:split-turntable <contact-sheet-path> [output-dir]');
  process.exitCode = 1;
} else {
  const absoluteInputPath = resolve(inputPath);
  await access(absoluteInputPath, constants.R_OK);

  const parsedName = basename(absoluteInputPath, extname(absoluteInputPath));
  const absoluteOutputPath = resolve(outputPath ?? join(dirname(absoluteInputPath), `${parsedName}-views`));
  await mkdir(absoluteOutputPath, { recursive: true });

  const metadata = await sharp(absoluteInputPath).metadata();
  const width = metadata.width;
  const height = metadata.height;

  if (!width || !height) {
    throw new Error(`Cannot read image size: ${absoluteInputPath}`);
  }

  if (width % cols !== 0 || height % rows !== 0) {
    throw new Error(`Expected a ${cols}x${rows} contact sheet, got ${width}x${height}.`);
  }

  const cellWidth = width / cols;
  const cellHeight = height / rows;
  const writtenFiles = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col;
      const viewName = viewNames[index] ?? `view-${index + 1}`;
      const outputFile = join(absoluteOutputPath, `${String(index + 1).padStart(2, '0')}-${viewName}.png`);

      await sharp(absoluteInputPath)
        .extract({
          left: col * cellWidth,
          top: row * cellHeight,
          width: cellWidth,
          height: cellHeight,
        })
        .png()
        .toFile(outputFile);

      writtenFiles.push(outputFile);
    }
  }

  console.log(`Split ${writtenFiles.length} views to ${absoluteOutputPath}`);
  for (const writtenFile of writtenFiles) {
    console.log(writtenFile);
  }
}
