import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);

const ffmpegBinRaw: string | null = _require('ffmpeg-static') as string | null;
const ffprobeStaticPkg = _require('ffprobe-static') as { path: string };

if (!ffmpegBinRaw) {
  throw new Error('ffmpeg-static: binary not found for this platform');
}

const ffmpegBin: string = ffmpegBinRaw;
const ffprobeBin: string = ffprobeStaticPkg.path;
const NOISE_DB = -35 as const;

export { ffmpegBin, ffprobeBin, NOISE_DB };
