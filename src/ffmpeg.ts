import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';

import { ffmpegBin, ffprobeBin, NOISE_DB } from './config.js';
import type { VideoInfo, Silence, FfprobeOutput } from './types.js';

function ff(bin: string, args: string[]): SpawnSyncReturns<string> {
  return spawnSync(bin, args, {
    encoding: 'utf8',
    maxBuffer: 200 * 1024 * 1024,
  });
}

export function getVideoInfo(file: string): VideoInfo {
  const r = ff(ffprobeBin, [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_streams',
    '-show_format',
    file,
  ]);

  if (r.status !== 0) throw new Error(`ffprobe failed:\n${r.stderr}`);

  const d = JSON.parse(r.stdout) as FfprobeOutput;
  const vs = d.streams.find(s => s.codec_type === 'video');
  const as = d.streams.find(s => s.codec_type === 'audio');

  if (!vs) throw new Error('No video stream found.');

  const parts = (vs.r_frame_rate ?? '30/1').split('/');
  const num = parts[0] ?? '30';
  const den = parts[1] ?? '1';

  return {
    width: vs.width ?? 0,
    height: vs.height ?? 0,
    fps: parseFloat(num) / parseFloat(den),
    duration: parseFloat(d.format.duration),
    sampleRate: as?.sample_rate ? parseInt(as.sample_rate, 10) : 44100,
    channels: as?.channels ?? 2,
    hasAudio: !!as,
  };
}

export function detectSilences(file: string, threshold: number): Silence[] {
  const r = ff(ffmpegBin, [
    '-i', file,
    '-af', `silencedetect=noise=${NOISE_DB}dB:d=${threshold}`,
    '-f', 'null', '-',
  ]);

  const text = r.stderr;
  const silences: Silence[] = [];

  for (const m of text.matchAll(/silence_start: ([\d.e+\-]+)/g)) {
    silences.push({ start: parseFloat(m[1] ?? '0'), end: null });
  }

  let i = 0;
  for (const m of text.matchAll(/silence_end: ([\d.e+\-]+)/g)) {
    const silence = silences[i];
    if (silence) silence.end = parseFloat(m[1] ?? '0');
    i++;
  }

  return silences;
}

export function extractClip(input: string, start: number, end: number, output: string, info: VideoInfo): void {
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

export function generateFreezeClip(input: string, freezeAt: number, duration: number, output: string, info: VideoInfo): void {
  const channelLayout = info.channels === 1 ? 'mono' : 'stereo';
  const framePng = output + '.png';

  const r1 = ff(ffmpegBin, [
    '-ss', String(freezeAt),
    '-i', input,
    '-vframes', '1',
    '-y', framePng,
  ]);
  if (r1.status !== 0) throw new Error(`freeze frame extract failed:\n${r1.stderr}`);

  const args: string[] = [
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
  try { unlinkSync(framePng); } catch { /* ignore cleanup errors */ }

  if (r2.status !== 0) throw new Error(`generateFreezeClip failed:\n${r2.stderr}`);
}

export function concatFiles(fileList: string[], concatTxt: string, output: string): void {
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
