/**
 * Execution Engine v2 — Fixed
 * 
 * Fixes from review:
 * - Replaced TASK_COMPLETE marker parsing with session-idle detection
 *   (polls sessions.get to check for idle state + confirmation heartbeat)
 * - Idempotency keys on all dispatch calls
 * - Capacity-aware agent assignment (respects sessionsActive + maxConcurrent)
 * - Per-task timeout configuration (not flat 5min)
 * - Phase dependency gating (phase N+1 won't start until phase N completes)
 * - Workplan persistence to SQLite
 * - Structured logging
 */

const EventEmitter = require('events');
const crypto = require('crypto');

const DEFAULT_TIMEOUT_MS = 300000;     // 5 min default
const IDLE_POLL_INTERVAL_MS = 10000;   // Check session state every 10s
const IDLE_THRESHOLD_MS = 15000;       // Session idle for 15s = likely done
const CONFIRMATION_DELAY_MS = 5000;    // Wait 5s after idle before confirming

class ExecutionEngine extends EventEmitter {
  constructor(connector, db) {
    super();
    this.connector = connector;
    this.db = db;
    this.activeTasks = new Map();
    this._taskPollers = new Map();
    this._taskTimeouts = new Map();

    // Listen for gateway events
    this.connector.on('event', (event) => this._handleGatewayEvent(event));

    // Prepare DB statements if available
    if (this.db) {
      this._stmts = {
        upsertTask: this.db.prepare(`
          INSERT INTO tasks (id, name, description, agent_id, gateway_id, state, priority, retries, max_retries, started_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(id) DO UPDATE SET
            state=excluded.state, agent_id=excluded.agent_id, retries=excluded.retries, started_at=excluded.started_at
        `),
        completeTask: this.db.prepare(`UPDATE tasks SET state='completed', result=?, completed_at=datetime('now') WHERE id=?`),
        failTask: this.db.prepare(`UPDATE tasks SET state='failed', error=?, retries=? WHERE id=?`),
        getTask: this.db.prepare(`SELECT * FROM tasks WHERE id=?`),
        logEvent: this.db.prepare(`
          INSERT INTO events (gateway_id, agent_id, event_type, message, payload, created_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'))
        `),
      };
    }
  }

  // ─── Task Dispatch ───────────────────────────────────────────────

  /**
   * Dispatch a single task to an agent.
   * Returns the active task record.
   */
  async dispatch(task, agentId, gatewayId) {
    const agent = this.connector.agents.get(`${gatewayId}:${agentId}`);
    if (!agent) throw new Error(`Agent ${agentId} not found on ${gatewayId}`);

    // Check agent capacity
    const agentLoad = this._getAgentLoad(agentId, gatewayId);
    const maxConcurrent = agent.maxConcurrent || 5;
    if (agentLoad >= maxConcurrent) {
      throw new Error(`Agent ${agentId} at capacity (${agentLoad}/${maxConcurrent})`);
    }

    const sessionKey = `agent:${agentId}:main`;
    const message = this._buildMessage(task);
    const idempotencyKey = `dispatch:${task.id}:${task.retries || 0}`;

    // Send via gateway
    try {
      await this.connector.sendAgentMessage(gatewayId, sessionKey, message, {
        taskId: task.id,
        workplanId: task.workplanId,
        idempotencyKey,
      });
    } catch (e) {
      this._log(gatewayId, agentId, 'dispatch_failed', `Failed to dispatch ${task.id}: ${e.message}`);
      throw e;
    }

    const activeTask = {
      taskId: task.id,
      agentId,
      gatewayId,
      sessionKey,
      workplanId: task.workplanId,
      phaseName: task.phaseName,
      name: task.name,
      priority: task.priority,
      instruction: task.instruction,
      startedAt: Date.now(),
      status: 'running',
      retries: task.retries || 0,
      maxRetries: task.maxRetries || 3,
      timeoutMs: task.timeoutMs || DEFAULT_TIMEOUT_MS,
      lastSessionActivity: Date.now(),
      idleConfirmationPending: false,
    };

    this.activeTasks.set(task.id, activeTask);

    // Persist
    if (this._stmts) {
      this._stmts.upsertTask.run(task.id, task.name, task.instruction, agentId, gatewayId, 'running', task.priority, activeTask.retries, activeTask.maxRetries);
    }

    // Start session-idle polling (replaces marker-based detection)
    this._startIdlePolling(task.id);

    // Set per-task timeout
    const timeout = setTimeout(() => this._handleTimeout(task.id), activeTask.timeoutMs);
    this._taskTimeouts.set(task.id, timeout);

    this._log(gatewayId, agentId, 'task_dispatched', `Dispatched: ${task.name} (timeout: ${Math.round(activeTask.timeoutMs / 1000)}s)`);
    this.emit('task:dispatched', { taskId: task.id, agentId, gatewayId });

    return activeTask;
  }

