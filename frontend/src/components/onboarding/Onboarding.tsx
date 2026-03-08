import { useState } from 'react'
import { MapPin, Newspaper, Bell, ChevronRight, ChevronLeft, Check, Mountain } from 'lucide-react'
import { useUserPreferencesStore, TOPICS, type TopicId } from '../../store/slices/userPreferencesSlice'
import { PROVINCES, type Province, PROVINCE_COLORS } from '../../store/slices/settingsSlice'
import { DISTRICTS } from '../../data/districts'

const STEPS = [
  { id: 'welcome', title: 'Welcome' },
  { id: 'districts', title: 'Your Districts' },
  { id: 'topics', title: 'Your Interests' },
  { id: 'finish', title: 'All Set' },
]

export function Onboarding() {
  const [currentStep, setCurrentStep] = useState(0)

  const {
    selectedDistricts,
    homeDistrict,
    selectedTopics,
    toggleDistrict,
    selectProvince,
    deselectProvince,
    setHomeDistrict,
    toggleTopic,
    completeOnboarding,
    isProvinceFullySelected,
    isProvincePartiallySelected,
  } = useUserPreferencesStore()

  const [expandedProvince, setExpandedProvince] = useState<Province | null>(null)

  const canProceed = () => {
    switch (currentStep) {
      case 0: return true // Welcome
      case 1: return selectedDistricts.length > 0 // At least one district
      case 2: return selectedTopics.length > 0 // At least one topic
      case 3: return true // Finish
      default: return true
    }
  }

  const handleNext = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1)
    } else {
      completeOnboarding()
    }
  }

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1)
    }
  }

  const handleProvinceToggle = (province: Province) => {
    if (isProvinceFullySelected(province)) {
      deselectProvince(province)
    } else {
      selectProvince(province)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Progress */}
        <div className="mb-8">
          <div className="flex items-center justify-center gap-2 mb-4">
            {STEPS.map((step, index) => (
              <div key={step.id} className="flex items-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                    index < currentStep
                      ? 'bg-emerald-500 text-white'
                      : index === currentStep
                      ? 'bg-blue-500 text-white'
                      : 'bg-slate-700 text-slate-400'
                  }`}
                >
                  {index < currentStep ? <Check size={16} /> : index + 1}
                </div>
                {index < STEPS.length - 1 && (
                  <div className={`w-12 h-0.5 mx-1 ${
                    index < currentStep ? 'bg-emerald-500' : 'bg-slate-700'
                  }`} />
                )}
              </div>
            ))}
          </div>
          <p className="text-center text-slate-400 text-sm">{STEPS[currentStep].title}</p>
        </div>

        {/* Content Card */}
        <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-xl p-6 md:p-8 shadow-xl">
          {/* Step 0: Welcome */}
          {currentStep === 0 && (
            <div className="text-center">
              <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-emerald-500 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <Mountain size={40} className="text-white" />
              </div>
              <h1 className="text-2xl md:text-3xl font-bold text-white mb-4">
                Welcome to Nepal News & Alerts
              </h1>
              <p className="text-slate-300 text-lg mb-6 max-w-md mx-auto">
                Stay informed about news, disasters, and events across Nepal with personalized updates.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
                <div className="bg-slate-700/50 rounded-lg p-4">
                  <MapPin className="text-blue-400 mx-auto mb-2" size={24} />
                  <p className="text-slate-300 text-sm">Choose your districts</p>
                </div>
                <div className="bg-slate-700/50 rounded-lg p-4">
                  <Newspaper className="text-emerald-400 mx-auto mb-2" size={24} />
                  <p className="text-slate-300 text-sm">Select news topics</p>
                </div>
                <div className="bg-slate-700/50 rounded-lg p-4">
                  <Bell className="text-amber-400 mx-auto mb-2" size={24} />
                  <p className="text-slate-300 text-sm">Get real-time alerts</p>
                </div>
              </div>
            </div>
          )}

          {/* Step 1: Districts */}
          {currentStep === 1 && (
            <div>
              <h2 className="text-xl font-semibold text-white mb-2">Select Your Districts</h2>
              <p className="text-slate-400 mb-6">Choose the districts you want to follow. You can select entire provinces or individual districts.</p>

              <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
                {PROVINCES.map((province) => {
                  const provinceDistricts = DISTRICTS.filter(d => d.province === province)
                  const isExpanded = expandedProvince === province
                  const isFullySelected = isProvinceFullySelected(province)
                  const isPartiallySelected = isProvincePartiallySelected(province)
                  const selectedCount = provinceDistricts.filter(d => selectedDistricts.includes(d.name)).length

                  return (
                    <div key={province} className="bg-slate-700/30 rounded-lg overflow-hidden">
                      <div className="flex items-center p-3">
                        <button
                          onClick={() => handleProvinceToggle(province)}
                          className={`w-5 h-5 rounded border-2 mr-3 flex items-center justify-center transition-colors ${
                            isFullySelected
                              ? 'bg-blue-500 border-blue-500'
                              : isPartiallySelected
                              ? 'bg-blue-500/50 border-blue-500'
                              : 'border-slate-500 hover:border-slate-400'
                          }`}
                        >
                          {(isFullySelected || isPartiallySelected) && <Check size={12} className="text-white" />}
                        </button>
                        <div
                          className="w-3 h-3 rounded-full mr-2"
                          style={{ backgroundColor: PROVINCE_COLORS[province] }}
                        />
                        <span className="text-white font-medium flex-1">{province}</span>
                        <span className="text-slate-400 text-sm mr-3">
                          {selectedCount}/{provinceDistricts.length}
                        </span>
                        <button
                          onClick={() => setExpandedProvince(isExpanded ? null : province)}
                          className="text-slate-400 hover:text-white p-1"
                        >
                          <ChevronRight size={16} className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                        </button>
                      </div>

                      {isExpanded && (
                        <div className="px-3 pb-3 grid grid-cols-2 md:grid-cols-3 gap-2">
                          {provinceDistricts.map((district) => {
                            const isSelected = selectedDistricts.includes(district.name)
                            const isHome = homeDistrict === district.name

                            return (
                              <button
                                key={district.name}
                                onClick={() => toggleDistrict(district.name)}
                                onDoubleClick={() => setHomeDistrict(isHome ? null : district.name)}
                                className={`text-left px-3 py-2 rounded text-sm transition-colors ${
                                  isSelected
                                    ? 'bg-blue-500/30 text-blue-300 border border-blue-500/50'
                                    : 'bg-slate-700/50 text-slate-300 border border-transparent hover:bg-slate-700'
                                }`}
                                title="Double-click to set as home district"
                              >
                                <span className="flex items-center gap-1">
                                  {isHome && <span className="text-amber-400">*</span>}
                                  {district.name}
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <div className="mt-4 flex items-center justify-between text-sm">
                <span className="text-slate-400">
                  {selectedDistricts.length} district{selectedDistricts.length !== 1 ? 's' : ''} selected
                </span>
                {homeDistrict && (
                  <span className="text-amber-400 flex items-center gap-1">
                    <MapPin size={14} />
                    Home: {homeDistrict}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Step 2: Topics */}
          {currentStep === 2 && (
            <div>
              <h2 className="text-xl font-semibold text-white mb-2">What interests you?</h2>
              <p className="text-slate-400 mb-6">Select the topics you want to follow. We'll prioritize news and alerts for these categories.</p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {TOPICS.map((topic) => {
                  const isSelected = selectedTopics.includes(topic.id as TopicId)

                  return (
                    <button
                      key={topic.id}
                      onClick={() => toggleTopic(topic.id as TopicId)}
                      className={`text-left p-4 rounded-lg border transition-all ${
                        isSelected
                          ? 'bg-blue-500/20 border-blue-500/50 shadow-lg shadow-blue-500/10'
                          : 'bg-slate-700/30 border-slate-600/50 hover:bg-slate-700/50'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`w-5 h-5 rounded border-2 flex-shrink-0 mt-0.5 flex items-center justify-center transition-colors ${
                          isSelected
                            ? 'bg-blue-500 border-blue-500'
                            : 'border-slate-500'
                        }`}>
                          {isSelected && <Check size={12} className="text-white" />}
                        </div>
                        <div>
                          <p className={`font-medium ${isSelected ? 'text-white' : 'text-slate-300'}`}>
                            {topic.label}
                          </p>
                          <p className="text-slate-400 text-sm mt-0.5">{topic.description}</p>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>

              <p className="text-slate-500 text-sm mt-4 text-center">
                You can change these anytime in Settings
              </p>
            </div>
          )}

          {/* Step 3: Finish */}
          {currentStep === 3 && (
            <div className="text-center">
              <div className="w-20 h-20 bg-gradient-to-br from-emerald-500 to-blue-500 rounded-full flex items-center justify-center mx-auto mb-6">
                <Check size={40} className="text-white" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-4">You're All Set!</h2>
              <p className="text-slate-300 mb-8 max-w-md mx-auto">
                We'll show you news and alerts based on your preferences.
              </p>

              <div className="bg-slate-700/30 rounded-lg p-4 text-left max-w-sm mx-auto">
                <h3 className="text-white font-medium mb-3">Your Preferences</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Districts</span>
                    <span className="text-white">{selectedDistricts.length} selected</span>
                  </div>
                  {homeDistrict && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">Home District</span>
                      <span className="text-amber-400">{homeDistrict}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-slate-400">Topics</span>
                    <span className="text-white">{selectedTopics.length} selected</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between mt-6">
          <button
            onClick={handleBack}
            disabled={currentStep === 0}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
              currentStep === 0
                ? 'text-slate-600 cursor-not-allowed'
                : 'text-slate-300 hover:text-white hover:bg-slate-700'
            }`}
          >
            <ChevronLeft size={18} />
            Back
          </button>

          <button
            onClick={handleNext}
            disabled={!canProceed()}
            className={`flex items-center gap-2 px-6 py-2 rounded-lg font-medium transition-all ${
              canProceed()
                ? 'bg-blue-500 text-white hover:bg-blue-600 shadow-lg shadow-blue-500/30'
                : 'bg-slate-700 text-slate-500 cursor-not-allowed'
            }`}
          >
            {currentStep === STEPS.length - 1 ? 'Get Started' : 'Continue'}
            <ChevronRight size={18} />
          </button>
        </div>

        {/* Skip option */}
        {currentStep < STEPS.length - 1 && (
          <button
            onClick={completeOnboarding}
            className="w-full mt-4 text-slate-500 hover:text-slate-300 text-sm transition-colors"
          >
            Skip setup and use defaults
          </button>
        )}
      </div>
    </div>
  )
}
