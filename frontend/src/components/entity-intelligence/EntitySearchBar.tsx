import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, User, Users, Building, Landmark, X } from 'lucide-react'
import { autocompleteEntities, fuzzySearchEntities, type SearchResult } from '../../api/entityIntelligence'

const ENTITY_TYPE_ICONS: Record<string, typeof User> = {
  person: User,
  party: Users,
  organization: Building,
  institution: Landmark,
}

interface EntitySearchBarProps {
  onSelect: (entity: SearchResult) => void
  placeholder?: string
  autoFocus?: boolean
  className?: string
}

export function EntitySearchBar({
  onSelect,
  placeholder = 'Search entities...',
  autoFocus = false,
  className = '',
}: EntitySearchBarProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [inputFocused, setInputFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Debounced search
  useEffect(() => {
    if (query.length < 2) {
      setResults([])
      setIsOpen(false)
      return
    }

    const timer = setTimeout(async () => {
      setIsLoading(true)
      try {
        const data = await fuzzySearchEntities(query, { limit: 10 })
        setResults(data)
        setIsOpen(true)
        setSelectedIndex(0)
      } catch (error) {
        console.error('Search error:', error)
        setResults([])
      } finally {
        setIsLoading(false)
      }
    }, 200)

    return () => clearTimeout(timer)
  }, [query])

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen || results.length === 0) return

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((prev) => (prev + 1) % results.length)
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((prev) => (prev - 1 + results.length) % results.length)
          break
        case 'Enter':
          e.preventDefault()
          if (results[selectedIndex]) {
            handleSelect(results[selectedIndex])
          }
          break
        case 'Escape':
          e.preventDefault()
          setIsOpen(false)
          break
      }
    },
    [isOpen, results, selectedIndex]
  )

  const handleSelect = (entity: SearchResult) => {
    onSelect(entity)
    setQuery('')
    setIsOpen(false)
    setResults([])
  }

  const getTrendColor = (trend: string) => {
    switch (trend) {
      case 'rising': return 'text-green-400'
      case 'falling': return 'text-red-400'
      default: return 'text-gray-400'
    }
  }

  const getMatchTypeBadge = (matchType: string) => {
    switch (matchType) {
      case 'exact':
      case 'canonical':
        return <span className="px-1 py-0.5 text-[8px] bg-green-500/20 text-green-400 rounded">EXACT</span>
      case 'prefix':
        return <span className="px-1 py-0.5 text-[8px] bg-blue-500/20 text-blue-400 rounded">PREFIX</span>
      default:
        return null
    }
  }

  return (
    <div className={`relative ${className}`}>
      <div className="relative">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2"
          style={{ color: '#b6bcc8' }}
        />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => {
            setInputFocused(true)
            query.length >= 2 && setIsOpen(true)
          }}
          onBlur={() => setInputFocused(false)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className="w-full rounded-lg pl-9 pr-8 py-2 text-xs focus:outline-none transition-colors"
          style={{
            backgroundColor: '#1a1a1c',
            border: inputFocused ? '1px solid #5c7cba' : '1px solid #252528',
            color: '#e8e8ea',
          }}
        />
        {query && (
          <button
            onClick={() => {
              setQuery('')
              setResults([])
              setIsOpen(false)
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1"
            style={{ color: '#b6bcc8' }}
          >
            <X size={12} />
          </button>
        )}
        {isLoading && (
          <div className="absolute right-8 top-1/2 -translate-y-1/2">
            <div
              className="w-3 h-3 border-2 border-t-transparent rounded-full animate-spin"
              style={{ borderColor: '#5c7cba', borderTopColor: 'transparent' }}
            />
          </div>
        )}
      </div>

      {/* Results Dropdown */}
      {isOpen && results.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute top-full left-0 right-0 mt-1 rounded-lg z-50 max-h-80 overflow-y-auto"
          style={{
            backgroundColor: '#1a1a1c',
            border: '1px solid #252528',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          }}
        >
          {results.map((result, index) => {
            const Icon = ENTITY_TYPE_ICONS[result.entity_type] || User
            const isSelected = index === selectedIndex

            return (
              <button
                key={result.id}
                onClick={() => handleSelect(result)}
                onMouseEnter={() => setSelectedIndex(index)}
                className="w-full flex items-center gap-3 px-3 py-2 text-left transition-colors"
                style={{
                  backgroundColor: isSelected ? 'rgba(92,124,186,0.15)' : 'transparent',
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'
                }}
              >
                {/* Avatar/Icon */}
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: '#141416' }}
                >
                  {result.image_url ? (
                    <img
                      src={result.image_url}
                      alt={result.name_en}
                      className="w-8 h-8 rounded-full object-cover"
                    />
                  ) : (
                    <Icon size={14} style={{ color: '#b6bcc8' }} />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium truncate" style={{ color: '#e8e8ea' }}>
                      {result.name_en}
                    </span>
                    {getMatchTypeBadge(result.match_type)}
                  </div>
                  <div className="flex items-center gap-2 text-[10px]" style={{ color: '#b6bcc8' }}>
                    <span className="capitalize">{result.entity_type}</span>
                    {result.party && (
                      <>
                        <span>•</span>
                        <span>{result.party}</span>
                      </>
                    )}
                    {result.role && (
                      <>
                        <span>•</span>
                        <span className="truncate">{result.role}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Stats */}
                <div className="flex items-center gap-2 text-[10px] flex-shrink-0">
                  <span style={{ color: '#b6bcc8' }}>
                    {result.mentions_24h} mentions/24h
                  </span>
                  <span className={getTrendColor(result.trend)}>
                    {result.trend === 'rising' ? '↑' : result.trend === 'falling' ? '↓' : '→'}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* No Results */}
      {isOpen && query.length >= 2 && results.length === 0 && !isLoading && (
        <div
          className="absolute top-full left-0 right-0 mt-1 rounded-lg z-50 p-4 text-center"
          style={{
            backgroundColor: '#1a1a1c',
            border: '1px solid #252528',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          }}
        >
          <p className="text-xs" style={{ color: '#b6bcc8' }}>No entities found</p>
        </div>
      )}
    </div>
  )
}
