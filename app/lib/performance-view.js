const { layout, escape } = require('./views');
const { barChart, PALETTE } = require('./charts');
const { CONDITION_NAMES, SETTING_FIELDS } = require('./perf');

const rps = (v) => Math.round(v).toLocaleString('en-US');
const ms = (v) => v.toFixed(2);
const pct = (v) => `${(v * 100).toFixed(1)}%`;
const signed = (v) => (v == null ? '&mdash;' : `${v > 0 ? '+' : v < 0 ? '&minus;' : ''}${Math.abs(v).toFixed(1)}%`);
const range = (s, f) => (s ? `${f(s.median)}${s.n > 1 ? ` <span class="range">(${f(s.min)}&ndash;${f(s.max)})</span>` : ''}` : '&mdash;');

const SETTING_NAMES = {
  redis_maxmemory: 'Redis maxmemory',
  redis_policy: 'Redis maxmemory-policy',
  redis_appendfsync: 'Redis appendfsync',
  mysql_buffer_pool: 'MySQL innodb_buffer_pool_size',
  mysql_max_connections: 'MySQL max_connections',
  mysql_general_log: 'MySQL general_log',
};

function verdict(significant) {
  if (significant === true) return '<span class="pill pill-shipped">significant</span>';
  if (significant === false) return '<span class="pill">ranges overlap</span>';
  return '<span class="pill">single run</span>';
}

function link(r, params) {
  const query = new URLSearchParams({ workers: r.selectedWorkers });
  if (r.compareLabel) query.set('compare', r.compareLabel);
  for (const [key, value] of Object.entries(params)) query.set(key, value);
  return `/performance?${query}`;
}

function selectors(r) {
  const workers = r.workers
    .map((w) => `<a class="chip${w === r.selectedWorkers ? ' active' : ''}" href="${escape(link(r, { workers: w }))}">${w} workers</a>`)
    .join('');
  const labels = r.labels
    .filter((label) => label !== r.baseline)
    .map((label) => `<a class="chip${label === r.compareLabel ? ' active' : ''}" href="${escape(link(r, { compare: label }))}">${escape(label)}</a>`)
    .join('');
  return `<div class="selectors">
  <div><span class="selector-label">Workers</span>${workers}</div>
  ${labels ? `<div><span class="selector-label">Compare base with</span>${labels}</div>` : ''}
</div>`;
}

function headline(r) {
  const w = r.selectedWorkers;
  const off = r.group(r.baseline, w, 'off');
  const warm = r.group(r.baseline, w, 'warm');
  const cards = [];

  if (off && warm) {
    cards.push(`<div class="stat">
  <span class="stat-label">Redis speed-up, base settings</span>
  <span class="stat-value">${(warm.throughput.median / off.throughput.median).toFixed(2)}&times;</span>
  <span class="stat-note">${rps(off.throughput.median)} &rarr; ${rps(warm.throughput.median)} req/s, no cache vs warm cache</span>
</div>`);
  }

  for (const row of r.comparisons.filter((c) => c.workers === w)) {
    cards.push(`<div class="stat${row.significant ? ' stat-strong' : ''}">
  <span class="stat-label">${escape(CONDITION_NAMES[row.condition])}: ${escape(r.compareLabel)}</span>
  <span class="stat-value">${signed(row.throughput)}</span>
  <span class="stat-note">throughput &middot; p50 ${signed(row.p50)} &middot; p99 ${signed(row.p99)} &middot; ${verdict(row.significant)}</span>
</div>`);
  }

  return cards.length ? `<div class="stats">${cards.join('')}</div>` : '';
}

