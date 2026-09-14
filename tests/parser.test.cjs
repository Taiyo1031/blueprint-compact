const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
require('../parser.js');
require('../exporter.js');
const { parseBlueprintText: parse } = globalThis.BlueprintCompactParser;
const exporter = globalThis.BlueprintCompactExporter;
const settings = Object.fromEntries(['NodeName', 'NodeType', 'NodeProperties', 'Comments', 'Position', 'Guid',
  'PinName', 'PinType', 'DefaultValue', 'ExecConnections', 'DataConnections'].map(key => ['include' + key, true]));
const a = 'A'.repeat(32), b = 'B'.repeat(32);
const pin = (id, name, output = false, link = '', category = 'real') =>
  `CustomProperties Pin (PinId=${id},PinName="${name}",${output ? 'Direction="EGPD_Output",' : ''}PinType.PinCategory="${category}",${link ? `LinkedTo=(${link},),` : ''}DefaultValue="0",)`;
const node = (name, cls, body) => `Begin Object Class=${cls} Name="${name}"\n${body}\nEnd Object`;
const bp = node('First', '/Script/BlueprintGraph.K2Node_CallFunction',
  `FunctionReference=(MemberName="PrintString")\n${pin(a, 'then', true, `Second ${b}`, 'exec')}`) + '\n' +
  node('Second', '/Script/BlueprintGraph.K2Node_CallFunction', pin(b, 'execute', false, `First ${a}`, 'exec'));

test('Blueprint regression: names, direction, reciprocal deduplication and formats', () => {
  const graph = parse(bp);
  assert.equal(graph.metadata.graphType, 'Blueprint');
  assert.equal(graph.nodes[0].name, 'Print String');
  assert.equal(graph.connections.length, 1);
  assert.equal(graph.connections[0].type, 'execution');
  assert.equal(graph.connections[0].from.node, 'N0');
  const output = exporter.filterGraph(graph, settings, 'standard');
  for (const language of ['ja', 'en']) {
    for (const format of ['compact-json', 'pretty-json']) {
      const parsed = JSON.parse(exporter.exportByFormat(output, format, { language }));
      assert.equal(parsed.nodes[0].pins[0].default, '0');
      assert.match(parsed.ai_context.purpose, /Blueprint/);
    }
    assert.match(exporter.exportMarkdown(output, { language }), /Execution:/);
  }
  assert.equal(JSON.parse(exporter.exportCompactJson(output, { includeAiInstructions: false })).ai_context, undefined);
});

test('Material declarations merge within owner; nested and indexed values survive', () => {
  const materialNode = (name, value) => node(name, '/Script/UnrealEd.MaterialGraphNode',
    `Begin Object Class=/Script/Engine.MaterialExpressionScalarParameter Name="Expr"\nEnd Object\n` +
    `Begin Object Name="Expr"\nParameterName="Amount"\nDefaultValue=${value}\nOutputs(0)=(OutputName="Value")\nNodePosX=999\nEnd Object\n` +
    `MaterialExpression="/Script/Engine.MaterialExpressionScalarParameter'Expr'"\nNodePosX=10\n` + pin(a, 'Input', false, '', 'required'));
  const graph = parse(materialNode('MatA', 0) + '\n' + materialNode('MatB', 2));
  assert.equal(graph.nodes[0].position.x, 10);
  assert.equal(graph.nodes[0].name, 'Amount');
  assert.equal(graph.nodes[0].objects.length, 1);
  assert.equal(graph.nodes[0].objects[0].properties.DefaultValue, '0');
  assert.equal(graph.nodes[1].objects[0].properties.DefaultValue, '2');
  assert.equal(graph.nodes[0].objects[0].properties['Outputs(0)'], '(OutputName="Value")');
  assert.equal(graph.nodes[0].pins[0].type, 'unspecified');
  assert.equal(graph.nodes[0].pins[0].requirement, 'required');
  const filtered = exporter.filterGraph(graph, settings, 'compact');
  assert.equal(filtered.nodes[0].objects[0].class, '/Script/Engine.MaterialExpressionScalarParameter');
  assert.match(exporter.exportMarkdown(filtered), /DefaultValue/);
  assert.equal(exporter.filterGraph(graph, { ...settings, includeNodeProperties: false }, 'standard').nodes[0].objects, undefined);
});

test('Named Reroute references are separate from wires, including partial selections', () => {
  const declaration = node('Decl', '/Script/UnrealEd.MaterialGraphNode',
    'Begin Object Class=/Script/Engine.MaterialExpressionNamedRerouteDeclaration Name="Expr"\nEnd Object');
  const usage = node('Use', '/Script/UnrealEd.MaterialGraphNode',
    `Begin Object Class=/Script/Engine.MaterialExpressionNamedRerouteUsage Name="UseExpr"\nDeclaration="/Script/Engine.MaterialExpressionNamedRerouteDeclaration'Decl.Expr'"\nEnd Object\nMaterialExpression="UseExpr"`);
  assert.equal(parse(declaration + '\n' + usage).references[0].to, 'N0');
  assert.equal(parse(usage).metadata.unresolvedReferences, 1);
  assert.equal(parse(usage).connections.length, 0);
});

