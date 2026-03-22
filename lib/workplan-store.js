/**
 * Workplan Store — SQLite Persistence
 * 
 * Fixes from review:
 * - Workplans, phases, and tasks persist across browser refreshes and server restarts
 * - Phase dependency gating enforced at the data layer
 * - Proper CRUD with transactions
 */

class WorkplanStore {
  constructor(db) {
    this.db = db;
    this._migrate();
    this._prepareStatements();
  }

  _migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workplans (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        status TEXT DEFAULT 'draft' CHECK(status IN ('draft','active','paused','completed','archived')),
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS workplan_phases (
        id TEXT PRIMARY KEY,
        workplan_id TEXT NOT NULL,
        name TEXT NOT NULL,
        phase_order INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (workplan_id) REFERENCES workplans(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS workplan_tasks (
        id TEXT PRIMARY KEY,
        phase_id TEXT NOT NULL,
        workplan_id TEXT NOT NULL,
        name TEXT NOT NULL,
        instruction TEXT DEFAULT '',
        assigned_agent TEXT,
        status TEXT DEFAULT 'idle' CHECK(status IN ('idle','queued','running','completed','failed','paused','retrying')),
        priority TEXT DEFAULT 'normal' CHECK(priority IN ('critical','high','normal','low')),
        retries INTEGER DEFAULT 0,
        max_retries INTEGER DEFAULT 3,
        timeout_ms INTEGER DEFAULT 300000,
        error TEXT,
        result TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        started_at TEXT,
        completed_at TEXT,
        FOREIGN KEY (phase_id) REFERENCES workplan_phases(id) ON DELETE CASCADE,
        FOREIGN KEY (workplan_id) REFERENCES workplans(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_wt_status ON workplan_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_wt_phase ON workplan_tasks(phase_id);
      CREATE INDEX IF NOT EXISTS idx_wt_workplan ON workplan_tasks(workplan_id);
      CREATE INDEX IF NOT EXISTS idx_wp_phase_workplan ON workplan_phases(workplan_id);
    `);
  }

  _prepareStatements() {
    this.stmts = {
      insertWp: this.db.prepare(`INSERT INTO workplans (id, name, description, status) VALUES (?, ?, ?, ?)`),
      updateWp: this.db.prepare(`UPDATE workplans SET name=?, description=?, status=?, updated_at=datetime('now') WHERE id=?`),
      deleteWp: this.db.prepare(`DELETE FROM workplans WHERE id=?`),
      getWp: this.db.prepare(`SELECT * FROM workplans WHERE id=?`),
      listWp: this.db.prepare(`SELECT * FROM workplans ORDER BY created_at DESC`),

      insertPhase: this.db.prepare(`INSERT INTO workplan_phases (id, workplan_id, name, phase_order) VALUES (?, ?, ?, ?)`),
      updatePhase: this.db.prepare(`UPDATE workplan_phases SET name=?, phase_order=? WHERE id=?`),
      deletePhase: this.db.prepare(`DELETE FROM workplan_phases WHERE id=?`),
      listPhases: this.db.prepare(`SELECT * FROM workplan_phases WHERE workplan_id=? ORDER BY phase_order`),

      insertTask: this.db.prepare(`INSERT INTO workplan_tasks (id, phase_id, workplan_id, name, instruction, assigned_agent, status, priority, max_retries, timeout_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
      updateTask: this.db.prepare(`UPDATE workplan_tasks SET name=?, instruction=?, assigned_agent=?, status=?, priority=?, max_retries=?, timeout_ms=?, error=?, result=? WHERE id=?`),
      deleteTask: this.db.prepare(`DELETE FROM workplan_tasks WHERE id=?`),
      listTasks: this.db.prepare(`SELECT * FROM workplan_tasks WHERE phase_id=? ORDER BY created_at`),
      listTasksByWp: this.db.prepare(`SELECT * FROM workplan_tasks WHERE workplan_id=? ORDER BY created_at`),
      updateTaskStatus: this.db.prepare(`UPDATE workplan_tasks SET status=?, error=?, retries=?, started_at=CASE WHEN ?='running' THEN datetime('now') ELSE started_at END, completed_at=CASE WHEN ? IN ('completed','failed') THEN datetime('now') ELSE completed_at END WHERE id=?`),
    };
  }

  // ─── Workplan CRUD ───────────────────────────────────────────────

  createWorkplan(wp) {
    const txn = this.db.transaction(() => {
      this.stmts.insertWp.run(wp.id, wp.name, wp.description || '', wp.status || 'draft');
      if (wp.phases) {
        for (const phase of wp.phases) {
          this.stmts.insertPhase.run(phase.id, wp.id, phase.name, phase.order || 0);
          if (phase.tasks) {
            for (const task of phase.tasks) {
              this.stmts.insertTask.run(task.id, phase.id, wp.id, task.name, task.instruction || '', task.assignedAgent || null, task.status || 'idle', task.priority || 'normal', task.maxRetries || 3, task.timeoutMs || 300000);
            }
          }
        }
      }
    });
    txn();
    return this.getWorkplan(wp.id);
  }

  getWorkplan(id) {
    const wp = this.stmts.getWp.get(id);
    if (!wp) return null;
    wp.phases = this.stmts.listPhases.all(id).map(phase => {
      phase.tasks = this.stmts.listTasks.all(phase.id);
      return phase;
    });
    return wp;
  }

  listWorkplans() {
    return this.stmts.listWp.all().map(wp => {
      wp.phases = this.stmts.listPhases.all(wp.id).map(phase => {
        phase.tasks = this.stmts.listTasks.all(phase.id);
        return phase;
      });
      return wp;
    });
  }

  updateWorkplan(id, updates) {
    const wp = this.stmts.getWp.get(id);
    if (!wp) return null;
    this.stmts.updateWp.run(updates.name ?? wp.name, updates.description ?? wp.description, updates.status ?? wp.status, id);
    return this.getWorkplan(id);
  }

  deleteWorkplan(id) {
    this.stmts.deleteWp.run(id);
  }

  // ─── Phase CRUD ──────────────────────────────────────────────────

  addPhase(workplanId, phase) {
    this.stmts.insertPhase.run(phase.id, workplanId, phase.name, phase.order || 0);
    return phase;
  }

  updatePhase(phaseId, updates) {
    this.stmts.updatePhase.run(updates.name, updates.order ?? 0, phaseId);
  }

  deletePhase(phaseId) {
    this.stmts.deletePhase.run(phaseId);
  }

  // ─── Task CRUD ───────────────────────────────────────────────────

  addTask(phaseId, workplanId, task) {
    this.stmts.insertTask.run(task.id, phaseId, workplanId, task.name, task.instruction || '', task.assignedAgent || null, task.status || 'idle', task.priority || 'normal', task.maxRetries || 3, task.timeoutMs || 300000);
    return task;
  }

  updateTask(taskId, updates) {
    // Get current task to merge
    const rows = this.db.prepare(`SELECT * FROM workplan_tasks WHERE id=?`).get(taskId);
    if (!rows) return null;
    this.stmts.updateTask.run(
      updates.name ?? rows.name,
      updates.instruction ?? rows.instruction,
      updates.assignedAgent !== undefined ? updates.assignedAgent : rows.assigned_agent,
      updates.status ?? rows.status,
      updates.priority ?? rows.priority,
      updates.maxRetries ?? rows.max_retries,
      updates.timeoutMs ?? rows.timeout_ms,
      updates.error !== undefined ? updates.error : rows.error,
      updates.result !== undefined ? updates.result : rows.result,
      taskId
    );
    return this.db.prepare(`SELECT * FROM workplan_tasks WHERE id=?`).get(taskId);
  }

  updateTaskStatus(taskId, status, error = null, retries = null) {
    this.stmts.updateTaskStatus.run(status, error, retries, status, status, taskId);
  }

  deleteTask(taskId) {
    this.stmts.deleteTask.run(taskId);
  }

  // ─── Phase Dependency Check ──────────────────────────────────────

  /**
   * Check if a phase is ready to execute (all prior phases complete).
   */
  isPhaseReady(workplanId, phaseOrder) {
    const phases = this.stmts.listPhases.all(workplanId);
    const priorPhases = phases.filter(p => p.phase_order < phaseOrder);

    for (const phase of priorPhases) {
      const tasks = this.stmts.listTasks.all(phase.id);
      const incomplete = tasks.filter(t => t.status !== 'completed');
      if (incomplete.length > 0) return false;
    }
    return true;
  }

  /**
   * Activate a workplan: set status to 'active' and queue all idle tasks
   * in the first phase only (respects phase gating).
   */
  activateWorkplan(id) {
    const txn = this.db.transaction(() => {
      this.stmts.updateWp.run(undefined, undefined, 'active', id);
      const phases = this.stmts.listPhases.all(id);
      if (phases.length > 0) {
        // Only queue tasks in the first phase
        const firstPhase = phases.reduce((a, b) => a.phase_order < b.phase_order ? a : b);
        const tasks = this.stmts.listTasks.all(firstPhase.id);
        for (const task of tasks) {
          if (task.status === 'idle') {
            this.stmts.updateTaskStatus.run('queued', null, 0, 'queued', 'queued', task.id);
          }
        }
      }
    });
    txn();
    return this.getWorkplan(id);
  }

  /**
   * Check if the next phase should be unlocked after a task completes.
   */
  checkPhaseProgression(workplanId) {
    const phases = this.stmts.listPhases.all(workplanId);
    const sortedPhases = phases.sort((a, b) => a.phase_order - b.phase_order);
    const unlocked = [];

    for (const phase of sortedPhases) {
      const tasks = this.stmts.listTasks.all(phase.id);
      const allDone = tasks.every(t => t.status === 'completed');

      if (allDone) {
        // Find the next phase and queue its idle tasks
        const nextPhase = sortedPhases.find(p => p.phase_order > phase.phase_order);
        if (nextPhase) {
          const nextTasks = this.stmts.listTasks.all(nextPhase.id);
          const idleTasks = nextTasks.filter(t => t.status === 'idle');
          for (const task of idleTasks) {
            this.stmts.updateTaskStatus.run('queued', null, 0, 'queued', 'queued', task.id);
            unlocked.push(task.id);
          }
        }
      }
    }

    // Check if ALL phases complete → mark workplan complete
    const allTasks = this.stmts.listTasksByWp.all(workplanId);
    if (allTasks.length > 0 && allTasks.every(t => t.status === 'completed')) {
      this.stmts.updateWp.run(undefined, undefined, 'completed', workplanId);
    }

    return unlocked;
  }
}

module.exports = { WorkplanStore };
