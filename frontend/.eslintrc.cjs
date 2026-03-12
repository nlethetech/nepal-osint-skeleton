module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'react-hooks', 'react-refresh', '@blueprintjs'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', 'node_modules'],
  rules: {
    // Keep lint usable on an existing codebase; tighten later once clean.
    '@typescript-eslint/no-unused-vars': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    'react-hooks/exhaustive-deps': 'off',
    'react-refresh/only-export-components': 'off',
    'no-useless-escape': 'off',
  },
  overrides: [
    {
      files: [
        'src/pages/CorporateIntel.tsx',
        'src/pages/TradeAnalysis.tsx',
        'src/pages/DamageAssessment.tsx',
        'src/components/common/NaradaNavbar.tsx',
        'src/components/layout/AnalystShell.tsx',
        'src/components/ui/narada-ui.tsx',
        'src/components/corporate/CompanyExplorer.tsx',
        'src/components/connected-analyst/ConnectedAnalystWorkspace.tsx',
      ],
      rules: {
        '@blueprintjs/classes-constants': 'warn',
        '@blueprintjs/no-deprecated-components': 'error',
        '@blueprintjs/html-components': 'warn',
      },
    },
  ],
}
