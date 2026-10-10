-- A small stand-in for an Epicor Compass data warehouse, used by the E2E
-- suite (CI loads it into the runner's MySQL). The real Compass layout
-- isn't published; this only mirrors what Margin Master's handbook says
-- (an IN inventory table) with deliberately cryptic location column names,
-- so Explore has to find them by value. All data is made up.
DROP DATABASE IF EXISTS compasstest;
CREATE DATABASE compasstest;
CREATE TABLE compasstest.`IN` (ITEMNO CHAR(14), DESCR VARCHAR(30), LCD1 CHAR(5), LCD2 CHAR(5), LCD3 CHAR(5), LCD4 CHAR(5), LCD5 CHAR(5), LCD6 CHAR(5), RCOST DECIMAL(9,3), STR CHAR(1));
INSERT INTO compasstest.`IN` VALUES
  ('70013','ACE SHVL SQRPT','12R02','','6','','','',12.5,'1'),
  ('70018','ACE SHVL RNDPT','12R02','','5','USTOR','','',11,'1'),
  ('3008391','TEST HOSE','14L05','','4','12R01','','',20,'1');
CREATE TABLE compasstest.BINS (BINLOC VARCHAR(8), NOTE VARCHAR(20));
INSERT INTO compasstest.BINS VALUES ('USTOR','upstairs'), ('107','back room');
DROP USER IF EXISTS 'mmuser'@'%';
CREATE USER 'mmuser'@'%' IDENTIFIED BY 's3cret-test';
GRANT SELECT ON compasstest.* TO 'mmuser'@'%';
FLUSH PRIVILEGES;
