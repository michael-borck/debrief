import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Mic, BrainCircuit, Lock, BookOpen } from 'lucide-react';
import { Modal } from './Modal';

interface WelcomeModalProps {
  isOpen: boolean;
  onClose: (dontShowAgain: boolean) => void;
}

const FEATURES = [
  {
    icon: Mic,
    title: 'Local transcription',
    body: 'Whisper runs on your computer. Drag in audio or video, get text back. Nothing leaves your machine.',
  },
  {
    icon: Lock,
    title: 'Speakers from voice, not text',
    body: 'Pyannote and wespeaker identify who said what from the actual audio. No LLM guessing.',
  },
  {
    icon: BrainCircuit,
    title: 'Your choice of AI',
    body: 'Use a local Ollama model for privacy, or plug in OpenAI / Anthropic / Groq / Gemini for more power.',
  },
  {
    icon: BookOpen,
    title: 'Documentation in-app',
    body: 'Everything you need to know is one click away in the sidebar — works offline, always in sync.',
  },
];

export const WelcomeModal: React.FC<WelcomeModalProps> = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const [dontShowAgain, setDontShowAgain] = useState(false);

  const handleSkip = () => onClose(dontShowAgain);
  const handleGetStarted = () => {
    onClose(dontShowAgain);
    navigate('/docs/getting-started/quick-start');
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleSkip}
      ariaLabel="Welcome to DeepDebrief"
      contentClassName="modal-content max-w-2xl"
    >
        {/* Header */}
        <div className="flex items-start justify-between mb-2">
          <div>
            <h2 className="text-2xl font-display font-bold text-surface-900">Welcome to DeepDebrief</h2>
            <p className="text-sm text-surface-600 mt-1">
              A privacy-first desktop app for transcribing and analysing conversations.
            </p>
          </div>
          <button
            onClick={handleSkip}
            className="text-surface-400 hover:text-surface-700 transition-colors flex-shrink-0"
            title="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Feature grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 my-6">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="flex items-start gap-3 p-4 rounded-lg border border-surface-200 bg-surface-50"
            >
              <div className="w-9 h-9 rounded-lg bg-primary-100 flex items-center justify-center flex-shrink-0">
                <Icon size={16} className="text-primary-700" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-surface-900">{title}</h3>
                <p className="text-xs text-surface-600 mt-0.5 leading-snug">{body}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between gap-3 pt-4 border-t border-surface-100">
          <label className="flex items-center gap-2 text-xs text-surface-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="rounded text-primary-800 focus:ring-primary-500"
            />
            Don't show this again
          </label>
          <div className="flex gap-2">
            <button
              onClick={handleSkip}
              className="px-4 py-2 text-sm text-surface-600 hover:bg-surface-50 rounded-lg transition-colors"
            >
              Skip for now
            </button>
            <button
              onClick={handleGetStarted}
              className="btn-primary"
            >
              Open Quick Start
            </button>
          </div>
        </div>
    </Modal>
  );
};
