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

const LOG_LABEL = 'general_log=ON';

function explain(html) {
  return `<div class="explain">${html}</div>`;
}

function change(from, to) {
  return ((to - from) / from) * 100;
}

function shortVersion(r) {
  const w0 = r.workers[0];
  const off = r.group(r.baseline, w0, 'off');
  const warm = r.group(r.baseline, w0, 'warm');
  const logged = r.workers
    .map((w) => ({ w, base: r.group(r.baseline, w, 'off'), log: r.group(LOG_LABEL, w, 'off') }))
    .filter((x) => x.base && x.log)
    .map((x) => ({ w: x.w, drop: -change(x.base.throughput.median, x.log.throughput.median) }));
  const points = [];

  if (off && warm) {
    points.push(`<li><strong>Redis makes the site about ${(warm.throughput.median / off.throughput.median).toFixed(1)}&times; faster.</strong> With no cache, every request goes to MySQL: ${rps(off.throughput.median)} requests per second with ${w0} users. With Redis answering, ${rps(warm.throughput.median)} per second.</li>`);
  }
  if (logged.length) {
    const drops = logged.map((x) => x.drop);
    points.push('<li><strong>We tested one MySQL setting, <code>general_log</code>.</strong> When it is on, MySQL writes every query it receives into a log file, like a diary of every request.</li>');
    points.push(`<li><strong>With no cache, that logging slows the site down ${Math.min(...drops).toFixed(1)}&ndash;${Math.max(...drops).toFixed(1)}%.</strong> More users at once makes it worse: ${logged.map((x) => `${x.drop.toFixed(1)}% at ${x.w} users`).join(', ')}.</li>`);
    points.push('<li><strong>With the cache on, logging barely matters.</strong> Redis answers almost every request, so MySQL has almost nothing to write down. What changes are left are within the roughly 10% this laptop varies on its own.</li>');
    points.push('<li><strong>Takeaway:</strong> a cache does more than make a site fast. It also shields users from slow work inside the database, such as logging. Where requests are not cached, that work costs the most.</li>');
  }
  if (!points.length) return '';

  return `<section class="card">
  <h2>The short version</h2>
  <ol class="story">${points.join('')}</ol>
  <details class="glossary">
    <summary>Words used on this page</summary>
    <dl>
      <dt>User (worker)</dt><dd>One simulated person sending requests back to back, as fast as the site answers.</dd>
      <dt>Throughput</dt><dd>Requests the site answers per second. Higher is better.</dd>
      <dt>Response time: p50, p95, p99</dt><dd>How long one request takes. p50 is the typical request, p95 the slowest 1 in 20, p99 the slowest 1 in 100. Lower is better.</dd>
      <dt>No / cold / warm cache</dt><dd>Redis off; Redis on but empty at the start; Redis on and already holding every answer.</dd>
      <dt>Hit, miss, hit ratio</dt><dd>A hit is an answer found in Redis; a miss had to ask MySQL. Hit ratio is the share of hits.</dd>
      <dt>TTL</dt><dd>How long Redis keeps an answer before forgetting it: 5 minutes for searches, 1 hour for order details.</dd>
      <dt>base</dt><dd>The normal settings, before we changed anything.</dd>
      <dt>Significant</dt><dd>Every repeat with the change came out different from every repeat without it, so it is not luck.</dd>
    </dl>
  </details>
</section>`;
}

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

const PERCENTILES = ['p50', 'p95', 'p99', 'p99.9'];

