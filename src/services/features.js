// The fixed list of workstation features: the one place for their ids, labels and groups.
// The service validation, the model prompt, the MCP tool schema and the pages all read this list.
// Migration 006 repeats the ids in a CHECK (a migration is a frozen snapshot); test/migrate.test.js
// fails if the two lists ever differ.
export const FEATURE_GROUPS = [
  {
    name: 'Hardware',
    features: [
      ['high-end-pc', 'High-end PC (32 GB+ RAM)'],
      ['gpu-cuda', 'NVIDIA GPU (CUDA)'],
      ['gpu-server', 'Access to the GPU server'],
      ['dual-monitor', 'Dual monitors'],
      ['drawing-tablet', 'Drawing tablet'],
    ],
  },
  {
    name: 'Software / OS',
    features: [
      ['linux', 'Linux'],
      ['windows', 'Windows'],
      ['matlab', 'MATLAB'],
      ['cad', 'CAD (AutoCAD / SolidWorks)'],
      ['docker-vm', 'Docker / VM ready'],
    ],
  },
  {
    name: 'Lab equipment',
    features: [
      ['electronics-bench', 'Electronics bench (oscilloscope, soldering)'],
      ['network-rack', 'Network rack (Cisco)'],
      ['fpga-kit', 'FPGA / microcontroller kit'],
      ['plc-trainer', 'PLC trainer (Siemens S7)'],
    ],
  },
  {
    name: 'Environment',
    features: [
      ['quiet', 'Quiet zone'],
      ['accessible', 'Wheelchair accessible'],
    ],
  },
];

/** Every feature as { id, label, group }, in display order. */
export const FEATURES = FEATURE_GROUPS.flatMap((group) => group.features.map(([id, label]) => ({ id, label, group: group.name })));

export const FEATURE_IDS = FEATURES.map((feature) => feature.id);

const LABELS = new Map(FEATURES.map((feature) => [feature.id, feature.label]));

/** The label people read for a feature id; ids come from the database, whose CHECK allows only this list. */
export const featureLabel = (id) => LABELS.get(id);

/** For the pages: the groups in display order, each with its { id, label } features. */
export function listFeatures() {
  return FEATURE_GROUPS.map((group) => ({ group: group.name, features: group.features.map(([id, label]) => ({ id, label })) }));
}
