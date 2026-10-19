CREATE TABLE customers (
  id serial PRIMARY KEY,
  email text NOT NULL,
  phone_number text
);

CREATE TABLE payment_methods (
  id serial PRIMARY KEY,
  customer_id integer REFERENCES customers(id),
  card_number text
);
