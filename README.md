# derush

Cut long silences from video files. Designed for quick de-rushing before editing.

## Setup

```bash
npm install
```

No system ffmpeg required — bundled via `ffmpeg-static`.

## Usage

```bash
node src/index.js <input.mp4> <threshold_sec> <replacement_sec>
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
node src/index.js recording.mp4 2 1

# Silences >= 1.5s → replaced by 0.5s
node src/index.js interview.mp4 1.5 0.5

# Remove near-silences entirely (0s replacement)
node src/index.js takes.mp4 1 0
```

## Tuning

| Setting     | Location      | Default              | Notes                                      |
| ----------- | ------------- | -------------------- | ------------------------------------------ |
| `NOISE_DB`  | `src/index.js:16` | `-35`                | Silence threshold in dB. Lower = stricter. |
| Video codec | `src/index.js`    | `libx264 crf18 fast` | Change preset for speed vs quality         |

## How it works

1. `ffprobe` → extracts video resolution, fps, audio parameters, total duration  
2. `ffmpeg silencedetect` → finds all silence segments >= threshold  
3. Timeline is split into **clip** segments (kept) and **silence** segments (replaced)  
4. Clips are re-encoded to temp files; one synthetic black+silent clip is generated  
5. All segments are concatenated via ffmpeg concat demuxer  
6. Temp files are cleaned up
