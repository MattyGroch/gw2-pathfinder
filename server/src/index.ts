import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cron from 'node-cron';
import apiRoutes from './routes/api.js';
import { syncAllData } from './services/syncService.js';
import { waitForDatabase } from './db/waitForDb.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pool } from './db/connection.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api', apiRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Run database migrations
async function runMigrations() {
  try {
    console.log('Running database migrations...');
    const schema = readFileSync(join(__dirname, 'db', 'schema.sql'), 'utf-8');
    
    // Execute the entire schema as one transaction
    // This handles dollar-quoted strings and multi-statement blocks properly
    try {
      await pool.query(schema);
      console.log('Database schema created successfully');
    } catch (error: any) {
      // If it fails, try executing statement by statement (for partial migrations)
      const errorMsg = error.message || String(error);
      const errorCode = error.code || '';
      
      if (errorCode === '42P07' || // relation already exists
          errorCode === '42710' || // duplicate object
          errorMsg.includes('already exists') || 
          errorMsg.includes('duplicate')) {
        console.log('Schema objects already exist, skipping migration');
      } else {
        console.warn('Full schema execution failed, trying statement-by-statement:', errorMsg);
        // Fallback: try to execute statements individually
        // Remove comments first
        let cleanSchema = schema
          .replace(/--.*$/gm, '') // Remove single-line comments
          .replace(/\/\*[\s\S]*?\*\//g, ''); // Remove multi-line comments
        
        // Split by semicolon, but preserve dollar-quoted strings
        const statements: string[] = [];
        let current = '';
        let inDollarQuote = false;
        let dollarTag = '';
        
        for (let i = 0; i < cleanSchema.length; i++) {
          const char = cleanSchema[i];
          current += char;
          
          // Check for dollar quote start: $tag$ or $$
          if (char === '$' && !inDollarQuote) {
            const nextChars = cleanSchema.substring(i, i + 10);
            const match = nextChars.match(/^\$([^$]*)\$/);
            if (match) {
              inDollarQuote = true;
              dollarTag = match[0];
              i += dollarTag.length - 1;
              continue;
            }
          }
          
          // Check for dollar quote end
          if (inDollarQuote && current.endsWith(dollarTag)) {
            inDollarQuote = false;
            dollarTag = '';
          }
          
          // Split on semicolon only if not in dollar quote
          if (char === ';' && !inDollarQuote) {
            const stmt = current.trim();
            if (stmt.length > 10) {
              statements.push(stmt);
            }
            current = '';
          }
        }
        
        // Execute remaining statement
        if (current.trim().length > 10) {
          statements.push(current.trim());
        }
        
        let executed = 0;
        for (const statement of statements) {
          try {
            await pool.query(statement);
            executed++;
          } catch (stmtError: any) {
            const stmtErrorMsg = stmtError.message || String(stmtError);
            const stmtErrorCode = stmtError.code || '';
            if (stmtErrorCode !== '42P07' && 
                stmtErrorCode !== '42710' &&
                !stmtErrorMsg.includes('already exists') && 
                !stmtErrorMsg.includes('duplicate')) {
              console.error('Migration error:', stmtErrorMsg);
              throw stmtError;
            }
          }
        }
        console.log(`Executed ${executed} statements`);
      }
    }
    
    console.log('Database schema ready');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
}

// Initial data sync on startup
async function initialize() {
  console.log('Initializing server...');
  
  // Wait for database to be ready
  await waitForDatabase();
  
  // Run migrations
  await runMigrations();
  
  // Check if we have any data
  const result = await pool.query('SELECT COUNT(*) FROM achievement_groups');
  const groupCount = parseInt(result.rows[0].count);

  if (groupCount === 0) {
    console.log('No data found. Running initial sync...');
    try {
      await syncAllData();
      console.log('Initial sync completed');
    } catch (error) {
      console.error('Initial sync failed:', error);
      console.log('Server will start, but data may be incomplete. Run sync manually via POST /api/sync');
    }
  } else {
    console.log(`Found ${groupCount} groups in database. Skipping initial sync.`);
  }
}

// Start server
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await initialize();

  // Schedule nightly sync at 2 AM
  cron.schedule('0 2 * * *', async () => {
    console.log('Running scheduled nightly sync...');
    try {
      await syncAllData();
      console.log('Nightly sync completed');
    } catch (error) {
      console.error('Nightly sync failed:', error);
    }
  }, {
    timezone: 'UTC'
  });

  console.log('Nightly sync scheduled for 2:00 AM UTC');
});

