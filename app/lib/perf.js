const CONDITIONS = ['off', 'cold', 'warm'];
const CONDITION_NAMES = { off: 'No cache', cold: 'Cold cache', warm: 'Warm cache' };
const METRICS = ['throughput', 'p50', 'p95', 'p99', 'p99.9', 'mean', 'hit_ratio'];
const SETTING_FIELDS = [
  'redis_maxmemory', 'redis_policy', 'redis_appendfsync',
  'mysql_buffer_pool', 'mysql_max_connections', 'mysql_general_log',
];
const BASELINE = 'base';

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const [header = [], ...body] = rows;
  return body
    .filter((values) => values.length === header.length)
    .map((values) => Object.fromEntries(header.map((name, i) => [name, values[i]])));
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function summarize(values) {
  const numbers = values.filter((v) => v !== '' && v != null).map(Number).filter(Number.isFinite);
  if (!numbers.length) return null;
  return { median: median(numbers), min: Math.min(...numbers), max: Math.max(...numbers), n: numbers.length };
}

const isNoiseCheck = (label) => label.startsWith('recheck');
const groupKey = (label, workers, condition) => `${label}|${workers}|${condition}`;

function percentChange(from, to) {
  return from ? ((to - from) / from) * 100 : null;
}

function compare(base, other) {
  if (!base || !other) return null;
  const a = base.throughput;
  const b = other.throughput;
  const separated = a.n > 1 && b.n > 1 && (b.max < a.min || b.min > a.max);
  return {
    base,
    other,
    throughput: percentChange(a.median, b.median),
    p50: percentChange(base.p50.median, other.p50.median),
    p99: percentChange(base.p99.median, other.p99.median),
    significant: a.n > 1 && b.n > 1 ? separated : null,
  };
}

function report(runs, query = {}) {
  const groups = new Map();
  const labels = [];
  const workerSet = new Set();
  const settings = new Map();

  for (const run of runs) {
    const workers = Number(run.workers);
    const key = groupKey(run.label, workers, run.condition);
    if (!labels.includes(run.label)) labels.push(run.label);
    workerSet.add(workers);
    if (!groups.has(key)) groups.set(key, { label: run.label, workers, condition: run.condition, runs: [] });
    groups.get(key).runs.push(run);

    const snapshot = SETTING_FIELDS.map((field) => run[field]).join('|');
    if (!settings.has(`${run.label}|${snapshot}`)) {
      settings.set(`${run.label}|${snapshot}`, { label: run.label, ...Object.fromEntries(SETTING_FIELDS.map((f) => [f, run[f]])) });
    }
  }

  for (const group of groups.values()) {
    for (const metric of METRICS) group[metric] = summarize(group.runs.map((run) => run[metric]));
    group.requests = group.runs.reduce((sum, run) => sum + Number(run.requests || 0), 0);
    group.errors = group.runs.reduce((sum, run) => sum + Number(run.errors || 0), 0);
    group.duration = group.runs[0].duration;
    group.n = group.runs.length;
  }

  const workers = [...workerSet].sort((a, b) => a - b);
  const conditions = CONDITIONS.filter((c) => [...groups.values()].some((g) => g.condition === c));
  const treatments = labels.filter((label) => label !== BASELINE && !isNoiseCheck(label));
  const compareLabel = labels.includes(String(query.compare)) && query.compare !== BASELINE
    ? String(query.compare)
    : treatments[0] || labels.find((label) => label !== BASELINE) || null;
  const selectedWorkers = workers.includes(Number(query.workers)) ? Number(query.workers) : workers[0];
  const group = (label, w, c) => groups.get(groupKey(label, w, c)) || null;

  const comparisons = (label) => workers.flatMap((w) => conditions
    .map((c) => ({ workers: w, condition: c, ...compare(group(BASELINE, w, c), group(label, w, c)) }))
    .filter((row) => row.base));

  return {
    runCount: runs.length,
    labels,
    chartLabels: labels.filter((label) => !isNoiseCheck(label)),
    noiseLabels: labels.filter(isNoiseCheck),
    workers,
    conditions,
    groups: [...groups.values()],
    group,
    baseline: BASELINE,
    compareLabel,
    selectedWorkers,
    comparisons: compareLabel ? comparisons(compareLabel) : [],
    noise: labels.filter(isNoiseCheck).map((label) => ({ label, rows: comparisons(label) })),
    settings: [...settings.values()],
    latest: runs.length ? runs[runs.length - 1].time : null,
  };
}

module.exports = { parseCsv, report, CONDITIONS, CONDITION_NAMES, SETTING_FIELDS };
