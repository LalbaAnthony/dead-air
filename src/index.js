#!/usr/bin/env node

/**
 * derush — cut long silences from video files
 *
 * Usage:
 *   node index.js <input.mp4> <threshold_sec> <replacement_sec>
 *
 *   threshold_sec   minimum silence duration to process (e.g. 1.5)
 *   replacement_sec duration to replace detected silences with (e.g. 1)
 *
 * Example:
 *   node index.js recording.mp4 2 1
 *   → silences >= 2s are replaced by 1s of silence
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ffmpegBin = require('ffmpeg-static');
const ffprobeBin = require('ffprobe-static').path;

// --- Silence detection level (dB). Lower = stricter (e.g. -40 detects near-silence)
const NOISE_DB = -35;

// -----------------------------------------------------------------------------

function ff(bin, args) {
  return spawnSync(bin, args, {
    encoding: 'utf8',
    maxBuffer: 200 * 1024 * 1024,
  });
}

function getVideoInfo(file) {
  const r = ff(ffprobeBin, [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_streams',
    '-show_format',
    file,
  ]);

  if (r.status !== 0) throw new Error(`ffprobe failed:\n${r.stderr}`);

  const d = JSON.parse(r.stdout);
  const vs = d.streams.find(s => s.codec_type === 'video');
  const as = d.streams.find(s => s.codec_type === 'audio');

  if (!vs) throw new Error('No video stream found.');

  const [num, den] = vs.r_frame_rate.split('/');

  return {
    width: vs.width,
    height: vs.height,
    fps: parseFloat(num) / parseFloat(den),
    duration: parseFloat(d.format.duration),
    sampleRate: as ? parseInt(as.sample_rate, 10) : 44100,
    channels: as ? as.channels : 2,
    hasAudio: !!as,
  };
}

function detectSilences(file, threshold) {
  const r = ff(ffmpegBin, [
    '-i', file,
    '-af', `silencedetect=noise=${NOISE_DB}dB:d=${threshold}`,
    '-f', 'null', '-',
  ]);

  // ffmpeg writes silencedetect output to stderr
  const text = r.stderr;
  const silences = [];

  for (const m of text.matchAll(/silence_start: ([\d.e+\-]+)/g)) {
    silences.push({ start: parseFloat(m[1]), end: null });
  }

  let i = 0;
  for (const m of text.matchAll(/silence_end: ([\d.e+\-]+)/g)) {
    if (silences[i]) silences[i].end = parseFloat(m[1]);
    i++;
  }

  return silences;
}

/**
 * Build ordered list of segments from detected silences.
 * Each silence >= threshold is replaced by a synthetic silence block.
 * Gaps between silences are "clip" segments kept from the source.
 */
function buildSegments(silences, totalDuration) {
  const segs = [];
  let pos = 0;

  for (const s of silences) {
    if (s.start > pos + 0.02) {
      segs.push({ type: 'clip', start: pos, end: s.start });
    }
    segs.push({ type: 'silence' });
    pos = s.end !== null ? s.end : totalDuration;
  }

  if (pos < totalDuration - 0.02) {
    segs.push({ type: 'clip', start: pos, end: totalDuration });
  }

  return segs;
}

function extractClip(input, start, end, output, info) {
  const args = [
    '-ss', String(start),
    '-i', input,
    '-t', String(end - start),
    '-c:v', 'libx264', '-crf', '18', '-preset', 'fast',
    '-avoid_negative_ts', '1',
  ];

  if (info.hasAudio) {
    args.push('-c:a', 'aac', '-ar', String(info.sampleRate), '-ac', String(info.channels));
  } else {
    args.push('-an');
  }

  args.push('-y', output);

  const r = ff(ffmpegBin, args);
  if (r.status !== 0) throw new Error(`extractClip failed [${start}→${end}]:\n${r.stderr}`);
}

