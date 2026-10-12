/**
 * Storage adapter — loads caption thumbnail blobs from workspace-fs.
 */

export {
  getCaptionThumbnailBlob,
  saveCaptionThumbnail,
  probeCaptionThumbnail,
  saveCaptionEmbeddings,
  getCaptionEmbeddings,
  getCaptionsEmbeddingsMeta,
  saveCaptionImageEmbeddings,
  getCaptionImageEmbeddings,
  getTranscript,
} from '@/infrastructure/storage'
