"use client";

/**
 * Timeline scrubber with play controls
 */

import type { PlaybackSpeed } from "@/hooks/useReplayState";

const styles = {
  container: {
    padding: "16px",
    backgroundColor: "#f9fafb",
    borderTop: "1px solid #e5e7eb",
    display: "flex",
    flexDirection: "column" as const,
    gap: "12px",
  },
  controls: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  playButton: {
    width: "40px",
    height: "40px",
    borderRadius: "50%",
    border: "none",
    backgroundColor: "#3b82f6",
    color: "#fff",
    fontSize: "16px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "background-color 0.15s",
  },
  slider: {
    flex: 1,
    height: "8px",
    cursor: "pointer",
    accentColor: "#3b82f6",
  },
  timestamp: {
    fontFamily: "monospace",
    fontSize: "14px",
    color: "#374151",
    minWidth: "80px",
  },
  speedSelector: {
    display: "flex",
    gap: "4px",
  },
  speedButton: {
    padding: "4px 8px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "#d1d5db",
    borderRadius: "4px",
    backgroundColor: "#fff",
    fontSize: "12px",
    cursor: "pointer",
    transition: "all 0.15s",
  },
  speedButtonActive: {
    backgroundColor: "#3b82f6",
    color: "#fff",
    borderColor: "#3b82f6",
  },
  timeRange: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: "11px",
    color: "#6b7280",
    fontFamily: "monospace",
  },
};

interface TimeScrubberProps {
  currentTs: Date;
  windowStartTs: Date;
  windowEndTs: Date;
  isPlaying: boolean;
  playbackSpeed: PlaybackSpeed;
  onTogglePlay: () => void;
  onSeek: (ts: Date) => void;
  onSpeedChange: (speed: PlaybackSpeed) => void;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-AU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function TimeScrubber({
  currentTs,
  windowStartTs,
  windowEndTs,
  isPlaying,
  playbackSpeed,
  onTogglePlay,
  onSeek,
  onSpeedChange,
}: TimeScrubberProps) {
  const startTime = windowStartTs.getTime();
  const endTime = windowEndTs.getTime();
  const currentTime = currentTs.getTime();
  const progress = ((currentTime - startTime) / (endTime - startTime)) * 100;

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    const newTime = startTime + ((endTime - startTime) * value) / 100;
    onSeek(new Date(newTime));
  };

  const speeds: PlaybackSpeed[] = [1, 2, 5];

  return (
    <div style={styles.container}>
      <div style={styles.controls}>
        <button
          style={styles.playButton}
          onClick={onTogglePlay}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "#2563eb";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "#3b82f6";
          }}
        >
          {isPlaying ? "⏸" : "▶"}
        </button>
        <input
          type="range"
          min={0}
          max={100}
          step={0.1}
          value={progress}
          onChange={handleSliderChange}
          style={styles.slider}
        />
        <span style={styles.timestamp}>{formatTime(currentTs)}</span>
        <div style={styles.speedSelector}>
          {speeds.map((speed) => (
            <button
              key={speed}
              style={{
                ...styles.speedButton,
                ...(playbackSpeed === speed ? styles.speedButtonActive : {}),
              }}
              onClick={() => onSpeedChange(speed)}
            >
              {speed}x
            </button>
          ))}
        </div>
      </div>
      <div style={styles.timeRange}>
        <span>{formatTime(windowStartTs)}</span>
        <span>{formatTime(windowEndTs)}</span>
      </div>
    </div>
  );
}