  /**
   * Dispatch an entire workplan with phase dependency gating.
   * Phase N+1 tasks are only dispatched after ALL phase N tasks complete.
   */
  async dispatchWorkplan(workplan, availableAgents) {
    const onlineAgents = availableAgents.filter(a => a.status === 'online');
    if (onlineAgents.length === 0) throw new Error('No online agents available');

    const dispatched = [];
    const sortedPhases = [...workplan.phases].sort((a, b) => a.order - b.order);

    for (const phase of sortedPhases) {
      // Check if previous phases are complete
      const prevPhases = sortedPhases.filter(p => p.order < phase.order);
      const prevTasks = prevPhases.flatMap(p => p.tasks);
      const prevIncomplete = prevTasks.filter(t => t.status !== 'completed' && t.status !== 'idle');

      if (prevIncomplete.length > 0) {
        this._log(null, null, 'phase_gated', `Phase "${phase.name}" blocked: ${prevIncomplete.length} tasks in prior phases still pending`);
        break; // Stop dispatching — earlier phases not done
      }

      // Dispatch tasks in this phase with capacity-aware assignment
      for (const task of phase.tasks) {
        if (task.status !== 'queued') continue;

        // Find the least-loaded online agent
        const agent = task.assignedAgent
          ? onlineAgents.find(a => a.id === task.assignedAgent)
          : this._selectLeastLoadedAgent(onlineAgents);

        if (!agent) {
          this._log(null, null, 'dispatch_skipped', `No available agent for task "${task.name}"`);
          continue;
        }

        try {
          await this.dispatch({
            ...task,
            workplanId: workplan.id,
            workplanName: workplan.name,
            phaseName: phase.name,
          }, agent.id, agent.gateway);
          dispatched.push({ taskId: task.id, agentId: agent.id, phaseName: phase.name });
        } catch (e) {
          console.error(`[exec] Failed to dispatch ${task.id}: ${e.message}`);
        }
      }
    }

    return dispatched;
  }

  // ─── Session-Idle Detection ──────────────────────────────────────
  // Instead of parsing TASK_COMPLETE markers from LLM output, we poll
  // the session state. When the session has been idle (no tool calls
  // in flight, last message from assistant) for IDLE_THRESHOLD_MS,
  // we send a confirmation heartbeat asking the agent to report status.

  _startIdlePolling(taskId) {
    const poller = setInterval(async () => {
      const task = this.activeTasks.get(taskId);
      if (!task || task.status !== 'running') {
        clearInterval(poller);
        this._taskPollers.delete(taskId);
        return;
      }

      try {
        const session = await this.connector.getSessionStatus(task.gatewayId, task.sessionKey);
        if (!session) return;

        // Track session activity
        const lastActivity = session.lastActivityAt || session.updatedAt;
        const lastActivityTs = lastActivity ? new Date(lastActivity).getTime() : task.startedAt;
        const idleDuration = Date.now() - lastActivityTs;

        // Check if session is idle (no tool calls running, assistant was last speaker)
        const isIdle = !session.toolCallsInFlight &&
                       (session.lastRole === 'assistant' || session.lastRole === 'model') &&
                       idleDuration > IDLE_THRESHOLD_MS;

        if (isIdle && !task.idleConfirmationPending) {
          // Session appears idle — send a confirmation probe
          task.idleConfirmationPending = true;
          this._log(task.gatewayId, task.agentId, 'idle_detected',
            `Session idle for ${Math.round(idleDuration / 1000)}s — sending confirmation probe`);

          // Wait a bit then check again (in case agent is between tool calls)
          setTimeout(async () => {
            try {
              const recheck = await this.connector.getSessionStatus(task.gatewayId, task.sessionKey);
              const recheckActivity = recheck?.lastActivityAt || recheck?.updatedAt;
              const recheckTs = recheckActivity ? new Date(recheckActivity).getTime() : 0;
              const stillIdle = (Date.now() - recheckTs) > IDLE_THRESHOLD_MS;

              if (stillIdle && !recheck?.toolCallsInFlight) {
                // Confirmed idle — send a status check prompt
                await this.connector.sendAgentMessage(task.gatewayId, task.sessionKey,
                  `[MISSION CONTROL STATUS CHECK]\nAre you finished with task "${task.name}" (ID: ${task.taskId})?\nReply with a brief status: DONE, IN_PROGRESS, or BLOCKED.`,
                  { taskId: task.taskId, type: 'status_check' }
                );
              } else {
                task.idleConfirmationPending = false; // Agent resumed, cancel
              }
            } catch (e) {
              task.idleConfirmationPending = false;
            }
          }, CONFIRMATION_DELAY_MS);
        }

        // Update task with latest session state
        task.lastSessionActivity = lastActivityTs;
        task.sessionTokensUsed = session.tokensUsed;

      } catch (e) {
        // sessions.get may fail if session was pruned — that itself indicates completion
        if (e.message?.includes('not found') || e.message?.includes('SESSION_NOT_FOUND')) {
          this._completeTask(taskId, 'Session ended (pruned)');
        }
      }
    }, IDLE_POLL_INTERVAL_MS);

    this._taskPollers.set(taskId, poller);
  }

