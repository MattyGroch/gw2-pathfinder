import { pool } from './connection.js';

export async function waitForDatabase(maxRetries = 30, delayMs = 1000): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await pool.query('SELECT 1');
      console.log('Database connection established');
      return;
    } catch (error) {
      if (i === maxRetries - 1) {
        throw new Error(`Database not available after ${maxRetries} attempts: ${error}`);
      }
      console.log(`Waiting for database... (${i + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

