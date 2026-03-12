import { apiClient } from './client'

// News & Social
export const triggerRssIngestion = (priorityOnly: boolean = false) =>
  apiClient.post(`/stories/ingest${priorityOnly ? '?priority_only=true' : ''}`)

export const triggerWebScraping = () =>
  apiClient.post('/ingest/scrape-all')

export const triggerNitterAccounts = () =>
  apiClient.post('/twitter/nitter/scrape-accounts')

export const triggerNitterHashtags = () =>
  apiClient.post('/twitter/nitter/scrape-hashtags')

// Disasters & Environment
export const triggerBipadIngestion = () =>
  apiClient.post('/disasters/ingest')

export const triggerGeeChangeDetection = () =>
  apiClient.post('/earth-engine/change-detection/run')

// Elections & Parliament
export const triggerParliamentSync = () =>
  apiClient.post('/parliament/admin/sync?scope=all')

export const triggerRecalculateScores = () =>
  apiClient.post('/parliament/admin/sync?scope=score')

// Intelligence
export const triggerAnalystAgent = (hours: number = 3) =>
  apiClient.post(`/admin/analyst-agent/run?hours=${hours}`)

// Status
export const fetchNitterStatus = () =>
  apiClient.get('/twitter/nitter/status')
