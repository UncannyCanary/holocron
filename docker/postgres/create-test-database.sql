-- Runs once, when the Postgres volume is first created. The tests get their
-- own database so they never leave rows in the one the app uses.
CREATE DATABASE holocron_test;
