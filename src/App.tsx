import { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  Compass, 
  Trophy, 
  Settings, 
  ExternalLink, 
  ChevronRight, 
  ChevronDown, 
  AlertCircle,
  CheckCircle2,
  Star,
  Sword,
  Zap,
  LayoutDashboard,
  Scroll,
  Crown,
  Crosshair,
  Target,
  Route,
  Lock,
  GitBranch,
  ArrowRight,
  PlayCircle,
  Trash2,
  Shirt,
  Gem,
  Calendar,
  X
} from 'lucide-react';

// --- Types ---

interface AchievementGroup {
  id: string;
  name: string;
  description: string;
  order: number;
  categories: number[]; // IDs of categories
}

interface AchievementCategory {
  id: number;
  name: string;
  description: string;
  order: number;
  icon: string;
  achievements: number[]; // IDs of achievements
}

interface AchievementTier {
  count: number;
  points: number;
}

interface Item {
  id: number;
  name: string;
  description?: string;
  type?: string;
  rarity?: string;
  level?: number;
  vendor_value?: number;
  icon?: string;
  details?: any;
}

interface Title {
  id: number;
  name: string;
}

interface AchievementReward {
  type: string;
  id?: number;
  count?: number;
  region?: string; // For Mastery Points
  title?: Title;   // Title data when type is 'Title'
  item?: Item;     // Item data when type is 'Item'
}

interface Achievement {
  id: number;
  icon?: string;
  name: string;
  description: string;
  requirement: string;
  locked_text?: string;
  type: string;
  flags: string[];
  tiers: AchievementTier[];
  rewards?: AchievementReward[];
  prerequisites?: number[]; // Achievement IDs that must be completed first
}

interface UserProgress {
  id: number;
  current?: number;
  max?: number;
  done: boolean;
  bits?: number[];
  repeated?: number;
  unlocked?: boolean;
}


interface CacheEnvelope<T> {
  timestamp: number;
  data: T;
}

// --- API & Cache Helper ---

// Backend API base URL (change this to your deployed backend URL in production)
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001/api';
const GW2_API_BASE = 'https://api.guildwars2.com/v2'; // Still used for user progress
const CACHE_PREFIX = 'gw2_pf_';
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in ms

// Helper to check if an achievement should be filtered out (Daily/Weekly/Monthly)
const shouldFilterAchievement = (achievement: Achievement): boolean => {
  const filterFlags = ['Daily', 'Weekly', 'Monthly'];
  return filterFlags.some(flag => achievement.flags.includes(flag));
};

// LocalStorage Wrapper
const CacheManager = {
  get: <T,>(key: string): T | null => {
    try {
      const item = localStorage.getItem(CACHE_PREFIX + key);
      if (!item) return null;
      
      const parsed: CacheEnvelope<T> = JSON.parse(item);
      const now = Date.now();
      
      // Check if expired
      if (now - parsed.timestamp > CACHE_DURATION) {
        localStorage.removeItem(CACHE_PREFIX + key);
        return null;
      }
      
      return parsed.data;
    } catch (e) {
      console.warn("Cache read error", e);
      return null;
    }
  },

  set: <T,>(key: string, data: T): void => {
    try {
      const envelope: CacheEnvelope<T> = {
        timestamp: Date.now(),
        data
      };
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(envelope));
    } catch (e) {
      console.warn("Cache write error (Quota likely exceeded)", e);
    }
  },

  clear: () => {
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith(CACHE_PREFIX) && key !== `${CACHE_PREFIX}apikey`) {
        localStorage.removeItem(key);
      }
    });
  },
  
  size: () => {
      let total = 0;
      Object.keys(localStorage).forEach(key => {
          if (key.startsWith(CACHE_PREFIX)) {
              total += (localStorage.getItem(key)?.length || 0);
          }
      });
      return (total / 1024).toFixed(2); // KB
  }
};

const fetchWithBackoff = async (url: string, retries = 3, delay = 1000): Promise<any> => {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 429 && retries > 0) {
        await new Promise(r => setTimeout(r, delay));
        return fetchWithBackoff(url, retries - 1, delay * 2);
      }
      throw new Error(`API Error: ${res.status}`);
    }
    return res.json();
  } catch (err) {
    if (retries > 0) {
      await new Promise(r => setTimeout(r, delay));
      return fetchWithBackoff(url, retries - 1, delay * 2);
    }
    throw err;
  }
};

// --- Helper Functions ---

// Parse and render text with Guild Wars 2 color tags (<c=#hexcolor>text</c>)
const renderColoredText = (text: string) => {
  if (!text) return text;
  
  // Pattern to match <c=#hexcolor>text</c>
  const colorTagPattern = /<c=#([0-9a-fA-F]{6})>(.*?)<\/c>/g;
  const parts: (string | React.ReactElement)[] = [];
  let lastIndex = 0;
  let match;
  let keyCounter = 0;
  
  while ((match = colorTagPattern.exec(text)) !== null) {
    // Add text before the color tag
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }
    
    // Add colored text
    const color = `#${match[1]}`;
    const coloredText = match[2];
    parts.push(
      <span key={`color-${keyCounter++}`} style={{ color }}>
        {coloredText}
      </span>
    );
    
    lastIndex = colorTagPattern.lastIndex;
  }
  
  // Add remaining text after the last color tag
  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }
  
  // If no color tags were found, return the original text
  if (parts.length === 0) {
    return text;
  }
  
  // Return a fragment containing all parts
  return <>{parts}</>;
};

// --- Components ---

