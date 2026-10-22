CREATE TABLE tenants (tenant_id integer PRIMARY KEY, name text NOT NULL);
CREATE TABLE customers (
  tenant_id integer NOT NULL REFERENCES tenants (tenant_id),
  customer_id integer NOT NULL,
  email text NOT NULL,
  full_name text NOT NULL,
  PRIMARY KEY (tenant_id, customer_id),
  UNIQUE (tenant_id, email)
);
CREATE TABLE invoices (
  tenant_id integer NOT NULL,
  invoice_id integer NOT NULL,
  customer_id integer NOT NULL,
  total numeric(12,2) NOT NULL CHECK (total >= 0),
  issued_on date NOT NULL,
  PRIMARY KEY (tenant_id, invoice_id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, customer_id)
);
CREATE TABLE invoice_lines (
  tenant_id integer NOT NULL,
  invoice_id integer NOT NULL,
  line_no smallint NOT NULL,
  description text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price numeric(10,2) NOT NULL,
  PRIMARY KEY (tenant_id, invoice_id, line_no),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices (tenant_id, invoice_id) ON DELETE CASCADE
);
