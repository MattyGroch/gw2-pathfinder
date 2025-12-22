import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
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
  X,
  Search,
  GripVertical
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

// Parse and render text with Guild Wars 2 style tags (e.g., <c=@Flavor>text</c>)
const renderStyledText = (text: string) => {
  if (!text) return text;
  
  // Pattern to match <c=@StyleName>text</c>
  const styleTagPattern = /<c=@(\w+)>(.*?)<\/c>/g;
  const parts: (string | React.ReactElement)[] = [];
  let lastIndex = 0;
  let match;
  let keyCounter = 0;
  
  while ((match = styleTagPattern.exec(text)) !== null) {
    // Add text before the style tag
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }
    
    // Apply styling based on style name
    const styleName = match[1];
    const styledText = match[2];
    
    if (styleName === 'Flavor') {
      // Add line break before Flavor tag (unless it's at the start)
      if (match.index > 0) {
        parts.push(<br key={`br-${keyCounter++}`} />);
      }
      parts.push(
        <span key={`style-${keyCounter++}`} className="italic">
          {styledText}
        </span>
      );
    } else {
      // For unknown styles, just render the text without the tag
      parts.push(styledText);
    }
    
    lastIndex = styleTagPattern.lastIndex;
  }
  
  // Add remaining text after the last style tag
  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }
  
  // If no style tags were found, return the original text
  if (parts.length === 0) {
    return text;
  }
  
  // Return a fragment containing all parts
  return <>{parts}</>;
};

// --- Components ---

