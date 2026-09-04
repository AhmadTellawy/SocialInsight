# syntax=docker/dockerfile:1.7
FROM debian:bookworm-20260824-slim@sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171 AS native-builder

ARG LIBHEIF_REF=v1.23.3
ARG LIBDE265_REF=v1.1.1
ARG LIBHEIF_COMMIT=78c9746aea226b22885e8d35241353ce669c4ea5
ARG LIBDE265_COMMIT=4dd701fffac01632ffd5cabc5ef10deb56accba1

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential ca-certificates cmake git libpng-dev ninja-build pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
RUN git init libde265 \
    && git -C libde265 remote add origin https://github.com/strukturag/libde265.git \
    && git -C libde265 fetch --depth 1 origin "${LIBDE265_COMMIT}" \
    && git -C libde265 checkout --detach FETCH_HEAD \
    && test "$(git -C libde265 rev-parse HEAD)" = "${LIBDE265_COMMIT}" \
    && cmake -S libde265 -B libde265/build -G Ninja \
      -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_INSTALL_PREFIX=/opt/native \
      -DBUILD_SHARED_LIBS=OFF \
      -DENABLE_SDL=OFF \
    && cmake --build libde265/build --parallel \
    && cmake --install libde265/build

RUN git init libheif \
    && git -C libheif remote add origin https://github.com/strukturag/libheif.git \
    && git -C libheif fetch --depth 1 origin "${LIBHEIF_COMMIT}" \
    && git -C libheif checkout --detach FETCH_HEAD \
    && test "$(git -C libheif rev-parse HEAD)" = "${LIBHEIF_COMMIT}" \
    && PKG_CONFIG_PATH=/opt/native/lib/pkgconfig cmake -S libheif -B libheif/build -G Ninja \
      -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_PREFIX_PATH=/opt/native \
      -DCMAKE_INSTALL_PREFIX=/opt/native \
      -DBUILD_SHARED_LIBS=OFF \
      -DENABLE_PLUGIN_LOADING=OFF \
      -DENABLE_MULTITHREADING_SUPPORT=OFF \
      -DENABLE_PARALLEL_TILE_DECODING=OFF \
      -DWITH_EXAMPLES=ON \
      -DWITH_LIBDE265=ON \
      -DWITH_LIBDE265_PLUGIN=OFF \
      -DWITH_X265=OFF \
      -DWITH_X265_PLUGIN=OFF \
      -DWITH_X264=OFF \
      -DWITH_X264_PLUGIN=OFF \
      -DWITH_AOM_DECODER=OFF \
      -DWITH_AOM_ENCODER=OFF \
      -DWITH_DAV1D=OFF \
      -DWITH_DAV1D_PLUGIN=OFF \
      -DWITH_RAV1E=OFF \
      -DWITH_SvtEnc=OFF \
      -DWITH_FFMPEG_DECODER=OFF \
      -DWITH_FFMPEG_DECODER_PLUGIN=OFF \
      -DWITH_OpenH264_DECODER=OFF \
      -DWITH_OpenH264_ENCODER=OFF \
      -DWITH_JPEG_DECODER=OFF \
      -DWITH_JPEG_DECODER_PLUGIN=OFF \
      -DWITH_JPEG_ENCODER=OFF \
      -DWITH_JPEG_ENCODER_PLUGIN=OFF \
      -DWITH_UNCOMPRESSED_CODEC=OFF \
      -DWITH_KVAZAAR=OFF \
      -DWITH_OPENJPEG_DECODER=OFF \
      -DWITH_OPENJPEG_ENCODER=OFF \
      -DWITH_OPENJPH_ENCODER=OFF \
      -DWITH_UVG266=OFF \
      -DWITH_VVDEC=OFF \
      -DWITH_VVENC=OFF \
      -DWITH_WEBCODECS=OFF \
      -DWITH_GDK_PIXBUF=OFF \
      -DWITH_GOBJECT=OFF \
    && cmake --build libheif/build --target heif-convert --parallel \
    && install -D -m 0755 libheif/build/examples/heif-convert /native/heif-convert \
    && sha256sum /native/heif-convert | cut -d ' ' -f 1 > /native/heif-convert.sha256 \
    && git -C libheif rev-parse HEAD > /native/libheif.commit \
    && git -C libde265 rev-parse HEAD > /native/libde265.commit \
    && ldd /native/heif-convert > /native/linked-libraries.txt \
    && ! grep -Eq 'lib(heif|de265|x265|aom|dav1d|jpeg|avcodec)' /native/linked-libraries.txt

FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS node-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS runtime
ARG LIBHEIF_REF=v1.23.3
ARG LIBDE265_REF=v1.1.1
RUN apt-get update \
    && apt-get install -y --no-install-recommends libpng16-16 util-linux \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 converter \
    && useradd --system --uid 10001 --gid converter --home-dir /nonexistent --shell /usr/sbin/nologin converter \
    && install -d -o converter -g converter -m 0700 /tmp/heif-converter /opt/heif-converter

WORKDIR /app
COPY --from=node-dependencies --chown=converter:converter /app/node_modules ./node_modules
COPY --chown=converter:converter package.json ./
COPY --chown=converter:converter src ./src
COPY --from=native-builder /native/heif-convert /usr/local/bin/heif-convert
COPY --from=native-builder /native/heif-convert.sha256 /tmp/heif-convert.sha256
COPY --from=native-builder /native/libheif.commit /tmp/libheif.commit
COPY --from=native-builder /native/libde265.commit /tmp/libde265.commit
RUN HEIF_SHA="$(cat /tmp/heif-convert.sha256)" \
    && HEIF_COMMIT="$(cat /tmp/libheif.commit)" \
    && DE265_COMMIT="$(cat /tmp/libde265.commit)" \
    && printf '{"libheif":"1.23.3","libde265":"1.1.1","libheifRef":"%s","libde265Ref":"%s","libheifCommit":"%s","libde265Commit":"%s","heifConvertSha256":"%s"}\n' \
      "${LIBHEIF_REF}" "${LIBDE265_REF}" "${HEIF_COMMIT}" "${DE265_COMMIT}" "${HEIF_SHA}" > /opt/heif-converter/native-versions.json \
    && chmod 0444 /opt/heif-converter/native-versions.json \
    && rm /tmp/heif-convert.sha256 /tmp/libheif.commit /tmp/libde265.commit

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    TEMP_ROOT=/tmp/heif-converter \
    HEIF_CONVERT_PATH=/usr/local/bin/heif-convert \
    PRLIMIT_PATH=/usr/bin/prlimit \
    NATIVE_VERSION_MANIFEST=/opt/heif-converter/native-versions.json

USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "src/index.js"]
