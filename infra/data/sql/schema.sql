-- Serving layer for the analytics platform: the table Data Factory loads and Power BI reads.
--
-- Run with the Entra administrator, passing Data Factory's name so its managed identity gets a
-- contained user:
--
--   sqlcmd -S <server>.database.windows.net -d sqldb-funded-analytics \
--          --authentication-method ActiveDirectoryDefault \
--          -v adf_name="adf-funded-dev-xxxxx" -i infra/data/sql/schema.sql

SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.fx_rates', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.fx_rates
    (
        rate_date      DATE          NOT NULL,
        base_currency  CHAR(3)       NOT NULL,
        quote_currency CHAR(3)       NOT NULL,
        rate           DECIMAL(18,6) NOT NULL,
        CONSTRAINT pk_fx_rates PRIMARY KEY CLUSTERED (rate_date, base_currency, quote_currency),
        -- Money data: the database refuses a rate that cannot be true, whatever the loader does.
        CONSTRAINT ck_fx_rates_positive CHECK (rate > 0)
    );
END
GO

-- What Power BI connects to. A view keeps the report independent of the table's shape, and the
-- derived columns are computed once here rather than in every visual.
CREATE OR ALTER VIEW dbo.vw_fx_rates_daily
AS
SELECT
    r.rate_date,
    r.base_currency,
    r.quote_currency,
    r.base_currency + '/' + r.quote_currency                         AS currency_pair,
    r.rate,
    DATEFROMPARTS(YEAR(r.rate_date), MONTH(r.rate_date), 1)          AS rate_month,
    DATENAME(WEEKDAY, r.rate_date)                                   AS weekday_name,
    LAG(r.rate) OVER (PARTITION BY r.base_currency, r.quote_currency
                      ORDER BY r.rate_date)                          AS previous_rate,
    r.rate - LAG(r.rate) OVER (PARTITION BY r.base_currency, r.quote_currency
                               ORDER BY r.rate_date)                 AS daily_move
FROM dbo.fx_rates AS r;
GO

-- Monthly spread per pair, the shape a report wants for a volatility chart.
CREATE OR ALTER VIEW dbo.vw_rate_volatility_monthly
AS
SELECT
    rate_month,
    currency_pair,
    COUNT(*)                          AS observations,
    MIN(rate)                         AS low_rate,
    MAX(rate)                         AS high_rate,
    MAX(rate) - MIN(rate)             AS rate_range,
    AVG(rate)                         AS mean_rate,
    STDEV(daily_move)                 AS daily_move_stdev
FROM dbo.vw_fx_rates_daily
GROUP BY rate_month, currency_pair;
GO

-- Data Factory authenticates as its managed identity, so it needs a user in this database. There
-- is no password anywhere in this file or in the pipeline definition.
IF '$(adf_name)' <> '' AND NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = '$(adf_name)')
BEGIN
    CREATE USER [$(adf_name)] FROM EXTERNAL PROVIDER;
END
GO

-- Least privilege: the pipeline reads and writes rows. It cannot change the schema.
ALTER ROLE db_datareader ADD MEMBER [$(adf_name)];
ALTER ROLE db_datawriter ADD MEMBER [$(adf_name)];
GO

SELECT COUNT(*) AS fx_rate_rows FROM dbo.fx_rates;
GO
