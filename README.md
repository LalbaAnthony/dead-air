# DeadAir - Silence Cutter for Video Files

Cut long silences from video files. Designed for quick de-rushing before editing.

## Setup

```bash
npm install
```

No system ffmpeg required — bundled via `ffmpeg-static`.

## Usage

```bash
npm start <input.mp4> <threshold_sec> <replacement_sec>
# or directly:
npx tsx src/index.ts <input.mp4> <threshold_sec> <replacement_sec>
```

| Argument          | Description                                          |
| ----------------- | ---------------------------------------------------- |
| `input.mp4`       | Source video file                                    |
| `threshold_sec`   | Minimum silence duration to process (seconds)        |
| `replacement_sec` | Duration to replace detected silences with (seconds) |

Output is written alongside the source as `<name>_derushed.mp4`.

## Examples

```bash
# Silences >= 2s → replaced by 1s
npm start recording.mp4 2 1

# Silences >= 1.5s → replaced by 0.5s
npm start interview.mp4 1.5 0.5

# Remove near-silences entirely (0s replacement)
npm start takes.mp4 1 0
```

## Scripts

| Command             | Description                        |
| ------------------- | ---------------------------------- |
| `npm start`         | Run the CLI via tsx                |
| `npm run build`     | Compile TypeScript to `dist/`      |
| `npm run typecheck` | Type-check without emitting output |

## Tuning

| Setting     | Location        | Default              | Notes                                      |
| ----------- | --------------- | -------------------- | ------------------------------------------ |
| `NOISE_DB`  | `src/config.ts` | `-35`                | Silence threshold in dB. Lower = stricter. |
| Video codec | `src/ffmpeg.ts` | `libx264 crf18 fast` | Change preset for speed vs quality         |

## How it works

1. `ffprobe` → extracts video resolution, fps, audio parameters, total duration  
2. `ffmpeg silencedetect` → finds all silence segments >= threshold  
3. Timeline is split into **clip** segments (kept) and **silence** segments (replaced)  
4. Clips are re-encoded to temp files; one freeze frame clip is generated per silence  
5. All segments are concatenated via ffmpeg concat demuxer  
6. Temp files are cleaned up
