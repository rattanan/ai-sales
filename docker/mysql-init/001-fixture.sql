CREATE TABLE IF NOT EXISTS customers (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  region VARCHAR(40) NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  customer_id BIGINT NOT NULL,
  total DECIMAL(12,2) NOT NULL,
  ordered_at DATETIME NOT NULL,
  CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers(id)
);
CREATE OR REPLACE VIEW customer_order_summary AS
  SELECT c.id, c.name, COUNT(o.id) AS order_count, COALESCE(SUM(o.total), 0) AS total_value
  FROM customers c LEFT JOIN orders o ON o.customer_id = c.id GROUP BY c.id, c.name;
INSERT INTO customers (name, region) VALUES ('Northwind Air', 'APAC'), ('Contoso Services', 'EMEA');
INSERT INTO orders (customer_id, total, ordered_at) VALUES (1, 12500.00, NOW()), (2, 8400.00, NOW());
GRANT SELECT, SHOW VIEW ON analytics_fixture.* TO 'readonly_user'@'%';
FLUSH PRIVILEGES;
