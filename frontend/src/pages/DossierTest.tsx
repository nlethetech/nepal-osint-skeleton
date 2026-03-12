/**
 * Dossier Test Page
 *
 * Quick access to 5 candidate dossiers for testing:
 * 1. Former PM (Sher Bahadur Deuba - 5 terms) - 2079 data
 * 2. Former PM with speeches (KP Oli - 3 terms, 3 speeches)
 * 3. Experienced MP (Bishnu Poudel - 15 bills)
 * 4. RSP Founder (Rabi Lamichhane - won 2079)
 * 5. Balen Shah (Mayor, 2082 candidate)
 */

import { useNavigate } from 'react-router-dom'

interface TestCandidate {
  id: string
  name: string
  nameNe: string
  party: string
  type: string
  description: string
  color: string
  note?: string
}

const TEST_CANDIDATES: TestCandidate[] = [
  {
    id: '335012',
    name: 'Sher Bahadur Deuba',
    nameNe: 'शेर बहादुर देउवा',
    party: 'Nepali Congress',
    type: 'Former PM',
    description: '5-time Prime Minister',
    color: 'bg-red-600 hover:bg-red-700',
    note: '2079 data (not running 2082)',
  },
  {
    id: '333583',
    name: 'K.P. Sharma Oli',
    nameNe: 'के.पी शर्मा ओली',
    party: 'CPN-UML',
    type: 'Former PM',
    description: '3-time PM, 3 speeches tracked',
    color: 'bg-blue-600 hover:bg-blue-700',
  },
  {
    id: '334366',
    name: 'Bishnu Prasad Poudel',
    nameNe: 'विष्‍णु प्रसाद पौडेल',
    party: 'CPN-UML',
    type: 'Veteran MP',
    description: '15 bills introduced, top scorer',
    color: 'bg-purple-600 hover:bg-purple-700',
  },
  {
    id: '335208',
    name: 'Rabi Lamichhane',
    nameNe: 'रबि लामिछाने',
    party: 'Rastriya Swatantra Party',
    type: '2079 Winner',
    description: 'RSP founder, Deputy PM, 49,300 votes',
    color: 'bg-orange-600 hover:bg-orange-700',
  },
  {
    id: '339653',
    name: 'Balen Shah',
    nameNe: 'वालेन्द्र शाह',
    party: 'Rastriya Swatantra Party',
    type: '2082 Candidate',
    description: 'Kathmandu Mayor, rapper, engineer',
    color: 'bg-emerald-600 hover:bg-emerald-700',
    note: 'New to Parliament',
  },
]

export default function DossierTest() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-slate-900 p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold text-white mb-2">
            Candidate Dossier Testing
          </h1>
          <p className="text-slate-400">
            Quick access to different candidate types for testing parliament data
          </p>
        </div>

        {/* Candidate Grid */}
        <div className="grid gap-4">
          {TEST_CANDIDATES.map((candidate) => (
            <button
              key={candidate.id}
              onClick={() => navigate(`/dossier/candidate/${candidate.id}`)}
              className={`${candidate.color} rounded-xl p-6 text-left transition-all transform hover:scale-[1.02] hover:shadow-xl`}
            >
              <div className="flex items-start justify-between">
                <div>
                  {/* Type Badge */}
                  <span className="inline-block px-3 py-1 bg-black/20 rounded-full text-xs font-medium text-white/90 mb-3">
                    {candidate.type}
                  </span>

                  {/* Names */}
                  <h2 className="text-xl font-bold text-white mb-1">
                    {candidate.nameNe}
                  </h2>
                  <p className="text-white/80 text-sm mb-2">
                    {candidate.name}
                  </p>

                  {/* Party & Description */}
                  <div className="flex items-center gap-2 text-white/70 text-sm">
                    <span className="font-medium">{candidate.party}</span>
                    <span className="text-white/40">•</span>
                    <span>{candidate.description}</span>
                  </div>

                  {/* Note badge if present */}
                  {candidate.note && (
                    <span className="inline-block mt-2 px-2 py-0.5 bg-black/30 rounded text-xs text-white/60">
                      {candidate.note}
                    </span>
                  )}
                </div>

                {/* Arrow */}
                <div className="text-white/60 text-2xl">
                  →
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="mt-8 text-center">
          <p className="text-slate-500 text-sm">
            Click any card to view the full candidate dossier with parliamentary records
          </p>
          <button
            onClick={() => navigate('/elections')}
            className="mt-4 text-slate-400 hover:text-white text-sm underline"
          >
            ← Back to Election Monitor
          </button>
        </div>
      </div>
    </div>
  )
}
