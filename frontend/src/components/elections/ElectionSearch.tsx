/**
 * ElectionSearch - Search candidates and constituencies
 *
 * Searches both local election data (by Nepali/English name) and the
 * KB entity database for richer results with romanized name matching.
 */

import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { Search, User, MapPin, Database } from 'lucide-react'
import { useElectionStore } from '../../stores/electionStore'
import { getPartyColor } from './partyColors'
import { searchKBEntities, type KBEntity } from '../../api/kbEntities'

interface SearchResult {
  type: 'candidate' | 'constituency' | 'kb-entity'
  id: string
  name: string
  nameNe?: string
  subtitle: string
  party?: string
  district?: string
  entityType?: string
}

export function ElectionSearch() {
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [kbResults, setKbResults] = useState<SearchResult[]>([])
  const [kbLoading, setKbLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { constituencyResults, selectCandidate, selectConstituency } = useElectionStore()

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Debounced KB entity search
  const searchKB = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (q.length < 2) {
      setKbResults([])
      return
    }

    debounceRef.current = setTimeout(async () => {
      setKbLoading(true)
      try {
        const entities = await searchKBEntities(q, undefined, 10)
        const mapped: SearchResult[] = entities.map((e: KBEntity) => ({
          type: 'kb-entity' as const,
          id: e.id,
          name: e.canonical_name,
          nameNe: e.canonical_name_ne || undefined,
          subtitle: `${e.entity_type} · ${e.total_mentions} mentions`,
          entityType: e.entity_type,
        }))
        setKbResults(mapped)
      } catch {
        setKbResults([])
      } finally {
        setKbLoading(false)
      }
    }, 300)
  }, [])

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [])

  // Local search results (both name_en and name_ne)
  const localResults = useMemo(() => {
    if (query.length < 2) return []

    const q = query.toLowerCase()
    const matches: SearchResult[] = []
    const seenDistricts = new Set<string>()

    for (const [, result] of constituencyResults) {
      // Match constituency/district
      if (
        result.name_en.toLowerCase().includes(q) ||
        result.district.toLowerCase().includes(q) ||
        (result.name_ne && result.name_ne.includes(query))
      ) {
        if (!seenDistricts.has(result.district)) {
          seenDistricts.add(result.district)
          matches.push({
            type: 'constituency',
            id: result.district,
            name: result.district,
            subtitle: `${result.province} · ${Array.from(constituencyResults.values()).filter(r => r.district === result.district).length} constituencies`,
            district: result.district,
          })
        }
      }

      // Match candidates by name_en_roman (English), name_en (Nepali), name_ne, or aliases
      for (const c of result.candidates) {
        const nameRoman = c.name_en_roman?.toLowerCase() || ''
        const nameEn = c.name_en.toLowerCase()
        const nameNe = c.name_ne || ''
        const aliasMatch = c.aliases?.some(alias => alias.toLowerCase().includes(q))

        if (
          nameRoman.includes(q) ||  // English romanized name
          nameEn.includes(q) ||     // name_en field
          c.name_en.includes(query) ||  // Nepali text search
          nameNe.includes(query) ||  // Nepali name
          aliasMatch  // Aliases (KP Oli, Prachanda, etc.)
        ) {
          matches.push({
            type: 'candidate',
            id: c.id,
            name: c.name_en_roman || c.name_en,  // Prefer English name
            nameNe: c.name_ne || c.name_en,
            subtitle: `${result.name_en} · ${c.votes > 0 ? c.votes.toLocaleString() + ' votes' : c.party}`,
            party: c.party,
            district: result.district,
          })
        }
      }

      if (matches.length >= 15) break
    }

    // Sort: districts first, then candidates
    return matches.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'constituency' ? -1 : 1
      return 0
    }).slice(0, 12)
  }, [query, constituencyResults])

  // Trigger KB search when query changes
  useEffect(() => {
    searchKB(query)
  }, [query, searchKB])

  // Merge local + KB results (deduplicate by name)
  const allResults = useMemo(() => {
    const results = [...localResults]
    const localNames = new Set(localResults.map(r => r.name.toLowerCase()))

    // Add KB results that aren't already in local results
    for (const kb of kbResults) {
      const nameCheck = kb.name.toLowerCase()
      const neCheck = kb.nameNe?.toLowerCase()
      if (!localNames.has(nameCheck) && !(neCheck && localNames.has(neCheck))) {
        results.push(kb)
      }
    }

    return results.slice(0, 15)
  }, [localResults, kbResults])

  const handleSelect = (result: SearchResult) => {
    if (result.type === 'candidate') {
      selectCandidate(result.id)
    } else if (result.type === 'constituency') {
      selectConstituency(result.id)
    } else if (result.type === 'kb-entity') {
      // Try to find matching candidate in local data by KB name
      const kbName = result.name.toLowerCase()
      const kbNameNe = result.nameNe?.toLowerCase()
      for (const [, cr] of constituencyResults) {
        for (const c of cr.candidates) {
          const cName = c.name_en.toLowerCase()
          const cNameNe = c.name_ne?.toLowerCase()
          if (cName === kbName || cName === kbNameNe || cNameNe === kbName || cNameNe === kbNameNe) {
            selectCandidate(c.id)
            setQuery('')
            setIsOpen(false)
            return
          }
        }
      }
      // If no local match, try district match
      for (const [, cr] of constituencyResults) {
        if (cr.district.toLowerCase() === kbName) {
          selectConstituency(cr.district)
          setQuery('')
          setIsOpen(false)
          return
        }
      }
    }
    setQuery('')
    setIsOpen(false)
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-1.5 bg-osint-surface border border-osint-border rounded-lg px-2.5 py-1.5">
        <Search size={12} className="text-osint-muted flex-shrink-0" />
        <input
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setIsOpen(true) }}
          onFocus={() => setIsOpen(true)}
          placeholder="Search candidates, districts..."
          className="bg-transparent text-xs text-osint-text placeholder:text-osint-muted outline-none w-[160px]"
        />
        {kbLoading && (
          <div className="w-3 h-3 border border-osint-muted border-t-transparent rounded-full animate-spin flex-shrink-0" />
        )}
      </div>

      {/* Dropdown */}
      {isOpen && allResults.length > 0 && (
        <div className="absolute top-full right-0 mt-1 bg-osint-card border border-osint-border rounded-lg shadow-xl z-[1200] max-h-[320px] overflow-y-auto w-[300px]">
          {allResults.map((r, i) => (
            <button
              key={`${r.type}-${r.id}-${i}`}
              onClick={() => handleSelect(r)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-osint-surface/50 transition-colors border-b border-osint-border/30 last:border-0"
            >
              <div className="w-5 h-5 rounded-full bg-osint-surface flex items-center justify-center flex-shrink-0">
                {r.type === 'candidate' ? (
                  <User size={10} className="text-osint-muted" />
                ) : r.type === 'constituency' ? (
                  <MapPin size={10} className="text-osint-primary" />
                ) : (
                  <Database size={10} className="text-entity-person" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-osint-text truncate">{r.name}</span>
                  {r.type === 'kb-entity' && (
                    <span className="text-[8px] px-1 py-0.5 rounded bg-osint-primary/10 text-osint-primary flex-shrink-0">
                      KB
                    </span>
                  )}
                </div>
                <div className="text-[9px] text-osint-muted truncate">
                  {r.nameNe && r.nameNe !== r.name ? `${r.nameNe} · ` : ''}{r.subtitle}
                </div>
              </div>
              {r.party && (
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: getPartyColor(r.party) }}
                />
              )}
              {r.entityType && !r.party && (
                <span className="text-[8px] text-osint-muted flex-shrink-0">{r.entityType}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* No results */}
      {isOpen && query.length >= 2 && allResults.length === 0 && !kbLoading && (
        <div className="absolute top-full right-0 mt-1 bg-osint-card border border-osint-border rounded-lg shadow-xl z-[1200] px-3 py-2 w-[300px]">
          <span className="text-[10px] text-osint-muted">No results for "{query}"</span>
        </div>
      )}
    </div>
  )
}