  // ─── Gateway Event Handling ──────────────────────────────────────

  _handleGatewayEvent(event) {
    // Agent disconnection / stop — fail running tasks on that agent
    if (event.type === 'agent.disconnected' || event.type === 'agent_stopped') {
      for (const [taskId, task] of this.activeTasks) {
        if (task.gatewayId === event.gateway &&
            event.payload?.agentId && task.agentId === event.payload.agentId) {
          this._failTask(taskId, 'Agent disconnected during execution');
        }
      }
    }

    // Session ended events — check if any active task was using that session
    if (event.type === 'session.ended' && event.payload?.sessionKey) {
      for (const [taskId, task] of this.activeTasks) {
        if (task.sessionKey === event.payload.sessionKey) {
          // Session ended naturally — this likely means the agent finished
          this._completeTask(taskId, 'Session ended by agent');
        }
      }
    }

    // Session message events — look for explicit status responses
    if (event.type === 'session.message' && event.payload?.content) {
      const content = event.payload.content;
      for (const [taskId, task] of this.activeTasks) {
        if (task.sessionKey === event.payload.sessionKey && task.idleConfirmationPending) {
          // This is a response to our status check
          const upper = content.toUpperCase();
          if (upper.includes('DONE') || upper.includes('FINISHED') || upper.includes('COMPLETED')) {
            this._completeTask(taskId, content.slice(0, 2000));
          } else if (upper.includes('BLOCKED') || upper.includes('ERROR') || upper.includes('FAILED')) {
            this._failTask(taskId, `Agent reported: ${content.slice(0, 500)}`);
          } else {
            // Agent said IN_PROGRESS or something else — reset idle detection
            task.idleConfirmationPending = false;
            task.lastSessionActivity = Date.now();
          }
        }
      }
    }
  }

  // ─── Task Lifecycle ──────────────────────────────────────────────

  _completeTask(taskId, result) {
    const task = this.activeTasks.get(taskId);
    if (!task) return;

    this._cleanupTask(taskId);
    task.status = 'completed';
    task.completedAt = Date.now();

    if (this._stmts) {
      this._stmts.completeTask.run(result?.slice(0, 5000) || '', taskId);
    }

    this._log(task.gatewayId, task.agentId, 'task_completed',
      `Completed: ${task.name} (${Math.round((task.completedAt - task.startedAt) / 1000)}s)`);
    this.emit('task:completed', {
      taskId, agentId: task.agentId, gatewayId: task.gatewayId,
      duration: task.completedAt - task.startedAt,
      workplanId: task.workplanId,
    });
  }

  _failTask(taskId, reason) {
    const task = this.activeTasks.get(taskId);
    if (!task) return;

    task.retries++;

    if (task.retries < task.maxRetries) {
      this._cleanupTask(taskId);
      task.status = 'retrying';
      this._log(task.gatewayId, task.agentId, 'task_retrying',
        `Retrying (${task.retries}/${task.maxRetries}): ${reason}`);
      this.emit('task:retrying', { taskId, attempt: task.retries, reason });

      // Exponential backoff: 5s, 10s, 20s...
      const delay = 5000 * Math.pow(2, task.retries - 1);
      setTimeout(() => {
        if (!this.activeTasks.has(taskId)) {
          // Task was cancelled during the wait
          this.dispatch({
            id: taskId, name: task.name, instruction: task.instruction,
            priority: task.priority, retries: task.retries,
            maxRetries: task.maxRetries, timeoutMs: task.timeoutMs,
            workplanId: task.workplanId, phaseName: task.phaseName,
          }, task.agentId, task.gatewayId).catch(e => {
            this._permanentFail(taskId, task, `Retry failed: ${e.message}`);
          });
        }
      }, delay);
    } else {
      this._permanentFail(taskId, task, reason);
    }
  }

