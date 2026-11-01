const express = require('express');
const queries = require('./lib/queries');
const money = require('./lib/money');
const views = require('./lib/views');

const app = express();
const PORT = Number(process.env.APP_PORT || 3000);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

app.disable('x-powered-by');

function isValidDate(value) {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function readFilters(req) {
  const start = String(req.query.start || '');
  const end = String(req.query.end || '');
  const customer = String(req.query.customer || '').trim().slice(0, 80);
  const requested = String(req.query.status || '').trim();

  if (!isValidDate(start) || !isValidDate(end)) {
    return { error: 'Enter both dates in YYYY-MM-DD format.' };
  }
  if (start > end) {
    return { error: 'The start date must be on or before the end date.' };
  }

  const allowed = await queries.statuses();
  if (requested && !allowed.includes(requested)) {
    return { error: 'That order status is not recognized.' };
  }

  return { start, end, customer, status: requested };
}

function csvQueryString({ start, end, customer, status }) {
  const params = new URLSearchParams({ start, end });
  if (customer) params.set('customer', customer);
  if (status) params.set('status', status);
  return params.toString();
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

app.get('/orders/orders-by-date', async (req, res, next) => {
  try {
    const bounds = await queries.dateBounds();
    res.type('html').send(
      views.searchPage({
        start: String(req.query.start || bounds.earliest),
        end: String(req.query.end || bounds.latest),
        customer: String(req.query.customer || ''),
        status: String(req.query.status || ''),
        statusList: await queries.statuses(),
        bounds,
      }),
    );
  } catch (error) {
    next(error);
  }
});

app.get('/orders/orders-by-date/results', async (req, res, next) => {
  try {
    const filters = await readFilters(req);
    if (filters.error) {
      return res.status(400).type('html').send(views.errorPage({ title: 'Check your search', message: filters.error }));
    }

    const orders = await queries.findOrders(filters);

    if (String(req.query.format || '') === 'json') {
      return res.json({
        filters,
        count: orders.length,
        orders: orders.map((order) => ({
          orderNumber: order.orderNumber,
          orderDate: order.orderDate,
          status: order.status,
          customerNumber: order.customerNumber,
          customerName: order.customerName,
          subtotal: money.toDecimal(order.subtotalCents),
          tax: money.toDecimal(order.taxCents),
          total: money.toDecimal(order.totalCents),
        })),
      });
    }

    res.type('html').send(views.resultsPage({ ...filters, orders, csvQuery: csvQueryString(filters) }));
  } catch (error) {
    next(error);
  }
});

app.get('/orders/orders-by-date/results.csv', async (req, res, next) => {
  try {
    const filters = await readFilters(req);
    if (filters.error) return res.status(400).type('text/plain').send(filters.error);

    const orders = await queries.findOrders(filters);
    const header = ['orderNumber', 'orderDate', 'status', 'customerNumber', 'customerName', 'subtotal', 'tax', 'total'];
    const lines = [header.join(',')];

    for (const order of orders) {
      lines.push([
        order.orderNumber,
        order.orderDate,
        order.status,
        order.customerNumber,
        order.customerName,
        money.toDecimal(order.subtotalCents),
        money.toDecimal(order.taxCents),
        money.toDecimal(order.totalCents),
      ].map(csvCell).join(','));
    }

    res.type('text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="orders_${filters.start}_to_${filters.end}.csv"`);
    res.send(`${lines.join('\n')}\n`);
  } catch (error) {
    next(error);
  }
});

app.get('/orders/show/:orderNumber', async (req, res, next) => {
  try {
    const orderNumber = Number(req.params.orderNumber);
    if (!Number.isInteger(orderNumber) || orderNumber <= 0) {
      return res.status(400).type('html').send(views.errorPage({ title: 'Invalid order number', message: 'Order numbers are positive integers.' }));
    }

    const order = await queries.findOrder(orderNumber);
    if (!order) {
      const message = `No order numbered ${orderNumber} exists.`;
      if (String(req.query.format || '') === 'html') {
        return res.status(404).type('html').send(views.errorPage({ title: 'Order not found', message }));
      }
      return res.status(404).json({ error: message });
    }

    if (String(req.query.format || '') === 'html') {
      return res.type('html').send(views.detailPage(order));
    }

    res.json({
      orderNumber: order.orderNumber,
      orderDate: order.orderDate,
      requiredDate: order.requiredDate,
      shippedDate: order.shippedDate,
      status: order.status,
      customer: {
        customerNumber: order.customerNumber,
        name: order.customerName,
        phone: order.phone,
        city: order.city,
        country: order.country,
      },
      items: order.items.map((item) => ({
        productCode: item.productCode,
        productName: item.productName,
        quantity: item.quantity,
        priceEach: money.toDecimal(item.priceEachCents),
        total: money.toDecimal(item.totalCents),
      })),
      subtotal: money.toDecimal(order.subtotalCents),
      taxRate: '0.0825',
      tax: money.toDecimal(order.taxCents),
      total: money.toDecimal(order.totalCents),
    });
  } catch (error) {
    next(error);
  }
});

app.get('/node', (req, res) => {
  res.json({ service: 'cse6332-project3', node: process.version, status: 'ok' });
});

app.get('/node/', (req, res) => {
  res.json({ service: 'cse6332-project3', node: process.version, status: 'ok' });
});

app.get('/healthz', async (req, res) => {
  try {
    const bounds = await queries.dateBounds();
    res.type('text/plain').send(`ok ${bounds.earliest}..${bounds.latest}\n`);
  } catch (error) {
    res.status(503).type('text/plain').send('database unavailable\n');
  }
});

app.use((req, res) => {
  res.status(404).type('html').send(views.errorPage({ title: 'Page not found', message: 'That address does not exist.' }));
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).type('html').send(views.errorPage({ title: 'Server error', message: 'The query could not be completed.' }));
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`project3 app listening on 127.0.0.1:${PORT}`);
});
