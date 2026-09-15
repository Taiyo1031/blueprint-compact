(function (root) {
  "use strict";
  const SAMPLE_LIMIT = 3;
  const ARRAY_LIMIT = 32;
  const numberPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
  const decode = (value) => {
    const text = String(value || "").trim();
    if (!text.startsWith('"') || !text.endsWith('"')) return text;
    try { return JSON.parse(text); } catch (_) { return text.slice(1, -1); }
  };

  function headerField(line, name) {
    const match = line.match(new RegExp(`\\b${name}=("(?:\\\\.|[^"\\\\])*"|[^\\s]+)`));
    return match ? decode(match[1]) : "";
  }

  function createObject(line, kind, id) {
    return {
      id, kind, name: headerField(line, "Name"), class: headerField(line, "Class"),
      archetype: headerField(line, "Archetype"), sourcePath: headerField(line, "ExportPath"),
      properties: Object.create(null), children: new Map(), arrays: new Map(),
    };
  }

  function extendRange(range, value) {
    if (!Number.isFinite(value)) return range;
    if (!range) return { min: value, max: value };
    range.min = Math.min(range.min, value);
    range.max = Math.max(range.max, value);
    return range;
  }

  function arrayEntry(object, key, index, value) {
    let array = object.arrays.get(key);
    if (!array) {
      array = { count: 0, firstIndex: index, lastIndex: index, contiguous: true, entries: [], examples: [],
        summarize: /^PerInstanceSM(?:Data|CustomData)$/.test(key), numericCount: 0, numericRange: null,
        translationCount: 0, translationRanges: Object.create(null) };
      object.arrays.set(key, array);
    }
    if (array.count && index !== array.lastIndex + 1) array.contiguous = false;
    array.count++;
    array.firstIndex = Math.min(array.firstIndex, index);
    array.lastIndex = index;
    const entry = { index, value: decode(value) };
    if (array.examples.length < SAMPLE_LIMIT) array.examples.push(entry);
    if (!array.summarize && array.count <= ARRAY_LIMIT) array.entries.push(entry);
    else { array.summarize = true; array.entries = []; }
    if (numberPattern.test(value)) {
      const number = Number(value);
      if (Number.isFinite(number)) {
        array.numericCount++;
        array.numericRange = extendRange(array.numericRange, number);
      }
    }
    if (key === "PerInstanceSMData") {
      const plane = value.match(/\bWPlane=\(([^)]*)\)/);
      if (plane) {
        let axes = 0;
        for (const axis of ["X", "Y", "Z"]) {
          const match = plane[1].match(new RegExp(`\\b${axis}=([^,)]+)`));
          if (match && numberPattern.test(match[1]) && Number.isFinite(Number(match[1]))) {
            array.translationRanges[axis] = extendRange(array.translationRanges[axis], Number(match[1]));
            axes++;
          }
        }
        if (axes === 3) array.translationCount++;
      }
    }
  }

  // Incremental parser: keeps only small arrays and running summaries, not the
  // hundreds of thousands of instance rows commonly copied with a PCG actor.
  function createActorParser() {
    const actors = [];
    const stack = [];
    let objectIndex = 0;
    let ignoredLines = 0;
    let sawActor = false;
    let pending = "";
    function line(rawLine) {
      const text = rawLine.trim().replace(/^\uFEFF/, "");
      if (!text) return;
      const begin = text.match(/^Begin (\w+)\b/);
      if (begin) {
        const kind = begin[1];
        if (!["Map", "Level", "Actor", "Object", "Surface"].includes(kind)) ignoredLines++;
        const owner = stack[stack.length - 1]?.object;
        let object = null;
        if (kind === "Actor") {
          if (stack.some((entry) => entry.kind === "Actor")) throw new Error("INCOMPLETE_ACTOR");
          object = createObject(text, kind, `A${actors.length}`);
          actors.push(object);
          sawActor = true;
        } else if (kind === "Object") {
          if (!owner) throw new Error("INCOMPLETE_ACTOR");
          const name = headerField(text, "Name");
          if (!name) throw new Error("INCOMPLETE_ACTOR");
          object = owner.children.get(name);
          if (!object) {
            object = createObject(text, kind, `O${objectIndex++}`);
            owner.children.set(name, object);
          } else {
            for (const [key, field] of [["class", "Class"], ["archetype", "Archetype"], ["sourcePath", "ExportPath"]]) {
              const value = headerField(text, field);
              if (value) object[key] = value;
            }
          }
        }
        stack.push({ kind, object });
        return;
      }
      const end = text.match(/^End (\w+)\b/);
      if (end) {
        if (stack.pop()?.kind !== end[1]) throw new Error("INCOMPLETE_ACTOR");
        return;
      }
      const object = stack[stack.length - 1]?.object;
      const property = text.match(/^([A-Za-z_][\w.]*)(?:\((\d+)\))?=(.*)$/);
      if (object && property) {
        if (property[2] !== undefined) arrayEntry(object, property[1], Number(property[2]), property[3]);
        else object.properties[property[1]] = decode(property[3]);
      } else ignoredLines++;
    }
    function push(chunk) {
      const input = pending + chunk;
      let start = 0;
      for (;;) {
        const end = input.indexOf("\n", start);
        if (end < 0) break;
        line(input.slice(start, end));
        start = end + 1;
      }
      pending = input.slice(start);
      if (pending.length > 8 * 1024 * 1024) throw new Error("ACTOR_LINE_TOO_LONG");
    }
    function finish(sourceSize) {
      if (pending) line(pending);
      pending = "";
      if (stack.length) throw new Error("INCOMPLETE_ACTOR");
      if (!sawActor) throw new Error("NO_ACTORS");
      let instanceCount = 0, customValueCount = 0, summarizedArrayCount = 0;
      let irregularArrays = 0;
      function serialize(object) {
        const arrays = Object.create(null);
        for (const [key, array] of object.arrays) {
          if (key === "PerInstanceSMData") instanceCount += array.count;
          if (key === "PerInstanceSMCustomData") customValueCount += array.count;
          if (!array.contiguous) irregularArrays++;
          arrays[key] = {
            count: array.count, mode: array.summarize ? "summary" : "complete",
            contiguousIndices: array.contiguous,
            ...(array.summarize ? {
              examples: array.examples, omittedEntries: array.count - array.examples.length,
              ...(array.numericRange ? { numericRange: array.numericRange, numericValues: array.numericCount } : {}),
              ...(array.translationCount ? {
                serializedWPlaneXYZ: array.translationRanges, transformRowsMeasured: array.translationCount,
              } : {}),
            } : { entries: array.entries }),
          };
          if (array.summarize) summarizedArrayCount++;
        }
        return {
          id: object.id, name: object.name, class: object.class || "Unknown",
          ...(object.archetype ? { archetype: object.archetype } : {}),
          ...(object.sourcePath ? { sourcePath: object.sourcePath } : {}),
          properties: object.properties,
          ...(object.arrays.size ? { arrays } : {}),
          ...(object.children.size ? { objects: [...object.children.values()].map(serialize) } : {}),
        };
      }
      const result = actors.map(serialize);
      return {
        metadata: {
          graphType: "Actor", graphName: result[0].properties.ActorLabel || result[0].name || "Actors",
          sourceSize, actorCount: actors.length, objectCount: objectIndex, instanceCount, customValueCount,
          summarizedArrayCount, ignoredLines, irregularArrays, warningCount: ignoredLines + irregularArrays,
          arrayDetailLimit: ARRAY_LIMIT, exampleLimit: SAMPLE_LIMIT,
        },
        actors: result,
      };
    }
    return { push, finish };
  }

  function looksLikeActor(text) {
    return /^\s*(?:\uFEFF)?\s*Begin (?:Map|Actor)\b/.test(text);
  }
  function parseActorText(text) {
    const parser = createActorParser();
    for (let offset = 0; offset < text.length; offset += 262144) parser.push(text.slice(offset, offset + 262144));
    return parser.finish(new TextEncoder().encode(text).length);
  }
  root.BlueprintCompactActorParser = { createActorParser, looksLikeActor, parseActorText };
})(typeof window !== "undefined" ? window : globalThis);