  _permanentFail(taskId, task, reason) {
    this._cleanupTask(taskId);
    if (!task) task = { gatewayId: null, agentId: null, name: taskId, retries: 0 };
    task.status = 'failed';

    if (this._stmts) {
      this._stmts.failTask.run(reason, task.retries, taskId);
    }

    this._log(task.gatewayId, task.agentId, 'task_failed',
      `Failed permanently: ${task.name} — ${reason}`);
    this.emit('task:failed', { taskId, reason, retries: task.retries, workplanId: task.workplanId });
  }

  _handleTimeout(taskId) {
    const task = this.activeTasks.get(taskId);
    if (!task) return;
    this._failTask(taskId, `TIMEOUT: exceeded ${Math.round(task.timeoutMs / 1000)}s limit`);
  }

  _cleanupTask(taskId) {
    const poller = this._taskPollers.get(taskId);
    if (poller) clearInterval(poller);
    this._taskPollers.delete(taskId);

    const timeout = this._taskTimeouts.get(taskId);
    if (timeout) clearTimeout(timeout);
    this._taskTimeouts.delete(taskId);

    this.activeTasks.delete(taskId);
  }

  // ─── Agent Selection ─────────────────────────────────────────────

  _selectLeastLoadedAgent(agents) {
    let best = null;
    let bestLoad = Infinity;

    for (const agent of agents) {
      const load = this._getAgentLoad(agent.id, agent.gateway);
      const max = agent.maxConcurrent || 5;
      if (load < max && load < bestLoad) {
        bestLoad = load;
        best = agent;
      }
    }
    return best;
  }

  _getAgentLoad(agentId, gatewayId) {
    let count = 0;
    for (const task of this.activeTasks.values()) {
      if (task.agentId === agentId && task.gatewayId === gatewayId && task.status === 'running') {
        count++;
      }
    }
    return count;
  }

  // ─── Message Building ────────────────────────────────────────────

  _buildMessage(task) {
    return [
      `## Task: ${task.name}`,
      task.priority === 'critical' ? '**Priority: CRITICAL — handle immediately**' : `Priority: ${task.priority}`,
      task.workplanName ? `Workplan: ${task.workplanName}` : null,
      task.phaseName ? `Phase: ${task.phaseName}` : null,
      '',
      '### Instructions',
      task.instruction,
      '',
      '### When done',
      'Complete all steps in the instructions above. If you encounter an error you cannot resolve after reasonable effort, describe the blocker clearly.',
    ].filter(Boolean).join('\n');
  }

  // ─── Logging ─────────────────────────────────────────────────────

  _log(gatewayId, agentId, type, message) {
    console.log(`[exec] [${type}] ${message}`);
    if (this._stmts) {
      try {
        this._stmts.logEvent.run(gatewayId, agentId, type, message, null);
      } catch (e) { /* non-fatal */ }
    }
    this.emit('log', { gatewayId, agentId, type, message, ts: Date.now() });
  }

  // ─── Status ──────────────────────────────────────────────────────

  getStatus() {
    const tasks = Array.from(this.activeTasks.values()).map(t => ({
      taskId: t.taskId, name: t.name, agentId: t.agentId,
      gatewayId: t.gatewayId, status: t.status,
      startedAt: t.startedAt, elapsed: Date.now() - t.startedAt,
      retries: t.retries, maxRetries: t.maxRetries,
      timeoutMs: t.timeoutMs, idleConfirmationPending: t.idleConfirmationPending,
      workplanId: t.workplanId, phaseName: t.phaseName,
    }));
    return {
      activeTasks: tasks,
      totalRunning: tasks.filter(t => t.status === 'running').length,
      totalRetrying: tasks.filter(t => t.status === 'retrying').length,
    };
  }

  destroy() {
    for (const [taskId] of this.activeTasks) this._cleanupTask(taskId);
  }
}

module.exports = { ExecutionEngine };
