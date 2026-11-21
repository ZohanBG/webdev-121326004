-- Slice 7: a richer, fixed list of workstation features. "gpu" becomes "gpu-cuda"; every other id stays.
-- The same ids live in src/services/features.js, and test/migrate.test.js checks that the two lists match.

ALTER TABLE workstations DROP CONSTRAINT workstations_features_check;

UPDATE workstations SET features = array_replace(features, 'gpu', 'gpu-cuda') WHERE 'gpu' = ANY (features);

ALTER TABLE workstations ADD CONSTRAINT workstations_features_check CHECK (features <@ ARRAY[
  'high-end-pc', 'gpu-cuda', 'gpu-server', 'dual-monitor', 'drawing-tablet',
  'linux', 'windows', 'matlab', 'cad', 'docker-vm',
  'electronics-bench', 'network-rack', 'fpga-kit', 'plc-trainer',
  'quiet', 'accessible'
]::text[]);
