import sharp from 'sharp';

// Accept only the byte-verified raster formats used by the media platform.
// This prevents crafted HEIF/AVIF/TIFF/SVG input from reaching an unneeded
// native loader before the application validates its content signature.
sharp.block({ operation: ['VipsForeignLoad'] });
sharp.unblock({
  operation: [
    'VipsForeignLoadJpegBuffer',
    'VipsForeignLoadPngBuffer',
    'VipsForeignLoadWebpBuffer',
  ],
});

export default sharp;
