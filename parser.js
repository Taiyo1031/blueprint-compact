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
    const values = Object.create(null);
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

    if (depth !== 0) throw new Error("INCOMPLETE_GRAPH");
    return blocks;
  }

  // UE emits a declaration followed by a value block for the same child.
  // Merge by name within each owner, never across unrelated editor nodes.
  function objectTree(lines) {
    const container = { children: [] };
    const stack = [container];
    for (const line of lines) {
      const text = line.trim();
      if (/^Begin Object\b/.test(text)) {
        const name = (text.match(/\bName="([^"]+)"/) || [])[1] || "Object";
        const classPath = (text.match(/\bClass=([^\s]+)/) || [])[1] || "";
        const exportPath = (text.match(/\bExportPath="([^"]+)"/) || [])[1] || "";
        const parent = stack[stack.length - 1];
        let object = parent.children.find((child) => child.name === name);
        if (!object) {
          object = { name, classPath, exportPath, properties: Object.create(null), children: [], pinLines: [] };
          parent.children.push(object);
        }
        if (classPath) object.classPath = classPath;
        if (exportPath) object.exportPath = exportPath;
        stack.push(object);
      } else if (/^End Object\b/.test(text)) {
        stack.pop();
      } else {
        const object = stack[stack.length - 1];
        if (text.startsWith("CustomProperties Pin")) object.pinLines.push(text);
        else {
          const match = text.match(/^([A-Za-z_][A-Za-z0-9_.]*(?:\(\d+\))?)=(.*)$/);
          if (match && object.properties) object.properties[match[1]] = match[2].trim();
        }
      }
    }
    return container.children[0];
  }

  function graphType(classPath) {
    if (/MaterialGraphNode/.test(classPath)) return "Material";
    if (/PCGEditorGraph/.test(classPath)) return "PCG";
    if (/K2Node_|BlueprintGraph|EdGraphNode_Comment/.test(classPath)) return "Blueprint";
    if (/Niagara/.test(classPath)) return "Niagara";
    return "Unknown";
  }

  function walkObjects(object) {
    return [object, ...object.children.flatMap(walkObjects)];
  }

  function referenceName(value) {
    return decodeValue(value).replace(/'$/, "").split(/[.']/).pop();
  }

  function semanticProperties(properties) {
    return Object.fromEntries(Object.entries(properties)
      .filter(([key]) => !/^(?:NodePos[XY]|Position[XY]|MaterialExpressionEditor[XY]|NodeGuid|MaterialExpressionGuid|NodeComment|Material|GraphNode|MaterialExpression|PCGNode|bCanRenameNode|bCommentBubbleVisible|bCommentBubblePinned|CachedOverridableParams(?:\(\d+\))?)$/.test(key))
      .map(([key, value]) => [key, decodeValue(value)]));
  }

  function semanticObject(object) {
    // PCGEdge duplicates editor pin links; PCGPin metadata is kept without edges.
    return {
      name: object.name,
      class: object.classPath || "Unknown",
      properties: semanticProperties(object.properties),
      ...(object.children.some((child) => !/\.PCGEdge$/.test(child.classPath)) ? {
        objects: object.children.filter((child) => !/\.PCGEdge$/.test(child.classPath)).map(semanticObject),
      } : {}),
    };
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
      if (parts.length && parts[parts.length - 1].trim()) return parts[parts.length - 1];
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
    const object = objectTree(lines);
    const classPath = object.classPath;
    const rawName = object.name;
    const properties = object.properties;
    const kind = graphType(classPath);
    const descendants = walkObjects(object).slice(1);
    const expression = object.children.find((child) => child.name === referenceName(properties.MaterialExpression));
    const pcgNode = object.children.find((child) => child.name === referenceName(properties.PCGNode));
    const settings = pcgNode?.children.find((child) => child.name === referenceName(pcgNode.properties.SettingsInterface));
    const implementation = expression || settings;
    const pins = [];
    let malformedPins = 0;

    for (const line of object.pinLines) {
        const pin = parsePin(line);
        if (pin) {
          if (kind !== "Blueprint") {
            pin.name = pin.rawName || pin.name;
            if (kind === "Material") {
              pin.type = "unspecified";
              pin.requirement = /^(required|optional)$/.test(pin.category) ? pin.category : undefined;
            }
            if (kind === "PCG") {
              const internalPin = descendants.find((child) => /\.PCGPin$/.test(child.classPath) &&
                decodeValue(parseAssignments(stripOuterParentheses(child.properties.Properties)).Label) === pin.rawName);
              if (internalPin) {
                const info = parseAssignments(stripOuterParentheses(internalPin.properties.Properties));
                if (info.AllowedTypes) pin.type = decodeValue(info.AllowedTypes);
                if (info.Usage === "DependencyOnly") pin.category = "dependency";
              }
            }
          }
          pins.push(pin);
        }
        else malformedPins += 1;
    }

    const positionX = Number.parseInt(decodeValue(properties.NodePosX || "0"), 10);
    const positionY = Number.parseInt(decodeValue(properties.NodePosY || "0"), 10);

    return {
      id: `N${index}`,
      rawName,
      name: implementation ? decodeValue(implementation.properties.ParameterName || implementation.properties.PropertyName ||
        implementation.properties.OutputName || implementation.properties.InputName || implementation.properties.Name ||
        pcgNode?.properties.NodeTitle || "") || humanize(shortClassName(implementation.classPath).replace(/^MaterialExpression|^PCG|Settings$/g, "")) : displayNodeName(classPath, properties),
      type: implementation ? humanize(shortClassName(implementation.classPath).replace(/^MaterialExpression|^PCG|Settings$/g, "")) : displayNodeType(classPath),
      graphType: kind,
      class: shortClassName(classPath),
      classPath,
      position: {
        x: Number.isFinite(positionX) ? positionX : 0,
        y: Number.isFinite(positionY) ? positionY : 0,
      },
      guid: decodeValue(properties.NodeGuid || ""),
      comment: decodeValue(properties.NodeComment || expression?.properties.Text || ""),
      pins,
      malformedPins,
      exportPath: object.exportPath,
      ...(kind !== "Blueprint" ? {
        properties: semanticProperties(properties),
        objects: object.children.map(semanticObject),
        objectNames: descendants.map((child) => child.name),
        declaration: expression?.properties.Declaration || "",
      } : {}),
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
      for (const pin of node.pins) pinsById.set(`${node.rawName}:${pin.id}`, { node, pin });
    }

    const connections = [];
    const seen = new Set();
    let unresolvedLinks = 0;

    for (const node of nodes) {
      for (const pin of node.pins) {
        for (const reference of linkedReferences(pin.linkedTo)) {
          const target = pinsById.get(`${reference.nodeName}:${reference.pinId}`);
          if (!target || (reference.nodeName && !nodesByName.has(reference.nodeName))) {
            unresolvedLinks += 1;
            continue;
          }

          const pairKey = [`${node.id}:${pin.id}`, `${target.node.id}:${target.pin.id}`].sort().join(":");
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
            type: pin.category === "exec" || target.pin.category === "exec" ? "execution" :
              pin.category === "dependency" || target.pin.category === "dependency" ? "dependency" : "data",
          });
        }
      }
    }

    return { connections, unresolvedLinks };
  }

  function resolveMaterialReferences(nodes) {
    const references = [];
    let unresolved = 0;
    for (const node of nodes) {
      if (!node.declaration || decodeValue(node.declaration) === "None") continue;
      const path = decodeValue(node.declaration).split("'")[1] || "";
      const target = nodes.find((candidate) => candidate.graphType === "Material" &&
        candidate.objectNames?.some((name) => path === `${candidate.rawName}.${name}` ||
          path.endsWith(`.${candidate.rawName}.${name}`)));
      references.push({ from: node.id, to: target?.id || null, property: "Declaration", target: decodeValue(node.declaration) });
      if (!target) unresolved += 1;
    }
    return { references, unresolved };
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
      (/K2Node_|MaterialGraphNode|PCGEditorGraph|EdGraphNode_Comment/m.test(text) || /CustomProperties\s+Pin\s*\(/m.test(text))
    );
  }

  function parseBlueprintText(text) {
    if (!looksLikeBlueprint(text)) {
      throw new Error("NOT_BLUEPRINT");
    }

    const blocks = extractObjectBlocks(text);
    const nodeBlocks = blocks.filter((block) => {
      const header = block[0] || "";
      return /\bClass=.*(?:K2Node_|EdGraphNode_Comment|BlueprintGraph|MaterialGraphNode|PCGEditorGraph)/.test(header) ||
        objectTree(block).pinLines.length > 0;
    });

    if (!nodeBlocks.length) throw new Error("NO_NODES");

    const nodes = nodeBlocks.map((block, index) => parseNodeBlock(block, index));
    const { connections, unresolvedLinks } = resolveConnections(nodes);
    const { references, unresolved } = resolveMaterialReferences(nodes);
    const graphTypes = [...new Set(nodes.map((node) => node.graphType))];
    const kind = graphTypes.length === 1 ? graphTypes[0] : "Mixed";
    const genericNodes = nodes.filter((node) => !["Blueprint", "Material", "PCG"].includes(node.graphType)).length;
    const pinCount = nodes.reduce((total, node) => total + node.pins.length, 0);
    const malformedPins = nodes.reduce((total, node) => total + node.malformedPins, 0);

    return {
      metadata: {
        sourceSize: utf8Size(text),
        nodeCount: nodes.length,
        pinCount,
        connectionCount: connections.length,
        warningCount: malformedPins + unresolvedLinks + unresolved + genericNodes + blocks.length - nodeBlocks.length,
        unresolvedLinks,
        unresolvedReferences: unresolved,
        genericNodes,
        skippedObjects: blocks.length - nodeBlocks.length,
        graphType: kind,
        referenceCount: references.length,
        graphName: inferGraphName(nodes),
      },
      nodes,
      connections,
      references,
    };
  }

  root.BlueprintCompactParser = {
    looksLikeBlueprint,
    parseBlueprintText,
  };
})(typeof window !== "undefined" ? window : globalThis);
