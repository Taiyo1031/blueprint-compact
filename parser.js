(function (root) {
  "use strict";

  function utf8Size(text) {
    return new TextEncoder().encode(text).length;
  }

  function stripOuterParentheses(value) {
    const trimmed = String(value || "").trim();
    if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  }

  function decodeValue(value) {
    const trimmed = String(value ?? "").trim();
    if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
      return trimmed
        .slice(1, -1)
        .replace(/\\"/g, '"')
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        .replace(/\\\\/g, "\\");
    }
    return trimmed;
  }

  function parseAssignments(source) {
    const values = {};
    let cursor = 0;

    while (cursor < source.length) {
      while (cursor < source.length && /[\s,]/.test(source[cursor])) cursor += 1;
      if (cursor >= source.length) break;

      const keyStart = cursor;
      while (cursor < source.length && source[cursor] !== "=") cursor += 1;
      if (cursor >= source.length) break;

      const key = source.slice(keyStart, cursor).trim();
      cursor += 1;
      const valueStart = cursor;
      let depth = 0;
      let quoted = false;
      let escaped = false;

      while (cursor < source.length) {
        const character = source[cursor];
        if (quoted) {
          if (escaped) escaped = false;
          else if (character === "\\") escaped = true;
          else if (character === '"') quoted = false;
        } else if (character === '"') {
          quoted = true;
        } else if (character === "(") {
          depth += 1;
        } else if (character === ")") {
          depth = Math.max(0, depth - 1);
        } else if (character === "," && depth === 0) {
          break;
        }
        cursor += 1;
      }

      if (key) values[key] = source.slice(valueStart, cursor).trim();
      if (source[cursor] === ",") cursor += 1;
    }

    return values;
  }

  function extractObjectBlocks(text) {
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    const blocks = [];
    let current = null;
    let depth = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (/^Begin Object\b/.test(trimmed)) {
        if (depth === 0) current = [];
        depth += 1;
      }

      if (current) current.push(line);

      if (/^End Object\b/.test(trimmed) && depth > 0) {
        depth -= 1;
        if (depth === 0 && current) {
          blocks.push(current);
          current = null;
        }
      }
    }

    return blocks;
  }

  function quotedParts(value) {
    const parts = [];
    const expression = /"((?:\\.|[^"\\])*)"/g;
    let match;
    while ((match = expression.exec(String(value || "")))) {
      parts.push(decodeValue(`"${match[1]}"`));
    }
    return parts;
  }

  function humanize(value) {
    return String(value || "")
      .replace(/^Receive/, "")
      .replace(/^K2_/, "")
      .replace(/_/g, " ")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .replace(/\s+/g, " ")
      .trim();
  }

  function shortClassName(classPath) {
    const match = String(classPath || "").match(/([A-Za-z0-9_]+)(?:'|$)/);
    const raw = match ? match[1] : String(classPath || "");
    return raw.replace(/^K2Node_/, "") || "Node";
  }

  function displayNodeType(classPath) {
    const short = shortClassName(classPath);
    const aliases = {
      IfThenElse: "Branch",
      ExecutionSequence: "Sequence",
      DynamicCast: "Cast",
      CallFunction: "Call Function",
      VariableGet: "Variable Get",
      VariableSet: "Variable Set",
      MacroInstance: "Macro",
      CustomEvent: "Custom Event",
      Knot: "Reroute",
    };
    return aliases[short] || humanize(short);
  }

  function referenceMember(properties, propertyName, memberNames) {
    const raw = properties[propertyName];
    if (!raw) return "";
    const fields = parseAssignments(stripOuterParentheses(raw));
    for (const memberName of memberNames) {
      if (fields[memberName]) return decodeValue(fields[memberName]);
    }
    return "";
  }

  function displayNodeName(classPath, properties) {
    const short = shortClassName(classPath);
    const customName = decodeValue(properties.CustomFunctionName || "");
    const functionName = referenceMember(properties, "FunctionReference", ["MemberName"]);
    const eventName = referenceMember(properties, "EventReference", ["MemberName"]);
    const variableName = referenceMember(properties, "VariableReference", ["MemberName"]);
    const macroName = referenceMember(properties, "MacroGraphReference", ["GraphName", "MemberName"]);

    if (short === "CustomEvent" && customName) return `Event ${humanize(customName)}`;
    if (short === "Event" && eventName) return `Event ${humanize(eventName)}`;
    if (short === "VariableGet" && variableName) return `Get ${humanize(variableName)}`;
    if (short === "VariableSet" && variableName) return `Set ${humanize(variableName)}`;
    if (short === "MacroInstance" && macroName) return humanize(macroName);
    if (functionName) return humanize(functionName);
    if (customName) return humanize(customName);
    return displayNodeType(classPath);
  }

  function extractTypeName(category, subCategory, objectPath) {
    const sub = decodeValue(subCategory || "");
    if (sub && sub !== "None") return humanize(sub);

    const objectValue = decodeValue(objectPath || "");
    if (objectValue && objectValue !== "None") {
      const clean = objectValue.replace(/['"]/g, "");
      const last = clean.split(/[./]/).filter(Boolean).pop();
      if (last) return humanize(last);
    }

    return humanize(decodeValue(category || "wildcard"));
  }

  function friendlyPinName(fields, direction, category) {
    const friendly = fields.PinFriendlyName;
    if (friendly) {
      const parts = quotedParts(friendly);
      if (parts.length) return parts[parts.length - 1];
    }

    const rawName = decodeValue(fields.PinName || "");
    if (/^execute$/i.test(rawName)) return "Exec";
    if (/^then$/i.test(rawName)) return "Then";
    if (rawName) return humanize(rawName);
    if (decodeValue(category) === "exec") return direction === "output" ? "Then" : "Exec";
    return "Pin";
  }

  function parsePin(line) {
    const marker = line.indexOf("CustomProperties Pin");
    const open = line.indexOf("(", marker);
    const close = line.lastIndexOf(")");
    if (marker < 0 || open < 0 || close <= open) return null;

    const fields = parseAssignments(line.slice(open + 1, close));
    const id = decodeValue(fields.PinId || "");
    if (!id) return null;

    const direction = /EGPD_Output/i.test(decodeValue(fields.Direction || "")) ? "output" : "input";
    const category = decodeValue(fields["PinType.PinCategory"] || "wildcard");
    const defaultValue = decodeValue(
      fields.DefaultValue || fields.DefaultObject || fields.DefaultTextValue || ""
    );

    return {
      id,
      name: friendlyPinName(fields, direction, category),
      rawName: decodeValue(fields.PinName || ""),
      direction,
      category,
      type: extractTypeName(
        fields["PinType.PinCategory"],
        fields["PinType.PinSubCategory"],
        fields["PinType.PinSubCategoryObject"]
      ),
      defaultValue,
      linkedTo: decodeValue(fields.LinkedTo || ""),
    };
  }

  function parseNodeBlock(lines, index) {
    const header = lines[0].trim();
    const classMatch = header.match(/\bClass=([^\s]+(?:'[^']*')?)/);
    const nameMatch = header.match(/\bName="([^"]+)"/);
    const classPath = classMatch ? classMatch[1] : "K2Node_Unknown";
    const rawName = nameMatch ? nameMatch[1] : `Node_${index}`;
    const properties = {};
    const pins = [];
    let malformedPins = 0;

    for (const line of lines.slice(1, -1)) {
      if (line.includes("CustomProperties Pin")) {
        const pin = parsePin(line);
        if (pin) pins.push(pin);
        else malformedPins += 1;
        continue;
      }

      const propertyMatch = line.trim().match(/^([A-Za-z][A-Za-z0-9_]*)=(.*)$/);
      if (propertyMatch) properties[propertyMatch[1]] = propertyMatch[2].trim();
    }

    const positionX = Number.parseInt(decodeValue(properties.NodePosX || "0"), 10);
    const positionY = Number.parseInt(decodeValue(properties.NodePosY || "0"), 10);

    return {
      id: `N${index}`,
      rawName,
      name: displayNodeName(classPath, properties),
      type: displayNodeType(classPath),
      class: shortClassName(classPath),
      classPath,
      position: {
        x: Number.isFinite(positionX) ? positionX : 0,
        y: Number.isFinite(positionY) ? positionY : 0,
      },
      guid: decodeValue(properties.NodeGuid || ""),
      comment: decodeValue(properties.NodeComment || ""),
      pins,
      malformedPins,
      exportPath: decodeValue(properties.ExportPath || ""),
    };
  }

  function linkedReferences(value) {
    const references = [];
    const expression = /([A-Za-z_][A-Za-z0-9_]*)\s+([A-Fa-f0-9-]{16,})/g;
    let match;
    while ((match = expression.exec(String(value || "")))) {
      references.push({ nodeName: match[1], pinId: match[2] });
    }
    return references;
  }

  function resolveConnections(nodes) {
    const nodesByName = new Map(nodes.map((node) => [node.rawName, node]));
    const pinsById = new Map();
    for (const node of nodes) {
      for (const pin of node.pins) pinsById.set(pin.id, { node, pin });
    }

    const connections = [];
    const seen = new Set();
    let unresolvedLinks = 0;

    for (const node of nodes) {
      for (const pin of node.pins) {
        for (const reference of linkedReferences(pin.linkedTo)) {
          const target = pinsById.get(reference.pinId);
          if (!target || (reference.nodeName && !nodesByName.has(reference.nodeName))) {
            unresolvedLinks += 1;
            continue;
          }

          const pairKey = [pin.id, target.pin.id].sort().join(":");
          if (seen.has(pairKey)) continue;
          seen.add(pairKey);

          let from = { node, pin };
          let to = target;
          if (pin.direction !== "output" && target.pin.direction === "output") {
            from = target;
            to = { node, pin };
          }

          connections.push({
            from: { node: from.node.id, pin: from.pin.name, pinId: from.pin.id },
            to: { node: to.node.id, pin: to.pin.name, pinId: to.pin.id },
            type: pin.category === "exec" || target.pin.category === "exec" ? "execution" : "data",
          });
        }
      }
    }

    return { connections, unresolvedLinks };
  }

  function inferGraphName(nodes) {
    for (const node of nodes) {
      const source = node.exportPath || "";
      const match = source.match(/\/([^/'"]+)\.([^:'"]+):([^.'"]+)/);
      if (match) return `${match[2]}_${match[3]}`;
    }
    return "Blueprint";
  }

  function looksLikeBlueprint(text) {
    return (
      typeof text === "string" &&
      /Begin Object\s+Class=/m.test(text) &&
      (/K2Node_/m.test(text) || /CustomProperties\s+Pin\s*\(/m.test(text))
    );
  }

  function parseBlueprintText(text) {
    if (!looksLikeBlueprint(text)) {
      throw new Error("NOT_BLUEPRINT");
    }

    const blocks = extractObjectBlocks(text);
    const nodeBlocks = blocks.filter((block) => {
      const header = block[0] || "";
      return /\bClass=.*(?:K2Node_|EdGraphNode_Comment|BlueprintGraph)/.test(header);
    });

    if (!nodeBlocks.length) throw new Error("NO_NODES");

    const nodes = nodeBlocks.map((block, index) => parseNodeBlock(block, index));
    const { connections, unresolvedLinks } = resolveConnections(nodes);
    const pinCount = nodes.reduce((total, node) => total + node.pins.length, 0);
    const malformedPins = nodes.reduce((total, node) => total + node.malformedPins, 0);

    return {
      metadata: {
        sourceSize: utf8Size(text),
        nodeCount: nodes.length,
        pinCount,
        connectionCount: connections.length,
        warningCount: malformedPins + unresolvedLinks,
        graphName: inferGraphName(nodes),
      },
      nodes,
      connections,
    };
  }

  root.BlueprintCompactParser = {
    looksLikeBlueprint,
    parseBlueprintText,
  };
})(typeof window !== "undefined" ? window : globalThis);
