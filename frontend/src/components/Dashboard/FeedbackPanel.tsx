import { useState } from 'react';
import {
  X,
  CheckCircle2,
  XCircle,
  Flag,
  Link2,
  MessageSquare,
  Star,
  AlertTriangle,
  Shield,
  Eye,
  Clock,
  Tag,
  ChevronRight,
} from 'lucide-react';

interface Story {
  id: string;
  title: string;
  source_name?: string;
  published_at?: string;
  category?: string;
  severity?: string;
  relevance_score?: number;
}

interface FeedbackPanelProps {
  story: Story | null;
  onClose: () => void;
  onSubmit: (feedback: StoryFeedback) => void;
}

interface StoryFeedback {
  storyId: string;
  classification: 'confirm' | 'reject' | 'flag';
  confidence: number;
  sourceReliability: number;
  categories: string[];
  entities: string[];
  notes: string;
  threatLevel?: 'low' | 'medium' | 'high' | 'critical';
}

const CATEGORIES = [
  'Political', 'Security', 'Economic', 'Social', 'Crime',
  'Disaster', 'Health', 'Infrastructure', 'International', 'Elections'
];

const THREAT_LEVELS = [
  { value: 'low', label: 'Low', color: '#22c55e' },
  { value: 'medium', label: 'Medium', color: '#eab308' },
  { value: 'high', label: 'High', color: '#f97316' },
  { value: 'critical', label: 'Critical', color: '#ef4444' },
];