// Item Tooltip Component
const ItemTooltip = ({ item, count, children }: { item?: Item; count?: number; children: React.ReactNode }) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0, transformY: '' });
  const tooltipRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  const calculateTooltipPosition = (rect: DOMRect, tooltipHeight: number = 300) => {
    const spacing = 8;
    
    // Try positioning below first
    const positionBelow = rect.bottom + spacing;
    const spaceBelow = window.innerHeight - rect.bottom;
    
    // If not enough space below, position above
    const positionAbove = rect.top - tooltipHeight - spacing;
    const spaceAbove = rect.top;
    
    let y: number;
    let transformY = '';
    
    if (spaceBelow >= tooltipHeight + spacing) {
      // Enough space below - position below
      y = positionBelow;
      transformY = '';
    } else if (spaceAbove >= tooltipHeight + spacing) {
      // Enough space above - position above
      y = rect.top;
      transformY = 'translateY(-100%)';
    } else {
      // Not enough space either way - position where there's more space
      if (spaceBelow > spaceAbove) {
        y = window.innerHeight - tooltipHeight - spacing;
        transformY = '';
      } else {
        y = spacing;
        transformY = '';
      }
    }
    
    // Also check horizontal bounds
    let x = rect.left + rect.width / 2;
    const tooltipWidth = 400; // max-w-[400px]
    const halfWidth = tooltipWidth / 2;
    
    if (x - halfWidth < 0) {
      x = halfWidth + spacing;
    } else if (x + halfWidth > window.innerWidth) {
      x = window.innerWidth - halfWidth - spacing;
    }
    
    return {
      x,
      y,
      transformY
    };
  };

  // Update position when tooltip is shown and we can measure it
  useEffect(() => {
    if (showTooltip && tooltipRef.current && triggerRef.current) {
      const tooltipHeight = tooltipRef.current.offsetHeight;
      const rect = triggerRef.current.getBoundingClientRect();
      const position = calculateTooltipPosition(rect, tooltipHeight);
      setTooltipPosition(position);
    }
  }, [showTooltip]);

  const handleMouseEnter = (e: React.MouseEvent) => {
    if (!item) return;
    setShowTooltip(true);
    // Initial position calculation (will be refined after tooltip renders)
    const rect = e.currentTarget.getBoundingClientRect();
    const position = calculateTooltipPosition(rect);
    setTooltipPosition(position);
  };

  const handleMouseLeave = () => {
    setShowTooltip(false);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!item || !showTooltip) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const tooltipHeight = tooltipRef.current?.offsetHeight || 300;
    const position = calculateTooltipPosition(rect, tooltipHeight);
    setTooltipPosition(position);
  };

  // Get rarity color
  const getRarityColor = (rarity?: string): string => {
    switch (rarity) {
      case 'Legendary': return 'text-orange-400';
      case 'Ascended': return 'text-fuchsia-400';
      case 'Exotic': return 'text-yellow-400';
      case 'Rare': return 'text-blue-400';
      case 'Masterwork': return 'text-green-400';
      case 'Fine': return 'text-blue-300';
      case 'Basic': return 'text-slate-300';
      default: return 'text-slate-300';
    }
  };

  // Format vendor value (copper to gold/silver/copper)
  const formatVendorValue = (copper?: number): string => {
    if (!copper) return '';
    const gold = Math.floor(copper / 10000);
    const silver = Math.floor((copper % 10000) / 100);
    const copperRem = copper % 100;
    const parts: string[] = [];
    if (gold > 0) parts.push(`${gold} gold`);
    if (silver > 0) parts.push(`${silver} silver`);
    if (copperRem > 0) parts.push(`${copperRem} copper`);
    return parts.join(' ') || '0 copper';
  };

  // Get gear attributes from details
  const getGearAttributes = (): Array<{ attribute: string; value: number }> => {
    if (!item?.details) return [];
    const result: Array<{ attribute: string; value: number }> = [];
    
    // Common GW2 attributes
    const attributeMap: Record<string, string> = {
      'Power': 'Power',
      'Precision': 'Precision',
      'Toughness': 'Toughness',
      'Vitality': 'Vitality',
      'ConditionDamage': 'Condition Damage',
      'ConditionDuration': 'Condition Duration',
      'HealingPower': 'Healing Power',
      'BoonDuration': 'Boon Duration',
      'CritDamage': 'Critical Damage',
      'CritChance': 'Critical Chance',
      'MagicFind': 'Magic Find',
      'AgonyResistance': 'Agony Resistance',
      'Ferocity': 'Ferocity',
      'Concentration': 'Concentration',
      'Expertise': 'Expertise'
    };

    // Helper to process attributes array
    const processAttributes = (attributes: any) => {
      if (Array.isArray(attributes)) {
        attributes.forEach((attr: any) => {
          if (attr.attribute && typeof attr.modifier === 'number') {
            const attrName = attributeMap[attr.attribute] || attr.attribute;
            result.push({ attribute: attrName, value: attr.modifier });
          }
        });
      } else if (typeof attributes === 'object' && attributes !== null) {
        Object.entries(attributes).forEach(([key, value]) => {
          if (typeof value === 'number') {
            const attrName = attributeMap[key] || key;
            result.push({ attribute: attrName, value });
          }
        });
      }
    };

    // Check infix_upgrade.attributes first (primary source for gear stats)
    if (item.details.infix_upgrade?.attributes) {
      processAttributes(item.details.infix_upgrade.attributes);
    }
    
    // Also check direct attributes (fallback)
    if (item.details.attributes) {
      processAttributes(item.details.attributes);
    }

    return result;
  };

  if (!item) {
    return <>{children}</>;
  }

  const gearAttributes = getGearAttributes();
  const isGear = item.type && ['Armor', 'Weapon', 'Trinket', 'Back', 'Accessory', 'Amulet', 'Ring'].includes(item.type);

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onMouseMove={handleMouseMove}
        className="relative"
      >
        {children}
      </div>
      {showTooltip && createPortal(
        <div
          ref={tooltipRef}
          className="fixed z-[99999] pointer-events-none"
          style={{
            left: `${tooltipPosition.x}px`,
            top: `${tooltipPosition.y}px`,
            transform: `translateX(-50%) ${tooltipPosition.transformY}`
          }}
        >
          <div className="bg-slate-900 border-2 border-slate-600 rounded-lg shadow-2xl min-w-[280px] max-w-[400px] p-3">
            {/* Item Header */}
            <div className="flex items-start gap-3 mb-3">
              {item.icon && (
                <img 
                  src={item.icon} 
                  alt={item.name} 
                  className="w-16 h-16 object-cover flex-shrink-0"
                />
              )}
              <div className="flex-1 min-w-0">
                <div className={`font-bold text-base ${getRarityColor(item.rarity)}`}>
                  {item.name}
                  {count && count > 1 && <span className="text-slate-300 ml-1">x{count}</span>}
                </div>
                {/* Gear Attributes - directly under name */}
                {isGear && gearAttributes.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {gearAttributes.map((attr, idx) => (
                      <div key={idx} className="text-sm text-left">
                        <span className="text-green-400 font-semibold">
                          {attr.value > 0 ? '+' : ''}{attr.value}
                          {/* Note: CritDamage is a flat value, not a percentage */}
                          {attr.attribute.includes('%') || attr.attribute === 'Magic Find' || attr.attribute === 'Critical Chance' ? '%' : ''}
                        </span>
                        <span className="text-green-400 ml-1">{attr.attribute}</span>
                      </div>
                    ))}
                  </div>
                )}
                {item.description && (
                  <div className="text-xs text-slate-400 mt-1 line-clamp-2">
                    {renderStyledText(item.description)}
                  </div>
                )}
              </div>
            </div>

            {/* Item Details */}
            <div className="pt-3 border-t border-slate-700 space-y-1 text-xs">
              {item.rarity && (
                <div className="flex justify-between">
                  <span className="text-slate-400">Rarity:</span>
                  <span className={getRarityColor(item.rarity)}>{item.rarity}</span>
                </div>
              )}
              {item.type && (
                <div className="flex justify-between">
                  <span className="text-slate-400">Type:</span>
                  <span className="text-slate-300">{item.type}</span>
                </div>
              )}
              {item.level !== undefined && item.level !== null && (
                <div className="flex justify-between">
                  <span className="text-slate-400">Required Level:</span>
                  <span className="text-slate-300">{item.level}</span>
                </div>
              )}
              {item.vendor_value !== undefined && item.vendor_value > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-400">Vendor Value:</span>
                  <span className="text-slate-300">{formatVendorValue(item.vendor_value)}</span>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

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
      <div className="min-h-16 p-4 border-b border-slate-700 flex items-center justify-center cursor-pointer hover:bg-slate-800 transition-colors" onClick={onGoHome}>
        <img 
          src="/logo.svg" 
          alt="GW2 Pathfinder" 
          className="h-12 w-auto max-w-full" 
          onError={(e) => {
            console.error('Logo failed to load from /logo.svg');
            // Fallback: show text if logo fails
            const target = e.target as HTMLImageElement;
            if (target && target.parentElement) {
              target.style.display = 'none';
              if (!target.parentElement.querySelector('.logo-fallback')) {
                const fallback = document.createElement('div');
                fallback.className = 'logo-fallback text-xl font-gw2-title text-amber-500';
                fallback.textContent = 'GW2 Pathfinder';
                target.parentElement.appendChild(fallback);
              }
            }
          }}
        />
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
  achievementToCategoryMap,
  starredAchievements,
  categories,
  unlocksMap,
  showBreadcrumbs,
  groups,
  advancedView,
  highlightedAchievementId
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
  starredAchievements?: number[];
  categories?: Record<string, AchievementCategory[]>;
  unlocksMap?: Record<number, number[]>;
  showBreadcrumbs?: boolean;
  groups?: AchievementGroup[];
  advancedView?: boolean;
  highlightedAchievementId?: number | null;
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
  
  // Get category icon as fallback
  const getCategoryIcon = (): string | null => {
    if (!achievementToCategoryMap || !categories) return null;
    const categoryId = achievementToCategoryMap[achievement.id];
    if (!categoryId) return null;
    
    // Search through all groups to find the category
    for (const groupId in categories) {
      const categoryList = categories[groupId];
      const category = categoryList.find(cat => cat.id === categoryId);
      if (category && category.icon) {
        return category.icon;
      }
    }
    return null;
  };
  
  const categoryIcon = getCategoryIcon();
  const displayIcon = achievement.icon || categoryIcon;
  
  // Reset icon error when achievement changes
  useEffect(() => {
    setIconError(false);
  }, [achievement.id, achievement.icon, categoryIcon]);
  
  // Calculate display Tier points
  const totalPoints = achievement.tiers.reduce((acc, t) => acc + t.points, 0);
  
  // Check if achievement has multiple tiers (tiered achievement)
  const isTiered = achievement.tiers.length > 1;
  
  // Calculate current tier progress and earned AP for tiered achievements
  const getTierProgress = useMemo(() => {
    if (!isTiered || !progress) {
      return null;
    }
    
    const currentCount = progress.current || 0;
    let earnedAP = 0;
    let currentTierIndex = -1;
    
    // Find which tier the user is currently on and calculate earned AP
    for (let i = 0; i < achievement.tiers.length; i++) {
      const tier = achievement.tiers[i];
      if (currentCount >= tier.count) {
        earnedAP += tier.points;
        currentTierIndex = i;
      }
    }
    
    // If not on any tier yet, they're working toward the first tier
    if (currentTierIndex === -1) {
      currentTierIndex = 0;
    }
    
    return {
      earnedAP,
      currentTierIndex,
      currentCount
    };
  }, [isTiered, progress, achievement.tiers]);

  // Wiki Link
  const wikiUrl = `https://wiki.guildwars2.com/wiki/${encodeURIComponent(achievement.name)}`;

  // Make card clickable in Dashboard and My Path views (when showBreadcrumbs is true)
  const isClickable = showBreadcrumbs && onNavigateToAchievement;
  const isHighlighted = highlightedAchievementId === achievement.id;

  return (
    <div 
      className={`relative bg-slate-800 rounded-lg p-4 border ${isDone ? 'border-green-900/50 bg-slate-800/80' : isLocked ? 'border-slate-800 bg-slate-900/50 opacity-60' : 'border-slate-700'} shadow-sm ${isLocked ? '' : 'hover:border-slate-600'} transition-all ${isClickable ? 'cursor-pointer' : ''} ${isHighlighted ? 'achievement-highlight' : ''}`}
      onClick={isClickable ? () => onNavigateToAchievement?.(achievement.id) : undefined}
    >
      <div className="flex gap-4">
        {/* Icon */}
        <div className="flex-shrink-0 relative">
          <div className={`w-12 h-12 rounded bg-slate-900 border border-slate-700 flex items-center justify-center overflow-hidden ${isDone ? 'ring-2 ring-green-500/50' : ''} ${isLocked ? 'opacity-50' : ''}`}>
            {displayIcon && !iconError ? (
              <img 
                src={displayIcon} 
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
              {/* Breadcrumbs */}
              {showBreadcrumbs && groups && achievementToCategoryMap && (() => {
                const categoryId = achievementToCategoryMap[achievement.id];
                if (!categoryId) return null;
                
                // Find the category and its group
                let groupName: string | null = null;
                let categoryName: string | null = null;
                
                for (const group of groups) {
                  const groupCategories = categories?.[group.id];
                  if (groupCategories) {
                    const category = groupCategories.find(cat => cat.id === categoryId);
                    if (category) {
                      groupName = group.name;
                      categoryName = category.name;
                      break;
                    }
                  }
                }
                
                if (groupName && categoryName) {
                  return (
                    <div className="flex items-center gap-1 text-xs text-slate-500 mb-1">
                      <span>{groupName}</span>
                      <ChevronRight size={12} />
                      <span>{categoryName}</span>
                    </div>
                  );
                }
                return null;
              })()}
              <h3 className={`font-gw2-subheader text-lg leading-tight ${isDone ? 'text-green-400' : isLocked ? 'text-slate-500' : 'text-slate-100'}`}>
                {achievement.name}
                {advancedView && (
                  <span className="ml-2 text-xs bg-slate-700/50 text-slate-400 px-1.5 py-0.5 rounded font-mono">
                    ID: {achievement.id}
                  </span>
                )}
                {isLocked && <span className="ml-2 text-xs bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded border border-slate-700 flex items-center gap-1 inline-flex"><Lock size={12} /> Locked</span>}
                {!isLocked && achievement.flags.includes('Repeatable') && <span className="ml-2 text-xs bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded">Repeatable</span>}
                {unlocksCount !== undefined && unlocksCount > 1 && (
                  <span className="ml-2 text-xs bg-green-900/30 text-green-300 px-1.5 py-0.5 rounded border border-green-800/50" title={`Unlocks ${unlocksCount} other achievements`}>
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
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleStar(achievement.id);
                    }}
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
                  {isTiered && getTierProgress ? `${getTierProgress.earnedAP}/${totalPoints}` : totalPoints} <span className="ml-1 text-xs">AP</span>
                </span>
              </div>
              <a 
                href={wikiUrl} 
                target="_blank" 
                rel="noreferrer" 
                className="text-slate-500 hover:text-sky-400 transition-colors"
                title="View on Wiki"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink size={16} />
              </a>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="mt-4">
            {isTiered && getTierProgress ? (
              // Tiered achievement display with tier pips
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>{isDone ? 'Completed' : (progress ? `${current} / ${max}` : 'Not started')}</span>
                  <span>{isDone ? '100%' : `${Math.floor(percent)}%`}</span>
                </div>
                <div className="relative h-4 w-full bg-slate-900 rounded-full overflow-visible">
                  {/* Progress fill */}
                  <div 
                    className={`h-full rounded-full transition-all duration-500 ${isDone ? 'bg-green-500' : 'bg-amber-600'}`}
                    style={{ width: `${isDone ? 100 : percent}%` }}
                  />
                  
                  {/* Tier pips/markers - vertical lines at each tier threshold */}
                  <div className="absolute inset-0">
                    {achievement.tiers.map((tier, tierIndex) => {
                      // Skip the final tier (100%) pip
                      if (tierIndex === achievement.tiers.length - 1) return null;
                      
                      const isTierCompleted = getTierProgress.currentCount >= tier.count;
                      const isCurrentTier = tierIndex === getTierProgress.currentTierIndex && !isTierCompleted;
                      const tierPosition = (tier.count / max) * 100;
                      // Check if this pip is within the filled portion of the progress bar
                      const isWithinProgress = tierPosition <= (isDone ? 100 : percent);
                      
                      return (
                        <div
                          key={tierIndex}
                          className="absolute top-0 bottom-0 flex flex-col items-center"
                          style={{ left: `${tierPosition}%`, transform: 'translateX(-50%)' }}
                          title={`Tier ${tierIndex + 1}: ${tier.count} objectives - ${tier.points} AP`}
                        >
                          {/* Vertical pip marker */}
                          <div
                            className={`w-0.5 h-full ${
                              isTierCompleted && isWithinProgress
                                ? 'bg-[#2a262b]' 
                                : isTierCompleted
                                  ? 'bg-green-300'
                                  : isCurrentTier 
                                    ? 'bg-amber-300' 
                                    : 'bg-slate-600'
                            }`}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
                
                {/* Tier AP labels below the bar */}
                <div className="relative h-4 w-full mt-1">
                  {achievement.tiers.map((tier, tierIndex) => {
                    // Hide AP label if AP value is 0
                    if (tier.points === 0) return null;
                    
                    const tierPosition = (tier.count / max) * 100;
                    const isTierCompleted = getTierProgress.currentCount >= tier.count;
                    const isCurrentTier = tierIndex === getTierProgress.currentTierIndex && !isTierCompleted;
                    
                    return (
                      <div
                        key={tierIndex}
                        className="absolute flex flex-col items-center"
                        style={{ left: `${tierPosition}%`, transform: 'translateX(-50%)' }}
                        title={`Tier ${tierIndex + 1}: ${tier.count} objectives`}
                      >
                        <span className={`text-[10px] font-medium whitespace-nowrap ${
                          isTierCompleted 
                            ? 'text-amber-500' 
                            : isCurrentTier 
                              ? 'text-amber-400' 
                              : 'text-slate-500'
                        }`}>
                          {tier.points}AP
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              // Non-tiered achievement display (original)
              <>
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
              </>
            )}
          </div>
          
          {/* Rewards / Tags */}
          <div className="mt-3 flex flex-wrap gap-2">
            {achievement.rewards?.map((reward, idx) => (
              <ItemTooltip key={idx} item={reward.type === 'Item' ? reward.item : undefined} count={reward.count}>
                <div className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-indigo-900/30 text-indigo-300 border border-indigo-800/50 cursor-help">
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
              </ItemTooltip>
            ))}
            {achievement.flags.includes('CategoryDisplay') && (() => {
              // Generate explanation for why this achievement is meta
              const metaReasons: string[] = [];
              const cache = achievementsCache || {};
              
              // Helper to check if an achievement grants a mount
              const grantsMount = (ach: Achievement): boolean => {
                if (!ach.rewards) return false;
                return ach.rewards.some(reward => {
                  if (reward.type === 'Item' && reward.item) {
                    const itemName = reward.item.name.toLowerCase();
                    return itemName.includes('mount') || 
                           itemName.includes('skyscale') || 
                           itemName.includes('griffon') || 
                           itemName.includes('roller beetle') || 
                           itemName.includes('jackal') || 
                           itemName.includes('raptor') ||
                           itemName.includes('warclaw') ||
                           itemName.includes('siege turtle') ||
                           itemName.includes('skiff');
                  }
                  return false;
                });
              };
              
              // Helper to get mount name from achievement
              const getMountName = (ach: Achievement): string | null => {
                if (!ach.rewards) return null;
                for (const reward of ach.rewards) {
                  if (reward.type === 'Item' && reward.item) {
                    const itemName = reward.item.name.toLowerCase();
                    if (itemName.includes('skyscale')) return 'Skyscale';
                    if (itemName.includes('griffon')) return 'Griffon';
                    if (itemName.includes('roller beetle')) return 'Roller Beetle';
                    if (itemName.includes('jackal')) return 'Jackal';
                    if (itemName.includes('raptor')) return 'Raptor';
                    if (itemName.includes('warclaw')) return 'Warclaw';
                    if (itemName.includes('siege turtle')) return 'Siege Turtle';
                    if (itemName.includes('skiff')) return 'Skiff';
                    if (itemName.includes('mount')) return 'Mount';
                  }
                }
                return null;
              };
              
              // Check if this achievement unlocks mount achievement chains
              if (unlocksMap && unlocksMap[achievement.id]) {
                const unlockedIds = unlocksMap[achievement.id];
                // Check if any unlocked achievement grants a mount
                for (const unlockedId of unlockedIds) {
                  const unlockedAch = cache[unlockedId];
                  if (unlockedAch && grantsMount(unlockedAch)) {
                    const mountName = getMountName(unlockedAch);
                    if (mountName) {
                      metaReasons.push(`${mountName} mount`);
                      break; // Only show first mount found
                    }
                  }
                }
              }
              
              // Check direct rewards
              if (achievement.rewards) {
                for (const reward of achievement.rewards) {
                  if (reward.type === 'Item' && reward.item) {
                    const itemName = reward.item.name.toLowerCase();
                    const itemType = reward.item.type?.toLowerCase() || '';
                    
                    // Check for inventory bags (exclude loot boxes/containers)
                    // Loot boxes typically have "box" in the name and are containers, not bags
                    const isLootBox = itemName.includes('box') || 
                                     itemName.includes('chest') || 
                                     itemName.includes('crate') ||
                                     (itemType === 'container' && !itemName.includes('bag'));
                    const isInventoryBag = itemType === 'bag' || 
                                          (itemName.includes('bag') && !isLootBox && !itemName.includes('box'));
                    
                    if (isInventoryBag) {
                      // Check item details for bag size
                      const bagSize = reward.item.details?.size;
                      if (bagSize === 20) {
                        metaReasons.push('Grants free 20-slot bag');
                      } else if (bagSize && bagSize >= 15) {
                        metaReasons.push(`Grants free ${bagSize}-slot bag`);
                      } else if (itemName.includes('20') || itemName.includes('twenty')) {
                        metaReasons.push('Grants free 20-slot bag');
                      } else if (bagSize && bagSize > 0) {
                        metaReasons.push(`Grants free ${bagSize}-slot bag`);
                      }
                      // Don't add generic "Grants bag" for bags without size info
                    }
                    // Check for mounts (direct reward)
                    else if (itemName.includes('mount') || 
                             itemName.includes('skyscale') || 
                             itemName.includes('griffon') || 
                             itemName.includes('roller beetle') || 
                             itemName.includes('jackal') || 
                             itemName.includes('raptor') ||
                             itemName.includes('warclaw') ||
                             itemName.includes('siege turtle') ||
                             itemName.includes('skiff')) {
                      // Determine mount name
                      let mountName = 'Mount';
                      if (itemName.includes('skyscale')) mountName = 'Skyscale';
                      else if (itemName.includes('griffon')) mountName = 'Griffon';
                      else if (itemName.includes('roller beetle')) mountName = 'Roller Beetle';
                      else if (itemName.includes('jackal')) mountName = 'Jackal';
                      else if (itemName.includes('raptor')) mountName = 'Raptor';
                      else if (itemName.includes('warclaw')) mountName = 'Warclaw';
                      else if (itemName.includes('siege turtle')) mountName = 'Siege Turtle';
                      else if (itemName.includes('skiff')) mountName = 'Skiff';
                      metaReasons.push(`Grants ${mountName} mount`);
                    }
                    // Check for legendary items
                    else if (reward.item.rarity === 'Legendary') {
                      metaReasons.push('Grants Legendary item');
                    }
                    // Check for legendary components
                    else if (itemName.includes('legendary') || itemName.includes('precursor') || 
                             itemName.includes('gift of') || itemName.includes('mystic clover')) {
                      metaReasons.push('Grants legendary component');
                    }
                  }
                }
              }
              
              // Only show meta tag if we have a specific reason
              if (metaReasons.length > 0) {
                const metaExplanation = metaReasons[0]; // Show first reason
                return (
                  <span 
                    className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-purple-900/30 text-purple-300 border border-purple-800/50"
                    title={metaExplanation}
                  >
                    Meta: {metaExplanation}
                  </span>
                );
              }
              
              // No specific reason found - don't show meta tag
              return null;
            })()}
          </div>

          {/* Achievement Chain */}
          {((achievement.prerequisites && achievement.prerequisites.length > 0) || (unlocksMap && unlocksMap[achievement.id] && unlocksMap[achievement.id].length > 0)) && (() => {
            // Quick calculation of chain length for button label
            const collectChainIds = (achId: number, visited: Set<number>): Set<number> => {
              if (visited.has(achId)) return new Set();
              visited.add(achId);
              
              const allIds = new Set<number>();
              allIds.add(achId);
              
              const ach = cache[achId];
              if (ach && ach.prerequisites) {
                ach.prerequisites.forEach(prereqId => {
                  const nested = collectChainIds(prereqId, visited);
                  nested.forEach(id => allIds.add(id));
                });
              }
              
              const unlocks = unlocksMap?.[achId] || [];
              unlocks.forEach(unlockId => {
                const nested = collectChainIds(unlockId, visited);
                nested.forEach(id => allIds.add(id));
              });
              
              return allIds;
            };
            
            const chainIds = collectChainIds(achievement.id, new Set());
            const chainLength = chainIds.size;
            
            // Calculate position in chain by building a simple topological order
            // This is a simplified version - the full calculation happens in the component
            const buildSimpleChain = (): number => {
              const allAchs = Array.from(chainIds).map(id => cache[id]).filter(Boolean) as Achievement[];
              if (allAchs.length === 0) return 1;
              
              // Simple topological sort
              const sorted: Achievement[] = [];
              const visited = new Set<number>();
              
              const visit = (ach: Achievement) => {
                if (visited.has(ach.id)) return;
                visited.add(ach.id);
                
                if (ach.prerequisites) {
                  ach.prerequisites.forEach(prereqId => {
                    if (chainIds.has(prereqId)) {
                      const prereq = cache[prereqId];
                      if (prereq) visit(prereq);
                    }
                  });
                }
                
                sorted.push(ach);
              };
              
              allAchs.forEach(ach => {
                if (!visited.has(ach.id)) visit(ach);
              });
              
              const position = sorted.findIndex(ach => ach.id === achievement.id) + 1;
              return position || 1;
            };
            
            const estimatedPosition = buildSimpleChain();
            
            return (
              <div className="mt-3 border-t border-slate-700 pt-3">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowPrerequisites(!showPrerequisites);
                    // Fetch chain data if needed
                    if (!showPrerequisites && onNeedAchievements) {
                      const missingIds = Array.from(chainIds).filter(id => !cache[id]);
                      if (missingIds.length > 0) {
                        onNeedAchievements(missingIds);
                      }
                    }
                  }}
                  className="w-full flex items-center justify-between text-sm text-slate-400 hover:text-slate-200 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <GitBranch size={16} />
                    <span>Achievement Chain ({estimatedPosition}/{chainLength})</span>
                  </div>
                  {showPrerequisites ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
                
                {showPrerequisites && (
                  <AchievementChain
                    achievement={achievement}
                    prerequisites={achievement.prerequisites || []}
                    unlocks={unlocksMap?.[achievement.id] || []}
                    achievementsCache={cache}
                    userProgress={progressMap}
                    accountAccess={account}
                    isAchievementLocked={checkLocked}
                    onNavigateToAchievement={onNavigateToAchievement}
                    achievementToCategoryMap={achievementToCategoryMap}
                    onNeedAchievements={onNeedAchievements}
                    unlocksMap={unlocksMap}
                  />
                )}
              </div>
            );
          })()}

        </div>
      </div>
    </div>
  );
};

// Achievement Chain Visualization Component
const AchievementChain = ({
  achievement,
  prerequisites,
  unlocks,
  achievementsCache,
  userProgress,
  accountAccess,
  isAchievementLocked,
  onNavigateToAchievement,
  achievementToCategoryMap,
  onNeedAchievements,
  unlocksMap
}: {
  achievement: Achievement;
  prerequisites: number[];
  unlocks: number[];
  achievementsCache: Record<number, Achievement>;
  userProgress: Record<number, UserProgress>;
  accountAccess: string[];
  isAchievementLocked?: (achievement: Achievement) => boolean;
  onNavigateToAchievement?: (achievementId: number) => void;
  achievementToCategoryMap?: Record<number, number>;
  onNeedAchievements?: (ids: number[]) => void;
  unlocksMap?: Record<number, number[]>;
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

  // Build complete chain: collect all prerequisites and unlocks recursively
  const collectAllPrerequisites = (achId: number, visited: Set<number>): Set<number> => {
    if (visited.has(achId)) return new Set();
    visited.add(achId);
    
    const ach = achievementsCache[achId];
    if (!ach || !ach.prerequisites || ach.prerequisites.length === 0) {
      return new Set();
    }
    
    const allIds = new Set<number>();
    for (const prereqId of ach.prerequisites) {
      if (!visited.has(prereqId)) {
        allIds.add(prereqId);
        const nested = collectAllPrerequisites(prereqId, visited);
        nested.forEach(id => allIds.add(id));
      }
    }
    return allIds;
  };

  const collectAllUnlocks = (achId: number, visited: Set<number>): Set<number> => {
    if (visited.has(achId)) return new Set();
    visited.add(achId);
    
    const unlockIds = unlocksMap?.[achId] || [];
    if (unlockIds.length === 0) {
      return new Set();
    }
    
    const allIds = new Set<number>();
    for (const unlockId of unlockIds) {
      if (!visited.has(unlockId)) {
        allIds.add(unlockId);
        const nested = collectAllUnlocks(unlockId, visited);
        nested.forEach(id => allIds.add(id));
      }
    }
    return allIds;
  };

  // Collect all achievements in the chain
  const allChainIds = new Set<number>();
  allChainIds.add(achievement.id); // Include current achievement
  
  // Add all prerequisites
  const visitedPrereqs = new Set<number>();
  prerequisites.forEach(id => {
    allChainIds.add(id);
    const nested = collectAllPrerequisites(id, visitedPrereqs);
    nested.forEach(id => allChainIds.add(id));
  });
  
  // Add all unlocks
  const visitedUnlocks = new Set<number>();
  unlocks.forEach(id => {
    allChainIds.add(id);
    const nested = collectAllUnlocks(id, visitedUnlocks);
    nested.forEach(id => allChainIds.add(id));
  });

  // Fetch missing achievements if needed
  const missingIds = Array.from(allChainIds).filter(id => !achievementsCache[id]);
  if (missingIds.length > 0 && onNeedAchievements) {
    onNeedAchievements(missingIds);
  }

  // Build a graph to topologically sort the chain
  const chainAchievements = Array.from(allChainIds)
    .map(id => achievementsCache[id])
    .filter((ach): ach is Achievement => ach !== undefined);

  if (chainAchievements.length === 0) {
    return (
      <div className="mt-2 text-xs text-slate-500 italic">
        Loading chain data...
      </div>
    );
  }

  // Topological sort: build dependency graph and sort
  const sortedChain: Achievement[] = [];
  const visited = new Set<number>();
  const inProgress = new Set<number>();
  
  const visit = (ach: Achievement) => {
    if (visited.has(ach.id)) return;
    if (inProgress.has(ach.id)) return; // Cycle detection
    
    inProgress.add(ach.id);
    
    // Visit prerequisites first
    if (ach.prerequisites) {
      for (const prereqId of ach.prerequisites) {
        if (allChainIds.has(prereqId)) {
          const prereq = achievementsCache[prereqId];
          if (prereq) visit(prereq);
        }
      }
    }
    
    inProgress.delete(ach.id);
    visited.add(ach.id);
    sortedChain.push(ach);
  };
  
  // Visit all achievements
  chainAchievements.forEach(ach => {
    if (!visited.has(ach.id)) {
      visit(ach);
    }
  });

  // Find position of current achievement in sorted chain
  const currentPosition = sortedChain.findIndex(ach => ach.id === achievement.id) + 1;
  const totalSteps = sortedChain.length;

  // Helper to check if an achievement is truly 100% completed (not just unlocked)
  const isFullyCompleted = (ach: Achievement, prog?: UserProgress): boolean => {
    if (!prog) return false;
    
    // Check if it's repeated (repeatable achievements)
    if (prog.repeated && prog.repeated > 0) return true;
    
    // Check if current >= max (for progress-based achievements)
    if (prog.current !== undefined && prog.max !== undefined) {
      return prog.current >= prog.max;
    }
    
    // Fallback to done flag (but this might indicate "unlocked" rather than "completed")
    // Only trust it if there's no progress tracking
    if (prog.done && prog.current === undefined && prog.max === undefined) {
      return true;
    }
    
    return false;
  };
  
  // Helper to check if an achievement has any progress (in progress, not just started)
  const hasProgress = (ach: Achievement, prog?: UserProgress): boolean => {
    if (!prog) return false;
    if (isFullyCompleted(ach, prog)) return false;
    
    // Check if there's meaningful progress
    if (prog.current !== undefined && prog.max !== undefined) {
      return prog.current > 0;
    }
    
    return false;
  };

  // Find the next required achievement (first uncompleted with all prerequisites met)
  const findNextAchievement = (): Achievement | null => {
    const currentIndex = sortedChain.findIndex(a => a.id === achievement.id);
    
    // Helper to check if all prerequisites are met for an achievement
    const allPrereqsMet = (ach: Achievement): boolean => {
      if (!ach.prerequisites || ach.prerequisites.length === 0) return true;
      
      return ach.prerequisites.every(prereqId => {
        const prereqProg = userProgress[prereqId];
        const prereqAch = achievementsCache[prereqId];
        return prereqAch && isFullyCompleted(prereqAch, prereqProg);
      });
    };
    
    // First, check achievements before the current one (uncompleted prerequisites)
    for (let i = 0; i < currentIndex; i++) {
      const ach = sortedChain[i];
      const prog = userProgress[ach.id];
      const completed = isFullyCompleted(ach, prog);
      
      if (!completed && allPrereqsMet(ach)) {
        return ach; // This is the next one (uncompleted prerequisite)
      }
    }
    
    // Then, check achievements after the current one
    for (let i = currentIndex + 1; i < sortedChain.length; i++) {
      const ach = sortedChain[i];
      const prog = userProgress[ach.id];
      const completed = isFullyCompleted(ach, prog);
      
      if (!completed && allPrereqsMet(ach)) {
        return ach; // This is the next one
      }
    }
    
    return null;
  };
  
  const nextAchievement = findNextAchievement();
  
  // Determine status for each achievement in chain
  const getAchievementStatus = (ach: Achievement): 'completed' | 'next' | 'in-progress' | 'future' | 'current' => {
    if (ach.id === achievement.id) return 'current';
    
    const prog = userProgress[ach.id];
    if (isFullyCompleted(ach, prog)) return 'completed';
    
    // Check if this is the next required achievement
    if (nextAchievement && nextAchievement.id === ach.id) {
      return 'next';
    }
    
    // Check if it's in progress
    if (hasProgress(ach, prog)) {
      return 'in-progress';
    }
    
    return 'future';
  };

  // Detect simultaneous unlocks (achievements unlocked at the same time, not in a chain)
  // Returns a map of achievement ID to its simultaneous unlock group
  const simultaneousUnlockGroups = new Map<number, Achievement[]>();
  
  sortedChain.forEach(ach => {
    const directUnlocks = unlocksMap?.[ach.id] || [];
    if (directUnlocks.length <= 1) return;
    
    // Check if all direct unlocks appear consecutively in the sorted chain right after this achievement
    const achIndex = sortedChain.findIndex(a => a.id === ach.id);
    if (achIndex === -1 || achIndex === sortedChain.length - 1) return;
    
    // Get the direct unlocks that are in the chain
    const chainUnlocks = directUnlocks
      .filter(id => allChainIds.has(id))
      .map(id => achievementsCache[id])
      .filter((a): a is Achievement => a !== undefined);
    
    if (chainUnlocks.length <= 1) return;
    
    // Check if they appear consecutively after this achievement
    const nextIndices = chainUnlocks.map(u => sortedChain.findIndex(a => a.id === u.id)).filter(i => i !== -1).sort((a, b) => a - b);
    
    // If all unlocks are consecutive starting right after this achievement, they're simultaneous
    if (nextIndices.length === chainUnlocks.length && 
        nextIndices[0] === achIndex + 1 && 
        nextIndices[nextIndices.length - 1] === achIndex + chainUnlocks.length) {
      // Verify none of them have prerequisites that are also in the chain (which would make it a chain, not simultaneous)
      const hasChainPrereqs = chainUnlocks.some(u => 
        u.prerequisites?.some(prereqId => allChainIds.has(prereqId) && prereqId !== ach.id)
      );
      
      if (!hasChainPrereqs) {
        // Mark all unlocks in this group
        chainUnlocks.forEach(unlock => {
          simultaneousUnlockGroups.set(unlock.id, chainUnlocks);
        });
      }
    }
  });
  
  // Helper to check if an achievement is part of a simultaneous unlock group
  const isInSimultaneousGroup = (achId: number): boolean => {
    return simultaneousUnlockGroups.has(achId);
  };
  
  // Helper to get the simultaneous unlock group for an achievement
  const getSimultaneousGroup = (achId: number): Achievement[] | null => {
    return simultaneousUnlockGroups.get(achId) || null;
  };

  return (
    <div className="mt-3 space-y-2">
      {/* Chain List */}
      <div className="space-y-1">
        {sortedChain.map((ach, index) => {
          const stepNumber = index + 1;
          const status = getAchievementStatus(ach);
          const isCurrent = ach.id === achievement.id;
          const prog = userProgress[ach.id];
          const isFullyDone = isFullyCompleted(ach, prog);
          const hasProg = hasProgress(ach, prog);
          const isSimultaneousUnlock = isInSimultaneousGroup(ach.id);
          const simultaneousGroup = getSimultaneousGroup(ach.id);
          const isFirstInGroup = simultaneousGroup && simultaneousGroup[0].id === ach.id;
          
          // Calculate progress percentage if available
          const current = prog?.current || 0;
          const max = prog?.max || ach.tiers[ach.tiers.length - 1]?.count || 1;
          const percent = max > 0 ? Math.min(100, Math.max(0, (current / max) * 100)) : 0;
          
          let bgColor = 'bg-slate-900/50';
          let borderColor = 'border-slate-700';
          let textColor = 'text-slate-200';
          let iconColor = 'text-slate-400';
          
          if (status === 'completed' || isFullyDone) {
            bgColor = 'bg-green-900/20';
            borderColor = 'border-green-800/50';
            textColor = 'text-green-300';
            iconColor = 'text-green-400';
          } else if (status === 'next') {
            bgColor = 'bg-amber-900/20';
            borderColor = 'border-amber-800/50';
            textColor = 'text-amber-300';
            iconColor = 'text-amber-400';
          } else if (status === 'in-progress') {
            bgColor = 'bg-amber-900/20';
            borderColor = 'border-amber-800/50';
            textColor = 'text-amber-300';
            iconColor = 'text-amber-400';
          } else if (status === 'future') {
            bgColor = 'bg-slate-900/50';
            borderColor = 'border-slate-800';
            textColor = 'text-slate-500';
            iconColor = 'text-slate-500';
          }
          
          return (
            <div key={ach.id}>
              {isFirstInGroup && (
                <div className="mb-1 ml-2 text-[10px] text-slate-500 italic">
                  Unlocks {simultaneousGroup!.length} achievements simultaneously:
                </div>
              )}
              <div
                className={`p-2 rounded border ${bgColor} ${borderColor} ${onNavigateToAchievement ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''} ${isCurrent ? 'ring-2 ring-amber-500/50' : ''} ${isSimultaneousUnlock ? 'ml-4' : ''}`}
                onClick={() => onNavigateToAchievement?.(ach.id)}
              >
                <div className="flex items-center gap-2">
                  {isSimultaneousUnlock ? (
                    <span className={`text-xs ${iconColor} min-w-[2rem] flex items-center justify-center`}>
                      •
                    </span>
                  ) : (
                    <span className={`text-xs font-mono ${iconColor} min-w-[2rem]`}>
                      {stepNumber}.
                    </span>
                  )}
                  {isFullyDone ? (
                    <CheckCircle2 size={14} className={`${iconColor} flex-shrink-0`} />
                  ) : status === 'future' ? (
                    <Lock size={12} className={`${iconColor} flex-shrink-0`} />
                  ) : (
                    <div className={`w-3 h-3 rounded-full ${status === 'next' || status === 'in-progress' ? 'bg-amber-500/50 border border-amber-400' : 'bg-slate-600 border border-slate-500'} flex-shrink-0`} />
                  )}
                  <span className={`text-xs ${textColor} ${isCurrent ? 'font-bold' : isFullyDone ? 'line-through' : ''}`}>
                    {ach.name}
                    {hasProg && !isFullyDone && (
                      <span className="ml-2 text-[10px] opacity-75">
                        ({Math.round(percent)}%)
                      </span>
                    )}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};



// Radar Chart Component for Playstyle Scores (aligned with recommendation flavors)
const PlaystyleRadarChart = ({ scores }: { scores: Record<string, number> }) => {
  const size = 300;
  const center = size / 2;
  const radius = 120;
  
  // Use flavor-based scores (Competitive, Endgame, Story, Collections, Meta)
  // Explorer is excluded as it represents balanced/fallback
  const flavorScores = {
    Competitive: scores.Competitive || 0,
    Endgame: scores.Endgame || 0,
    Story: scores.Story || 0,
    Collections: scores.Collections || 0,
    Meta: scores.Meta || 0
  };
  const maxScore = Math.max(...Object.values(flavorScores), 1);
  const normalizedScores = {
    Competitive: (flavorScores.Competitive / maxScore) * 100,
    Endgame: (flavorScores.Endgame / maxScore) * 100,
    Story: (flavorScores.Story / maxScore) * 100,
    Collections: (flavorScores.Collections / maxScore) * 100,
    Meta: (flavorScores.Meta / maxScore) * 100
  };
  
  // Order: Competitive (top), Endgame (top-right), Collections (bottom-right), Story (bottom-left), Meta (top-left)
  // 5 axes evenly spaced: 360° / 5 = 72° apart
  // Starting from top (-90° or -π/2), going clockwise
  const axes = [
    { name: 'Competitive', angle: -Math.PI / 2, icon: Sword }, // Top: -90°
    { name: 'Endgame', angle: -Math.PI / 2 + (2 * Math.PI / 5), icon: Trophy }, // Top-right: -90° + 72° = -18°
    { name: 'Collections', angle: -Math.PI / 2 + (4 * Math.PI / 5), icon: Star }, // Bottom-right: -90° + 144° = 54°
    { name: 'Story', angle: -Math.PI / 2 + (6 * Math.PI / 5), icon: Scroll }, // Bottom-left: -90° + 216° = 126°
    { name: 'Meta', angle: -Math.PI / 2 + (8 * Math.PI / 5), icon: Crown } // Top-left: -90° + 288° = 198°
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
        {axes.map((axis) => {
          const score = flavorScores[axis.name as keyof typeof flavorScores];
          const normalized = (score / maxScore) * 100;
          const Icon = axis.icon;
          return (
            <div key={axis.name} className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
              <div className="flex items-center gap-2 mb-1">
                <Icon size={16} className="text-amber-500" />
                <span className="text-xs font-semibold text-slate-300">{axis.name}</span>
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
  onClearApiKey,
  achievementsCache,
  userProgress,
  starredAchievements,
  onToggleStar,
  onNavigateToAchievement,
  achievementToCategoryMap,
  onNeedAchievements,
  advancedView,
  setAdvancedView,
  categories,
  groups
}: { 
  apiKey: string; 
  setApiKey: (key: string) => void; 
  onRefresh: () => void; 
  isRefreshing: boolean;
  onClearApiKey: () => void;
  achievementsCache?: Record<number, Achievement>;
  userProgress?: Record<number, UserProgress>;
  starredAchievements?: number[];
  onToggleStar?: (id: number) => void;
  onNavigateToAchievement?: (achievementId: number) => void;
  achievementToCategoryMap?: Record<number, number>;
  onNeedAchievements?: (ids: number[]) => void;
  advancedView?: boolean;
  setAdvancedView?: (value: boolean) => void;
  categories?: Record<string, AchievementCategory[]>;
  groups?: AchievementGroup[];
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [tempKey, setTempKey] = useState(apiKey);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<number[]>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [hasSearched, setHasSearched] = useState(false); // Track if search has been performed
  const [hasTyped, setHasTyped] = useState(false); // Track if user has typed in search (separate from hasSearched)
  const [isSearchFocused, setIsSearchFocused] = useState(false); // Track if search input is focused

  const handleSave = () => {
    setApiKey(tempKey);
    setIsOpen(false);
  };

  // Helper to get category icon for an achievement
  const getCategoryIcon = (achievementId: number): string | null => {
    if (!achievementToCategoryMap || !categories) return null;
    const categoryId = achievementToCategoryMap[achievementId];
    if (!categoryId) return null;
    
    // Search through all groups to find the category
    for (const groupId in categories) {
      const categoryList = categories[groupId];
      const category = categoryList.find(cat => cat.id === categoryId);
      if (category && category.icon) {
        return category.icon;
      }
    }
    return null;
  };

  // Search function
  const performSearch = useCallback((query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      setShowSearchResults(false);
      setHasSearched(false);
      setHasTyped(false);
      return;
    }
    
    // Mark that user has typed (even if cache isn't ready)
    if (query.trim()) {
      setHasTyped(true);
    }

    if (!achievementsCache || Object.keys(achievementsCache).length === 0) {
      setSearchResults([]);
      setShowSearchResults(false);
      // Don't set hasSearched to false here - keep it true if user has typed
      return;
    }

    setHasSearched(true); // Mark that we've actually performed a search with data

    const lowerQuery = query.toLowerCase().trim();
    const results: Array<{ id: number; score: number }> = [];

    Object.values(achievementsCache).forEach(achievement => {
      // Skip Daily/Weekly/Monthly achievements in search
      if (shouldFilterAchievement(achievement)) {
        return;
      }

      let score = 0;
      let matched = false;

      // Priority 1: Achievement name (exact match = highest score)
      const nameLower = achievement.name.toLowerCase();
      if (nameLower === lowerQuery) {
        score += 1000;
        matched = true;
      } else if (nameLower.startsWith(lowerQuery)) {
        score += 500;
        matched = true;
      } else if (nameLower.includes(lowerQuery)) {
        score += 100;
        matched = true;
      }

      // Priority 2: Description/requirement
      const descLower = (achievement.description || '').toLowerCase();
      const reqLower = (achievement.requirement || '').toLowerCase();
      if (descLower.includes(lowerQuery)) {
        score += 50;
        matched = true;
      }
      if (reqLower.includes(lowerQuery)) {
        score += 50;
        matched = true;
      }

      // Priority 3: Item rewards
      if (achievement.rewards) {
        achievement.rewards.forEach(reward => {
          if (reward.type === 'Item' && reward.item) {
            const itemNameLower = reward.item.name.toLowerCase();
            if (itemNameLower.includes(lowerQuery)) {
              score += 75;
              matched = true;
            }
            if (reward.item.type && reward.item.type.toLowerCase().includes(lowerQuery)) {
              score += 25;
              matched = true;
            }
          } else if (reward.type === 'Title' && reward.title) {
            const titleNameLower = reward.title.name.toLowerCase();
            if (titleNameLower.includes(lowerQuery)) {
              score += 60;
              matched = true;
            }
          } else if (reward.type === 'Mastery' && reward.region) {
            const regionLower = reward.region.toLowerCase();
            if (regionLower.includes(lowerQuery)) {
              score += 40;
              matched = true;
            }
          }
        });
      }

      if (matched) {
        results.push({ id: achievement.id, score });
      }
    });

    // Sort by score (highest first) and limit to top 10
    results.sort((a, b) => b.score - a.score);
    const topResults = results.slice(0, 10).map(r => r.id);
    
    setSearchResults(topResults);
    // Show results if:
    // 1. There are results AND
    // 2. (Input is focused OR user has typed something - meaning they want to see results)
    // This allows results to show when cache loads even if input lost focus
    setShowSearchResults(topResults.length > 0 && (isSearchFocused || hasTyped));

    // Fetch missing achievement data if needed
    if (onNeedAchievements && topResults.length > 0) {
      const missingIds = topResults.filter(id => !achievementsCache[id]);
      if (missingIds.length > 0) {
        onNeedAchievements(missingIds);
      }
    }
  }, [achievementsCache, onNeedAchievements, isSearchFocused, hasTyped]);

  // Debounce search
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      performSearch(searchQuery);
    }, 200);

    return () => clearTimeout(timeoutId);
  }, [searchQuery, performSearch]);

  // Re-run search when achievementsCache is populated (if there's a query)
  // This ensures search works even if cache wasn't ready when user typed
  useEffect(() => {
    if (searchQuery.trim() && achievementsCache && Object.keys(achievementsCache).length > 0 && hasTyped) {
      // Re-run search when cache becomes available (if user has typed something)
      const timeoutId = setTimeout(() => {
        performSearch(searchQuery);
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [achievementsCache, searchQuery, performSearch, hasTyped]);

  // Close search results when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.search-container')) {
        setShowSearchResults(false);
      }
    };

    if (showSearchResults) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showSearchResults]);

  return (
    <div className="bg-slate-800 border-b border-slate-700 p-4 flex justify-between items-center sticky top-0 z-10 shadow-md h-16">
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

      {/* Search Bar - Center */}
      <div className="flex-1 max-w-2xl mx-4 relative search-container">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              // Only show results if there's a query and we have results
              if (!e.target.value.trim()) {
                setShowSearchResults(false);
                setHasSearched(false);
                setHasTyped(false);
              } else {
                setHasTyped(true); // Mark that user has typed
              }
            }}
            onFocus={() => {
              setIsSearchFocused(true);
              // Show results on focus if we have a query and results exist
              // This allows results to show when user focuses the input
              if (searchQuery.trim() && searchResults.length > 0) {
                setShowSearchResults(true);
              }
            }}
            onBlur={() => {
              setIsSearchFocused(false);
              // Close results when input loses focus (with a small delay to allow clicks)
              setTimeout(() => {
                setShowSearchResults(false);
              }, 200);
            }}
            placeholder="Search achievements, items, titles..."
            className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500"
          />
        </div>

        {/* Search Results Dropdown */}
        {showSearchResults && searchResults.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-slate-800 border border-slate-700 rounded-lg shadow-xl max-h-96 overflow-y-auto z-50">
            <div className="p-2 space-y-1">
              {searchResults.map(achievementId => {
                const achievement = achievementsCache?.[achievementId];
                if (!achievement) return null;
                
                const progress = userProgress?.[achievementId];
                const isStarred = starredAchievements?.includes(achievementId) || false;
                const isDone = progress?.done || (progress?.repeated && progress.repeated > 0);

                return (
                  <div
                    key={achievementId}
                    onClick={() => {
                      if (onNavigateToAchievement) {
                        onNavigateToAchievement(achievementId);
                        setShowSearchResults(false);
                        setSearchQuery('');
                        setHasSearched(false);
                        setHasTyped(false);
                      }
                    }}
                    className="p-3 rounded-lg bg-slate-900/50 border border-slate-700 hover:bg-slate-700/50 cursor-pointer transition-colors flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {/* Icon */}
                      <div className={`w-10 h-10 rounded bg-slate-800 border border-slate-700 flex items-center justify-center overflow-hidden flex-shrink-0 ${isDone ? 'ring-2 ring-green-500/50' : ''}`}>
                        {(achievement.icon || getCategoryIcon(achievementId)) ? (
                          <img 
                            src={achievement.icon || getCategoryIcon(achievementId) || ''} 
                            alt={achievement.name} 
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <Trophy className="text-slate-600" size={20} />
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className={`text-sm font-semibold truncate ${isDone ? 'text-green-400' : 'text-slate-200'}`}>
                            {achievement.name}
                          </h4>
                          {isDone && (
                            <CheckCircle2 size={14} className="text-green-400 flex-shrink-0" />
                          )}
                        </div>
                        <p className="text-xs text-slate-400 line-clamp-1 mt-0.5">
                          {achievement.requirement || achievement.description}
                        </p>
                        {/* Show matching context */}
                        {achievement.rewards && achievement.rewards.some(r => 
                          (r.type === 'Item' && r.item?.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
                          (r.type === 'Title' && r.title?.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
                          (r.type === 'Mastery' && r.region?.toLowerCase().includes(searchQuery.toLowerCase()))
                        ) && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {achievement.rewards.map((reward, idx) => {
                              if (reward.type === 'Item' && reward.item?.name.toLowerCase().includes(searchQuery.toLowerCase())) {
                                return (
                                  <span key={idx} className="text-[10px] text-amber-400 bg-amber-900/20 px-1.5 py-0.5 rounded">
                                    {reward.item.name}
                                  </span>
                                );
                              }
                              if (reward.type === 'Title' && reward.title?.name.toLowerCase().includes(searchQuery.toLowerCase())) {
                                return (
                                  <span key={idx} className="text-[10px] text-purple-400 bg-purple-900/20 px-1.5 py-0.5 rounded">
                                    {reward.title.name}
                                  </span>
                                );
                              }
                              if (reward.type === 'Mastery' && reward.region?.toLowerCase().includes(searchQuery.toLowerCase())) {
                                return (
                                  <span key={idx} className="text-[10px] text-yellow-400 bg-yellow-900/20 px-1.5 py-0.5 rounded">
                                    {reward.region}
                                  </span>
                                );
                              }
                              return null;
                            })}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Star Button */}
                    {onToggleStar && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleStar(achievementId);
                        }}
                        className={`p-1.5 rounded transition-colors flex-shrink-0 ${
                          isStarred 
                            ? 'text-amber-400 hover:text-amber-300' 
                            : 'text-slate-500 hover:text-amber-400'
                        }`}
                        title={isStarred ? 'Unstar achievement' : 'Star achievement'}
                      >
                        <Star size={18} className={isStarred ? 'fill-current' : ''} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* No Results - Only show if we've actually performed a search */}
        {showSearchResults && searchQuery.trim() && hasSearched && searchResults.length === 0 && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-slate-800 border border-slate-700 rounded-lg shadow-xl p-4 z-50">
            <p className="text-sm text-slate-400 text-center">
              {achievementsCache && Object.keys(achievementsCache).length === 0 
                ? 'Loading achievements...' 
                : 'No results found'}
            </p>
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
          <h4 className="font-gw2-subheader text-slate-200 mb-2">API Settings</h4>
          <p className="text-xs text-slate-400 mb-2">
            Enter your Guild Wars 2 API Key with <code>account</code> and <code>progression</code> scopes.
          </p>
          <p className="text-xs text-slate-400 mb-4">
            Don't have an API key?{' '}
            <a 
              href="https://account.arena.net/applications/create" 
              target="_blank" 
              rel="noreferrer"
              className="text-amber-400 hover:text-amber-300 underline"
            >
              Create one here
            </a>
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

          {/* Advanced View Toggle */}
          {setAdvancedView !== undefined && (
            <div className="mb-4 pb-4 border-b border-slate-700">
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <div className="text-sm font-medium text-slate-200 mb-1">Advanced View</div>
                  <div className="text-xs text-slate-400">Show achievement IDs on cards</div>
                </div>
                <button
                  onClick={() => {
                    const newValue = !advancedView;
                    setAdvancedView(newValue);
                    try {
                      localStorage.setItem('gw2_advanced_view', newValue.toString());
                    } catch (e) {
                      console.warn("Failed to save advanced view preference", e);
                    }
                  }}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    advancedView ? 'bg-amber-600' : 'bg-slate-700'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      advancedView ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </label>
            </div>
          )}

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
  achievementToCategoryMap,
  categories,
  groups,
  advancedView,
  highlightedAchievementId,
  onReorderAchievements
}: {
  starredAchievements: number[];
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
  categories?: Record<string, AchievementCategory[]>;
  groups?: AchievementGroup[];
  advancedView?: boolean;
  highlightedAchievementId?: number | null;
  onReorderAchievements?: (newOrder: number[]) => void;
}) => {
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);

  // Fetch missing achievements
  useEffect(() => {
    const missingIds = starredAchievements.filter(id => !achievementsCache[id]);
    if (missingIds.length > 0) {
      onNeedAchievements(missingIds);
    }
  }, [starredAchievements, achievementsCache, onNeedAchievements]);

  const achievements = starredAchievements
    .reduce<Array<{ achievement: Achievement; progress?: UserProgress }>>((acc, id) => {
      const ach = achievementsCache[id];
      if (ach) {
        acc.push({ achievement: ach, progress: userProgress[id] });
      }
      return acc;
    }, []);

  const handleDragStart = (e: React.DragEvent, achievementId: number) => {
    setDraggedId(achievementId);
    e.dataTransfer.effectAllowed = 'move';
    // Add a slight opacity to the dragged element
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '0.5';
    }
  };

  const handleDragEnd = (e: React.DragEvent) => {
    setDraggedId(null);
    setDragOverId(null);
    // Reset opacity
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '1';
    }
  };

  const handleDragOver = (e: React.DragEvent, achievementId: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedId !== null && draggedId !== achievementId) {
      setDragOverId(achievementId);
    }
  };

  const handleDragLeave = () => {
    setDragOverId(null);
  };

  const handleDrop = (e: React.DragEvent, dropTargetId: number) => {
    e.preventDefault();
    setDragOverId(null);

    if (draggedId === null || draggedId === dropTargetId || !onReorderAchievements) {
      return;
    }

    const currentOrder = [...starredAchievements];
    const draggedIndex = currentOrder.indexOf(draggedId);
    const dropIndex = currentOrder.indexOf(dropTargetId);

    if (draggedIndex === -1 || dropIndex === -1) {
      return;
    }

    // Remove dragged item from its current position
    currentOrder.splice(draggedIndex, 1);
    // Insert it at the new position
    currentOrder.splice(dropIndex, 0, draggedId);

    onReorderAchievements(currentOrder);
    setDraggedId(null);
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-3xl font-gw2-header text-slate-100 flex items-center gap-3">
            <Route className="text-amber-500" size={32} />
            My Path
          </h2>
          {starredAchievements.length > 0 && (
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
        <p className="text-slate-400">Your starred achievements - your personal journey. Drag and drop to reorder.</p>
      </div>

      {achievements.length > 0 ? (
        <div className="space-y-4 pl-10">
          {achievements.map((item, index) => {
            const unlocks = unlocksMap[item.achievement.id] || [];
            const isDragging = draggedId === item.achievement.id;
            const isDragOver = dragOverId === item.achievement.id;
            
            return (
              <div
                key={item.achievement.id}
                draggable
                onDragStart={(e) => handleDragStart(e, item.achievement.id)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleDragOver(e, item.achievement.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, item.achievement.id)}
                className={`relative transition-all group ${
                  isDragging ? 'opacity-50 cursor-grabbing' : 'cursor-grab'
                } ${
                  isDragOver && draggedId !== item.achievement.id ? 'translate-y-2' : ''
                }`}
              >
                {/* Drop Indicator */}
                {isDragOver && draggedId !== item.achievement.id && (
                  <div className="absolute -top-2 left-0 right-0 h-0.5 bg-amber-500 rounded-full z-10" />
                )}
                
                <div className="relative">
                  {/* Drag Handle - visible on hover, centered vertically, positioned to the left */}
                  <div className="absolute -left-8 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center text-slate-600 group-hover:text-slate-400 transition-colors pointer-events-none">
                    <GripVertical size={24} />
                  </div>
                  
                  <AchievementCard
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
                    starredAchievements={starredAchievements}
                    categories={categories}
                    unlocksMap={unlocksMap}
                    showBreadcrumbs={true}
                    groups={groups}
                    advancedView={advancedView}
                    highlightedAchievementId={highlightedAchievementId}
                  />
                </div>
              </div>
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
  onShowPlaystyleChart,
  apiKey,
  advancedView,
  highlightedAchievementId
}: { 
  userProgress: Record<number, UserProgress>;
  achievementsCache: Record<number, Achievement>;
  onNeedAchievements: (ids: number[]) => void;
  playstyle: string;
  playstyleScores: Record<string, number>;
  achievementToCategoryMap: Record<number, number>;
  groups: AchievementGroup[];
  onToggleStar: (id: number) => void;
  starredAchievements: number[];
  accountAccess: string[];
  categories: Record<string, AchievementCategory[]>;
  unlocksMap: Record<number, number[]>;
  accountName?: string;
  onNavigateToAchievement?: (achievementId: number) => void;
  onShowPlaystyleChart?: () => void;
  apiKey: string;
  advancedView?: boolean;
  highlightedAchievementId?: number | null;
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
    
    // Removed AP value reasons - with tiered achievements, total AP is misleading
    // since players may have already earned most AP from earlier tiers

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
        <h2 className="text-3xl font-gw2-header text-slate-100 mb-2">Welcome, {accountName ? accountName.replace(/\.\d+$/, '') : 'Pathfinder'}</h2>
        <p className="text-slate-400">Track your Guild Wars 2 journey and find your next adventure.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-slate-800 p-4 rounded-lg border border-slate-700 flex items-center gap-4">
          <div className="p-3 bg-green-900/30 text-green-400 rounded-full">
            <CheckCircle2 size={24} />
          </div>
          <div>
            <div className="text-2xl font-gw2-header text-slate-100">{totalCompleted}</div>
            <div className="text-xs text-slate-400 uppercase font-semibold">Completed Achievements</div>
          </div>
        </div>
        <div className="bg-slate-800 p-4 rounded-lg border border-slate-700 flex items-center gap-4">
          <div className="p-3 bg-amber-900/30 text-amber-400 rounded-full">
            <Trophy size={24} />
          </div>
          <div>
            <div className="text-2xl font-gw2-header text-slate-100">{progressList.length}</div>
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
            <div className="text-2xl font-gw2-header text-slate-100">{playstyle}</div>
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
          <h3 className="text-xl font-gw2-subheader text-slate-200 mb-4 flex items-center gap-2">
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
                <span className="text-sm font-gw2-subheader">Quick Wins</span>
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
                <span className="text-sm font-gw2-subheader">Legendary Gear</span>
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
                <span className="text-sm font-gw2-subheader">Fashion</span>
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
                <span className="text-sm font-gw2-subheader">Seasonal</span>
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
                <span className="text-sm font-gw2-subheader">Mastery</span>
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
                <span className="text-sm font-gw2-subheader">Meta</span>
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
                <span className="text-sm font-gw2-subheader">Story</span>
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
                <span className="text-sm font-gw2-subheader">Endgame</span>
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
                <span className="text-sm font-gw2-subheader">Competitive</span>
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
                <span className="text-sm font-gw2-subheader">Wild Card</span>
                <span className="text-xs text-slate-400 text-center">Smart recommendations</span>
              </div>
            </button>
          </div>
        </section>

        <section>
          <h3 className="text-xl font-gw2-subheader text-slate-200 mb-4 flex items-center gap-2">
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
                        isStarred={starredAchievements.includes(p.id)}
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
                        starredAchievements={starredAchievements}
                        categories={categories}
                        unlocksMap={unlocksMap}
                        showBreadcrumbs={true}
                        groups={groups}
                        advancedView={advancedView}
                        highlightedAchievementId={highlightedAchievementId}
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
                    {!apiKey ? 'An API key is required to get recommendations!' : 'No recommendations found for this goal.'}
                  </p>
                  {apiKey && (
                    <p className="text-sm text-slate-500 italic">
                      (Tip: Try a different goal or explore categories on the left!)
                    </p>
                  )}
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
  const [advancedView, setAdvancedView] = useState<boolean>(() => {
    // Load advanced view preference from localStorage
    try {
      return localStorage.getItem('gw2_advanced_view') === 'true';
    } catch (e) {
      return false;
    }
  });
  
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [currentCategoryDetails, setCurrentCategoryDetails] = useState<AchievementCategory | null>(null);
  const [currentView, setCurrentView] = useState<'dashboard' | 'mypath' | 'category'>('dashboard');
  const [highlightedAchievementId, setHighlightedAchievementId] = useState<number | null>(null);
  
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
  
  // Starred Achievements (ordered array for drag-and-drop reordering)
  const [starredAchievements, setStarredAchievements] = useState<number[]>(() => {
    try {
      const stored = localStorage.getItem('gw2_starred_achievements');
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      console.warn("Failed to load starred achievements", e);
    }
    return [];
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

  // 6. Calculate Playstyle (Improved with AP weighting and flavor-based categorization)
  useEffect(() => {
      if (Object.keys(userProgress).length === 0 || Object.keys(achievementToCategoryMap).length === 0 || groups.length === 0) return;

      const scores = {
          Competitive: 0,
          Endgame: 0,
          Story: 0,
          Collections: 0,
          Meta: 0,
          Explorer: 0 // Fallback for balanced/unmatched achievements
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

          // Categorize based on Group Name and Achievement Type (aligned with recommendation flavors)
          let categorized = false;

          // Competitive: PvP, WvW
          if (['Competitive', 'WvW', 'PvP', 'World vs. World'].some(s => groupName.includes(s))) {
              scores.Competitive += weightedScore;
              categorized = true;
          } 
          // Endgame: Raids, Strikes, Fractals
          else if (['Fractals', 'Raids', 'Strike Missions', 'Strikes'].some(s => groupName.includes(s))) {
              scores.Endgame += weightedScore;
              categorized = true;
          } 
          // Story: Story and Living World
          else if (['Story', 'Side Stories', 'Living World', 'Heart of Thorns', 'Path of Fire', 'End of Dragons', 'Secrets of the Obscure', 'Janthir Wilds', 'Visions of Eternity'].some(s => groupName.includes(s))) {
              scores.Story += weightedScore;
              categorized = true;
          } 
          // Collections: Legendary, Fashion, Seasonal, or ItemSet type achievements
          else if (['Collections', 'Legendary', 'Fashion'].some(s => groupName.includes(s)) || 
                   achievement.type === 'ItemSet' ||
                   (achievement.name.toLowerCase().includes('collection') || 
                    achievement.name.toLowerCase().includes('legendary') ||
                    achievement.name.toLowerCase().includes('skin') ||
                    achievement.name.toLowerCase().includes('wardrobe') ||
                    achievement.name.toLowerCase().includes('festival') ||
                    achievement.name.toLowerCase().includes('halloween') ||
                    achievement.name.toLowerCase().includes('wintersday'))) {
              scores.Collections += weightedScore;
              categorized = true;
          }
          // Meta: High-value achievements (CategoryDisplay flag)
          else if (achievement.flags.includes('CategoryDisplay')) {
              scores.Meta += weightedScore;
              categorized = true;
          }
          // Explorer: Open world, exploration, general PvE (not story-specific), mastery
          else if (['General', 'Exploration', 'Open World', 'World Boss', 'Jumping Puzzle', 'Adventure', 'Mastery'].some(s => groupName.includes(s)) ||
                   (groupName.includes('Tyria') || groupName.includes('Maguuma') || groupName.includes('Desert'))) {
              scores.Explorer += weightedScore;
              categorized = true;
          }
          
          // If still not categorized, give small weight to Explorer (but less than explicit matches)
          if (!categorized) {
              scores.Explorer += weightedScore * 0.5;
          }
      });

      // Find winner with tie-breaking (map flavor scores to playstyle names for display)
      let winner = 'Explorer';
      const scoreEntries = Object.entries(scores).filter(([name]) => name !== 'Explorer');
      
      // Sort by score to handle ties (prefer more specific playstyles over Explorer)
      const sortedScores = scoreEntries.sort((a, b) => {
          if (b[1] !== a[1]) return b[1] - a[1]; // Sort by score first
          // Tie-breaking: prefer more specific flavors
          const priority: Record<string, number> = {
              'Meta': 5,
              'Competitive': 4,
              'Endgame': 3,
              'Story': 2,
              'Collections': 1,
              'Explorer': 0
          };
          return (priority[b[0]] || 0) - (priority[a[0]] || 0);
      });
      
      // Map flavor to playstyle display name
      const flavorToPlaystyle: Record<string, string> = {
          'Competitive': 'Battlemaster',
          'Endgame': 'Commander',
          'Story': 'Historian',
          'Collections': 'Collector',
          'Meta': 'Collector', // Meta achievements often relate to collections
          'Explorer': 'Explorer'
      };
      
      // Only assign a playstyle if there's a clear winner (at least 20% more than second place)
      // or if Explorer is the clear winner
      if (sortedScores.length >= 2) {
          const [topFlavor, topScore] = sortedScores[0];
          const [, secondScore] = sortedScores[1];
          
          // If top score is significantly higher, use it
          if (topScore > secondScore * 1.2 && topScore > 0) {
              winner = flavorToPlaystyle[topFlavor] || 'Explorer';
          } else {
              // Very close scores = balanced player = Explorer
              winner = 'Explorer';
          }
      } else if (sortedScores.length > 0 && sortedScores[0][1] > 0) {
          winner = flavorToPlaystyle[sortedScores[0][0]] || 'Explorer';
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
    setStarredAchievements([]);
    localStorage.removeItem('gw2_starred_achievements');
  }, []);

  const handleReorderAchievements = useCallback((newOrder: number[]) => {
    setStarredAchievements(newOrder);
    try {
      localStorage.setItem('gw2_starred_achievements', JSON.stringify(newOrder));
    } catch (e) {
      console.warn("Failed to save reordered achievements", e);
    }
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
      const newArray = [...prev];
      const index = newArray.indexOf(id);
      
      if (index !== -1) {
        // Unstarring - remove it
        newArray.splice(index, 1);
      } else {
        // Starring - add the achievement and its uncompleted prerequisites in order
        const achievement = achievements[id];
        
        // Add uncompleted prerequisites first
        if (achievement && achievement.prerequisites && achievement.prerequisites.length > 0) {
          // Get prerequisites in topological order (dependencies first)
          const prerequisitesInOrder = getPrerequisitesInOrder(id, achievements, userProgress);
          
          // Filter to only uncompleted prerequisites and add them (avoiding duplicates)
          prerequisitesInOrder.forEach(prereqId => {
            const prereqProg = userProgress[prereqId];
            const isCompleted = prereqProg && (prereqProg.done || (prereqProg.repeated && prereqProg.repeated > 0));
            if (!isCompleted && achievements[prereqId] && !newArray.includes(prereqId)) {
              newArray.push(prereqId);
            }
          });
        }
        
        // Add the achievement itself at the end
        newArray.push(id);
      }
      
      // Persist to localStorage
      try {
        localStorage.setItem('gw2_starred_achievements', JSON.stringify(newArray));
      } catch (e) {
        console.warn("Failed to save starred achievements", e);
      }
      return newArray;
    });
  }, [achievements, userProgress, getPrerequisitesInOrder, achievementToCategoryMap, categories]);

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

  // Navigate to an achievement by finding its category and group
  const handleNavigateToAchievement = useCallback((achievementId: number) => {
    const categoryId = achievementToCategoryMap[achievementId];
    if (categoryId) {
      // Find which group contains this category
      let groupId: string | null = null;
      for (const group of groups) {
        if (group.categories.includes(categoryId)) {
          groupId = group.id;
          break;
        }
      }
      
      // Set the selected group and category to update the sidebar
      if (groupId) {
        setSelectedGroup(groupId);
      }
      setSelectedCategory(categoryId);
      setCurrentView('category');
      
      // Scroll to the achievement after a short delay to allow rendering
      setTimeout(() => {
        const element = document.getElementById(`achievement-${achievementId}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Trigger fade-blink animation after scroll completes
          // Wait a bit longer to ensure scroll is done
          setTimeout(() => {
            setHighlightedAchievementId(achievementId);
            // Clear after animation completes (2 blinks = ~1.2s)
            setTimeout(() => {
              setHighlightedAchievementId(null);
            }, 1200);
          }, 300);
        }
      }, 100);
    }
  }, [achievementToCategoryMap, groups]);

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
          categories={categories}
          groups={groups}
          advancedView={advancedView}
          highlightedAchievementId={highlightedAchievementId}
          onReorderAchievements={handleReorderAchievements}
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
          apiKey={apiKey}
          advancedView={advancedView}
          highlightedAchievementId={highlightedAchievementId}
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
          apiKey={apiKey}
          advancedView={advancedView}
          highlightedAchievementId={highlightedAchievementId}
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
                 <h2 className="text-2xl font-gw2-header text-slate-100">{currentCategoryDetails.name}</h2>
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
                  isStarred={starredAchievements.includes(id)}
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
                  starredAchievements={starredAchievements}
                  categories={categories}
                  unlocksMap={unlocksMap}
                  advancedView={advancedView}
                  highlightedAchievementId={highlightedAchievementId}
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
          achievementsCache={achievements}
          userProgress={userProgress}
          starredAchievements={starredAchievements}
          onToggleStar={handleToggleStar}
          onNavigateToAchievement={handleNavigateToAchievement}
          achievementToCategoryMap={achievementToCategoryMap}
          onNeedAchievements={fetchSpecificAchievements}
          advancedView={advancedView}
          setAdvancedView={setAdvancedView}
          categories={categories}
          groups={groups}
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
              <h3 className="text-xl font-gw2-header text-slate-100 flex items-center gap-2">
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