const money = require('./money');

function escape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const NAV = [
  { href: '/orders/orders-by-date', label: 'Order Lookup', section: 'lookup' },
  { href: '/performance', label: 'Cache Performance', section: 'performance' },
];

function layout({ title, heading, subtitle, body, section = 'lookup', nav = NAV, wide = false }) {
  const links = nav
    .map((item) => `<a href="${item.href}"${item.section === section ? ' class="active" aria-current="page"' : ''}>${escape(item.label)}</a>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<link rel="stylesheet" href="/css/app.css">
</head>
<body>
<nav class="site-nav">${links}</nav>
<header class="site-header">
  <h1>${escape(heading)}</h1>
  <p class="subtitle">${escape(subtitle)}</p>
</header>
<main class="wrap${wide ? ' wrap-wide' : ''}">
${body}
</main>
<footer class="site-footer">
  <p>Aaron Pantoja &middot; CSE 6332 Projects 3 &amp; 4 &middot; nginx and Node.js querying MySQL through a Redis cache in a Docker container</p>
</footer>
</body>
</html>`;
}

const CACHE_TEXT = {
  HIT: (l) => `Answered from Redis in ${l.ms.toFixed(2)} ms${l.expiresIn != null && l.expiresIn >= 0 ? ` &middot; expires in ${l.expiresIn} s` : ''}`,
  MISS: (l) => `Not in Redis: read from MySQL in ${l.ms.toFixed(2)} ms, now cached for ${l.expiresIn} s`,
  OFF: (l) => `Cache skipped: read straight from MySQL in ${l.ms.toFixed(2)} ms`,
  BYPASS: (l) => `Redis did not answer: read from MySQL in ${l.ms.toFixed(2)} ms`,
};

function cacheBanner(lookup, url) {
  const cachedUrl = url.replace(/([?&])nocache=1&?/, '$1').replace(/[?&]$/, '');
  const uncachedUrl = `${cachedUrl}${cachedUrl.includes('?') ? '&' : '?'}nocache=1`;
  const toggle = lookup.status === 'OFF'
    ? `<a class="btn btn-small btn-secondary" href="${escape(cachedUrl)}">Run with cache</a>`
    : `<a class="btn btn-small btn-secondary" href="${escape(uncachedUrl)}">Run without cache</a>`;

  return `<div class="cache-banner cache-${lookup.status.toLowerCase()}">
  <span class="cache-status">${lookup.status}</span>
  <span class="cache-text">${CACHE_TEXT[lookup.status](lookup)}<span class="code">key ${escape(lookup.key)}</span></span>
  <span class="cache-actions"><a class="btn btn-small btn-secondary" href="${escape(url)}">Run again</a>${toggle}</span>
</div>`;
}

function searchPage({ start, end, customer, status, statusList, bounds }) {
  const options = statusList
    .map((value) => `<option value="${escape(value)}"${value === status ? ' selected' : ''}>${escape(value)}</option>`)
    .join('');

  return layout({
    title: 'Search Orders by Date',
    heading: 'Customer Service Order Lookup',
    subtitle: 'Find orders in a date range, then open one for full detail.',
    body: `<form class="card form" method="GET" action="/orders/orders-by-date/results">
  <div class="field-row">
    <div class="field">
      <label for="start">Start date</label>
      <input type="date" id="start" name="start" required value="${escape(start)}" min="${escape(bounds.earliest)}" max="${escape(bounds.latest)}">
    </div>
    <div class="field">
      <label for="end">End date</label>
      <input type="date" id="end" name="end" required value="${escape(end)}" min="${escape(bounds.earliest)}" max="${escape(bounds.latest)}">
    </div>
  </div>
  <div class="field-row">
    <div class="field">
      <label for="customer">Customer name contains <span class="optional">optional</span></label>
      <input type="text" id="customer" name="customer" value="${escape(customer)}" placeholder="e.g. Diecast">
    </div>
    <div class="field">
      <label for="status">Status <span class="optional">optional</span></label>
      <select id="status" name="status">
        <option value="">Any status</option>
        ${options}
      </select>
    </div>
  </div>
  <label class="check"><input type="checkbox" name="nocache" value="1"> Skip the Redis cache and query MySQL directly</label>
  <p class="hint">Orders on file run from ${escape(bounds.earliest)} to ${escape(bounds.latest)}. Results are cached in Redis for 300 seconds; each result page shows whether Redis or MySQL answered.</p>
  <button type="submit" class="btn">Find Orders</button>
</form>`,
  });
}

function resultsPage({ orders, start, end, customer, status, query, lookup }) {
  const filters = [`${escape(start)} to ${escape(end)}`];
  if (customer) filters.push(`customer contains "${escape(customer)}"`);
  if (status) filters.push(`status ${escape(status)}`);

  const totalCents = orders.reduce((sum, order) => sum + order.totalCents, 0);

  const rows = orders
    .map(
      (order) => `<tr>
  <td><a href="/orders/show/${order.orderNumber}?format=html">#${order.orderNumber}</a></td>
  <td>${escape(order.orderDate)}</td>
  <td><span class="pill pill-${escape(order.status.toLowerCase().replace(/\s+/g, '-'))}">${escape(order.status)}</span></td>
  <td>${escape(order.customerName)}</td>
  <td class="num">${money.format(order.totalCents)}</td>
  <td><a class="btn btn-small" href="/orders/show/${order.orderNumber}?format=html">View</a></td>
</tr>`,
    )
    .join('');

  const table = orders.length
    ? `<table class="table">
  <thead><tr><th>Order</th><th>Date</th><th>Status</th><th>Customer</th><th class="num">Total</th><th></th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr><td colspan="4">${orders.length} order${orders.length === 1 ? '' : 's'}</td><td class="num">${money.format(totalCents)}</td><td></td></tr></tfoot>
</table>`
    : '<p class="empty">No orders matched those filters.</p>';

  return layout({
    title: 'Order Results',
    heading: `${orders.length} order${orders.length === 1 ? '' : 's'} found`,
    subtitle: filters.join(' \u00b7 '),
    body: `<div class="card">
  ${cacheBanner(lookup, `/orders/orders-by-date/results?${query}${lookup.status === 'OFF' ? '&nocache=1' : ''}`)}
  <div class="toolbar">
    <a class="btn btn-secondary" href="/orders/orders-by-date?${escape(query)}">New search</a>
    ${orders.length ? `<a class="btn btn-secondary" href="/orders/orders-by-date/results.csv?${escape(query)}">Download CSV</a>` : ''}
  </div>
  ${table}
</div>`,
  });
}

function detailPage(order, lookup) {
  const rows = order.items
    .map(
      (item) => `<tr>
  <td>${escape(item.productName)}<span class="code">${escape(item.productCode)}</span></td>
  <td class="num">${item.quantity}</td>
  <td class="num">${money.format(item.priceEachCents)}</td>
  <td class="num">${money.format(item.totalCents)}</td>
</tr>`,
    )
    .join('');

  return layout({
    title: `Order #${order.orderNumber}`,
    heading: `Order #${order.orderNumber}`,
    subtitle: `${order.status} \u00b7 ordered ${order.orderDate}`,
    body: `<div class="card">
  ${cacheBanner(lookup, `/orders/show/${order.orderNumber}?format=html${lookup.status === 'OFF' ? '&nocache=1' : ''}`)}
  <div class="toolbar">
    <a class="btn btn-secondary" href="/orders/orders-by-date">New search</a>
    <a class="btn btn-secondary" href="/orders/show/${order.orderNumber}?format=json">View JSON</a>
  </div>

  <h2>Customer</h2>
  <dl class="detail">
    <dt>Name</dt><dd>${escape(order.customerName)}</dd>
    <dt>Customer #</dt><dd>${escape(order.customerNumber)}</dd>
    <dt>Phone</dt><dd>${escape(order.phone)}</dd>
    <dt>Location</dt><dd>${escape([order.city, order.country].filter(Boolean).join(', '))}</dd>
  </dl>

  <h2>Dates</h2>
  <dl class="detail">
    <dt>Ordered</dt><dd>${escape(order.orderDate)}</dd>
    <dt>Required</dt><dd>${escape(order.requiredDate)}</dd>
    <dt>Shipped</dt><dd>${order.shippedDate ? escape(order.shippedDate) : '<span class="muted">not shipped</span>'}</dd>
  </dl>

  <h2>Items</h2>
  <table class="table">
    <thead><tr><th>Product</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Total</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr><td colspan="3">Subtotal</td><td class="num">${money.format(order.subtotalCents)}</td></tr>
      <tr><td colspan="3">Tax (8.25%)</td><td class="num">${money.format(order.taxCents)}</td></tr>
      <tr class="grand"><td colspan="3">Total</td><td class="num">${money.format(order.totalCents)}</td></tr>
    </tfoot>
  </table>
  ${order.comments ? `<h2>Comments</h2><p class="comments">${escape(order.comments)}</p>` : ''}
</div>`,
  });
}

function errorPage({ title, message }) {
  return layout({
    title,
    heading: title,
    subtitle: 'Something needs to be corrected.',
    body: `<div class="card">
  <p class="empty">${escape(message)}</p>
  <a class="btn" href="/orders/orders-by-date">Back to search</a>
</div>`,
  });
}

module.exports = { escape, layout, searchPage, resultsPage, detailPage, errorPage };