export function FeedbackPanel({ story, onClose, onSubmit }: FeedbackPanelProps) {
  const [classification, setClassification] = useState<'confirm' | 'reject' | 'flag' | null>(null);
  const [confidence, setConfidence] = useState(3);
  const [sourceReliability, setSourceReliability] = useState(3);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [threatLevel, setThreatLevel] = useState<string | null>(null);
  const [entityInput, setEntityInput] = useState('');
  const [linkedEntities, setLinkedEntities] = useState<string[]>([]);

  if (!story) return null;

  const handleSubmit = () => {
    if (!classification) return;

    onSubmit({
      storyId: story.id,
      classification,
      confidence,
      sourceReliability,
      categories: selectedCategories,
      entities: linkedEntities,
      notes,
      threatLevel: threatLevel as StoryFeedback['threatLevel'],
    });
    onClose();
  };

  const addEntity = () => {
    if (entityInput.trim() && !linkedEntities.includes(entityInput.trim())) {
      setLinkedEntities([...linkedEntities, entityInput.trim()]);
      setEntityInput('');
    }
  };

  const toggleCategory = (cat: string) => {
    setSelectedCategories(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
  };

  return (
    <div className="feedback-panel-overlay" onClick={onClose}>
      <div className="feedback-panel" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="panel-header">
          <div className="panel-title">
            <MessageSquare size={16} />
            <span>Analyst Feedback</span>
          </div>
          <button className="close-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Story Summary */}
        <div className="story-summary">
          <h3>{story.title}</h3>
          <div className="story-meta">
            <span className="source">{story.source_name}</span>
            <span className="dot">-</span>
            <span className="time">{story.published_at ? new Date(story.published_at).toLocaleString() : 'Unknown'}</span>
          </div>
        </div>

        {/* Classification */}
        <div className="feedback-section">
          <label className="section-label">
            <Shield size={14} />
            Classification Decision
          </label>
          <div className="classification-options">
            <button
              className={`class-btn confirm ${classification === 'confirm' ? 'active' : ''}`}
              onClick={() => setClassification('confirm')}
            >
              <CheckCircle2 size={16} />
              <span>Confirm</span>
              <small>Accurate & relevant</small>
            </button>
            <button
              className={`class-btn reject ${classification === 'reject' ? 'active' : ''}`}
              onClick={() => setClassification('reject')}
            >
              <XCircle size={16} />
              <span>Reject</span>
              <small>Irrelevant / incorrect</small>
            </button>
            <button
              className={`class-btn flag ${classification === 'flag' ? 'active' : ''}`}
              onClick={() => setClassification('flag')}
            >
              <Flag size={16} />
              <span>Flag</span>
              <small>Needs senior review</small>
            </button>
          </div>
        </div>

        {/* Confidence Rating */}
        <div className="feedback-section">
          <label className="section-label">
            <Star size={14} />
            Information Confidence (1-5)
          </label>
          <div className="rating-slider">
            <input
              type="range"
              min="1"
              max="5"
              value={confidence}
              onChange={e => setConfidence(Number(e.target.value))}
            />
            <div className="rating-labels">
              <span>Unverified</span>
              <span className="current">{confidence}</span>
              <span>Confirmed</span>
            </div>
          </div>
        </div>

        {/* Source Reliability */}
        <div className="feedback-section">
          <label className="section-label">
            <Eye size={14} />
            Source Reliability (A-F)
          </label>
          <div className="rating-slider">
            <input
              type="range"
              min="1"
              max="6"
              value={sourceReliability}
              onChange={e => setSourceReliability(Number(e.target.value))}
            />
            <div className="rating-labels">
              <span>F - Unreliable</span>
              <span className="current">{['F', 'E', 'D', 'C', 'B', 'A'][sourceReliability - 1]}</span>
              <span>A - Reliable</span>
            </div>
          </div>
        </div>

        {/* Threat Level */}
        <div className="feedback-section">
          <label className="section-label">
            <AlertTriangle size={14} />
            Threat Assessment
          </label>
          <div className="threat-options">
            {THREAT_LEVELS.map(level => (
              <button
                key={level.value}
                className={`threat-btn ${threatLevel === level.value ? 'active' : ''}`}
                style={{ '--threat-color': level.color } as React.CSSProperties}
                onClick={() => setThreatLevel(level.value)}
              >
                {level.label}
              </button>
            ))}
          </div>
        </div>

        {/* Categories */}
        <div className="feedback-section">
          <label className="section-label">
            <Tag size={14} />
            Categories
          </label>
          <div className="category-chips">
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                className={`category-chip ${selectedCategories.includes(cat) ? 'active' : ''}`}
                onClick={() => toggleCategory(cat)}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Entity Linking */}
        <div className="feedback-section">
          <label className="section-label">
            <Link2 size={14} />
            Link Entities
          </label>
          <div className="entity-input-group">
            <input
              type="text"
              placeholder="Enter entity name..."
              value={entityInput}
              onChange={e => setEntityInput(e.target.value)}
              onKeyPress={e => e.key === 'Enter' && addEntity()}
            />
            <button onClick={addEntity}>Add</button>
          </div>
          {linkedEntities.length > 0 && (
            <div className="linked-entities">
              {linkedEntities.map(entity => (
                <span key={entity} className="entity-tag">
                  {entity}
                  <button onClick={() => setLinkedEntities(prev => prev.filter(e => e !== entity))}>
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Notes */}
        <div className="feedback-section">
          <label className="section-label">
            <MessageSquare size={14} />
            Analyst Notes
          </label>
          <textarea
            placeholder="Add analysis notes, context, or observations..."
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
          />
        </div>

        {/* Submit */}
        <div className="panel-footer">
          <button className="cancel-btn" onClick={onClose}>Cancel</button>
          <button
            className="submit-btn"
            onClick={handleSubmit}
            disabled={!classification}
          >
            Submit Feedback
            <ChevronRight size={16} />
          </button>
        </div>

        <style>{`
          .feedback-panel-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.6);
            backdrop-filter: blur(4px);
            z-index: 100;
            display: flex;
            justify-content: flex-end;
          }

          .feedback-panel {
            width: 420px;
            max-width: 100%;
            height: 100%;
            background: #121216;
            border-left: 1px solid rgba(255, 255, 255, 0.08);
            display: flex;
            flex-direction: column;
            overflow: hidden;
          }

          @media (max-width: 640px) {
            .feedback-panel {
              width: 100%;
            }
          }

          .panel-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px 20px;
            background: linear-gradient(180deg, rgba(59, 130, 246, 0.08) 0%, transparent 100%);
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          }

          .panel-title {
            display: flex;
            align-items: center;
            gap: 10px;
            font-weight: 600;
            color: #fff;
          }

          .panel-title svg {
            color: #60a5fa;
          }

          .close-btn {
            padding: 6px;
            background: transparent;
            border: none;
            color: #6b6b6b;
            cursor: pointer;
            border-radius: 6px;
            transition: all 0.15s ease;
          }

          .close-btn:hover {
            background: rgba(255, 255, 255, 0.08);
            color: #fff;
          }

          .story-summary {
            padding: 16px 20px;
            background: rgba(255, 255, 255, 0.02);
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          }

          .story-summary h3 {
            font-size: 14px;
            font-weight: 600;
            color: #fff;
            line-height: 1.4;
            margin: 0 0 8px;
          }

          .story-meta {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 12px;
            color: #6b6b6b;
          }

          .story-meta .source {
            color: #60a5fa;
          }

          .feedback-panel > div:not(.panel-header):not(.story-summary):not(.panel-footer) {
            overflow-y: auto;
            flex: 1;
          }

          .feedback-section {
            padding: 16px 20px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.04);
          }

          .section-label {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 11px;
            font-weight: 600;
            color: #8b8b8b;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 12px;
          }

          .section-label svg {
            color: #6b6b6b;
          }

          .classification-options {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
          }

          .class-btn {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
            padding: 12px 8px;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.15s ease;
          }

          .class-btn span {
            font-size: 12px;
            font-weight: 600;
            color: #fff;
          }

          .class-btn small {
            font-size: 10px;
            color: #6b6b6b;
            text-align: center;
          }

          .class-btn.confirm:hover, .class-btn.confirm.active {
            background: rgba(34, 197, 94, 0.15);
            border-color: rgba(34, 197, 94, 0.3);
          }
          .class-btn.confirm svg { color: #4ade80; }

          .class-btn.reject:hover, .class-btn.reject.active {
            background: rgba(239, 68, 68, 0.15);
            border-color: rgba(239, 68, 68, 0.3);
          }
          .class-btn.reject svg { color: #f87171; }

          .class-btn.flag:hover, .class-btn.flag.active {
            background: rgba(234, 179, 8, 0.15);
            border-color: rgba(234, 179, 8, 0.3);
          }
          .class-btn.flag svg { color: #facc15; }

          .rating-slider {
            display: flex;
            flex-direction: column;
            gap: 8px;
          }

          .rating-slider input[type="range"] {
            width: 100%;
            height: 6px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 3px;
            -webkit-appearance: none;
          }

          .rating-slider input[type="range"]::-webkit-slider-thumb {
            -webkit-appearance: none;
            width: 16px;
            height: 16px;
            background: #60a5fa;
            border-radius: 50%;
            cursor: pointer;
          }

          .rating-labels {
            display: flex;
            justify-content: space-between;
            font-size: 10px;
            color: #6b6b6b;
          }

          .rating-labels .current {
            font-weight: 700;
            color: #60a5fa;
            font-size: 14px;
          }

          .threat-options {
            display: flex;
            gap: 8px;
          }

          .threat-btn {
            flex: 1;
            padding: 8px 12px;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 6px;
            color: #8b8b8b;
            font-size: 11px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.15s ease;
          }

          .threat-btn:hover {
            border-color: var(--threat-color);
            color: var(--threat-color);
          }

          .threat-btn.active {
            background: color-mix(in srgb, var(--threat-color) 15%, transparent);
            border-color: var(--threat-color);
            color: var(--threat-color);
          }

          .category-chips {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
          }

          .category-chip {
            padding: 6px 12px;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 16px;
            color: #8b8b8b;
            font-size: 11px;
            cursor: pointer;
            transition: all 0.15s ease;
          }

          .category-chip:hover {
            background: rgba(255, 255, 255, 0.06);
            color: #fff;
          }

          .category-chip.active {
            background: rgba(59, 130, 246, 0.15);
            border-color: rgba(59, 130, 246, 0.3);
            color: #60a5fa;
          }

          .entity-input-group {
            display: flex;
            gap: 8px;
          }

          .entity-input-group input {
            flex: 1;
            padding: 8px 12px;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 6px;
            color: #fff;
            font-size: 13px;
          }

          .entity-input-group input::placeholder {
            color: #4b4b4b;
          }

          .entity-input-group button {
            padding: 8px 16px;
            background: rgba(59, 130, 246, 0.15);
            border: 1px solid rgba(59, 130, 246, 0.3);
            border-radius: 6px;
            color: #60a5fa;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
          }

          .linked-entities {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-top: 10px;
          }

          .entity-tag {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 4px 8px 4px 12px;
            background: rgba(139, 92, 246, 0.15);
            border: 1px solid rgba(139, 92, 246, 0.3);
            border-radius: 16px;
            color: #a78bfa;
            font-size: 11px;
          }

          .entity-tag button {
            padding: 2px;
            background: transparent;
            border: none;
            color: inherit;
            cursor: pointer;
            opacity: 0.6;
          }

          .entity-tag button:hover {
            opacity: 1;
          }

          textarea {
            width: 100%;
            padding: 12px;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 8px;
            color: #fff;
            font-size: 13px;
            resize: none;
            font-family: inherit;
          }

          textarea::placeholder {
            color: #4b4b4b;
          }

          .panel-footer {
            display: flex;
            gap: 12px;
            padding: 16px 20px;
            background: rgba(0, 0, 0, 0.3);
            border-top: 1px solid rgba(255, 255, 255, 0.06);
          }

          .cancel-btn {
            flex: 1;
            padding: 12px;
            background: transparent;
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            color: #8b8b8b;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
          }

          .cancel-btn:hover {
            background: rgba(255, 255, 255, 0.05);
            color: #fff;
          }

          .submit-btn {
            flex: 2;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 12px;
            background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
            border: none;
            border-radius: 8px;
            color: #fff;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.15s ease;
          }

          .submit-btn:hover:not(:disabled) {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
          }

          .submit-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
        `}</style>
      </div>
    </div>
  );
}
