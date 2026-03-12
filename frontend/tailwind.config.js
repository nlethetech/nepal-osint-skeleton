/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Blueprint native dark palette — single source of truth
        'bp': {
          'bg':             '#111418',
          'card':           '#1C2127',
          'surface':        '#252A31',
          'hover':          '#2F343C',
          'border':         '#404854',
          'border-strong':  '#5F6B7C',
          'text':           '#F6F7F9',
          'text-secondary': '#ABB3BF',
          'text-muted':     '#738091',
          'text-disabled':  '#5F6B7C',
          'primary':        '#2D72D2',
          'primary-hover':  '#4C90F0',
          'success':        '#238551',
          'warning':        '#C87619',
          'danger':         '#CD4246',
        },
        // Severity — desaturated Blueprint tones
        'severity': {
          'critical': '#CD4246',
          'high':     '#C87619',
          'medium':   '#D1980B',
          'low':      '#238551',
        },
        // Entity colors — updated to complement Blueprint
        'entity': {
          'person':       '#CD4246',
          'organization': '#C87619',
          'location':     '#238551',
          'district':     '#2D72D2',
          'event':        '#D1980B',
        },
        // Backward-compat aliases — osint-* maps to bp-*
        'osint': {
          'bg':             '#111418',
          'bg-elevated':    '#1C2127',
          'card':           '#1C2127',
          'surface':        '#252A31',
          'surface-hover':  '#2F343C',
          'border':         '#404854',
          'border-strong':  '#5F6B7C',
          'text':           '#F6F7F9',
          'text-secondary': '#ABB3BF',
          'muted':          '#738091',
          'primary':        '#2D72D2',
          'primary-hover':  '#4C90F0',
          'primary-dim':    '#215DB0',
          'accent':         '#2D72D2',
        },
        // Analyst palette — aligned with Blueprint
        'analyst': {
          'bg':            '#111418',
          'surface':       '#1C2127',
          'border':        '#404854',
          'marker-bg':     '#1C2127',
          'marker-border': '#404854',
          'critical':      '#CD4246',
          'high':          '#C87619',
          'medium':        '#2D72D2',
          'low':           '#238551',
          'text':          '#F6F7F9',
          'muted':         '#738091',
        },
      },
      borderRadius: {
        'sm': '3px',
        'DEFAULT': '4px',
        'md': '5px',
        'lg': '6px',
        'xl': '8px',
      },
      boxShadow: {
        'card': '0 1px 2px rgba(0, 0, 0, 0.2)',
        'card-hover': '0 2px 8px rgba(0, 0, 0, 0.3)',
        'lg': '0 4px 12px rgba(0, 0, 0, 0.4)',
      },
      fontFamily: {
        'sans': ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        'mono': ['JetBrains Mono', 'Consolas', 'monospace'],
      },
      fontSize: {
        'xs': ['11px', '16px'],
        'sm': ['13px', '18px'],
        'base': ['14px', '20px'],
        'lg': ['16px', '24px'],
        'xl': ['18px', '26px'],
        '2xl': ['20px', '28px'],
      },
      animation: {
        'scroll-left': 'scroll-left 40s linear infinite',
      },
      keyframes: {
        'scroll-left': {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(-100%)' },
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
