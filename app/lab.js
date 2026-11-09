const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const express = require('express');
const perf = require('./lib/perf');
const performanceView = require('./lib/performance-view');

const PORT = Number(process.env.LAB_PORT || 8090);
const CONTAINER = process.env.COURSE_CONTAINER || 'cse6332-course';
const COURSE_DIR = process.env.COURSE_DIR || path.resolve(__dirname, '../../coursecontainer');
const RESULTS_FILE = path.join(COURSE_DIR, 'data/p4/results/runs.csv');
const PUBLISHED_FILE = path.join(__dirname, 'data/runs.csv');
const DB_PASS = process.env.DB_PASS;

if (!DB_PASS) {
  console.error('Set DB_PASS to the cs_wkr password of the course container, e.g. DB_PASS=... npm run lab');
  process.exit(1);
}

const SETTINGS = [
  { name: 'general_log', server: 'MySQL', values: ['OFF', 'ON'], default: 'OFF' },
  { name: 'max_connections', server: 'MySQL', pattern: /^\d{1,5}$/, default: '151' },
  { name: 'appendfsync', server: 'Redis', values: ['always', 'everysec', 'no'], default: 'everysec' },
  { name: 'hz', server: 'Redis', pattern: /^\d{1,3}$/, default: '10' },
  { name: 'maxmemory-samples', server: 'Redis', pattern: /^\d{1,2}$/, default: '5' },
];

const job = { running: false, label: null, startedAt: null, exitCode: null, log: [] };

function docker(args) {
  return new Promise((resolve, reject) => {
    execFile('docker', ['exec', CONTAINER, ...args], { timeout: 15000 }, (error, stdout, stderr) => {
      if (error) reject(new Error((stderr || error.message).trim()));
      else resolve(stdout.trim());
    });
  });
}

async function readSettings() {
  const [log, conns] = (await docker(['mysql', '-uroot', '-N', '-B', '-e', 'SELECT @@general_log, @@max_connections'])).split('\t');
  const redis = {};
  for (const name of ['appendfsync', 'hz', 'maxmemory-samples']) {
    redis[name] = (await docker(['redis-cli', 'CONFIG', 'GET', name])).split('\n')[1];
  }
  const now = { general_log: log === '1' ? 'ON' : 'OFF', max_connections: conns, ...redis };
  return SETTINGS.map((s) => ({ ...s, value: now[s.name] }));
}

function valid(setting, value) {
  return setting.values ? setting.values.includes(value) : setting.pattern.test(value) && Number(value) > 0;
}

function applySetting(setting, value) {
  if (setting.server === 'MySQL') return docker(['mysql', '-uroot', '-e', `SET GLOBAL ${setting.name} = ${value}`]);
  return docker(['redis-cli', 'CONFIG', 'SET', setting.name, value]);
}

