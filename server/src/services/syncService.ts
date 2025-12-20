import { pool } from '../db/connection.js';
import {
  fetchAllGroups,
  fetchCategories,
  fetchAchievements,
  fetchItems,
  fetchTitles,
  AchievementGroup,
  AchievementCategory,
  Achievement,
  Item,
  Title,
} from './gw2Api.js';

export async function syncAllData(): Promise<void> {
  console.log('Starting data synchronization...');
  const startTime = Date.now();

  try {
    // 1. Sync Groups (without category relationships)
    console.log('Fetching achievement groups...');
    const groups = await fetchAllGroups();
    await syncGroups(groups, false); // Don't sync relationships yet
    console.log(`Synced ${groups.length} groups`);

    // 2. Collect all category IDs
    const allCategoryIds = groups.flatMap(g => g.categories);
    const uniqueCategoryIds = Array.from(new Set(allCategoryIds));

    // 3. Sync Categories (without achievement relationships)
    console.log('Fetching achievement categories...');
    const categories = await fetchCategories(uniqueCategoryIds);
    await syncCategories(categories, groups, false); // Don't sync relationships yet
    console.log(`Synced ${categories.length} categories`);

    // 4. Now sync group-category relationships (after categories exist)
    console.log('Syncing group-category relationships...');
    await syncGroupCategoryRelationships(groups);
    console.log('Group-category relationships synced');

    // 5. Collect all achievement IDs
    const allAchievementIds = categories.flatMap(c => c.achievements);
    const uniqueAchievementIds = Array.from(new Set(allAchievementIds));

    // 6. Sync Achievements
    console.log('Fetching achievements...');
    const achievements = await fetchAchievements(uniqueAchievementIds);
    await syncAchievements(achievements, categories);
    console.log(`Synced ${achievements.length} achievements`);

    // 7. Now sync category-achievement relationships (after achievements exist)
    console.log('Syncing category-achievement relationships...');
    await syncCategoryAchievementRelationships(categories);
    console.log('Category-achievement relationships synced');

    // 8. Extract item IDs from achievement rewards and sync items
    console.log('Extracting item IDs from achievement rewards...');
    const itemIds = extractItemIdsFromAchievements(achievements);
    if (itemIds.length > 0) {
      console.log(`Found ${itemIds.length} unique item IDs in achievement rewards`);
      console.log('Fetching item data...');
      const items = await fetchItems(itemIds);
      await syncItems(items);
      console.log(`Synced ${items.length} items`);
    } else {
      console.log('No items found in achievement rewards');
    }

    // 9. Extract title IDs from achievement rewards and sync titles
    console.log('Extracting title IDs from achievement rewards...');
    const titleIds = extractTitleIdsFromAchievements(achievements);
    if (titleIds.length > 0) {
      console.log(`Found ${titleIds.length} unique title IDs in achievement rewards`);
      console.log('Fetching title data...');
      const titles = await fetchTitles(titleIds);
      await syncTitles(titles);
      console.log(`Synced ${titles.length} titles`);
    } else {
      console.log('No titles found in achievement rewards');
    }

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    console.log(`Data synchronization completed in ${duration}s`);
  } catch (error) {
    console.error('Sync failed:', error);
    throw error;
  }
}

