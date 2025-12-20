import { Router } from 'express';
import { pool } from '../db/connection.js';

const router = Router();

// Helper function to enrich achievements with item and title data
async function enrichAchievementsWithItems(rows: any[]): Promise<any[]> {
  // Extract all item IDs and title IDs from rewards
  const itemIds = new Set<number>();
  const titleIds = new Set<number>();
  for (const row of rows) {
    if (row.rewards) {
      for (const reward of row.rewards) {
        if (reward.type === 'Item' && reward.id) {
          itemIds.add(reward.id);
        } else if (reward.type === 'Title' && reward.id) {
          titleIds.add(reward.id);
        }
      }
    }
  }

  // Fetch items if any exist
  let itemsMap: Record<number, any> = {};
  if (itemIds.size > 0) {
    try {
      const itemIdsArray = Array.from(itemIds);
      const itemsResult = await pool.query(
        `SELECT id, name, description, type, rarity, level, vendor_value, icon, details
         FROM items
         WHERE id = ANY($1)`,
        [itemIdsArray]
      );
      
      itemsMap = itemsResult.rows.reduce((acc, item) => {
        acc[item.id] = {
          id: item.id,
          name: item.name,
          description: item.description,
          type: item.type,
          rarity: item.rarity,
          level: item.level,
          vendor_value: item.vendor_value,
          icon: item.icon,
          details: item.details,
        };
        return acc;
      }, {} as Record<number, any>);
    } catch (error: any) {
      // If items table doesn't exist yet, just continue without item data
      // This can happen if migrations haven't run yet
      if (error.code === '42P01') { // relation does not exist
        console.warn('Items table does not exist yet, skipping item enrichment');
      } else {
        throw error; // Re-throw other errors
      }
    }
  }

  // Fetch titles if any exist
  let titlesMap: Record<number, any> = {};
  if (titleIds.size > 0) {
    try {
      const titleIdsArray = Array.from(titleIds);
      const titlesResult = await pool.query(
        `SELECT id, name
         FROM titles
         WHERE id = ANY($1)`,
        [titleIdsArray]
      );
      
      titlesMap = titlesResult.rows.reduce((acc, title) => {
        acc[title.id] = {
          id: title.id,
          name: title.name,
        };
        return acc;
      }, {} as Record<number, any>);
    } catch (error: any) {
      // If titles table doesn't exist yet, just continue without title data
      if (error.code === '42P01') { // relation does not exist
        console.warn('Titles table does not exist yet, skipping title enrichment');
      } else {
        throw error; // Re-throw other errors
      }
    }
  }

  // Map achievements and enrich rewards with item and title data
  return rows.map(row => {
    const achievement: any = {
      id: row.id,
      icon: row.icon,
      name: row.name,
      description: row.description,
      requirement: row.requirement,
      locked_text: row.locked_text,
      type: row.type,
      flags: row.flags,
      tiers: row.tiers,
      rewards: row.rewards,
      prerequisites: row.prerequisites,
    };

    // Enrich rewards with item and title data
    if (achievement.rewards) {
      achievement.rewards = achievement.rewards.map((reward: any) => {
        if (reward.type === 'Item' && reward.id && itemsMap[reward.id]) {
          return {
            ...reward,
            item: itemsMap[reward.id],
          };
        } else if (reward.type === 'Title' && reward.id && titlesMap[reward.id]) {
          return {
            ...reward,
            title: titlesMap[reward.id],
          };
        }
        return reward;
      });
    }

    return achievement;
  });
}

