/**
 * CreateAssessmentModal - Modal for creating new damage assessments
 *
 * Features:
 * - Event name and type selection
 * - Date pickers for event and baseline periods
 * - Location input with bbox coordinates
 * - District selection with search
 */

import { useState, useMemo } from 'react';
import {
  X,
  Calendar,
  MapPin,
  Tag as TagIcon,
  AlertTriangle,
  Flame,
  CloudRain,
  Mountain,
  Zap,
  Building2,
  Search,
  type LucideIcon,
} from 'lucide-react';
import { Button, HTMLSelect, Intent, Spinner } from '@blueprintjs/core';
import type { CreateAssessmentParams, DamageType } from '../../api/damageAssessment';

interface CreateAssessmentModalProps {
  onClose: () => void;
  onSubmit: (data: CreateAssessmentParams) => void;
  isSubmitting: boolean;
}

const DAMAGE_TYPES: { value: DamageType; label: string; icon: LucideIcon; description: string }[] = [
  { value: 'civil_unrest', label: 'Civil Unrest', icon: Flame, description: 'Protests, riots, arson, vandalism' },
  { value: 'natural_disaster', label: 'Natural Disaster', icon: CloudRain, description: 'Floods, storms, earthquakes' },
  { value: 'structural', label: 'Structural', icon: Building2, description: 'Building collapse, demolition' },
  { value: 'infrastructure', label: 'Infrastructure', icon: Zap, description: 'Roads, bridges, utilities' },
  { value: 'environmental', label: 'Environmental', icon: Mountain, description: 'Landslides, contamination' },
];

const NEPAL_DISTRICTS = [
  'Achham', 'Arghakhanchi', 'Baglung', 'Baitadi', 'Bajhang', 'Bajura', 'Banke', 'Bara',
  'Bardiya', 'Bhaktapur', 'Bhojpur', 'Chitwan', 'Dadeldhura', 'Dailekh', 'Dang', 'Darchula',
  'Dhading', 'Dhankuta', 'Dhanusa', 'Dolakha', 'Dolpa', 'Doti', 'Gorkha', 'Gulmi',
  'Humla', 'Ilam', 'Jajarkot', 'Jhapa', 'Jumla', 'Kailali', 'Kalikot', 'Kanchanpur',
  'Kapilvastu', 'Kaski', 'Kathmandu', 'Kavrepalanchok', 'Khotang', 'Lalitpur', 'Lamjung', 'Mahottari',
  'Makwanpur', 'Manang', 'Morang', 'Mugu', 'Mustang', 'Myagdi', 'Nawalparasi', 'Nuwakot',
  'Okhaldhunga', 'Palpa', 'Panchthar', 'Parbat', 'Parsa', 'Pyuthan', 'Ramechhap', 'Rasuwa',
  'Rautahat', 'Rolpa', 'Rukum', 'Rupandehi', 'Salyan', 'Sankhuwasabha', 'Saptari', 'Sarlahi',
  'Sindhuli', 'Sindhupalchok', 'Siraha', 'Solukhumbu', 'Sunsari', 'Surkhet', 'Syangja', 'Tanahu',
  'Taplejung', 'Terhathum', 'Udayapur',
];

// Default bounding boxes for major areas
const PRESET_LOCATIONS: Record<string, { bbox: [number, number, number, number]; center: [number, number]; label: string; district?: string }> = {
  singha_durbar: {
    bbox: [85.318, 27.697, 85.328, 27.705],
    center: [27.701, 85.323],
    label: 'Singha Durbar (Government Complex)',
    district: 'Kathmandu',
  },
  kathmandu_valley: {
    bbox: [85.25, 27.65, 85.40, 27.75],
    center: [27.7, 85.32],
    label: 'Kathmandu Valley',
    district: 'Kathmandu',
  },
  pokhara: {
    bbox: [83.95, 28.18, 84.02, 28.24],
    center: [28.21, 83.985],
    label: 'Pokhara',
    district: 'Kaski',
  },
  biratnagar: {
    bbox: [87.25, 26.43, 87.32, 26.50],
    center: [26.465, 87.285],
    label: 'Biratnagar',
    district: 'Morang',
  },
  birgunj: {
    bbox: [84.85, 27.00, 84.92, 27.05],
    center: [27.015, 84.88],
    label: 'Birgunj',
    district: 'Parsa',
  },
  custom: {
    bbox: [85.0, 27.5, 85.5, 28.0],
    center: [27.75, 85.25],
    label: 'Custom Area (Enter Coordinates)',
  },
};