function cacheEffectSection(r) {
  const rows = r.workers.map((w) => {
    const off = r.group(r.baseline, w, 'off');
    const cold = r.group(r.baseline, w, 'cold');
    const warm = r.group(r.baseline, w, 'warm');
    if (!off || !warm) return '';
    const change = (metric) => ((warm[metric].median - off[metric].median) / off[metric].median) * 100;
    const cell = (metric, f) => `<td class="num">${f(off[metric].median)} &rarr; ${f(warm[metric].median)}<span class="code ${change(metric) > 0 === (metric === 'throughput') ? 'good' : 'worse'}">${signed(change(metric))}</span></td>`;
    return `<tr>
  <td class="num">${w}</td>
  ${cell('throughput', rps)}
  ${PERCENTILES.map((p) => cell(p, ms)).join('')}
  <td class="num nowrap">${cold ? pct(cold.hit_ratio.median) : '&mdash;'} / ${pct(warm.hit_ratio.median)}</td>
</tr>`;
  }).join('');

  if (!rows.trim()) return '';
  return `<section class="card">
  <h2>Where the cache helped</h2>
  ${explain('Normal settings, cache off &rarr; cache on. <strong>Green means better.</strong> The typical request (p50) got about twice as fast. The slowest requests (p99) gained less, and the slowest 1 in 1,000 (p99.9) got worse at 10 and 20 users, because their delay comes from the laptop itself, not from the database the cache replaces.')}
  <p class="hint">Medians of repeats. Did the tail (p99, p99.9) improve as much as the typical request (p50)?</p>
  <div class="table-scroll"><table class="table table-compact">
    <thead><tr><th class="num">Workers</th><th class="num">Requests/s</th>${PERCENTILES.map((p) => `<th class="num">${p} ms</th>`).join('')}<th class="num">Hit ratio cold / warm</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
  <ul class="method">
    <li>The typical request (p50) is about twice as fast with Redis at every load, and throughput roughly doubles: a hit skips the MySQL round trip, the query and building the JSON.</li>
    <li>The tail gains less. p99 improves about as much as p50 at 10 workers but only about 12% at 40, and p99.9 gets <em>worse</em> with the cache at 10 and 20 workers. The slowest 0.1% are set by what the cache cannot remove: scheduling of the Docker VM and the benchmark&rsquo;s own worker processes on the same 10 CPUs, and one Node.js thread serving twice the request rate.</li>
    <li>Cold and warm are nearly identical: each of the 776 keys misses about once and is then served from Redis, so a cold run at 10 workers had 786 misses among about 530,000 requests (hit ratio 99.85%). The few extra misses are keys requested by two workers at the same moment.</li>
  </ul>
</section>`;
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
  ${explain('We ran the same test again <strong>without changing anything</strong>, and the numbers still moved about 10%. That is just the laptop. So any difference smaller than about 10% is not proof of anything, which is why we only claim the no-cache result.')}
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
  ${explain('This is what the test asks the site for: lists of orders by date, one customer&rsquo;s orders, and the items in one order. The first time, MySQL looks it up and Redis remembers the answer. After that, Redis answers until it forgets: 5 minutes for lists, 1 hour for order items.')}
  <p class="hint">The benchmark sends about 776 different requests built from these three Project 3 queries, with Zipf popularity (the top 10 keys get about 40% of requests). Each answer is cached with cache-aside: look the key up in Redis; on a miss, ask MySQL as the read-only <code>cs_wkr</code> user and store the answer with a TTL.</p>
  <div class="query-grid">${QUERIES.map((q) => `<div class="query">
    <h3>${q.name}</h3>
    <p class="code">key ${q.key} &middot; TTL ${q.ttl}</p>
    <pre>${escape(q.sql)}</pre>
  </div>`).join('')}</div>
</section>`;
}

function liveSection(bounds) {
  return `<section class="card" id="live">
  <h2>Try the cache live</h2>
  ${explain('Click <strong>Run query</strong> twice. The first answer says <strong>MISS</strong>: MySQL had to look it up. The second says <strong>HIT</strong>: Redis remembered it, and it is many times faster.')}
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
      if (window.refreshCache) window.refreshCache();
    });
  });
})();
</script>`;
}

function inspectorSection(bounds) {
  return `<section class="card" id="inspector">
  <h2>Cache inspector</h2>
  ${explain('A live look inside Redis: every answer it is remembering, how many seconds until it forgets each one, and how often it already had the answer (hit ratio). <strong>Clear cache</strong> makes it forget everything, so you can watch it fill up again.')}
  <p class="hint">What Redis on this server holds right now, read with <code>INFO stats</code>, <code>SCAN</code> and <code>TTL</code>. Hit ratio = hits &divide; (hits + misses) since the counters were last reset. Clear the cache to start cold, then run queries above or on the Order Lookup page and watch keys appear and their TTLs count down.</p>
  <div class="stats" id="cache-stats">
    <div class="stat"><span class="stat-label">Hits</span><span class="stat-value" data-stat="hits">&ndash;</span></div>
    <div class="stat"><span class="stat-label">Misses</span><span class="stat-value" data-stat="misses">&ndash;</span></div>
    <div class="stat stat-strong"><span class="stat-label">Hit ratio</span><span class="stat-value" data-stat="ratio">&ndash;</span><span class="meter meter-wide"><span data-stat="meter" style="width:0"></span></span></div>
    <div class="stat"><span class="stat-label">Keys cached</span><span class="stat-value" data-stat="keys">&ndash;</span><span class="stat-note" data-stat="memory"></span></div>
  </div>
  <div class="toolbar inspector-tools">
    <button class="btn btn-secondary btn-small" type="button" id="cache-refresh">Refresh</button>
    <button class="btn btn-small" type="button" id="cache-clear">Clear cache (cold start)</button>
    <label class="check"><input type="checkbox" id="cache-auto" checked> Refresh every 2 s</label>
    <span class="muted" id="cache-note"></span>
  </div>
  <div class="table-scroll"><table class="table table-compact" id="cache-keys">
    <thead><tr><th>Key</th><th>Query</th><th class="num">TTL left</th></tr></thead>
    <tbody><tr><td colspan="3" class="muted">Loading&hellip;</td></tr></tbody>
  </table></div>

  <h2>Time it: the same query with and without Redis</h2>
  ${explain('Asks the same question 20 times straight from MySQL, then 20 times through Redis, and shows how long each took. The last line says how many times faster Redis was.')}
  <p class="hint">Runs one date-range search N times straight from MySQL (OFF), then N times through the cache (the first is a MISS unless already cached, the rest are HITs), all on this server. Times cover the cache and database step only, so the network to your browser is not included.</p>
  <form id="timeit-form" class="field-row live-form">
    <div class="field"><label for="timeit-start">Start</label><input type="date" id="timeit-start" value="${escape(bounds.earliest)}" min="${escape(bounds.earliest)}" max="${escape(bounds.latest)}" required></div>
    <div class="field"><label for="timeit-end">End</label><input type="date" id="timeit-end" value="${escape(bounds.latest)}" min="${escape(bounds.earliest)}" max="${escape(bounds.latest)}" required></div>
    <div class="field"><label for="timeit-n">Requests each</label><input type="number" id="timeit-n" value="20" min="1" max="50"></div>
    <div class="field field-actions"><button class="btn" type="submit">Time it</button></div>
  </form>
  <div class="table-scroll"><table class="table table-compact" id="timeit-table" hidden>
    <thead><tr><th>Answered by</th><th class="num">Requests</th><th class="num">p50 ms</th><th class="num">p95 ms</th><th class="num">max ms</th></tr></thead>
    <tbody></tbody>
  </table></div>
  <p class="hint" id="timeit-summary"></p>
