/**
 * AI Summary Modal — Stub for open-source skeleton
 * (Full AI-powered summarization requires Claude API)
 */
import { memo } from 'react';

interface AISummaryModalProps {
  storyId?: string;
  clusterId?: string;
  isOpen: boolean;
  onClose: () => void;
}

export const AISummaryModal = memo(function AISummaryModal({
  isOpen,
  onClose,
}: AISummaryModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-[#1C2127] border border-white/10 rounded-lg p-6 max-w-md w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-white text-sm font-medium mb-2">AI Summary</h3>
        <p className="text-white/50 text-xs">
          AI-powered story summarization is available when configured with a Claude API key.
          See the README for setup instructions.
        </p>
        <button
          onClick={onClose}
          className="mt-4 px-3 py-1.5 text-xs bg-white/10 hover:bg-white/20 text-white rounded transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
});