export function CreateAssessmentModal({ onClose, onSubmit, isSubmitting }: CreateAssessmentModalProps) {
  // Default to GenZ protest example for testing
  const defaultDate = '2025-09-08';
  const defaultLocation = PRESET_LOCATIONS.singha_durbar;

  const [formData, setFormData] = useState(() => {
    // Calculate baseline dates from default date
    // Uses PWTT defaults: 12-month baseline (365 days), 2-month post-event (60 days)
    const eventDate = new Date(defaultDate);
    const baselineStart = new Date(eventDate);
    baselineStart.setDate(baselineStart.getDate() - 365);  // 12 months baseline (PWTT)
    const baselineEnd = new Date(eventDate);
    baselineEnd.setDate(baselineEnd.getDate() - 1);
    const postEnd = new Date(eventDate);
    postEnd.setDate(postEnd.getDate() + 60);  // 2 months post-event (PWTT)

    return {
      event_name: 'GenZ Protest - Singha Durbar',
      event_type: 'civil_unrest' as DamageType,
      event_date: defaultDate,
      baseline_start: baselineStart.toISOString().split('T')[0],
      baseline_end: baselineEnd.toISOString().split('T')[0],
      post_event_start: defaultDate,
      post_event_end: postEnd.toISOString().split('T')[0],
      districts: ['Kathmandu'] as string[],
      preset_location: 'singha_durbar',
      bbox: defaultLocation.bbox,
      center_lat: defaultLocation.center[0],
      center_lng: defaultLocation.center[1],
      // Custom coordinates for manual entry
      custom_min_lng: '',
      custom_min_lat: '',
      custom_max_lng: '',
      custom_max_lat: '',
    };
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [districtSearch, setDistrictSearch] = useState('');

  // Filter districts based on search
  const filteredDistricts = useMemo(() => {
    if (!districtSearch.trim()) return NEPAL_DISTRICTS;
    const search = districtSearch.toLowerCase();
    return NEPAL_DISTRICTS.filter((d) => d.toLowerCase().includes(search));
  }, [districtSearch]);

  // Update dates when event date changes
  // Uses PWTT defaults: 12-month baseline (365 days), 2-month post-event (60 days)
  const handleEventDateChange = (date: string) => {
    const eventDate = new Date(date);
    const baselineStart = new Date(eventDate);
    baselineStart.setDate(baselineStart.getDate() - 365);  // 12 months baseline (PWTT)
    const baselineEnd = new Date(eventDate);
    baselineEnd.setDate(baselineEnd.getDate() - 1);
    const postStart = new Date(eventDate);
    const postEnd = new Date(eventDate);
    postEnd.setDate(postEnd.getDate() + 60);  // 2 months post-event (PWTT)

    setFormData((prev) => ({
      ...prev,
      event_date: date,
      baseline_start: baselineStart.toISOString().split('T')[0],
      baseline_end: baselineEnd.toISOString().split('T')[0],
      post_event_start: postStart.toISOString().split('T')[0],
      post_event_end: postEnd.toISOString().split('T')[0],
    }));
  };

  // Update bbox when preset location changes
  const handleLocationChange = (preset: string) => {
    const location = PRESET_LOCATIONS[preset] || PRESET_LOCATIONS.custom;
    setFormData((prev) => ({
      ...prev,
      preset_location: preset,
      bbox: location.bbox,
      center_lat: location.center[0],
      center_lng: location.center[1],
      // Auto-select district if preset has one
      districts: location.district && !prev.districts.includes(location.district)
        ? [...prev.districts, location.district]
        : prev.districts,
    }));
  };

  const handleDistrictToggle = (district: string) => {
    setFormData((prev) => ({
      ...prev,
      districts: prev.districts.includes(district)
        ? prev.districts.filter((d) => d !== district)
        : [...prev.districts, district],
    }));
  };

  const handleCustomBboxChange = (field: 'custom_min_lng' | 'custom_min_lat' | 'custom_max_lng' | 'custom_max_lat', value: string) => {
    setFormData((prev) => {
      const updated = { ...prev, [field]: value };
      // Update bbox if all custom fields are filled
      const minLng = parseFloat(updated.custom_min_lng);
      const minLat = parseFloat(updated.custom_min_lat);
      const maxLng = parseFloat(updated.custom_max_lng);
      const maxLat = parseFloat(updated.custom_max_lat);
      if (!isNaN(minLng) && !isNaN(minLat) && !isNaN(maxLng) && !isNaN(maxLat)) {
        updated.bbox = [minLng, minLat, maxLng, maxLat] as [number, number, number, number];
        updated.center_lat = (minLat + maxLat) / 2;
        updated.center_lng = (minLng + maxLng) / 2;
      }
      return updated;
    });
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.event_name.trim()) {
      newErrors.event_name = 'Event name is required';
    }
    if (!formData.event_date) {
      newErrors.event_date = 'Event date is required';
    }
    if (formData.districts.length === 0) {
      newErrors.districts = 'Select at least one district';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('Form submitted, validating...');
    if (!validate()) {
      console.log('Validation failed:', errors);
      return;
    }

    const params = {
      event_name: formData.event_name,
      event_type: formData.event_type,
      event_date: formData.event_date,
      baseline_start: formData.baseline_start,
      baseline_end: formData.baseline_end,
      post_event_start: formData.post_event_start,
      post_event_end: formData.post_event_end,
      districts: formData.districts,
      bbox: formData.bbox,
      center_lat: formData.center_lat,
      center_lng: formData.center_lng,
    };
    console.log('Calling onSubmit with params:', params);
    onSubmit(params);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="bp6-dark relative w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-xl shadow-2xl bg-bp-card border border-bp-border">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-bp-border">
          <div>
            <h2 className="text-lg font-semibold text-bp-text">New Damage Assessment</h2>
            <p className="text-sm text-bp-text-muted">Configure analysis parameters for satellite damage detection</p>
          </div>
          <Button minimal icon={<X size={18} />} onClick={onClose} className="text-bp-text-muted" />
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="overflow-y-auto max-h-[calc(90vh-140px)]">
          <div className="p-6 space-y-6">
            {/* Event Name */}
            <div>
              <label className="block text-sm font-medium mb-2 text-bp-text">
                <TagIcon size={14} className="inline mr-2" />
                Event Name
              </label>
              <input
                type="text"
                value={formData.event_name}
                onChange={(e) => setFormData((prev) => ({ ...prev, event_name: e.target.value }))}
                placeholder="e.g., GenZ Protest - Singha Durbar, Koshi Flood January 2025"
                className={`w-full px-4 py-2.5 rounded-lg placeholder-bp-text-muted focus:outline-none focus:border-bp-primary bg-bp-surface border text-bp-text ${
                  errors.event_name ? 'border-severity-critical' : 'border-bp-border'
                }`}
              />
              {errors.event_name && (
                <p className="mt-1 text-xs text-severity-critical">{errors.event_name}</p>
              )}
            </div>

            {/* Event Type */}
            <div>
              <label className="block text-sm font-medium mb-2 text-bp-text">
                <AlertTriangle size={14} className="inline mr-2" />
                Damage Type
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {DAMAGE_TYPES.map((type) => (
                  <button
                    key={type.value}
                    type="button"
                    onClick={() => setFormData((prev) => ({ ...prev, event_type: type.value }))}
                    className={`flex items-center gap-2 p-3 rounded-lg border transition-colors text-left ${
                      formData.event_type === type.value
                        ? 'border-severity-critical/50 bg-severity-critical/10 text-severity-critical'
                        : 'bg-bp-surface border-bp-border text-bp-text-muted hover:bg-bp-hover'
                    }`}
                  >
                    <type.icon size={18} />
                    <div>
                      <p className="text-sm font-medium">{type.label}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Event Date */}
            <div>
              <label className="block text-sm font-medium mb-2 text-bp-text">
                <Calendar size={14} className="inline mr-2" />
                Event Date
              </label>
              <input
                type="date"
                value={formData.event_date}
                onChange={(e) => handleEventDateChange(e.target.value)}
                className={`w-full px-4 py-2.5 rounded-lg focus:outline-none focus:border-bp-primary bg-bp-surface border text-bp-text ${
                  errors.event_date ? 'border-severity-critical' : 'border-bp-border'
                }`}
              />
              {errors.event_date && (
                <p className="mt-1 text-xs text-severity-critical">{errors.event_date}</p>
              )}
              <p className="mt-1 text-xs text-bp-text-muted">
                Baseline: {formData.baseline_start} to {formData.baseline_end} |
                Post-event: {formData.post_event_start} to {formData.post_event_end}
              </p>
            </div>

            {/* Location Preset */}
            <div>
              <label className="block text-sm font-medium mb-2 text-bp-text">
                <MapPin size={14} className="inline mr-2" />
                Location
              </label>
              <HTMLSelect
                fill
                value={formData.preset_location}
                onChange={(e) => handleLocationChange(e.target.value)}
                options={Object.entries(PRESET_LOCATIONS).map(([key, loc]) => ({
                  value: key,
                  label: loc.label,
                }))}
                className="bg-bp-surface text-bp-text-muted text-sm"
              />
              <p className="mt-1 text-xs text-bp-text-muted">
                Bbox: [{formData.bbox.map((v) => v.toFixed(3)).join(', ')}] | Center: {formData.center_lat.toFixed(4)}, {formData.center_lng.toFixed(4)}
              </p>

              {/* Custom coordinates input */}
              {formData.preset_location === 'custom' && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="Min Lng (e.g., 85.318)"
                    value={formData.custom_min_lng}
                    onChange={(e) => handleCustomBboxChange('custom_min_lng', e.target.value)}
                    className="px-3 py-2 rounded text-sm placeholder-bp-text-muted focus:outline-none focus:border-bp-primary bg-bp-surface border border-bp-border text-bp-text"
                  />
                  <input
                    type="text"
                    placeholder="Min Lat (e.g., 27.697)"
                    value={formData.custom_min_lat}
                    onChange={(e) => handleCustomBboxChange('custom_min_lat', e.target.value)}
                    className="px-3 py-2 rounded text-sm placeholder-bp-text-muted focus:outline-none focus:border-bp-primary bg-bp-surface border border-bp-border text-bp-text"
                  />
                  <input
                    type="text"
                    placeholder="Max Lng (e.g., 85.328)"
                    value={formData.custom_max_lng}
                    onChange={(e) => handleCustomBboxChange('custom_max_lng', e.target.value)}
                    className="px-3 py-2 rounded text-sm placeholder-bp-text-muted focus:outline-none focus:border-bp-primary bg-bp-surface border border-bp-border text-bp-text"
                  />
                  <input
                    type="text"
                    placeholder="Max Lat (e.g., 27.705)"
                    value={formData.custom_max_lat}
                    onChange={(e) => handleCustomBboxChange('custom_max_lat', e.target.value)}
                    className="px-3 py-2 rounded text-sm placeholder-bp-text-muted focus:outline-none focus:border-bp-primary bg-bp-surface border border-bp-border text-bp-text"
                  />
                </div>
              )}
            </div>

            {/* Districts with Search */}
            <div>
              <label className="block text-sm font-medium mb-2 text-bp-text">
                Affected Districts
                {errors.districts && (
                  <span className="text-severity-critical ml-2 text-xs">({errors.districts})</span>
                )}
              </label>

              {/* Search input */}
              <div className="relative mb-2">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-bp-text-muted" />
                <input
                  type="text"
                  placeholder="Search districts..."
                  value={districtSearch}
                  onChange={(e) => setDistrictSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 rounded-lg text-sm placeholder-bp-text-muted focus:outline-none focus:border-bp-primary bg-bp-surface border border-bp-border text-bp-text"
                />
              </div>

              <div className="max-h-40 overflow-y-auto rounded-lg p-2 bg-bp-surface border border-bp-border">
                <div className="flex flex-wrap gap-1">
                  {filteredDistricts.map((district) => (
                    <button
                      key={district}
                      type="button"
                      onClick={() => handleDistrictToggle(district)}
                      className={`px-2 py-1 rounded text-xs transition-colors ${
                        formData.districts.includes(district)
                          ? 'bg-bp-primary/20 text-bp-primary border border-bp-primary/30'
                          : 'bg-bp-card text-bp-text-muted hover:bg-bp-hover'
                      }`}
                    >
                      {district}
                    </button>
                  ))}
                  {filteredDistricts.length === 0 && (
                    <p className="text-xs p-2 text-bp-text-muted">No districts match "{districtSearch}"</p>
                  )}
                </div>
              </div>
              {formData.districts.length > 0 && (
                <p className="mt-1 text-xs text-bp-text-muted">
                  Selected ({formData.districts.length}): {formData.districts.join(', ')}
                </p>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-bp-border bg-bp-bg">
            <Button minimal text="Cancel" onClick={onClose} className="text-bp-text-muted text-xs" />
            <Button
              intent={Intent.PRIMARY}
              loading={isSubmitting}
              text={isSubmitting ? 'Creating...' : 'Create Assessment'}
              type="submit"
              className="text-xs"
            />
          </div>
        </form>
      </div>
    </div>
  );
}