async function syncGroups(groups: AchievementGroup[], syncRelationships: boolean = true): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const group of groups) {
      await client.query(
        `INSERT INTO achievement_groups (id, name, description, "order")
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           "order" = EXCLUDED."order",
           updated_at = CURRENT_TIMESTAMP`,
        [group.id, group.name, group.description || '', group.order]
      );

      // Only sync relationships if requested (after categories exist)
      if (syncRelationships) {
        // Clear existing category associations
        await client.query('DELETE FROM group_categories WHERE group_id = $1', [group.id]);

        // Insert new category associations (batch insert)
        if (group.categories && group.categories.length > 0) {
          await client.query(
            `INSERT INTO group_categories (group_id, category_id)
             SELECT $1, unnest($2::integer[])
             ON CONFLICT DO NOTHING`,
            [group.id, group.categories]
          );
        }
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function syncGroupCategoryRelationships(groups: AchievementGroup[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const group of groups) {
      // Clear existing category associations
      await client.query('DELETE FROM group_categories WHERE group_id = $1', [group.id]);

      // Insert new category associations (batch insert)
      if (group.categories && group.categories.length > 0) {
        await client.query(
          `INSERT INTO group_categories (group_id, category_id)
           SELECT $1, unnest($2::integer[])
           ON CONFLICT DO NOTHING`,
          [group.id, group.categories]
        );
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function syncCategories(
  categories: AchievementCategory[],
  groups: AchievementGroup[],
  syncRelationships: boolean = true
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const category of categories) {
      await client.query(
        `INSERT INTO achievement_categories (id, name, description, "order", icon)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           "order" = EXCLUDED."order",
           icon = EXCLUDED.icon,
           updated_at = CURRENT_TIMESTAMP`,
        [
          category.id,
          category.name,
          category.description || '',
          category.order,
          category.icon || null,
        ]
      );

      // Only sync relationships if requested (after achievements exist)
      if (syncRelationships) {
        // Clear existing achievement associations
        await client.query('DELETE FROM category_achievements WHERE category_id = $1', [category.id]);

        // Insert new achievement associations (batch insert)
        if (category.achievements && category.achievements.length > 0) {
          await client.query(
            `INSERT INTO category_achievements (category_id, achievement_id)
             SELECT $1, unnest($2::integer[])
             ON CONFLICT DO NOTHING`,
            [category.id, category.achievements]
          );
        }
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function syncCategoryAchievementRelationships(categories: AchievementCategory[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const category of categories) {
      // Clear existing achievement associations
      await client.query('DELETE FROM category_achievements WHERE category_id = $1', [category.id]);

      // Insert new achievement associations (batch insert)
      if (category.achievements && category.achievements.length > 0) {
        await client.query(
          `INSERT INTO category_achievements (category_id, achievement_id)
           SELECT $1, unnest($2::integer[])
           ON CONFLICT DO NOTHING`,
          [category.id, category.achievements]
        );
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function syncAchievements(
  achievements: Achievement[],
  categories: AchievementCategory[]
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const achievement of achievements) {
      await client.query(
        `INSERT INTO achievements (id, icon, name, description, requirement, locked_text, type, flags, tiers, rewards, prerequisites)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO UPDATE SET
           icon = EXCLUDED.icon,
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           requirement = EXCLUDED.requirement,
           locked_text = EXCLUDED.locked_text,
           type = EXCLUDED.type,
           flags = EXCLUDED.flags,
           tiers = EXCLUDED.tiers,
           rewards = EXCLUDED.rewards,
           prerequisites = EXCLUDED.prerequisites,
           updated_at = CURRENT_TIMESTAMP`,
        [
          achievement.id,
          achievement.icon || null,
          achievement.name,
          achievement.description || '',
          achievement.requirement || '',
          achievement.locked_text || null,
          achievement.type,
          achievement.flags || [],
          JSON.stringify(achievement.tiers),
          achievement.rewards ? JSON.stringify(achievement.rewards) : null,
          achievement.prerequisites ? JSON.stringify(achievement.prerequisites) : null,
        ]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Extract unique item IDs from achievement rewards
function extractItemIdsFromAchievements(achievements: Achievement[]): number[] {
  const itemIds = new Set<number>();
  
  for (const achievement of achievements) {
    if (achievement.rewards) {
      for (const reward of achievement.rewards) {
        if (reward.type === 'Item' && reward.id) {
          itemIds.add(reward.id);
        }
      }
    }
  }
  
  return Array.from(itemIds);
}

// Extract unique title IDs from achievement rewards
function extractTitleIdsFromAchievements(achievements: Achievement[]): number[] {
  const titleIds = new Set<number>();
  
  for (const achievement of achievements) {
    if (achievement.rewards) {
      for (const reward of achievement.rewards) {
        if (reward.type === 'Title' && reward.id) {
          titleIds.add(reward.id);
        }
      }
    }
  }
  
  return Array.from(titleIds);
}

async function syncItems(items: Item[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const item of items) {
      await client.query(
        `INSERT INTO items (id, name, description, type, rarity, level, vendor_value, icon, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           type = EXCLUDED.type,
           rarity = EXCLUDED.rarity,
           level = EXCLUDED.level,
           vendor_value = EXCLUDED.vendor_value,
           icon = EXCLUDED.icon,
           details = EXCLUDED.details,
           updated_at = CURRENT_TIMESTAMP`,
        [
          item.id,
          item.name,
          item.description || null,
          item.type || null,
          item.rarity || null,
          item.level || null,
          item.vendor_value || null,
          item.icon || null,
          item.details ? JSON.stringify(item.details) : null,
        ]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function syncTitles(titles: Title[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const title of titles) {
      await client.query(
        `INSERT INTO titles (id, name)
         VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           updated_at = CURRENT_TIMESTAMP`,
        [
          title.id,
          title.name,
        ]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

