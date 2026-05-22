#!/usr/bin/env node

import { existsSync, mkdtempSync, statSync, rmSync } from 'node:fs';
import { resolve, extname, basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { NOISE_DB } from './config.js';
import { getVideoInfo, detectSilences, extractClip, generateFreezeClip, concatFiles } from './ffmpeg.js';
import { buildSegments } from './segments.js';
import { fmtTime, fmtMB } from './format.js';

const [, , inputFile, thresholdArg, replacementArg] = process.argv;

if (!inputFile || !thresholdArg || !replacementArg) {
  console.error([
    'Usage: node index.js <input.mp4> <threshold_sec> <replacement_sec>',
    '',
    '  threshold_sec   : minimum silence duration to detect (e.g. 1.5)',
    '  replacement_sec : duration to replace long silences with (e.g. 1)',
    '',
    'Example:',
    '  node index.js recording.mp4 2 1',
  ].join('\n'));
  process.exit(1);
}

const inputAbs = resolve(inputFile);
const threshold = parseFloat(thresholdArg);
const replacement = parseFloat(replacementArg);

if (!existsSync(inputAbs)) {
  console.error(`File not found: ${inputAbs}`);
  process.exit(1);
}

if (isNaN(threshold) || threshold <= 0) {
  console.error('threshold_sec must be a positive number.');
  process.exit(1);
}

if (isNaN(replacement) || replacement < 0) {
  console.error('replacement_sec must be a non-negative number.');
  process.exit(1);
}

if (replacement >= threshold) {
  console.warn(`⚠ replacement (${replacement}s) >= threshold (${threshold}s): silences will not be shortened.`);
}

const ext = extname(inputAbs);
const base = basename(inputAbs, ext);
const outputFile = join(dirname(inputAbs), `${base}_derushed${ext}`);

console.log(`\nderush`);
console.log(`  Input       : ${inputAbs}`);
console.log(`  Output      : ${outputFile}`);
console.log(`  Threshold   : >= ${threshold}s of silence`);
console.log(`  Replacement : ${replacement}s`);
console.log(`  Noise level : ${NOISE_DB} dB\n`);

// -- Analyze
process.stdout.write('Analyzing video... ');
const info = getVideoInfo(inputAbs);
console.log(`${info.width}x${info.height} @ ${info.fps.toFixed(2)} fps | ${fmtTime(info.duration)} | audio: ${info.hasAudio ? `${info.sampleRate}Hz ${info.channels}ch` : 'none'}`);

// -- Detect silences
process.stdout.write('Detecting silences... ');
const silences = detectSilences(inputAbs, threshold);
console.log(`${silences.length} segment(s) found\n`);

if (silences.length === 0) {
  console.log('No silence >= threshold detected. Output unchanged.');
  process.exit(0);
}

let totalSilenceDuration = 0;
silences.forEach((s, i) => {
  const end = s.end !== null ? s.end : info.duration;
  const dur = end - s.start;
  totalSilenceDuration += dur;
  console.log(`  [${String(i + 1).padStart(2)}] ${fmtTime(s.start)} → ${fmtTime(end)}  (${dur.toFixed(2)}s)`);
});
console.log(`\n  Total silence: ${totalSilenceDuration.toFixed(2)}s`);
console.log(`  Saved approx : ${(totalSilenceDuration - silences.length * replacement).toFixed(2)}s\n`);

const segments = buildSegments(silences, info.duration);

// -- Process
const tmpDir = mkdtempSync(join(tmpdir(), 'derush-'));

try {
  const fileList = [];
  const clipSegs = segments.filter(s => s.type === 'clip');
  let clipIdx = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];

    if (seg.type === 'silence') {
      if (replacement > 0) {
        const freezeFile = join(tmpDir, `freeze_${seg.index}.mp4`);
        generateFreezeClip(inputAbs, seg.start, replacement, freezeFile, info);
        fileList.push(freezeFile);
      }
      continue;
    }

    clipIdx++;
    const pct = Math.round((clipIdx / clipSegs.length) * 100);
    const segFile = join(tmpDir, `clip_${clipIdx}.mp4`);

    process.stdout.write(`\r[${String(pct).padStart(3)}%] Extracting clip ${clipIdx}/${clipSegs.length}  (${fmtTime(seg.start)} → ${fmtTime(seg.end)})   `);

    extractClip(inputAbs, seg.start, seg.end, segFile, info);
    fileList.push(segFile);
  }

  console.log(`\r[100%] All clips extracted.                                          `);

  // -- Concat
  const concatTxt = join(tmpDir, 'concat.txt');
  process.stdout.write('\nConcatenating... ');
  concatFiles(fileList, concatTxt, outputFile);
  console.log('done');

  // -- Summary
  const inSize = statSync(inputAbs).size;
  const outSize = statSync(outputFile).size;
  const saved = ((1 - outSize / inSize) * 100).toFixed(1);

  console.log(`\n--------------------------------------`);
  console.log(`Output : ${outputFile}`);
  console.log(`Size   : ${fmtMB(inSize)} → ${fmtMB(outSize)} (${saved}% reduction)`);
  console.log(`--------------------------------------`);

} catch (err) {
  console.error('\nError:', err.message);
  process.exit(1);
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
