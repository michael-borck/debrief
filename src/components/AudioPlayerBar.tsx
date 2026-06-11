import React from 'react';
import { Play, Pause, Loader2, AlertCircle, Volume2 } from 'lucide-react';
import { AudioPlayerState } from '../hooks/useAudioPlayer';

interface AudioPlayerBarProps {
  player: AudioPlayerState;
  filePath?: string;
  fileName?: string;
}

const formatTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

export const AudioPlayerBar: React.FC<AudioPlayerBarProps> = ({ player, filePath, fileName }) => {
  const { audioRef, loadState, errorMessage, isPlaying, currentTime, duration, toggle, seek, load } = player;

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    seek(value);
  };

  const handleLoad = () => {
    if (filePath) load(filePath);
  };

  return (
    <div className="card-static p-4">
      {/* Hidden audio element — controlled via the hook ref */}
      <audio ref={audioRef} preload="metadata" />

      {loadState === 'idle' && (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Volume2 size={16} className="text-surface-400 flex-shrink-0" />
            <span className="text-sm text-surface-600 truncate">
              {fileName || 'Audio playback'}
            </span>
          </div>
          <button
            onClick={handleLoad}
            disabled={!filePath}
            className="btn-secondary flex items-center gap-1.5 text-xs py-1.5 px-3"
          >
            <Play size={12} />
            Load audio
          </button>
        </div>
      )}

      {loadState === 'loading' && (
        <div className="flex items-center justify-center gap-2 py-1 text-sm text-surface-500">
          <Loader2 size={14} className="animate-spin" />
          Loading audio...
        </div>
      )}

      {loadState === 'error' && (
        <div className="flex items-start gap-2 text-xs text-red-600">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Audio unavailable</p>
            <p className="text-red-500/80 mt-0.5">{errorMessage}</p>
          </div>
        </div>
      )}

      {loadState === 'ready' && (
        <div className="flex items-center gap-3">
          <button
            onClick={toggle}
            className="w-9 h-9 rounded-full bg-primary-800 text-primary-100 flex items-center justify-center hover:bg-primary-900 transition-colors flex-shrink-0"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
          </button>

          <span className="text-xs text-surface-500 tabular-nums w-10 text-right flex-shrink-0">
            {formatTime(currentTime)}
          </span>

          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={currentTime}
            onChange={handleScrub}
            className="flex-1 accent-accent-500 h-1"
          />

          <span className="text-xs text-surface-500 tabular-nums w-10 flex-shrink-0">
            {formatTime(duration)}
          </span>

          {fileName && (
            <span className="text-xs text-surface-400 truncate hidden md:block max-w-[180px]">
              {fileName}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
