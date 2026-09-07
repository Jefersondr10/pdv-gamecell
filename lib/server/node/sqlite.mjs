import { DatabaseSync } from 'node:sqlite';

// Only application-owned prepared SQL reaches this adapter. Preserve D1 batch
// semantics: synchronous execution within one transaction, including rollback.
export class SqliteDatabase {
  constructor(path) {
    this.database = new DatabaseSync(path, { timeout: 5000 });
    this.database.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  }
  prepare(sql) { return new Statement(this, sql, []); }
  async batch(statements) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map((statement) => {
        if (statement.owner !== this) throw new Error('Foreign database statement');
        return statement.execute();
      });
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
  close() { this.database.close(); }
}

class Statement {
  constructor(owner, sql, values) { this.owner = owner; this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.owner, this.sql, values); }
  execute() {
    const db = this.owner.database;
    const before = db.prepare('SELECT total_changes() AS total').get().total;
    const statement = db.prepare(this.sql);
    const values = this.values.map((value) => {
      if (value === undefined) throw new Error('Undefined SQL binding');
      return typeof value === 'boolean' ? Number(value) : value;
    });
    const results = statement.columns().length ? statement.all(...values) : (statement.run(...values), []);
    const meta = db.prepare('SELECT total_changes() AS total, last_insert_rowid() AS last_row_id').get();
    return { success: true, results, meta: { changes: Number(meta.total - before), last_row_id: Number(meta.last_row_id) } };
  }
  async first(column) { const row = this.execute().results[0]; return row ? (column ? row[column] : row) : null; }
  async all() { return this.execute(); }
  async run() { return this.execute(); }
}
