// Called only inside the already-confined worker. Sharp is supplied by that
// worker; importing broker modules never loads a native image library.
export async function inspectConfinedOutput(data, sharp) {
  const meta=await sharp(data,{failOn:'error',limitInputPixels:40_000_000}).metadata();
  if(meta.format!=='webp'||!meta.width||!meta.height||meta.width>2400||meta.height>2400
    ||data.length>12*1024*1024||['exif','xmp','iptc','icc','orientation'].some(key=>meta[key]!==undefined)) {
    throw new Error('INVALID_ENCODED_OUTPUT');
  }
  let alphaHasTransparent=false,alphaHasNonzero=false;
  if(meta.hasAlpha) {
    const alpha=await sharp(data,{failOn:'error',limitInputPixels:40_000_000}).extractChannel('alpha').raw().toBuffer();
    alphaHasTransparent=alpha.some(value=>value<255);alphaHasNonzero=alpha.some(value=>value>0);
  }
  return {width:meta.width,height:meta.height,verification:{metadataStripped:true,hasAlpha:Boolean(meta.hasAlpha),alphaHasTransparent,alphaHasNonzero}};
}
