import ffmpegBin from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

const ffprobeBin = ffprobeStatic.path;

// Silence detection level (dB). Lower = stricter (e.g. -40 detects near-silence)
const NOISE_DB = -35;

export { ffmpegBin, ffprobeBin, NOISE_DB };
