import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from './database.js';

let db: Database.Database | undefined;
afterEach(() => db?.close());

describe('database bootstrap', () => {
  it('creates schema and idempotently seeds demo identities and teaching content', () => {
    db = createDatabase(':memory:');
    const users = db.prepare('SELECT username,role FROM users ORDER BY id').all();
    expect(users).toEqual([
      { username: 'demo_student', role: 'student' },
      { username: 'demo_faculty', role: 'faculty' },
    ]);
    expect((db.prepare('SELECT COUNT(*) AS count FROM cases').get() as { count: number }).count).toBeGreaterThanOrEqual(5);
    expect((db.prepare('SELECT COUNT(*) AS count FROM rubrics').get() as { count: number }).count).toBeGreaterThan(0);
    expect((db.prepare('SELECT COUNT(*) AS count FROM case_rubrics').get() as { count: number }).count).toBeGreaterThanOrEqual(5);
  });

  it('does not attach a default rubric to a faculty-created draft on restart', () => {
    db = createDatabase(':memory:');
    const now = new Date().toISOString();
    const created = db.prepare(`INSERT INTO cases
      (slug,title,specialty,setting,summary,difficulty,estimated_minutes,status,current_version,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,'draft',1,?,?)`).run(
      'faculty-draft', 'Faculty draft', 'Medicine', 'Clinic', '', 'Year 3', 10, now, now,
    );
    seedDatabase(db);
    const linked = db.prepare('SELECT COUNT(*) AS count FROM case_rubrics WHERE case_id=?').get(created.lastInsertRowid) as { count: number };
    expect(linked.count).toBe(0);
  });
});