const Sidebar = ({ 
  groups, 
  selectedGroup, 
  onSelectGroup, 
  categories, 
  selectedCategory, 
  onSelectCategory,
  onGoHome,
  onGoToMyPath,
  currentView,
  isLoadingGroups,
  userProgress,
  achievementsCache
}: {
  groups: AchievementGroup[];
  selectedGroup: string | null;
  onSelectGroup: (id: string) => void;
  categories: Record<string, AchievementCategory[]>;
  selectedCategory: number | null;
  onSelectCategory: (id: number) => void;
  onGoHome: () => void;
  onGoToMyPath: () => void;
  currentView: 'dashboard' | 'mypath' | 'category';
  isLoadingGroups: boolean;
  userProgress: Record<number, UserProgress>;
  achievementsCache: Record<number, Achievement>;
}) => {
  
  // Helper to filter valid achievement IDs (exclude Daily/Weekly/Monthly)
  const getValidAchievementIds = (achievementIds: number[]): number[] => {
    return achievementIds.filter(id => {
      const ach = achievementsCache[id];
      // Only include achievements we have data for and that are valid
      if (!ach) return false;
      return !shouldFilterAchievement(ach);
    });
  };

  // Helper to check if a category has valid achievements
  // Only returns true if we have achievement data for ALL achievements in the category AND there are valid achievements
  // This prevents showing empty categories that will be filtered out
  const hasValidAchievements = (cat: AchievementCategory): boolean => {
    if (!cat.achievements || cat.achievements.length === 0) return false;
    
    // Check if we have data for ALL achievements in this category
    // If we don't have complete data yet, don't show the category (wait for pre-loading to complete)
    const hasAllData = cat.achievements.every(id => achievementsCache[id] !== undefined);
    
    // Only show category if we have complete data
    if (!hasAllData) return false;
    
    // If we have complete data, check if there are valid achievements
    const validIds = getValidAchievementIds(cat.achievements);
    return validIds.length > 0;
  };

  // Helper to calculate category progress (only counting valid achievements)
  const getCategoryProgress = (cat: AchievementCategory) => {
    if (!cat.achievements || cat.achievements.length === 0) return 0;
    const validIds = getValidAchievementIds(cat.achievements);
    if (validIds.length === 0) return 0;
    
    const completed = validIds.filter(id => {
      const prog = userProgress[id];
      return prog && (prog.done || (prog.repeated && prog.repeated > 0));
    }).length;
    return (completed / validIds.length) * 100;
  };

  // Helper to check if a group has valid categories
  const hasValidCategories = (group: AchievementGroup): boolean => {
    const groupCategories = categories[group.id];
    if (!groupCategories || groupCategories.length === 0) return false;
    return groupCategories.some(cat => hasValidAchievements(cat));
  };

  // Helper to calculate group progress (only counting valid achievements)
  const getGroupProgress = (group: AchievementGroup) => {
    const groupCategories = categories[group.id];
    if (!groupCategories || groupCategories.length === 0) return 0;
    
    // If we don't have userProgress yet, return 0 (can't calculate progress)
    if (Object.keys(userProgress).length === 0) return 0;
    
    // Collect all valid achievement IDs from all categories in this group
    const allValidAchievementIds = groupCategories
      .flatMap(cat => getValidAchievementIds(cat.achievements || []));
    
    if (allValidAchievementIds.length === 0) return 0;
    
    // Count completed achievements
    const completed = allValidAchievementIds.filter(id => {
      const prog = userProgress[id];
      return prog && (prog.done || (prog.repeated && prog.repeated > 0));
    }).length;
    
    return (completed / allValidAchievementIds.length) * 100;
  };

  return (
    <div className="w-full md:w-64 bg-slate-900 border-r border-slate-700 flex-shrink-0 flex flex-col h-screen overflow-hidden">
      <div className="p-4 border-b border-slate-700 flex items-center gap-2 cursor-pointer hover:bg-slate-800 transition-colors" onClick={onGoHome}>
        <Compass className="text-amber-500" size={24} />
        <h1 className="text-xl font-bold text-slate-100 tracking-tight">GW2 Pathfinder</h1>
      </div>
      
      <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-600">
        <div className="p-2">
           <button 
            onClick={onGoHome}
            className={`w-full text-left px-3 py-2 rounded mb-2 flex items-center gap-2 ${currentView === 'dashboard' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}
          >
            <LayoutDashboard size={16} />
            <span>Dashboard</span>
          </button>
          <button 
            onClick={onGoToMyPath}
            className={`w-full text-left px-3 py-2 rounded mb-2 flex items-center gap-2 ${currentView === 'mypath' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}
          >
            <Route size={16} />
            <span>My Path</span>
          </button>

          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 px-3 mt-4">
            Achievement Groups
          </div>
          
          {isLoadingGroups ? (
            <div className="px-3 text-slate-500 text-sm animate-pulse">Loading groups...</div>
          ) : (
            groups
              .filter(group => hasValidCategories(group)) // Only show groups with valid categories
              .sort((a,b) => a.order - b.order)
              .map(group => {
              const progressPercent = getGroupProgress(group);
              return (
              <div key={group.id} className="mb-1">
                <button
                  onClick={() => onSelectGroup(group.id === selectedGroup ? '' : group.id)}
                  className={`relative w-full flex items-center justify-between px-3 py-2 text-sm rounded transition-colors overflow-hidden text-left ${selectedGroup === group.id ? 'bg-slate-800 text-amber-400' : 'text-slate-300 hover:bg-slate-800'}`}
                >
                  {/* Progress Bar Background */}
                  <div 
                    className="absolute top-0 left-0 bottom-0 bg-amber-600/20 transition-all duration-500 ease-out"
                    style={{ width: `${progressPercent}%` }}
                  />
                  
                  {/* Content */}
                  <div className="relative z-10 flex items-center justify-between w-full">
                    <span className="truncate flex-1 text-left">{group.name}</span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {progressPercent > 0 && <span className="text-[10px] opacity-60">{Math.round(progressPercent)}%</span>}
                      {selectedGroup === group.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </div>
                  </div>
                </button>
                
                {selectedGroup === group.id && (
                  <div className="ml-2 pl-2 border-l border-slate-700 mt-1 space-y-1">
                    {categories[group.id] ? (
                      categories[group.id]
                        .filter(cat => hasValidAchievements(cat)) // Only show categories with valid achievements
                        .sort((a,b) => a.order - b.order)
                        .map(cat => {
                        const progressPercent = getCategoryProgress(cat);
                        return (
                          <button
                            key={cat.id}
                            onClick={() => onSelectCategory(cat.id)}
                            className={`relative w-full text-left rounded overflow-hidden mb-0.5 group ${selectedCategory === cat.id ? 'ring-1 ring-amber-500/50' : ''}`}
                          >
                             {/* Progress Bar Background */}
                             <div 
                                className="absolute top-0 left-0 bottom-0 bg-amber-600/20 transition-all duration-500 ease-out"
                                style={{ width: `${progressPercent}%` }}
                             />
                             
                             {/* Content */}
                             <div className={`relative z-10 px-3 py-1.5 text-xs truncate flex justify-between items-center ${selectedCategory === cat.id ? 'text-amber-300' : 'text-slate-400 group-hover:text-slate-200'}`}>
                                <span>{cat.name}</span>
                                {progressPercent > 0 && <span className="text-[10px] opacity-60">{Math.round(progressPercent)}%</span>}
                             </div>
                          </button>
                        );
                      })
                    ) : (
                      <div className="px-3 py-1 text-xs text-slate-600">Loading categories...</div>
                    )}
                  </div>
                )}
              </div>
            );
            })
          )}
        </div>
      </div>
    </div>
  );
};

const AchievementCard = ({ 
  achievement, 
  progress,
  isStarred,
  onToggleStar,
  isLocked,
  unlocksCount,
  recommendationReason,
  achievementsCache,
  userProgress,
  onNeedAchievements,
  accountAccess,
  isAchievementLocked,
  onNavigateToAchievement,
  achievementToCategoryMap
}: { 
  achievement: Achievement; 
  progress?: UserProgress;
  isStarred?: boolean;
  onToggleStar?: (id: number) => void;
  isLocked?: boolean;
  unlocksCount?: number;
  recommendationReason?: string;
  achievementsCache?: Record<number, Achievement>;
  userProgress?: Record<number, UserProgress>;
  onNeedAchievements?: (ids: number[]) => void;
  accountAccess?: string[];
  isAchievementLocked?: (achievement: Achievement) => boolean;
  onNavigateToAchievement?: (achievementId: number) => void;
  achievementToCategoryMap?: Record<number, number>;
}) => {
  const [iconError, setIconError] = useState(false);
  const [showPrerequisites, setShowPrerequisites] = useState(false);
  
  // Use props with defaults
  const cache = achievementsCache || {};
  const progressMap = userProgress || {};
  const account = accountAccess || [];
  const checkLocked = isAchievementLocked || (() => false);
  const isDone = progress?.done || (progress?.repeated && progress.repeated > 0);
  const current = progress?.current || 0;
  const max = progress?.max || achievement.tiers[achievement.tiers.length - 1]?.count || 1;
  const percent = Math.min(100, Math.max(0, (current / max) * 100));
  
  // Reset icon error when achievement changes
  useEffect(() => {
    setIconError(false);
  }, [achievement.id, achievement.icon]);
  
  // Calculate display Tier points
  const totalPoints = achievement.tiers.reduce((acc, t) => acc + t.points, 0);

  // Wiki Link
  const wikiUrl = `https://wiki.guildwars2.com/wiki/${encodeURIComponent(achievement.name)}`;

  return (
    <div className={`relative bg-slate-800 rounded-lg p-4 border ${isDone ? 'border-green-900/50 bg-slate-800/80' : isLocked ? 'border-slate-800 bg-slate-900/50 opacity-60' : 'border-slate-700'} shadow-sm ${isLocked ? '' : 'hover:border-slate-600'} transition-all`}>
      <div className="flex gap-4">
        {/* Icon */}
        <div className="flex-shrink-0 relative">
          <div className={`w-12 h-12 rounded bg-slate-900 border border-slate-700 flex items-center justify-center overflow-hidden ${isDone ? 'ring-2 ring-green-500/50' : ''} ${isLocked ? 'opacity-50' : ''}`}>
            {achievement.icon && !iconError ? (
              <img 
                src={achievement.icon} 
                alt={achievement.name} 
                className="w-full h-full object-cover"
                onError={() => setIconError(true)}
              />
            ) : (
              <Trophy className="text-slate-600" size={24} />
            )}
          </div>
          {isLocked && (
            <div className="absolute -top-1 -right-1 bg-slate-800 border border-slate-600 rounded-full p-1">
              <Lock className="text-slate-400" size={14} />
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-start gap-2">
            <div>
              <h3 className={`font-bold text-lg leading-tight ${isDone ? 'text-green-400' : isLocked ? 'text-slate-500' : 'text-slate-100'}`}>
                {achievement.name}
                {isLocked && <span className="ml-2 text-xs bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded border border-slate-700 flex items-center gap-1 inline-flex"><Lock size={12} /> Locked</span>}
                {!isLocked && achievement.flags.includes('Repeatable') && <span className="ml-2 text-xs bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded">Repeatable</span>}
                {achievement.prerequisites && achievement.prerequisites.length > 0 && (
                  <span className="ml-2 text-xs bg-blue-900/30 text-blue-300 px-1.5 py-0.5 rounded border border-blue-800/50" title={`Requires ${achievement.prerequisites.length} prerequisite${achievement.prerequisites.length > 1 ? 's' : ''}`}>
                    {achievement.prerequisites.length} Prereq{achievement.prerequisites.length > 1 ? 's' : ''}
                  </span>
                )}
                {unlocksCount !== undefined && unlocksCount > 0 && (
                  <span className="ml-2 text-xs bg-green-900/30 text-green-300 px-1.5 py-0.5 rounded border border-green-800/50" title={`Unlocks ${unlocksCount} other achievement${unlocksCount > 1 ? 's' : ''}`}>
                    Unlocks {unlocksCount}
                  </span>
                )}
              </h3>
              {recommendationReason && (
                <div className="text-xs text-amber-400/80 mt-1 italic">
                  {recommendationReason}
                </div>
              )}
              <div className={`text-sm mt-1 line-clamp-2 ${isLocked ? 'text-slate-600' : 'text-slate-400'}`} dangerouslySetInnerHTML={{__html: achievement.requirement || achievement.description}}></div>
            </div>
            
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-1">
                {onToggleStar && (
                  <button
                    onClick={() => onToggleStar(achievement.id)}
                    className={`p-1 rounded transition-colors ${
                      isStarred 
                        ? 'text-amber-400 hover:text-amber-300' 
                        : 'text-slate-500 hover:text-amber-400'
                    }`}
                    title={isStarred ? 'Unstar achievement' : 'Star achievement'}
                  >
                    <Star size={18} className={isStarred ? 'fill-current' : ''} />
                  </button>
                )}
                <span className="flex items-center text-amber-500 font-bold text-sm bg-amber-950/30 px-2 py-0.5 rounded border border-amber-900/50">
                  {totalPoints} <span className="ml-1 text-xs">AP</span>
                </span>
              </div>
              <a 
                href={wikiUrl} 
                target="_blank" 
                rel="noreferrer" 
                className="text-slate-500 hover:text-sky-400 transition-colors"
                title="View on Wiki"
              >
                <ExternalLink size={16} />
              </a>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="mt-4">
            <div className="flex justify-between text-xs text-slate-400 mb-1">
              <span>{isDone ? 'Completed' : (progress ? `${current} / ${max}` : 'Not started')}</span>
              <span>{isDone ? '100%' : `${Math.floor(percent)}%`}</span>
            </div>
            <div className="h-2 w-full bg-slate-900 rounded-full overflow-hidden">
              <div 
                className={`h-full rounded-full transition-all duration-500 ${isDone ? 'bg-green-500' : 'bg-amber-600'}`}
                style={{ width: `${isDone ? 100 : percent}%` }}
              />
            </div>
          </div>
          
          {/* Rewards / Tags */}
          <div className="mt-3 flex flex-wrap gap-2">
            {achievement.rewards?.map((reward, idx) => (
              <div key={idx} className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-indigo-900/30 text-indigo-300 border border-indigo-800/50">
                {reward.type === 'Mastery' && <Star size={12} className="text-yellow-400" fill="currentColor" />}
                {reward.type === 'Title' && <Trophy size={12} />}
                {reward.type === 'Item' && (
                  reward.item?.icon ? (
                    <img src={reward.item.icon} alt={reward.item.name} className="w-4 h-4 object-cover" />
                  ) : (
                    <div className="w-3 h-3 bg-indigo-500 rounded-full" />
                  )
                )}
                <span>
                  {reward.type === 'Item' && reward.item ? (
                    <>
                      {reward.item.name}
                      {reward.count && reward.count > 1 && ` x${reward.count}`}
                      {reward.item.rarity && (
                        <span className={`ml-1 text-[10px] ${
                          reward.item.rarity === 'Legendary' ? 'text-orange-400' :
                          reward.item.rarity === 'Ascended' ? 'text-fuchsia-400' :
                          reward.item.rarity === 'Exotic' ? 'text-yellow-400' :
                          reward.item.rarity === 'Rare' ? 'text-blue-400' :
                          reward.item.rarity === 'Masterwork' ? 'text-green-400' :
                          'text-slate-400'
                        }`}>
                          [{reward.item.rarity}]
                        </span>
                      )}
                    </>
                  ) : reward.type === 'Title' && reward.title ? (
                    <>
                      {renderColoredText(reward.title.name)}
                    </>
                  ) : (
                    <>
                      {reward.type} {reward.region ? `(${reward.region})` : ''}
                    </>
                  )}
                </span>
              </div>
            ))}
            {achievement.flags.includes('CategoryDisplay') && (() => {
              // Generate explanation for why this achievement is meta
              const metaReasons: string[] = [];
              
              if (achievement.rewards) {
                for (const reward of achievement.rewards) {
                  if (reward.type === 'Item' && reward.item) {
                    const itemName = reward.item.name.toLowerCase();
                    const itemType = reward.item.type?.toLowerCase() || '';
                    
                    // Check for bags (especially 20-slot bags)
                    const isBag = itemType === 'bag' || itemType === 'container' || 
                                  itemName.includes('bag') || itemName.includes('purse') || itemName.includes('jar');
                    
                    if (isBag) {
                      // Check item details for bag size
                      const bagSize = reward.item.details?.size;
                      if (bagSize === 20) {
                        metaReasons.push('Grants free 20-slot bag');
                      } else if (bagSize && bagSize >= 15) {
                        metaReasons.push(`Grants free ${bagSize}-slot bag`);
                      } else if (itemName.includes('20') || itemName.includes('twenty')) {
                        metaReasons.push('Grants free 20-slot bag');
                      } else if (itemName.includes('18') || itemName.includes('fifteen') || itemName.includes('15')) {
                        metaReasons.push('Grants free bag');
                      } else {
                        metaReasons.push('Grants bag');
                      }
                    }
                    // Check for mounts
                    else if (itemName.includes('mount') || itemName.includes('skyscale') || itemName.includes('griffon') || 
                             itemName.includes('roller beetle') || itemName.includes('jackal') || itemName.includes('raptor')) {
                      metaReasons.push('Grants mount');
                    }
                    // Check for legendary components
                    else if (itemName.includes('legendary') || itemName.includes('precursor') || 
                             itemName.includes('gift of') || itemName.includes('mystic clover')) {
                      metaReasons.push('Grants legendary component');
                    }
                    // Check for unique/valuable items
                    else if (reward.item.rarity === 'Legendary' || reward.item.rarity === 'Ascended') {
                      metaReasons.push(`Grants ${reward.item.rarity} item`);
                    }
                  }
                  // Note: Mastery Point and Title rewards are already tagged separately, so we skip them here
                }
              }
              
              const metaExplanation = metaReasons.length > 0 
                ? metaReasons[0] // Show first reason
                : 'High-value meta achievement';
              
              return (
                <span 
                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-purple-900/30 text-purple-300 border border-purple-800/50"
                  title={metaExplanation}
                >
                  Meta: {metaExplanation}
                </span>
              );
            })()}
          </div>

          {/* Prerequisite Chain */}
          {achievement.prerequisites && achievement.prerequisites.length > 0 && (
            <div className="mt-3 border-t border-slate-700 pt-3">
              <button
                onClick={() => {
                  setShowPrerequisites(!showPrerequisites);
                  // Fetch prerequisite data if needed
                  if (!showPrerequisites && onNeedAchievements) {
                    const missingIds = achievement.prerequisites!.filter(id => !cache[id]);
                    if (missingIds.length > 0) {
                      onNeedAchievements(missingIds);
                    }
                  }
                }}
                className="w-full flex items-center justify-between text-sm text-slate-400 hover:text-slate-200 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <GitBranch size={16} />
                  <span>Prerequisite Chain ({achievement.prerequisites.length})</span>
                </div>
                {showPrerequisites ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>
              
              {showPrerequisites && (
                <PrerequisiteChain
                  achievement={achievement}
                  prerequisites={achievement.prerequisites!}
                  achievementsCache={cache}
                  userProgress={progressMap}
                  accountAccess={account}
                  isAchievementLocked={checkLocked}
                  onNavigateToAchievement={onNavigateToAchievement}
                  achievementToCategoryMap={achievementToCategoryMap}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Prerequisite Chain Visualization Component
const PrerequisiteChain = ({
  achievement,
  prerequisites,
  achievementsCache,
  userProgress,
  accountAccess,
  isAchievementLocked,
  onNavigateToAchievement,
  achievementToCategoryMap
}: {
  achievement: Achievement;
  prerequisites: number[];
  achievementsCache: Record<number, Achievement>;
  userProgress: Record<number, UserProgress>;
  accountAccess: string[];
  isAchievementLocked?: (achievement: Achievement) => boolean;
  onNavigateToAchievement?: (achievementId: number) => void;
  achievementToCategoryMap?: Record<number, number>;
}) => {
  // Map mastery region names to account access names
  const regionToAccessMap: Record<string, string> = {
    'Tyria': 'GuildWars2',
    'Maguuma': 'HeartOfThorns',
    'Desert': 'PathOfFire',
    'Tundra': 'IcebroodSaga',
    'Jade': 'EndOfDragons',
    'Sky': 'SecretsOfTheObscure',
    'Wild': 'JanthirWilds',
    'Magic': 'VisionsOfEternity'
  };

  const checkIsLocked = (ach: Achievement): boolean => {
    if (!isAchievementLocked) {
      // Fallback check if function not provided
      if (ach.prerequisites && ach.prerequisites.length > 0) {
        const allPrerequisitesMet = ach.prerequisites.every(prereqId => {
          const prereqProgress = userProgress[prereqId];
          return prereqProgress && (prereqProgress.done || (prereqProgress.repeated && prereqProgress.repeated > 0));
        });
        if (!allPrerequisitesMet) return true;
      }
      
      if (ach.rewards && ach.rewards.length > 0) {
        const masteryRewards = ach.rewards.filter(r => r.type === 'Mastery' && r.region);
        if (masteryRewards.length > 0) {
          for (const reward of masteryRewards) {
            if (reward.region) {
              const requiredAccess = regionToAccessMap[reward.region];
              if (requiredAccess && !accountAccess.includes(requiredAccess)) {
                return true;
              }
            }
          }
        }
      }
      return false;
    }
    return isAchievementLocked(ach);
  };

  const prerequisiteAchievements = prerequisites
    .map(id => achievementsCache[id])
    .filter((ach): ach is Achievement => ach !== undefined);

  if (prerequisiteAchievements.length === 0) {
    return (
      <div className="mt-2 text-xs text-slate-500 italic">
        Loading prerequisite data...
      </div>
    );
  }

  // Separate prerequisites into: completed, in-progress, not-started, locked
  const completed = prerequisiteAchievements.filter(ach => {
    const prog = userProgress[ach.id];
    return prog && (prog.done || (prog.repeated && prog.repeated > 0));
  });

  const inProgress = prerequisiteAchievements.filter(ach => {
    const prog = userProgress[ach.id];
    return prog && !prog.done && prog.current && prog.current > 0;
  });

  const notStarted = prerequisiteAchievements.filter(ach => {
    const prog = userProgress[ach.id];
    const isLocked = checkIsLocked(ach);
    return !prog && !isLocked;
  });

  const locked = prerequisiteAchievements.filter(ach => checkIsLocked(ach));

  // Starting points are achievements with no prerequisites or all prerequisites completed
  const startingPoints = prerequisiteAchievements.filter(ach => {
    if (!ach.prerequisites || ach.prerequisites.length === 0) {
      return true; // No prerequisites = starting point
    }
    // All prerequisites completed = starting point
    return ach.prerequisites.every(prereqId => {
      const prereqProg = userProgress[prereqId];
      return prereqProg && (prereqProg.done || (prereqProg.repeated && prereqProg.repeated > 0));
    });
  });

  return (
    <div className="mt-3 space-y-3">
      {/* Starting Points */}
      {startingPoints.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <PlayCircle size={14} className="text-green-400" />
            <span className="text-xs font-semibold text-green-400">Ready to Start</span>
          </div>
          <div className="space-y-2 ml-6">
            {startingPoints.map(ach => {
              const prog = userProgress[ach.id];
              const isDone = prog && (prog.done || (prog.repeated && prog.repeated > 0));
              return (
                <div
                  key={ach.id}
                  className={`p-2 rounded border ${
                    isDone
                      ? 'bg-green-900/20 border-green-800/50'
                      : 'bg-slate-900/50 border-slate-700'
                  } ${onNavigateToAchievement ? 'cursor-pointer hover:bg-slate-800/70 transition-colors' : ''}`}
                  onClick={() => onNavigateToAchievement?.(ach.id)}
                >
                  <div className="flex items-center gap-2">
                    {isDone ? (
                      <CheckCircle2 size={14} className="text-green-400 flex-shrink-0" />
                    ) : (
                      <div className="w-3 h-3 rounded-full bg-green-500/50 border border-green-400 flex-shrink-0" />
                    )}
                    <span className={`text-xs ${isDone ? 'text-green-300 line-through' : 'text-slate-200'}`}>
                      {ach.name}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* In Progress */}
      {inProgress.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <ArrowRight size={14} className="text-amber-400" />
            <span className="text-xs font-semibold text-amber-400">In Progress</span>
          </div>
          <div className="space-y-2 ml-6">
            {inProgress.map(ach => {
              const prog = userProgress[ach.id];
              const current = prog?.current || 0;
              const max = prog?.max || ach.tiers[ach.tiers.length - 1]?.count || 1;
              const percent = Math.min(100, Math.max(0, (current / max) * 100));
              return (
                <div 
                  key={ach.id} 
                  className={`p-2 rounded bg-slate-900/50 border border-slate-700 ${onNavigateToAchievement ? 'cursor-pointer hover:bg-slate-800/70 transition-colors' : ''}`}
                  onClick={() => onNavigateToAchievement?.(ach.id)}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-3 h-3 rounded-full bg-amber-500/50 border border-amber-400 flex-shrink-0" />
                    <span className="text-xs text-slate-200">{ach.name}</span>
                  </div>
                  <div className="ml-5">
                    <div className="h-1 w-full bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-500 transition-all"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      {current} / {max} ({Math.floor(percent)}%)
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Not Started */}
      {notStarted.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Circle size={14} className="text-slate-400" />
            <span className="text-xs font-semibold text-slate-400">Not Started</span>
          </div>
          <div className="space-y-2 ml-6">
            {notStarted.map(ach => (
              <div 
                key={ach.id} 
                className={`p-2 rounded bg-slate-900/50 border border-slate-700 ${onNavigateToAchievement ? 'cursor-pointer hover:bg-slate-800/70 transition-colors' : ''}`}
                onClick={() => onNavigateToAchievement?.(ach.id)}
              >
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-slate-600 border border-slate-500 flex-shrink-0" />
                  <span className="text-xs text-slate-400">{ach.name}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Locked */}
      {locked.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Lock size={14} className="text-slate-500" />
            <span className="text-xs font-semibold text-slate-500">Locked</span>
          </div>
          <div className="space-y-2 ml-6">
            {locked.map(ach => (
              <div 
                key={ach.id} 
                className={`p-2 rounded bg-slate-900/50 border border-slate-800 opacity-60 ${onNavigateToAchievement ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
                onClick={() => onNavigateToAchievement?.(ach.id)}
              >
                <div className="flex items-center gap-2">
                  <Lock size={12} className="text-slate-500 flex-shrink-0" />
                  <span className="text-xs text-slate-500">{ach.name}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Completed (if any) */}
      {completed.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 size={14} className="text-green-400" />
            <span className="text-xs font-semibold text-green-400">Completed</span>
          </div>
          <div className="space-y-2 ml-6">
            {completed.map(ach => (
              <div 
                key={ach.id} 
                className={`p-2 rounded bg-green-900/20 border border-green-800/50 ${onNavigateToAchievement ? 'cursor-pointer hover:bg-green-900/30 transition-colors' : ''}`}
                onClick={() => onNavigateToAchievement?.(ach.id)}
              >
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={14} className="text-green-400 flex-shrink-0" />
                  <span className="text-xs text-green-300 line-through">{ach.name}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Chain Flow Indicator */}
      <div className="mt-3 pt-3 border-t border-slate-700">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <GitBranch size={12} />
          <span>
            Complete prerequisites in order to unlock: <span className="text-amber-400 font-semibold">{achievement.name}</span>
          </span>
        </div>
      </div>
    </div>
  );
};

// Helper component for circle icon (since lucide-react doesn't have a simple Circle)
const Circle = ({ size, className }: { size: number; className?: string }) => (
  <div className={`rounded-full border-2 ${className || ''}`} style={{ width: size, height: size }} />
);

// Radar Chart Component for Playstyle Scores
const PlaystyleRadarChart = ({ scores }: { scores: Record<string, number> }) => {
  const size = 300;
  const center = size / 2;
  const radius = 120;
  
  // Normalize scores to 0-100 scale
  const maxScore = Math.max(...Object.values(scores), 1);
  const normalizedScores = {
    Battlemaster: (scores.Battlemaster / maxScore) * 100,
    Commander: (scores.Commander / maxScore) * 100,
    Historian: (scores.Historian / maxScore) * 100,
    Collector: (scores.Collector / maxScore) * 100,
    Explorer: (scores.Explorer / maxScore) * 100
  };
  
  // Order: Battlemaster (top), Commander (top-right), Collector (bottom-right), Explorer (bottom-left), Historian (top-left)
  const axes = [
    { name: 'Battlemaster', angle: -Math.PI / 2, icon: Crosshair }, // Top
    { name: 'Commander', angle: Math.PI / 10, icon: Crown }, // Top-right
    { name: 'Collector', angle: (3 * Math.PI) / 5, icon: Star }, // Bottom-right
    { name: 'Explorer', angle: (7 * Math.PI) / 10, icon: Compass }, // Bottom-left
    { name: 'Historian', angle: (-4 * Math.PI) / 5, icon: Scroll } // Top-left
  ];
  
  // Calculate points for the polygon
  const points = axes.map((axis) => {
    const score = normalizedScores[axis.name as keyof typeof normalizedScores];
    const distance = (score / 100) * radius;
    const x = center + distance * Math.cos(axis.angle);
    const y = center + distance * Math.sin(axis.angle);
    return { x, y, score, name: axis.name };
  });
  
  const polygonPoints = points.map(p => `${p.x},${p.y}`).join(' ');
  
  // Grid circles for reference
  const gridLevels = [0.2, 0.4, 0.6, 0.8, 1.0];
  
  return (
    <div className="flex flex-col items-center gap-4">
      <svg width={size} height={size} className="overflow-visible">
        {/* Grid circles */}
        {gridLevels.map((level, i) => (
          <circle
            key={i}
            cx={center}
            cy={center}
            r={radius * level}
            fill="none"
            stroke="rgba(148, 163, 184, 0.2)"
            strokeWidth="1"
          />
        ))}
        
        {/* Grid lines (axes) */}
        {axes.map((axis, i) => {
          const endX = center + radius * Math.cos(axis.angle);
          const endY = center + radius * Math.sin(axis.angle);
          return (
            <line
              key={i}
              x1={center}
              y1={center}
              x2={endX}
              y2={endY}
              stroke="rgba(148, 163, 184, 0.3)"
              strokeWidth="1"
            />
          );
        })}
        
        {/* Data polygon */}
        <polygon
          points={polygonPoints}
          fill="rgba(251, 191, 36, 0.2)"
          stroke="rgb(251, 191, 36)"
          strokeWidth="2"
        />
        
        {/* Data points and labels */}
        {points.map((point, i) => {
          const axis = axes[i];
          const Icon = axis.icon;
          const labelX = center + (radius + 30) * Math.cos(axis.angle);
          const labelY = center + (radius + 30) * Math.sin(axis.angle);
          
          return (
            <g key={`point-${i}`}>
              {/* Point */}
              <circle
                cx={point.x}
                cy={point.y}
                r="4"
                fill="rgb(251, 191, 36)"
                stroke="rgb(217, 119, 6)"
                strokeWidth="2"
              />
              {/* Icon */}
              <g transform={`translate(${labelX - 12}, ${labelY - 12})`}>
                <foreignObject width={24} height={24}>
                  <div className="flex items-center justify-center w-6 h-6 text-amber-500">
                    <Icon size={20} />
                  </div>
                </foreignObject>
              </g>
              {/* Label */}
              <text
                x={labelX}
                y={labelY + 35}
                textAnchor="middle"
                className="text-xs fill-slate-300 font-semibold"
              >
                {axis.name}
              </text>
              {/* Score */}
              <text
                x={labelX}
                y={labelY + 50}
                textAnchor="middle"
                className="text-[10px] fill-slate-400"
              >
                {Math.round(point.score)}%
              </text>
            </g>
          );
        })}
      </svg>
      
      {/* Score breakdown */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4 w-full max-w-2xl">
        {Object.entries(scores).map(([name, score]) => {
          const normalized = (score / maxScore) * 100;
          const Icon = axes.find(a => a.name === name)?.icon || Compass;
          return (
            <div key={name} className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
              <div className="flex items-center gap-2 mb-1">
                <Icon size={16} className="text-amber-500" />
                <span className="text-xs font-semibold text-slate-300">{name}</span>
              </div>
              <div className="text-lg font-bold text-amber-400">{Math.round(score)}</div>
              <div className="text-[10px] text-slate-500">AP weighted</div>
              <div className="mt-1 h-1 bg-slate-700 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-amber-500 transition-all"
                  style={{ width: `${normalized}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const UserSettings = ({ 
  apiKey, 
  setApiKey, 
  onRefresh, 
  isRefreshing,
  onClearApiKey
}: { 
  apiKey: string; 
  setApiKey: (key: string) => void; 
  onRefresh: () => void; 
  isRefreshing: boolean;
  onClearApiKey: () => void;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [tempKey, setTempKey] = useState(apiKey);

  const handleSave = () => {
    setApiKey(tempKey);
    setIsOpen(false);
  };

  return (
    <div className="bg-slate-800 border-b border-slate-700 p-4 flex justify-between items-center sticky top-0 z-10 shadow-md">
      <div className="flex items-center gap-3">
        {apiKey ? (
          <div className="flex items-center gap-2 text-green-400 bg-green-900/20 px-3 py-1 rounded-full border border-green-900/50">
            <CheckCircle2 size={16} />
            <span className="text-sm font-medium">API Connected</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-amber-400 bg-amber-900/20 px-3 py-1 rounded-full border border-amber-900/50">
            <AlertCircle size={16} />
            <span className="text-sm font-medium">No API Key</span>
          </div>
        )}
      </div>

      <div className="flex gap-2">
         {apiKey && (
            <button 
              onClick={onRefresh}
              disabled={isRefreshing}
              className={`px-3 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 text-slate-200 rounded transition-colors flex items-center gap-2 ${isRefreshing ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <Zap size={14} className={isRefreshing ? "animate-spin" : ""} />
              {isRefreshing ? 'Syncing...' : 'Sync Progress'}
            </button>
         )}
        <button 
          onClick={() => setIsOpen(!isOpen)}
          className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition-colors"
        >
          <Settings size={20} />
        </button>
      </div>

      {isOpen && (
        <div className="absolute top-16 right-4 w-96 bg-slate-800 border border-slate-600 rounded-lg shadow-xl p-4 z-50">
          <h4 className="font-bold text-slate-200 mb-2">API Settings</h4>
          <p className="text-xs text-slate-400 mb-4">
            Enter your Guild Wars 2 API Key with <code>account</code> and <code>progression</code> scopes.
          </p>
          <div className="flex items-center gap-2 mb-4">
            <input
              type="text"
              value={tempKey}
              onChange={(e) => setTempKey(e.target.value)}
              placeholder="XXXX-XXXX-XXXX-XXXX"
              className="flex-1 bg-slate-900 border border-slate-700 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-amber-500"
            />
            {apiKey && (
              <button
                onClick={() => {
                  onClearApiKey();
                  setTempKey('');
                }}
                className="p-2 text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded transition-colors"
                title="Clear API Key"
              >
                <Trash2 size={18} />
              </button>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <button 
              onClick={() => setIsOpen(false)}
              className="px-3 py-1 text-sm text-slate-400 hover:text-white"
            >
              Cancel
            </button>
            <button 
              onClick={handleSave}
              className="px-3 py-1 text-sm bg-amber-600 hover:bg-amber-500 text-white rounded"
            >
              Save Key
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const MyPath = ({
  starredAchievements,
  achievementsCache,
  userProgress,
  onNeedAchievements,
  onToggleStar,
  accountAccess,
  unlocksMap,
  isAchievementLocked,
  onClearStarred,
  onNavigateToAchievement,
  achievementToCategoryMap
}: {
  starredAchievements: Set<number>;
  achievementsCache: Record<number, Achievement>;
  userProgress: Record<number, UserProgress>;
  onNeedAchievements: (ids: number[]) => void;
  onToggleStar: (id: number) => void;
  accountAccess: string[];
  unlocksMap: Record<number, number[]>;
  isAchievementLocked: (achievement: Achievement) => boolean;
  onClearStarred: () => void;
  onNavigateToAchievement?: (achievementId: number) => void;
  achievementToCategoryMap?: Record<number, number>;
}) => {
  const starredIds = Array.from(starredAchievements);

  // Fetch missing achievements
  useEffect(() => {
    const missingIds = starredIds.filter(id => !achievementsCache[id]);
    if (missingIds.length > 0) {
      onNeedAchievements(missingIds);
    }
  }, [starredIds, achievementsCache, onNeedAchievements]);

  const achievements = starredIds
    .reduce<Array<{ achievement: Achievement; progress?: UserProgress }>>((acc, id) => {
      const ach = achievementsCache[id];
      if (ach) {
        acc.push({ achievement: ach, progress: userProgress[id] });
      }
      return acc;
    }, []);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-3xl font-bold text-slate-100 flex items-center gap-3">
            <Route className="text-amber-500" size={32} />
            My Path
          </h2>
          {starredAchievements.size > 0 && (
            <button
              onClick={() => {
                if (window.confirm('Are you sure you want to clear all starred achievements?')) {
                  onClearStarred();
                }
              }}
              className="px-3 py-1.5 text-sm bg-red-900/30 hover:bg-red-900/50 text-red-300 border border-red-800/50 rounded transition-colors flex items-center gap-2"
              title="Clear all starred achievements"
            >
              <Trash2 size={16} />
              Clear All
            </button>
          )}
        </div>
        <p className="text-slate-400">Your starred achievements - your personal journey.</p>
      </div>

      {achievements.length > 0 ? (
        <div className="space-y-4">
          {achievements.map(item => {
            const unlocks = unlocksMap[item.achievement.id] || [];
            return (
              <AchievementCard
                key={item.achievement.id}
                achievement={item.achievement}
                progress={item.progress}
                isStarred={true}
                onToggleStar={onToggleStar}
                isLocked={isAchievementLocked(item.achievement)}
                unlocksCount={unlocks.length}
                achievementsCache={achievementsCache}
                userProgress={userProgress}
                onNeedAchievements={onNeedAchievements}
                accountAccess={accountAccess}
                isAchievementLocked={isAchievementLocked}
                onNavigateToAchievement={onNavigateToAchievement}
                achievementToCategoryMap={achievementToCategoryMap}
              />
            );
          })}
        </div>
      ) : (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-12 text-center">
          <Star className="mx-auto mb-4 text-slate-600" size={48} />
          <p className="text-slate-400 mb-2 text-lg">No starred achievements yet</p>
          <p className="text-sm text-slate-500">
            Star achievements you want to focus on by clicking the star icon on any achievement card.
          </p>
        </div>
      )}
    </div>
  );
};

const Dashboard = ({ 
  userProgress, 
  achievementsCache,
  onNeedAchievements,
  playstyle,
  playstyleScores,
  achievementToCategoryMap,
  groups,
  onToggleStar,
  starredAchievements,
  accountAccess,
  categories,
  unlocksMap,
  accountName,
  onNavigateToAchievement,
  onShowPlaystyleChart
}: { 
  userProgress: Record<number, UserProgress>;
  achievementsCache: Record<number, Achievement>;
  onNeedAchievements: (ids: number[]) => void;
  playstyle: string;
  playstyleScores: Record<string, number>;
  achievementToCategoryMap: Record<number, number>;
  groups: AchievementGroup[];
  onToggleStar: (id: number) => void;
  starredAchievements: Set<number>;
  accountAccess: string[];
  categories: Record<string, AchievementCategory[]>;
  unlocksMap: Record<number, number[]>;
  accountName?: string;
  onNavigateToAchievement?: (achievementId: number) => void;
  onShowPlaystyleChart?: () => void;
}) => {
  const [flavor, setFlavor] = useState<string>('quickwins');
  const progressList = Object.values(userProgress);
  const totalCompleted = progressList.filter(p => p.done).length;

  // Map mastery region names to account access names
  const regionToAccessMap: Record<string, string> = {
    'Tyria': 'GuildWars2',
    'Maguuma': 'HeartOfThorns',
    'Desert': 'PathOfFire',
    'Tundra': 'IcebroodSaga',
    'Jade': 'EndOfDragons',
    'Sky': 'SecretsOfTheObscure',
    'Wild': 'JanthirWilds',
    'Magic': 'VisionsOfEternity'
  };

  // Check if an achievement is locked (mastery region or prerequisites)
  const isAchievementLocked = useCallback((achievement: Achievement): boolean => {
    // Check prerequisites first
    if (achievement.prerequisites && achievement.prerequisites.length > 0) {
      // Check if all prerequisites are completed
      const allPrerequisitesMet = achievement.prerequisites.every(prereqId => {
        const prereqProgress = userProgress[prereqId];
        return prereqProgress && (prereqProgress.done || (prereqProgress.repeated && prereqProgress.repeated > 0));
      });
      
      if (!allPrerequisitesMet) {
        return true; // Locked - prerequisites not met
      }
    }
    
    // Check mastery region locks
    if (achievement.rewards && achievement.rewards.length > 0) {
      // Check if any reward is a Mastery Point with a region
      const masteryRewards = achievement.rewards.filter(r => r.type === 'Mastery' && r.region);
      if (masteryRewards.length > 0) {
        // Check if player has access to the region
        for (const reward of masteryRewards) {
          if (reward.region) {
            const requiredAccess = regionToAccessMap[reward.region];
            if (requiredAccess && !accountAccess.includes(requiredAccess)) {
              return true; // Locked - player doesn't have access
            }
          }
        }
      }
    }
    
    return false; // Not locked
  }, [accountAccess, userProgress]);

  // Build category to group map
  const catToGroupMap = useMemo(() => {
    const map: Record<number, string> = {};
    groups.forEach(g => {
      g.categories.forEach(c => {
        map[c] = g.name;
      });
    });
    return map;
  }, [groups]);

  // Smart scoring function for achievement recommendations
  // Considers: AP value, loot value, ease of completion, unlock potential, prerequisites status
  const calculateAchievementScore = useCallback((progress: UserProgress, achievement: Achievement, unlocksMap: Record<number, number[]>): number => {
    if (!achievement) return 0;
    
    let score = 0;
    
    // 1. AP Value (0-100 points, normalized)
    const totalAP = achievement.tiers.reduce((acc, t) => acc + t.points, 0);
    score += Math.min(100, totalAP * 0.5); // Max 200 AP = 100 points
    
    // 2. Loot Value (0-80 points)
    if (achievement.rewards) {
      let lootValue = 0;
      achievement.rewards.forEach(reward => {
        if (reward.type === 'Item' && reward.item) {
          // Base value from vendor_value
          const vendorValue = reward.item.vendor_value || 0;
          lootValue += vendorValue * 0.001; // Convert copper to points (1000 copper = 1 point)
          
          // Rarity bonus
          const rarityMultiplier: Record<string, number> = {
            'Legendary': 50,
            'Ascended': 30,
            'Exotic': 15,
            'Rare': 8,
            'Masterwork': 4,
            'Fine': 2,
            'Basic': 1
          };
          if (reward.item.rarity) {
            lootValue += rarityMultiplier[reward.item.rarity] || 0;
          }
          
          // Special item bonuses (bags, mounts, etc.)
          const itemName = reward.item.name.toLowerCase();
          const itemType = reward.item.type?.toLowerCase() || '';
          if (itemType === 'bag' || itemName.includes('bag')) {
            const bagSize = reward.item.details?.size || 0;
            if (bagSize >= 20) lootValue += 20;
            else if (bagSize >= 15) lootValue += 10;
          }
          if (itemName.includes('mount') || itemName.includes('skyscale') || itemName.includes('griffon')) {
            lootValue += 40;
          }
        } else if (reward.type === 'Mastery') {
          lootValue += 25; // Mastery points are valuable
        } else if (reward.type === 'Title') {
          lootValue += 5; // Titles have some value
        }
      });
      score += Math.min(80, lootValue);
    }
    
    // 3. Ease of Completion (0-60 points)
    // Higher progress = easier to complete
    if (progress.current && progress.max) {
      const progressPercent = (progress.current / progress.max) * 100;
      score += Math.min(60, progressPercent * 0.6); // 100% progress = 60 points
    } else {
      // No progress yet - check if it's simple (few tiers, no prerequisites)
      const tierCount = achievement.tiers.length;
      const hasPrerequisites = achievement.prerequisites && achievement.prerequisites.length > 0;
      if (!hasPrerequisites && tierCount <= 3) {
        score += 20; // Simple achievements get a bonus
      }
    }
    
    // 4. Unlock Potential (0-50 points)
    const unlocks = unlocksMap[achievement.id] || [];
    score += Math.min(50, unlocks.length * 5); // Each unlock = 5 points, max 50
    
    // 5. Prerequisites Status (0-30 points)
    // Bonus if all prerequisites are completed (ready to start)
    if (achievement.prerequisites && achievement.prerequisites.length > 0) {
      const allPrereqsMet = achievement.prerequisites.every(prereqId => {
        const prereqProg = userProgress[prereqId];
        return prereqProg && (prereqProg.done || (prereqProg.repeated && prereqProg.repeated > 0));
      });
      if (allPrereqsMet) {
        score += 30; // Ready to start = bonus
      }
    } else {
      score += 20; // No prerequisites = easier to start
    }
    
    // 6. Meta Achievement Bonus (0-40 points)
    if (achievement.flags.includes('CategoryDisplay')) {
      score += 40; // Meta achievements are high value
    }
    
    return score;
  }, [userProgress, unlocksMap]);

  // Calculate Recommendations based on flavor
  const recommendations = useMemo(() => {
    let filtered = progressList.filter(p => {
      // Filter out done achievements
      if (p.done) return false;
      
      // Filter out Daily/Weekly/Monthly achievements
      const ach = achievementsCache[p.id];
      if (ach && shouldFilterAchievement(ach)) return false;
      
      // Filter out locked achievements
      if (ach && isAchievementLocked(ach)) return false;
      
      return true;
    });

    if (flavor === 'quickwins') {
      // Nearly complete achievements (> 80% progress)
      filtered = filtered
        .filter(p => p.current && p.max && (p.current / p.max > 0.8))
        .sort((a, b) => {
          const pctA = (a.current || 0) / (a.max || 1);
          const pctB = (b.current || 0) / (b.max || 1);
          return pctB - pctA;
        });
    } else if (flavor === 'legendary') {
      // Legendary Gear collections (ItemSet type, legendary-related)
      filtered = filtered.filter(p => {
        const ach = achievementsCache[p.id];
        if (!ach || ach.type !== 'ItemSet') return false;
        const catId = achievementToCategoryMap[p.id];
        const groupName = catId ? catToGroupMap[catId] : '';
        const nameLower = ach.name.toLowerCase();
        const descLower = (ach.description || '').toLowerCase();
        // Check for legendary keywords
        return nameLower.includes('legendary') || 
               descLower.includes('legendary') ||
               (groupName && (groupName.includes('Legendary') || groupName.includes('Legend')));
      });
    } else if (flavor === 'fashion') {
      // Fashion/Wardrobe collections (ItemSet type, skin/outfit related)
      filtered = filtered.filter(p => {
        const ach = achievementsCache[p.id];
        if (!ach || ach.type !== 'ItemSet') return false;
        const catId = achievementToCategoryMap[p.id];
        const groupName = catId ? catToGroupMap[catId] : '';
        const nameLower = ach.name.toLowerCase();
        const descLower = (ach.description || '').toLowerCase();
        // Check for fashion keywords
        return nameLower.includes('skin') || 
               nameLower.includes('outfit') ||
               nameLower.includes('wardrobe') ||
               nameLower.includes('fashion') ||
               descLower.includes('skin') ||
               descLower.includes('outfit') ||
               (groupName && (groupName.includes('Fashion') || groupName.includes('Wardrobe')));
      });
    } else if (flavor === 'seasonal') {
      // Seasonal/Festival collections (ItemSet type, festival related)
      filtered = filtered.filter(p => {
        const ach = achievementsCache[p.id];
        if (!ach || ach.type !== 'ItemSet') return false;
        const catId = achievementToCategoryMap[p.id];
        const groupName = catId ? catToGroupMap[catId] : '';
        const nameLower = ach.name.toLowerCase();
        const descLower = (ach.description || '').toLowerCase();
        // Check for festival/seasonal keywords
        const festivalKeywords = ['halloween', 'wintersday', 'dragon bash', 'festival', 'lunar new year', 'super adventure', 'four winds', 'queen\'s gauntlet'];
        return festivalKeywords.some(keyword => 
          nameLower.includes(keyword) || 
          descLower.includes(keyword) ||
          (groupName && groupName.toLowerCase().includes(keyword))
        );
      });
    } else if (flavor === 'mastery') {
      // Achievements that grant Mastery Points
      filtered = filtered.filter(p => {
        const ach = achievementsCache[p.id];
        if (!ach) return false;
        // Look for achievements with Mastery Point rewards
        return ach.rewards && ach.rewards.some(reward => reward.type === 'Mastery');
      });
    } else if (flavor === 'meta') {
      // Meta achievements (CategoryDisplay flag)
      filtered = filtered.filter(p => {
        const ach = achievementsCache[p.id];
        if (!ach) return false;
        return ach.flags.includes('CategoryDisplay');
      });
    } else if (flavor === 'story') {
      // Story and Living World achievements
      filtered = filtered.filter(p => {
        const catId = achievementToCategoryMap[p.id];
        if (!catId) return false;
        const groupName = catToGroupMap[catId];
        if (!groupName) return false;
        return ['Story', 'Living World', 'Side Stories', 'Heart of Thorns', 'Path of Fire', 'End of Dragons', 'Secrets of the Obscure', 'Janthir Wilds'].some(s => groupName.includes(s));
      });
    } else if (flavor === 'endgame') {
      // Raids, Strikes, and Fractals
      filtered = filtered.filter(p => {
        const catId = achievementToCategoryMap[p.id];
        if (!catId) return false;
        const groupName = catToGroupMap[catId];
        if (!groupName) return false;
        return ['Raids', 'Strike Missions', 'Strikes', 'Fractals'].some(s => groupName.includes(s));
      });
    } else if (flavor === 'competitive') {
      // PvP/WvW achievements
      filtered = filtered.filter(p => {
        const catId = achievementToCategoryMap[p.id];
        if (!catId) return false;
        const groupName = catToGroupMap[catId];
        if (!groupName) return false;
        return ['Competitive', 'WvW', 'PvP', 'World vs. World'].some(s => groupName.includes(s));
      });
    } else if (flavor === 'wildcard') {
      // Wild Card - all incomplete achievements, smart-weighted
      // No additional filtering, just use all filtered achievements
    }

    // Sort by smart scoring for all flavors except 'quickwins' (which is sorted by progress)
    if (flavor !== 'quickwins') {
      filtered = filtered.sort((a, b) => {
        const achA = achievementsCache[a.id];
        const achB = achievementsCache[b.id];
        
        if (!achA && !achB) return 0;
        if (!achA) return 1;
        if (!achB) return -1;
        
        // Use smart scoring for all flavors
        const scoreA = calculateAchievementScore(a, achA, unlocksMap);
        const scoreB = calculateAchievementScore(b, achB, unlocksMap);
        
        return scoreB - scoreA; // Sort descending by score
      });
    }

    return filtered.slice(0, 12); // Increased from 5 to 12
  }, [progressList, flavor, achievementToCategoryMap, catToGroupMap, achievementsCache, isAchievementLocked, categories, userProgress, unlocksMap, calculateAchievementScore]);

  // Effect to request data for recommendations if missing
  useEffect(() => {
    const missingIds = recommendations
      .map(p => p.id)
      .filter(id => !achievementsCache[id]);
    
    if (missingIds.length > 0) {
      onNeedAchievements(missingIds);
    }
  }, [recommendations, achievementsCache, onNeedAchievements]);

  // Effect to fetch achievement data for discover mode
  useEffect(() => {
    if (flavor !== 'discover') return;
    
    // Get achievement IDs from recommendations that we don't have data for
    const missingIds = recommendations
      .map(p => p.id)
      .filter(id => !achievementsCache[id]);
    
    if (missingIds.length > 0) {
      // Use the existing onNeedAchievements function to fetch them
      onNeedAchievements(missingIds);
    }
  }, [flavor, recommendations, achievementsCache, onNeedAchievements]);

  // Generate recommendation reason for an achievement
  const getRecommendationReason = useCallback((progress: UserProgress, achievement: Achievement): string | undefined => {
    if (!achievement) return undefined;

    const reasons: string[] = [];
    const totalPoints = achievement.tiers.reduce((acc, t) => acc + t.points, 0);
    
    // High AP value
    if (totalPoints >= 50) {
      reasons.push(`High-value reward (${totalPoints} AP)`);
    } else if (totalPoints >= 25) {
      reasons.push(`Good reward (${totalPoints} AP)`);
    }

    // Unlocks others
    const unlocks = unlocksMap[achievement.id];
    if (unlocks && unlocks.length > 0) {
      reasons.push(`Unlocks ${unlocks.length} other achievement${unlocks.length > 1 ? 's' : ''}`);
    }

    // Progress-based
    if (progress.current && progress.max) {
      const percent = (progress.current / progress.max) * 100;
      if (percent >= 90) {
        reasons.push('Almost complete!');
      } else if (percent >= 75) {
        reasons.push('Nearly there');
      }
    }

    // Mastery points
    const hasMastery = achievement.rewards?.some(r => r.type === 'Mastery');
    if (hasMastery) {
      reasons.push('Grants Mastery Point');
    }

    // Rewards
    if (achievement.rewards && achievement.rewards.length > 0) {
      const rewardTypes = achievement.rewards.map(r => r.type).filter((v, i, a) => a.indexOf(v) === i);
      if (rewardTypes.length > 0 && !hasMastery) {
        reasons.push(`Rewards: ${rewardTypes.join(', ')}`);
      }
    }

    return reasons.length > 0 ? reasons.join(' • ') : undefined;
  }, [unlocksMap]);

  const getPlaystyleIcon = (style: string) => {
    switch (style) {
      case 'Battlemaster': return <Crosshair size={24} />;
      case 'Commander': return <Crown size={24} />;
      case 'Historian': return <Scroll size={24} />;
      case 'Collector': return <Star size={24} />;
      default: return <Compass size={24} />;
    }
  };

  const getPlaystyleDesc = (style: string) => {
    switch (style) {
      case 'Battlemaster': return "Focused on PvP & WvW dominance.";
      case 'Commander': return "Focused on Raids, Fractals & Strikes.";
      case 'Historian': return "Focused on Story & Lore achievements.";
      case 'Collector': return "Focused on Items, Skins & Collections.";
      default: return "Balanced focus across all areas.";
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-8 text-center">
        <h2 className="text-3xl font-bold text-slate-100 mb-2">Welcome, {accountName ? accountName.replace(/\.\d+$/, '') : 'Pathfinder'}</h2>
        <p className="text-slate-400">Track your Guild Wars 2 journey and find your next adventure.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-slate-800 p-4 rounded-lg border border-slate-700 flex items-center gap-4">
          <div className="p-3 bg-green-900/30 text-green-400 rounded-full">
            <CheckCircle2 size={24} />
          </div>
          <div>
            <div className="text-2xl font-bold text-slate-100">{totalCompleted}</div>
            <div className="text-xs text-slate-400 uppercase font-semibold">Completed Achievements</div>
          </div>
        </div>
        <div className="bg-slate-800 p-4 rounded-lg border border-slate-700 flex items-center gap-4">
          <div className="p-3 bg-amber-900/30 text-amber-400 rounded-full">
            <Trophy size={24} />
          </div>
          <div>
            <div className="text-2xl font-bold text-slate-100">{progressList.length}</div>
            <div className="text-xs text-slate-400 uppercase font-semibold">In Progress</div>
          </div>
        </div>
        <button
          onClick={() => onShowPlaystyleChart?.()}
          className="bg-slate-800 p-4 rounded-lg border border-slate-700 flex items-center gap-4 hover:bg-slate-700 hover:border-slate-600 transition-colors cursor-pointer text-left w-full"
          title="Click to view playstyle breakdown"
        >
          <div className="p-3 bg-blue-900/30 text-blue-400 rounded-full">
            {getPlaystyleIcon(playstyle)}
          </div>
          <div className="flex-1">
            <div className="text-2xl font-bold text-slate-100">{playstyle}</div>
            <div className="text-xs text-slate-400 uppercase font-semibold">{getPlaystyleDesc(playstyle)}</div>
          </div>
          <div className="text-slate-500">
            <ChevronRight size={20} />
          </div>
        </button>
      </div>

      <div className="space-y-6">
        {/* Flavor Selector */}
        <section>
          <h3 className="text-xl font-bold text-slate-200 mb-4 flex items-center gap-2">
            <Compass className="text-amber-500" /> What's Your Goal?
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-5 gap-3 mb-6">
            <button
              onClick={() => setFlavor('quickwins')}
              className={`p-4 rounded-lg border-2 transition-all ${
                flavor === 'quickwins'
                  ? 'border-amber-500 bg-amber-900/20 text-amber-300'
                  : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-600'
              }`}
            >
              <div className="flex flex-col items-center gap-2">
                <Target size={24} />
                <span className="text-sm font-semibold">Quick Wins</span>
                <span className="text-xs text-slate-400 text-center">Nearly complete achievements</span>
              </div>
            </button>
            <button
              onClick={() => setFlavor('legendary')}
              className={`p-4 rounded-lg border-2 transition-all ${
                flavor === 'legendary'
                  ? 'border-amber-500 bg-amber-900/20 text-amber-300'
                  : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-600'
              }`}
            >
              <div className="flex flex-col items-center gap-2">
                <Gem size={24} />
                <span className="text-sm font-semibold">Legendary Gear</span>
                <span className="text-xs text-slate-400 text-center">Legendary collections</span>
              </div>
            </button>
            <button
              onClick={() => setFlavor('fashion')}
              className={`p-4 rounded-lg border-2 transition-all ${
                flavor === 'fashion'
                  ? 'border-amber-500 bg-amber-900/20 text-amber-300'
                  : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-600'
              }`}
            >
              <div className="flex flex-col items-center gap-2">
                <Shirt size={24} />
                <span className="text-sm font-semibold">Fashion</span>
                <span className="text-xs text-slate-400 text-center">Skins & wardrobe</span>
              </div>
            </button>
            <button
              onClick={() => setFlavor('seasonal')}
              className={`p-4 rounded-lg border-2 transition-all ${
                flavor === 'seasonal'
                  ? 'border-amber-500 bg-amber-900/20 text-amber-300'
                  : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-600'
              }`}
            >
              <div className="flex flex-col items-center gap-2">
                <Calendar size={24} />
                <span className="text-sm font-semibold">Seasonal</span>
                <span className="text-xs text-slate-400 text-center">Festival collections</span>
              </div>
            </button>
            <button
              onClick={() => setFlavor('mastery')}
              className={`p-4 rounded-lg border-2 transition-all ${
                flavor === 'mastery'
                  ? 'border-amber-500 bg-amber-900/20 text-amber-300'
                  : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-600'
              }`}
            >
              <div className="flex flex-col items-center gap-2">
                <Star size={24} className="fill-current" />
                <span className="text-sm font-semibold">Mastery</span>
                <span className="text-xs text-slate-400 text-center">Mastery Point rewards</span>
              </div>
            </button>
            <button
              onClick={() => setFlavor('meta')}
              className={`p-4 rounded-lg border-2 transition-all ${
                flavor === 'meta'
                  ? 'border-amber-500 bg-amber-900/20 text-amber-300'
                  : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-600'
              }`}
            >
              <div className="flex flex-col items-center gap-2">
                <Crown size={24} />
                <span className="text-sm font-semibold">Meta</span>
                <span className="text-xs text-slate-400 text-center">High-value rewards</span>
              </div>
            </button>
            <button
              onClick={() => setFlavor('story')}
              className={`p-4 rounded-lg border-2 transition-all ${
                flavor === 'story'
                  ? 'border-amber-500 bg-amber-900/20 text-amber-300'
                  : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-600'
              }`}
            >
              <div className="flex flex-col items-center gap-2">
                <Scroll size={24} />
                <span className="text-sm font-semibold">Story</span>
                <span className="text-xs text-slate-400 text-center">Story & Living World</span>
              </div>
            </button>
            <button
              onClick={() => setFlavor('endgame')}
              className={`p-4 rounded-lg border-2 transition-all ${
                flavor === 'endgame'
                  ? 'border-amber-500 bg-amber-900/20 text-amber-300'
                  : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-600'
              }`}
            >
              <div className="flex flex-col items-center gap-2">
                <Trophy size={24} />
                <span className="text-sm font-semibold">Endgame</span>
                <span className="text-xs text-slate-400 text-center">Raids, Strikes & Fractals</span>
              </div>
            </button>
            <button
              onClick={() => setFlavor('competitive')}
              className={`p-4 rounded-lg border-2 transition-all ${
                flavor === 'competitive'
                  ? 'border-amber-500 bg-amber-900/20 text-amber-300'
                  : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-600'
              }`}
            >
              <div className="flex flex-col items-center gap-2">
                <Sword size={24} />
                <span className="text-sm font-semibold">Competitive</span>
                <span className="text-xs text-slate-400 text-center">PvP & WvW</span>
              </div>
            </button>
            <button
              onClick={() => setFlavor('wildcard')}
              className={`p-4 rounded-lg border-2 transition-all ${
                flavor === 'wildcard'
                  ? 'border-amber-500 bg-amber-900/20 text-amber-300'
                  : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-600'
              }`}
            >
              <div className="flex flex-col items-center gap-2">
                <Zap size={24} />
                <span className="text-sm font-semibold">Wild Card</span>
                <span className="text-xs text-slate-400 text-center">Smart recommendations</span>
              </div>
            </button>
          </div>
        </section>

        <section>
          <h3 className="text-xl font-bold text-slate-200 mb-4 flex items-center gap-2">
            <Zap className="text-amber-500" /> Recommended Next Steps
          </h3>
          
          {(() => {
            // Filter out recommendations that don't have achievement data yet
            const validRecommendations = recommendations.filter(p => achievementsCache[p.id]);
            
            if (validRecommendations.length > 0) {
              return (
                <div className="space-y-3">
                  <p className="text-sm text-slate-400 mb-2">
                    {flavor === 'quickwins' && 'You are so close to finishing these:'}
                    {flavor === 'legendary' && 'Legendary gear collections to complete:'}
                    {flavor === 'fashion' && 'Fashion and wardrobe collections:'}
                    {flavor === 'seasonal' && 'Seasonal festival collections:'}
                    {flavor === 'mastery' && 'Achievements that grant Mastery Points:'}
                    {flavor === 'meta' && 'High-value meta achievements with unique rewards:'}
                    {flavor === 'story' && 'Story and Living World achievements:'}
                    {flavor === 'endgame' && 'Endgame PvE achievements (Raids, Strikes, Fractals):'}
                    {flavor === 'competitive' && 'Competitive achievements (PvP & WvW):'}
                    {flavor === 'wildcard' && 'Smart-weighted recommendations from all achievements:'}
                  </p>
                  {validRecommendations.map(p => {
                    const ach = achievementsCache[p.id];
                    if (!ach) return null;
                    const unlocks = unlocksMap[ach.id] || [];
                    const reason = getRecommendationReason(p, ach);
                    return (
                      <AchievementCard 
                        key={p.id} 
                        achievement={ach} 
                        progress={p}
                        isStarred={starredAchievements.has(p.id)}
                        onToggleStar={onToggleStar}
                        isLocked={isAchievementLocked(ach)}
                        unlocksCount={unlocks.length}
                        recommendationReason={reason}
                        achievementsCache={achievementsCache}
                        userProgress={userProgress}
                        onNeedAchievements={onNeedAchievements}
                        accountAccess={accountAccess}
                        isAchievementLocked={isAchievementLocked}
                        onNavigateToAchievement={onNavigateToAchievement}
                        achievementToCategoryMap={achievementToCategoryMap}
                      />
                    );
                  })}
                </div>
              );
            } else if (recommendations.length > 0) {
              // We have recommendations but they're still loading
              return null; // Don't show anything while loading
            } else {
              // No recommendations found
              return (
                <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 text-center">
                  <p className="text-slate-400 mb-2">
                    No recommendations found for this goal.
                  </p>
                  <p className="text-sm text-slate-500 italic">
                    (Tip: Try a different goal or explore categories on the left!)
                  </p>
                </div>
              );
            }
          })()}
        </section>

      </div>
    </div>
  );
};

// --- Main App Component ---

export default function GW2Pathfinder() {
  const [apiKey, setApiKey] = useState<string>(() => {
      // Handle the key separately from the data cache
      return localStorage.getItem('gw2_api_key') || '';
  });
  
  const [groups, setGroups] = useState<AchievementGroup[]>([]);
  const [categories, setCategories] = useState<Record<string, AchievementCategory[]>>({});
  const [achievements, setAchievements] = useState<Record<number, Achievement>>({});
  const [userProgress, setUserProgress] = useState<Record<number, UserProgress>>({});
  const [accountAccess, setAccountAccess] = useState<string[]>([]);
  const [accountName, setAccountName] = useState<string | undefined>(() => {
    // Load account name from localStorage on initial load
    try {
      return localStorage.getItem('gw2_account_name') || undefined;
    } catch (e) {
      return undefined;
    }
  });
  const [unlocksMap, setUnlocksMap] = useState<Record<number, number[]>>({});
  
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [currentCategoryDetails, setCurrentCategoryDetails] = useState<AchievementCategory | null>(null);
  const [currentView, setCurrentView] = useState<'dashboard' | 'mypath' | 'category'>('dashboard');
  
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [loadingCategory, setLoadingCategory] = useState(false);
  const [refreshingProgress, setRefreshingProgress] = useState(false);
  
  // Playstyle
  const [playstyle, setPlaystyle] = useState("Explorer");
  const [playstyleScores, setPlaystyleScores] = useState<Record<string, number>>({
    Battlemaster: 0,
    Commander: 0,
    Historian: 0,
    Collector: 0,
    Explorer: 0
  });
  const [showPlaystyleChart, setShowPlaystyleChart] = useState(false);
  const [achievementToCategoryMap, setAchievementToCategoryMap] = useState<Record<number, number>>({});
  
  // Starred Achievements
  const [starredAchievements, setStarredAchievements] = useState<Set<number>>(() => {
    try {
      const stored = localStorage.getItem('gw2_starred_achievements');
      if (stored) {
        return new Set(JSON.parse(stored));
      }
    } catch (e) {
      console.warn("Failed to load starred achievements", e);
    }
    return new Set<number>();
  });
  

  // 1. Initial Load: Groups
  useEffect(() => {
    const fetchGroups = async () => {
      try {
        const data = await fetchWithBackoff(`${API_BASE}/groups`);
        setGroups(data);
      } catch (e) {
        console.error("Failed to fetch groups", e);
      } finally {
        setLoadingGroups(false);
      }
    };
    fetchGroups();
  }, []);

  // Pre-load all categories for all groups to calculate progress
  useEffect(() => {
    if (groups.length === 0) return;
    
    const fetchAllCategories = async () => {
      // Find groups that don't have categories loaded yet
      const groupsToLoad = groups.filter(g => !categories[g.id]);
      if (groupsToLoad.length === 0) return;

      console.log(`Pre-loading categories for ${groupsToLoad.length} groups...`);

      // Fetch categories for all groups in parallel
      const promises = groupsToLoad.map(async (group) => {
        try {
          const data = await fetchWithBackoff(`${API_BASE}/groups/${group.id}/categories`);
          return { groupId: group.id, categories: data };
        } catch (e) {
          console.error(`Failed to fetch categories for group ${group.id}`, e);
          return null;
        }
      });

      const results = await Promise.all(promises);
      const newCategories: Record<string, AchievementCategory[]> = {};
      
      results.forEach(result => {
        if (result) {
          newCategories[result.groupId] = result.categories;
        }
      });
      
      if (Object.keys(newCategories).length > 0) {
        // Pre-fetch achievement data for all categories BEFORE setting categories
        // This ensures empty categories are filtered immediately and don't appear/disappear
        const allAchievementIds: number[] = [];
        Object.values(newCategories).forEach(catList => {
          catList.forEach(cat => {
            if (cat.achievements) {
              allAchievementIds.push(...cat.achievements);
            }
          });
        });
        
        // Remove duplicates
        const uniqueAchievementIds = Array.from(new Set(allAchievementIds));
        console.log(`Pre-loading ${uniqueAchievementIds.length} achievements for filtering...`);
        
        // Fetch achievements in batches to check for Daily/Weekly/Monthly flags
        if (uniqueAchievementIds.length > 0) {
          const batchSize = 200; // GW2 API limit
          const batches: number[][] = [];
          for (let i = 0; i < uniqueAchievementIds.length; i += batchSize) {
            batches.push(uniqueAchievementIds.slice(i, i + batchSize));
          }
          
          // Fetch in parallel batches and wait for all to complete
          try {
            const batchResults = await Promise.all(batches.map(async (batch) => {
              try {
                const data = await fetchWithBackoff(`${API_BASE}/achievements?ids=${batch.join(',')}`);
                // Store ALL achievements (even filtered ones) so hasValidAchievements can check completeness
                // Filtering happens in getValidAchievementIds, not here
                return data.reduce((acc: Record<number, Achievement>, ach: Achievement) => {
                  acc[ach.id] = ach;
                  return acc;
                }, {} as Record<number, Achievement>);
              } catch (e) {
                console.error("Failed to pre-fetch achievements for filtering", e);
                return {} as Record<number, Achievement>;
              }
            }));
            
            // Merge all batch results
            const mergedAchievements: Record<number, Achievement> = {};
            batchResults.forEach(batchResult => {
              Object.assign(mergedAchievements, batchResult);
            });
            
            // Update achievements state FIRST with all data (including filtered achievements)
            // This ensures hasValidAchievements can check if all achievement IDs are present
            setAchievements(prev => ({ ...prev, ...mergedAchievements }));
            console.log(`Pre-loaded ${Object.keys(mergedAchievements).length} achievements`);
            
            // THEN set categories - this ensures filtering happens immediately
            // Categories will only show if they have valid achievements (due to hasValidAchievements check)
            setCategories(prev => ({ ...prev, ...newCategories }));
          } catch (e) {
            console.error("Error pre-fetching achievements", e);
            // Even if achievement loading fails, set categories (they'll be filtered as data loads)
            setCategories(prev => ({ ...prev, ...newCategories }));
          }
        } else {
          // No achievements to load, just set categories
          setCategories(prev => ({ ...prev, ...newCategories }));
        }
      }
    };

    fetchAllCategories();
  }, [groups]); // Removed 'categories' from deps to prevent re-running when categories update

  // 2. Fetch Categories when Group Selected (fallback if not pre-loaded)
  useEffect(() => {
    if (!selectedGroup) return;
    
    // Check if we already have this group's categories in memory
    if (categories[selectedGroup]) return;

    const fetchCategoriesForGroup = async () => {
      try {
        const data = await fetchWithBackoff(`${API_BASE}/groups/${selectedGroup}/categories`);
        setCategories(prev => ({ ...prev, [selectedGroup]: data }));
      } catch (e) {
        console.error("Failed to fetch categories", e);
      }
    };

    fetchCategoriesForGroup();
  }, [selectedGroup, categories]);

  // 3. Fetch Achievements when Category Selected
  useEffect(() => {
    if (!selectedCategory) return;

    const fetchAchievementsForCategory = async () => {
      // Find category object
      let categoryObj: AchievementCategory | undefined;
      for (const grp in categories) {
        const found = categories[grp].find(c => c.id === selectedCategory);
        if (found) {
          categoryObj = found;
          break;
        }
      }

      if (!categoryObj) {
        return;
      }
      
      setCurrentCategoryDetails(categoryObj);

      // Check if we already have all achievement data for this category
      const categoryAchievementIds = categoryObj.achievements || [];
      const missingAchievementIds = categoryAchievementIds.filter(id => !achievements[id]);
      
      // Only fetch if we're missing achievement data
      if (missingAchievementIds.length > 0) {
        setLoadingCategory(true);
        try {
          const data = await fetchWithBackoff(`${API_BASE}/categories/${selectedCategory}/achievements`);
          
          const newAchievements = data.reduce((acc: Record<number, Achievement>, ach: Achievement) => {
            acc[ach.id] = ach;
            return acc;
          }, {});

          setAchievements(prev => ({ ...prev, ...newAchievements }));
        } catch (e) {
          console.error("Failed to fetch achievements", e);
        } finally {
          setLoadingCategory(false);
        }
      } else {
        // All data already loaded, just set loading to false
        setLoadingCategory(false);
      }
    };

    fetchAchievementsForCategory();
  }, [selectedCategory, categories, achievements]); // Added 'achievements' back to check if data is already loaded

  // 4. User Progress Sync (still uses GW2 API directly)
  const syncUserProgress = useCallback(async () => {
    if (!apiKey) return;
    setRefreshingProgress(true);
    try {
      // Fetch account info for access checking and name
      const accountData = await fetchWithBackoff(`${GW2_API_BASE}/account?access_token=${apiKey}`);
      setAccountAccess(accountData.access || []);
      
      // Extract account name from account data
      const name = accountData.name || undefined;
      setAccountName(name);
      // Persist account name to localStorage
      if (name) {
        localStorage.setItem('gw2_account_name', name);
      } else {
        localStorage.removeItem('gw2_account_name');
      }
      
      // Fetch user progress
      const data = await fetchWithBackoff(`${GW2_API_BASE}/account/achievements?access_token=${apiKey}`);
      const progressMap = data.reduce((acc: any, p: UserProgress) => {
        acc[p.id] = p;
        return acc;
      }, {});
      setUserProgress(progressMap);
      localStorage.setItem('gw2_api_key', apiKey);
    } catch (e) {
      console.error("Failed to fetch user progress", e);
      alert("Failed to sync progress. Check your API Key.");
    } finally {
      setRefreshingProgress(false);
    }
  }, [apiKey]);

  useEffect(() => {
    if (apiKey) {
      syncUserProgress();
    }
  }, [apiKey, syncUserProgress]);

  // 5. Build Achievement -> Category Map (Background Process for Playstyle)
  useEffect(() => {
    const buildMap = async () => {
        if (groups.length === 0) return;
        
        try {
            const map = await fetchWithBackoff(`${API_BASE}/achievement-category-map`);
            setAchievementToCategoryMap(map);
        } catch (e) {
            console.error("Failed to fetch achievement-category map", e);
        }
    };
    
    // Simple debounce/delay to not block UI
    const t = setTimeout(buildMap, 2000);
    return () => clearTimeout(t);
  }, [groups]);

  // 5b. Build Achievement Unlocks Map (which achievements unlock others)
  useEffect(() => {
    const fetchUnlocksMap = async () => {
      if (groups.length === 0) return;
      
      try {
        const map = await fetchWithBackoff(`${API_BASE}/achievement-unlocks-map`);
        setUnlocksMap(map);
      } catch (e) {
        console.error("Failed to fetch achievement-unlocks map", e);
      }
    };
    
    // Simple debounce/delay to not block UI
    const t = setTimeout(fetchUnlocksMap, 2500);
    return () => clearTimeout(t);
  }, [groups]);

  // 6. Calculate Playstyle (Improved with AP weighting and better categorization)
  useEffect(() => {
      if (Object.keys(userProgress).length === 0 || Object.keys(achievementToCategoryMap).length === 0 || groups.length === 0) return;

      const scores = {
          Battlemaster: 0,
          Commander: 0,
          Historian: 0,
          Collector: 0,
          Explorer: 0
      };

      // Helper to find group for a category
      const catToGroupMap: Record<number, string> = {};
      groups.forEach(g => {
          g.categories.forEach(c => {
              catToGroupMap[c] = g.name;
          });
      });

      // Process all achievements (completed and in-progress, weighted by progress)
      Object.values(userProgress).forEach(p => {
          const catId = achievementToCategoryMap[p.id];
          if (!catId) return; // Unknown achievement (maybe new?)
          
          const groupName = catToGroupMap[catId];
          if (!groupName) return;

          const achievement = achievements[p.id];
          if (!achievement) return;

          // Calculate weight: AP value * progress percentage
          const totalAP = achievement.tiers.reduce((acc, t) => acc + t.points, 0);
          let progressWeight = 1.0;
          
          if (p.done || (p.repeated && p.repeated > 0)) {
              progressWeight = 1.0; // Full weight for completed
          } else if (p.current && p.max) {
              progressWeight = Math.max(0.3, p.current / p.max); // Partial weight for in-progress (min 30%)
          } else {
              progressWeight = 0.3; // Small weight for started but no progress
          }
          
          const weightedScore = totalAP * progressWeight;

          // Categorize based on Group Name and Achievement Type
          let categorized = false;

          // Battlemaster: Competitive, PvP, WvW
          if (['Competitive', 'WvW', 'PvP', 'World vs. World'].some(s => groupName.includes(s))) {
              scores.Battlemaster += weightedScore;
              categorized = true;
          } 
          // Commander: Endgame PvE content
          else if (['Fractals', 'Raids', 'Strike Missions', 'Strikes'].some(s => groupName.includes(s))) {
              scores.Commander += weightedScore;
              categorized = true;
          } 
          // Historian: Story and Living World
          else if (['Story', 'Side Stories', 'Living World', 'Heart of Thorns', 'Path of Fire', 'End of Dragons', 'Secrets of the Obscure', 'Janthir Wilds', 'Visions of Eternity'].some(s => groupName.includes(s))) {
              scores.Historian += weightedScore;
              categorized = true;
          } 
          // Collector: Collections, Legendary, Fashion, or ItemSet type achievements
          else if (['Collections', 'Legendary', 'Fashion'].some(s => groupName.includes(s)) || 
                   achievement.type === 'ItemSet' ||
                   (achievement.name.toLowerCase().includes('collection') || 
                    achievement.name.toLowerCase().includes('legendary') ||
                    achievement.name.toLowerCase().includes('skin') ||
                    achievement.name.toLowerCase().includes('wardrobe'))) {
              scores.Collector += weightedScore;
              categorized = true;
          } 
          // Explorer: Open world, exploration, general PvE (not story-specific)
          else if (['General', 'Exploration', 'Open World', 'World Boss', 'Jumping Puzzle', 'Adventure', 'Mastery'].some(s => groupName.includes(s)) ||
                   (!categorized && (groupName.includes('Tyria') || groupName.includes('Maguuma') || groupName.includes('Desert')))) {
              scores.Explorer += weightedScore;
              categorized = true;
          }
          
          // If still not categorized, give small weight to Explorer (but less than explicit matches)
          if (!categorized) {
              scores.Explorer += weightedScore * 0.5;
          }
      });

      // Find winner with tie-breaking
      let winner = 'Explorer';
      const scoreEntries = Object.entries(scores);
      
      // Sort by score to handle ties (prefer more specific playstyles)
      const sortedScores = scoreEntries.sort((a, b) => {
          if (b[1] !== a[1]) return b[1] - a[1]; // Sort by score first
          // Tie-breaking: prefer more specific playstyles over Explorer
          const priority: Record<string, number> = {
              'Battlemaster': 4,
              'Commander': 3,
              'Historian': 2,
              'Collector': 1,
              'Explorer': 0
          };
          return (priority[b[0]] || 0) - (priority[a[0]] || 0);
      });
      
      // Only assign a playstyle if there's a clear winner (at least 20% more than second place)
      // or if Explorer is the clear winner
      if (sortedScores.length >= 2) {
          const [topStyle, topScore] = sortedScores[0];
          const [, secondScore] = sortedScores[1];
          
          // If top score is significantly higher, use it
          if (topScore > secondScore * 1.2 || topScore > 0) {
              winner = topStyle;
          } else {
              // Very close scores = balanced player = Explorer
              winner = 'Explorer';
          }
      } else if (sortedScores.length > 0) {
          winner = sortedScores[0][0];
      }
      
      setPlaystyle(winner);
      setPlaystyleScores(scores);

  }, [userProgress, achievementToCategoryMap, groups, achievements]);

  // Map mastery region names to account access names
  const regionToAccessMap: Record<string, string> = {
    'Tyria': 'GuildWars2',
    'Maguuma': 'HeartOfThorns',
    'Desert': 'PathOfFire',
    'Tundra': 'IcebroodSaga',
    'Jade': 'EndOfDragons',
    'Sky': 'SecretsOfTheObscure',
    'Wild': 'JanthirWilds',
    'Magic': 'VisionsOfEternity'
  };

  // Check if an achievement is locked (mastery region or prerequisites)
  const isAchievementLocked = useCallback((achievement: Achievement): boolean => {
    // Check prerequisites first
    if (achievement.prerequisites && achievement.prerequisites.length > 0) {
      // Check if all prerequisites are completed
      const allPrerequisitesMet = achievement.prerequisites.every(prereqId => {
        const prereqProgress = userProgress[prereqId];
        return prereqProgress && (prereqProgress.done || (prereqProgress.repeated && prereqProgress.repeated > 0));
      });
      
      if (!allPrerequisitesMet) {
        return true; // Locked - prerequisites not met
      }
    }
    
    // Check mastery region locks
    if (achievement.rewards && achievement.rewards.length > 0) {
      // Check if any reward is a Mastery Point with a region
      const masteryRewards = achievement.rewards.filter(r => r.type === 'Mastery' && r.region);
      if (masteryRewards.length > 0) {
        // Check if player has access to the region
        for (const reward of masteryRewards) {
          if (reward.region) {
            const requiredAccess = regionToAccessMap[reward.region];
            if (requiredAccess && !accountAccess.includes(requiredAccess)) {
              return true; // Locked - player doesn't have access
            }
          }
        }
      }
    }
    
    return false; // Not locked
  }, [accountAccess, userProgress]);

  // Helper to check if an achievement needs item data refresh
  const needsItemDataRefresh = useCallback((ach: Achievement): boolean => {
    if (!ach || !ach.rewards) return false;
    // Check if there are item rewards but no item data
    return ach.rewards.some(reward => 
      reward.type === 'Item' && reward.id && !reward.item
    );
  }, []);

  // Helper to check if an achievement needs title data refresh
  const needsTitleDataRefresh = useCallback((ach: Achievement): boolean => {
    if (!ach || !ach.rewards) return false;
    // Check if there are title rewards but no title data
    return ach.rewards.some(reward => 
      reward.type === 'Title' && reward.id && !reward.title
    );
  }, []);

  // Helper to fetch specific IDs (used by dashboard)
  const fetchSpecificAchievements = useCallback(async (ids: number[]) => {
      // Filter out what we already have, OR achievements that need item/title data refresh
      const idsToFetch = ids.filter(id => {
        const existing = achievements[id];
        if (!existing) return true; // Need to fetch if not in cache
        // Also fetch if it has item rewards but no item data, or title rewards but no title data
        return needsItemDataRefresh(existing) || needsTitleDataRefresh(existing);
      });
      
      if (idsToFetch.length === 0) return;

      try {
          const res = await fetchWithBackoff(`${API_BASE}/achievements?ids=${idsToFetch.join(',')}`);
          // Filter out Daily/Weekly/Monthly achievements
          const filteredRes = res.filter((ach: Achievement) => !shouldFilterAchievement(ach));
          const newMap = filteredRes.reduce((acc: any, ach: Achievement) => {
              acc[ach.id] = ach;
              return acc;
          }, {});
          
          setAchievements(prev => ({ ...prev, ...newMap }));
      } catch (e) {
          console.error("Failed to fetch specific achievements", e);
      }
  }, [achievements, needsItemDataRefresh, needsTitleDataRefresh]);

  // Refresh achievements missing item or title data
  useEffect(() => {
    // Check all cached achievements for ones that need item or title data refresh
    const achievementsNeedingRefresh: number[] = [];
    Object.values(achievements).forEach(ach => {
      if (needsItemDataRefresh(ach) || needsTitleDataRefresh(ach)) {
        achievementsNeedingRefresh.push(ach.id);
      }
    });

    // Refresh in batches to avoid overwhelming the API
    // Only refresh if we have achievements that need it and we have a reasonable number
    if (achievementsNeedingRefresh.length > 0 && achievementsNeedingRefresh.length < 1000) {
      const batchSize = 200;
      // Use setTimeout to debounce and avoid blocking
      const timeoutId = setTimeout(() => {
        for (let i = 0; i < achievementsNeedingRefresh.length; i += batchSize) {
          const batch = achievementsNeedingRefresh.slice(i, i + batchSize);
          fetchSpecificAchievements(batch);
        }
      }, 1000); // Wait 1 second before refreshing to batch requests
      
      return () => clearTimeout(timeoutId);
    }
  }, [achievements, needsItemDataRefresh, needsTitleDataRefresh, fetchSpecificAchievements]);

  const handleClearApiKey = useCallback(() => {
    setApiKey('');
    localStorage.removeItem('gw2_api_key');
    localStorage.removeItem('gw2_account_name');
    setUserProgress({});
    setAccountAccess([]);
    setAccountName(undefined);
  }, []);

  const handleClearStarred = useCallback(() => {
    setStarredAchievements(new Set<number>());
    localStorage.removeItem('gw2_starred_achievements');
  }, []);

  // Helper function to get all prerequisites recursively and sort them topologically
  // Returns prerequisites in order (dependencies first), excluding the achievement itself
  const getPrerequisitesInOrder = useCallback((achievementId: number, achievementsCache: Record<number, Achievement>, userProgress: Record<number, UserProgress>): number[] => {
    const visited = new Set<number>();
    const result: number[] = [];
    
    const visit = (id: number, isRoot: boolean = false) => {
      if (visited.has(id)) return;
      visited.add(id);
      
      const ach = achievementsCache[id];
      if (!ach || !ach.prerequisites || ach.prerequisites.length === 0) {
        // Only add if it's not the root achievement (we'll add that separately)
        if (!isRoot) {
          result.push(id);
        }
        return;
      }
      
      // Visit all prerequisites first
      for (const prereqId of ach.prerequisites) {
        const prereqProg = userProgress[prereqId];
        const isCompleted = prereqProg && (prereqProg.done || (prereqProg.repeated && prereqProg.repeated > 0));
        // Only add uncompleted prerequisites
        if (!isCompleted && achievementsCache[prereqId]) {
          visit(prereqId, false);
        }
      }
      
      // Don't add the root achievement to prerequisites list
      if (!isRoot) {
        result.push(id);
      }
    };
    
    visit(achievementId, true);
    return result;
  }, []);

  const handleToggleStar = useCallback((id: number) => {
    setStarredAchievements(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        // Unstarring - just remove it
        newSet.delete(id);
      } else {
        // Starring - add the achievement and its uncompleted prerequisites in order
        const achievement = achievements[id];
        if (achievement && achievement.prerequisites && achievement.prerequisites.length > 0) {
          // Get prerequisites in topological order (dependencies first)
          const prerequisitesInOrder = getPrerequisitesInOrder(id, achievements, userProgress);
          
          // Filter to only uncompleted prerequisites and add them
          prerequisitesInOrder.forEach(prereqId => {
            const prereqProg = userProgress[prereqId];
            const isCompleted = prereqProg && (prereqProg.done || (prereqProg.repeated && prereqProg.repeated > 0));
            if (!isCompleted && achievements[prereqId]) {
              newSet.add(prereqId);
            }
          });
        }
        // Add the achievement itself
        newSet.add(id);
      }
      // Persist to localStorage
      try {
        localStorage.setItem('gw2_starred_achievements', JSON.stringify(Array.from(newSet)));
      } catch (e) {
        console.warn("Failed to save starred achievements", e);
      }
      return newSet;
    });
  }, [achievements, userProgress, getPrerequisitesInOrder]);

  const handleGoHome = () => {
    setSelectedCategory(null);
    setSelectedGroup(null);
    setCurrentView('dashboard');
  };

  const handleGoToMyPath = () => {
    setSelectedCategory(null);
    setSelectedGroup(null);
    setCurrentView('mypath');
  };

  const handleSelectCategory = (id: number) => {
    setSelectedCategory(id);
    setCurrentView('category');
  };

  // Navigate to an achievement by finding its category
  const handleNavigateToAchievement = useCallback((achievementId: number) => {
    const categoryId = achievementToCategoryMap[achievementId];
    if (categoryId) {
      handleSelectCategory(categoryId);
      // Scroll to the achievement after a short delay to allow rendering
      setTimeout(() => {
        const element = document.getElementById(`achievement-${achievementId}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
    }
  }, [achievementToCategoryMap]);

  const renderContent = () => {
    if (currentView === 'mypath') {
      return (
        <MyPath
          starredAchievements={starredAchievements}
          achievementsCache={achievements}
          userProgress={userProgress}
          onNeedAchievements={fetchSpecificAchievements}
          onToggleStar={handleToggleStar}
          accountAccess={accountAccess}
          unlocksMap={unlocksMap}
          isAchievementLocked={isAchievementLocked}
          onClearStarred={handleClearStarred}
          onNavigateToAchievement={handleNavigateToAchievement}
          achievementToCategoryMap={achievementToCategoryMap}
        />
      );
    }

    if (currentView === 'dashboard') {
      return (
        <Dashboard 
          userProgress={userProgress} 
          achievementsCache={achievements}
          onNeedAchievements={fetchSpecificAchievements}
          playstyle={playstyle}
          playstyleScores={playstyleScores}
          achievementToCategoryMap={achievementToCategoryMap}
          groups={groups}
          onToggleStar={handleToggleStar}
          starredAchievements={starredAchievements}
          accountAccess={accountAccess}
          categories={categories}
          unlocksMap={unlocksMap}
          accountName={accountName}
          onNavigateToAchievement={handleNavigateToAchievement}
          onShowPlaystyleChart={() => setShowPlaystyleChart(true)}
        />
      );
    }

    if (currentView === 'category' && !selectedCategory) {
      return (
        <Dashboard 
          userProgress={userProgress} 
          achievementsCache={achievements}
          onNeedAchievements={fetchSpecificAchievements}
          playstyle={playstyle}
          playstyleScores={playstyleScores}
          achievementToCategoryMap={achievementToCategoryMap}
          groups={groups}
          onToggleStar={handleToggleStar}
          starredAchievements={starredAchievements}
          accountAccess={accountAccess}
          categories={categories}
          unlocksMap={unlocksMap}
          accountName={accountName}
          onNavigateToAchievement={handleNavigateToAchievement}
          onShowPlaystyleChart={() => setShowPlaystyleChart(true)}
        />
      );
    }

    if (loadingCategory) {
      return (
        <div className="flex items-center justify-center h-full text-slate-500">
          <div className="flex flex-col items-center gap-4">
             <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
             <p>Loading from archives...</p>
          </div>
        </div>
      );
    }

    if (!currentCategoryDetails) return null;

    // Filter out Daily/Weekly/Monthly achievements
    const sortedIds = currentCategoryDetails.achievements.filter(id => {
      const ach = achievements[id];
      if (!ach) return false; // Don't include if we don't have data yet
      return !shouldFilterAchievement(ach);
    });
    
    return (
      <div className="p-4 max-w-5xl mx-auto pb-20">
        <div className="mb-6 flex items-center gap-4 border-b border-slate-700 pb-4">
            <div className="w-16 h-16 bg-slate-800 rounded-lg flex items-center justify-center border border-slate-600">
                 <img src={currentCategoryDetails.icon} alt="" className="w-12 h-12 opacity-80" />
            </div>
            <div>
                 <h2 className="text-2xl font-bold text-slate-100">{currentCategoryDetails.name}</h2>
                 <p className="text-slate-400">{currentCategoryDetails.description}</p>
            </div>
        </div>

        {sortedIds.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <p>No achievements found in this category.</p>
            <p className="text-sm text-slate-500 mt-2">This may include only Daily/Weekly/Monthly achievements which are filtered out.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {sortedIds.map(id => {
              const ach = achievements[id];
              if (!ach) return null;
            const unlocks = unlocksMap[id] || [];
            return (
              <div key={id} id={`achievement-${id}`}>
                <AchievementCard 
                  achievement={ach} 
                  progress={userProgress[id]}
                  isStarred={starredAchievements.has(id)}
                  onToggleStar={handleToggleStar}
                  isLocked={isAchievementLocked(ach)}
                  unlocksCount={unlocks.length}
                  achievementsCache={achievements}
                  userProgress={userProgress}
                  onNeedAchievements={fetchSpecificAchievements}
                  accountAccess={accountAccess}
                  isAchievementLocked={isAchievementLocked}
                  onNavigateToAchievement={handleNavigateToAchievement}
                  achievementToCategoryMap={achievementToCategoryMap}
                />
              </div>
            );
          })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-screen bg-slate-950 text-slate-200 font-sans selection:bg-amber-500/30">
      <Sidebar 
        groups={groups}
        selectedGroup={selectedGroup}
        onSelectGroup={setSelectedGroup}
        categories={categories}
        selectedCategory={selectedCategory}
        onSelectCategory={handleSelectCategory}
        onGoHome={handleGoHome}
        onGoToMyPath={handleGoToMyPath}
        currentView={currentView}
        isLoadingGroups={loadingGroups}
        userProgress={userProgress}
        achievementsCache={achievements}
      />
      
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <UserSettings 
          apiKey={apiKey} 
          setApiKey={setApiKey} 
          onRefresh={syncUserProgress}
          isRefreshing={refreshingProgress}
          onClearApiKey={handleClearApiKey}
        />
        
        <main className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-slate-900">
          {renderContent()}
        </main>
      </div>

      {/* Playstyle Chart Modal */}
      {showPlaystyleChart && (
        <div 
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
          onClick={() => setShowPlaystyleChart(false)}
        >
          <div 
            className="bg-slate-800 rounded-lg border border-slate-700 shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-slate-800 border-b border-slate-700 p-4 flex items-center justify-between z-10">
              <h3 className="text-xl font-bold text-slate-100 flex items-center gap-2">
                <Compass className="text-amber-500" size={24} />
                Playstyle Breakdown
              </h3>
              <button
                onClick={() => setShowPlaystyleChart(false)}
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition-colors"
                title="Close"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6">
              <div className="mb-4 text-center">
                <p className="text-slate-400 text-sm">
                  Your playstyle is determined by the AP-weighted value of your completed achievements across different categories.
                </p>
              </div>
              <PlaystyleRadarChart scores={playstyleScores} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}