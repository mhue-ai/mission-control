/**
 * Kanban Board Store
 * 
 * Persists kanban boards with columns and cards to SQLite.
 * Cards map to workplan tasks or standalone items.
 * Supports: move between columns, reorder, create, edit, archive.
 */

const crypto = require('crypto');

const DEFAULT_COLUMNS = [
  { id: 'backlog', title: 'Backlog', order: 0, wip_limit: 0 },
  { id: 'queued', title: 'Queued', order: 1, wip_limit: 10 },
  { id: 'in_progress', title: 'In Progress', order: 2, wip_limit: 5 },
  { id: 'review', title: 'Review', order: 3, wip_limit: 5 },
  { id: 'done', title: 'Done', order: 4, wip_limit: 0 },
];

class KanbanStore {
  constructor(db) {
    this.db = db;
    this._migrate();
    this._prepare();
    this._seedDefault();
  }

  _migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kanban_boards (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS kanban_columns (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL,
        title TEXT NOT NULL,
        col_order INTEGER DEFAULT 0,
        wip_limit INTEGER DEFAULT 0,
        FOREIGN KEY (board_id) REFERENCES kanban_boards(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS kanban_cards (
        id TEXT PRIMARY KEY,
        column_id TEXT NOT NULL,
        board_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        priority TEXT DEFAULT 'normal' CHECK(priority IN ('critical','high','normal','low')),
        assigned_agent TEXT,
        workplan_task_id TEXT,
        tags TEXT DEFAULT '[]',
        card_order INTEGER DEFAULT 0,
        due_date TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (column_id) REFERENCES kanban_columns(id) ON DELETE CASCADE,
        FOREIGN KEY (board_id) REFERENCES kanban_boards(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_kc_board ON kanban_cards(board_id);
      CREATE INDEX IF NOT EXISTS idx_kc_column ON kanban_cards(column_id);
    `);
  }

  _prepare() {
    this.s = {
      insertBoard: this.db.prepare(`INSERT INTO kanban_boards (id, name, description) VALUES (?, ?, ?)`),
      getBoard: this.db.prepare(`SELECT * FROM kanban_boards WHERE id=?`),
      listBoards: this.db.prepare(`SELECT * FROM kanban_boards ORDER BY created_at`),
      deleteBoard: this.db.prepare(`DELETE FROM kanban_boards WHERE id=?`),

      insertCol: this.db.prepare(`INSERT INTO kanban_columns (id, board_id, title, col_order, wip_limit) VALUES (?, ?, ?, ?, ?)`),
      listCols: this.db.prepare(`SELECT * FROM kanban_columns WHERE board_id=? ORDER BY col_order`),
      updateCol: this.db.prepare(`UPDATE kanban_columns SET title=?, col_order=?, wip_limit=? WHERE id=?`),
      deleteCol: this.db.prepare(`DELETE FROM kanban_columns WHERE id=?`),

      insertCard: this.db.prepare(`INSERT INTO kanban_cards (id, column_id, board_id, title, description, priority, assigned_agent, workplan_task_id, tags, card_order, due_date) VALUES (?,?,?,?,?,?,?,?,?,?,?)`),
      updateCard: this.db.prepare(`UPDATE kanban_cards SET title=?, description=?, priority=?, assigned_agent=?, tags=?, due_date=?, updated_at=datetime('now') WHERE id=?`),
      moveCard: this.db.prepare(`UPDATE kanban_cards SET column_id=?, card_order=?, updated_at=datetime('now') WHERE id=?`),
      deleteCard: this.db.prepare(`DELETE FROM kanban_cards WHERE id=?`),
      listCards: this.db.prepare(`SELECT * FROM kanban_cards WHERE board_id=? ORDER BY card_order`),
      listCardsByCol: this.db.prepare(`SELECT * FROM kanban_cards WHERE column_id=? ORDER BY card_order`),
      getCard: this.db.prepare(`SELECT * FROM kanban_cards WHERE id=?`),
      countByCol: this.db.prepare(`SELECT COUNT(*) as count FROM kanban_cards WHERE column_id=?`),
    };
  }

  _seedDefault() {
    const boards = this.s.listBoards.all();
    if (boards.length > 0) return;

    const boardId = 'main';
    this.s.insertBoard.run(boardId, 'Demo Board', 'Demo task tracking board — rename or delete after setup');
    for (const col of DEFAULT_COLUMNS) {
      this.s.insertCol.run(col.id, boardId, col.title, col.order, col.wip_limit);
    }

    // Seed demo cards
    const examples = [
      { col: 'backlog', title: 'Demo: Set up monitoring dashboards', desc: 'Configure Grafana + Prometheus for all infrastructure', priority: 'normal' },
      { col: 'backlog', title: 'Demo: Document API endpoints', desc: 'Create OpenAPI spec for Mission Control REST API', priority: 'low' },
      { col: 'queued', title: 'Demo: Configure WAF rules', desc: 'Set up Cloudflare WAF rules for production endpoints', priority: 'high' },
      { col: 'in_progress', title: 'Demo: Email triage automation', desc: 'Build workplan for automated email categorization', priority: 'normal', agent: 'demo-nova' },
      { col: 'review', title: 'Demo: PR #412 code review', desc: 'Review authentication refactor pull request', priority: 'high', agent: 'demo-atlas' },
      { col: 'done', title: 'Demo: SSL certificate renewal', desc: 'Renewed production TLS certs', priority: 'normal' },
    ];
    examples.forEach((ex, i) => {
      this.s.insertCard.run(
        'card-' + crypto.randomUUID().slice(0, 8), ex.col, boardId,
        ex.title, ex.desc, ex.priority, ex.agent || null, null,
        '[]', i, null
      );
    });
  }

  // ─── Board ─────────────────────────────────────────────────────

  getFullBoard(boardId) {
    const board = this.s.getBoard.get(boardId);
    if (!board) return null;
    const columns = this.s.listCols.all(boardId);
    const cards = this.s.listCards.all(boardId).map(c => ({ ...c, tags: JSON.parse(c.tags || '[]') }));
    return {
      ...board,
      columns: columns.map(col => ({
        ...col,
        cards: cards.filter(c => c.column_id === col.id),
        count: cards.filter(c => c.column_id === col.id).length,
      })),
    };
  }

  listBoards() { return this.s.listBoards.all(); }

  createBoard(name, description) {
    const id = 'board-' + crypto.randomUUID().slice(0, 8);
    this.s.insertBoard.run(id, name, description || '');
    for (const col of DEFAULT_COLUMNS) {
      this.s.insertCol.run(col.id + '-' + id, id, col.title, col.order, col.wip_limit);
    }
    return this.getFullBoard(id);
  }

  deleteBoard(id) { this.s.deleteBoard.run(id); }

  // ─── Cards ─────────────────────────────────────────────────────

  createCard(boardId, columnId, card) {
    const id = 'card-' + crypto.randomUUID().slice(0, 8);
    const count = this.s.countByCol.get(columnId)?.count || 0;
    this.s.insertCard.run(
      id, columnId, boardId, card.title, card.description || '',
      card.priority || 'normal', card.assignedAgent || null,
      card.workplanTaskId || null, JSON.stringify(card.tags || []),
      count, card.dueDate || null
    );
    return this.s.getCard.get(id);
  }

  updateCard(id, updates) {
    const existing = this.s.getCard.get(id);
    if (!existing) return null;
    this.s.updateCard.run(
      updates.title ?? existing.title,
      updates.description ?? existing.description,
      updates.priority ?? existing.priority,
      updates.assignedAgent !== undefined ? updates.assignedAgent : existing.assigned_agent,
      updates.tags ? JSON.stringify(updates.tags) : existing.tags,
      updates.dueDate !== undefined ? updates.dueDate : existing.due_date,
      id
    );
    return this.s.getCard.get(id);
  }

  moveCard(cardId, toColumnId, order) {
    // Check WIP limit
    const col = this.db.prepare(`SELECT * FROM kanban_columns WHERE id=?`).get(toColumnId);
    if (col && col.wip_limit > 0) {
      const count = this.s.countByCol.get(toColumnId)?.count || 0;
      if (count >= col.wip_limit) {
        throw new Error(`WIP limit reached (${col.wip_limit}) for column "${col.title}"`);
      }
    }
    this.s.moveCard.run(toColumnId, order ?? 0, cardId);
    return this.s.getCard.get(cardId);
  }

  deleteCard(id) { this.s.deleteCard.run(id); }

  // ─── Columns ───────────────────────────────────────────────────

  addColumn(boardId, title, order, wipLimit) {
    const id = 'col-' + crypto.randomUUID().slice(0, 8);
    this.s.insertCol.run(id, boardId, title, order || 99, wipLimit || 0);
    return { id, board_id: boardId, title, col_order: order, wip_limit: wipLimit || 0 };
  }

  updateColumn(id, updates) {
    const existing = this.db.prepare(`SELECT * FROM kanban_columns WHERE id=?`).get(id);
    if (!existing) return null;
    this.s.updateCol.run(
      updates.title ?? existing.title,
      updates.order ?? existing.col_order,
      updates.wipLimit ?? existing.wip_limit,
      id
    );
  }

  deleteColumn(id) { this.s.deleteCol.run(id); }
}

module.exports = { KanbanStore };
