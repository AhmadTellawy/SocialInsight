# Native HEIF corpus

Run from the repository root with an absolute trusted decoder path:

`node tests/media-native/heif-corpus.mjs <absolute-heif-convert-path>`

The harness invokes the real native decoder and the converter's actual WebP pipeline. It checks clean aperture dimensions, alpha preservation, metadata removal, rejection of unsupported codecs/sequences, corrupt input admission, and temporary cleanup. The injected Windows runner is a local compatibility probe, not Linux resource, security, or deployment approval. It never loads application environment files or uses provider credentials.

Fixtures originate in official libheif v1.23.2 [tests/data](https://github.com/strukturag/libheif/tree/v1.23.2/tests/data), [examples/example.heic](https://github.com/strukturag/libheif/blob/v1.23.2/examples/example.heic), and [fuzzing/data/corpus/hevc32.heif](https://github.com/strukturag/libheif/blob/v1.23.2/fuzzing/data/corpus/hevc32.heif). Camera sample is reused unchanged from the existing repository media E2E corpus. One generic HEIF case is derived in memory by replacing the camera sample's ftyp `heic` brand with `mif1` while preserving encoded pixels and box lengths. Fixture hashes are recorded in each run.

Still required: the pinned Linux image, 40MP and near-15MiB sources, EXIF/irot/imir orientation, HEVC 10/12-bit and HDR, multi-image collections, malformed native input corpus, measured RSS/temp/CPU and concurrency, 0.1 CPU/512MiB cold starts and timeout behavior, signed HTTP integration and real storage/cancellation/account-deletion journeys. The small local samples cannot establish the maximum supported workload.