test('PCG keeps nested settings and classifies dependency wires without Blueprint exec semantics', () => {
  const first = node('Source', '/Script/PCGEditor.PCGEditorGraphNode', pin(a, 'Out', true, `Target ${b}`));
  const second = node('Target', '/Script/PCGEditor.PCGEditorGraphNode',
    `Begin Object Class=/Script/PCG.PCGNode Name="Runtime"\n` +
    `Begin Object Class=/Script/PCG.PCGBranchSettings Name="Settings"\nbEnabled=False\nEnd Object\n` +
    `Begin Object Class=/Script/PCG.PCGPin Name="Pin"\nProperties=(Label="Execution Dependency",Usage=DependencyOnly)\nEnd Object\n` +
    `SettingsInterface="Settings"\nEnd Object\nPCGNode="Runtime"\n` + pin(b, 'Execution Dependency', false, `Source ${a}`));
  const graph = parse(first + '\n' + second);
  assert.equal(graph.nodes[1].type, 'Branch');
  assert.equal(graph.nodes[1].objects[0].objects[0].properties.bEnabled, 'False');
  assert.equal(graph.connections[0].type, 'dependency');
  const output = exporter.filterGraph(graph, settings, 'standard');
  assert.match(exporter.exportMarkdown(output), /Dependencies:/);
  assert.equal(exporter.filterGraph(graph, {...settings, includeDataConnections: false}, 'standard').connections.length, 0);
});

test('Unknown/Niagara nodes use explicit generic warnings, not claimed dedicated support', () => {
  for (const cls of ['/Script/NiagaraEditor.NiagaraNodeFunctionCall', '/Script/Plugin.CustomNode']) {
    const graph = parse(node('Generic', cls, 'Value=False\n' + pin(a, 'Value')));
    assert.equal(graph.metadata.genericNodes, 1);
    assert.equal(graph.metadata.warningCount, 1);
    assert.equal(graph.nodes[0].properties.Value, 'False');
  }
});

test('Incomplete/invalid input is rejected and external wires produce warnings', () => {
  assert.throws(() => parse('not node data'), /NOT_BLUEPRINT/);
  assert.throws(() => parse(bp.slice(0, -10)), /INCOMPLETE_GRAPH/);
  assert.equal(parse(node('Partial', '/Script/BlueprintGraph.K2Node_CallFunction', pin(a, 'In', false, `Missing ${b}`))).metadata.unresolvedLinks, 1);
});

test('Pin IDs are scoped by node and blank localized labels fall back to names', () => {
  const source = node('One', '/Script/BlueprintGraph.K2Node_CallFunction', pin(a, 'then', true, `Two ${a}`, 'exec'));
  const target = node('Two', '/Script/BlueprintGraph.K2Node_CallFunction', pin(a, 'execute', false, `One ${a}`, 'exec'));
  const graph = parse(source + '\n' + target);
  assert.equal(graph.connections.length, 1);
  assert.equal(graph.connections[0].to.node, 'N1');
  const blank = pin(a, 'Actual').replace('DefaultValue=', 'PinFriendlyName=NSLOCTEXT("ns","key"," "),DefaultValue=');
  assert.equal(parse(node('Blank', '/Script/BlueprintGraph.K2Node_CallFunction', blank)).nodes[0].pins[0].name, 'Actual');
});

// Private samples are optional local inputs; never check them into the repository.
for (const [variable, kind, nodes, connections, references] of [
  ['MATERIAL_SAMPLE', 'Material', 611, 617, 41], ['PCG_SAMPLE', 'PCG', 23, 27, 0],
]) {
  test(`${kind} supplied sample`, { skip: !process.env[variable] }, () => {
    const source = fs.readFileSync(process.env[variable], 'utf8');
    const graph = parse(source);
    assert.equal(graph.metadata.graphType, kind);
    assert.equal(graph.nodes.length, nodes);
    assert.equal(graph.connections.length, connections);
    assert.equal(graph.references.length, references);
    assert.equal(graph.metadata.warningCount, 0);
    // Independently count all top-level editor nodes and editor pins in the source.
    assert.equal((source.match(/^Begin Object Class=/gm) || []).length, nodes);
    assert.equal((source.match(/CustomProperties Pin \(/g) || []).length, graph.metadata.pinCount);
    for (const preset of ['compact', 'standard', 'full']) {
      const filtered = exporter.filterGraph(graph, settings, preset);
      for (const language of ['ja', 'en']) {
        for (const format of ['compact-json', 'pretty-json']) {
          const result = JSON.parse(exporter.exportByFormat(filtered, format, {language}));
          assert.equal(result.nodes.length, nodes);
          assert.match(result.ai_context.purpose, new RegExp(kind));
          assert.ok(result.nodes.some(n => n.objects?.length));
        }
        assert.ok(exporter.exportMarkdown(filtered, {language}).startsWith('# ' + kind));
      }
    }
    if (kind === 'Material') {
      assert.ok(graph.nodes.some(n => n.type === 'Material Function Call' && n.objects.some(o => o.properties.MaterialFunction)));
      assert.ok(graph.nodes.some(n => n.objects.some(o => Object.keys(o.properties).some(k => /^FunctionInputs\(/.test(k)))));
    } else {
      assert.ok(graph.nodes.some(n => n.type === 'User Parameter Get'));
      assert.ok(JSON.stringify(graph.nodes).includes('PCGMeshSelectorByAttribute'));
    }
    const filtered = exporter.filterGraph(graph, settings, 'standard');
    console.log(`${kind}: ${nodes} nodes, ${connections} wires, ${references} object references; JSON ${(100 * Buffer.byteLength(exporter.exportCompactJson(filtered)) / Buffer.byteLength(source)).toFixed(1)}% of source`);
  });
}
