CREATE TYPE employment AS ENUM ('full_time', 'part_time', 'contractor');
CREATE TABLE departments (
  id serial PRIMARY KEY,
  name varchar(80) NOT NULL UNIQUE,
  parent_id integer REFERENCES departments (id),
  budget numeric(12,2) CHECK (budget >= 0)
);
CREATE TABLE employees (
  id serial PRIMARY KEY,
  department_id integer NOT NULL REFERENCES departments (id),
  manager_id integer REFERENCES employees (id),
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text NOT NULL UNIQUE,
  kind employment NOT NULL DEFAULT 'full_time',
  salary integer CHECK (salary BETWEEN 20000 AND 400000),
  hired_on date NOT NULL,
  terminated_on date
);
CREATE TABLE timesheets (
  employee_id integer NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  week_start date NOT NULL,
  hours numeric(4,1) NOT NULL CHECK (hours >= 0 AND hours <= 80),
  approved boolean NOT NULL DEFAULT false,
  PRIMARY KEY (employee_id, week_start)
);
