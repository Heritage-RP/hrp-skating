/**
 * Héritage RP structured logs and traces — typed access to HrpLog / HrpTrace (hrp-metrics/lib/log.js).
 *
 * Canonical copy: hrp-metrics/lib/ts/log.ts. Each TypeScript resource keeps a copy in src/common/log.ts and
 * loads '@hrp-metrics/lib/log.js' before its bundle (scripts/build.js). Without that script (unit tests, NUI in
 * a browser) the logger falls back to the console, debug and trace dropped, and spans are no-ops.
 *
 *   import { log, trace } from '@common/log';
 *   log.info('config loaded');                                    // system (default)
 *   log.api.warn('GitHub poll failed', { status });               // api
 *   log.business.info('player revived', { source: src, target }); // business
 *   await trace.span('hunting.spawn', async (span) => { span.set('zone', zone); span.log.debug('picked'); }, { source: src });
 *
 * Levels: error, warn, info (default), debug, trace — raised for a while with `hrplog <resource|player:<id>> debug 30m`.
 */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

/**
 * system: technical life of the resource (start, configuration, database, internal errors) — the default.
 * api: exchanges with the outside (HTTP, callbacks client ↔ server, exports between resources).
 * business: what happens in the game (reports, revives, powers, creatures, staff actions…).
 */
export type LogCategory = 'system' | 'api' | 'business';

/** `source`: server id of the player the record is about. Errors are kept as {name, message, stack}. */
export type LogAttributes = { source?: number; category?: LogCategory } & Record<string, unknown>;

export interface Logger {
  error(msg: string | Error, attrs?: LogAttributes): void;
  warn(msg: string | Error, attrs?: LogAttributes): void;
  info(msg: string, attrs?: LogAttributes): void;
  debug(msg: string, attrs?: LogAttributes): void;
  trace(msg: string, attrs?: LogAttributes): void;
  /** Whether a record of `level` (about `player`) would be kept — guard costly messages. */
  enabled(level: LogLevel, player?: number): boolean;
  /** Logger whose records all carry `attrs`. */
  child(attrs: LogAttributes): Logger;
  /** The same logger, records in that category (`log.business.info(…)`); without one, records are `system`. */
  readonly system: Logger;
  readonly api: Logger;
  readonly business: Logger;
}

export type SpanKind = 'internal' | 'server' | 'client' | 'producer' | 'consumer';

export interface Span {
  /** False when the trace is not sampled: every method is then a no-op. */
  readonly sampled: boolean;
  /** W3C traceparent, to continue the trace in another resource (`parent`). */
  readonly traceparent: string | undefined;
  /** Logger whose records are tied to this span. */
  readonly log: Logger;
  set(key: string, value: unknown): Span;
  event(name: string, attrs?: LogAttributes): Span;
  finish(status?: 'ok' | 'error', message?: string): void;
  fail(err: unknown): void;
}

export interface SpanOptions {
  parent?: string | Span;
  source?: number;
  kind?: SpanKind;
  attrs?: LogAttributes;
}

export interface Tracer {
  start(name: string, opts?: SpanOptions): Span;
  /** Runs fn(span); a thrown error or a rejected promise fails the span and is passed on. */
  span<T>(name: string, fn: (span: Span) => T, opts?: SpanOptions): T;
}

const RANK: Record<LogLevel, number> = { error: 1, warn: 2, info: 3, debug: 4, trace: 5 };

const CATEGORIES: LogCategory[] = ['system', 'api', 'business'];

function consoleLogger(bound?: LogAttributes): Logger {
  const write = (level: LogLevel, msg: string | Error, attrs?: LogAttributes) => {
    if (RANK[level] > RANK.info) return;
    const all = bound ? { ...bound, ...attrs } : attrs;
    const text = `${level.toUpperCase()} ${msg instanceof Error ? msg.message : msg}${all ? ` ${JSON.stringify(all)}` : ''}`;
    if (level === 'error') console.error(text);
    else if (level === 'warn') console.warn(text);
    else console.log(text);
  };
  const self = {
    error: (msg, attrs) => write('error', msg, attrs),
    warn: (msg, attrs) => write('warn', msg, attrs),
    info: (msg, attrs) => write('info', msg, attrs),
    debug: (msg, attrs) => write('debug', msg, attrs),
    trace: (msg, attrs) => write('trace', msg, attrs),
    enabled: (level) => RANK[level] <= RANK.info,
    child: (attrs) => consoleLogger(bound ? { ...bound, ...attrs } : attrs),
  } as Logger;
  for (const category of CATEGORIES) {
    Object.defineProperty(self, category, { get: () => consoleLogger({ ...bound, category }) });
  }
  return self;
}

const fallbackLog = consoleLogger();

const noopSpan: Span = {
  sampled: false,
  traceparent: undefined,
  log: fallbackLog,
  set: () => noopSpan,
  event: () => noopSpan,
  finish: () => {},
  fail: () => {},
};

const fallbackTrace: Tracer = {
  start: () => noopSpan,
  span: (_name, fn) => fn(noopSpan),
};

const runtime = globalThis as { HrpLog?: Logger; HrpTrace?: Tracer };

export const log: Logger = runtime.HrpLog ?? fallbackLog;
export const trace: Tracer = runtime.HrpTrace ?? fallbackTrace;
