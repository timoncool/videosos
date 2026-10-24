//! Tags on the results VideoSOS saves, as YuE2 Studio tags its tracks: a provider returns a bare file, and one
//! saved as it came lands in a folder or a player with no idea what it is. A picture carries the prompt, the
//! model and VideoSOS in its EXIF (little_exif: JPEG, PNG, AVIF and lossless WebP); a video or a sound carries
//! the title, the prompt and the model in its own tags (lofty: MP4, MP3, FLAC, WAV, OGG).
//!
//! Tagging never fails a job: the result is paid for and is still the result, so the caller says in the log that
//! the tags were not written.

use std::path::Path;

use lofty::config::WriteOptions;
use lofty::file::FileType;
use lofty::prelude::{Accessor, TagExt, TaggedFileExt};
use lofty::tag::{Tag, TagType};

/// What a result's file says about itself.
pub struct ResultTags<'a> {
    pub title: &'a str,
    pub prompt: Option<&'a str>,
    pub model: &'a str,
}

const SOFTWARE: &str = "VideoSOS";

pub fn write(path: &Path, mime: &str, tags: &ResultTags) -> anyhow::Result<()> {
    if mime.starts_with("image/") {
        return write_exif(path, tags);
    }
    let file_type = FileType::from_path(path).ok_or_else(|| anyhow::anyhow!("{} is not a file VideoSOS tags", path.display()))?;
    // a studio's track already says what it is (its title, lyrics, genre): only what it leaves out is added
    let mut tag = lofty::read_from_path(path)
        .ok()
        .and_then(|file| file.tag(file_type.primary_tag_type()).cloned())
        .unwrap_or_else(|| Tag::new(file_type.primary_tag_type()));
    if tag.title().is_none() {
        tag.set_title(tags.title.to_string());
    }
    if tag.artist().is_none() {
        tag.set_artist(tags.model.to_string());
    }
    if tag.album().is_none() {
        tag.set_album(SOFTWARE.to_string());
    }
    if let Some(prompt) = tags.prompt
        && tag.comment().is_none()
    {
        tag.set_comment(prompt.to_string());
    }
    tag.save_to_path(path, WriteOptions::default())?;
    if file_type == FileType::Wav {
        // RIFF INFO is what most readers of a WAV look at
        let mut info = tag;
        info.re_map(TagType::RiffInfo);
        info.save_to_path(path, WriteOptions::default())?;
    }
    Ok(())
}

const XP_TITLE: u16 = 0x9c9b;
const XP_COMMENT: u16 = 0x9c9c;

fn utf16(text: &str) -> Vec<u8> {
    text.encode_utf16().chain(std::iter::once(0)).flat_map(u16::to_le_bytes).collect()
}

fn write_exif(path: &Path, tags: &ResultTags) -> anyhow::Result<()> {
    use little_exif::exif_tag::ExifTag;
    use little_exif::ifd::ExifTagGroup;
    use little_exif::metadata::Metadata;
    // little_exif reads a file with no EXIF as an error: it starts with none, and a file it cannot write still fails below
    let mut metadata = Metadata::new_from_path(path).unwrap_or_else(|_| Metadata::new());
    let description = tags.prompt.unwrap_or(tags.title);
    // EXIF text is ASCII; Windows reads the title and comment of a picture from its own UTF-16 tags
    if description.is_ascii() {
        metadata.set_tag(ExifTag::ImageDescription(description.to_string()));
    }
    metadata.set_tag(ExifTag::UnknownINT8U(utf16(tags.title), XP_TITLE, ExifTagGroup::GENERIC));
    metadata.set_tag(ExifTag::UnknownINT8U(utf16(description), XP_COMMENT, ExifTagGroup::GENERIC));
    metadata.set_tag(ExifTag::Artist(tags.model.to_string()));
    metadata.set_tag(ExifTag::Software(SOFTWARE.to_string()));
    metadata.write_to_file(path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png() -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"\x89PNG\r\n\x1a\n");
        let chunk = |kind: &[u8], data: &[u8], out: &mut Vec<u8>| {
            out.extend_from_slice(&(data.len() as u32).to_be_bytes());
            let mut body = kind.to_vec();
            body.extend_from_slice(data);
            out.extend_from_slice(&body);
            out.extend_from_slice(&crc32(&body).to_be_bytes());
        };
        chunk(b"IHDR", &[0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0], &mut bytes);
        // one grey pixel, deflated
        chunk(b"IDAT", &[0x78, 0x9c, 0x63, 0x60, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01], &mut bytes);
        chunk(b"IEND", &[], &mut bytes);
        bytes
    }

    fn crc32(data: &[u8]) -> u32 {
        let mut crc = 0xffff_ffffu32;
        for byte in data {
            crc ^= u32::from(*byte);
            for _ in 0..8 {
                crc = if crc & 1 == 1 { (crc >> 1) ^ 0xedb8_8320 } else { crc >> 1 };
            }
        }
        !crc
    }

    #[test]
    fn a_picture_carries_its_prompt_and_model() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("01.png");
        std::fs::write(&path, png()).unwrap();
        write(&path, "image/png", &ResultTags { title: "red fox", prompt: Some("red fox, snow"), model: "FLUX.1 [schnell]" }).unwrap();
        let metadata = little_exif::metadata::Metadata::new_from_path(&path).unwrap();
        let description = metadata.get_tag(&little_exif::exif_tag::ExifTag::ImageDescription(String::new())).next().cloned();
        assert_eq!(description, Some(little_exif::exif_tag::ExifTag::ImageDescription("red fox, snow".into())));
    }

    fn wav() -> Vec<u8> {
        let samples = [0u8; 3200];
        let mut bytes = b"RIFF".to_vec();
        bytes.extend_from_slice(&(36 + samples.len() as u32).to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&16_000u32.to_le_bytes());
        bytes.extend_from_slice(&32_000u32.to_le_bytes());
        bytes.extend_from_slice(&2u16.to_le_bytes());
        bytes.extend_from_slice(&16u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&(samples.len() as u32).to_le_bytes());
        bytes.extend_from_slice(&samples);
        bytes
    }

    #[test]
    fn a_studio_track_keeps_what_it_says_about_itself() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("01.wav");
        std::fs::write(&path, wav()).unwrap();
        write(&path, "audio/wav", &ResultTags { title: "Paper Boat", prompt: None, model: "YuE2" }).unwrap();
        write(&path, "audio/wav", &ResultTags { title: "YuE2 Studio", prompt: Some("indie pop"), model: "YuE2 Studio" }).unwrap();
        let file = lofty::read_from_path(&path).unwrap();
        let tag = file.tag(TagType::Id3v2).or_else(|| file.primary_tag()).unwrap();
        assert_eq!(tag.title().as_deref(), Some("Paper Boat"));
        assert_eq!(tag.artist().as_deref(), Some("YuE2"));
        assert_eq!(tag.comment().as_deref(), Some("indie pop"));
    }
}
