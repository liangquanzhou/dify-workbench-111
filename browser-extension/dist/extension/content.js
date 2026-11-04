"use strict";
(() => {
  // src/model.ts
  var isRecord = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  var own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
  var literal = (v) => JSON.stringify(v);
  var MAX_JSON_BYTES = 832 * 1024;
  var MAX_DEFINITION_BYTES = 1024 * 1024;
  var MAX_JSON_VALUES = Math.ceil(MAX_DEFINITION_BYTES / 2) + 1;
  var binary = ["eq", "ne", "gt", "gte", "lt", "lte", "contains", "not_contains", "all_values", "is_minimum"];
  var tolerance = ["within", "below", "above"];
  var symbols = { eq: "=", ne: "\u2260", gt: ">", gte: "\u2265", lt: "<", lte: "\u2264", contains: "\u5305\u542B", not_contains: "\u4E0D\u5305\u542B", all_values: "\u5168\u90E8\u503C\u7B49\u4E8E", is_minimum: "\u4E3A\u6700\u5C0F\u503C\u4E8E", within: "\u63A5\u8FD1", below: "\u4F4E\u4E8E", above: "\u9AD8\u4E8E" };
  function fail(message) {
    throw new Error(message);
  }
  function validString(s) {
    if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(s))
      fail("JSON \u542B\u65E0\u6548 Unicode");
  }
  function uniqueKeys(raw) {
    let p = 0;
    const ws = () => {
      while (/\s/.test(raw[p] || "") && p < raw.length)
        p++;
    };
    const str = () => {
      const start = p++;
      while (p < raw.length) {
        if (raw[p] === "\\")
          p += 2;
        else if (raw[p++] === '"')
          break;
      }
      return JSON.parse(raw.slice(start, p));
    };
    function visit(depth) {
      if (depth > 32)
        fail("JSON \u5D4C\u5957\u6DF1\u5EA6\u8D85\u8FC7 32");
      ws();
      if (raw[p] === "{") {
        p++;
        ws();
        const keys = /* @__PURE__ */ new Set();
        while (raw[p] !== "}") {
          const key = str();
          if (keys.has(key))
            fail("JSON \u542B\u91CD\u590D\u5B57\u6BB5");
          keys.add(key);
          ws();
          p++;
          visit(depth + 1);
          ws();
          if (raw[p] === ",") {
            p++;
            ws();
          } else {
            break;
          }
        }
        p++;
      } else if (raw[p] === "[") {
        p++;
        ws();
        while (raw[p] !== "]") {
          visit(depth + 1);
          ws();
          if (raw[p] === ",") {
            p++;
            ws();
          } else {
            break;
          }
        }
        p++;
      } else if (raw[p] === '"') {
        str();
      } else {
        while (p < raw.length && !/[\s,}\]]/.test(raw[p]))
          p++;
      }
    }
    visit(0);
  }
  function validateExpression(v, depth = 0) {
    if (depth > 32)
      fail("\u6761\u4EF6\u5D4C\u5957\u8FC7\u6DF1");
    if (typeof v === "boolean")
      return;
    if (!isRecord(v) || Object.keys(v).length !== 1)
      fail("\u6761\u4EF6\u5FC5\u987B\u4E3A\u5E03\u5C14\u503C\u6216\u5355\u4E00\u7B97\u5B50");
    const [op, arg] = Object.entries(v)[0];
    if (op === "all" || op === "any") {
      if (!Array.isArray(arg))
        fail("all / any \u5FC5\u987B\u4E3A\u6570\u7EC4");
      arg.forEach((x) => validateExpression(x, depth + 1));
      return;
    }
    if (op === "is_unknown" || op === "is_empty") {
      if (typeof arg !== "string")
        fail("\u6761\u4EF6\u5B57\u6BB5\u5FC5\u987B\u4E3A\u5B57\u7B26\u4E32");
      return;
    }
    if (op === "constraint_set") {
      if (!isRecord(arg) || Object.keys(arg).sort().join(",") !== "mode,record" || typeof arg.record !== "string" || arg.mode !== "satisfied" && arg.mode !== "violated")
        fail("constraint_set \u9700\u8981 record \u4E0E\u5408\u6CD5 mode");
      return;
    }
    if (![...binary, ...tolerance].includes(op))
      fail(`\u4E0D\u652F\u6301\u7684\u6761\u4EF6\u7B97\u5B50\uFF1A${op}`);
    if (!Array.isArray(arg) || arg.length !== (tolerance.includes(op) ? 3 : 2) || typeof arg[0] !== "string")
      fail("\u6761\u4EF6\u7B97\u5B50\u53C2\u6570\u7ED3\u6784\u9519\u8BEF");
    if (isRecord(arg[1]) && own(arg[1], "ref")) {
      if (Object.keys(arg[1]).length !== 1 || typeof arg[1].ref !== "string" || op === "all_values")
        fail("\u53D8\u91CF\u5F15\u7528\u7ED3\u6784\u9519\u8BEF");
    }
  }
  function parseJson(value, maxBytes = MAX_JSON_BYTES) {
    if (maxBytes > MAX_DEFINITION_BYTES || value.length > maxBytes || new TextEncoder().encode(value).length > maxBytes)
      fail(`JSON \u8D85\u8FC7 ${maxBytes / 1024} KiB`);
    const t = JSON.parse(value);
    uniqueKeys(value);
    let count = 0;
    function walk(v) {
      if (++count > MAX_JSON_VALUES)
        fail("JSON \u503C\u8282\u70B9\u8D85\u8FC7\u9884\u89C8\u7ED3\u6784\u9650\u5236");
      if (typeof v === "number" && (!Number.isFinite(v) || Number.isInteger(v) && !Number.isSafeInteger(v)))
        fail("\u6570\u503C\u8D85\u51FA\u5B89\u5168\u8303\u56F4");
      if (typeof v === "string")
        validString(v);
      if (v && typeof v === "object") {
        if (!Array.isArray(v))
          Object.keys(v).forEach(validString);
        Object.values(v).forEach(walk);
      }
    }
    walk(t);
    return t;
  }
  function parseTable(value) {
    if (value === void 0 || value === null || value === "")
      return { kind: "empty", message: "\u5C1A\u672A\u914D\u7F6E\u51B3\u7B56\u8868\u3002\u5728\u4E0B\u65B9\u539F\u751F\u914D\u7F6E\u4E2D\u586B\u5199 table_json \u540E\uFF0C\u8FD9\u91CC\u4F1A\u81EA\u52A8\u663E\u793A\u77E9\u9635\u3002" };
    try {
      if (typeof value !== "string")
        fail("table_json \u5FC5\u987B\u662F JSON \u5B57\u7B26\u4E32");
      if (!value.trim())
        return { kind: "empty", message: "\u5C1A\u672A\u914D\u7F6E\u51B3\u7B56\u8868" };
      if (new TextEncoder().encode(value).length > 512 * 1024)
        fail("\u8868\u683C JSON \u8D85\u8FC7 512 KiB");
      const t = parseJson(value);
      if (!isRecord(t) || typeof t.id !== "string" || !t.id.trim() || !Array.isArray(t.rules))
        fail("\u9700\u8981 id\u3001hit_policy \u548C rules \u6570\u7EC4");
      if (t.hit_policy !== "FIRST" && t.hit_policy !== "COLLECT" && t.hit_policy !== "UNIQUE")
        fail("\u4EC5\u652F\u6301 FIRST / COLLECT / UNIQUE \u547D\u4E2D\u7B56\u7565");
      if (own(t, "unknown_policy") && t.unknown_policy !== "strict" && t.unknown_policy !== "compatible")
        fail("\u672A\u77E5\u503C\u7B56\u7565\u5FC5\u987B\u4E3A strict / compatible");
      if (t.rules.length > 1e3)
        fail("\u89C4\u5219\u6570\u8D85\u8FC7 1,000");
      const ids = /* @__PURE__ */ new Set();
      t.rules.forEach((r) => {
        if (!isRecord(r) || typeof r.id !== "string" || !r.id.trim() || !own(r, "when"))
          fail("\u6BCF\u6761\u89C4\u5219\u9700\u8981\u552F\u4E00 id \u548C when");
        if (ids.has(r.id))
          fail("\u89C4\u5219 id \u91CD\u590D");
        ids.add(r.id);
        validateExpression(r.when);
      });
      return { kind: "ready", matrix: buildMatrix(t) };
    } catch (e) {
      if (e instanceof SyntaxError)
        return { kind: "error", message: "JSON \u683C\u5F0F\u9519\u8BEF\uFF0C\u8BF7\u68C0\u67E5\u539F\u751F\u914D\u7F6E" };
      return { kind: "error", message: e instanceof Error ? e.message : "\u65E0\u6CD5\u8BFB\u53D6\u51B3\u7B56\u8868" };
    }
  }
  function operand(v) {
    return isRecord(v) && own(v, "ref") ? `\u5F15\u7528(${literal(v.ref)})` : literal(v);
  }
  function describe(op, arg) {
    if (op === "constraint_set") {
      const a2 = arg;
      return { field: a2.record, label: `\u7EA6\u675F\u96C6 ${a2.mode === "satisfied" ? "\u6EE1\u8DB3" : "\u8FDD\u53CD"}` };
    }
    if (op === "is_unknown" || op === "is_empty")
      return { field: arg, label: op === "is_unknown" ? "\u672A\u77E5 / null" : "\u4E3A\u7A7A" };
    const a = arg;
    const toleranceLabel = tolerance.includes(op) ? `\uFF08\u5BB9\u5DEE ${literal(a[2])}\uFF09` : "";
    return { field: a[0], label: `${symbols[op]} ${operand(a[1])}${toleranceLabel}` };
  }
  function buildMatrix(table) {
    const fields = [];
    const outputs = [];
    const outputKeys = /* @__PURE__ */ new Set();
    const addOutput = (parent, child) => {
      const key = JSON.stringify([parent, child ?? null]);
      if (!outputKeys.has(key)) {
        outputKeys.add(key);
        outputs.push({ key, parent, child, label: child !== void 0 ? `$[${JSON.stringify(parent)}][${JSON.stringify(child)}]` : `$[${JSON.stringify(parent)}]` });
      }
    };
    const rows = table.rules.map((rule) => {
      const atoms = [];
      const visit = (v, full) => {
        if (typeof v === "boolean")
          return v ? "\u59CB\u7EC8\u6210\u7ACB" : "\u59CB\u7EC8\u4E0D\u6210\u7ACB";
        const [op, arg] = Object.entries(v)[0];
        if (op === "all" || op === "any") {
          const a = arg;
          if (!a.length)
            return op === "all" ? "\u59CB\u7EC8\u6210\u7ACB" : "\u59CB\u7EC8\u4E0D\u6210\u7ACB";
          return `(${a.map((x) => visit(x, full)).join(op === "all" ? " \u4E14 " : " \u6216 ")})`;
        }
        const d = describe(op, arg);
        if (full)
          return `${literal(d.field)} ${d.label}`;
        const id = String.fromCharCode(65 + atoms.length % 26) + (atoms.length >= 26 ? String(Math.floor(atoms.length / 26)) : "");
        atoms.push({ id, ...d });
        if (!fields.includes(d.field))
          fields.push(d.field);
        return id;
      };
      const logic = visit(rule.when, false);
      const fullLogic = visit(rule.when, true);
      Object.entries(rule).forEach(([parent, value]) => {
        if (parent === "id" || parent === "when")
          return;
        if (isRecord(value) && Object.keys(value).length)
          Object.keys(value).forEach((child) => addOutput(parent, child));
        else
          addOutput(parent);
      });
      return { rule, atoms, logic, fullLogic };
    });
    return { table, fields, outputs, rows };
  }
  function outputValue(rule, column) {
    if (!own(rule, column.parent))
      return { present: false };
    const v = rule[column.parent];
    if (column.child === void 0) {
      if (isRecord(v) && Object.keys(v).length)
        return { present: true, expanded: true };
      return { present: true, value: v };
    }
    return isRecord(v) && own(v, column.child) ? { present: true, value: v[column.child] } : { present: false };
  }

  // src/binding.ts
  var SNAPSHOT_EVENT = "dmn-preview:snapshot:v1";
  var STOP_EVENT = "dmn-preview:stop:v1";
  var REFRESH_EVENT = "dmn-preview:refresh:v1";
  var MAX_TABLE_CHARS = 512 * 1024;
  function isWorkflowEditorLocation(location) {
    if (/^\/app\/[^/]+\/workflow\/?$/.test(location.pathname)) return true;
    return /^\/v2\/app\/[^/]+\/?$/.test(location.pathname) && new URLSearchParams(location.search).get("mode") === "workflow";
  }

  // src/brian.ts
  var operators = { eq: "=", ne: "\u2260", lt: "<", lte: "\u2264", gt: ">", gte: "\u2265", in: "\u5C5E\u4E8E", exists: "\u5B58\u5728", is_null: "\u4E3A null" };
  function requireShape(ok, message) {
    if (!ok) throw Error(message);
  }
  function object(raw, name, maxBytes = 512 * 1024) {
    requireShape(typeof raw === "string" && raw.length <= maxBytes && new TextEncoder().encode(raw).length <= maxBytes, `${name} \u7F3A\u5931\u6216\u8D85\u8FC7 ${maxBytes / 1024} KiB`);
    const value = parseJson(raw, maxBytes);
    requireShape(isRecord(value), `${name} \u5FC5\u987B\u4E3A JSON \u5BF9\u8C61`);
    return value;
  }
  function exact(value, keys, name) {
    requireShape(Object.keys(value).sort().join(",") === keys.sort().join(","), `${name} \u542B\u7F3A\u5931\u6216\u4E0D\u652F\u6301\u7684\u5B57\u6BB5`);
  }
  function one(items, field, id) {
    requireShape(Array.isArray(items) && typeof id === "string" && id.length, `node_ref.${field} \u6216\u5B9A\u4E49\u7ED3\u6784\u65E0\u6548`);
    const matches = items.filter((x) => isRecord(x) && x[field] === id);
    requireShape(matches.length === 1 && isRecord(matches[0]), `${field} \u672A\u627E\u5230\u6216\u4E0D\u552F\u4E00\uFF1A${id}`);
    return matches[0];
  }
  function matrixFor(model, id, service, stored = false) {
    requireShape(["FIRST", "COLLECT", ...service ? ["UNIQUE"] : []].includes(String(model.hit_policy)), "\u4E0D\u652F\u6301\u7684\u547D\u4E2D\u7B56\u7565");
    requireShape(typeof model.version === "string" && model.version.length, "\u6A21\u578B\u7F3A\u5C11 version");
    requireShape(Array.isArray(model.rules) && model.rules.length <= (stored ? 512 : 128) && model.rules.length > 0, "\u89C4\u5219\u6570\u91CF\u8D85\u51FA\u5F53\u524D\u683C\u5F0F\u9650\u5236");
    const templates = model.result_templates;
    if (service) requireShape(isRecord(templates) && isRecord(model.parameters), "\u6A21\u578B\u7F3A\u5C11 parameters / result_templates");
    const ids = /* @__PURE__ */ new Set();
    const rules = model.rules.map((r) => {
      requireShape(isRecord(r), "\u89C4\u5219\u5FC5\u987B\u4E3A\u5BF9\u8C61");
      exact(r, service ? ["rule_id", own(r, "when_any") ? "when_any" : "when", "output_template_ref"] : ["id", "when", "output"], "\u89C4\u5219\uFF08when \u4E0E when_any \u53EA\u80FD\u6709\u4E00\u4E2A\uFF09");
      const rid = service ? r.rule_id : r.id;
      requireShape(typeof rid === "string" && rid.length && !ids.has(rid), "\u89C4\u5219 ID \u7F3A\u5931\u6216\u91CD\u590D");
      ids.add(rid);
      if (!service) return { id: rid, when: true, output: r.output };
      requireShape(typeof r.output_template_ref === "string" && isRecord(templates) && own(templates, r.output_template_ref), "\u8F93\u51FA\u6A21\u677F\u5F15\u7528\u4E0D\u5B58\u5728");
      return { id: rid, when: true, output_template_ref: r.output_template_ref, template: templates[r.output_template_ref] };
    });
    const matrix = buildMatrix({ id, hit_policy: model.hit_policy, rules });
    model.rules.forEach((r, index) => {
      const rule = r;
      const any = service && own(rule, "when_any");
      const groups = any ? rule.when_any : [rule.when];
      requireShape(Array.isArray(groups) && groups.length > 0 && groups.length <= 128, "when_any \u5FC5\u987B\u5305\u542B 1..128 \u4E2A\u6761\u4EF6\u7EC4");
      const groupedAtoms = groups.map((conditions, groupIndex) => {
        requireShape(Array.isArray(conditions) && conditions.length <= 32 && (!any || conditions.length > 0), "when \u5FC5\u987B\u4E3A\u6700\u591A 32 \u9879\u7684 AND \u6761\u4EF6\u6570\u7EC4");
        const atoms = conditions.map((c, i) => {
          requireShape(isRecord(c), "\u6761\u4EF6\u5FC5\u987B\u4E3A\u5BF9\u8C61");
          exact(c, ["path", "op", "value"], "\u6761\u4EF6");
          requireShape(Array.isArray(c.path) && c.path.length > 0 && c.path.length <= 16 && c.path.every((x) => typeof x === "string" && x.length > 0), "\u6761\u4EF6 path \u5FC5\u987B\u4E3A\u5B57\u7B26\u4E32\u8DEF\u5F84\u6570\u7EC4");
          requireShape(typeof c.op === "string" && own(operators, c.op), `\u4E0D\u652F\u6301\u7684\u6761\u4EF6\u7B97\u5B50\uFF1A${c.op}`);
          if (c.op === "exists" || c.op === "is_null") requireShape(typeof c.value === "boolean", "exists/is_null \u9700\u8981\u5E03\u5C14\u503C");
          if (c.op === "in") requireShape(Array.isArray(c.value) && c.value.length <= 128, "in \u9700\u8981\u6700\u591A 128 \u9879\u7684\u6570\u7EC4");
          if (["lt", "lte", "gt", "gte"].includes(c.op)) requireShape(typeof c.value === "number" || typeof c.value === "string", "\u6BD4\u8F83\u503C\u5FC5\u987B\u4E3A\u6570\u5B57\u6216\u5B57\u7B26\u4E32");
          const parameter = isRecord(model.parameters) ? model.parameters[String(c.path[1])] : null;
          const tableParameter = stored && isRecord(parameter) && parameter.type === "table";
          if (tableParameter) requireShape(c.path[0] === "parameters" && (c.path.length === 3 && ["state", "quality"].includes(String(c.path[2])) || c.path.length === 4 && c.path[2] === "result"), "table \u53C2\u6570\u8DEF\u5F84\u65E0\u6548");
          else if (service) requireShape(c.path.length >= 3 && (!stored || c.path.length === 3) && c.path[0] === "parameters" && typeof c.path[1] === "string" && isRecord(model.parameters) && own(model.parameters, c.path[1]) && ["value", "quality"].includes(String(c.path[2])) && (c.path[2] !== "quality" || c.path.length === 3), "\u6761\u4EF6\u5F15\u7528\u4E86\u672A\u58F0\u660E\u53C2\u6570\u6216\u4E0D\u652F\u6301\u7684\u8DEF\u5F84");
          const field = "$" + c.path.map((k) => `[${literal(k)}]`).join("");
          if (!matrix.fields.includes(field)) matrix.fields.push(field);
          return { id: (any ? `\u7EC4${groupIndex + 1}.` : "") + String.fromCharCode(65 + i % 26) + (i >= 26 ? String(Math.floor(i / 26)) : ""), field, label: `${operators[c.op]} ${literal(c.value)}` };
        });
        return atoms;
      });
      matrix.rows[index].atoms = groupedAtoms.flat();
      matrix.rows[index].logic = groupedAtoms.map((atoms) => atoms.length ? `(${atoms.map((a) => a.id).join(" \u4E14 ")})` : "\u59CB\u7EC8\u6210\u7ACB").join(" \u6216 ");
      matrix.rows[index].fullLogic = groupedAtoms.map((atoms) => atoms.length ? `(${atoms.map((a) => `${a.field} ${a.label}`).join(" \u4E14 ")})` : "\u59CB\u7EC8\u6210\u7ACB").join(" \u6216 ");
    });
    matrix.note = `${service ? "service-decision-table-v1" : "json-table-v1"} \xB7 \u7248\u672C ${model.version} \xB7 \u7ED3\u6784\u9884\u89C8\uFF0C\u4E0D\u6821\u9A8C\u8FD0\u884C\u6761\u4EF6`;
    if (service) {
      if (model.rules.some((r) => isRecord(r) && own(r, "when_any") && (!stored || Array.isArray(r.when_any) && r.when_any.length > 32)))
        matrix.note += " \xB7 \u6B64 when_any \u7ED3\u6784\u9700\u8981\u4E0A\u6E38 v0.5.19 \u6216\u517C\u5BB9\u7248\u672C";
      if (stored && isRecord(model.parameters)) {
        const sources = Object.entries(model.parameters).filter(([, parameter]) => isRecord(parameter) && own(parameter, "from_table"));
        if (sources.length) matrix.note += " \xB7 \u6A21\u578B\u56DE\u6267\u6765\u6E90\u7EA6\u675F\uFF08\u672A\u6C42\u503C\uFF09\uFF1A" + sources.map(([name, parameter]) => `${literal(name)} \u2192 ${literal(parameter.from_table)}`).join("\uFF1B");
      }
      requireShape(model.on_no_match === "ERROR" || model.on_no_match === "RESULT_TEMPLATE", "\u4E0D\u652F\u6301\u7684 on_no_match");
      matrix.note += ` \xB7 \u65E0\u5339\u914D\uFF1A${model.on_no_match}`;
      if (model.on_no_match === "RESULT_TEMPLATE") {
        requireShape(typeof model.empty_template_ref === "string" && isRecord(templates) && own(templates, model.empty_template_ref), "\u65E0\u5339\u914D\u6A21\u677F\u4E0D\u5B58\u5728");
        matrix.note += ` ${model.empty_template_ref} ${literal(templates[model.empty_template_ref])}`;
      }
    }
    return matrix;
  }
  function parseBrian(snapshot) {
    try {
      const t = object(snapshot.raw, snapshot.format === "brian-json" ? "table_json" : "definition_bundle_json", snapshot.format === "brian-json" ? 512 * 1024 : MAX_DEFINITION_BYTES);
      if (snapshot.format === "brian-json") {
        exact(t, ["format", "id", "version", "hit_policy", "rules"], "json-table-v1");
        requireShape(t.format === "json-table-v1" && typeof t.id === "string" && t.id.length, "\u9700\u8981 json-table-v1 \u548C id");
        return { kind: "ready", matrix: matrixFor(t, t.id, false) };
      }
      requireShape(t.schema_version === "service-decision-dsl.node-architecture.v2", "\u4E0D\u652F\u6301\u7684\u5B9A\u4E49\u5305 schema_version");
      const ref = object(snapshot.auxiliary, "node_ref");
      const workflow = one(t.workflows, "workflow_id", ref.workflow_id);
      const phase = one(workflow.phases, "phase_id", ref.phase_id);
      const step = one(phase.steps, "step_id", ref.step_id);
      requireShape(isRecord(step.graph), "step.graph \u7F3A\u5931");
      const node = one(step.graph.nodes, "node_id", ref.node_id);
      requireShape(node.kind === "DECISION" && typeof node.model_ref === "string" && isRecord(t.models) && own(t.models, node.model_ref), "\u76EE\u6807\u8282\u70B9\u4E0D\u662F DECISION \u6216 model_ref \u4E0D\u5B58\u5728");
      const model = t.models[node.model_ref];
      requireShape(isRecord(model), "\u6A21\u578B\u4E0D\u662F\u5BF9\u8C61");
      if (own(model, "source")) return { kind: "unsupported", storage: isRecord(model.source) && model.source.kind === "PLUGIN_STORAGE" && typeof model.source.table === "string" && typeof model.source.format === "string" ? { table: model.source.table, format: model.source.format } : void 0, message: `\u6A21\u578B ${node.model_ref} \u5F15\u7528\u4E86\u5916\u90E8\u6216\u63D2\u4EF6\u5B58\u50A8\u5185\u5BB9\uFF0C\u5C1A\u672A\u8BFB\u53D6\u8868\u4F53\u3002
source: ${literal(model.source)}` };
      requireShape(model.profile === "service-decision-table-v1", "\u4E0D\u652F\u6301\u7684\u6A21\u578B profile");
      return { kind: "ready", matrix: matrixFor(model, node.model_ref, true) };
    } catch (e) {
      return { kind: "error", message: e instanceof Error ? e.message : "\u65E0\u6CD5\u8BFB\u53D6 Brian \u51B3\u7B56\u8868" };
    }
  }

  // src/xml.ts
  function parseXml(snapshot, document2) {
    try {
      const raw = snapshot.raw || "";
      if (new TextEncoder().encode(raw).length > 512 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(raw)) throw Error("XML \u8D85\u8FC7\u9884\u89C8\u9650\u5236\u6216\u5305\u542B DTD / ENTITY");
      const doc = new document2.defaultView.DOMParser().parseFromString(raw, "application/xml");
      if (doc.querySelector("parsererror")) throw Error("DMN XML \u683C\u5F0F\u9519\u8BEF");
      const ns = doc.documentElement.namespaceURI;
      if (doc.documentElement.localName !== "definitions" || !["https://www.omg.org/spec/DMN/20191111/MODEL/", "https://www.omg.org/spec/DMN/20211108/MODEL/", "https://www.omg.org/spec/DMN/20230324/MODEL/", "http://www.omg.org/spec/DMN/20180521/MODEL/"].includes(ns || "")) throw Error("\u4E0D\u652F\u6301\u7684 DMN \u547D\u540D\u7A7A\u95F4");
      const children = (e, name) => Array.from(e.children).filter((x) => x.namespaceURI === ns && x.localName === name);
      const only = (e, name) => {
        const found = children(e, name);
        if (found.length !== 1) throw Error(`DMN ${name} \u7F3A\u5931\u6216\u4E0D\u552F\u4E00`);
        return found[0];
      };
      const decisions = children(doc.documentElement, "decision").filter((e) => e.getAttribute("id") === snapshot.auxiliary);
      if (decisions.length !== 1) throw Error("decision_id \u672A\u627E\u5230\u6216\u4E0D\u552F\u4E00");
      const table = only(decisions[0], "decisionTable");
      const policy = table.getAttribute("hitPolicy") || "UNIQUE";
      if (!["UNIQUE", "FIRST", "COLLECT", "ANY", "PRIORITY", "RULE ORDER", "OUTPUT ORDER"].includes(policy)) throw Error("\u4E0D\u652F\u6301\u7684 DMN \u547D\u4E2D\u7B56\u7565");
      const inputs = children(table, "input");
      const outputs = children(table, "output");
      const rules = children(table, "rule");
      if (rules.length > 1e3 || inputs.length + outputs.length > 126) throw Error("DMN \u8868\u683C\u8D85\u8FC7\u9884\u89C8\u9650\u5236");
      const fields = inputs.map((e, i) => `${i + 1}. ${only(only(e, "inputExpression"), "text").textContent || ""}`);
      const ids = /* @__PURE__ */ new Set();
      const normalized = rules.map((r, i) => {
        const id = r.getAttribute("id") || `\u89C4\u5219 ${i + 1}`;
        if (ids.has(id)) throw Error("DMN \u89C4\u5219 ID \u91CD\u590D");
        ids.add(id);
        const entries = children(r, "outputEntry");
        if (entries.length !== outputs.length || children(r, "inputEntry").length !== inputs.length) throw Error("DMN \u6761\u4EF6\u6216\u8F93\u51FA\u5355\u5143\u683C\u6570\u4E0D\u5339\u914D");
        const output = Object.fromEntries(entries.map((entry, j) => [`${j + 1}. ${outputs[j].getAttribute("name") || outputs[j].getAttribute("label") || "\u8F93\u51FA"}`, only(entry, "text").textContent || ""]));
        return { id, when: true, output };
      });
      const matrix = buildMatrix({ id: snapshot.auxiliary, hit_policy: policy, rules: normalized });
      matrix.fields = fields;
      rules.forEach((r, i) => {
        const atoms = children(r, "inputEntry").map((entry, j) => ({ id: String(j + 1), field: fields[j], label: only(entry, "text").textContent || "" }));
        matrix.rows[i].atoms = atoms;
        matrix.rows[i].logic = "FEEL \u6761\u4EF6\uFF08\u4E14\uFF09";
        matrix.rows[i].fullLogic = atoms.map((a) => `${a.field}: ${a.label}`).join(" \u4E14 ");
      });
      matrix.note = `DMN XML \xB7 FEEL \u539F\u6587\uFF08\u8F93\u51FA\u4EE5 JSON \u5B57\u7B26\u4E32\u5C55\u793A\uFF09\xB7 \u4E0D\u6267\u884C\u8868\u8FBE\u5F0F\u6216\u4F9D\u8D56\u51B3\u7B56${table.hasAttribute("aggregation") ? ` \xB7 aggregation=${table.getAttribute("aggregation")}` : ""}`;
      outputs.forEach((output, i) => {
        for (const [name, label] of [["defaultOutputEntry", "\u65E0\u5339\u914D\u9ED8\u8BA4\u8F93\u51FA"], ["outputValues", "\u8F93\u51FA\u503C\u987A\u5E8F"]]) {
          const entries = children(output, name);
          if (entries.length > 1) throw Error(`DMN ${name} \u4E0D\u552F\u4E00`);
          if (entries.length) matrix.note += ` \xB7 \u8F93\u51FA ${i + 1} ${label}\uFF1A${only(entries[0], "text").textContent || ""}`;
        }
      });
      return { kind: "ready", matrix };
    } catch (e) {
      return { kind: "error", message: e instanceof Error ? e.message : "\u65E0\u6CD5\u8BFB\u53D6 XML" };
    }
  }

  // src/stored.ts
  var MAX_IMPORT_BYTES = MAX_JSON_BYTES;
  var schemas = {
    "decision-table/v1": ["dmn-json.decision-table/v1"],
    "decision-set/v1": ["dmn-json.decision-set/v1"],
    "admission-routing-table/v1": ["dmn-json.route-table/v1"],
    "routing-table/v2": ["dmn-json.route-table/v2", "dmn-json.route-table/v3"],
    "routing-table/v3": ["dmn-json.route-table/v2", "dmn-json.route-table/v3"],
    "routing-table/v4": ["dmn-json.route-table/v2", "dmn-json.route-table/v3"],
    "supplement-requirements/v1": ["dmn-json.supplement-requirements/v1", "dmn-json.supplement-requirements/v2"],
    "supplement-requirements/v2": ["dmn-json.supplement-requirements/v2"],
    "resource-targets/v1": ["dmn-json.resource-targets/v1"]
  };
  function need(ok, message) {
    if (!ok) throw Error(message);
  }
  async function sha256(text) {
    need(globalThis.crypto?.subtle, "\u5F53\u524D\u9875\u9762\u6CA1\u6709\u5B89\u5168\u6458\u8981\u80FD\u529B\uFF1B\u8BF7\u5728 HTTPS \u6216 localhost \u9875\u9762\u5BFC\u5165");
    return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  function pythonCanonicalizer(raw) {
    let pos = 0;
    const numbers = /* @__PURE__ */ new Map();
    const ws = () => {
      while (/\s/.test(raw[pos] || "") && pos < raw.length) pos++;
    };
    const string = () => {
      const start = pos++;
      while (pos < raw.length) {
        if (raw[pos] === "\\") pos += 2;
        else if (raw[pos++] === '"') break;
      }
      return JSON.parse(raw.slice(start, pos));
    };
    function scan(path) {
      ws();
      if (raw[pos] === "{") {
        pos++;
        ws();
        while (raw[pos] !== "}") {
          const k = string();
          ws();
          pos++;
          scan([...path, k]);
          ws();
          if (raw[pos] !== ",") break;
          pos++;
          ws();
        }
        pos++;
      } else if (raw[pos] === "[") {
        pos++;
        ws();
        let i = 0;
        while (raw[pos] !== "]") {
          scan([...path, String(i++)]);
          ws();
          if (raw[pos] !== ",") break;
          pos++;
          ws();
        }
        pos++;
      } else if (raw[pos] === '"') string();
      else {
        const start = pos;
        while (pos < raw.length && !/[\s,}\]]/.test(raw[pos])) pos++;
        const token = raw.slice(start, pos);
        if (/^-?\d/.test(token)) {
          const n = Number(token);
          let canonical2 = JSON.stringify(n);
          if (/[.eE]/.test(token)) {
            if (n === 0) canonical2 = (token.startsWith("-") ? "-" : "") + "0.0";
            else if (Math.abs(n) < 1e-4 || Math.abs(n) >= 1e16) {
              const [mantissa, exponent] = n.toExponential().split("e");
              const power = Number(exponent);
              canonical2 = `${mantissa}e${power < 0 ? "-" : "+"}${String(Math.abs(power)).padStart(2, "0")}`;
            } else canonical2 = Number.isInteger(n) ? `${n}.0` : String(n);
          }
          numbers.set(JSON.stringify(path), canonical2);
        }
      }
    }
    scan([]);
    const compare = (a, b) => {
      const aa = Array.from(a, (x) => x.codePointAt(0)), bb = Array.from(b, (x) => x.codePointAt(0));
      for (let i = 0; i < Math.min(aa.length, bb.length); i++) if (aa[i] !== bb[i]) return aa[i] - bb[i];
      return aa.length - bb.length;
    };
    function canonical(value, path = []) {
      if (typeof value === "number") return numbers.get(JSON.stringify(path)) ?? JSON.stringify(value);
      if (Array.isArray(value)) return "[" + value.map((v, i) => canonical(v, [...path, String(i)])).join(",") + "]";
      if (isRecord(value)) return "{" + Object.keys(value).sort(compare).map((k) => JSON.stringify(k) + ":" + canonical(value[k], [...path, k])).join(",") + "}";
      return JSON.stringify(value);
    }
    return canonical;
  }
  function configMatrix(id, rows) {
    need(Array.isArray(rows) && rows.length <= 4096 && rows.every(isRecord), "\u5B58\u50A8\u914D\u7F6E\u8BB0\u5F55\u7ED3\u6784\u4E0D\u652F\u6301");
    const matrix = buildMatrix({ id, hit_policy: "\u914D\u7F6E\u539F\u6587", rules: rows.map((row, i) => ({ id: String(i + 1), when: true, record: row })) });
    matrix.rows.forEach((row) => {
      row.logic = "\u914D\u7F6E\u8BB0\u5F55\uFF08\u672A\u6C42\u503C\uFF09";
      row.fullLogic = "\u672A\u7F16\u8BD1\u4E3A\u6267\u884C\u89C4\u5219\uFF1B\u6240\u6709\u8BB0\u5F55\u5B57\u6BB5\u6309\u539F\u6587\u5C55\u793A";
    });
    matrix.note = "\u5B58\u50A8\u914D\u7F6E\u539F\u6587 \xB7 \u4E0D\u662F\u7F16\u8BD1\u540E\u7684\u6267\u884C\u51B3\u7B56\u8868 \xB7 \u8BF7\u5C55\u5F00\u5B8C\u6574\u6587\u6863\u67E5\u770B\u5B57\u5178\u548C\u58F0\u660E";
    return matrix;
  }
  async function importStored(raw, ref, filename, source = "local") {
    need(new TextEncoder().encode(raw).length <= MAX_IMPORT_BYTES, "\u6587\u4EF6\u8D85\u8FC7 832 KiB \u5BFC\u5165\u4E0A\u9650");
    let value = parseJson(raw);
    let prefix = [];
    need(isRecord(value), "\u5BFC\u5165\u5185\u5BB9\u5FC5\u987B\u4E3A JSON \u5BF9\u8C61");
    if (own(value, "status_code")) {
      need(value.status_code === 200 && isRecord(value.result), "\u53EA\u63A5\u53D7\u6210\u529F\u7684 route_table_store \u8BFB\u53D6\u7ED3\u679C");
      value = value.result;
      prefix = ["result"];
    }
    need(isRecord(value), "\u8BFB\u53D6\u7ED3\u679C\u5FC5\u987B\u4E3A\u5BF9\u8C61");
    if (own(value, "doc")) {
      need(value.table === ref.table, "\u8BFB\u53D6\u7ED3\u679C\u7684\u8868\u540D\u4E0E\u5F53\u524D\u8282\u70B9\u4E0D\u7B26");
      value = value.doc;
      prefix.push("doc");
    }
    need(isRecord(value), "\u8BFB\u53D6\u7ED3\u679C\u6CA1\u6709\u8868\u4F53\uFF1B\u8FD0\u884C\u7ED3\u679C\u6216\u7A7A\u7ED3\u679C\u4E0D\u80FD\u4EE3\u66FF\u5B8C\u6574\u89C4\u5219");
    const doc = value;
    need(doc.table === ref.table, "\u5BFC\u5165\u8868\u540D\u4E0E\u5F53\u524D\u8282\u70B9\u4E0D\u7B26\uFF08\u4E0D\u731C\u6D4B\u522B\u540D\uFF09");
    need(typeof doc.schema === "string" && own(schemas, ref.format) && schemas[ref.format].includes(doc.schema), "\u5BFC\u5165\u683C\u5F0F\u4E0E\u8282\u70B9\u4E0D\u7B26\u6216\u5C1A\u4E0D\u652F\u6301");
    need(typeof doc.version === "number" && Number.isSafeInteger(doc.version) && doc.version > 0, "\u7F3A\u5C11\u5DF2\u4FDD\u5B58\u7248\u672C\uFF1B\u8BF7\u5BFC\u51FA\u5DF2\u4FDD\u5B58\u7248\u672C\uFF0C\u4E0D\u80FD\u5BFC\u5165\u672A\u4FDD\u5B58\u8349\u7A3F");
    if (ref.version) need(/^\d+$/.test(ref.version) && Number(ref.version) === doc.version, "\u5BFC\u5165\u7248\u672C\u4E0E\u8282\u70B9\u9489\u4F4F\u7684\u7248\u672C\u4E0D\u7B26");
    need(typeof doc.content_sha256 === "string" && /^[a-f0-9]{64}$/.test(doc.content_sha256), "\u5DF2\u4FDD\u5B58\u6587\u6863\u7F3A\u5C11\u6709\u6548 content_sha256");
    const route = doc.schema.startsWith("dmn-json.route-table/");
    const keys = doc.schema === "dmn-json.decision-table/v1" ? ["owner", "model_ref", "model"] : doc.schema === "dmn-json.decision-set/v1" ? ["owner", "models"] : route ? ["routes", doc.schema.endsWith("/v1") ? "registry" : "solutions", "issue_types", "phases", ...own(doc, "resource_table") && doc.resource_table !== null ? ["resource_table"] : []] : doc.schema.startsWith("dmn-json.supplement-requirements/") ? ["scenes"] : ["targets"];
    need(keys.every((k) => own(doc, k)), "\u5B58\u50A8\u6587\u6863\u7F3A\u5C11\u5B8C\u6574\u5185\u5BB9\u5B57\u6BB5");
    const canonical = pythonCanonicalizer(raw);
    const content = "{" + keys.sort().map((k) => JSON.stringify(k) + ":" + canonical(doc[k], [...prefix, k])).join(",") + "}";
    const digest = await sha256(content);
    need(digest === doc.content_sha256, "\u6587\u6863\u6458\u8981\u6838\u5BF9\u5931\u8D25\uFF1B\u5185\u5BB9\u88AB\u4FEE\u6539\u6216\u6570\u5B57\u5E8F\u5217\u5316\u6539\u53D8\uFF0C\u8BF7\u5BFC\u5165\u539F\u59CB\u53EA\u8BFB\u54CD\u5E94");
    if (ref.digest) need(ref.digest === digest, "\u5BFC\u5165\u5185\u5BB9\u4E0E\u8282\u70B9\u9489\u4F4F\u7684 content_sha256 \u4E0D\u7B26");
    const models = [];
    function addModel(key, entry) {
      need(typeof entry.model_ref === "string" && isRecord(entry.model) && entry.model.profile === "service-decision-table-v1", "\u5B58\u50A8\u51B3\u7B56\u6A21\u578B\u5F15\u7528\u6216\u683C\u5F0F\u65E0\u6548");
      models.push({ key, matrix: matrixFor(entry.model, entry.model_ref, true, true) });
    }
    if (doc.schema === "dmn-json.decision-table/v1") addModel("\u9ED8\u8BA4\u6A21\u578B", doc);
    else if (doc.schema === "dmn-json.decision-set/v1") {
      need(isRecord(doc.models) && Object.keys(doc.models).length > 0 && Object.keys(doc.models).length <= 64, "\u51B3\u7B56\u96C6\u5FC5\u987B\u6709 1..64 \u4E2A\u6A21\u578B");
      for (const [key, entry] of Object.entries(doc.models)) {
        need(isRecord(entry), "\u51B3\u7B56\u96C6\u6A21\u578B\u6761\u76EE\u65E0\u6548");
        addModel(key, entry);
      }
      models.forEach((m) => {
        m.matrix.note += " \xB7 \u663E\u793A\u5B8C\u6574\u51B3\u7B56\u96C6\uFF1B\u672A\u63A8\u65AD\u8FD0\u884C\u65F6 models \u9009\u62E9";
      });
    } else if (route) models.push({ key: "\u8DEF\u7531\u914D\u7F6E", matrix: configMatrix(ref.table, doc.routes) });
    else {
      const records = doc[doc.schema.startsWith("dmn-json.supplement-requirements/") ? "scenes" : "targets"];
      need(isRecord(records), "\u5B58\u50A8\u914D\u7F6E\u5FC5\u987B\u4E3A\u5BF9\u8C61");
      models.push({ key: "\u914D\u7F6E\u8BB0\u5F55", matrix: configMatrix(ref.table, Object.entries(records).map(([key, record]) => ({ key, record }))) });
    }
    const fileHash = await sha256(raw);
    const provenance = `${source === "local" ? "\u672C\u5730\u5BFC\u5165\u5FEB\u7167" : "\u67E5\u8BE2\u54CD\u5E94\u5FEB\u7167"} \xB7 ${filename.slice(0, 200)}
\u8868 ${ref.table} \xB7 \u5DF2\u4FDD\u5B58\u7248\u672C ${doc.version} \xB7 \u4FDD\u5B58\u65F6\u95F4 ${typeof doc.saved_at === "string" ? doc.saved_at : "\u672A\u63D0\u4F9B"}
content_sha256 ${digest}
\u539F\u6587 SHA-256 ${fileHash}
${ref.version || ref.digest ? "\u5DF2\u6838\u5BF9\u8282\u70B9\u7248\u672C/\u6458\u8981\u7EA6\u675F" : source === "local" ? "\u8282\u70B9\u672A\u9489\u7248\u672C\uFF1B\u6B64\u5FEB\u7167\u662F\u5426\u4E3A\u7EBF\u4E0A\u6700\u65B0\u7248\u672A\u77E5" : "\u8282\u70B9\u672A\u9489\u7248\u672C\uFF1B\u663E\u793A\u8FD9\u6B21\u67E5\u8BE2\u8FD4\u56DE\u7684\u7248\u672C"} \xB7 ${source === "local" ? "\u6458\u8981\u4E00\u81F4\u4E0D\u8BC1\u660E\u6587\u4EF6\u6765\u6E90\u8EAB\u4EFD \xB7 \u4E0D\u8054\u7F51\u3001\u4E0D\u6267\u884C\u3001\u4E0D\u4FDD\u5B58\u5230\u78C1\u76D8" : "\u6458\u8981\u4E00\u81F4\u4E0D\u4EE3\u66FF\u67E5\u8BE2\u5E94\u7528\u6743\u9650\u5BA1\u67E5 \xB7 \u4EC5\u5728\u5F53\u524D\u9884\u89C8\u5185\u4FDD\u5B58"}`;
    return { models, document: doc, provenance: provenance + "\n\u6A21\u578B from_table \u8BA1\u5165\u5185\u5BB9\u6458\u8981\uFF1Bdeclare \u4E0D\u5728 content_sha256 \u5185\u3002\u4EC5\u663E\u793A\u58F0\u660E\u539F\u6587\uFF0C\u672A\u6267\u884C STANDARD \u4FDD\u5B58\u6821\u9A8C\u3002" };
  }

  // src/store-node.ts
  var formats = {
    "dmn-json.decision-table/v1": "decision-table/v1",
    "dmn-json.decision-set/v1": "decision-set/v1",
    "dmn-json.route-table/v1": "admission-routing-table/v1",
    "dmn-json.route-table/v2": "routing-table/v2",
    "dmn-json.route-table/v3": "routing-table/v3",
    "dmn-json.supplement-requirements/v1": "supplement-requirements/v1",
    "dmn-json.supplement-requirements/v2": "supplement-requirements/v2",
    "dmn-json.resource-targets/v1": "resource-targets/v1"
  };
  function need2(ok, message) {
    if (!ok) throw Error(message);
  }
  async function previewStoreResult(raw, ref, label) {
    need2(new TextEncoder().encode(raw).length <= MAX_IMPORT_BYTES, "\u6587\u4EF6\u8D85\u8FC7 832 KiB \u5BFC\u5165\u4E0A\u9650");
    let value = parseJson(raw);
    need2(isRecord(value), "\u8868\u6587\u4EF6\u5FC5\u987B\u4E3A JSON \u5BF9\u8C61");
    if ("status_code" in value) {
      need2(value.status_code === 200 && isRecord(value.result), "\u5B58\u53D6\u7ED3\u679C\u672A\u6210\u529F");
      value = value.result;
    }
    const doc = isRecord(value) && "doc" in value ? value.doc : value;
    need2(isRecord(doc) && typeof doc.table === "string" && typeof doc.schema === "string", "\u7ED3\u679C\u6CA1\u6709\u5B8C\u6574\u5DF2\u4FDD\u5B58\u8868\uFF1Bhistory \u5217\u8868\u3001\u6C42\u503C\u7ED3\u679C\u548C\u672A\u4FDD\u5B58\u8349\u7A3F\u4E0D\u80FD\u4EE3\u66FF\u8868\u4F53");
    const format = formats[doc.schema];
    need2(format, "\u5C1A\u4E0D\u652F\u6301\u8FD9\u4E2A\u5B58\u50A8\u8868\u683C\u5F0F");
    const preview = await importStored(raw, { table: ref.table || doc.table, format, version: ref.op === "version" ? ref.version : void 0 }, label);
    preview.provenance += "\n\u5B58\u53D6\u8282\u70B9\u5FEB\u7167\uFF1A\u53D8\u91CF\u8F93\u5165\u672A\u4E0E\u5F53\u524D\u8FD0\u884C\u7ED1\u5B9A\uFF1B\u4E0D\u662F\u5F53\u524D\u5B58\u50A8\u7248\u672C\u7684\u8BC1\u660E\u3002";
    return preview;
  }
  function lastRunUrl(pageUrl, nodeId, observedUrls = []) {
    const page = new URL(pageUrl);
    need2(isWorkflowEditorLocation(page) && (page.protocol === "https:" || page.protocol === "http:" && ["127.0.0.1", "localhost"].includes(page.hostname)), "\u8BF7\u5728\u53D7\u652F\u6301\u7684\u5B89\u5168 Workflow \u9875\u9762\u8BFB\u53D6");
    const match = page.pathname.match(/\/(?:v2\/)?app\/([0-9a-f-]{36})(?:\/workflow)?\/?$/i);
    need2(match && /^[a-zA-Z0-9_-]{1,100}$/.test(nodeId), "\u5E94\u7528\u6216\u8282\u70B9\u6807\u8BC6\u4E0D\u652F\u6301");
    const suffix = `/apps/${match[1]}/workflows/draft/nodes/${nodeId}/last-run`;
    if (page.pathname.startsWith("/app/")) return page.origin + "/console/api" + suffix;
    const candidates = new Set(observedUrls.filter((raw) => {
      try {
        const url = new URL(raw);
        const prefix = url.pathname.slice(0, -suffix.length);
        return url.origin === page.origin && !url.username && !url.password && !url.search && !url.hash && url.pathname.endsWith(suffix) && /^\/(?:[a-zA-Z0-9_-]+\/)*api$/.test(prefix);
      } catch {
        return false;
      }
    }));
    need2(candidates.size === 1, "\u6B64\u5B9A\u5236\u9875\u9762\u7684\u53EA\u8BFB\u63A5\u53E3\u5C1A\u672A\u786E\u8BA4\u3002\u8BF7\u5148\u6253\u5F00\u8BE5\u8282\u70B9\u7684\u300C\u4E0A\u6B21\u8FD0\u884C\u300D\uFF0C\u518D\u70B9\u51FB\u8BFB\u53D6\uFF1B\u4E5F\u53EF\u5BFC\u5165\u5176\u4E2D\u7684 result_json\u3002\u4E0D\u8981\u4E3A\u9884\u89C8\u8FD0\u884C\u4FDD\u5B58\u8282\u70B9\u3002");
    return [...candidates][0];
  }
  async function readStoreLastRun(ref, pageUrl, nodeId, signal, observedUrls = [], request = fetch) {
    const url = lastRunUrl(pageUrl, nodeId, observedUrls);
    const response = await request(url, { method: "GET", credentials: "same-origin", redirect: "error", cache: "no-store", signal, headers: { Accept: "application/json" } });
    need2(response.ok, `\u8BFB\u53D6\u4E0A\u6B21\u8FD0\u884C\u5931\u8D25\uFF08HTTP ${response.status}\uFF09\u3002\u8BF7\u786E\u8BA4\u5DF2\u6709\u8FD0\u884C\u8BB0\u5F55\u548C\u67E5\u770B\u6743\u9650\uFF1B\u4E0D\u4F1A\u89E6\u53D1\u8FD0\u884C\u3002`);
    need2(!response.redirected && (!response.url || response.url === url), "\u53EA\u8BFB\u54CD\u5E94\u5730\u5740\u5DF2\u53D8\u5316");
    need2(response.body, "\u53EA\u8BFB\u54CD\u5E94\u4E3A\u7A7A");
    const reader = response.body.getReader(), chunks = [];
    let bytes = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        need2(bytes <= 8 * 1024 * 1024, "\u8FD0\u884C\u8BB0\u5F55\u8D85\u8FC7 8 MiB \u9650\u5236");
        need2(!signal.aborted, "\u8BFB\u53D6\u5DF2\u53D6\u6D88");
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    const decoder = new TextDecoder(), raw = chunks.map((c) => decoder.decode(c, { stream: true })).join("") + decoder.decode();
    const run = JSON.parse(raw);
    need2(isRecord(run) && run.node_id === nodeId && run.node_type === "tool" && run.status === "succeeded" && typeof run.id === "string", "\u8FD0\u884C\u8BB0\u5F55\u8282\u70B9\u4E0D\u7B26\u6216\u672A\u6210\u529F");
    need2(isRecord(run.inputs) && typeof run.inputs.op === "string" && ["table", "version", "save"].includes(run.inputs.op), "\u8BE5\u8FD0\u884C\u4E0D\u662F\u5B8C\u6574\u8868\u7ED3\u679C\uFF1Bhistory \u4EC5\u542B\u7248\u672C\u5217\u8868");
    need2(isRecord(run.outputs) && run.outputs.status_code === 200 && typeof run.outputs.result_json === "string", "\u4E0A\u6B21\u8FD0\u884C\u6CA1\u6709\u6210\u529F\u7684\u5B8C\u6574 result_json");
    if (ref.op) need2(run.inputs.op === ref.op, "\u4E0A\u6B21\u8FD0\u884C\u64CD\u4F5C\u4E0E\u5F53\u524D\u8282\u70B9\u914D\u7F6E\u4E0D\u7B26");
    const preview = await previewStoreResult(run.outputs.result_json, ref, `\u4E0A\u6B21\u8FD0\u884C ${run.id}`);
    const doc = preview.document;
    need2(isRecord(doc), "\u8868\u4F53\u65E0\u6548");
    if (typeof run.inputs.table === "string" && run.inputs.table.trim()) need2(run.inputs.table.trim() === doc.table, "\u5386\u53F2\u8F93\u5165\u8868\u540D\u4E0E\u7ED3\u679C\u4E0D\u7B26\uFF08\u4E0D\u731C\u6D4B\u522B\u540D\uFF09");
    if (run.inputs.op === "version") need2(typeof run.inputs.version === "string" && /^\d+$/.test(run.inputs.version) && Number(run.inputs.version) === doc.version, "\u5386\u53F2\u8BF7\u6C42\u7248\u672C\u4E0E\u8FD4\u56DE\u8868\u4F53\u4E0D\u7B26");
    need2(!signal.aborted, "\u8BFB\u53D6\u5DF2\u53D6\u6D88");
    preview.provenance = `\u5DF2\u6709\u8FD0\u884C\u8BB0\u5F55 \xB7 ${run.id} \xB7 \u64CD\u4F5C ${run.inputs.op} \xB7 \u65F6\u95F4 ${typeof run.finished_at === "number" ? new Date(run.finished_at * 1e3).toISOString() : "\u672A\u63D0\u4F9B"}
\u4EC5 GET \u8BFB\u53D6\u8BB0\u5F55\uFF1B\u672A\u6267\u884C\u8282\u70B9\u3002\u8BB0\u5F55\u53EF\u80FD\u65E9\u4E8E\u5F53\u524D\u914D\u7F6E\u6216\u5B58\u50A8\u7248\u672C\u3002
` + preview.provenance.replace("\u672C\u5730\u5BFC\u5165\u5FEB\u7167", "\u5386\u53F2\u7ED3\u679C\u5FEB\u7167").replace("\u4E0D\u8054\u7F51\u3001\u4E0D\u6267\u884C\u3001\u4E0D\u4FDD\u5B58\u5230\u78C1\u76D8", "\u8BFB\u53D6\u5DF2\u6709\u8BB0\u5F55\u3001\u4E0D\u6267\u884C\u8282\u70B9\u3001\u4E0D\u4FDD\u5B58\u5230\u78C1\u76D8");
    return preview;
  }

  // src/reader-app.ts
  var connections;
  var uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  function need3(ok, text) {
    if (!ok) throw Error(text);
  }
  function editor(url) {
    const u = new URL(url);
    need3(u.protocol === "https:" || u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname), "\u67E5\u8BE2\u8FDE\u63A5\u53EA\u652F\u6301 HTTPS \u6216\u672C\u673A\u56DE\u73AF\u9875\u9762");
    need3(isWorkflowEditorLocation(u), "\u8BF7\u5728 Dify \u5DE5\u4F5C\u6D41\u7F16\u8F91\u9875\u9762\u8FDE\u63A5");
    const id = (/^\/app\/([^/]+)\/workflow\/?$/.exec(u.pathname) || /^\/v2\/app\/([^/]+)\/?$/.exec(u.pathname))?.[1];
    need3(id && uuid.test(id), "\u8BF7\u5728 Dify \u5DE5\u4F5C\u6D41\u7F16\u8F91\u9875\u9762\u8FDE\u63A5");
    return { origin: u.origin, editorAppId: id };
  }
  function clearReaderConnections() {
    connections = void 0;
  }
  function readerConnected(url) {
    if (!connections) return false;
    try {
      const scope = editor(url);
      if (scope.origin === connections.origin && scope.editorAppId === connections.editorAppId) return true;
    } catch {
    }
    clearReaderConnections();
    return false;
  }
  function connectReaders(raw, url) {
    clearReaderConnections();
    need3(raw.length <= 65536, "\u67E5\u8BE2\u8FDE\u63A5\u6587\u4EF6\u8D85\u8FC7 64 KiB");
    const scope = editor(url), data = parseJson(raw);
    need3(isRecord(data) && data.schema === "dmn-preview.reader-apps/v1", "\u67E5\u8BE2\u8FDE\u63A5\u6587\u4EF6\u683C\u5F0F\u4E0D\u652F\u6301");
    need3(data.origin === scope.origin && data.editorAppId === scope.editorAppId, "\u67E5\u8BE2\u8FDE\u63A5\u4E0D\u5C5E\u4E8E\u5F53\u524D\u7AD9\u70B9\u548C\u7F16\u8F91\u5E94\u7528");
    need3(Array.isArray(data.readers) && data.readers.length > 0 && data.readers.length <= 64, "\u67E5\u8BE2\u8FDE\u63A5\u5FC5\u987B\u6709 1..64 \u4E2A\u8868\u7ED1\u5B9A");
    const keys = /* @__PURE__ */ new Set();
    const readers = data.readers.map((r) => {
      need3(isRecord(r) && typeof r.table === "string" && r.table.length > 0 && r.table.length <= 256 && ["latest", "version"].includes(String(r.mode)), "\u67E5\u8BE2\u8868\u7ED1\u5B9A\u65E0\u6548");
      need3(typeof r.appCode === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(r.appCode), "\u67E5\u8BE2\u5E94\u7528\u4EE3\u7801\u65E0\u6548");
      need3(typeof r.readAppId === "string" && uuid.test(r.readAppId) && typeof r.publishedWorkflowId === "string" && uuid.test(r.publishedWorkflowId), "\u67E5\u8BE2\u5E94\u7528\u6216\u53D1\u5E03\u7248\u672C\u7F16\u53F7\u65E0\u6548");
      const key = r.table + "/" + r.mode;
      need3(!keys.has(key), "\u67E5\u8BE2\u8868\u7ED1\u5B9A\u91CD\u590D");
      keys.add(key);
      return { table: r.table, mode: r.mode, appCode: r.appCode, readAppId: r.readAppId, publishedWorkflowId: r.publishedWorkflowId };
    });
    connections = { ...scope, readers };
  }
  async function responseText(response) {
    need3(response.ok, `\u67E5\u8BE2\u63A5\u53E3\u8FD4\u56DE HTTP ${response.status}\uFF1B\u8BF7\u68C0\u67E5\u5E94\u7528\u8BBF\u95EE\u6743\u9650`);
    need3(response.body, "\u67E5\u8BE2\u63A5\u53E3\u6CA1\u6709\u54CD\u5E94\u4F53");
    const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
    let size = 0, text = "";
    try {
      for (; ; ) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        need3(size <= 8 * 1024 * 1024, "\u67E5\u8BE2\u54CD\u5E94\u8D85\u8FC7 8 MiB\uFF0C\u672A\u663E\u793A\u622A\u65AD\u8868");
        text += decoder.decode(part.value, { stream: true });
      }
      return text + decoder.decode();
    } finally {
      await reader.cancel().catch(() => {
      });
      reader.releaseLock();
    }
  }
  async function readFromApp(ref, url, signal, request = globalThis.fetch) {
    need3(readerConnected(url) && connections, "\u5C1A\u672A\u8FDE\u63A5\u5F53\u524D\u5E94\u7528\u7684\u53EA\u8BFB\u67E5\u8BE2\u5E94\u7528");
    const scope = connections;
    const mode = ref.version ? "version" : "latest";
    const rd = scope.readers.find((r) => r.table === ref.table && r.mode === mode);
    need3(rd, `\u6CA1\u6709\u8BE5\u8868\u7684 ${mode === "version" ? "\u6307\u5B9A\u7248\u672C" : "\u5F53\u524D\u7248\u672C"} \u67E5\u8BE2\u7ED1\u5B9A\uFF1B\u672A\u56DE\u9000\u5176\u4ED6\u8BFB\u53D6\u8DEF\u5F84`);
    if (ref.version) need3(/^[1-9]\d*$/.test(ref.version) && Number.isSafeInteger(Number(ref.version)), "\u8282\u70B9\u7248\u672C\u5FC5\u987B\u662F\u6B63\u6574\u6570");
    const auth = await request(scope.origin + "/api/passport", { method: "GET", credentials: "same-origin", redirect: "error", cache: "no-store", signal, headers: { "X-App-Code": rd.appCode } });
    const passport = parseJson(await responseText(auth));
    need3(isRecord(passport) && typeof passport.access_token === "string" && passport.access_token.length <= 16384, "\u65E0\u6CD5\u53D6\u5F97\u67E5\u8BE2\u5E94\u7528\u7684\u8BBF\u95EE\u8EAB\u4EFD\uFF1B\u8BF7\u5148\u5B8C\u6210\u8BE5\u5E94\u7528\u767B\u5F55");
    const response = await request(scope.origin + "/api/workflows/run", {
      method: "POST",
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
      signal,
      headers: { "Content-Type": "application/json", "X-App-Code": rd.appCode, "X-App-Passport": passport.access_token },
      body: JSON.stringify({ inputs: mode === "version" ? { version: ref.version } : {}, files: [] })
    });
    const text = await responseText(response);
    let final;
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const event = parseJson(line.slice(5).trim());
      need3(isRecord(event), "\u67E5\u8BE2\u4E8B\u4EF6\u683C\u5F0F\u65E0\u6548");
      need3(event.event !== "error", "\u67E5\u8BE2\u5E94\u7528\u8FD0\u884C\u5931\u8D25\uFF1B\u672A\u53D6\u5F97\u5B8C\u6574\u8868");
      if (event.event === "workflow_finished") {
        need3(!final && isRecord(event.data), "\u67E5\u8BE2\u7ED3\u675F\u4E8B\u4EF6\u65E0\u6548");
        final = event.data;
      }
    }
    need3(final?.status === "succeeded" && final.workflow_id === rd.publishedWorkflowId, "\u67E5\u8BE2\u5931\u8D25\u6216\u5DF2\u53D1\u5E03\u5DE5\u4F5C\u6D41\u7248\u672C\u6539\u53D8\uFF1B\u8BF7\u7531\u7EF4\u62A4\u8005\u590D\u6838\u7ED1\u5B9A");
    const outputs = final.outputs;
    need3(isRecord(outputs) && outputs.status_code === 200 && typeof outputs.result_json === "string", "\u67E5\u8BE2\u672A\u8FD4\u56DE\u6210\u529F\u8868\u4F53\uFF1B\u6307\u5B9A\u7248\u672C\u7F3A\u5931\u65F6\u4E0D\u56DE\u9000\u6700\u65B0\u7248");
    need3(connections === scope && !signal.aborted, "\u67E5\u8BE2\u8FDE\u63A5\u5DF2\u5207\u6362\uFF0C\u7ED3\u679C\u5DF2\u4E22\u5F03");
    const preview = await importStored(outputs.result_json, ref, "\u5DF2\u53D1\u5E03\u67E5\u8BE2\u5E94\u7528\u54CD\u5E94", "reader");
    need3(connections === scope && !signal.aborted, "\u67E5\u8BE2\u8FDE\u63A5\u5DF2\u5207\u6362\uFF0C\u7ED3\u679C\u5DF2\u4E22\u5F03");
    const finished = typeof final.finished_at === "number" && Math.abs(final.finished_at) < 864e10 ? new Date(final.finished_at * 1e3).toISOString() : "\u672A\u63D0\u4F9B";
    preview.provenance = `\u67E5\u8BE2\u5E94\u7528 ${rd.readAppId}
\u53D1\u5E03\u7248\u672C ${rd.publishedWorkflowId}
\u8FD0\u884C ${String(final.id || "")} \xB7 \u5B8C\u6210\u65F6\u95F4 ${finished}
${preview.provenance}
\u5DF2\u8FD0\u884C\u67E5\u8BE2\u5E94\u7528\u5E76\u4EA7\u751F\u8BB0\u5F55\uFF1B\u8868\u5185\u5BB9\u5BF9\u5E94\u8FD9\u6B21\u67E5\u8BE2\u5B8C\u6210\u65F6\u523B\u3002`;
    return preview;
  }

  // src/view.ts
  var pendingReads = /* @__PURE__ */ new WeakMap();
  function cancelPreview(container) {
    pendingReads.get(container)?.abort();
    pendingReads.delete(container);
  }
  var renderGenerations = /* @__PURE__ */ new WeakMap();
  function element(document2, tag, text, className) {
    const result = document2.createElement(tag);
    if (text !== void 0) result.textContent = text;
    if (className) result.className = className;
    return result;
  }
  function renderSnapshot(container, snapshot, page = 0) {
    cancelPreview(container);
    const document2 = container.ownerDocument;
    readerConnected(document2.location.href);
    renderGenerations.set(container, {});
    container.replaceChildren();
    container.dataset.status = snapshot.status;
    if (snapshot.nodeId) container.dataset.nodeId = snapshot.nodeId;
    else delete container.dataset.nodeId;
    const source = element(document2, "div", snapshot.nodeId ? `${snapshot.title} \xB7 \u8282\u70B9 ${snapshot.nodeId}` : "\u5F53\u524D\u5DE5\u4F5C\u6D41\u8282\u70B9", "dmnp-source");
    container.append(source);
    if (snapshot.status !== "ready") {
      const message = element(document2, "div", snapshot.message || "\u65E0\u6CD5\u8BFB\u53D6\u5F53\u524D\u8282\u70B9\u3002", "dmnp-status");
      message.setAttribute("role", snapshot.status === "error" ? "alert" : "status");
      container.append(message);
      if (snapshot.storage) importControls(container, snapshot.storage);
      if (snapshot.storeNode && snapshot.nodeId) storeControls(container, snapshot);
      return;
    }
    const parsed = snapshot.format === "dmn-xml" ? parseXml(snapshot, document2) : snapshot.format ? parseBrian(snapshot) : parseTable(snapshot.raw);
    if (parsed.kind !== "ready") {
      container.dataset.status = parsed.kind;
      const message = element(document2, "div", parsed.message, "dmnp-status");
      message.setAttribute("role", parsed.kind === "error" ? "alert" : "status");
      container.append(message);
      if ("storage" in parsed && parsed.storage) importControls(container, parsed.storage);
      return;
    }
    const body = element(document2, "div");
    container.append(body);
    renderMatrix(body, parsed.matrix, !!snapshot.format, page);
  }
  function renderMatrix(container, matrix, formatted, page = 0) {
    const document2 = container.ownerDocument;
    container.replaceChildren();
    const columns = matrix.fields.length + matrix.outputs.length + 2;
    if (columns > 128) {
      container.dataset.status = "error";
      if (container.parentElement?.dataset.status) container.parentElement.dataset.status = "error";
      container.append(element(document2, "div", `\u6B64\u8868\u542B ${columns} \u5217\uFF0C\u8D85\u8FC7\u53EF\u8BFB\u9884\u89C8\u4E0A\u9650 128 \u5217\uFF1B\u672A\u663E\u793A\u4E0D\u5B8C\u6574\u8868\u683C\u3002`, "dmnp-status"));
      return;
    }
    const pageSize = 50;
    const pages = Math.max(1, Math.ceil(matrix.rows.length / pageSize));
    page = Math.max(0, Math.min(page, pages - 1));
    container.append(element(document2, "div", `${matrix.table.id} \xB7 ${matrix.table.hit_policy} \xB7 ${matrix.rows.length} \u6761\u89C4\u5219 \xB7 \u9884\u89C8\u4E0D\u6C42\u503C`, "dmnp-meta"));
    if (matrix.note) container.append(element(document2, "div", matrix.note, "dmnp-meta"));
    const scroll = element(document2, "div", void 0, "dmnp-scroll");
    scroll.tabIndex = 0;
    scroll.setAttribute("aria-label", "\u51B3\u7B56\u8868\uFF0C\u53EF\u6A2A\u5411\u6EDA\u52A8");
    const table = document2.createElement("table");
    table.setAttribute("aria-label", `\u51B3\u7B56\u8868 ${matrix.table.id}`);
    const head = table.createTHead();
    const header = head.insertRow();
    for (const [index, label] of ["\u89C4\u5219", ...matrix.fields.map((field) => `\u6761\u4EF6 \xB7 ${formatted ? field : literal(field)}`), "\u903B\u8F91", ...matrix.outputs.map((output) => `\u8F93\u51FA \xB7 ${output.label}`)].entries()) {
      const th = document2.createElement("th");
      th.textContent = label;
      th.scope = "col";
      if (index === matrix.fields.length + 1) th.className = "dmnp-logic-cell";
      if (index > matrix.fields.length + 1) th.className = "dmnp-output-cell";
      header.append(th);
    }
    const body = table.createTBody();
    for (const row of matrix.rows.slice(page * pageSize, (page + 1) * pageSize)) {
      const tr = body.insertRow();
      const id = document2.createElement("th");
      id.scope = "row";
      id.textContent = row.rule.id;
      tr.append(id);
      for (const field of matrix.fields) {
        const cell = tr.insertCell();
        const atoms = row.atoms.filter((atom) => atom.field === field);
        cell.textContent = atoms.length ? atoms.map((atom) => `${atom.id}: ${atom.label}`).join("\n") : "\u2014";
      }
      const logic = tr.insertCell();
      logic.className = "dmnp-logic-cell";
      const details = document2.createElement("details");
      details.append(element(document2, "summary", row.logic), element(document2, "div", row.fullLogic, "dmnp-full-logic"));
      logic.append(details);
      for (const output of matrix.outputs) {
        const cell = tr.insertCell();
        cell.className = "dmnp-output-cell";
        const value = outputValue(row.rule, output);
        const text = !value.present ? "\u672A\u5B9A\u4E49" : value.expanded ? "\u89C1\u5C55\u5F00\u5217" : literal(value.value);
        if (text.length > 140) {
          const expanded = document2.createElement("details");
          expanded.append(element(document2, "summary", "\u5C55\u5F00\u5B8C\u6574\u8F93\u51FA"), element(document2, "pre", text));
          cell.append(expanded);
        } else cell.textContent = text;
      }
    }
    scroll.append(table);
    container.append(scroll);
    if (!matrix.rows.length) container.append(element(document2, "div", "\u6B64\u8868\u6CA1\u6709\u89C4\u5219\u3002", "dmnp-status"));
    if (pages > 1) {
      const paging = element(document2, "nav", void 0, "dmnp-paging");
      paging.setAttribute("aria-label", "\u89C4\u5219\u5206\u9875");
      const previous = element(document2, "button", "\u4E0A\u4E00\u9875");
      previous.disabled = page === 0;
      previous.addEventListener("click", () => renderMatrix(container, matrix, formatted, page - 1));
      const next = element(document2, "button", "\u4E0B\u4E00\u9875");
      next.disabled = page === pages - 1;
      next.addEventListener("click", () => renderMatrix(container, matrix, formatted, page + 1));
      paging.append(previous, element(document2, "span", `\u7B2C ${page + 1}/${pages} \u9875 \xB7 \u6BCF\u9875\u6700\u591A ${pageSize} \u6761`), next);
      container.append(paging);
    }
    container.append(element(document2, "div", "\u53EA\u8BFB\u7ED3\u6784\u9884\u89C8 \xB7 \u70B9\u51FB\u903B\u8F91\u67E5\u770B\u5B8C\u6574\u6761\u4EF6 \xB7 \u9884\u89C8\u4E0D\u5224\u65AD\u89C4\u5219\u547D\u4E2D", "dmnp-footnote"));
  }
  function importControls(container, ref) {
    const document2 = container.ownerDocument;
    const generation = renderGenerations.get(container);
    const referenceMessage = container.querySelector(":scope > .dmnp-status");
    const originalMessage = referenceMessage?.textContent || "";
    const controls = document2.createElement("details");
    controls.open = !readerConnected(document2.location.href);
    controls.append(element(document2, "summary", "\u8868\u6587\u4EF6\u4E0E\u67E5\u8BE2\u8FDE\u63A5\u8BBE\u7F6E"));
    controls.append(element(document2, "p", "\u53EF\u5BFC\u5165\u5DF2\u4FDD\u5B58\u8868\uFF0C\u6216\u8FDE\u63A5\u7EF4\u62A4\u8005\u63D0\u4F9B\u7684\u67E5\u8BE2\u5E94\u7528\u3002\u8FDE\u63A5\u540E\u5207\u6362\u8282\u70B9\u4F1A\u81EA\u52A8\u8FD0\u884C\u56FA\u5B9A\u67E5\u8BE2\uFF0C\u5E76\u4EA7\u751F Dify \u8FD0\u884C\u8BB0\u5F55\uFF1B\u4E0D\u6267\u884C\u5F53\u524D\u4E1A\u52A1\u8282\u70B9\u3002\u8FDE\u63A5\u4EC5\u672C\u6807\u7B7E\u9875\u6709\u6548\u3002", "dmnp-footnote"));
    controls.append(element(document2, "p", "\u4EC5\u8FDE\u63A5\u7EF4\u62A4\u8005\u9501\u5B9A\u53EA\u8BFB\u914D\u7F6E\u7684\u4E13\u7528\u5E94\u7528\u3002\u53D1\u5E03\u7248\u672C\u5728\u8FD0\u884C\u540E\u6838\u5BF9\uFF1A\u53D8\u66F4\u4F1A\u62D2\u7EDD\u5C55\u793A\uFF0C\u4F46\u65E0\u6CD5\u64A4\u9500\u5DF2\u53D1\u751F\u7684\u6267\u884C\u3002", "dmnp-footnote"));
    const input = document2.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.setAttribute("aria-label", "\u5BFC\u5165\u5DF2\u4FDD\u5B58\u7684\u5B58\u50A8\u8868 JSON");
    const config = document2.createElement("input");
    config.type = "file";
    config.accept = ".json,application/json";
    config.setAttribute("aria-label", "\u9009\u62E9\u7EF4\u62A4\u8005\u63D0\u4F9B\u7684\u67E5\u8BE2\u8FDE\u63A5 JSON");
    const enable = element(document2, "button", "\u542F\u7528\u67E5\u8BE2\u4E0E\u81EA\u52A8\u8BFB\u53D6");
    const refresh = element(document2, "button", "\u91CD\u65B0\u67E5\u8BE2");
    const disconnect = element(document2, "button", "\u65AD\u5F00\u67E5\u8BE2");
    const output = element(document2, "div");
    controls.append(
      element(document2, "div", "\u672C\u5730\u8868\u6587\u4EF6\uFF08\u53EF\u9009\uFF09", "dmnp-footnote"),
      input,
      element(document2, "div", "\u7EF4\u62A4\u8005\u5BA1\u6838\u7684\u67E5\u8BE2\u8FDE\u63A5\uFF08\u53EF\u9009\uFF09", "dmnp-footnote"),
      config,
      enable
    );
    container.append(controls, refresh, disconnect, output);
    let attempt = 0;
    async function load(source, task) {
      cancelPreview(container);
      const controller = new AbortController();
      pendingReads.set(container, controller);
      const current = ++attempt;
      const timeout = setTimeout(() => controller.abort(), 6e4);
      const active = () => renderGenerations.get(container) === generation && attempt === current && container.isConnected;
      output.replaceChildren(element(document2, "div", source === "local" ? "\u6B63\u5728\u6838\u5BF9\u6587\u4EF6\u3001\u7248\u672C\u548C\u6458\u8981\u2026" : "\u6B63\u5728\u8FD0\u884C\u5DF2\u6388\u6743\u7684\u67E5\u8BE2\u5E94\u7528\uFF0C\u5E76\u6838\u5BF9\u7248\u672C\u548C\u6458\u8981\u2026", "dmnp-status"));
      container.dataset.status = "unsupported";
      if (referenceMessage) referenceMessage.textContent = originalMessage;
      try {
        const preview = await task(controller.signal);
        if (!active()) return;
        output.replaceChildren();
        container.dataset.status = source === "local" ? "imported" : "queried";
        if (referenceMessage) referenceMessage.textContent = source === "local" ? "\u8282\u70B9\u4EC5\u542B\u5B58\u50A8\u5F15\u7528\u3002\u4EE5\u4E0B\u5C55\u793A\u5DF2\u5BFC\u5165\u5FEB\u7167\uFF1B\u672A\u67E5\u8BE2\u7EBF\u4E0A\u5F53\u524D\u7248\u672C\u3002" : "\u8282\u70B9\u4EC5\u542B\u5B58\u50A8\u5F15\u7528\u3002\u4EE5\u4E0B\u8868\u4F53\u6765\u81EA\u5DF2\u6388\u6743\u67E5\u8BE2\u5E94\u7528\uFF0C\u5DF2\u6838\u5BF9\u8282\u70B9\u7248\u672C\u548C\u6458\u8981\u7EA6\u675F\u3002";
        controls.open = false;
        showStored(output, preview);
      } catch (e) {
        if (!active()) return;
        container.dataset.status = "error";
        output.replaceChildren();
        const message = element(document2, "div", controller.signal.aborted ? "\u67E5\u8BE2\u53D6\u6D88\u6216\u8D85\u65F6\uFF0C\u672A\u663E\u793A\u65E7\u8868\uFF1B\u67E5\u8BE2\u5E94\u7528\u53EF\u80FD\u5DF2\u7559\u4E0B\u8FD0\u884C\u8BB0\u5F55\u3002" : e instanceof Error ? e.message : "\u8BFB\u53D6\u5931\u8D25", "dmnp-status");
        message.setAttribute("role", "alert");
        output.append(message);
      } finally {
        clearTimeout(timeout);
        if (pendingReads.get(container) === controller) pendingReads.delete(container);
      }
    }
    input.addEventListener("change", () => load("local", async () => {
      const file = input.files?.[0];
      if (!file) throw Error("\u672A\u9009\u62E9\u6587\u4EF6");
      if (file.size > MAX_IMPORT_BYTES) throw Error("\u6587\u4EF6\u8D85\u8FC7 832 KiB \u5BFC\u5165\u4E0A\u9650");
      return importStored(await file.text(), ref, file.name);
    }));
    const query = () => load("reader", (signal) => readFromApp(ref, document2.location.href, signal));
    enable.addEventListener("click", () => load("reader", async (signal) => {
      const activationUrl = document2.location.href;
      const file = config.files?.[0];
      if (!file || file.size > 65536) throw Error("\u8BF7\u9009\u62E9\u4E0D\u8D85\u8FC7 64 KiB \u7684\u67E5\u8BE2\u8FDE\u63A5\u6587\u4EF6");
      const raw = await file.text();
      if (signal.aborted || renderGenerations.get(container) !== generation || !container.isConnected || document2.location.href !== activationUrl) throw Error("\u8FDE\u63A5\u64CD\u4F5C\u5DF2\u53D6\u6D88\uFF0C\u672A\u542F\u7528\u67E5\u8BE2");
      connectReaders(raw, activationUrl);
      return readFromApp(ref, activationUrl, signal);
    }));
    refresh.addEventListener("click", query);
    disconnect.addEventListener("click", () => {
      ++attempt;
      cancelPreview(container);
      clearReaderConnections();
      output.replaceChildren();
      container.dataset.status = "unsupported";
      if (referenceMessage) referenceMessage.textContent = originalMessage;
    });
    if (readerConnected(document2.location.href)) void query();
  }
  function showStored(output, preview) {
    const document2 = output.ownerDocument;
    const lines = preview.provenance.split("\n");
    output.append(element(document2, "div", lines.filter((line) => line.startsWith("\u8868 ") || line.startsWith("content_sha256")).join("\n"), "dmnp-meta"));
    const provenance = document2.createElement("details");
    provenance.append(element(document2, "summary", "\u6765\u6E90\u3001\u8FD0\u884C\u8BB0\u5F55\u4E0E\u6458\u8981\u6821\u9A8C\uFF08\u5C55\u5F00\uFF09"), element(document2, "div", preview.provenance, "dmnp-status"));
    output.append(provenance);
    const select = document2.createElement("select");
    select.setAttribute("aria-label", "\u9009\u62E9\u51B3\u7B56\u96C6\u6A21\u578B");
    preview.models.forEach((m, i) => {
      const option = document2.createElement("option");
      option.value = String(i);
      option.textContent = `${m.key} \xB7 ${m.matrix.table.id}`;
      select.append(option);
    });
    if (preview.models.length > 1) output.append(select);
    const matrix = element(document2, "div");
    output.append(matrix);
    const render = () => renderMatrix(matrix, preview.models[Number(select.value || 0)].matrix, true);
    select.addEventListener("change", render);
    render();
    const details = document2.createElement("details");
    details.append(element(document2, "summary", "\u5B8C\u6574\u5BFC\u5165\u6587\u6863\uFF08\u542B\u58F0\u660E\u3001\u5B57\u5178\u4E0E\u6A21\u677F\uFF09"), element(document2, "pre", JSON.stringify(preview.document, null, 2)));
    output.append(details);
  }
  function storeControls(container, snapshot) {
    const document2 = container.ownerDocument, generation = renderGenerations.get(container);
    const activationUrl = document2.location.href;
    const read = element(document2, "button", "\u8BFB\u53D6\u4E0A\u6B21\u8FD0\u884C\uFF08\u53EA\u8BFB\uFF09");
    const input = document2.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.setAttribute("aria-label", "\u5BFC\u5165\u5B58\u53D6\u7ED3\u679C result_json \u6216\u5DF2\u4FDD\u5B58\u8868 JSON");
    const output = element(document2, "div");
    container.append(element(document2, "p", "\u4E0B\u65B9\u53EA\u663E\u793A\u5DF2\u6709\u5386\u53F2\u5FEB\u7167\uFF0C\u4E0D\u4EE3\u8868\u5F53\u524D\u5B58\u50A8\u6700\u65B0\u7248\u3002\u6CA1\u6709\u5B8C\u6574\u8868\u4F53\u65F6\u4E0D\u4F1A\u751F\u6210\u8868\u683C\u3002", "dmnp-footnote"), read, input, output);
    let attempt = 0;
    async function load(task) {
      cancelPreview(container);
      const controller = new AbortController();
      pendingReads.set(container, controller);
      const current = ++attempt, timer = setTimeout(() => controller.abort(), 3e4);
      const active = () => renderGenerations.get(container) === generation && attempt === current && container.isConnected && document2.location.href === activationUrl;
      output.replaceChildren(element(document2, "div", "\u6B63\u5728\u8BFB\u53D6\u5E76\u6838\u5BF9\u5386\u53F2\u8868\u4F53\u3001\u7248\u672C\u548C\u6458\u8981\u2026", "dmnp-status"));
      container.dataset.status = "dynamic";
      try {
        const preview = await task(controller.signal);
        if (!active()) return;
        if (controller.signal.aborted) throw Error("\u8BFB\u53D6\u5DF2\u53D6\u6D88\u6216\u8D85\u65F6");
        output.replaceChildren(element(document2, "div", "\u5386\u53F2\u5FEB\u7167 \xB7 \u672A\u786E\u8BA4\u5F53\u524D\u5B58\u50A8\u7248\u672C", "dmnp-status"));
        container.dataset.status = "historical";
        showStored(output, preview);
      } catch (e) {
        if (!active()) return;
        container.dataset.status = "error";
        output.replaceChildren(element(document2, "div", controller.signal.aborted ? "\u8BFB\u53D6\u5DF2\u53D6\u6D88\u6216\u8D85\u65F6\uFF1B\u672A\u663E\u793A\u65E7\u8868\u3002" : e instanceof Error ? e.message : "\u8BFB\u53D6\u5931\u8D25", "dmnp-status"));
      } finally {
        clearTimeout(timer);
        if (pendingReads.get(container) === controller) pendingReads.delete(container);
      }
    }
    read.addEventListener("click", () => load((signal) => {
      const observed = document2.defaultView?.performance.getEntriesByType?.("resource").map((entry) => entry.name) || [];
      return readStoreLastRun(snapshot.storeNode, activationUrl, snapshot.nodeId, signal, observed);
    }));
    input.addEventListener("change", () => load(async () => {
      const file = input.files?.[0];
      if (!file || file.size > MAX_IMPORT_BYTES) throw Error("\u8BF7\u9009\u62E9\u4E0D\u8D85\u8FC7 832 KiB \u7684 JSON \u6587\u4EF6");
      return previewStoreResult(await file.text(), snapshot.storeNode, file.name);
    }));
  }

  // src/content.ts
  var existing = document.getElementById("dmn-preview-extension-root");
  if (existing) {
    existing.hidden = false;
    document.dispatchEvent(new CustomEvent(REFRESH_EVENT));
  } else {
    let notify = function(type) {
      try {
        if (typeof chrome !== "undefined" && typeof chrome.runtime?.sendMessage === "function")
          chrome.runtime.sendMessage({ type }).catch(() => {
          });
      } catch {
      }
    }, receive = function(event) {
      const detail = event.detail;
      if (typeof detail !== "string" || detail.length > (MAX_DEFINITION_BYTES + MAX_TABLE_CHARS) * 2 + 8192) return;
      let snapshot;
      try {
        snapshot = JSON.parse(detail);
      } catch {
        return;
      }
      if (!snapshot || !["ready", "empty", "dynamic", "unsupported", "idle", "error"].includes(snapshot.status)) return;
      const rawLimit = snapshot.format === "brian-decision" ? MAX_DEFINITION_BYTES : MAX_TABLE_CHARS;
      if (snapshot.raw !== void 0 && (typeof snapshot.raw !== "string" || snapshot.raw.length > rawLimit || new TextEncoder().encode(snapshot.raw).length > rawLimit)) return;
      if (snapshot.auxiliary !== void 0 && (typeof snapshot.auxiliary !== "string" || snapshot.auxiliary.length > MAX_TABLE_CHARS || new TextEncoder().encode(snapshot.auxiliary).length > MAX_TABLE_CHARS)) return;
      if (snapshot.format !== void 0 && !["brian-json", "brian-decision", "dmn-xml"].includes(snapshot.format)) return;
      if (snapshot.storage !== void 0 && (!snapshot.storage || typeof snapshot.storage !== "object" || typeof snapshot.storage.table !== "string" || typeof snapshot.storage.format !== "string" || Object.entries(snapshot.storage).some(([k, v]) => !["table", "format", "version", "digest"].includes(k) || typeof v !== "string" || v.length > 1024))) return;
      if (snapshot.storeNode !== void 0 && (!snapshot.storeNode || typeof snapshot.storeNode !== "object" || Object.entries(snapshot.storeNode).some(([k, v]) => !["table", "version", "op"].includes(k) || typeof v !== "string" || v.length > 1024))) return;
      if (snapshot.nodeId !== void 0 && typeof snapshot.nodeId !== "string") return;
      if (snapshot.title !== void 0 && typeof snapshot.title !== "string") return;
      if (snapshot.message !== void 0 && typeof snapshot.message !== "string") return;
      lastReceived = Date.now();
      if (!announced) {
        announced = true;
        notify("dmn-preview-active");
      }
      if (detail === lastSnapshot && !stale) return;
      stale = false;
      lastSnapshot = detail;
      renderSnapshot(body, snapshot);
    }, cleanup = function() {
      cancelPreview(body);
      clearReaderConnections();
      clearInterval(watchdog);
      document.removeEventListener(SNAPSHOT_EVENT, receive);
      document.dispatchEvent(new CustomEvent(STOP_EVENT));
      root.remove();
      notify("dmn-preview-closed");
    };
    notify2 = notify, receive2 = receive, cleanup2 = cleanup;
    const root = element(document, "section");
    root.id = "dmn-preview-extension-root";
    root.setAttribute("aria-label", "DMN \u6269\u5C55\u53EA\u8BFB\u9884\u89C8");
    const header = element(document, "header");
    const title = element(document, "strong", "DMN \u51B3\u7B56\u8868");
    const readonly = element(document, "span", "\u6D4F\u89C8\u5668\u6269\u5C55 \xB7 \u53EA\u8BFB", "dmnp-badge");
    const grow = element(document, "button", "\u5C55\u5F00");
    grow.setAttribute("aria-label", "\u5C55\u5F00\u6216\u8FD8\u539F\u51B3\u7B56\u8868");
    grow.addEventListener("click", () => {
      const expanded = root.classList.toggle("dmnp-expanded");
      grow.textContent = expanded ? "\u8FD8\u539F" : "\u5C55\u5F00";
    });
    const close = element(document, "button", "\u5173\u95ED");
    const body = element(document, "div", void 0, "dmnp-body");
    let lastSnapshot = "";
    let lastReceived = Date.now();
    let stale = false;
    let announced = false;
    const watchdog = setInterval(() => {
      if (Date.now() - lastReceived > 5e3 && !stale) {
        stale = true;
        renderSnapshot(body, { status: "error", message: "\u5F53\u524D\u8282\u70B9\u8BFB\u53D6\u5DF2\u4E2D\u65AD\uFF0C\u65E7\u9884\u89C8\u5DF2\u6E05\u9664\u3002\u8BF7\u518D\u6B21\u70B9\u51FB\u6269\u5C55\u542F\u7528\u3002" });
      }
    }, 1e3);
    close.addEventListener("click", cleanup);
    header.append(title, readonly, grow, close);
    root.append(header, body);
    document.documentElement.append(root);
    document.addEventListener(SNAPSHOT_EVENT, receive);
    renderSnapshot(body, { status: "idle", message: "\u6B63\u5728\u8BFB\u53D6\u5F53\u524D\u9009\u4E2D\u7684 DMN \u8282\u70B9\u2026" });
  }
  var notify2;
  var receive2;
  var cleanup2;
})();
