(function (root) {
  "use strict";

  function pinIsUseful(pin) {
    return Boolean(pin.defaultValue || pin.linkedTo || (pin.name && !["Exec", "Then", "Pin"].includes(pin.name)));
  }

  function filterGraph(graph, settings, preset) {
    const compactMode = preset === "compact";
    const nodes = graph.nodes.map((node) => {
      const result = { id: node.id };
      if (settings.includeNodeName) result.name = node.name;
      if (settings.includeNodeType) result.type = node.type;
      if (settings.includeComments && node.comment) result.comment = node.comment;
      if (settings.includePosition) result.position = node.position;
      if (settings.includeGuid && node.guid) result.guid = node.guid;

      const selectedPins = compactMode ? node.pins.filter(pinIsUseful) : node.pins;
      if (
        selectedPins.length &&
        (settings.includePinName || settings.includePinType || settings.includeDefaultValue)
      ) {
        result.pins = selectedPins.map((pin) => {
          const pinResult = {};
          if (settings.includePinName) {
            pinResult.name = pin.name;
            pinResult.direction = pin.direction;
          }
          if (settings.includePinType) pinResult.type = pin.type;
          if (settings.includeDefaultValue && pin.defaultValue) pinResult.default = pin.defaultValue;
          return pinResult;
        });
      }
      return result;
    });

    const connections = graph.connections
      .filter((connection) =>
        connection.type === "execution"
          ? settings.includeExecConnections
          : settings.includeDataConnections
      )
      .map((connection) => ({
        from: `${connection.from.node}.${connection.from.pin}`,
        to: `${connection.to.node}.${connection.to.pin}`,
        type: connection.type,
      }));

    return {
      metadata: {
        nodes: graph.metadata.nodeCount,
        pins: graph.metadata.pinCount,
        connections: connections.length,
      },
      nodes,
      connections,
    };
  }

  function aiContext(language) {
    if (language === "en") {
      return {
        purpose: "This data represents Unreal Engine Blueprint nodes, pins, properties, and connection relationships.",
        instruction: "Analyze the Blueprint structure, explain what it does, and point out possible issues or improvements when useful.",
      };
    }
    return {
      purpose: "このデータは、Unreal Engine Blueprintのノード、ピン、設定値、接続関係を表しています。",
      instruction: "Blueprintの構造を読み取り、処理内容を説明してください。必要に応じて問題点や改善案も提示してください。",
    };
  }

  function addAiContext(filteredGraph, options = {}) {
    if (options.includeAiInstructions === false) return filteredGraph;
    return {
      ai_context: aiContext(options.language),
      ...filteredGraph,
    };
  }

  function exportCompactJson(filteredGraph, options = {}) {
    return JSON.stringify(addAiContext(filteredGraph, options));
  }

  function exportPrettyJson(filteredGraph, options = {}) {
    return JSON.stringify(addAiContext(filteredGraph, options), null, 2);
  }

  function pinLine(pin) {
    const name = pin.name || "Pin";
    const details = [];
    if (pin.type) details.push(pin.type);
    if (Object.prototype.hasOwnProperty.call(pin, "default")) details.push(`default: ${pin.default}`);
    return details.length ? `- ${name} (${details.join(", ")})` : `- ${name}`;
  }

  function exportMarkdown(filteredGraph, options = {}) {
    const lines = ["# Blueprint", ""];
    if (options.includeAiInstructions !== false) {
      const context = aiContext(options.language);
      lines.push("> AI context", ">", `> ${context.purpose}`, `> ${context.instruction}`, "");
    }
    lines.push(
      `${filteredGraph.metadata.nodes} ${filteredGraph.metadata.nodes === 1 ? "node" : "nodes"} · ` +
        `${filteredGraph.metadata.pins} ${filteredGraph.metadata.pins === 1 ? "pin" : "pins"} · ` +
        `${filteredGraph.metadata.connections} ${filteredGraph.metadata.connections === 1 ? "connection" : "connections"}`,
      ""
    );

    for (const node of filteredGraph.nodes) {
      const title = node.name || node.type || "Node";
      lines.push(`## ${node.id} — ${title}`, "");
      if (node.type && node.type !== title) lines.push(`Type: ${node.type}`, "");
      if (node.comment) lines.push(`Comment: ${node.comment}`, "");
      if (node.position) lines.push(`Position: ${node.position.x}, ${node.position.y}`, "");
      if (node.guid) lines.push(`GUID: ${node.guid}`, "");

      const pins = node.pins || [];
      const inputs = pins.filter((pin) => pin.direction !== "output");
      const outputs = pins.filter((pin) => pin.direction === "output");
      if (inputs.length) lines.push("Inputs:", ...inputs.map(pinLine), "");
      if (outputs.length) lines.push("Outputs:", ...outputs.map(pinLine), "");

      const outgoing = filteredGraph.connections.filter((connection) => connection.from.startsWith(`${node.id}.`));
      const execution = outgoing.filter((connection) => connection.type === "execution");
      const data = outgoing.filter((connection) => connection.type === "data");
      if (execution.length) {
        lines.push("Execution:", ...execution.map((connection) => `- ${connection.from} → ${connection.to}`), "");
      }
      if (data.length) {
        lines.push("Data:", ...data.map((connection) => `- ${connection.from} → ${connection.to}`), "");
      }
    }

    return lines.join("\n").trimEnd();
  }

  function exportByFormat(filteredGraph, format, options = {}) {
    if (format === "pretty-json") return exportPrettyJson(filteredGraph, options);
    if (format === "markdown") return exportMarkdown(filteredGraph, options);
    return exportCompactJson(filteredGraph, options);
  }

  root.BlueprintCompactExporter = {
    filterGraph,
    exportCompactJson,
    exportPrettyJson,
    exportMarkdown,
    exportByFormat,
  };
})(typeof window !== "undefined" ? window : globalThis);