// Get all achievement groups
router.get('/groups', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        ag.id,
        ag.name,
        ag.description,
        ag."order",
        COALESCE(
          json_agg(DISTINCT gc.category_id) FILTER (WHERE gc.category_id IS NOT NULL),
          '[]'::json
        ) as categories
      FROM achievement_groups ag
      LEFT JOIN group_categories gc ON ag.id = gc.group_id
      GROUP BY ag.id, ag.name, ag.description, ag."order"
      ORDER BY ag."order"
    `);

    const groups = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      order: row.order,
      categories: row.categories || [],
    }));

    res.json(groups);
  } catch (error) {
    console.error('Error fetching groups:', error);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

// Get categories for a specific group
router.get('/groups/:groupId/categories', async (req, res) => {
  try {
    const { groupId } = req.params;
    const result = await pool.query(`
      SELECT 
        ac.id,
        ac.name,
        ac.description,
        ac."order",
        ac.icon,
        COALESCE(
          json_agg(DISTINCT ca.achievement_id) FILTER (WHERE ca.achievement_id IS NOT NULL),
          '[]'::json
        ) as achievements
      FROM achievement_categories ac
      INNER JOIN group_categories gc ON ac.id = gc.category_id
      LEFT JOIN category_achievements ca ON ac.id = ca.category_id
      WHERE gc.group_id = $1
      GROUP BY ac.id, ac.name, ac.description, ac."order", ac.icon
      ORDER BY ac."order"
    `, [groupId]);

    const categories = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      order: row.order,
      icon: row.icon,
      achievements: row.achievements || [],
    }));

    res.json(categories);
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// Get achievements for a specific category
router.get('/categories/:categoryId/achievements', async (req, res) => {
  try {
    const { categoryId } = req.params;
    const result = await pool.query(`
      SELECT 
        a.id,
        a.icon,
        a.name,
        a.description,
        a.requirement,
        a.locked_text,
        a.type,
        a.flags,
        a.tiers,
        a.rewards,
        a.prerequisites
      FROM achievements a
      INNER JOIN category_achievements ca ON a.id = ca.achievement_id
      WHERE ca.category_id = $1
      ORDER BY a.id
    `, [categoryId]);

    const achievements = await enrichAchievementsWithItems(result.rows);
    res.json(achievements);
  } catch (error) {
    console.error('Error fetching achievements:', error);
    res.status(500).json({ error: 'Failed to fetch achievements' });
  }
});

// Get specific achievements by IDs
router.get('/achievements', async (req, res) => {
  try {
    const ids = req.query.ids;
    if (!ids || typeof ids !== 'string') {
      return res.status(400).json({ error: 'ids query parameter is required' });
    }

    const idArray = ids.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
    if (idArray.length === 0) {
      return res.status(400).json({ error: 'Invalid achievement IDs' });
    }

    const result = await pool.query(`
      SELECT 
        id,
        icon,
        name,
        description,
        requirement,
        locked_text,
        type,
        flags,
        tiers,
        rewards,
        prerequisites
      FROM achievements
      WHERE id = ANY($1)
    `, [idArray]);

    const achievements = await enrichAchievementsWithItems(result.rows);
    res.json(achievements);
  } catch (error) {
    console.error('Error fetching achievements:', error);
    res.status(500).json({ error: 'Failed to fetch achievements' });
  }
});

// Get achievement to category mapping (for playstyle calculation)
router.get('/achievement-category-map', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT achievement_id, category_id
      FROM category_achievements
    `);

    const map: Record<number, number> = {};
    result.rows.forEach(row => {
      map[row.achievement_id] = row.category_id;
    });

    res.json(map);
  } catch (error) {
    console.error('Error fetching achievement-category map:', error);
    res.status(500).json({ error: 'Failed to fetch mapping' });
  }
});

// Get reverse prerequisite lookup (which achievements require a given achievement)
router.get('/achievements/:achievementId/unlocks', async (req, res) => {
  try {
    const { achievementId } = req.params;
    const id = parseInt(achievementId);
    
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid achievement ID' });
    }

    const result = await pool.query(`
      SELECT 
        id,
        icon,
        name,
        description,
        requirement,
        locked_text,
        type,
        flags,
        tiers,
        rewards,
        prerequisites
      FROM achievements
      WHERE prerequisites @> $1::jsonb
      ORDER BY id
    `, [JSON.stringify([id])]);

    const achievements = result.rows.map(row => ({
      id: row.id,
      icon: row.icon,
      name: row.name,
      description: row.description,
      requirement: row.requirement,
      locked_text: row.locked_text,
      type: row.type,
      flags: row.flags,
      tiers: row.tiers,
      rewards: row.rewards,
      prerequisites: row.prerequisites,
    }));

    res.json(achievements);
  } catch (error) {
    console.error('Error fetching unlocked achievements:', error);
    res.status(500).json({ error: 'Failed to fetch unlocked achievements' });
  }
});

// Get reverse prerequisite map (achievementId -> [achievements that require it])
router.get('/achievement-unlocks-map', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id,
        prerequisites
      FROM achievements
      WHERE prerequisites IS NOT NULL AND jsonb_array_length(prerequisites) > 0
    `);

    const map: Record<number, number[]> = {};
    
    result.rows.forEach(row => {
      const prerequisites = row.prerequisites as number[];
      if (prerequisites) {
        prerequisites.forEach(prereqId => {
          if (!map[prereqId]) {
            map[prereqId] = [];
          }
          map[prereqId].push(row.id);
        });
      }
    });

    res.json(map);
  } catch (error) {
    console.error('Error fetching achievement-unlocks map:', error);
    res.status(500).json({ error: 'Failed to fetch mapping' });
  }
});

// Manual sync trigger endpoint (for testing/admin)
router.post('/sync', async (req, res) => {
  try {
    const { syncAllData } = await import('../services/syncService.js');
    res.json({ message: 'Sync started', status: 'processing' });
    
    // Run sync in background
    syncAllData().catch(err => {
      console.error('Background sync failed:', err);
    });
  } catch (error) {
    console.error('Error starting sync:', error);
    res.status(500).json({ error: 'Failed to start sync' });
  }
});

export default router;

