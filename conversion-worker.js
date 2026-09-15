"use strict";
importScripts("actor-parser.js", "parser.js");

self.onmessage = async ({ data }) => {
  try {
    const { file, text } = data;
    const chunkSize = 262144;
    const head = file ? await file.slice(0, 4096).text() : text.slice(0, 4096);
    const isActor = BlueprintCompactActorParser.looksLikeActor(head);
    let graph, sourcePreview = "", previewTruncated = false;
    if (isActor) {
      const parser = BlueprintCompactActorParser.createActorParser();
      const total = file ? file.size : text.length;
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let bytes = 0, lastProgress = -1;
      for (let offset = 0; offset < total; offset += chunkSize) {
        const chunk = file
          ? decoder.decode(await file.slice(offset, offset + chunkSize).arrayBuffer(), { stream: true })
          : text.slice(offset, offset + chunkSize);
        if (sourcePreview.length < 20000) sourcePreview += chunk.slice(0, 20000 - sourcePreview.length);
        parser.push(chunk);
        if (!file) {
          bytes += new TextEncoder().encode(chunk).length;
          // A surrogate pair split between chunks encodes as two replacements
          // rather than one code point; correct the byte count without retaining chunks.
          if (/[\uD800-\uDBFF]$/.test(chunk) && /^[\uDC00-\uDFFF]/.test(text.slice(offset + chunkSize, offset + chunkSize + 1))) bytes -= 2;
        }
        const progress = Math.floor(Math.min(1, (offset + chunkSize) / total) * 100);
        if (progress !== lastProgress) { self.postMessage({ progress }); lastProgress = progress; }
      }
      if (file) parser.push(decoder.decode());
      graph = parser.finish(file ? file.size : bytes);
      previewTruncated = (file ? file.size : text.length) > 20000;
    } else {
      const source = file ? await file.text() : text;
      graph = BlueprintCompactParser.parseBlueprintText(source);
      sourcePreview = source.slice(0, 20000);
      previewTruncated = source.length > sourcePreview.length;
    }
    self.postMessage({ graph, sourcePreview, previewTruncated });
  } catch (error) {
    self.postMessage({ error: error.message || "PARSE_FAILED" });
  }
};
