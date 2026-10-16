import footprintPackage from 'footprintjs/package.json' with { type: 'json' };

/** Public installed SDK metadata; independent of a host's configured release label. */
export const footprintRuntimeVersion: string = footprintPackage.version;
