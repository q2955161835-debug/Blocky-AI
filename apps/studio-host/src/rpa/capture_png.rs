//! Bounded PNG decoding and re-encoding drops untrusted ancillary metadata.
use std::io::Cursor;
pub(super) const LIMIT: usize = 4 * 1024 * 1024;
const ERROR: &str = "BLK-RPA-CAPTURE-003";
pub(super) fn encode(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, String> {
    dimensions(width, height)?;
    if rgba.len() != width as usize * height as usize * 4 { return Err(ERROR.into()); }
    let mut output = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut output, width, height);
        encoder.set_color(png::ColorType::Rgba); encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(|_| ERROR)?;
        writer.write_image_data(rgba).map_err(|_| ERROR)?;
        writer.finish().map_err(|_| ERROR)?;
    }
    if output.len() > LIMIT { return Err(ERROR.into()); }
    Ok(output)
}
fn dimensions(w: u32, h: u32) -> Result<(), String> {
    if w == 0 || h == 0 || w > 2048 || h > 2048 { Err(ERROR.into()) } else { Ok(()) }
}
pub(super) fn normalize(bytes: &[u8]) -> Result<(Vec<u8>, u32, u32), String> {
    if bytes.len() > LIMIT { return Err(ERROR.into()); }
    let mut decoder = png::Decoder::new_with_limits(Cursor::new(bytes), png::Limits { bytes: 32 * 1024 * 1024 });
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder.read_info().map_err(|_| ERROR)?;
    dimensions(reader.info().width, reader.info().height)?;
    if reader.info().animation_control.is_some() { return Err(ERROR.into()); }
    let size = reader.output_buffer_size().filter(|size| *size <= 16 * 1024 * 1024).ok_or(ERROR)?;
    let mut buffer = vec![0; size];
    let frame = reader.next_frame(&mut buffer).map_err(|_| ERROR)?;
    if frame.bit_depth != png::BitDepth::Eight { return Err(ERROR.into()); }
    reader.finish().map_err(|_| ERROR)?;
    let mut rgba = Vec::with_capacity(frame.width as usize * frame.height as usize * 4);
    for sample in buffer[..frame.buffer_size()].chunks_exact(frame.color_type.samples()) {
        match frame.color_type {
            png::ColorType::Rgba => rgba.extend_from_slice(sample),
            png::ColorType::Rgb => rgba.extend_from_slice(&[sample[0], sample[1], sample[2], 255]),
            png::ColorType::Grayscale => rgba.extend_from_slice(&[sample[0], sample[0], sample[0], 255]),
            png::ColorType::GrayscaleAlpha => rgba.extend_from_slice(&[sample[0], sample[0], sample[0], sample[1]]),
            _ => return Err(ERROR.into()),
        }
    }
    let result = encode(frame.width, frame.height, &rgba);
    crate::secret_store::wipe(&mut buffer); crate::secret_store::wipe(&mut rgba);
    result.map(|png| (png, frame.width, frame.height))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn strips_metadata_and_rejects_oversized_or_corrupt_content() {
        let mut bytes=vec![];
        {let mut encoder=png::Encoder::new(&mut bytes,1,1);encoder.set_color(png::ColorType::Rgba);encoder.set_depth(png::BitDepth::Eight);encoder.add_text_chunk("Comment".into(),"PRIVATE_PNG_METADATA_CANARY".into()).unwrap();let mut writer=encoder.write_header().unwrap();writer.write_image_data(&[0,0,0,255]).unwrap();writer.finish().unwrap();}
        let canary=b"PRIVATE_PNG_METADATA_CANARY";
        assert!(bytes.windows(canary.len()).any(|v|v==canary));
        let (clean,w,h)=normalize(&bytes).unwrap();assert_eq!((w,h),(1,1));assert!(!clean.windows(canary.len()).any(|v|v==canary));
        assert!(normalize(&vec![0;LIMIT+1]).is_err());assert!(normalize(&clean[..clean.len()/2]).is_err());
    }
}