function generateSilenceClip(duration, output, info) {
  const channelLayout = info.channels === 1 ? 'mono' : 'stereo';
  const args = [
    '-f', 'lavfi',
    '-i', `color=c=black:size=${info.width}x${info.height}:rate=${info.fps}`,
    '-c:v', 'libx264', '-crf', '18', '-preset', 'fast',
  ];

  if (info.hasAudio) {
    args.push(
      '-f', 'lavfi',
      '-i', `anullsrc=channel_layout=${channelLayout}:sample_rate=${info.sampleRate}`,
      '-c:a', 'aac', '-ar', String(info.sampleRate), '-ac', String(info.channels),
    );
  } else {
    args.push('-an');
  }

  args.push('-t', String(duration), '-y', output);

  const r = ff(ffmpegBin, args);
  if (r.status !== 0) throw new Error(`generateSilenceClip failed:\n${r.stderr}`);
}

function concatFiles(fileList, concatTxt, output) {
  const lines = fileList.map(f => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`);
  fs.writeFileSync(concatTxt, lines.join('\n'), 'utf8');

  const r = ff(ffmpegBin, [
    '-f', 'concat',
    '-safe', '0',
    '-i', concatTxt,
    '-c', 'copy',
    '-y', output,
  ]);
  if (r.status !== 0) throw new Error(`concat failed:\n${r.stderr}`);
}

// --- Helpers -----------------------------------------------------------------

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(2).padStart(5, '0');
  return `${String(m).padStart(2, '0')}:${s}`;
}

function fmtMB(bytes) {
  return (bytes / 1e6).toFixed(1) + ' MB';
}

// --- Main ---------------------------------------------------------------------

(async function main() {
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

  const inputAbs = path.resolve(inputFile);
  const threshold = parseFloat(thresholdArg);
  const replacement = parseFloat(replacementArg);

  if (!fs.existsSync(inputAbs)) {
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

  const ext = path.extname(inputAbs);
  const base = path.basename(inputAbs, ext);
  const outputFile = path.join(path.dirname(inputAbs), `${base}_derushed${ext}`);

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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'derush-'));

  try {
    const fileList = [];
    let silenceFile = null;

    const hasSilenceSegs = segments.some(s => s.type === 'silence');

    if (hasSilenceSegs) {
      silenceFile = path.join(tmpDir, 'silence.mp4');
      process.stdout.write(`Generating ${replacement}s silence clip... `);
      generateSilenceClip(replacement, silenceFile, info);
      console.log('done');
    }

    const clipSegs = segments.filter(s => s.type === 'clip');
    let clipIdx = 0;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];

      if (seg.type === 'silence') {
        fileList.push(silenceFile);
        continue;
      }

      clipIdx++;
      const pct = Math.round((clipIdx / clipSegs.length) * 100);
      const segFile = path.join(tmpDir, `clip_${clipIdx}.mp4`);

      process.stdout.write(`\r[${String(pct).padStart(3)}%] Extracting clip ${clipIdx}/${clipSegs.length}  (${fmtTime(seg.start)} → ${fmtTime(seg.end)})   `);

      extractClip(inputAbs, seg.start, seg.end, segFile, info);
      fileList.push(segFile);
    }

    console.log(`\r[100%] All clips extracted.                                          `);

    // -- Concat
    const concatTxt = path.join(tmpDir, 'concat.txt');
    process.stdout.write('\nConcatenating... ');
    concatFiles(fileList, concatTxt, outputFile);
    console.log('done');

    // -- Summary
    const inSize = fs.statSync(inputAbs).size;
    const outSize = fs.statSync(outputFile).size;
    const saved = ((1 - outSize / inSize) * 100).toFixed(1);

    console.log(`\n--------------------------------------`);
    console.log(`Output : ${outputFile}`);
    console.log(`Size   : ${fmtMB(inSize)} → ${fmtMB(outSize)} (${saved}% reduction)`);
    console.log(`--------------------------------------`);

  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
})().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
