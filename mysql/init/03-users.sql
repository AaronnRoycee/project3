CREATE USER IF NOT EXISTS 'cs_mgr'@'localhost' IDENTIFIED WITH caching_sha2_password BY 'mgr_password';
CREATE USER IF NOT EXISTS 'cs_wkr'@'localhost' IDENTIFIED WITH caching_sha2_password BY 'wkr_password';

GRANT ALL ON classicmodels.* TO 'cs_mgr'@'localhost';
GRANT SELECT ON classicmodels.* TO 'cs_wkr'@'localhost';

FLUSH PRIVILEGES;

SELECT user, host, plugin FROM mysql.user WHERE user IN ('cs_mgr','cs_wkr');
SHOW GRANTS FOR 'cs_wkr'@'localhost';
