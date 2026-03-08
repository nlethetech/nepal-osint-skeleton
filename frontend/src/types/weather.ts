// Weather Types for DHM Nepal API

export interface BilingualText {
  en: string | null;
  np: string | null;
}

export interface WeatherCondition {
  condition: string;
  icon: string;
  description: string;
  regions_affected: string[];
}

export interface WeatherForecast {
  id: string;
  dhm_id: string;
  issue_date: string;
  analysis: BilingualText;
  forecast_today: BilingualText;
  forecast_tomorrow: BilingualText;
  special_notice: string | null;
  issued_by: string | null;
  updated_by: string | null;
  fetched_at: string;
  data_source: string;
}

export interface WeatherSummary {
  issue_date: string;
  condition: WeatherCondition;
  forecast_today_en: string;
  forecast_tomorrow_en: string;
  special_notice: string | null;
  issued_by: string | null;
  data_source: string;
  last_updated: string;
}

export interface WeatherHistory {
  forecasts: WeatherForecast[];
  total: number;
}
