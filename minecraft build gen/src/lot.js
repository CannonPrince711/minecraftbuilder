// The voxel lot every structure is built in (x, y, z), shared to avoid import cycles.
export const GX = 11, GY = 12, GZ = 11;
export const N = GX * GY * GZ;
export const idx = (x, y, z) => (y * GZ + z) * GX + x;
