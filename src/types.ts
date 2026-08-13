export interface SliceBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface ImageSize {
  width: number;
  height: number;
}

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CopyRegion {
  source: PixelRect;
  destination: PixelRect;
}

export interface NineSliceRegions {
  outputSize: ImageSize;
  regions: {
    lt: CopyRegion;
    rt: CopyRegion;
    lb: CopyRegion;
    rb: CopyRegion;
  };
}
