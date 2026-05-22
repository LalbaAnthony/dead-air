import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';

import { ffmpegBin, ffprobeBin, NOISE_DB } from './config.js';

function ff(bin, args) {
  return spawnSync(bin, args, {
    encoding: 'utf8',
    maxBuffer: 200 * 1024 * 1024,
  });
}

export function getVideoInfo(file) {
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

export function detectSilences(file, threshold) {
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

export function extractClip(input, start, end, output, info) {
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

export function generateFreezeClip(input, freezeAt, duration, output, info) {
  const channelLayout = info.channels === 1 ? 'mono' : 'stereo';
  const framePng = output + '.png';

  const r1 = ff(ffmpegBin, [
    '-ss', String(freezeAt),
    '-i', input,
    '-vframes', '1',
    '-y', framePng,
  ]);
  if (r1.status !== 0) throw new Error(`freeze frame extract failed:\n${r1.stderr}`);

  const args = [
    '-loop', '1',
    '-framerate', String(info.fps),
    '-i', framePng,
  ];

  if (info.hasAudio) {
    args.push(
      '-f', 'lavfi',
      '-i', `anullsrc=channel_layout=${channelLayout}:sample_rate=${info.sampleRate}`,
    );
  }

  args.push('-c:v', 'libx264', '-crf', '18', '-preset', 'fast');

  if (info.hasAudio) {
    args.push('-c:a', 'aac', '-ar', String(info.sampleRate), '-ac', String(info.channels));
  } else {
    args.push('-an');
  }

  args.push('-t', String(duration), '-y', output);

  const r2 = ff(ffmpegBin, args);
  try { unlinkSync(framePng); } catch {}

  if (r2.status !== 0) throw new Error(`generateFreezeClip failed:\n${r2.stderr}`);
}

export function concatFiles(fileList, concatTxt, output) {
  const lines = fileList.map(f => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`);
  writeFileSync(concatTxt, lines.join('\n'), 'utf8');

  const r = ff(ffmpegBin, [
    '-f', 'concat',
    '-safe', '0',
    '-i', concatTxt,
    '-c', 'copy',
    '-y', output,
  ]);
  if (r.status !== 0) throw new Error(`concat failed:\n${r.stderr}`);
}