function throughputChart(r) {
  const series = r.chartLabels.map((label, i) => ({ name: label, color: PALETTE[i % PALETTE.length] }));
  const groups = r.workers.flatMap((w) => r.conditions.map((c) => ({
    name: CONDITION_NAMES[c],
    sub: `${w} workers`,
    bars: Object.fromEntries(r.chartLabels
      .map((label) => [label, r.group(label, w, c)])
      .filter(([, g]) => g)
      .map(([label, g]) => [label, { value: g.throughput.median, min: g.throughput.min, max: g.throughput.max }])),
  }))).filter((g) => Object.keys(g.bars).length);

  return barChart({
    title: 'Throughput, median of repeats (whiskers show lowest to highest run)',
    groups,
    series,
    unit: 'requests / s',
    format: (v) => (v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k` : v.toFixed(0)),
  });
}

function latencyChart(r) {
  const w = r.selectedWorkers;
  const labels = [r.baseline, r.compareLabel].filter(Boolean);
  const groups = r.conditions.flatMap((c) => labels.map((label) => {
    const g = r.group(label, w, c);
    return g && {
      name: CONDITION_NAMES[c],
      sub: label,
      bars: { p50: { value: g.p50.median }, p95: { value: g.p95.median }, p99: { value: g.p99.median } },
    };
  })).filter(Boolean);

  return barChart({
    title: `Response time percentiles at ${w} workers (median of repeats)`,
    groups,
    series: [{ name: 'p50', color: '#6f8fb3' }, { name: 'p95', color: '#d9a33f' }, { name: 'p99', color: '#d93f3f' }],
    unit: 'milliseconds',
    format: ms,
    height: 280,
  });
}

function comparisonTable(r) {
  if (!r.comparisons.length) return '<p class="empty">Run a second label to compare it with the base tests.</p>';
  const rows = r.comparisons.map((c) => `<tr${c.significant ? ' class="row-strong"' : ''}>
  <td class="num">${c.workers}</td>
  <td>${escape(CONDITION_NAMES[c.condition])}</td>
  <td class="num">${range(c.base.throughput, rps)}</td>
  <td class="num">${range(c.other.throughput, rps)}</td>
  <td class="num"><strong>${signed(c.throughput)}</strong></td>
  <td class="num">${signed(c.p50)}</td>
  <td class="num">${signed(c.p99)}</td>
  <td>${verdict(c.significant)}</td>
</tr>`).join('');

  return `<div class="table-scroll"><table class="table">
  <thead><tr><th class="num">Workers</th><th>Measurement</th><th class="num">${escape(r.baseline)} req/s</th><th class="num">${escape(r.compareLabel)} req/s</th><th class="num">Throughput</th><th class="num">p50</th><th class="num">p99</th><th>Lowest&ndash;highest ranges</th></tr></thead>
  <tbody>${rows}</tbody>
</table></div>`;
}

function hitMeter(group) {
  if (group.condition === 'off' || !group.hit_ratio) return '&mdash;';
  return `<span class="meter"><span style="width:${(group.hit_ratio.median * 100).toFixed(1)}%"></span></span> ${pct(group.hit_ratio.median)}`;
}

function resultsTable(r) {
  const order = (g) => [r.labels.indexOf(g.label), g.workers, ['off', 'cold', 'warm'].indexOf(g.condition)];
  const sorted = [...r.groups].sort((a, b) => {
    const [x, y] = [order(a), order(b)];
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  });
  const rows = sorted.map((g) => `<tr>
  <td>${escape(g.label)}</td>
  <td class="num">${g.workers}</td>
  <td>${escape(CONDITION_NAMES[g.condition] || g.condition)}</td>
  <td class="num">${g.n}</td>
  <td class="num">${escape(g.duration)}</td>
  <td class="num">${range(g.throughput, rps)}</td>
  <td class="num">${range(g.p50, ms)}</td>
  <td class="num">${range(g.p95, ms)}</td>
  <td class="num">${range(g.p99, ms)}</td>
  <td class="num">${range(g['p99.9'], ms)}</td>
  <td class="num nowrap">${hitMeter(g)}</td>
  <td class="num${g.errors ? ' bad' : ''}">${g.errors}</td>
</tr>`).join('');

  return `<div class="table-scroll"><table class="table table-compact">
  <thead><tr><th>Label</th><th class="num">Workers</th><th>Measurement</th><th class="num">Runs</th><th class="num">Seconds</th><th class="num">Requests/s</th><th class="num">p50</th><th class="num">p95</th><th class="num">p99</th><th class="num">p99.9</th><th class="num">Hit ratio</th><th class="num">Errors</th></tr></thead>
  <tbody>${rows}</tbody>
</table></div>`;
}

function noiseSection(r) {
  if (!r.noise.length) return '';
  const rows = r.noise.flatMap(({ label, rows: list }) => list.map((c) => `<tr>
  <td>${escape(label)}</td>
  <td class="num">${c.workers}</td>
  <td>${escape(CONDITION_NAMES[c.condition])}</td>
  <td class="num">${range(c.base.throughput, rps)}</td>
  <td class="num">${range(c.other.throughput, rps)}</td>
  <td class="num">${signed(c.throughput)}</td>
</tr>`)).join('');

  return `<section class="card">
  <h2>Noise check</h2>
  <p class="hint">These runs repeat the base settings with nothing changed. Their spread is the run-to-run noise of this machine, so any difference smaller than this cannot be credited to a parameter.</p>
  <div class="table-scroll"><table class="table table-compact">
    <thead><tr><th>Label</th><th class="num">Workers</th><th>Measurement</th><th class="num">base req/s</th><th class="num">re-check req/s</th><th class="num">Change</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
</section>`;
}

function settingsTable(r) {
  const rows = r.settings.map((s) => `<tr><td>${escape(s.label)}</td>${SETTING_FIELDS.map((f) => `<td>${escape(s[f])}</td>`).join('')}</tr>`).join('');
  return `<div class="table-scroll"><table class="table table-compact">
  <thead><tr><th>Label</th>${SETTING_FIELDS.map((f) => `<th>${escape(SETTING_NAMES[f])}</th>`).join('')}</tr></thead>
  <tbody>${rows}</tbody>
</table></div>`;
}

const QUERIES = [
  {
    name: 'Orders in a date range',
    key: 'orders:&lt;start&gt;:&lt;end&gt;',
    ttl: '300 s',
    sql: `SELECT o.orderNumber, o.orderDate, o.status, c.customerName
FROM orders o JOIN customers c USING (customerNumber)
WHERE o.orderDate BETWEEN ? AND ?
ORDER BY o.orderDate, o.orderNumber`,
  },
  {
    name: 'One customer\u2019s orders in a date range',
    key: 'orders:&lt;customer&gt;:&lt;start&gt;:&lt;end&gt;',
    ttl: '300 s',
    sql: `SELECT o.orderNumber, o.orderDate, o.status, c.customerName
FROM orders o JOIN customers c USING (customerNumber)
WHERE o.orderDate BETWEEN ? AND ? AND o.customerNumber = ?
ORDER BY o.orderDate, o.orderNumber`,
  },
  {
    name: 'One order\u2019s line items',
    key: 'details:&lt;order&gt;',
    ttl: '3600 s',
    sql: `SELECT p.productName, d.quantityOrdered, d.priceEach,
       d.quantityOrdered * d.priceEach AS lineTotal
FROM orderdetails d JOIN products p USING (productCode)
WHERE d.orderNumber = ?
ORDER BY d.orderLineNumber`,
  },
];

function queriesSection() {
  return `<section class="card">
  <h2>The queries under load</h2>
  <p class="hint">The benchmark sends about 776 different requests built from these three Project 3 queries, with Zipf popularity (the top 10 keys get about 40% of requests). Each answer is cached with cache-aside: look the key up in Redis; on a miss, ask MySQL as the read-only <code>cs_wkr</code> user and store the answer with a TTL.</p>
  <div class="query-grid">${QUERIES.map((q) => `<div class="query">
    <h3>${q.name}</h3>
    <p class="code">key ${q.key} &middot; TTL ${q.ttl}</p>
    <pre>${escape(q.sql)}</pre>
  </div>`).join('')}</div>
</section>`;
}

function liveSection(bounds) {
  return `<section class="card">
  <h2>Try the cache live</h2>
  <p class="hint">Runs the order search on this server and reports who answered. The first request for a range is a MISS (MySQL, then stored); repeat it for a HIT from Redis. Times cover the cache and database step only.</p>
  <form id="live-form" class="field-row live-form">
    <div class="field"><label for="live-start">Start</label><input type="date" id="live-start" value="${escape(bounds.earliest)}" min="${escape(bounds.earliest)}" max="${escape(bounds.latest)}" required></div>
    <div class="field"><label for="live-end">End</label><input type="date" id="live-end" value="${escape(bounds.latest)}" min="${escape(bounds.earliest)}" max="${escape(bounds.latest)}" required></div>
    <div class="field field-actions">
      <label class="check"><input type="checkbox" id="live-nocache"> Skip cache</label>
      <button class="btn" type="submit">Run query</button>
    </div>
  </form>
  <div class="table-scroll"><table class="table table-compact" id="live-table" hidden>
    <thead><tr><th>#</th><th>Range</th><th>Answered by</th><th class="num">Query ms</th><th class="num">Orders</th><th>Key</th></tr></thead>
    <tbody></tbody>
  </table></div>
</section>
<script>
(function () {
  var form = document.getElementById('live-form');
  var table = document.getElementById('live-table');
  var count = 0;
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var params = new URLSearchParams({ start: form.querySelector('#live-start').value, end: form.querySelector('#live-end').value, format: 'json' });
    if (form.querySelector('#live-nocache').checked) params.set('nocache', '1');
    fetch('/orders/orders-by-date/results?' + params).then(function (r) { return r.json(); }).then(function (data) {
      var row = table.tBodies[0].insertRow(0);
      var who = data.cache ? data.cache.status : 'ERROR';
      var cells = [++count, params.get('start') + ' to ' + params.get('end'), who, data.cache ? data.cache.ms.toFixed(2) : '', data.count != null ? data.count : data.error, data.cache ? data.cache.key : ''];
      cells.forEach(function (value, i) {
        var cell = row.insertCell();
        cell.textContent = value;
        if (i === 3 || i === 4) cell.className = 'num';
        if (i === 2) cell.innerHTML = '<span class="pill pill-cache-' + who.toLowerCase() + '">' + who + '</span>';
      });
      table.hidden = false;
    });
  });
})();
</script>`;
}

function methodSection(r) {
  return `<section class="card">
  <h2>How the numbers were produced</h2>
  <ul class="method">
    <li>Load generator: the course <code>bench.py</code>, unchanged. It starts and stops the course <code>app.js</code> (Node.js, Redis cache-aside in front of MySQL 8.0) and sends requests from N worker processes, each with one kept-open connection, as fast as answers return.</li>
    <li>Three measurements, interleaved within each repeat: <strong>no cache</strong> (<code>USE_CACHE=0</code>, every request reaches MySQL), <strong>cold cache</strong> (Redis emptied just before measuring), <strong>warm cache</strong> (every key loaded first).</li>
    <li>Each run: 2 s warm-up, then 30 s measured. Each row is the median of its repeats, with the lowest and highest run in brackets. A difference is called significant only when those ranges do not overlap.</li>
    <li>Machine: Apple M-series laptop, 10 CPUs, Docker Desktop, course container <code>cse6332-course</code>, on AC power. Compare labels only at the same worker count.</li>
    <li>The parameter is changed while everything runs (<code>SET GLOBAL</code> or <code>CONFIG SET</code>) and set back afterwards; the settings table above records what each label really ran with.</li>
  </ul>
  <p><a class="btn btn-secondary" href="/performance/runs.csv">Download all ${r.runCount} runs (CSV)</a></p>
</section>`;
}

function labPanel(lab) {
  const settingRows = lab.settings.map((s) => {
    const input = s.values
      ? `<select name="value">${s.values.map((v) => `<option${v === s.value ? ' selected' : ''}>${escape(v)}</option>`).join('')}</select>`
      : `<input name="value" value="${escape(s.value)}" inputmode="numeric" pattern="[0-9]+">`;
    return `<tr${s.value !== s.default ? ' class="row-strong"' : ''}>
  <td><code>${escape(s.name)}</code></td>
  <td>${escape(s.server)}</td>
  <td><strong>${escape(s.value)}</strong></td>
  <td class="muted">${escape(s.default)}</td>
  <td><form method="POST" action="/lab/settings" class="inline-form"><input type="hidden" name="name" value="${escape(s.name)}">${input}<button class="btn btn-small" type="submit"${lab.job.running ? ' disabled' : ''}>Set</button></form></td>
</tr>`;
  }).join('');

  const job = lab.job;
  const log = job.log.length ? escape(job.log.join('\n')) : 'No run started yet.';
  const status = job.running
    ? `<span class="pill pill-cache-miss">running</span> ${escape(job.label)} since ${escape(job.startedAt)}`
    : job.exitCode == null ? '<span class="pill">idle</span>' : `<span class="pill ${job.exitCode === 0 ? 'pill-shipped' : 'pill-cancelled'}">finished, exit ${job.exitCode}</span> ${escape(job.label)}`;

  return `<section class="card lab">
  <h2>Lab controls <span class="pill">local only</span></h2>
  ${lab.message ? `<p class="flash">${escape(lab.message)}</p>` : ''}
  <p class="hint">Talks to the course container <code>${escape(lab.container)}</code>. Results are read from <code>${escape(lab.resultsFile)}</code>. Change one setting, run the measurements it can affect, then set it back.</p>

  <h3>1. Settings</h3>
  <div class="table-scroll"><table class="table table-compact">
    <thead><tr><th>Parameter</th><th>Server</th><th>Now</th><th>Default</th><th>Change</th></tr></thead>
    <tbody>${settingRows}</tbody>
  </table></div>
  <form method="POST" action="/lab/reset"><button class="btn btn-secondary btn-small" type="submit"${job.running ? ' disabled' : ''}>Put every setting back to its default</button></form>

  <h3>2. Run the load test</h3>
  <form method="POST" action="/lab/run" class="lab-run">
    <div class="field-row">
      <div class="field"><label for="label">Label</label><input id="label" name="label" required pattern="[A-Za-z0-9=._:+\\-]{1,40}" value="${escape(lab.suggestedLabel)}"></div>
      <div class="field"><label for="workers">Workers</label><input id="workers" name="workers" required pattern="[0-9]{1,2}(,[0-9]{1,2})*" value="10"></div>
      <div class="field"><label for="duration">Seconds per run</label><input id="duration" name="duration" type="number" min="5" max="120" value="30"></div>
      <div class="field"><label for="repeats">Repeats</label><input id="repeats" name="repeats" type="number" min="1" max="5" value="3"></div>
    </div>
    <div class="field-row checks">
      <label class="check"><input type="checkbox" name="conditions" value="off" checked> No cache</label>
      <label class="check"><input type="checkbox" name="conditions" value="cold" checked> Cold cache</label>
      <label class="check"><input type="checkbox" name="conditions" value="warm" checked> Warm cache</label>
    </div>
    <p class="hint">Each run takes its duration plus about 4.5 s. The defaults (10 workers, 30 s, 3 repeats, all three measurements) take about 5 minutes. Leave the computer alone while it runs.</p>
    <button class="btn" type="submit"${job.running ? ' disabled' : ''}>Start run</button>
  </form>

  <h3>3. Progress</h3>
  <p id="lab-status">${status}</p>
  <pre class="log" id="lab-log">${log}</pre>

  <h3>4. Publish</h3>
  <form method="POST" action="/lab/publish"><button class="btn btn-secondary btn-small" type="submit"${job.running ? ' disabled' : ''}>Copy results into the site (app/data/runs.csv)</button></form>
  <p class="hint">Then commit and push; the public page reads that file.</p>
</section>
${job.running ? `<script>
(function () {
  var log = document.getElementById('lab-log');
  var timer = setInterval(function () {
    fetch('/lab/status').then(function (r) { return r.json(); }).then(function (job) {
      log.textContent = job.log.join('\\n');
      log.scrollTop = log.scrollHeight;
      if (!job.running) { clearInterval(timer); location.reload(); }
    });
  }, 3000);
})();
</script>` : ''}`;
}

function render({ report: r, bounds, live = false, lab = null, nav }) {
  const empty = !r.runCount;
  const body = `${lab ? labPanel(lab) : ''}
${empty ? '<section class="card"><p class="empty">No benchmark results yet.</p></section>' : `<section class="card">
  <h2>Findings at a glance</h2>
  ${selectors(r)}
  ${headline(r)}
</section>

<section class="card">
  <h2>Throughput</h2>
  ${throughputChart(r)}
  <h2>Response time</h2>
  ${latencyChart(r)}
</section>

<section class="card">
  <h2>${escape(r.baseline)} vs ${escape(r.compareLabel || '')}</h2>
  <p class="hint">Warm-cache requests are all answered by Redis and never reach MySQL, so a MySQL setting cannot change them: that row is the control. A warm-cache difference shows how far this machine drifts on its own; compare it with the noise check before crediting any difference to the parameter.</p>
  ${comparisonTable(r)}
</section>

${noiseSection(r)}

<section class="card">
  <h2>All results</h2>
  <p class="hint">Median over repeats, lowest&ndash;highest in brackets, times in milliseconds. ${r.runCount} measured runs${r.latest ? `, latest ${escape(r.latest)} UTC` : ''}.</p>
  ${resultsTable(r)}
  <h2>Settings each label ran with</h2>
  ${settingsTable(r)}
</section>`}

${queriesSection()}
${live && bounds ? liveSection(bounds) : ''}
${empty ? '' : methodSection(r)}`;

  return layout({
    title: 'Cache Performance',
    heading: 'Redis Cache Performance',
    subtitle: 'Project 4: the Project 3 order queries under load, with and without Redis, and the effect of one MySQL setting.',
    section: 'performance',
    wide: true,
    nav,
    body,
  });
}

module.exports = { render };
