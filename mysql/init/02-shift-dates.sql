USE classicmodels;

UPDATE orders
   SET orderDate    = DATE_ADD(orderDate,    INTERVAL 20 YEAR),
       requiredDate = DATE_ADD(requiredDate, INTERVAL 20 YEAR),
       shippedDate  = DATE_ADD(shippedDate,  INTERVAL 20 YEAR);

UPDATE payments
   SET paymentDate  = DATE_ADD(paymentDate,  INTERVAL 20 YEAR);

SELECT MIN(orderDate) AS earliest_order, MAX(orderDate) AS latest_order FROM orders;