function startRun({ label, workers, duration, repeats, conditions }) {
  const args = ['exec', '-w', '/data/p4', '-e', `DB_PASS=${DB_PASS}`, CONTAINER, 'python3', '-u', 'bench.py', 'node',
    '--label', label, '--workers', workers, '--duration', String(duration), '--repeats', String(repeats),
    '--conditions', conditions.join(',')];
  Object.assign(job, { running: true, label, startedAt: new Date().toLocaleTimeString(), exitCode: null, log: [] });

  const child = spawn('docker', args);
  let buffer = '';
  const collect = (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop();
    job.log.push(...lines.filter((line) => !line.startsWith('|') && /^\[|WARNING|Settings:|keys;|Saved|Error|Traceback|Something|The app/.test(line)));
    job.log = job.log.slice(-200);
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  child.on('close', (code) => {
    if (buffer) collect('\n');
    Object.assign(job, { running: false, exitCode: code });
  });
}

function back(res, message) {
  res.redirect(303, `/performance${message ? `?msg=${encodeURIComponent(message)}` : ''}`);
}

const app = express();
app.disable('x-powered-by');
app.use(express.urlencoded({ extended: false }));
app.use('/css', express.static(path.join(__dirname, 'public/css')));

app.get('/', (req, res) => res.redirect('/performance'));

app.get('/performance', async (req, res, next) => {
  try {
    const text = fs.existsSync(RESULTS_FILE) ? await fs.promises.readFile(RESULTS_FILE, 'utf8') : '';
    const settings = await readSettings();
    const changed = settings.filter((s) => s.value !== s.default);
    res.type('html').send(performanceView.render({
      report: perf.report(perf.parseCsv(text), req.query),
      nav: [{ href: '/performance', label: 'Cache Performance Lab', section: 'performance' }],
      lab: {
        container: CONTAINER,
        resultsFile: path.relative(path.resolve(__dirname, '..', '..'), RESULTS_FILE),
        settings,
        job,
        message: String(req.query.msg || ''),
        suggestedLabel: changed.length ? changed.map((s) => `${s.name}=${s.value}`).join('+') : 'base',
      },
    }));
  } catch (error) {
    next(error);
  }
});

app.get('/performance/runs.csv', (req, res) => {
  res.type('text/csv');
  res.sendFile(RESULTS_FILE);
});

app.get('/lab/status', (req, res) => res.json(job));

app.post('/lab/settings', async (req, res, next) => {
  try {
    const setting = SETTINGS.find((s) => s.name === req.body.name);
    const value = String(req.body.value || '').trim();
    if (job.running) return back(res, 'Wait for the current run to finish.');
    if (!setting || !valid(setting, value)) return back(res, 'That setting or value is not allowed.');
    await applySetting(setting, value);
    back(res, `${setting.name} set to ${value}.`);
  } catch (error) {
    next(error);
  }
});

app.post('/lab/reset', async (req, res, next) => {
  try {
    if (job.running) return back(res, 'Wait for the current run to finish.');
    for (const setting of SETTINGS) await applySetting(setting, setting.default);
    back(res, 'Every setting is back to its default.');
  } catch (error) {
    next(error);
  }
});

app.post('/lab/run', (req, res) => {
  if (job.running) return back(res, 'A run is already in progress.');
  const label = String(req.body.label || '').trim();
  const workers = String(req.body.workers || '').trim();
  const duration = Number(req.body.duration);
  const repeats = Number(req.body.repeats);
  const conditions = [].concat(req.body.conditions || []).filter((c) => perf.CONDITIONS.includes(c));
  const workerList = workers.split(',').map(Number);

  if (!/^[A-Za-z0-9=._:+-]{1,40}$/.test(label)) return back(res, 'Labels may use letters, digits and = . _ : + - (up to 40).');
  if (!/^\d{1,2}(,\d{1,2})*$/.test(workers) || workerList.some((w) => w < 1 || w > 64)) return back(res, 'Workers must be numbers from 1 to 64, separated by commas.');
  if (!Number.isInteger(duration) || duration < 5 || duration > 120) return back(res, 'Seconds per run must be 5 to 120.');
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 5) return back(res, 'Repeats must be 1 to 5.');
  if (!conditions.length) return back(res, 'Pick at least one measurement.');

  startRun({ label, workers, duration, repeats, conditions });
  const minutes = (repeats * conditions.length * workerList.length * (duration + 4.5)) / 60;
  back(res, `Started "${label}": about ${Math.max(1, Math.round(minutes))} minute(s).`);
});

app.post('/lab/publish', async (req, res, next) => {
  try {
    if (!fs.existsSync(RESULTS_FILE)) return back(res, 'There are no results to publish yet.');
    await fs.promises.mkdir(path.dirname(PUBLISHED_FILE), { recursive: true });
    await fs.promises.copyFile(RESULTS_FILE, PUBLISHED_FILE);
    back(res, 'Copied into app/data/runs.csv. Commit and push to update the public page.');
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).type('text/plain').send(`Lab error: ${error.message}\nIs Docker running and is ${CONTAINER} up?`);
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`lab on http://127.0.0.1:${PORT}/performance (container ${CONTAINER})`);
});
