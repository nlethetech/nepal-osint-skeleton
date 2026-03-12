import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MessageSquarePlus,
  CheckCircle2,
  XCircle,
  Flag,
  Link2,
  FileText,
  Filter,
  Layers,
  Download,
  Eye,
  EyeOff,
  Crosshair,
  ClipboardCheck,
} from 'lucide-react';
import { useAuthStore } from '../../store/slices/authSlice';

interface AnalystToolbarProps {
  feedbackMode: boolean;
  setFeedbackMode: (mode: boolean) => void;
  selectedCount: number;
  onBulkAction: (action: string) => void;
}

export function AnalystToolbar({
  feedbackMode,
  setFeedbackMode,
  selectedCount,
  onBulkAction,
}: AnalystToolbarProps) {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [showFilters, setShowFilters] = useState(false);

  // Only show for analyst and dev roles
  if (user?.role === 'consumer') return null;

  return (
    <div className="analyst-toolbar">
      <div className="toolbar-section">
        {/* Feedback Mode Toggle */}
        <button
          className={`toolbar-btn ${feedbackMode ? 'active' : ''}`}
          onClick={() => setFeedbackMode(!feedbackMode)}
          title="Toggle Feedback Mode"
        >
          <Crosshair size={14} />
          <span>Feedback</span>
          {feedbackMode && <span className="mode-indicator" />}
        </button>

        <div className="toolbar-divider" />

        {/* Quick Actions */}
        <button
          className="toolbar-btn"
          onClick={() => setShowFilters(!showFilters)}
          title="Advanced Filters"
        >
          <Filter size={14} />
          <span>Filters</span>
        </button>

        <button className="toolbar-btn" title="Create Case">
          <Layers size={14} />
          <span>New Case</span>
        </button>

        <button
          className="toolbar-btn"
          onClick={() => navigate('/ops')}
          title="Ops Inbox (verify → publish)"
        >
          <ClipboardCheck size={14} />
          <span>Ops</span>
        </button>

        <button className="toolbar-btn" title="Export Report">
          <Download size={14} />
          <span>Export</span>
        </button>
      </div>

      {/* Bulk Actions - only when items are selected */}
      {selectedCount > 0 && (
        <div className="toolbar-section bulk-actions">
          <span className="selected-count">{selectedCount} selected</span>
          <div className="toolbar-divider" />

          <button
            className="toolbar-btn success"
            onClick={() => onBulkAction('confirm')}
            title="Confirm Classification"
          >
            <CheckCircle2 size={14} />
          </button>

          <button
            className="toolbar-btn danger"
            onClick={() => onBulkAction('reject')}
            title="Reject / Mark Irrelevant"
          >
            <XCircle size={14} />
          </button>

          <button
            className="toolbar-btn warning"
            onClick={() => onBulkAction('flag')}
            title="Flag for Review"
          >
            <Flag size={14} />
          </button>

          <button
            className="toolbar-btn"
            onClick={() => onBulkAction('link')}
            title="Link to Entity"
          >
            <Link2 size={14} />
          </button>

          <button
            className="toolbar-btn"
            onClick={() => onBulkAction('addToCase')}
            title="Add to Case"
          >
            <FileText size={14} />
          </button>
        </div>
      )}

      {/* Filter Panel */}
      {showFilters && (
        <div className="filter-panel">
          <div className="filter-group">
            <label>Confidence</label>
            <div className="filter-options">
              <button className="filter-chip active">All</button>
              <button className="filter-chip">High</button>
              <button className="filter-chip">Medium</button>
              <button className="filter-chip">Low</button>
            </div>
          </div>
          <div className="filter-group">
            <label>Review Status</label>
            <div className="filter-options">
              <button className="filter-chip active">All</button>
              <button className="filter-chip">Unreviewed</button>
              <button className="filter-chip">Confirmed</button>
              <button className="filter-chip">Flagged</button>
            </div>
          </div>
          <div className="filter-group">
            <label>Source Type</label>
            <div className="filter-options">
              <button className="filter-chip active">All</button>
              <button className="filter-chip">Official</button>
              <button className="filter-chip">News</button>
              <button className="filter-chip">Social</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .analyst-toolbar {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 8px 16px;
          background: linear-gradient(180deg, rgba(26, 26, 31, 0.95) 0%, rgba(20, 20, 25, 0.98) 100%);
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          flex-wrap: wrap;
        }

        .toolbar-section {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .toolbar-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          background: transparent;
          border: 1px solid transparent;
          border-radius: 6px;
          color: #8b8b8b;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
          position: relative;
        }

        .toolbar-btn:hover {
          background: rgba(255, 255, 255, 0.05);
          color: #fff;
        }

        .toolbar-btn.active {
          background: rgba(59, 130, 246, 0.15);
          border-color: rgba(59, 130, 246, 0.3);
          color: #60a5fa;
        }

        .toolbar-btn.success:hover {
          background: rgba(34, 197, 94, 0.15);
          color: #4ade80;
        }

        .toolbar-btn.danger:hover {
          background: rgba(239, 68, 68, 0.15);
          color: #f87171;
        }

        .toolbar-btn.warning:hover {
          background: rgba(234, 179, 8, 0.15);
          color: #facc15;
        }

        .mode-indicator {
          position: absolute;
          top: 4px;
          right: 4px;
          width: 6px;
          height: 6px;
          background: #60a5fa;
          border-radius: 50%;
          animation: pulse 2s ease-in-out infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        .toolbar-divider {
          width: 1px;
          height: 20px;
          background: rgba(255, 255, 255, 0.1);
          margin: 0 8px;
        }

        .bulk-actions {
          background: rgba(59, 130, 246, 0.08);
          padding: 4px 8px;
          border-radius: 8px;
          border: 1px solid rgba(59, 130, 246, 0.15);
        }

        .selected-count {
          font-size: 11px;
          font-weight: 600;
          color: #60a5fa;
          padding: 0 8px;
        }

        .filter-panel {
          width: 100%;
          display: flex;
          gap: 24px;
          padding: 12px 0 4px;
          border-top: 1px solid rgba(255, 255, 255, 0.05);
          margin-top: 8px;
        }

        .filter-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .filter-group label {
          font-size: 10px;
          font-weight: 600;
          color: #6b6b6b;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .filter-options {
          display: flex;
          gap: 4px;
        }

        .filter-chip {
          padding: 4px 10px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 4px;
          color: #8b8b8b;
          font-size: 11px;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .filter-chip:hover {
          background: rgba(255, 255, 255, 0.06);
          color: #fff;
        }

        .filter-chip.active {
          background: rgba(59, 130, 246, 0.15);
          border-color: rgba(59, 130, 246, 0.3);
          color: #60a5fa;
        }
      `}</style>
    </div>
  );
}
