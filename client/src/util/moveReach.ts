// The reach arithmetic now lives in shared/ so the server enforces exactly
// what the map draws; this module remains as the client's import path.
export { pathCost, reachableHexes, type ReachOpts } from 'shared';