</section>
<script>
(function () {
  var section = document.getElementById('inspector');
  var note = document.getElementById('cache-note');
  var body = document.getElementById('cache-keys').tBodies[0];
  var auto = document.getElementById('cache-auto');
  function stat(name) { return section.querySelector('[data-stat="' + name + '"]'); }
  function kind(key) {
    if (key.indexOf('details:') === 0) return 'order line items';
    if (key.indexOf('orders:') === 0) return 'date range search';
    return 'form data';
  }
  function cell(row, text, cls) { var c = row.insertCell(); c.textContent = text; if (cls) c.className = cls; return c; }
  function refresh() {
    return fetch('/performance/cache/stats').then(function (r) { return r.json(); }).then(function (s) {
      if (s.error) { note.textContent = s.error; return; }
      stat('hits').textContent = s.hits.toLocaleString();
      stat('misses').textContent = s.misses.toLocaleString();
      stat('ratio').textContent = s.hitRatio == null ? '\\u2013' : (s.hitRatio * 100).toFixed(1) + '%';
      stat('meter').style.width = s.hitRatio == null ? '0' : (s.hitRatio * 100).toFixed(1) + '%';
      stat('keys').textContent = s.keyCount;
      stat('memory').textContent = 'Redis memory ' + s.memory + (s.evicted ? ', ' + s.evicted + ' evicted' : '');
      body.innerHTML = '';
      if (!s.keys.length) { var empty = body.insertRow(); var c = cell(empty, 'Empty: the next request for any key is a MISS.', 'muted'); c.colSpan = 3; }
      s.keys.forEach(function (k) {
        var row = body.insertRow();
        cell(row, k.key, 'code-cell');
        cell(row, kind(k.key));
        cell(row, k.ttl < 0 ? 'no expiry' : k.ttl + ' s', 'num');
      });
      note.textContent = 'updated ' + new Date().toLocaleTimeString();
    }).catch(function () { note.textContent = 'Could not reach the server.'; });
  }
  window.refreshCache = refresh;
  document.getElementById('cache-refresh').addEventListener('click', refresh);
  document.getElementById('cache-clear').addEventListener('click', function () {
    fetch('/performance/cache/clear', { method: 'POST' }).then(function (r) { return r.json(); }).then(function (r) {
      note.textContent = r.error || 'Cache cleared and counters reset.';
      refresh();
    });
  });
  setInterval(function () { if (auto.checked && !document.hidden) refresh(); }, 2000);
  refresh();

  var form = document.getElementById('timeit-form');
  var table = document.getElementById('timeit-table');
  var summary = document.getElementById('timeit-summary');
  var button = form.querySelector('button');
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var params = new URLSearchParams({ start: form.querySelector('#timeit-start').value, end: form.querySelector('#timeit-end').value, n: form.querySelector('#timeit-n').value });
    button.disabled = true;
    summary.textContent = 'Running\\u2026';
    fetch('/performance/cache/timeit?' + params).then(function (r) { return r.json(); }).then(function (data) {
      button.disabled = false;
      if (data.error) { summary.textContent = data.error; return; }
      var tbody = table.tBodies[0];
      tbody.innerHTML = '';
      var p50 = {};
      data.results.forEach(function (r) {
        p50[r.status] = r.p50;
        var row = tbody.insertRow();
        row.insertCell().innerHTML = '<span class="pill pill-cache-' + r.status.toLowerCase() + '">' + r.status + '</span>';
        [r.count, r.p50.toFixed(3), r.p95.toFixed(3), r.max.toFixed(3)].forEach(function (v) { cell(row, v, 'num'); });
      });
      table.hidden = false;
      summary.textContent = p50.OFF && p50.HIT
        ? 'Key ' + data.key + ': a Redis HIT took ' + p50.HIT.toFixed(3) + ' ms at the median against ' + p50.OFF.toFixed(3) + ' ms from MySQL, ' + (p50.OFF / p50.HIT).toFixed(1) + '\\u00d7 faster.'
        : 'Key ' + data.key + '.';
      refresh();
    }).catch(function () { button.disabled = false; summary.textContent = 'Could not reach the server.'; });
  });
})();
</script>`;
}

function methodSection(r) {
  return `<section class="card">
  <h2>How the numbers were produced</h2>
  ${explain('The professor&rsquo;s test program pretended to be 10, 20 and 40 users hammering the site for 30 seconds at a time. Each test ran three times, with the cache off, starting empty, and already full, and then all over again with logging on. Same requests, same laptop, every time.')}
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
${empty ? '<section class="card"><p class="empty">No benchmark results yet.</p></section>' : `${shortVersion(r)}

<section class="card">
  <h2>Findings at a glance</h2>
  ${live ? '<p class="hint"><a class="btn btn-secondary btn-small" href="#live">Live cache demo</a> <a class="btn btn-secondary btn-small" href="#inspector">Cache inspector</a></p>' : ''}
  ${explain('Pick how many users to look at. The first card is how much faster Redis made the site. The others show what turning on logging did in each test: <strong>a minus sign means slower</strong>, and a red border means the difference is real, not luck.')}
  ${selectors(r)}
  ${headline(r)}
</section>

<section class="card">
  <h2>Throughput</h2>
  ${explain('<strong>Taller is better</strong>: more requests answered per second. Blue is normal settings, red is with logging on. In the <strong>No cache</strong> groups the red bar is much shorter, so logging hurts. In the cold and warm cache groups the red bar is the same or only slightly shorter, within the laptop&rsquo;s normal wobble, so the cache hides the cost. The small lines on each bar show the lowest and highest of the three repeats; short lines mean the result was consistent.')}
  ${throughputChart(r)}
  <h2>Response time</h2>
  ${explain('<strong>Shorter is better</strong>: how long one request takes. Blue is a typical request, yellow the slowest 1 in 20, red the slowest 1 in 100. No cache with logging on has the tallest bars; with the cache, the bars are roughly cut in half.')}
  ${latencyChart(r)}
</section>

${cacheEffectSection(r)}

<section class="card">
  <h2>${escape(r.baseline)} vs ${escape(r.compareLabel || '')}</h2>
  ${explain('Each row is the same test run with logging off, then on. <strong>Throughput</strong> is the change in speed: a minus sign means slower. <strong>Significant</strong> means every repeat with logging on was different from every repeat without it. The warm cache row is our control: those requests never reach MySQL, so logging cannot affect them, and any change there is just the laptop.')}
  <p class="hint">Warm-cache requests are all answered by Redis and never reach MySQL, so a MySQL setting cannot change them: that row is the control. A warm-cache difference shows how far this machine drifts on its own; compare it with the noise check before crediting any difference to the parameter.</p>
  ${comparisonTable(r)}
</section>

${noiseSection(r)}

<section class="card">
  <h2>All results</h2>
  ${explain('Every number behind the charts, for reference. The main number is the middle of the three repeats; the small numbers in brackets are the lowest and highest. Errors are all zero, so every request succeeded.')}
  <p class="hint">Median over repeats, lowest&ndash;highest in brackets, times in milliseconds. ${r.runCount} measured runs${r.latest ? `, latest ${escape(r.latest)} UTC` : ''}.</p>
  ${resultsTable(r)}
  <h2>Settings each label ran with</h2>
  ${settingsTable(r)}
</section>`}

${queriesSection()}
${live && bounds ? liveSection(bounds) + inspectorSection(bounds) : ''}
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
