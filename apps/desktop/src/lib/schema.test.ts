import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

// Exercises the real migration file against SQLite so schema mistakes fail in CI,
// not at first launch.
const sql = readFileSync(
  new URL('../../src-tauri/migrations/0001_initial.sql', import.meta.url),
  'utf8',
);

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(sql);
  return db;
}

describe('0001_initial migration', () => {
  it('stores messages under a conversation', () => {
    const db = freshDb();
    db.prepare('INSERT INTO conversations (id, created_at, updated_at) VALUES (?, ?, ?)').run(
      'c1',
      1,
      1,
    );
    db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?)').run('m1', 'c1', 'user', 'hi', 2);
    expect(db.prepare('SELECT COUNT(*) AS n FROM messages').get()).toEqual({ n: 1 });
  });

  it('cascades deletes from conversation to messages', () => {
    const db = freshDb();
    db.prepare('INSERT INTO conversations (id, created_at, updated_at) VALUES (?, ?, ?)').run(
      'c1',
      1,
      1,
    );
    db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?)').run('m1', 'c1', 'user', 'hi', 2);
    db.prepare('DELETE FROM conversations WHERE id = ?').run('c1');
    expect(db.prepare('SELECT COUNT(*) AS n FROM messages').get()).toEqual({ n: 0 });
  });

  it('rejects unknown roles and orphan messages', () => {
    const db = freshDb();
    db.prepare('INSERT INTO conversations (id, created_at, updated_at) VALUES (?, ?, ?)').run(
      'c1',
      1,
      1,
    );
    expect(() =>
      db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?)').run('m1', 'c1', 'robot', 'x', 2),
    ).toThrow();
    expect(() =>
      db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?)').run('m2', 'nope', 'user', 'x', 2),
    ).toThrow();
  });
});
