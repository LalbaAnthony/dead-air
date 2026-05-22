export interface VideoInfo {
  width: number;
  height: number;
  fps: number;
  duration: number;
  sampleRate: number;
  channels: number;
  hasAudio: boolean;
}

export interface Silence {
  start: number;
  end: number | null;
}

export type ClipSegment = {
  type: 'clip';
  start: number;
  end: number;
};

export type SilenceSegment = {
  type: 'silence';
  index: number;
  start: number;
};

export type Segment = ClipSegment | SilenceSegment;

export interface FfprobeStream {
  codec_type: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
}

export interface FfprobeOutput {
  streams: FfprobeStream[];
  format: {
    duration: string;
  };
}
