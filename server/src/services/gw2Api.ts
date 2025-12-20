const GW2_API_BASE = 'https://api.guildwars2.com/v2';

export interface AchievementGroup {
  id: string;
  name: string;
  description: string;
  order: number;
  categories: number[];
}

export interface AchievementCategory {
  id: number;
  name: string;
  description: string;
  order: number;
  icon: string;
  achievements: number[];
}

export interface AchievementTier {
  count: number;
  points: number;
}

export interface AchievementReward {
  type: string;
  id?: number;
  count?: number;
  region?: string;
  title?: string;
}

export interface Item {
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

export interface Title {
  id: number;
  name: string;
}

export interface Achievement {
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
  prerequisites?: number[];
}

async function fetchWithBackoff(url: string, retries = 3, delay = 1000): Promise<any> {
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
}

export async function fetchAllGroups(): Promise<AchievementGroup[]> {
  const groupIds = await fetchWithBackoff(`${GW2_API_BASE}/achievements/groups`);
  const groups = await Promise.all(
    groupIds.map((id: string) => fetchWithBackoff(`${GW2_API_BASE}/achievements/groups/${id}`))
  );
  return groups;
}

export async function fetchCategories(ids: number[]): Promise<AchievementCategory[]> {
  if (ids.length === 0) return [];
  
  const chunks = [];
  for (let i = 0; i < ids.length; i += 200) {
    chunks.push(ids.slice(i, i + 200));
  }
  
  const results = await Promise.all(
    chunks.map(chunk => fetchWithBackoff(`${GW2_API_BASE}/achievements/categories?ids=${chunk.join(',')}`))
  );
  
  return results.flat();
}

export async function fetchAchievements(ids: number[]): Promise<Achievement[]> {
  if (ids.length === 0) return [];
  
  const chunks = [];
  for (let i = 0; i < ids.length; i += 200) {
    chunks.push(ids.slice(i, i + 200));
  }
  
  const results = await Promise.all(
    chunks.map(chunk => fetchWithBackoff(`${GW2_API_BASE}/achievements?ids=${chunk.join(',')}`))
  );
  
  return results.flat();
}

export async function fetchItems(ids: number[]): Promise<Item[]> {
  if (ids.length === 0) return [];
  
  // GW2 API supports up to 200 IDs per request
  const chunks = [];
  for (let i = 0; i < ids.length; i += 200) {
    chunks.push(ids.slice(i, i + 200));
  }
  
  const results = await Promise.all(
    chunks.map(chunk => fetchWithBackoff(`${GW2_API_BASE}/items?ids=${chunk.join(',')}`))
  );
  
  return results.flat();
}

export async function fetchTitles(ids: number[]): Promise<Title[]> {
  if (ids.length === 0) return [];
  
  // GW2 API supports up to 200 IDs per request
  const chunks = [];
  for (let i = 0; i < ids.length; i += 200) {
    chunks.push(ids.slice(i, i + 200));
  }
  
  const results = await Promise.all(
    chunks.map(chunk => fetchWithBackoff(`${GW2_API_BASE}/titles?ids=${chunk.join(',')}`))
  );
  
  return results.flat();
}

