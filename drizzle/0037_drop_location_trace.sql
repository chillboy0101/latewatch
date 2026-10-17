-- Grounds are now drawn on the map; no API writes or cleans up live location traces.
-- Remove all stored traces along with the retired table, including on existing deployments.
DROP TABLE IF EXISTS location_trace;
