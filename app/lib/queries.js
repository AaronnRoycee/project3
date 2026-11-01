const { query } = require('./db');
const money = require('./money');

async function statuses() {
  const rows = await query('SELECT DISTINCT status FROM orders ORDER BY status');
  return rows.map((row) => row.status);
}

async function dateBounds() {
  const rows = await query('SELECT MIN(orderDate) AS earliest, MAX(orderDate) AS latest FROM orders');
  return rows[0];
}

async function findOrders({ start, end, customer, status }) {
  const clauses = ['o.orderDate BETWEEN ? AND ?'];
  const params = [start, end];

  if (customer) {
    clauses.push('c.customerName LIKE ?');
    params.push(`%${customer}%`);
  }
  if (status) {
    clauses.push('o.status = ?');
    params.push(status);
  }

  const rows = await query(
    `SELECT o.orderNumber, o.orderDate, o.status, c.customerNumber, c.customerName,
            COALESCE(SUM(od.quantityOrdered * od.priceEach), 0) AS orderTotal
       FROM orders o
       JOIN customers c ON c.customerNumber = o.customerNumber
       LEFT JOIN orderdetails od ON od.orderNumber = o.orderNumber
      WHERE ${clauses.join(' AND ')}
      GROUP BY o.orderNumber, o.orderDate, o.status, c.customerNumber, c.customerName
      ORDER BY o.orderDate, o.orderNumber`,
    params,
  );

  return rows.map((row) => {
    const subtotalCents = money.toCents(row.orderTotal);
    const tax = money.taxCents(subtotalCents);
    return {
      orderNumber: row.orderNumber,
      orderDate: row.orderDate,
      status: row.status,
      customerNumber: row.customerNumber,
      customerName: row.customerName,
      subtotalCents,
      taxCents: tax,
      totalCents: subtotalCents + tax,
    };
  });
}

async function findOrder(orderNumber) {
  const header = await query(
    `SELECT o.orderNumber, o.orderDate, o.requiredDate, o.shippedDate, o.status, o.comments,
            c.customerNumber, c.customerName, c.phone, c.city, c.country
       FROM orders o
       JOIN customers c ON c.customerNumber = o.customerNumber
      WHERE o.orderNumber = ?`,
    [orderNumber],
  );

  if (header.length === 0) return null;

  const lines = await query(
    `SELECT od.orderLineNumber, od.productCode, p.productName,
            od.quantityOrdered, od.priceEach
       FROM orderdetails od
       JOIN products p ON p.productCode = od.productCode
      WHERE od.orderNumber = ?
      ORDER BY od.orderLineNumber`,
    [orderNumber],
  );

  const items = lines.map((line) => ({
    productCode: line.productCode,
    productName: line.productName,
    quantity: line.quantityOrdered,
    priceEachCents: money.toCents(line.priceEach),
    totalCents: money.lineTotalCents(line.quantityOrdered, line.priceEach),
  }));

  const subtotalCents = items.reduce((sum, item) => sum + item.totalCents, 0);
  const tax = money.taxCents(subtotalCents);

  return {
    ...header[0],
    items,
    subtotalCents,
    taxCents: tax,
    totalCents: subtotalCents + tax,
  };
}

module.exports = { statuses, dateBounds, findOrders, findOrder };
