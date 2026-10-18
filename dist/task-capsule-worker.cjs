var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/codegen/code.js
var require_code = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/codegen/code.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.regexpCode = exports2.getEsmExportName = exports2.getProperty = exports2.safeStringify = exports2.stringify = exports2.strConcat = exports2.addCodeArg = exports2.str = exports2._ = exports2.nil = exports2._Code = exports2.Name = exports2.IDENTIFIER = exports2._CodeOrName = void 0;
    var _CodeOrName = class {
    };
    exports2._CodeOrName = _CodeOrName;
    exports2.IDENTIFIER = /^[a-z$_][a-z$_0-9]*$/i;
    var Name = class extends _CodeOrName {
      constructor(s) {
        super();
        if (!exports2.IDENTIFIER.test(s))
          throw new Error("CodeGen: name must be a valid identifier");
        this.str = s;
      }
      toString() {
        return this.str;
      }
      emptyStr() {
        return false;
      }
      get names() {
        return { [this.str]: 1 };
      }
    };
    exports2.Name = Name;
    var _Code = class extends _CodeOrName {
      constructor(code) {
        super();
        this._items = typeof code === "string" ? [code] : code;
      }
      toString() {
        return this.str;
      }
      emptyStr() {
        if (this._items.length > 1)
          return false;
        const item = this._items[0];
        return item === "" || item === '""';
      }
      get str() {
        var _a;
        return (_a = this._str) !== null && _a !== void 0 ? _a : this._str = this._items.reduce((s, c) => `${s}${c}`, "");
      }
      get names() {
        var _a;
        return (_a = this._names) !== null && _a !== void 0 ? _a : this._names = this._items.reduce((names, c) => {
          if (c instanceof Name)
            names[c.str] = (names[c.str] || 0) + 1;
          return names;
        }, {});
      }
    };
    exports2._Code = _Code;
    exports2.nil = new _Code("");
    function _(strs, ...args) {
      const code = [strs[0]];
      let i = 0;
      while (i < args.length) {
        addCodeArg(code, args[i]);
        code.push(strs[++i]);
      }
      return new _Code(code);
    }
    exports2._ = _;
    var plus = new _Code("+");
    function str(strs, ...args) {
      const expr = [safeStringify(strs[0])];
      let i = 0;
      while (i < args.length) {
        expr.push(plus);
        addCodeArg(expr, args[i]);
        expr.push(plus, safeStringify(strs[++i]));
      }
      optimize(expr);
      return new _Code(expr);
    }
    exports2.str = str;
    function addCodeArg(code, arg) {
      if (arg instanceof _Code)
        code.push(...arg._items);
      else if (arg instanceof Name)
        code.push(arg);
      else
        code.push(interpolate(arg));
    }
    exports2.addCodeArg = addCodeArg;
    function optimize(expr) {
      let i = 1;
      while (i < expr.length - 1) {
        if (expr[i] === plus) {
          const res = mergeExprItems(expr[i - 1], expr[i + 1]);
          if (res !== void 0) {
            expr.splice(i - 1, 3, res);
            continue;
          }
          expr[i++] = "+";
        }
        i++;
      }
    }
    function mergeExprItems(a, b) {
      if (b === '""')
        return a;
      if (a === '""')
        return b;
      if (typeof a == "string") {
        if (b instanceof Name || a[a.length - 1] !== '"')
          return;
        if (typeof b != "string")
          return `${a.slice(0, -1)}${b}"`;
        if (b[0] === '"')
          return a.slice(0, -1) + b.slice(1);
        return;
      }
      if (typeof b == "string" && b[0] === '"' && !(a instanceof Name))
        return `"${a}${b.slice(1)}`;
      return;
    }
    function strConcat(c1, c2) {
      return c2.emptyStr() ? c1 : c1.emptyStr() ? c2 : str`${c1}${c2}`;
    }
    exports2.strConcat = strConcat;
    function interpolate(x) {
      return typeof x == "number" || typeof x == "boolean" || x === null ? x : safeStringify(Array.isArray(x) ? x.join(",") : x);
    }
    function stringify(x) {
      return new _Code(safeStringify(x));
    }
    exports2.stringify = stringify;
    function safeStringify(x) {
      return JSON.stringify(x).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
    }
    exports2.safeStringify = safeStringify;
    function getProperty(key) {
      return typeof key == "string" && exports2.IDENTIFIER.test(key) ? new _Code(`.${key}`) : _`[${key}]`;
    }
    exports2.getProperty = getProperty;
    function getEsmExportName(key) {
      if (typeof key == "string" && exports2.IDENTIFIER.test(key)) {
        return new _Code(`${key}`);
      }
      throw new Error(`CodeGen: invalid export name: ${key}, use explicit $id name mapping`);
    }
    exports2.getEsmExportName = getEsmExportName;
    function regexpCode(rx) {
      return new _Code(rx.toString());
    }
    exports2.regexpCode = regexpCode;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/codegen/scope.js
var require_scope = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/codegen/scope.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.ValueScope = exports2.ValueScopeName = exports2.Scope = exports2.varKinds = exports2.UsedValueState = void 0;
    var code_1 = require_code();
    var ValueError = class extends Error {
      constructor(name) {
        super(`CodeGen: "code" for ${name} not defined`);
        this.value = name.value;
      }
    };
    var UsedValueState;
    (function(UsedValueState2) {
      UsedValueState2[UsedValueState2["Started"] = 0] = "Started";
      UsedValueState2[UsedValueState2["Completed"] = 1] = "Completed";
    })(UsedValueState || (exports2.UsedValueState = UsedValueState = {}));
    exports2.varKinds = {
      const: new code_1.Name("const"),
      let: new code_1.Name("let"),
      var: new code_1.Name("var")
    };
    var Scope = class {
      constructor({ prefixes, parent } = {}) {
        this._names = {};
        this._prefixes = prefixes;
        this._parent = parent;
      }
      toName(nameOrPrefix) {
        return nameOrPrefix instanceof code_1.Name ? nameOrPrefix : this.name(nameOrPrefix);
      }
      name(prefix) {
        return new code_1.Name(this._newName(prefix));
      }
      _newName(prefix) {
        const ng = this._names[prefix] || this._nameGroup(prefix);
        return `${prefix}${ng.index++}`;
      }
      _nameGroup(prefix) {
        var _a, _b;
        if (((_b = (_a = this._parent) === null || _a === void 0 ? void 0 : _a._prefixes) === null || _b === void 0 ? void 0 : _b.has(prefix)) || this._prefixes && !this._prefixes.has(prefix)) {
          throw new Error(`CodeGen: prefix "${prefix}" is not allowed in this scope`);
        }
        return this._names[prefix] = { prefix, index: 0 };
      }
    };
    exports2.Scope = Scope;
    var ValueScopeName = class extends code_1.Name {
      constructor(prefix, nameStr) {
        super(nameStr);
        this.prefix = prefix;
      }
      setValue(value, { property, itemIndex }) {
        this.value = value;
        this.scopePath = (0, code_1._)`.${new code_1.Name(property)}[${itemIndex}]`;
      }
    };
    exports2.ValueScopeName = ValueScopeName;
    var line = (0, code_1._)`\n`;
    var ValueScope = class extends Scope {
      constructor(opts) {
        super(opts);
        this._values = {};
        this._scope = opts.scope;
        this.opts = { ...opts, _n: opts.lines ? line : code_1.nil };
      }
      get() {
        return this._scope;
      }
      name(prefix) {
        return new ValueScopeName(prefix, this._newName(prefix));
      }
      value(nameOrPrefix, value) {
        var _a;
        if (value.ref === void 0)
          throw new Error("CodeGen: ref must be passed in value");
        const name = this.toName(nameOrPrefix);
        const { prefix } = name;
        const valueKey = (_a = value.key) !== null && _a !== void 0 ? _a : value.ref;
        let vs = this._values[prefix];
        if (vs) {
          const _name = vs.get(valueKey);
          if (_name)
            return _name;
        } else {
          vs = this._values[prefix] = /* @__PURE__ */ new Map();
        }
        vs.set(valueKey, name);
        const s = this._scope[prefix] || (this._scope[prefix] = []);
        const itemIndex = s.length;
        s[itemIndex] = value.ref;
        name.setValue(value, { property: prefix, itemIndex });
        return name;
      }
      getValue(prefix, keyOrRef) {
        const vs = this._values[prefix];
        if (!vs)
          return;
        return vs.get(keyOrRef);
      }
      scopeRefs(scopeName, values = this._values) {
        return this._reduceValues(values, (name) => {
          if (name.scopePath === void 0)
            throw new Error(`CodeGen: name "${name}" has no value`);
          return (0, code_1._)`${scopeName}${name.scopePath}`;
        });
      }
      scopeCode(values = this._values, usedValues, getCode) {
        return this._reduceValues(values, (name) => {
          if (name.value === void 0)
            throw new Error(`CodeGen: name "${name}" has no value`);
          return name.value.code;
        }, usedValues, getCode);
      }
      _reduceValues(values, valueCode, usedValues = {}, getCode) {
        let code = code_1.nil;
        for (const prefix in values) {
          const vs = values[prefix];
          if (!vs)
            continue;
          const nameSet = usedValues[prefix] = usedValues[prefix] || /* @__PURE__ */ new Map();
          vs.forEach((name) => {
            if (nameSet.has(name))
              return;
            nameSet.set(name, UsedValueState.Started);
            let c = valueCode(name);
            if (c) {
              const def = this.opts.es5 ? exports2.varKinds.var : exports2.varKinds.const;
              code = (0, code_1._)`${code}${def} ${name} = ${c};${this.opts._n}`;
            } else if (c = getCode === null || getCode === void 0 ? void 0 : getCode(name)) {
              code = (0, code_1._)`${code}${c}${this.opts._n}`;
            } else {
              throw new ValueError(name);
            }
            nameSet.set(name, UsedValueState.Completed);
          });
        }
        return code;
      }
    };
    exports2.ValueScope = ValueScope;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/codegen/index.js
var require_codegen = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/codegen/index.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.or = exports2.and = exports2.not = exports2.CodeGen = exports2.operators = exports2.varKinds = exports2.ValueScopeName = exports2.ValueScope = exports2.Scope = exports2.Name = exports2.regexpCode = exports2.stringify = exports2.getProperty = exports2.nil = exports2.strConcat = exports2.str = exports2._ = void 0;
    var code_1 = require_code();
    var scope_1 = require_scope();
    var code_2 = require_code();
    Object.defineProperty(exports2, "_", { enumerable: true, get: function() {
      return code_2._;
    } });
    Object.defineProperty(exports2, "str", { enumerable: true, get: function() {
      return code_2.str;
    } });
    Object.defineProperty(exports2, "strConcat", { enumerable: true, get: function() {
      return code_2.strConcat;
    } });
    Object.defineProperty(exports2, "nil", { enumerable: true, get: function() {
      return code_2.nil;
    } });
    Object.defineProperty(exports2, "getProperty", { enumerable: true, get: function() {
      return code_2.getProperty;
    } });
    Object.defineProperty(exports2, "stringify", { enumerable: true, get: function() {
      return code_2.stringify;
    } });
    Object.defineProperty(exports2, "regexpCode", { enumerable: true, get: function() {
      return code_2.regexpCode;
    } });
    Object.defineProperty(exports2, "Name", { enumerable: true, get: function() {
      return code_2.Name;
    } });
    var scope_2 = require_scope();
    Object.defineProperty(exports2, "Scope", { enumerable: true, get: function() {
      return scope_2.Scope;
    } });
    Object.defineProperty(exports2, "ValueScope", { enumerable: true, get: function() {
      return scope_2.ValueScope;
    } });
    Object.defineProperty(exports2, "ValueScopeName", { enumerable: true, get: function() {
      return scope_2.ValueScopeName;
    } });
    Object.defineProperty(exports2, "varKinds", { enumerable: true, get: function() {
      return scope_2.varKinds;
    } });
    exports2.operators = {
      GT: new code_1._Code(">"),
      GTE: new code_1._Code(">="),
      LT: new code_1._Code("<"),
      LTE: new code_1._Code("<="),
      EQ: new code_1._Code("==="),
      NEQ: new code_1._Code("!=="),
      NOT: new code_1._Code("!"),
      OR: new code_1._Code("||"),
      AND: new code_1._Code("&&"),
      ADD: new code_1._Code("+")
    };
    var Node = class {
      optimizeNodes() {
        return this;
      }
      optimizeNames(_names, _constants) {
        return this;
      }
    };
    var Def = class extends Node {
      constructor(varKind, name, rhs) {
        super();
        this.varKind = varKind;
        this.name = name;
        this.rhs = rhs;
      }
      render({ es5, _n }) {
        const varKind = es5 ? scope_1.varKinds.var : this.varKind;
        const rhs = this.rhs === void 0 ? "" : ` = ${this.rhs}`;
        return `${varKind} ${this.name}${rhs};` + _n;
      }
      optimizeNames(names, constants2) {
        if (!names[this.name.str])
          return;
        if (this.rhs)
          this.rhs = optimizeExpr(this.rhs, names, constants2);
        return this;
      }
      get names() {
        return this.rhs instanceof code_1._CodeOrName ? this.rhs.names : {};
      }
    };
    var Assign = class extends Node {
      constructor(lhs, rhs, sideEffects) {
        super();
        this.lhs = lhs;
        this.rhs = rhs;
        this.sideEffects = sideEffects;
      }
      render({ _n }) {
        return `${this.lhs} = ${this.rhs};` + _n;
      }
      optimizeNames(names, constants2) {
        if (this.lhs instanceof code_1.Name && !names[this.lhs.str] && !this.sideEffects)
          return;
        this.rhs = optimizeExpr(this.rhs, names, constants2);
        return this;
      }
      get names() {
        const names = this.lhs instanceof code_1.Name ? {} : { ...this.lhs.names };
        return addExprNames(names, this.rhs);
      }
    };
    var AssignOp = class extends Assign {
      constructor(lhs, op, rhs, sideEffects) {
        super(lhs, rhs, sideEffects);
        this.op = op;
      }
      render({ _n }) {
        return `${this.lhs} ${this.op}= ${this.rhs};` + _n;
      }
    };
    var Label = class extends Node {
      constructor(label) {
        super();
        this.label = label;
        this.names = {};
      }
      render({ _n }) {
        return `${this.label}:` + _n;
      }
    };
    var Break = class extends Node {
      constructor(label) {
        super();
        this.label = label;
        this.names = {};
      }
      render({ _n }) {
        const label = this.label ? ` ${this.label}` : "";
        return `break${label};` + _n;
      }
    };
    var Throw = class extends Node {
      constructor(error) {
        super();
        this.error = error;
      }
      render({ _n }) {
        return `throw ${this.error};` + _n;
      }
      get names() {
        return this.error.names;
      }
    };
    var AnyCode = class extends Node {
      constructor(code) {
        super();
        this.code = code;
      }
      render({ _n }) {
        return `${this.code};` + _n;
      }
      optimizeNodes() {
        return `${this.code}` ? this : void 0;
      }
      optimizeNames(names, constants2) {
        this.code = optimizeExpr(this.code, names, constants2);
        return this;
      }
      get names() {
        return this.code instanceof code_1._CodeOrName ? this.code.names : {};
      }
    };
    var ParentNode = class extends Node {
      constructor(nodes = []) {
        super();
        this.nodes = nodes;
      }
      render(opts) {
        return this.nodes.reduce((code, n) => code + n.render(opts), "");
      }
      optimizeNodes() {
        const { nodes } = this;
        let i = nodes.length;
        while (i--) {
          const n = nodes[i].optimizeNodes();
          if (Array.isArray(n))
            nodes.splice(i, 1, ...n);
          else if (n)
            nodes[i] = n;
          else
            nodes.splice(i, 1);
        }
        return nodes.length > 0 ? this : void 0;
      }
      optimizeNames(names, constants2) {
        const { nodes } = this;
        let i = nodes.length;
        while (i--) {
          const n = nodes[i];
          if (n.optimizeNames(names, constants2))
            continue;
          subtractNames(names, n.names);
          nodes.splice(i, 1);
        }
        return nodes.length > 0 ? this : void 0;
      }
      get names() {
        return this.nodes.reduce((names, n) => addNames(names, n.names), {});
      }
    };
    var BlockNode = class extends ParentNode {
      render(opts) {
        return "{" + opts._n + super.render(opts) + "}" + opts._n;
      }
    };
    var Root = class extends ParentNode {
    };
    var Else = class extends BlockNode {
    };
    Else.kind = "else";
    var If = class _If extends BlockNode {
      constructor(condition, nodes) {
        super(nodes);
        this.condition = condition;
      }
      render(opts) {
        let code = `if(${this.condition})` + super.render(opts);
        if (this.else)
          code += "else " + this.else.render(opts);
        return code;
      }
      optimizeNodes() {
        super.optimizeNodes();
        const cond = this.condition;
        if (cond === true)
          return this.nodes;
        let e = this.else;
        if (e) {
          const ns = e.optimizeNodes();
          e = this.else = Array.isArray(ns) ? new Else(ns) : ns;
        }
        if (e) {
          if (cond === false)
            return e instanceof _If ? e : e.nodes;
          if (this.nodes.length)
            return this;
          return new _If(not(cond), e instanceof _If ? [e] : e.nodes);
        }
        if (cond === false || !this.nodes.length)
          return void 0;
        return this;
      }
      optimizeNames(names, constants2) {
        var _a;
        this.else = (_a = this.else) === null || _a === void 0 ? void 0 : _a.optimizeNames(names, constants2);
        if (!(super.optimizeNames(names, constants2) || this.else))
          return;
        this.condition = optimizeExpr(this.condition, names, constants2);
        return this;
      }
      get names() {
        const names = super.names;
        addExprNames(names, this.condition);
        if (this.else)
          addNames(names, this.else.names);
        return names;
      }
    };
    If.kind = "if";
    var For = class extends BlockNode {
    };
    For.kind = "for";
    var ForLoop = class extends For {
      constructor(iteration) {
        super();
        this.iteration = iteration;
      }
      render(opts) {
        return `for(${this.iteration})` + super.render(opts);
      }
      optimizeNames(names, constants2) {
        if (!super.optimizeNames(names, constants2))
          return;
        this.iteration = optimizeExpr(this.iteration, names, constants2);
        return this;
      }
      get names() {
        return addNames(super.names, this.iteration.names);
      }
    };
    var ForRange = class extends For {
      constructor(varKind, name, from, to) {
        super();
        this.varKind = varKind;
        this.name = name;
        this.from = from;
        this.to = to;
      }
      render(opts) {
        const varKind = opts.es5 ? scope_1.varKinds.var : this.varKind;
        const { name, from, to } = this;
        return `for(${varKind} ${name}=${from}; ${name}<${to}; ${name}++)` + super.render(opts);
      }
      get names() {
        const names = addExprNames(super.names, this.from);
        return addExprNames(names, this.to);
      }
    };
    var ForIter = class extends For {
      constructor(loop, varKind, name, iterable) {
        super();
        this.loop = loop;
        this.varKind = varKind;
        this.name = name;
        this.iterable = iterable;
      }
      render(opts) {
        return `for(${this.varKind} ${this.name} ${this.loop} ${this.iterable})` + super.render(opts);
      }
      optimizeNames(names, constants2) {
        if (!super.optimizeNames(names, constants2))
          return;
        this.iterable = optimizeExpr(this.iterable, names, constants2);
        return this;
      }
      get names() {
        return addNames(super.names, this.iterable.names);
      }
    };
    var Func = class extends BlockNode {
      constructor(name, args, async) {
        super();
        this.name = name;
        this.args = args;
        this.async = async;
      }
      render(opts) {
        const _async = this.async ? "async " : "";
        return `${_async}function ${this.name}(${this.args})` + super.render(opts);
      }
    };
    Func.kind = "func";
    var Return = class extends ParentNode {
      render(opts) {
        return "return " + super.render(opts);
      }
    };
    Return.kind = "return";
    var Try = class extends BlockNode {
      render(opts) {
        let code = "try" + super.render(opts);
        if (this.catch)
          code += this.catch.render(opts);
        if (this.finally)
          code += this.finally.render(opts);
        return code;
      }
      optimizeNodes() {
        var _a, _b;
        super.optimizeNodes();
        (_a = this.catch) === null || _a === void 0 ? void 0 : _a.optimizeNodes();
        (_b = this.finally) === null || _b === void 0 ? void 0 : _b.optimizeNodes();
        return this;
      }
      optimizeNames(names, constants2) {
        var _a, _b;
        super.optimizeNames(names, constants2);
        (_a = this.catch) === null || _a === void 0 ? void 0 : _a.optimizeNames(names, constants2);
        (_b = this.finally) === null || _b === void 0 ? void 0 : _b.optimizeNames(names, constants2);
        return this;
      }
      get names() {
        const names = super.names;
        if (this.catch)
          addNames(names, this.catch.names);
        if (this.finally)
          addNames(names, this.finally.names);
        return names;
      }
    };
    var Catch = class extends BlockNode {
      constructor(error) {
        super();
        this.error = error;
      }
      render(opts) {
        return `catch(${this.error})` + super.render(opts);
      }
    };
    Catch.kind = "catch";
    var Finally = class extends BlockNode {
      render(opts) {
        return "finally" + super.render(opts);
      }
    };
    Finally.kind = "finally";
    var CodeGen = class {
      constructor(extScope, opts = {}) {
        this._values = {};
        this._blockStarts = [];
        this._constants = {};
        this.opts = { ...opts, _n: opts.lines ? "\n" : "" };
        this._extScope = extScope;
        this._scope = new scope_1.Scope({ parent: extScope });
        this._nodes = [new Root()];
      }
      toString() {
        return this._root.render(this.opts);
      }
      // returns unique name in the internal scope
      name(prefix) {
        return this._scope.name(prefix);
      }
      // reserves unique name in the external scope
      scopeName(prefix) {
        return this._extScope.name(prefix);
      }
      // reserves unique name in the external scope and assigns value to it
      scopeValue(prefixOrName, value) {
        const name = this._extScope.value(prefixOrName, value);
        const vs = this._values[name.prefix] || (this._values[name.prefix] = /* @__PURE__ */ new Set());
        vs.add(name);
        return name;
      }
      getScopeValue(prefix, keyOrRef) {
        return this._extScope.getValue(prefix, keyOrRef);
      }
      // return code that assigns values in the external scope to the names that are used internally
      // (same names that were returned by gen.scopeName or gen.scopeValue)
      scopeRefs(scopeName) {
        return this._extScope.scopeRefs(scopeName, this._values);
      }
      scopeCode() {
        return this._extScope.scopeCode(this._values);
      }
      _def(varKind, nameOrPrefix, rhs, constant) {
        const name = this._scope.toName(nameOrPrefix);
        if (rhs !== void 0 && constant)
          this._constants[name.str] = rhs;
        this._leafNode(new Def(varKind, name, rhs));
        return name;
      }
      // `const` declaration (`var` in es5 mode)
      const(nameOrPrefix, rhs, _constant) {
        return this._def(scope_1.varKinds.const, nameOrPrefix, rhs, _constant);
      }
      // `let` declaration with optional assignment (`var` in es5 mode)
      let(nameOrPrefix, rhs, _constant) {
        return this._def(scope_1.varKinds.let, nameOrPrefix, rhs, _constant);
      }
      // `var` declaration with optional assignment
      var(nameOrPrefix, rhs, _constant) {
        return this._def(scope_1.varKinds.var, nameOrPrefix, rhs, _constant);
      }
      // assignment code
      assign(lhs, rhs, sideEffects) {
        return this._leafNode(new Assign(lhs, rhs, sideEffects));
      }
      // `+=` code
      add(lhs, rhs) {
        return this._leafNode(new AssignOp(lhs, exports2.operators.ADD, rhs));
      }
      // appends passed SafeExpr to code or executes Block
      code(c) {
        if (typeof c == "function")
          c();
        else if (c !== code_1.nil)
          this._leafNode(new AnyCode(c));
        return this;
      }
      // returns code for object literal for the passed argument list of key-value pairs
      object(...keyValues) {
        const code = ["{"];
        for (const [key, value] of keyValues) {
          if (code.length > 1)
            code.push(",");
          code.push(key);
          if (key !== value || this.opts.es5) {
            code.push(":");
            (0, code_1.addCodeArg)(code, value);
          }
        }
        code.push("}");
        return new code_1._Code(code);
      }
      // `if` clause (or statement if `thenBody` and, optionally, `elseBody` are passed)
      if(condition, thenBody, elseBody) {
        this._blockNode(new If(condition));
        if (thenBody && elseBody) {
          this.code(thenBody).else().code(elseBody).endIf();
        } else if (thenBody) {
          this.code(thenBody).endIf();
        } else if (elseBody) {
          throw new Error('CodeGen: "else" body without "then" body');
        }
        return this;
      }
      // `else if` clause - invalid without `if` or after `else` clauses
      elseIf(condition) {
        return this._elseNode(new If(condition));
      }
      // `else` clause - only valid after `if` or `else if` clauses
      else() {
        return this._elseNode(new Else());
      }
      // end `if` statement (needed if gen.if was used only with condition)
      endIf() {
        return this._endBlockNode(If, Else);
      }
      _for(node, forBody) {
        this._blockNode(node);
        if (forBody)
          this.code(forBody).endFor();
        return this;
      }
      // a generic `for` clause (or statement if `forBody` is passed)
      for(iteration, forBody) {
        return this._for(new ForLoop(iteration), forBody);
      }
      // `for` statement for a range of values
      forRange(nameOrPrefix, from, to, forBody, varKind = this.opts.es5 ? scope_1.varKinds.var : scope_1.varKinds.let) {
        const name = this._scope.toName(nameOrPrefix);
        return this._for(new ForRange(varKind, name, from, to), () => forBody(name));
      }
      // `for-of` statement (in es5 mode replace with a normal for loop)
      forOf(nameOrPrefix, iterable, forBody, varKind = scope_1.varKinds.const) {
        const name = this._scope.toName(nameOrPrefix);
        if (this.opts.es5) {
          const arr = iterable instanceof code_1.Name ? iterable : this.var("_arr", iterable);
          return this.forRange("_i", 0, (0, code_1._)`${arr}.length`, (i) => {
            this.var(name, (0, code_1._)`${arr}[${i}]`);
            forBody(name);
          });
        }
        return this._for(new ForIter("of", varKind, name, iterable), () => forBody(name));
      }
      // `for-in` statement.
      // With option `ownProperties` replaced with a `for-of` loop for object keys
      forIn(nameOrPrefix, obj, forBody, varKind = this.opts.es5 ? scope_1.varKinds.var : scope_1.varKinds.const) {
        if (this.opts.ownProperties) {
          return this.forOf(nameOrPrefix, (0, code_1._)`Object.keys(${obj})`, forBody);
        }
        const name = this._scope.toName(nameOrPrefix);
        return this._for(new ForIter("in", varKind, name, obj), () => forBody(name));
      }
      // end `for` loop
      endFor() {
        return this._endBlockNode(For);
      }
      // `label` statement
      label(label) {
        return this._leafNode(new Label(label));
      }
      // `break` statement
      break(label) {
        return this._leafNode(new Break(label));
      }
      // `return` statement
      return(value) {
        const node = new Return();
        this._blockNode(node);
        this.code(value);
        if (node.nodes.length !== 1)
          throw new Error('CodeGen: "return" should have one node');
        return this._endBlockNode(Return);
      }
      // `try` statement
      try(tryBody, catchCode, finallyCode) {
        if (!catchCode && !finallyCode)
          throw new Error('CodeGen: "try" without "catch" and "finally"');
        const node = new Try();
        this._blockNode(node);
        this.code(tryBody);
        if (catchCode) {
          const error = this.name("e");
          this._currNode = node.catch = new Catch(error);
          catchCode(error);
        }
        if (finallyCode) {
          this._currNode = node.finally = new Finally();
          this.code(finallyCode);
        }
        return this._endBlockNode(Catch, Finally);
      }
      // `throw` statement
      throw(error) {
        return this._leafNode(new Throw(error));
      }
      // start self-balancing block
      block(body, nodeCount) {
        this._blockStarts.push(this._nodes.length);
        if (body)
          this.code(body).endBlock(nodeCount);
        return this;
      }
      // end the current self-balancing block
      endBlock(nodeCount) {
        const len = this._blockStarts.pop();
        if (len === void 0)
          throw new Error("CodeGen: not in self-balancing block");
        const toClose = this._nodes.length - len;
        if (toClose < 0 || nodeCount !== void 0 && toClose !== nodeCount) {
          throw new Error(`CodeGen: wrong number of nodes: ${toClose} vs ${nodeCount} expected`);
        }
        this._nodes.length = len;
        return this;
      }
      // `function` heading (or definition if funcBody is passed)
      func(name, args = code_1.nil, async, funcBody) {
        this._blockNode(new Func(name, args, async));
        if (funcBody)
          this.code(funcBody).endFunc();
        return this;
      }
      // end function definition
      endFunc() {
        return this._endBlockNode(Func);
      }
      optimize(n = 1) {
        while (n-- > 0) {
          this._root.optimizeNodes();
          this._root.optimizeNames(this._root.names, this._constants);
        }
      }
      _leafNode(node) {
        this._currNode.nodes.push(node);
        return this;
      }
      _blockNode(node) {
        this._currNode.nodes.push(node);
        this._nodes.push(node);
      }
      _endBlockNode(N1, N2) {
        const n = this._currNode;
        if (n instanceof N1 || N2 && n instanceof N2) {
          this._nodes.pop();
          return this;
        }
        throw new Error(`CodeGen: not in block "${N2 ? `${N1.kind}/${N2.kind}` : N1.kind}"`);
      }
      _elseNode(node) {
        const n = this._currNode;
        if (!(n instanceof If)) {
          throw new Error('CodeGen: "else" without "if"');
        }
        this._currNode = n.else = node;
        return this;
      }
      get _root() {
        return this._nodes[0];
      }
      get _currNode() {
        const ns = this._nodes;
        return ns[ns.length - 1];
      }
      set _currNode(node) {
        const ns = this._nodes;
        ns[ns.length - 1] = node;
      }
    };
    exports2.CodeGen = CodeGen;
    function addNames(names, from) {
      for (const n in from)
        names[n] = (names[n] || 0) + (from[n] || 0);
      return names;
    }
    function addExprNames(names, from) {
      return from instanceof code_1._CodeOrName ? addNames(names, from.names) : names;
    }
    function optimizeExpr(expr, names, constants2) {
      if (expr instanceof code_1.Name)
        return replaceName(expr);
      if (!canOptimize(expr))
        return expr;
      return new code_1._Code(expr._items.reduce((items, c) => {
        if (c instanceof code_1.Name)
          c = replaceName(c);
        if (c instanceof code_1._Code)
          items.push(...c._items);
        else
          items.push(c);
        return items;
      }, []));
      function replaceName(n) {
        const c = constants2[n.str];
        if (c === void 0 || names[n.str] !== 1)
          return n;
        delete names[n.str];
        return c;
      }
      function canOptimize(e) {
        return e instanceof code_1._Code && e._items.some((c) => c instanceof code_1.Name && names[c.str] === 1 && constants2[c.str] !== void 0);
      }
    }
    function subtractNames(names, from) {
      for (const n in from)
        names[n] = (names[n] || 0) - (from[n] || 0);
    }
    function not(x) {
      return typeof x == "boolean" || typeof x == "number" || x === null ? !x : (0, code_1._)`!${par(x)}`;
    }
    exports2.not = not;
    var andCode = mappend(exports2.operators.AND);
    function and(...args) {
      return args.reduce(andCode);
    }
    exports2.and = and;
    var orCode = mappend(exports2.operators.OR);
    function or(...args) {
      return args.reduce(orCode);
    }
    exports2.or = or;
    function mappend(op) {
      return (x, y) => x === code_1.nil ? y : y === code_1.nil ? x : (0, code_1._)`${par(x)} ${op} ${par(y)}`;
    }
    function par(x) {
      return x instanceof code_1.Name ? x : (0, code_1._)`(${x})`;
    }
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/util.js
var require_util = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/util.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.checkStrictMode = exports2.getErrorPath = exports2.Type = exports2.useFunc = exports2.setEvaluated = exports2.evaluatedPropsToName = exports2.mergeEvaluated = exports2.eachItem = exports2.unescapeJsonPointer = exports2.escapeJsonPointer = exports2.escapeFragment = exports2.unescapeFragment = exports2.schemaRefOrVal = exports2.schemaHasRulesButRef = exports2.schemaHasRules = exports2.checkUnknownRules = exports2.alwaysValidSchema = exports2.toHash = void 0;
    var codegen_1 = require_codegen();
    var code_1 = require_code();
    function toHash(arr) {
      const hash = {};
      for (const item of arr)
        hash[item] = true;
      return hash;
    }
    exports2.toHash = toHash;
    function alwaysValidSchema(it, schema) {
      if (typeof schema == "boolean")
        return schema;
      if (Object.keys(schema).length === 0)
        return true;
      checkUnknownRules(it, schema);
      return !schemaHasRules(schema, it.self.RULES.all);
    }
    exports2.alwaysValidSchema = alwaysValidSchema;
    function checkUnknownRules(it, schema = it.schema) {
      const { opts, self } = it;
      if (!opts.strictSchema)
        return;
      if (typeof schema === "boolean")
        return;
      const rules = self.RULES.keywords;
      for (const key in schema) {
        if (!rules[key])
          checkStrictMode(it, `unknown keyword: "${key}"`);
      }
    }
    exports2.checkUnknownRules = checkUnknownRules;
    function schemaHasRules(schema, rules) {
      if (typeof schema == "boolean")
        return !schema;
      for (const key in schema)
        if (rules[key])
          return true;
      return false;
    }
    exports2.schemaHasRules = schemaHasRules;
    function schemaHasRulesButRef(schema, RULES) {
      if (typeof schema == "boolean")
        return !schema;
      for (const key in schema)
        if (key !== "$ref" && RULES.all[key])
          return true;
      return false;
    }
    exports2.schemaHasRulesButRef = schemaHasRulesButRef;
    function schemaRefOrVal({ topSchemaRef, schemaPath }, schema, keyword, $data) {
      if (!$data) {
        if (typeof schema == "number" || typeof schema == "boolean")
          return schema;
        if (typeof schema == "string")
          return (0, codegen_1._)`${schema}`;
      }
      return (0, codegen_1._)`${topSchemaRef}${schemaPath}${(0, codegen_1.getProperty)(keyword)}`;
    }
    exports2.schemaRefOrVal = schemaRefOrVal;
    function unescapeFragment(str) {
      return unescapeJsonPointer(decodeURIComponent(str));
    }
    exports2.unescapeFragment = unescapeFragment;
    function escapeFragment(str) {
      return encodeURIComponent(escapeJsonPointer(str));
    }
    exports2.escapeFragment = escapeFragment;
    function escapeJsonPointer(str) {
      if (typeof str == "number")
        return `${str}`;
      return str.replace(/~/g, "~0").replace(/\//g, "~1");
    }
    exports2.escapeJsonPointer = escapeJsonPointer;
    function unescapeJsonPointer(str) {
      return str.replace(/~1/g, "/").replace(/~0/g, "~");
    }
    exports2.unescapeJsonPointer = unescapeJsonPointer;
    function eachItem(xs, f) {
      if (Array.isArray(xs)) {
        for (const x of xs)
          f(x);
      } else {
        f(xs);
      }
    }
    exports2.eachItem = eachItem;
    function makeMergeEvaluated({ mergeNames, mergeToName, mergeValues, resultToName }) {
      return (gen, from, to, toName) => {
        const res = to === void 0 ? from : to instanceof codegen_1.Name ? (from instanceof codegen_1.Name ? mergeNames(gen, from, to) : mergeToName(gen, from, to), to) : from instanceof codegen_1.Name ? (mergeToName(gen, to, from), from) : mergeValues(from, to);
        return toName === codegen_1.Name && !(res instanceof codegen_1.Name) ? resultToName(gen, res) : res;
      };
    }
    exports2.mergeEvaluated = {
      props: makeMergeEvaluated({
        mergeNames: (gen, from, to) => gen.if((0, codegen_1._)`${to} !== true && ${from} !== undefined`, () => {
          gen.if((0, codegen_1._)`${from} === true`, () => gen.assign(to, true), () => gen.assign(to, (0, codegen_1._)`${to} || {}`).code((0, codegen_1._)`Object.assign(${to}, ${from})`));
        }),
        mergeToName: (gen, from, to) => gen.if((0, codegen_1._)`${to} !== true`, () => {
          if (from === true) {
            gen.assign(to, true);
          } else {
            gen.assign(to, (0, codegen_1._)`${to} || {}`);
            setEvaluated(gen, to, from);
          }
        }),
        mergeValues: (from, to) => from === true ? true : { ...from, ...to },
        resultToName: evaluatedPropsToName
      }),
      items: makeMergeEvaluated({
        mergeNames: (gen, from, to) => gen.if((0, codegen_1._)`${to} !== true && ${from} !== undefined`, () => gen.assign(to, (0, codegen_1._)`${from} === true ? true : ${to} > ${from} ? ${to} : ${from}`)),
        mergeToName: (gen, from, to) => gen.if((0, codegen_1._)`${to} !== true`, () => gen.assign(to, from === true ? true : (0, codegen_1._)`${to} > ${from} ? ${to} : ${from}`)),
        mergeValues: (from, to) => from === true ? true : Math.max(from, to),
        resultToName: (gen, items) => gen.var("items", items)
      })
    };
    function evaluatedPropsToName(gen, ps) {
      if (ps === true)
        return gen.var("props", true);
      const props = gen.var("props", (0, codegen_1._)`{}`);
      if (ps !== void 0)
        setEvaluated(gen, props, ps);
      return props;
    }
    exports2.evaluatedPropsToName = evaluatedPropsToName;
    function setEvaluated(gen, props, ps) {
      Object.keys(ps).forEach((p) => gen.assign((0, codegen_1._)`${props}${(0, codegen_1.getProperty)(p)}`, true));
    }
    exports2.setEvaluated = setEvaluated;
    var snippets = {};
    function useFunc(gen, f) {
      return gen.scopeValue("func", {
        ref: f,
        code: snippets[f.code] || (snippets[f.code] = new code_1._Code(f.code))
      });
    }
    exports2.useFunc = useFunc;
    var Type;
    (function(Type2) {
      Type2[Type2["Num"] = 0] = "Num";
      Type2[Type2["Str"] = 1] = "Str";
    })(Type || (exports2.Type = Type = {}));
    function getErrorPath(dataProp, dataPropType, jsPropertySyntax) {
      if (dataProp instanceof codegen_1.Name) {
        const isNumber = dataPropType === Type.Num;
        return jsPropertySyntax ? isNumber ? (0, codegen_1._)`"[" + ${dataProp} + "]"` : (0, codegen_1._)`"['" + ${dataProp} + "']"` : isNumber ? (0, codegen_1._)`"/" + ${dataProp}` : (0, codegen_1._)`"/" + ${dataProp}.replace(/~/g, "~0").replace(/\\//g, "~1")`;
      }
      return jsPropertySyntax ? (0, codegen_1.getProperty)(dataProp).toString() : "/" + escapeJsonPointer(dataProp);
    }
    exports2.getErrorPath = getErrorPath;
    function checkStrictMode(it, msg, mode = it.opts.strictSchema) {
      if (!mode)
        return;
      msg = `strict mode: ${msg}`;
      if (mode === true)
        throw new Error(msg);
      it.self.logger.warn(msg);
    }
    exports2.checkStrictMode = checkStrictMode;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/names.js
var require_names = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/names.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var names = {
      // validation function arguments
      data: new codegen_1.Name("data"),
      // data passed to validation function
      // args passed from referencing schema
      valCxt: new codegen_1.Name("valCxt"),
      // validation/data context - should not be used directly, it is destructured to the names below
      instancePath: new codegen_1.Name("instancePath"),
      parentData: new codegen_1.Name("parentData"),
      parentDataProperty: new codegen_1.Name("parentDataProperty"),
      rootData: new codegen_1.Name("rootData"),
      // root data - same as the data passed to the first/top validation function
      dynamicAnchors: new codegen_1.Name("dynamicAnchors"),
      // used to support recursiveRef and dynamicRef
      // function scoped variables
      vErrors: new codegen_1.Name("vErrors"),
      // null or array of validation errors
      errors: new codegen_1.Name("errors"),
      // counter of validation errors
      this: new codegen_1.Name("this"),
      // "globals"
      self: new codegen_1.Name("self"),
      scope: new codegen_1.Name("scope"),
      // JTD serialize/parse name for JSON string and position
      json: new codegen_1.Name("json"),
      jsonPos: new codegen_1.Name("jsonPos"),
      jsonLen: new codegen_1.Name("jsonLen"),
      jsonPart: new codegen_1.Name("jsonPart")
    };
    exports2.default = names;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/errors.js
var require_errors = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/errors.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.extendErrors = exports2.resetErrorsCount = exports2.reportExtraError = exports2.reportError = exports2.keyword$DataError = exports2.keywordError = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var names_1 = require_names();
    exports2.keywordError = {
      message: ({ keyword }) => (0, codegen_1.str)`must pass "${keyword}" keyword validation`
    };
    exports2.keyword$DataError = {
      message: ({ keyword, schemaType }) => schemaType ? (0, codegen_1.str)`"${keyword}" keyword must be ${schemaType} ($data)` : (0, codegen_1.str)`"${keyword}" keyword is invalid ($data)`
    };
    function reportError(cxt, error = exports2.keywordError, errorPaths, overrideAllErrors) {
      const { it } = cxt;
      const { gen, compositeRule, allErrors } = it;
      const errObj = errorObjectCode(cxt, error, errorPaths);
      if (overrideAllErrors !== null && overrideAllErrors !== void 0 ? overrideAllErrors : compositeRule || allErrors) {
        addError(gen, errObj);
      } else {
        returnErrors(it, (0, codegen_1._)`[${errObj}]`);
      }
    }
    exports2.reportError = reportError;
    function reportExtraError(cxt, error = exports2.keywordError, errorPaths) {
      const { it } = cxt;
      const { gen, compositeRule, allErrors } = it;
      const errObj = errorObjectCode(cxt, error, errorPaths);
      addError(gen, errObj);
      if (!(compositeRule || allErrors)) {
        returnErrors(it, names_1.default.vErrors);
      }
    }
    exports2.reportExtraError = reportExtraError;
    function resetErrorsCount(gen, errsCount) {
      gen.assign(names_1.default.errors, errsCount);
      gen.if((0, codegen_1._)`${names_1.default.vErrors} !== null`, () => gen.if(errsCount, () => gen.assign((0, codegen_1._)`${names_1.default.vErrors}.length`, errsCount), () => gen.assign(names_1.default.vErrors, null)));
    }
    exports2.resetErrorsCount = resetErrorsCount;
    function extendErrors({ gen, keyword, schemaValue, data, errsCount, it }) {
      if (errsCount === void 0)
        throw new Error("ajv implementation error");
      const err = gen.name("err");
      gen.forRange("i", errsCount, names_1.default.errors, (i) => {
        gen.const(err, (0, codegen_1._)`${names_1.default.vErrors}[${i}]`);
        gen.if((0, codegen_1._)`${err}.instancePath === undefined`, () => gen.assign((0, codegen_1._)`${err}.instancePath`, (0, codegen_1.strConcat)(names_1.default.instancePath, it.errorPath)));
        gen.assign((0, codegen_1._)`${err}.schemaPath`, (0, codegen_1.str)`${it.errSchemaPath}/${keyword}`);
        if (it.opts.verbose) {
          gen.assign((0, codegen_1._)`${err}.schema`, schemaValue);
          gen.assign((0, codegen_1._)`${err}.data`, data);
        }
      });
    }
    exports2.extendErrors = extendErrors;
    function addError(gen, errObj) {
      const err = gen.const("err", errObj);
      gen.if((0, codegen_1._)`${names_1.default.vErrors} === null`, () => gen.assign(names_1.default.vErrors, (0, codegen_1._)`[${err}]`), (0, codegen_1._)`${names_1.default.vErrors}.push(${err})`);
      gen.code((0, codegen_1._)`${names_1.default.errors}++`);
    }
    function returnErrors(it, errs) {
      const { gen, validateName, schemaEnv } = it;
      if (schemaEnv.$async) {
        gen.throw((0, codegen_1._)`new ${it.ValidationError}(${errs})`);
      } else {
        gen.assign((0, codegen_1._)`${validateName}.errors`, errs);
        gen.return(false);
      }
    }
    var E = {
      keyword: new codegen_1.Name("keyword"),
      schemaPath: new codegen_1.Name("schemaPath"),
      // also used in JTD errors
      params: new codegen_1.Name("params"),
      propertyName: new codegen_1.Name("propertyName"),
      message: new codegen_1.Name("message"),
      schema: new codegen_1.Name("schema"),
      parentSchema: new codegen_1.Name("parentSchema")
    };
    function errorObjectCode(cxt, error, errorPaths) {
      const { createErrors } = cxt.it;
      if (createErrors === false)
        return (0, codegen_1._)`{}`;
      return errorObject(cxt, error, errorPaths);
    }
    function errorObject(cxt, error, errorPaths = {}) {
      const { gen, it } = cxt;
      const keyValues = [
        errorInstancePath(it, errorPaths),
        errorSchemaPath(cxt, errorPaths)
      ];
      extraErrorProps(cxt, error, keyValues);
      return gen.object(...keyValues);
    }
    function errorInstancePath({ errorPath }, { instancePath }) {
      const instPath = instancePath ? (0, codegen_1.str)`${errorPath}${(0, util_1.getErrorPath)(instancePath, util_1.Type.Str)}` : errorPath;
      return [names_1.default.instancePath, (0, codegen_1.strConcat)(names_1.default.instancePath, instPath)];
    }
    function errorSchemaPath({ keyword, it: { errSchemaPath } }, { schemaPath, parentSchema }) {
      let schPath = parentSchema ? errSchemaPath : (0, codegen_1.str)`${errSchemaPath}/${keyword}`;
      if (schemaPath) {
        schPath = (0, codegen_1.str)`${schPath}${(0, util_1.getErrorPath)(schemaPath, util_1.Type.Str)}`;
      }
      return [E.schemaPath, schPath];
    }
    function extraErrorProps(cxt, { params, message }, keyValues) {
      const { keyword, data, schemaValue, it } = cxt;
      const { opts, propertyName, topSchemaRef, schemaPath } = it;
      keyValues.push([E.keyword, keyword], [E.params, typeof params == "function" ? params(cxt) : params || (0, codegen_1._)`{}`]);
      if (opts.messages) {
        keyValues.push([E.message, typeof message == "function" ? message(cxt) : message]);
      }
      if (opts.verbose) {
        keyValues.push([E.schema, schemaValue], [E.parentSchema, (0, codegen_1._)`${topSchemaRef}${schemaPath}`], [names_1.default.data, data]);
      }
      if (propertyName)
        keyValues.push([E.propertyName, propertyName]);
    }
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/validate/boolSchema.js
var require_boolSchema = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/validate/boolSchema.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.boolOrEmptySchema = exports2.topBoolOrEmptySchema = void 0;
    var errors_1 = require_errors();
    var codegen_1 = require_codegen();
    var names_1 = require_names();
    var boolError = {
      message: "boolean schema is false"
    };
    function topBoolOrEmptySchema(it) {
      const { gen, schema, validateName } = it;
      if (schema === false) {
        falseSchemaError(it, false);
      } else if (typeof schema == "object" && schema.$async === true) {
        gen.return(names_1.default.data);
      } else {
        gen.assign((0, codegen_1._)`${validateName}.errors`, null);
        gen.return(true);
      }
    }
    exports2.topBoolOrEmptySchema = topBoolOrEmptySchema;
    function boolOrEmptySchema(it, valid) {
      const { gen, schema } = it;
      if (schema === false) {
        gen.var(valid, false);
        falseSchemaError(it);
      } else {
        gen.var(valid, true);
      }
    }
    exports2.boolOrEmptySchema = boolOrEmptySchema;
    function falseSchemaError(it, overrideAllErrors) {
      const { gen, data } = it;
      const cxt = {
        gen,
        keyword: "false schema",
        data,
        schema: false,
        schemaCode: false,
        schemaValue: false,
        params: {},
        it
      };
      (0, errors_1.reportError)(cxt, boolError, void 0, overrideAllErrors);
    }
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/rules.js
var require_rules = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/rules.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.getRules = exports2.isJSONType = void 0;
    var _jsonTypes = ["string", "number", "integer", "boolean", "null", "object", "array"];
    var jsonTypes = new Set(_jsonTypes);
    function isJSONType(x) {
      return typeof x == "string" && jsonTypes.has(x);
    }
    exports2.isJSONType = isJSONType;
    function getRules() {
      const groups = {
        number: { type: "number", rules: [] },
        string: { type: "string", rules: [] },
        array: { type: "array", rules: [] },
        object: { type: "object", rules: [] }
      };
      return {
        types: { ...groups, integer: true, boolean: true, null: true },
        rules: [{ rules: [] }, groups.number, groups.string, groups.array, groups.object],
        post: { rules: [] },
        all: {},
        keywords: {}
      };
    }
    exports2.getRules = getRules;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/validate/applicability.js
var require_applicability = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/validate/applicability.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.shouldUseRule = exports2.shouldUseGroup = exports2.schemaHasRulesForType = void 0;
    function schemaHasRulesForType({ schema, self }, type) {
      const group = self.RULES.types[type];
      return group && group !== true && shouldUseGroup(schema, group);
    }
    exports2.schemaHasRulesForType = schemaHasRulesForType;
    function shouldUseGroup(schema, group) {
      return group.rules.some((rule) => shouldUseRule(schema, rule));
    }
    exports2.shouldUseGroup = shouldUseGroup;
    function shouldUseRule(schema, rule) {
      var _a;
      return schema[rule.keyword] !== void 0 || ((_a = rule.definition.implements) === null || _a === void 0 ? void 0 : _a.some((kwd) => schema[kwd] !== void 0));
    }
    exports2.shouldUseRule = shouldUseRule;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/validate/dataType.js
var require_dataType = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/validate/dataType.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.reportTypeError = exports2.checkDataTypes = exports2.checkDataType = exports2.coerceAndCheckDataType = exports2.getJSONTypes = exports2.getSchemaTypes = exports2.DataType = void 0;
    var rules_1 = require_rules();
    var applicability_1 = require_applicability();
    var errors_1 = require_errors();
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var DataType;
    (function(DataType2) {
      DataType2[DataType2["Correct"] = 0] = "Correct";
      DataType2[DataType2["Wrong"] = 1] = "Wrong";
    })(DataType || (exports2.DataType = DataType = {}));
    function getSchemaTypes(schema) {
      const types = getJSONTypes(schema.type);
      const hasNull = types.includes("null");
      if (hasNull) {
        if (schema.nullable === false)
          throw new Error("type: null contradicts nullable: false");
      } else {
        if (!types.length && schema.nullable !== void 0) {
          throw new Error('"nullable" cannot be used without "type"');
        }
        if (schema.nullable === true)
          types.push("null");
      }
      return types;
    }
    exports2.getSchemaTypes = getSchemaTypes;
    function getJSONTypes(ts) {
      const types = Array.isArray(ts) ? ts : ts ? [ts] : [];
      if (types.every(rules_1.isJSONType))
        return types;
      throw new Error("type must be JSONType or JSONType[]: " + types.join(","));
    }
    exports2.getJSONTypes = getJSONTypes;
    function coerceAndCheckDataType(it, types) {
      const { gen, data, opts } = it;
      const coerceTo = coerceToTypes(types, opts.coerceTypes);
      const checkTypes = types.length > 0 && !(coerceTo.length === 0 && types.length === 1 && (0, applicability_1.schemaHasRulesForType)(it, types[0]));
      if (checkTypes) {
        const wrongType = checkDataTypes(types, data, opts.strictNumbers, DataType.Wrong);
        gen.if(wrongType, () => {
          if (coerceTo.length)
            coerceData(it, types, coerceTo);
          else
            reportTypeError(it);
        });
      }
      return checkTypes;
    }
    exports2.coerceAndCheckDataType = coerceAndCheckDataType;
    var COERCIBLE = /* @__PURE__ */ new Set(["string", "number", "integer", "boolean", "null"]);
    function coerceToTypes(types, coerceTypes) {
      return coerceTypes ? types.filter((t) => COERCIBLE.has(t) || coerceTypes === "array" && t === "array") : [];
    }
    function coerceData(it, types, coerceTo) {
      const { gen, data, opts } = it;
      const dataType = gen.let("dataType", (0, codegen_1._)`typeof ${data}`);
      const coerced = gen.let("coerced", (0, codegen_1._)`undefined`);
      if (opts.coerceTypes === "array") {
        gen.if((0, codegen_1._)`${dataType} == 'object' && Array.isArray(${data}) && ${data}.length == 1`, () => gen.assign(data, (0, codegen_1._)`${data}[0]`).assign(dataType, (0, codegen_1._)`typeof ${data}`).if(checkDataTypes(types, data, opts.strictNumbers), () => gen.assign(coerced, data)));
      }
      gen.if((0, codegen_1._)`${coerced} !== undefined`);
      for (const t of coerceTo) {
        if (COERCIBLE.has(t) || t === "array" && opts.coerceTypes === "array") {
          coerceSpecificType(t);
        }
      }
      gen.else();
      reportTypeError(it);
      gen.endIf();
      gen.if((0, codegen_1._)`${coerced} !== undefined`, () => {
        gen.assign(data, coerced);
        assignParentData(it, coerced);
      });
      function coerceSpecificType(t) {
        switch (t) {
          case "string":
            gen.elseIf((0, codegen_1._)`${dataType} == "number" || ${dataType} == "boolean"`).assign(coerced, (0, codegen_1._)`"" + ${data}`).elseIf((0, codegen_1._)`${data} === null`).assign(coerced, (0, codegen_1._)`""`);
            return;
          case "number":
            gen.elseIf((0, codegen_1._)`${dataType} == "boolean" || ${data} === null
              || (${dataType} == "string" && ${data} && ${data} == +${data})`).assign(coerced, (0, codegen_1._)`+${data}`);
            return;
          case "integer":
            gen.elseIf((0, codegen_1._)`${dataType} === "boolean" || ${data} === null
              || (${dataType} === "string" && ${data} && ${data} == +${data} && !(${data} % 1))`).assign(coerced, (0, codegen_1._)`+${data}`);
            return;
          case "boolean":
            gen.elseIf((0, codegen_1._)`${data} === "false" || ${data} === 0 || ${data} === null`).assign(coerced, false).elseIf((0, codegen_1._)`${data} === "true" || ${data} === 1`).assign(coerced, true);
            return;
          case "null":
            gen.elseIf((0, codegen_1._)`${data} === "" || ${data} === 0 || ${data} === false`);
            gen.assign(coerced, null);
            return;
          case "array":
            gen.elseIf((0, codegen_1._)`${dataType} === "string" || ${dataType} === "number"
              || ${dataType} === "boolean" || ${data} === null`).assign(coerced, (0, codegen_1._)`[${data}]`);
        }
      }
    }
    function assignParentData({ gen, parentData, parentDataProperty }, expr) {
      gen.if((0, codegen_1._)`${parentData} !== undefined`, () => gen.assign((0, codegen_1._)`${parentData}[${parentDataProperty}]`, expr));
    }
    function checkDataType(dataType, data, strictNums, correct = DataType.Correct) {
      const EQ = correct === DataType.Correct ? codegen_1.operators.EQ : codegen_1.operators.NEQ;
      let cond;
      switch (dataType) {
        case "null":
          return (0, codegen_1._)`${data} ${EQ} null`;
        case "array":
          cond = (0, codegen_1._)`Array.isArray(${data})`;
          break;
        case "object":
          cond = (0, codegen_1._)`${data} && typeof ${data} == "object" && !Array.isArray(${data})`;
          break;
        case "integer":
          cond = numCond((0, codegen_1._)`!(${data} % 1) && !isNaN(${data})`);
          break;
        case "number":
          cond = numCond();
          break;
        default:
          return (0, codegen_1._)`typeof ${data} ${EQ} ${dataType}`;
      }
      return correct === DataType.Correct ? cond : (0, codegen_1.not)(cond);
      function numCond(_cond = codegen_1.nil) {
        return (0, codegen_1.and)((0, codegen_1._)`typeof ${data} == "number"`, _cond, strictNums ? (0, codegen_1._)`isFinite(${data})` : codegen_1.nil);
      }
    }
    exports2.checkDataType = checkDataType;
    function checkDataTypes(dataTypes, data, strictNums, correct) {
      if (dataTypes.length === 1) {
        return checkDataType(dataTypes[0], data, strictNums, correct);
      }
      let cond;
      const types = (0, util_1.toHash)(dataTypes);
      if (types.array && types.object) {
        const notObj = (0, codegen_1._)`typeof ${data} != "object"`;
        cond = types.null ? notObj : (0, codegen_1._)`!${data} || ${notObj}`;
        delete types.null;
        delete types.array;
        delete types.object;
      } else {
        cond = codegen_1.nil;
      }
      if (types.number)
        delete types.integer;
      for (const t in types)
        cond = (0, codegen_1.and)(cond, checkDataType(t, data, strictNums, correct));
      return cond;
    }
    exports2.checkDataTypes = checkDataTypes;
    var typeError = {
      message: ({ schema }) => `must be ${schema}`,
      params: ({ schema, schemaValue }) => typeof schema == "string" ? (0, codegen_1._)`{type: ${schema}}` : (0, codegen_1._)`{type: ${schemaValue}}`
    };
    function reportTypeError(it) {
      const cxt = getTypeErrorContext(it);
      (0, errors_1.reportError)(cxt, typeError);
    }
    exports2.reportTypeError = reportTypeError;
    function getTypeErrorContext(it) {
      const { gen, data, schema } = it;
      const schemaCode = (0, util_1.schemaRefOrVal)(it, schema, "type");
      return {
        gen,
        keyword: "type",
        data,
        schema: schema.type,
        schemaCode,
        schemaValue: schemaCode,
        parentSchema: schema,
        params: {},
        it
      };
    }
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/validate/defaults.js
var require_defaults = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/validate/defaults.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.assignDefaults = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    function assignDefaults(it, ty) {
      const { properties, items } = it.schema;
      if (ty === "object" && properties) {
        for (const key in properties) {
          assignDefault(it, key, properties[key].default);
        }
      } else if (ty === "array" && Array.isArray(items)) {
        items.forEach((sch, i) => assignDefault(it, i, sch.default));
      }
    }
    exports2.assignDefaults = assignDefaults;
    function assignDefault(it, prop, defaultValue) {
      const { gen, compositeRule, data, opts } = it;
      if (defaultValue === void 0)
        return;
      const childData = (0, codegen_1._)`${data}${(0, codegen_1.getProperty)(prop)}`;
      if (compositeRule) {
        (0, util_1.checkStrictMode)(it, `default is ignored for: ${childData}`);
        return;
      }
      let condition = (0, codegen_1._)`${childData} === undefined`;
      if (opts.useDefaults === "empty") {
        condition = (0, codegen_1._)`${condition} || ${childData} === null || ${childData} === ""`;
      }
      gen.if(condition, (0, codegen_1._)`${childData} = ${(0, codegen_1.stringify)(defaultValue)}`);
    }
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/code.js
var require_code2 = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/code.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.validateUnion = exports2.validateArray = exports2.usePattern = exports2.callValidateCode = exports2.schemaProperties = exports2.allSchemaProperties = exports2.noPropertyInData = exports2.propertyInData = exports2.isOwnProperty = exports2.hasPropFunc = exports2.reportMissingProp = exports2.checkMissingProp = exports2.checkReportMissingProp = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var names_1 = require_names();
    var util_2 = require_util();
    function checkReportMissingProp(cxt, prop) {
      const { gen, data, it } = cxt;
      gen.if(noPropertyInData(gen, data, prop, it.opts.ownProperties), () => {
        cxt.setParams({ missingProperty: (0, codegen_1._)`${prop}` }, true);
        cxt.error();
      });
    }
    exports2.checkReportMissingProp = checkReportMissingProp;
    function checkMissingProp({ gen, data, it: { opts } }, properties, missing) {
      return (0, codegen_1.or)(...properties.map((prop) => (0, codegen_1.and)(noPropertyInData(gen, data, prop, opts.ownProperties), (0, codegen_1._)`${missing} = ${prop}`)));
    }
    exports2.checkMissingProp = checkMissingProp;
    function reportMissingProp(cxt, missing) {
      cxt.setParams({ missingProperty: missing }, true);
      cxt.error();
    }
    exports2.reportMissingProp = reportMissingProp;
    function hasPropFunc(gen) {
      return gen.scopeValue("func", {
        // eslint-disable-next-line @typescript-eslint/unbound-method
        ref: Object.prototype.hasOwnProperty,
        code: (0, codegen_1._)`Object.prototype.hasOwnProperty`
      });
    }
    exports2.hasPropFunc = hasPropFunc;
    function isOwnProperty(gen, data, property) {
      return (0, codegen_1._)`${hasPropFunc(gen)}.call(${data}, ${property})`;
    }
    exports2.isOwnProperty = isOwnProperty;
    function propertyInData(gen, data, property, ownProperties) {
      const cond = (0, codegen_1._)`${data}${(0, codegen_1.getProperty)(property)} !== undefined`;
      return ownProperties ? (0, codegen_1._)`${cond} && ${isOwnProperty(gen, data, property)}` : cond;
    }
    exports2.propertyInData = propertyInData;
    function noPropertyInData(gen, data, property, ownProperties) {
      const cond = (0, codegen_1._)`${data}${(0, codegen_1.getProperty)(property)} === undefined`;
      return ownProperties ? (0, codegen_1.or)(cond, (0, codegen_1.not)(isOwnProperty(gen, data, property))) : cond;
    }
    exports2.noPropertyInData = noPropertyInData;
    function allSchemaProperties(schemaMap) {
      return schemaMap ? Object.keys(schemaMap).filter((p) => p !== "__proto__") : [];
    }
    exports2.allSchemaProperties = allSchemaProperties;
    function schemaProperties(it, schemaMap) {
      return allSchemaProperties(schemaMap).filter((p) => !(0, util_1.alwaysValidSchema)(it, schemaMap[p]));
    }
    exports2.schemaProperties = schemaProperties;
    function callValidateCode({ schemaCode, data, it: { gen, topSchemaRef, schemaPath, errorPath }, it }, func, context, passSchema) {
      const dataAndSchema = passSchema ? (0, codegen_1._)`${schemaCode}, ${data}, ${topSchemaRef}${schemaPath}` : data;
      const valCxt = [
        [names_1.default.instancePath, (0, codegen_1.strConcat)(names_1.default.instancePath, errorPath)],
        [names_1.default.parentData, it.parentData],
        [names_1.default.parentDataProperty, it.parentDataProperty],
        [names_1.default.rootData, names_1.default.rootData]
      ];
      if (it.opts.dynamicRef)
        valCxt.push([names_1.default.dynamicAnchors, names_1.default.dynamicAnchors]);
      const args = (0, codegen_1._)`${dataAndSchema}, ${gen.object(...valCxt)}`;
      return context !== codegen_1.nil ? (0, codegen_1._)`${func}.call(${context}, ${args})` : (0, codegen_1._)`${func}(${args})`;
    }
    exports2.callValidateCode = callValidateCode;
    var newRegExp = (0, codegen_1._)`new RegExp`;
    function usePattern({ gen, it: { opts } }, pattern) {
      const u = opts.unicodeRegExp ? "u" : "";
      const { regExp } = opts.code;
      const rx = regExp(pattern, u);
      return gen.scopeValue("pattern", {
        key: rx.toString(),
        ref: rx,
        code: (0, codegen_1._)`${regExp.code === "new RegExp" ? newRegExp : (0, util_2.useFunc)(gen, regExp)}(${pattern}, ${u})`
      });
    }
    exports2.usePattern = usePattern;
    function validateArray(cxt) {
      const { gen, data, keyword, it } = cxt;
      const valid = gen.name("valid");
      if (it.allErrors) {
        const validArr = gen.let("valid", true);
        validateItems(() => gen.assign(validArr, false));
        return validArr;
      }
      gen.var(valid, true);
      validateItems(() => gen.break());
      return valid;
      function validateItems(notValid) {
        const len = gen.const("len", (0, codegen_1._)`${data}.length`);
        gen.forRange("i", 0, len, (i) => {
          cxt.subschema({
            keyword,
            dataProp: i,
            dataPropType: util_1.Type.Num
          }, valid);
          gen.if((0, codegen_1.not)(valid), notValid);
        });
      }
    }
    exports2.validateArray = validateArray;
    function validateUnion(cxt) {
      const { gen, schema, keyword, it } = cxt;
      if (!Array.isArray(schema))
        throw new Error("ajv implementation error");
      const alwaysValid = schema.some((sch) => (0, util_1.alwaysValidSchema)(it, sch));
      if (alwaysValid && !it.opts.unevaluated)
        return;
      const valid = gen.let("valid", false);
      const schValid = gen.name("_valid");
      gen.block(() => schema.forEach((_sch, i) => {
        const schCxt = cxt.subschema({
          keyword,
          schemaProp: i,
          compositeRule: true
        }, schValid);
        gen.assign(valid, (0, codegen_1._)`${valid} || ${schValid}`);
        const merged = cxt.mergeValidEvaluated(schCxt, schValid);
        if (!merged)
          gen.if((0, codegen_1.not)(valid));
      }));
      cxt.result(valid, () => cxt.reset(), () => cxt.error(true));
    }
    exports2.validateUnion = validateUnion;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/validate/keyword.js
var require_keyword = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/validate/keyword.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.validateKeywordUsage = exports2.validSchemaType = exports2.funcKeywordCode = exports2.macroKeywordCode = void 0;
    var codegen_1 = require_codegen();
    var names_1 = require_names();
    var code_1 = require_code2();
    var errors_1 = require_errors();
    function macroKeywordCode(cxt, def) {
      const { gen, keyword, schema, parentSchema, it } = cxt;
      const macroSchema = def.macro.call(it.self, schema, parentSchema, it);
      const schemaRef = useKeyword(gen, keyword, macroSchema);
      if (it.opts.validateSchema !== false)
        it.self.validateSchema(macroSchema, true);
      const valid = gen.name("valid");
      cxt.subschema({
        schema: macroSchema,
        schemaPath: codegen_1.nil,
        errSchemaPath: `${it.errSchemaPath}/${keyword}`,
        topSchemaRef: schemaRef,
        compositeRule: true
      }, valid);
      cxt.pass(valid, () => cxt.error(true));
    }
    exports2.macroKeywordCode = macroKeywordCode;
    function funcKeywordCode(cxt, def) {
      var _a;
      const { gen, keyword, schema, parentSchema, $data, it } = cxt;
      checkAsyncKeyword(it, def);
      const validate = !$data && def.compile ? def.compile.call(it.self, schema, parentSchema, it) : def.validate;
      const validateRef = useKeyword(gen, keyword, validate);
      const valid = gen.let("valid");
      cxt.block$data(valid, validateKeyword);
      cxt.ok((_a = def.valid) !== null && _a !== void 0 ? _a : valid);
      function validateKeyword() {
        if (def.errors === false) {
          assignValid();
          if (def.modifying)
            modifyData(cxt);
          reportErrs(() => cxt.error());
        } else {
          const ruleErrs = def.async ? validateAsync() : validateSync();
          if (def.modifying)
            modifyData(cxt);
          reportErrs(() => addErrs(cxt, ruleErrs));
        }
      }
      function validateAsync() {
        const ruleErrs = gen.let("ruleErrs", null);
        gen.try(() => assignValid((0, codegen_1._)`await `), (e) => gen.assign(valid, false).if((0, codegen_1._)`${e} instanceof ${it.ValidationError}`, () => gen.assign(ruleErrs, (0, codegen_1._)`${e}.errors`), () => gen.throw(e)));
        return ruleErrs;
      }
      function validateSync() {
        const validateErrs = (0, codegen_1._)`${validateRef}.errors`;
        gen.assign(validateErrs, null);
        assignValid(codegen_1.nil);
        return validateErrs;
      }
      function assignValid(_await = def.async ? (0, codegen_1._)`await ` : codegen_1.nil) {
        const passCxt = it.opts.passContext ? names_1.default.this : names_1.default.self;
        const passSchema = !("compile" in def && !$data || def.schema === false);
        gen.assign(valid, (0, codegen_1._)`${_await}${(0, code_1.callValidateCode)(cxt, validateRef, passCxt, passSchema)}`, def.modifying);
      }
      function reportErrs(errors) {
        var _a2;
        gen.if((0, codegen_1.not)((_a2 = def.valid) !== null && _a2 !== void 0 ? _a2 : valid), errors);
      }
    }
    exports2.funcKeywordCode = funcKeywordCode;
    function modifyData(cxt) {
      const { gen, data, it } = cxt;
      gen.if(it.parentData, () => gen.assign(data, (0, codegen_1._)`${it.parentData}[${it.parentDataProperty}]`));
    }
    function addErrs(cxt, errs) {
      const { gen } = cxt;
      gen.if((0, codegen_1._)`Array.isArray(${errs})`, () => {
        gen.assign(names_1.default.vErrors, (0, codegen_1._)`${names_1.default.vErrors} === null ? ${errs} : ${names_1.default.vErrors}.concat(${errs})`).assign(names_1.default.errors, (0, codegen_1._)`${names_1.default.vErrors}.length`);
        (0, errors_1.extendErrors)(cxt);
      }, () => cxt.error());
    }
    function checkAsyncKeyword({ schemaEnv }, def) {
      if (def.async && !schemaEnv.$async)
        throw new Error("async keyword in sync schema");
    }
    function useKeyword(gen, keyword, result) {
      if (result === void 0)
        throw new Error(`keyword "${keyword}" failed to compile`);
      return gen.scopeValue("keyword", typeof result == "function" ? { ref: result } : { ref: result, code: (0, codegen_1.stringify)(result) });
    }
    function validSchemaType(schema, schemaType, allowUndefined = false) {
      return !schemaType.length || schemaType.some((st) => st === "array" ? Array.isArray(schema) : st === "object" ? schema && typeof schema == "object" && !Array.isArray(schema) : typeof schema == st || allowUndefined && typeof schema == "undefined");
    }
    exports2.validSchemaType = validSchemaType;
    function validateKeywordUsage({ schema, opts, self, errSchemaPath }, def, keyword) {
      if (Array.isArray(def.keyword) ? !def.keyword.includes(keyword) : def.keyword !== keyword) {
        throw new Error("ajv implementation error");
      }
      const deps = def.dependencies;
      if (deps === null || deps === void 0 ? void 0 : deps.some((kwd) => !Object.prototype.hasOwnProperty.call(schema, kwd))) {
        throw new Error(`parent schema must have dependencies of ${keyword}: ${deps.join(",")}`);
      }
      if (def.validateSchema) {
        const valid = def.validateSchema(schema[keyword]);
        if (!valid) {
          const msg = `keyword "${keyword}" value is invalid at path "${errSchemaPath}": ` + self.errorsText(def.validateSchema.errors);
          if (opts.validateSchema === "log")
            self.logger.error(msg);
          else
            throw new Error(msg);
        }
      }
    }
    exports2.validateKeywordUsage = validateKeywordUsage;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/validate/subschema.js
var require_subschema = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/validate/subschema.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.extendSubschemaMode = exports2.extendSubschemaData = exports2.getSubschema = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    function getSubschema(it, { keyword, schemaProp, schema, schemaPath, errSchemaPath, topSchemaRef }) {
      if (keyword !== void 0 && schema !== void 0) {
        throw new Error('both "keyword" and "schema" passed, only one allowed');
      }
      if (keyword !== void 0) {
        const sch = it.schema[keyword];
        return schemaProp === void 0 ? {
          schema: sch,
          schemaPath: (0, codegen_1._)`${it.schemaPath}${(0, codegen_1.getProperty)(keyword)}`,
          errSchemaPath: `${it.errSchemaPath}/${keyword}`
        } : {
          schema: sch[schemaProp],
          schemaPath: (0, codegen_1._)`${it.schemaPath}${(0, codegen_1.getProperty)(keyword)}${(0, codegen_1.getProperty)(schemaProp)}`,
          errSchemaPath: `${it.errSchemaPath}/${keyword}/${(0, util_1.escapeFragment)(schemaProp)}`
        };
      }
      if (schema !== void 0) {
        if (schemaPath === void 0 || errSchemaPath === void 0 || topSchemaRef === void 0) {
          throw new Error('"schemaPath", "errSchemaPath" and "topSchemaRef" are required with "schema"');
        }
        return {
          schema,
          schemaPath,
          topSchemaRef,
          errSchemaPath
        };
      }
      throw new Error('either "keyword" or "schema" must be passed');
    }
    exports2.getSubschema = getSubschema;
    function extendSubschemaData(subschema, it, { dataProp, dataPropType: dpType, data, dataTypes, propertyName }) {
      if (data !== void 0 && dataProp !== void 0) {
        throw new Error('both "data" and "dataProp" passed, only one allowed');
      }
      const { gen } = it;
      if (dataProp !== void 0) {
        const { errorPath, dataPathArr, opts } = it;
        const nextData = gen.let("data", (0, codegen_1._)`${it.data}${(0, codegen_1.getProperty)(dataProp)}`, true);
        dataContextProps(nextData);
        subschema.errorPath = (0, codegen_1.str)`${errorPath}${(0, util_1.getErrorPath)(dataProp, dpType, opts.jsPropertySyntax)}`;
        subschema.parentDataProperty = (0, codegen_1._)`${dataProp}`;
        subschema.dataPathArr = [...dataPathArr, subschema.parentDataProperty];
      }
      if (data !== void 0) {
        const nextData = data instanceof codegen_1.Name ? data : gen.let("data", data, true);
        dataContextProps(nextData);
        if (propertyName !== void 0)
          subschema.propertyName = propertyName;
      }
      if (dataTypes)
        subschema.dataTypes = dataTypes;
      function dataContextProps(_nextData) {
        subschema.data = _nextData;
        subschema.dataLevel = it.dataLevel + 1;
        subschema.dataTypes = [];
        it.definedProperties = /* @__PURE__ */ new Set();
        subschema.parentData = it.data;
        subschema.dataNames = [...it.dataNames, _nextData];
      }
    }
    exports2.extendSubschemaData = extendSubschemaData;
    function extendSubschemaMode(subschema, { jtdDiscriminator, jtdMetadata, compositeRule, createErrors, allErrors }) {
      if (compositeRule !== void 0)
        subschema.compositeRule = compositeRule;
      if (createErrors !== void 0)
        subschema.createErrors = createErrors;
      if (allErrors !== void 0)
        subschema.allErrors = allErrors;
      subschema.jtdDiscriminator = jtdDiscriminator;
      subschema.jtdMetadata = jtdMetadata;
    }
    exports2.extendSubschemaMode = extendSubschemaMode;
  }
});

// node_modules/.pnpm/fast-deep-equal@3.1.3/node_modules/fast-deep-equal/index.js
var require_fast_deep_equal = __commonJS({
  "node_modules/.pnpm/fast-deep-equal@3.1.3/node_modules/fast-deep-equal/index.js"(exports2, module2) {
    "use strict";
    module2.exports = function equal(a, b) {
      if (a === b) return true;
      if (a && b && typeof a == "object" && typeof b == "object") {
        if (a.constructor !== b.constructor) return false;
        var length, i, keys;
        if (Array.isArray(a)) {
          length = a.length;
          if (length != b.length) return false;
          for (i = length; i-- !== 0; )
            if (!equal(a[i], b[i])) return false;
          return true;
        }
        if (a.constructor === RegExp) return a.source === b.source && a.flags === b.flags;
        if (a.valueOf !== Object.prototype.valueOf) return a.valueOf() === b.valueOf();
        if (a.toString !== Object.prototype.toString) return a.toString() === b.toString();
        keys = Object.keys(a);
        length = keys.length;
        if (length !== Object.keys(b).length) return false;
        for (i = length; i-- !== 0; )
          if (!Object.prototype.hasOwnProperty.call(b, keys[i])) return false;
        for (i = length; i-- !== 0; ) {
          var key = keys[i];
          if (!equal(a[key], b[key])) return false;
        }
        return true;
      }
      return a !== a && b !== b;
    };
  }
});

// node_modules/.pnpm/json-schema-traverse@1.0.0/node_modules/json-schema-traverse/index.js
var require_json_schema_traverse = __commonJS({
  "node_modules/.pnpm/json-schema-traverse@1.0.0/node_modules/json-schema-traverse/index.js"(exports2, module2) {
    "use strict";
    var traverse = module2.exports = function(schema, opts, cb) {
      if (typeof opts == "function") {
        cb = opts;
        opts = {};
      }
      cb = opts.cb || cb;
      var pre = typeof cb == "function" ? cb : cb.pre || function() {
      };
      var post = cb.post || function() {
      };
      _traverse(opts, pre, post, schema, "", schema);
    };
    traverse.keywords = {
      additionalItems: true,
      items: true,
      contains: true,
      additionalProperties: true,
      propertyNames: true,
      not: true,
      if: true,
      then: true,
      else: true
    };
    traverse.arrayKeywords = {
      items: true,
      allOf: true,
      anyOf: true,
      oneOf: true
    };
    traverse.propsKeywords = {
      $defs: true,
      definitions: true,
      properties: true,
      patternProperties: true,
      dependencies: true
    };
    traverse.skipKeywords = {
      default: true,
      enum: true,
      const: true,
      required: true,
      maximum: true,
      minimum: true,
      exclusiveMaximum: true,
      exclusiveMinimum: true,
      multipleOf: true,
      maxLength: true,
      minLength: true,
      pattern: true,
      format: true,
      maxItems: true,
      minItems: true,
      uniqueItems: true,
      maxProperties: true,
      minProperties: true
    };
    function _traverse(opts, pre, post, schema, jsonPtr, rootSchema, parentJsonPtr, parentKeyword, parentSchema, keyIndex) {
      if (schema && typeof schema == "object" && !Array.isArray(schema)) {
        pre(schema, jsonPtr, rootSchema, parentJsonPtr, parentKeyword, parentSchema, keyIndex);
        for (var key in schema) {
          var sch = schema[key];
          if (Array.isArray(sch)) {
            if (key in traverse.arrayKeywords) {
              for (var i = 0; i < sch.length; i++)
                _traverse(opts, pre, post, sch[i], jsonPtr + "/" + key + "/" + i, rootSchema, jsonPtr, key, schema, i);
            }
          } else if (key in traverse.propsKeywords) {
            if (sch && typeof sch == "object") {
              for (var prop in sch)
                _traverse(opts, pre, post, sch[prop], jsonPtr + "/" + key + "/" + escapeJsonPtr(prop), rootSchema, jsonPtr, key, schema, prop);
            }
          } else if (key in traverse.keywords || opts.allKeys && !(key in traverse.skipKeywords)) {
            _traverse(opts, pre, post, sch, jsonPtr + "/" + key, rootSchema, jsonPtr, key, schema);
          }
        }
        post(schema, jsonPtr, rootSchema, parentJsonPtr, parentKeyword, parentSchema, keyIndex);
      }
    }
    function escapeJsonPtr(str) {
      return str.replace(/~/g, "~0").replace(/\//g, "~1");
    }
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/resolve.js
var require_resolve = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/resolve.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.getSchemaRefs = exports2.resolveUrl = exports2.normalizeId = exports2._getFullPath = exports2.getFullPath = exports2.inlineRef = void 0;
    var util_1 = require_util();
    var equal = require_fast_deep_equal();
    var traverse = require_json_schema_traverse();
    var SIMPLE_INLINED = /* @__PURE__ */ new Set([
      "type",
      "format",
      "pattern",
      "maxLength",
      "minLength",
      "maxProperties",
      "minProperties",
      "maxItems",
      "minItems",
      "maximum",
      "minimum",
      "uniqueItems",
      "multipleOf",
      "required",
      "enum",
      "const"
    ]);
    function inlineRef(schema, limit = true) {
      if (typeof schema == "boolean")
        return true;
      if (limit === true)
        return !hasRef(schema);
      if (!limit)
        return false;
      return countKeys(schema) <= limit;
    }
    exports2.inlineRef = inlineRef;
    var REF_KEYWORDS = /* @__PURE__ */ new Set([
      "$ref",
      "$recursiveRef",
      "$recursiveAnchor",
      "$dynamicRef",
      "$dynamicAnchor"
    ]);
    function hasRef(schema) {
      for (const key in schema) {
        if (REF_KEYWORDS.has(key))
          return true;
        const sch = schema[key];
        if (Array.isArray(sch) && sch.some(hasRef))
          return true;
        if (typeof sch == "object" && hasRef(sch))
          return true;
      }
      return false;
    }
    function countKeys(schema) {
      let count = 0;
      for (const key in schema) {
        if (key === "$ref")
          return Infinity;
        count++;
        if (SIMPLE_INLINED.has(key))
          continue;
        if (typeof schema[key] == "object") {
          (0, util_1.eachItem)(schema[key], (sch) => count += countKeys(sch));
        }
        if (count === Infinity)
          return Infinity;
      }
      return count;
    }
    function getFullPath(resolver, id = "", normalize2) {
      if (normalize2 !== false)
        id = normalizeId(id);
      const p = resolver.parse(id);
      return _getFullPath(resolver, p);
    }
    exports2.getFullPath = getFullPath;
    function _getFullPath(resolver, p) {
      const serialized = resolver.serialize(p);
      return serialized.split("#")[0] + "#";
    }
    exports2._getFullPath = _getFullPath;
    var TRAILING_SLASH_HASH = /#\/?$/;
    function normalizeId(id) {
      return id ? id.replace(TRAILING_SLASH_HASH, "") : "";
    }
    exports2.normalizeId = normalizeId;
    function resolveUrl(resolver, baseId, id) {
      id = normalizeId(id);
      return resolver.resolve(baseId, id);
    }
    exports2.resolveUrl = resolveUrl;
    var ANCHOR = /^[a-z_][-a-z0-9._]*$/i;
    function getSchemaRefs(schema, baseId) {
      if (typeof schema == "boolean")
        return {};
      const { schemaId, uriResolver } = this.opts;
      const schId = normalizeId(schema[schemaId] || baseId);
      const baseIds = { "": schId };
      const pathPrefix = getFullPath(uriResolver, schId, false);
      const localRefs = {};
      const schemaRefs = /* @__PURE__ */ new Set();
      traverse(schema, { allKeys: true }, (sch, jsonPtr, _, parentJsonPtr) => {
        if (parentJsonPtr === void 0)
          return;
        const fullPath = pathPrefix + jsonPtr;
        let innerBaseId = baseIds[parentJsonPtr];
        if (typeof sch[schemaId] == "string")
          innerBaseId = addRef.call(this, sch[schemaId]);
        addAnchor.call(this, sch.$anchor);
        addAnchor.call(this, sch.$dynamicAnchor);
        baseIds[jsonPtr] = innerBaseId;
        function addRef(ref) {
          const _resolve = this.opts.uriResolver.resolve;
          ref = normalizeId(innerBaseId ? _resolve(innerBaseId, ref) : ref);
          if (schemaRefs.has(ref))
            throw ambiguos(ref);
          schemaRefs.add(ref);
          let schOrRef = this.refs[ref];
          if (typeof schOrRef == "string")
            schOrRef = this.refs[schOrRef];
          if (typeof schOrRef == "object") {
            checkAmbiguosRef(sch, schOrRef.schema, ref);
          } else if (ref !== normalizeId(fullPath)) {
            if (ref[0] === "#") {
              checkAmbiguosRef(sch, localRefs[ref], ref);
              localRefs[ref] = sch;
            } else {
              this.refs[ref] = fullPath;
            }
          }
          return ref;
        }
        function addAnchor(anchor) {
          if (typeof anchor == "string") {
            if (!ANCHOR.test(anchor))
              throw new Error(`invalid anchor "${anchor}"`);
            addRef.call(this, `#${anchor}`);
          }
        }
      });
      return localRefs;
      function checkAmbiguosRef(sch1, sch2, ref) {
        if (sch2 !== void 0 && !equal(sch1, sch2))
          throw ambiguos(ref);
      }
      function ambiguos(ref) {
        return new Error(`reference "${ref}" resolves to more than one schema`);
      }
    }
    exports2.getSchemaRefs = getSchemaRefs;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/validate/index.js
var require_validate = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/validate/index.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.getData = exports2.KeywordCxt = exports2.validateFunctionCode = void 0;
    var boolSchema_1 = require_boolSchema();
    var dataType_1 = require_dataType();
    var applicability_1 = require_applicability();
    var dataType_2 = require_dataType();
    var defaults_1 = require_defaults();
    var keyword_1 = require_keyword();
    var subschema_1 = require_subschema();
    var codegen_1 = require_codegen();
    var names_1 = require_names();
    var resolve_1 = require_resolve();
    var util_1 = require_util();
    var errors_1 = require_errors();
    function validateFunctionCode(it) {
      if (isSchemaObj(it)) {
        checkKeywords(it);
        if (schemaCxtHasRules(it)) {
          topSchemaObjCode(it);
          return;
        }
      }
      validateFunction(it, () => (0, boolSchema_1.topBoolOrEmptySchema)(it));
    }
    exports2.validateFunctionCode = validateFunctionCode;
    function validateFunction({ gen, validateName, schema, schemaEnv, opts }, body) {
      if (opts.code.es5) {
        gen.func(validateName, (0, codegen_1._)`${names_1.default.data}, ${names_1.default.valCxt}`, schemaEnv.$async, () => {
          gen.code((0, codegen_1._)`"use strict"; ${funcSourceUrl(schema, opts)}`);
          destructureValCxtES5(gen, opts);
          gen.code(body);
        });
      } else {
        gen.func(validateName, (0, codegen_1._)`${names_1.default.data}, ${destructureValCxt(opts)}`, schemaEnv.$async, () => gen.code(funcSourceUrl(schema, opts)).code(body));
      }
    }
    function destructureValCxt(opts) {
      return (0, codegen_1._)`{${names_1.default.instancePath}="", ${names_1.default.parentData}, ${names_1.default.parentDataProperty}, ${names_1.default.rootData}=${names_1.default.data}${opts.dynamicRef ? (0, codegen_1._)`, ${names_1.default.dynamicAnchors}={}` : codegen_1.nil}}={}`;
    }
    function destructureValCxtES5(gen, opts) {
      gen.if(names_1.default.valCxt, () => {
        gen.var(names_1.default.instancePath, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.instancePath}`);
        gen.var(names_1.default.parentData, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.parentData}`);
        gen.var(names_1.default.parentDataProperty, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.parentDataProperty}`);
        gen.var(names_1.default.rootData, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.rootData}`);
        if (opts.dynamicRef)
          gen.var(names_1.default.dynamicAnchors, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.dynamicAnchors}`);
      }, () => {
        gen.var(names_1.default.instancePath, (0, codegen_1._)`""`);
        gen.var(names_1.default.parentData, (0, codegen_1._)`undefined`);
        gen.var(names_1.default.parentDataProperty, (0, codegen_1._)`undefined`);
        gen.var(names_1.default.rootData, names_1.default.data);
        if (opts.dynamicRef)
          gen.var(names_1.default.dynamicAnchors, (0, codegen_1._)`{}`);
      });
    }
    function topSchemaObjCode(it) {
      const { schema, opts, gen } = it;
      validateFunction(it, () => {
        if (opts.$comment && schema.$comment)
          commentKeyword(it);
        checkNoDefault(it);
        gen.let(names_1.default.vErrors, null);
        gen.let(names_1.default.errors, 0);
        if (opts.unevaluated)
          resetEvaluated(it);
        typeAndKeywords(it);
        returnResults(it);
      });
      return;
    }
    function resetEvaluated(it) {
      const { gen, validateName } = it;
      it.evaluated = gen.const("evaluated", (0, codegen_1._)`${validateName}.evaluated`);
      gen.if((0, codegen_1._)`${it.evaluated}.dynamicProps`, () => gen.assign((0, codegen_1._)`${it.evaluated}.props`, (0, codegen_1._)`undefined`));
      gen.if((0, codegen_1._)`${it.evaluated}.dynamicItems`, () => gen.assign((0, codegen_1._)`${it.evaluated}.items`, (0, codegen_1._)`undefined`));
    }
    function funcSourceUrl(schema, opts) {
      const schId = typeof schema == "object" && schema[opts.schemaId];
      return schId && (opts.code.source || opts.code.process) ? (0, codegen_1._)`/*# sourceURL=${schId} */` : codegen_1.nil;
    }
    function subschemaCode(it, valid) {
      if (isSchemaObj(it)) {
        checkKeywords(it);
        if (schemaCxtHasRules(it)) {
          subSchemaObjCode(it, valid);
          return;
        }
      }
      (0, boolSchema_1.boolOrEmptySchema)(it, valid);
    }
    function schemaCxtHasRules({ schema, self }) {
      if (typeof schema == "boolean")
        return !schema;
      for (const key in schema)
        if (self.RULES.all[key])
          return true;
      return false;
    }
    function isSchemaObj(it) {
      return typeof it.schema != "boolean";
    }
    function subSchemaObjCode(it, valid) {
      const { schema, gen, opts } = it;
      if (opts.$comment && schema.$comment)
        commentKeyword(it);
      updateContext(it);
      checkAsyncSchema(it);
      const errsCount = gen.const("_errs", names_1.default.errors);
      typeAndKeywords(it, errsCount);
      gen.var(valid, (0, codegen_1._)`${errsCount} === ${names_1.default.errors}`);
    }
    function checkKeywords(it) {
      (0, util_1.checkUnknownRules)(it);
      checkRefsAndKeywords(it);
    }
    function typeAndKeywords(it, errsCount) {
      if (it.opts.jtd)
        return schemaKeywords(it, [], false, errsCount);
      const types = (0, dataType_1.getSchemaTypes)(it.schema);
      const checkedTypes = (0, dataType_1.coerceAndCheckDataType)(it, types);
      schemaKeywords(it, types, !checkedTypes, errsCount);
    }
    function checkRefsAndKeywords(it) {
      const { schema, errSchemaPath, opts, self } = it;
      if (schema.$ref && opts.ignoreKeywordsWithRef && (0, util_1.schemaHasRulesButRef)(schema, self.RULES)) {
        self.logger.warn(`$ref: keywords ignored in schema at path "${errSchemaPath}"`);
      }
    }
    function checkNoDefault(it) {
      const { schema, opts } = it;
      if (schema.default !== void 0 && opts.useDefaults && opts.strictSchema) {
        (0, util_1.checkStrictMode)(it, "default is ignored in the schema root");
      }
    }
    function updateContext(it) {
      const schId = it.schema[it.opts.schemaId];
      if (schId)
        it.baseId = (0, resolve_1.resolveUrl)(it.opts.uriResolver, it.baseId, schId);
    }
    function checkAsyncSchema(it) {
      if (it.schema.$async && !it.schemaEnv.$async)
        throw new Error("async schema in sync schema");
    }
    function commentKeyword({ gen, schemaEnv, schema, errSchemaPath, opts }) {
      const msg = schema.$comment;
      if (opts.$comment === true) {
        gen.code((0, codegen_1._)`${names_1.default.self}.logger.log(${msg})`);
      } else if (typeof opts.$comment == "function") {
        const schemaPath = (0, codegen_1.str)`${errSchemaPath}/$comment`;
        const rootName = gen.scopeValue("root", { ref: schemaEnv.root });
        gen.code((0, codegen_1._)`${names_1.default.self}.opts.$comment(${msg}, ${schemaPath}, ${rootName}.schema)`);
      }
    }
    function returnResults(it) {
      const { gen, schemaEnv, validateName, ValidationError, opts } = it;
      if (schemaEnv.$async) {
        gen.if((0, codegen_1._)`${names_1.default.errors} === 0`, () => gen.return(names_1.default.data), () => gen.throw((0, codegen_1._)`new ${ValidationError}(${names_1.default.vErrors})`));
      } else {
        gen.assign((0, codegen_1._)`${validateName}.errors`, names_1.default.vErrors);
        if (opts.unevaluated)
          assignEvaluated(it);
        gen.return((0, codegen_1._)`${names_1.default.errors} === 0`);
      }
    }
    function assignEvaluated({ gen, evaluated, props, items }) {
      if (props instanceof codegen_1.Name)
        gen.assign((0, codegen_1._)`${evaluated}.props`, props);
      if (items instanceof codegen_1.Name)
        gen.assign((0, codegen_1._)`${evaluated}.items`, items);
    }
    function schemaKeywords(it, types, typeErrors, errsCount) {
      const { gen, schema, data, allErrors, opts, self } = it;
      const { RULES } = self;
      if (schema.$ref && (opts.ignoreKeywordsWithRef || !(0, util_1.schemaHasRulesButRef)(schema, RULES))) {
        gen.block(() => keywordCode(it, "$ref", RULES.all.$ref.definition));
        return;
      }
      if (!opts.jtd)
        checkStrictTypes(it, types);
      gen.block(() => {
        for (const group of RULES.rules)
          groupKeywords(group);
        groupKeywords(RULES.post);
      });
      function groupKeywords(group) {
        if (!(0, applicability_1.shouldUseGroup)(schema, group))
          return;
        if (group.type) {
          gen.if((0, dataType_2.checkDataType)(group.type, data, opts.strictNumbers));
          iterateKeywords(it, group);
          if (types.length === 1 && types[0] === group.type && typeErrors) {
            gen.else();
            (0, dataType_2.reportTypeError)(it);
          }
          gen.endIf();
        } else {
          iterateKeywords(it, group);
        }
        if (!allErrors)
          gen.if((0, codegen_1._)`${names_1.default.errors} === ${errsCount || 0}`);
      }
    }
    function iterateKeywords(it, group) {
      const { gen, schema, opts: { useDefaults } } = it;
      if (useDefaults)
        (0, defaults_1.assignDefaults)(it, group.type);
      gen.block(() => {
        for (const rule of group.rules) {
          if ((0, applicability_1.shouldUseRule)(schema, rule)) {
            keywordCode(it, rule.keyword, rule.definition, group.type);
          }
        }
      });
    }
    function checkStrictTypes(it, types) {
      if (it.schemaEnv.meta || !it.opts.strictTypes)
        return;
      checkContextTypes(it, types);
      if (!it.opts.allowUnionTypes)
        checkMultipleTypes(it, types);
      checkKeywordTypes(it, it.dataTypes);
    }
    function checkContextTypes(it, types) {
      if (!types.length)
        return;
      if (!it.dataTypes.length) {
        it.dataTypes = types;
        return;
      }
      types.forEach((t) => {
        if (!includesType(it.dataTypes, t)) {
          strictTypesError(it, `type "${t}" not allowed by context "${it.dataTypes.join(",")}"`);
        }
      });
      narrowSchemaTypes(it, types);
    }
    function checkMultipleTypes(it, ts) {
      if (ts.length > 1 && !(ts.length === 2 && ts.includes("null"))) {
        strictTypesError(it, "use allowUnionTypes to allow union type keyword");
      }
    }
    function checkKeywordTypes(it, ts) {
      const rules = it.self.RULES.all;
      for (const keyword in rules) {
        const rule = rules[keyword];
        if (typeof rule == "object" && (0, applicability_1.shouldUseRule)(it.schema, rule)) {
          const { type } = rule.definition;
          if (type.length && !type.some((t) => hasApplicableType(ts, t))) {
            strictTypesError(it, `missing type "${type.join(",")}" for keyword "${keyword}"`);
          }
        }
      }
    }
    function hasApplicableType(schTs, kwdT) {
      return schTs.includes(kwdT) || kwdT === "number" && schTs.includes("integer");
    }
    function includesType(ts, t) {
      return ts.includes(t) || t === "integer" && ts.includes("number");
    }
    function narrowSchemaTypes(it, withTypes) {
      const ts = [];
      for (const t of it.dataTypes) {
        if (includesType(withTypes, t))
          ts.push(t);
        else if (withTypes.includes("integer") && t === "number")
          ts.push("integer");
      }
      it.dataTypes = ts;
    }
    function strictTypesError(it, msg) {
      const schemaPath = it.schemaEnv.baseId + it.errSchemaPath;
      msg += ` at "${schemaPath}" (strictTypes)`;
      (0, util_1.checkStrictMode)(it, msg, it.opts.strictTypes);
    }
    var KeywordCxt = class {
      constructor(it, def, keyword) {
        (0, keyword_1.validateKeywordUsage)(it, def, keyword);
        this.gen = it.gen;
        this.allErrors = it.allErrors;
        this.keyword = keyword;
        this.data = it.data;
        this.schema = it.schema[keyword];
        this.$data = def.$data && it.opts.$data && this.schema && this.schema.$data;
        this.schemaValue = (0, util_1.schemaRefOrVal)(it, this.schema, keyword, this.$data);
        this.schemaType = def.schemaType;
        this.parentSchema = it.schema;
        this.params = {};
        this.it = it;
        this.def = def;
        if (this.$data) {
          this.schemaCode = it.gen.const("vSchema", getData(this.$data, it));
        } else {
          this.schemaCode = this.schemaValue;
          if (!(0, keyword_1.validSchemaType)(this.schema, def.schemaType, def.allowUndefined)) {
            throw new Error(`${keyword} value must be ${JSON.stringify(def.schemaType)}`);
          }
        }
        if ("code" in def ? def.trackErrors : def.errors !== false) {
          this.errsCount = it.gen.const("_errs", names_1.default.errors);
        }
      }
      result(condition, successAction, failAction) {
        this.failResult((0, codegen_1.not)(condition), successAction, failAction);
      }
      failResult(condition, successAction, failAction) {
        this.gen.if(condition);
        if (failAction)
          failAction();
        else
          this.error();
        if (successAction) {
          this.gen.else();
          successAction();
          if (this.allErrors)
            this.gen.endIf();
        } else {
          if (this.allErrors)
            this.gen.endIf();
          else
            this.gen.else();
        }
      }
      pass(condition, failAction) {
        this.failResult((0, codegen_1.not)(condition), void 0, failAction);
      }
      fail(condition) {
        if (condition === void 0) {
          this.error();
          if (!this.allErrors)
            this.gen.if(false);
          return;
        }
        this.gen.if(condition);
        this.error();
        if (this.allErrors)
          this.gen.endIf();
        else
          this.gen.else();
      }
      fail$data(condition) {
        if (!this.$data)
          return this.fail(condition);
        const { schemaCode } = this;
        this.fail((0, codegen_1._)`${schemaCode} !== undefined && (${(0, codegen_1.or)(this.invalid$data(), condition)})`);
      }
      error(append, errorParams, errorPaths) {
        if (errorParams) {
          this.setParams(errorParams);
          this._error(append, errorPaths);
          this.setParams({});
          return;
        }
        this._error(append, errorPaths);
      }
      _error(append, errorPaths) {
        ;
        (append ? errors_1.reportExtraError : errors_1.reportError)(this, this.def.error, errorPaths);
      }
      $dataError() {
        (0, errors_1.reportError)(this, this.def.$dataError || errors_1.keyword$DataError);
      }
      reset() {
        if (this.errsCount === void 0)
          throw new Error('add "trackErrors" to keyword definition');
        (0, errors_1.resetErrorsCount)(this.gen, this.errsCount);
      }
      ok(cond) {
        if (!this.allErrors)
          this.gen.if(cond);
      }
      setParams(obj, assign) {
        if (assign)
          Object.assign(this.params, obj);
        else
          this.params = obj;
      }
      block$data(valid, codeBlock, $dataValid = codegen_1.nil) {
        this.gen.block(() => {
          this.check$data(valid, $dataValid);
          codeBlock();
        });
      }
      check$data(valid = codegen_1.nil, $dataValid = codegen_1.nil) {
        if (!this.$data)
          return;
        const { gen, schemaCode, schemaType, def } = this;
        gen.if((0, codegen_1.or)((0, codegen_1._)`${schemaCode} === undefined`, $dataValid));
        if (valid !== codegen_1.nil)
          gen.assign(valid, true);
        if (schemaType.length || def.validateSchema) {
          gen.elseIf(this.invalid$data());
          this.$dataError();
          if (valid !== codegen_1.nil)
            gen.assign(valid, false);
        }
        gen.else();
      }
      invalid$data() {
        const { gen, schemaCode, schemaType, def, it } = this;
        return (0, codegen_1.or)(wrong$DataType(), invalid$DataSchema());
        function wrong$DataType() {
          if (schemaType.length) {
            if (!(schemaCode instanceof codegen_1.Name))
              throw new Error("ajv implementation error");
            const st = Array.isArray(schemaType) ? schemaType : [schemaType];
            return (0, codegen_1._)`${(0, dataType_2.checkDataTypes)(st, schemaCode, it.opts.strictNumbers, dataType_2.DataType.Wrong)}`;
          }
          return codegen_1.nil;
        }
        function invalid$DataSchema() {
          if (def.validateSchema) {
            const validateSchemaRef = gen.scopeValue("validate$data", { ref: def.validateSchema });
            return (0, codegen_1._)`!${validateSchemaRef}(${schemaCode})`;
          }
          return codegen_1.nil;
        }
      }
      subschema(appl, valid) {
        const subschema = (0, subschema_1.getSubschema)(this.it, appl);
        (0, subschema_1.extendSubschemaData)(subschema, this.it, appl);
        (0, subschema_1.extendSubschemaMode)(subschema, appl);
        const nextContext = { ...this.it, ...subschema, items: void 0, props: void 0 };
        subschemaCode(nextContext, valid);
        return nextContext;
      }
      mergeEvaluated(schemaCxt, toName) {
        const { it, gen } = this;
        if (!it.opts.unevaluated)
          return;
        if (it.props !== true && schemaCxt.props !== void 0) {
          it.props = util_1.mergeEvaluated.props(gen, schemaCxt.props, it.props, toName);
        }
        if (it.items !== true && schemaCxt.items !== void 0) {
          it.items = util_1.mergeEvaluated.items(gen, schemaCxt.items, it.items, toName);
        }
      }
      mergeValidEvaluated(schemaCxt, valid) {
        const { it, gen } = this;
        if (it.opts.unevaluated && (it.props !== true || it.items !== true)) {
          gen.if(valid, () => this.mergeEvaluated(schemaCxt, codegen_1.Name));
          return true;
        }
      }
    };
    exports2.KeywordCxt = KeywordCxt;
    function keywordCode(it, keyword, def, ruleType) {
      const cxt = new KeywordCxt(it, def, keyword);
      if ("code" in def) {
        def.code(cxt, ruleType);
      } else if (cxt.$data && def.validate) {
        (0, keyword_1.funcKeywordCode)(cxt, def);
      } else if ("macro" in def) {
        (0, keyword_1.macroKeywordCode)(cxt, def);
      } else if (def.compile || def.validate) {
        (0, keyword_1.funcKeywordCode)(cxt, def);
      }
    }
    var JSON_POINTER = /^\/(?:[^~]|~0|~1)*$/;
    var RELATIVE_JSON_POINTER = /^([0-9]+)(#|\/(?:[^~]|~0|~1)*)?$/;
    function getData($data, { dataLevel, dataNames, dataPathArr }) {
      let jsonPointer;
      let data;
      if ($data === "")
        return names_1.default.rootData;
      if ($data[0] === "/") {
        if (!JSON_POINTER.test($data))
          throw new Error(`Invalid JSON-pointer: ${$data}`);
        jsonPointer = $data;
        data = names_1.default.rootData;
      } else {
        const matches = RELATIVE_JSON_POINTER.exec($data);
        if (!matches)
          throw new Error(`Invalid JSON-pointer: ${$data}`);
        const up = +matches[1];
        jsonPointer = matches[2];
        if (jsonPointer === "#") {
          if (up >= dataLevel)
            throw new Error(errorMsg("property/index", up));
          return dataPathArr[dataLevel - up];
        }
        if (up > dataLevel)
          throw new Error(errorMsg("data", up));
        data = dataNames[dataLevel - up];
        if (!jsonPointer)
          return data;
      }
      let expr = data;
      const segments = jsonPointer.split("/");
      for (const segment of segments) {
        if (segment) {
          data = (0, codegen_1._)`${data}${(0, codegen_1.getProperty)((0, util_1.unescapeJsonPointer)(segment))}`;
          expr = (0, codegen_1._)`${expr} && ${data}`;
        }
      }
      return expr;
      function errorMsg(pointerType, up) {
        return `Cannot access ${pointerType} ${up} levels up, current level is ${dataLevel}`;
      }
    }
    exports2.getData = getData;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/runtime/validation_error.js
var require_validation_error = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/runtime/validation_error.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var ValidationError = class extends Error {
      constructor(errors) {
        super("validation failed");
        this.errors = errors;
        this.ajv = this.validation = true;
      }
    };
    exports2.default = ValidationError;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/ref_error.js
var require_ref_error = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/ref_error.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var resolve_1 = require_resolve();
    var MissingRefError = class extends Error {
      constructor(resolver, baseId, ref, msg) {
        super(msg || `can't resolve reference ${ref} from id ${baseId}`);
        this.missingRef = (0, resolve_1.resolveUrl)(resolver, baseId, ref);
        this.missingSchema = (0, resolve_1.normalizeId)((0, resolve_1.getFullPath)(resolver, this.missingRef));
      }
    };
    exports2.default = MissingRefError;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/index.js
var require_compile = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/index.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.resolveSchema = exports2.getCompilingSchema = exports2.resolveRef = exports2.compileSchema = exports2.SchemaEnv = void 0;
    var codegen_1 = require_codegen();
    var validation_error_1 = require_validation_error();
    var names_1 = require_names();
    var resolve_1 = require_resolve();
    var util_1 = require_util();
    var validate_1 = require_validate();
    var SchemaEnv = class {
      constructor(env) {
        var _a;
        this.refs = {};
        this.dynamicAnchors = {};
        let schema;
        if (typeof env.schema == "object")
          schema = env.schema;
        this.schema = env.schema;
        this.schemaId = env.schemaId;
        this.root = env.root || this;
        this.baseId = (_a = env.baseId) !== null && _a !== void 0 ? _a : (0, resolve_1.normalizeId)(schema === null || schema === void 0 ? void 0 : schema[env.schemaId || "$id"]);
        this.schemaPath = env.schemaPath;
        this.localRefs = env.localRefs;
        this.meta = env.meta;
        this.$async = schema === null || schema === void 0 ? void 0 : schema.$async;
        this.refs = {};
      }
    };
    exports2.SchemaEnv = SchemaEnv;
    function compileSchema(sch) {
      const _sch = getCompilingSchema.call(this, sch);
      if (_sch)
        return _sch;
      const rootId = (0, resolve_1.getFullPath)(this.opts.uriResolver, sch.root.baseId);
      const { es5, lines } = this.opts.code;
      const { ownProperties } = this.opts;
      const gen = new codegen_1.CodeGen(this.scope, { es5, lines, ownProperties });
      let _ValidationError;
      if (sch.$async) {
        _ValidationError = gen.scopeValue("Error", {
          ref: validation_error_1.default,
          code: (0, codegen_1._)`require("ajv/dist/runtime/validation_error").default`
        });
      }
      const validateName = gen.scopeName("validate");
      sch.validateName = validateName;
      const schemaCxt = {
        gen,
        allErrors: this.opts.allErrors,
        data: names_1.default.data,
        parentData: names_1.default.parentData,
        parentDataProperty: names_1.default.parentDataProperty,
        dataNames: [names_1.default.data],
        dataPathArr: [codegen_1.nil],
        // TODO can its length be used as dataLevel if nil is removed?
        dataLevel: 0,
        dataTypes: [],
        definedProperties: /* @__PURE__ */ new Set(),
        topSchemaRef: gen.scopeValue("schema", this.opts.code.source === true ? { ref: sch.schema, code: (0, codegen_1.stringify)(sch.schema) } : { ref: sch.schema }),
        validateName,
        ValidationError: _ValidationError,
        schema: sch.schema,
        schemaEnv: sch,
        rootId,
        baseId: sch.baseId || rootId,
        schemaPath: codegen_1.nil,
        errSchemaPath: sch.schemaPath || (this.opts.jtd ? "" : "#"),
        errorPath: (0, codegen_1._)`""`,
        opts: this.opts,
        self: this
      };
      let sourceCode;
      try {
        this._compilations.add(sch);
        (0, validate_1.validateFunctionCode)(schemaCxt);
        gen.optimize(this.opts.code.optimize);
        const validateCode = gen.toString();
        sourceCode = `${gen.scopeRefs(names_1.default.scope)}return ${validateCode}`;
        if (this.opts.code.process)
          sourceCode = this.opts.code.process(sourceCode, sch);
        const makeValidate = new Function(`${names_1.default.self}`, `${names_1.default.scope}`, sourceCode);
        const validate = makeValidate(this, this.scope.get());
        this.scope.value(validateName, { ref: validate });
        validate.errors = null;
        validate.schema = sch.schema;
        validate.schemaEnv = sch;
        if (sch.$async)
          validate.$async = true;
        if (this.opts.code.source === true) {
          validate.source = { validateName, validateCode, scopeValues: gen._values };
        }
        if (this.opts.unevaluated) {
          const { props, items } = schemaCxt;
          validate.evaluated = {
            props: props instanceof codegen_1.Name ? void 0 : props,
            items: items instanceof codegen_1.Name ? void 0 : items,
            dynamicProps: props instanceof codegen_1.Name,
            dynamicItems: items instanceof codegen_1.Name
          };
          if (validate.source)
            validate.source.evaluated = (0, codegen_1.stringify)(validate.evaluated);
        }
        sch.validate = validate;
        return sch;
      } catch (e) {
        delete sch.validate;
        delete sch.validateName;
        if (sourceCode)
          this.logger.error("Error compiling schema, function code:", sourceCode);
        throw e;
      } finally {
        this._compilations.delete(sch);
      }
    }
    exports2.compileSchema = compileSchema;
    function resolveRef(root, baseId, ref) {
      var _a;
      ref = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, ref);
      const schOrFunc = root.refs[ref];
      if (schOrFunc)
        return schOrFunc;
      let _sch = resolve2.call(this, root, ref);
      if (_sch === void 0) {
        const schema = (_a = root.localRefs) === null || _a === void 0 ? void 0 : _a[ref];
        const { schemaId } = this.opts;
        if (schema)
          _sch = new SchemaEnv({ schema, schemaId, root, baseId });
      }
      if (_sch === void 0)
        return;
      return root.refs[ref] = inlineOrCompile.call(this, _sch);
    }
    exports2.resolveRef = resolveRef;
    function inlineOrCompile(sch) {
      if ((0, resolve_1.inlineRef)(sch.schema, this.opts.inlineRefs))
        return sch.schema;
      return sch.validate ? sch : compileSchema.call(this, sch);
    }
    function getCompilingSchema(schEnv) {
      for (const sch of this._compilations) {
        if (sameSchemaEnv(sch, schEnv))
          return sch;
      }
    }
    exports2.getCompilingSchema = getCompilingSchema;
    function sameSchemaEnv(s1, s2) {
      return s1.schema === s2.schema && s1.root === s2.root && s1.baseId === s2.baseId;
    }
    function resolve2(root, ref) {
      let sch;
      while (typeof (sch = this.refs[ref]) == "string")
        ref = sch;
      return sch || this.schemas[ref] || resolveSchema.call(this, root, ref);
    }
    function resolveSchema(root, ref) {
      const p = this.opts.uriResolver.parse(ref);
      const refPath = (0, resolve_1._getFullPath)(this.opts.uriResolver, p);
      let baseId = (0, resolve_1.getFullPath)(this.opts.uriResolver, root.baseId, void 0);
      if (Object.keys(root.schema).length > 0 && refPath === baseId) {
        return getJsonPointer.call(this, p, root);
      }
      const id = (0, resolve_1.normalizeId)(refPath);
      const schOrRef = this.refs[id] || this.schemas[id];
      if (typeof schOrRef == "string") {
        const sch = resolveSchema.call(this, root, schOrRef);
        if (typeof (sch === null || sch === void 0 ? void 0 : sch.schema) !== "object")
          return;
        return getJsonPointer.call(this, p, sch);
      }
      if (typeof (schOrRef === null || schOrRef === void 0 ? void 0 : schOrRef.schema) !== "object")
        return;
      if (!schOrRef.validate)
        compileSchema.call(this, schOrRef);
      if (id === (0, resolve_1.normalizeId)(ref)) {
        const { schema } = schOrRef;
        const { schemaId } = this.opts;
        const schId = schema[schemaId];
        if (schId)
          baseId = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, schId);
        return new SchemaEnv({ schema, schemaId, root, baseId });
      }
      return getJsonPointer.call(this, p, schOrRef);
    }
    exports2.resolveSchema = resolveSchema;
    var PREVENT_SCOPE_CHANGE = /* @__PURE__ */ new Set([
      "properties",
      "patternProperties",
      "enum",
      "dependencies",
      "definitions"
    ]);
    function getJsonPointer(parsedRef, { baseId, schema, root }) {
      var _a;
      if (((_a = parsedRef.fragment) === null || _a === void 0 ? void 0 : _a[0]) !== "/")
        return;
      for (const part of parsedRef.fragment.slice(1).split("/")) {
        if (typeof schema === "boolean")
          return;
        const partSchema = schema[(0, util_1.unescapeFragment)(part)];
        if (partSchema === void 0)
          return;
        schema = partSchema;
        const schId = typeof schema === "object" && schema[this.opts.schemaId];
        if (!PREVENT_SCOPE_CHANGE.has(part) && schId) {
          baseId = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, schId);
        }
      }
      let env;
      if (typeof schema != "boolean" && schema.$ref && !(0, util_1.schemaHasRulesButRef)(schema, this.RULES)) {
        const $ref = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, schema.$ref);
        env = resolveSchema.call(this, root, $ref);
      }
      const { schemaId } = this.opts;
      env = env || new SchemaEnv({ schema, schemaId, root, baseId });
      if (env.schema !== env.root.schema)
        return env;
      return void 0;
    }
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/refs/data.json
var require_data = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/refs/data.json"(exports2, module2) {
    module2.exports = {
      $id: "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#",
      description: "Meta-schema for $data reference (JSON AnySchema extension proposal)",
      type: "object",
      required: ["$data"],
      properties: {
        $data: {
          type: "string",
          anyOf: [{ format: "relative-json-pointer" }, { format: "json-pointer" }]
        }
      },
      additionalProperties: false
    };
  }
});

// node_modules/.pnpm/fast-uri@3.1.8/node_modules/fast-uri/lib/utils.js
var require_utils = __commonJS({
  "node_modules/.pnpm/fast-uri@3.1.8/node_modules/fast-uri/lib/utils.js"(exports2, module2) {
    "use strict";
    var isUUID = RegExp.prototype.test.bind(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu);
    var isIPv4 = RegExp.prototype.test.bind(/^(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)$/u);
    var isPort = RegExp.prototype.test.bind(/^\d*$/u);
    var isHexPair = RegExp.prototype.test.bind(/^[\da-f]{2}$/iu);
    var isUnreserved = RegExp.prototype.test.bind(/^[\da-z\-._~]$/iu);
    var isPathCharacter = RegExp.prototype.test.bind(/^[A-Za-z0-9\-._~!$&'()*+,;=:@/]$/u);
    var isQueryFragmentCharacter = RegExp.prototype.test.bind(/^[A-Za-z0-9\-._~!$&'()*+,;=:@/?]$/u);
    var isUserinfoCharacter = RegExp.prototype.test.bind(/^[A-Za-z0-9\-._~!$&'()*+,;=:]$/u);
    var BYTE_HEX = new Array(256);
    {
      const HEX_DIGITS = "0123456789ABCDEF";
      for (let i = 0; i < 256; i++) {
        BYTE_HEX[i] = "%" + HEX_DIGITS[i >> 4] + HEX_DIGITS[i & 15];
      }
    }
    function percentEncodeNonAscii(cp) {
      if (cp < 2048) {
        return BYTE_HEX[192 | cp >> 6] + BYTE_HEX[128 | cp & 63];
      }
      if (cp < 65536) {
        return BYTE_HEX[224 | cp >> 12] + BYTE_HEX[128 | cp >> 6 & 63] + BYTE_HEX[128 | cp & 63];
      }
      return BYTE_HEX[240 | cp >> 18] + BYTE_HEX[128 | cp >> 12 & 63] + BYTE_HEX[128 | cp >> 6 & 63] + BYTE_HEX[128 | cp & 63];
    }
    function stringArrayToHexStripped(input) {
      let acc = "";
      let code = 0;
      let i = 0;
      for (i = 0; i < input.length; i++) {
        code = input[i].charCodeAt(0);
        if (code === 48) {
          continue;
        }
        if (!(code >= 48 && code <= 57 || code >= 65 && code <= 70 || code >= 97 && code <= 102)) {
          return "";
        }
        acc += input[i];
        break;
      }
      for (i += 1; i < input.length; i++) {
        code = input[i].charCodeAt(0);
        if (!(code >= 48 && code <= 57 || code >= 65 && code <= 70 || code >= 97 && code <= 102)) {
          return "";
        }
        acc += input[i];
      }
      return acc;
    }
    var isHextet = RegExp.prototype.test.bind(/^[\dA-Fa-f]{1,4}$/);
    var isIPvFuture = RegExp.prototype.test.bind(/^[vV][\dA-Fa-f]+\.[A-Za-z\d\-._~!$&'()*+,;=:]+$/);
    var isZoneCharacter = RegExp.prototype.test.bind(/^[A-Za-z\d\-._~]$/);
    var nonSimpleDomain = RegExp.prototype.test.bind(/[^!"$&'()*+,\-.;=_`a-z{}~]/u);
    function isZoneIdentifier(zone) {
      if (zone.length === 0) return false;
      for (let i = 0; i < zone.length; i++) {
        if (isZoneCharacter(zone[i])) continue;
        if (zone[i] === "%" && i + 2 < zone.length && isHexPair(zone.slice(i + 1, i + 3))) {
          i += 2;
          continue;
        }
        return false;
      }
      return true;
    }
    function compressIPv6ZeroRun(hextets) {
      let bestStart = -1;
      let bestLength = 0;
      let runStart = -1;
      let runLength = 0;
      for (let i = 0; i < hextets.length; i++) {
        if (hextets[i] === "0") {
          if (runStart === -1) runStart = i;
          runLength++;
          if (runLength > bestLength) {
            bestLength = runLength;
            bestStart = runStart;
          }
        } else {
          runStart = -1;
          runLength = 0;
        }
      }
      if (bestLength < 2) return hextets.join(":");
      const head = hextets.slice(0, bestStart).join(":");
      const tail = hextets.slice(bestStart + bestLength).join(":");
      return head + "::" + tail;
    }
    function normalizeIPv6Address(input) {
      const compression = input.indexOf("::");
      if (compression !== -1 && input.indexOf("::", compression + 1) !== -1) return void 0;
      const left = compression === -1 ? input.split(":") : input.slice(0, compression).split(":");
      const right = compression === -1 ? [] : input.slice(compression + 2).split(":");
      if (compression !== -1) {
        if (left.length === 1 && left[0] === "") left.length = 0;
        if (right.length === 1 && right[0] === "") right.length = 0;
      }
      const parts = left.concat(right);
      let hextetCount = 0;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (part === "") return void 0;
        if (part.indexOf(".") !== -1) {
          if (i !== parts.length - 1 || compression !== -1 && right.length === 0 || !isIPv4(part)) return void 0;
          hextetCount += 2;
          continue;
        }
        if (!isHextet(part)) return void 0;
        parts[i] = parseInt(part, 16).toString(16);
        hextetCount++;
      }
      if (compression === -1) {
        if (hextetCount !== 8) return void 0;
        return compressIPv6ZeroRun(parts);
      }
      if (hextetCount >= 8) return void 0;
      const expanded = parts.slice(0, left.length);
      for (let i = hextetCount; i < 8; i++) expanded.push("0");
      for (let i = left.length; i < parts.length; i++) expanded.push(parts[i]);
      return compressIPv6ZeroRun(expanded);
    }
    function normalizeIPv6(host) {
      const bracketed = host[0] === "[" && host[host.length - 1] === "]";
      const hasBracket = host[0] === "[" || host[host.length - 1] === "]";
      if (hasBracket && !bracketed) return { host, isIPV6: false, error: true };
      let input = bracketed ? host.slice(1, -1) : host;
      if (bracketed && isIPvFuture(input)) {
        input = input.toLowerCase();
        return { host: `[${input}]`, escapedHost: input, isIPV6: false, isIPVFuture: true };
      }
      if (findToken(input, ":") < 2) {
        return { host, isIPV6: false, error: bracketed };
      }
      let zoneIdentifier = "";
      const zoneSeparator = input.indexOf("%");
      if (zoneSeparator !== -1) {
        const separatorLength = input.slice(zoneSeparator, zoneSeparator + 3).toLowerCase() === "%25" ? 3 : 1;
        zoneIdentifier = input.slice(zoneSeparator + separatorLength);
        if (!isZoneIdentifier(zoneIdentifier)) return { host, isIPV6: false, error: true };
        input = input.slice(0, zoneSeparator);
      }
      const address = normalizeIPv6Address(input);
      if (address === void 0) return { host, isIPV6: false, error: true };
      return {
        host: address + (zoneIdentifier ? "%" + zoneIdentifier : ""),
        escapedHost: address + (zoneIdentifier ? "%25" + zoneIdentifier : ""),
        isIPV6: true
      };
    }
    function findToken(str, token) {
      let ind = 0;
      for (let i = 0; i < str.length; i++) {
        if (str[i] === token) ind++;
      }
      return ind;
    }
    function removeDotSegments(path27) {
      let input = path27;
      const output = [];
      let nextSlash = -1;
      let len = 0;
      while (len = input.length) {
        if (len === 1) {
          if (input === ".") {
            break;
          } else if (input === "/") {
            output.push("/");
            break;
          } else {
            output.push(input);
            break;
          }
        } else if (len === 2) {
          if (input[0] === ".") {
            if (input[1] === ".") {
              break;
            } else if (input[1] === "/") {
              input = input.slice(2);
              continue;
            }
          } else if (input[0] === "/") {
            if (input[1] === "." || input[1] === "/") {
              output.push("/");
              break;
            }
          }
        } else if (len === 3) {
          if (input === "/..") {
            if (output.length !== 0) {
              output.pop();
            }
            output.push("/");
            break;
          }
        }
        if (input[0] === ".") {
          if (input[1] === ".") {
            if (input[2] === "/") {
              input = input.slice(3);
              continue;
            }
          } else if (input[1] === "/") {
            input = input.slice(2);
            continue;
          }
        } else if (input[0] === "/") {
          if (input[1] === ".") {
            if (input[2] === "/") {
              input = input.slice(2);
              continue;
            } else if (input[2] === ".") {
              if (input[3] === "/") {
                input = input.slice(3);
                if (output.length !== 0) {
                  output.pop();
                }
                continue;
              }
            }
          }
        }
        if ((nextSlash = input.indexOf("/", 1)) === -1) {
          output.push(input);
          break;
        } else {
          output.push(input.slice(0, nextSlash));
          input = input.slice(nextSlash);
        }
      }
      return output.join("");
    }
    var HOST_DELIMS = { "@": "%40", "/": "%2F", "?": "%3F", "#": "%23", ":": "%3A" };
    var HOST_DELIM_RE = /[@/?#:]/g;
    var HOST_DELIM_NO_COLON_RE = /[@/?#]/g;
    function reescapeHostDelimiters(host, isIP) {
      const re = isIP ? HOST_DELIM_NO_COLON_RE : HOST_DELIM_RE;
      re.lastIndex = 0;
      return host.replace(re, (ch) => HOST_DELIMS[ch]);
    }
    function normalizePercentEncoding(input, decodeUnreserved = false) {
      if (input.indexOf("%") === -1) {
        return input;
      }
      let output = "";
      for (let i = 0; i < input.length; i++) {
        if (input[i] === "%" && i + 2 < input.length) {
          const hex = input.slice(i + 1, i + 3);
          if (isHexPair(hex)) {
            const normalizedHex = hex.toUpperCase();
            const decoded = String.fromCharCode(parseInt(normalizedHex, 16));
            if (decodeUnreserved && isUnreserved(decoded)) {
              output += decoded;
            } else {
              output += "%" + normalizedHex;
            }
            i += 2;
            continue;
          }
        }
        output += input[i];
      }
      return output;
    }
    function normalizePathEncoding(input) {
      let output = "";
      for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (ch === "%" && i + 2 < input.length) {
          const hex = input.slice(i + 1, i + 3);
          if (isHexPair(hex)) {
            const normalizedHex = hex.toUpperCase();
            const decoded = String.fromCharCode(parseInt(normalizedHex, 16));
            if (decoded !== "." && isUnreserved(decoded)) {
              output += decoded;
            } else {
              output += "%" + normalizedHex;
            }
            i += 2;
            continue;
          }
        }
        if (isPathCharacter(ch)) {
          output += ch;
        } else {
          const code = input.charCodeAt(i);
          if (code < 128) {
            output += isEscapeSafe(code) ? ch : BYTE_HEX[code];
          } else if (code < 55296 || code > 57343) {
            output += percentEncodeNonAscii(code);
          } else if (code <= 56319 && i + 1 < input.length) {
            const low = input.charCodeAt(i + 1);
            if (low >= 56320 && low <= 57343) {
              output += percentEncodeNonAscii(65536 + (code - 55296 << 10) + (low - 56320));
              i++;
            } else {
              output += percentEncodeNonAscii(65533);
            }
          } else {
            output += percentEncodeNonAscii(65533);
          }
        }
      }
      return output;
    }
    function serializePathEncoding(input, pathNoScheme = false) {
      let output = "";
      let firstSegment = pathNoScheme && input[0] !== "/";
      for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (ch === "%" && i + 2 < input.length) {
          const hex = input.slice(i + 1, i + 3);
          if (isHexPair(hex)) {
            output += "%" + hex.toUpperCase();
            i += 2;
            continue;
          }
        }
        if (ch === "/") {
          firstSegment = false;
        }
        if (isPathCharacter(ch) && (ch !== ":" || !firstSegment)) {
          output += ch;
        } else {
          const code = input.charCodeAt(i);
          if (code < 128) {
            output += BYTE_HEX[code];
          } else if (code < 55296 || code > 57343) {
            output += percentEncodeNonAscii(code);
          } else if (code <= 56319 && i + 1 < input.length) {
            const low = input.charCodeAt(i + 1);
            if (low >= 56320 && low <= 57343) {
              output += percentEncodeNonAscii(65536 + (code - 55296 << 10) + (low - 56320));
              i++;
            } else {
              output += percentEncodeNonAscii(65533);
            }
          } else {
            output += percentEncodeNonAscii(65533);
          }
        }
      }
      return output;
    }
    function encodeComponent(input, isAllowed) {
      let output = "";
      for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (ch === "%" && i + 2 < input.length) {
          const hex = input.slice(i + 1, i + 3);
          if (isHexPair(hex)) {
            output += "%" + hex.toUpperCase();
            i += 2;
            continue;
          }
        }
        if (isAllowed(ch)) {
          output += ch;
        } else {
          const code = input.charCodeAt(i);
          if (code < 128) {
            output += BYTE_HEX[code];
          } else if (code < 55296 || code > 57343) {
            output += percentEncodeNonAscii(code);
          } else if (code <= 56319 && i + 1 < input.length) {
            const low = input.charCodeAt(i + 1);
            if (low >= 56320 && low <= 57343) {
              output += percentEncodeNonAscii(65536 + (code - 55296 << 10) + (low - 56320));
              i++;
            } else {
              output += percentEncodeNonAscii(65533);
            }
          } else {
            output += percentEncodeNonAscii(65533);
          }
        }
      }
      return output;
    }
    function encodeUserinfo(input) {
      return encodeComponent(input, isUserinfoCharacter);
    }
    function encodeQuery(input) {
      return encodeComponent(input, isQueryFragmentCharacter);
    }
    function encodeFragment(input) {
      return encodeComponent(input, isQueryFragmentCharacter);
    }
    function isEscapeSafe(cp) {
      return cp >= 48 && cp <= 57 || cp >= 65 && cp <= 90 || cp >= 97 && cp <= 122 || cp === 42 || cp === 43 || cp === 45 || cp === 46 || cp === 47 || cp === 64 || cp === 95;
    }
    function normalizeQueryFragmentEncoding(input) {
      let output = "";
      for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (ch === "%" && i + 2 < input.length) {
          const hex = input.slice(i + 1, i + 3);
          if (isHexPair(hex)) {
            const normalizedHex = hex.toUpperCase();
            const decoded = String.fromCharCode(parseInt(normalizedHex, 16));
            if (isUnreserved(decoded)) {
              output += decoded;
            } else {
              output += "%" + normalizedHex;
            }
            i += 2;
            continue;
          }
        }
        if (isQueryFragmentCharacter(ch)) {
          output += ch;
        } else {
          const code = input.charCodeAt(i);
          if (code < 128) {
            output += isEscapeSafe(code) ? ch : BYTE_HEX[code];
          } else if (code < 55296 || code > 57343) {
            output += percentEncodeNonAscii(code);
          } else if (code <= 56319 && i + 1 < input.length) {
            const low = input.charCodeAt(i + 1);
            if (low >= 56320 && low <= 57343) {
              output += percentEncodeNonAscii(65536 + (code - 55296 << 10) + (low - 56320));
              i++;
            } else {
              output += percentEncodeNonAscii(65533);
            }
          } else {
            output += percentEncodeNonAscii(65533);
          }
        }
      }
      return output;
    }
    function escapePreservingEscapes(input) {
      let output = "";
      for (let i = 0; i < input.length; i++) {
        if (input[i] === "%" && i + 2 < input.length) {
          const hex = input.slice(i + 1, i + 3);
          if (isHexPair(hex)) {
            output += "%" + hex.toUpperCase();
            i += 2;
            continue;
          }
        }
        output += escape(input[i]);
      }
      return output;
    }
    function recomposeAuthority(component) {
      const uriTokens = [];
      if (component.userinfo !== void 0) {
        uriTokens.push(encodeUserinfo(component.userinfo));
        uriTokens.push("@");
      }
      if (component.host !== void 0) {
        let host = component.host;
        if (!isIPv4(host)) {
          let ipV6res = normalizeIPv6(host);
          if (ipV6res.isIPV6 !== true && ipV6res.isIPVFuture !== true) {
            host = normalizePercentEncoding(host, true);
            ipV6res = normalizeIPv6(host);
          }
          if (ipV6res.isIPV6 === true || ipV6res.isIPVFuture === true) {
            host = `[${ipV6res.escapedHost}]`;
          } else {
            host = reescapeHostDelimiters(host, false);
          }
        }
        uriTokens.push(host);
      }
      if (typeof component.port === "number" || typeof component.port === "string") {
        const port = String(component.port);
        if (!isPort(port)) {
          throw new TypeError("URI port is malformed.");
        }
        uriTokens.push(":");
        uriTokens.push(port);
      }
      return uriTokens.length ? uriTokens.join("") : void 0;
    }
    module2.exports = {
      nonSimpleDomain,
      recomposeAuthority,
      reescapeHostDelimiters,
      normalizePercentEncoding,
      normalizePathEncoding,
      serializePathEncoding,
      normalizeQueryFragmentEncoding,
      encodeUserinfo,
      encodeQuery,
      encodeFragment,
      escapePreservingEscapes,
      removeDotSegments,
      isIPv4,
      isUUID,
      normalizeIPv6,
      stringArrayToHexStripped
    };
  }
});

// node_modules/.pnpm/fast-uri@3.1.8/node_modules/fast-uri/lib/schemes.js
var require_schemes = __commonJS({
  "node_modules/.pnpm/fast-uri@3.1.8/node_modules/fast-uri/lib/schemes.js"(exports2, module2) {
    "use strict";
    var { isUUID } = require_utils();
    var URN_REG = /^([\da-z][\d\-a-z]{0,31}):((?:[\w!$'()*+,\-./:;=@]|%[\da-f]{2})+)$/iu;
    var supportedSchemeNames = (
      /** @type {const} */
      [
        "http",
        "https",
        "ws",
        "wss",
        "urn",
        "urn:uuid"
      ]
    );
    function isValidSchemeName(name) {
      return supportedSchemeNames.indexOf(
        /** @type {*} */
        name
      ) !== -1;
    }
    function wsIsSecure(wsComponent) {
      if (wsComponent.secure === true) {
        return true;
      } else if (wsComponent.secure === false) {
        return false;
      } else if (wsComponent.scheme) {
        return wsComponent.scheme.length === 3 && (wsComponent.scheme[0] === "w" || wsComponent.scheme[0] === "W") && (wsComponent.scheme[1] === "s" || wsComponent.scheme[1] === "S") && (wsComponent.scheme[2] === "s" || wsComponent.scheme[2] === "S");
      } else {
        return false;
      }
    }
    function httpParse(component) {
      if (!component.host) {
        component.error = component.error || "HTTP URIs must have a host.";
      }
      return component;
    }
    function httpSerialize(component) {
      const secure = String(component.scheme).toLowerCase() === "https";
      if (component.port === (secure ? 443 : 80) || component.port === "") {
        component.port = void 0;
      }
      if (!component.path) {
        component.path = "/";
      }
      return component;
    }
    function wsParse(wsComponent) {
      wsComponent.secure = wsIsSecure(wsComponent);
      wsComponent.resourceName = (wsComponent.path || "/") + (wsComponent.query ? "?" + wsComponent.query : "");
      wsComponent.path = void 0;
      wsComponent.query = void 0;
      return wsComponent;
    }
    function wsSerialize(wsComponent) {
      if (wsComponent.port === (wsIsSecure(wsComponent) ? 443 : 80) || wsComponent.port === "") {
        wsComponent.port = void 0;
      }
      if (typeof wsComponent.secure === "boolean") {
        wsComponent.scheme = wsComponent.secure ? "wss" : "ws";
        wsComponent.secure = void 0;
      }
      if (wsComponent.resourceName) {
        const queryIndex = wsComponent.resourceName.indexOf("?");
        const path27 = queryIndex === -1 ? wsComponent.resourceName : wsComponent.resourceName.slice(0, queryIndex);
        wsComponent.path = path27 && path27 !== "/" ? path27 : void 0;
        wsComponent.query = queryIndex === -1 ? void 0 : wsComponent.resourceName.slice(queryIndex + 1);
        wsComponent.resourceName = void 0;
      }
      wsComponent.fragment = void 0;
      return wsComponent;
    }
    function urnParse(urnComponent, options) {
      if (!urnComponent.path) {
        urnComponent.error = "URN can not be parsed";
        return urnComponent;
      }
      const matches = urnComponent.path.match(URN_REG);
      if (matches && matches[0] === urnComponent.path) {
        const scheme = options.scheme || urnComponent.scheme || "urn";
        urnComponent.nid = matches[1].toLowerCase();
        urnComponent.nss = matches[2];
        const urnScheme = `${scheme}:${options.nid || urnComponent.nid}`;
        const schemeHandler = getSchemeHandler(urnScheme);
        urnComponent.path = void 0;
        if (schemeHandler) {
          urnComponent = schemeHandler.parse(urnComponent, options);
        }
      } else {
        urnComponent.error = urnComponent.error || "URN can not be parsed.";
      }
      return urnComponent;
    }
    function urnSerialize(urnComponent, options) {
      if (urnComponent.nid === void 0) {
        throw new Error("URN without nid cannot be serialized");
      }
      const scheme = options.scheme || urnComponent.scheme || "urn";
      const nid = urnComponent.nid.toLowerCase();
      const urnScheme = `${scheme}:${options.nid || nid}`;
      const schemeHandler = getSchemeHandler(urnScheme);
      if (schemeHandler) {
        urnComponent = schemeHandler.serialize(urnComponent, options);
      }
      const uriComponent = urnComponent;
      const nss = urnComponent.nss;
      uriComponent.path = `${nid || options.nid}:${nss}`;
      options.skipEscape = true;
      return uriComponent;
    }
    function urnuuidParse(urnComponent, options) {
      const uuidComponent = urnComponent;
      uuidComponent.uuid = uuidComponent.nss;
      uuidComponent.nss = void 0;
      if (!options.tolerant && (!uuidComponent.uuid || !isUUID(uuidComponent.uuid))) {
        uuidComponent.error = uuidComponent.error || "UUID is not valid.";
      }
      return uuidComponent;
    }
    function urnuuidSerialize(uuidComponent) {
      const urnComponent = uuidComponent;
      urnComponent.nss = (uuidComponent.uuid || "").toLowerCase();
      return urnComponent;
    }
    var http = (
      /** @type {SchemeHandler} */
      {
        scheme: "http",
        domainHost: true,
        parse: httpParse,
        serialize: httpSerialize
      }
    );
    var https = (
      /** @type {SchemeHandler} */
      {
        scheme: "https",
        domainHost: http.domainHost,
        parse: httpParse,
        serialize: httpSerialize
      }
    );
    var ws = (
      /** @type {SchemeHandler} */
      {
        scheme: "ws",
        domainHost: true,
        parse: wsParse,
        serialize: wsSerialize
      }
    );
    var wss = (
      /** @type {SchemeHandler} */
      {
        scheme: "wss",
        domainHost: ws.domainHost,
        parse: ws.parse,
        serialize: ws.serialize
      }
    );
    var urn = (
      /** @type {SchemeHandler} */
      {
        scheme: "urn",
        parse: urnParse,
        serialize: urnSerialize,
        skipNormalize: true
      }
    );
    var urnuuid = (
      /** @type {SchemeHandler} */
      {
        scheme: "urn:uuid",
        parse: urnuuidParse,
        serialize: urnuuidSerialize,
        skipNormalize: true
      }
    );
    var SCHEMES = (
      /** @type {Record<SchemeName, SchemeHandler>} */
      {
        http,
        https,
        ws,
        wss,
        urn,
        "urn:uuid": urnuuid
      }
    );
    Object.setPrototypeOf(SCHEMES, null);
    function getSchemeHandler(scheme) {
      return scheme && (SCHEMES[
        /** @type {SchemeName} */
        scheme
      ] || SCHEMES[
        /** @type {SchemeName} */
        scheme.toLowerCase()
      ]) || void 0;
    }
    module2.exports = {
      wsIsSecure,
      SCHEMES,
      isValidSchemeName,
      getSchemeHandler
    };
  }
});

// node_modules/.pnpm/fast-uri@3.1.8/node_modules/fast-uri/index.js
var require_fast_uri = __commonJS({
  "node_modules/.pnpm/fast-uri@3.1.8/node_modules/fast-uri/index.js"(exports2, module2) {
    "use strict";
    var { normalizeIPv6, removeDotSegments, recomposeAuthority, normalizePercentEncoding, normalizePathEncoding, serializePathEncoding, normalizeQueryFragmentEncoding, encodeQuery, encodeFragment, reescapeHostDelimiters, isIPv4, nonSimpleDomain } = require_utils();
    var { SCHEMES, getSchemeHandler } = require_schemes();
    var VALID_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*$/u;
    var MALFORMED_SCHEME_ERROR = "URI scheme is malformed.";
    function decodeValidScheme(scheme) {
      const decodedScheme = unescape(String(scheme));
      if (!VALID_SCHEME.test(decodedScheme)) {
        throw new TypeError(MALFORMED_SCHEME_ERROR);
      }
      return decodedScheme;
    }
    function normalize2(uri, options) {
      if (typeof uri === "string") {
        uri = /** @type {T} */
        normalizeString(uri, options);
      } else if (typeof uri === "object") {
        uri = /** @type {T} */
        parse(serialize(uri, options), options);
      }
      return uri;
    }
    function resolve2(baseURI, relativeURI, options) {
      const schemelessOptions = options ? Object.assign({ scheme: "null" }, options) : { scheme: "null" };
      const {
        parsed: baseParsed,
        malformedAuthorityOrPort: baseMalformed,
        malformedPercentEncoding: baseMalformedPercentEncoding,
        malformedSchemeSpecific: baseMalformedSchemeSpecific,
        malformedHost: baseMalformedHost,
        malformedScheme: baseMalformedScheme
      } = parseWithStatus(baseURI, schemelessOptions);
      const {
        parsed: relativeParsed,
        malformedAuthorityOrPort: relativeMalformed,
        malformedPercentEncoding: relativeMalformedPercentEncoding,
        malformedSchemeSpecific: relativeMalformedSchemeSpecific,
        malformedHost: relativeMalformedHost,
        malformedScheme: relativeMalformedScheme
      } = parseWithStatus(relativeURI, schemelessOptions);
      if (baseMalformed || relativeMalformed || baseMalformedPercentEncoding || relativeMalformedPercentEncoding || baseMalformedSchemeSpecific || relativeMalformedSchemeSpecific || baseMalformedHost || relativeMalformedHost || baseMalformedScheme || relativeMalformedScheme) {
        throw new Error(baseParsed.error || relativeParsed.error || "URI is malformed.");
      }
      const resolved = resolveComponent(baseParsed, relativeParsed, schemelessOptions, true);
      const resolvedSchemeHandler = getSchemeHandler(options && options.scheme || resolved.scheme);
      const resolvedHost = resolved.host;
      const resolvedHostIsIP = resolvedHost !== void 0 && resolvedHost !== "" && (isIPv4(resolvedHost) || normalizeIPv6(resolvedHost).isIPV6);
      canonicalizeHost(resolved, options || {}, resolvedSchemeHandler, resolvedHostIsIP);
      const encodedASCIIHost = resolvedHost && resolvedHost.indexOf("%") !== -1 && !/\P{ASCII}/u.test(resolvedHost);
      if (resolved.error && !encodedASCIIHost) {
        throw new Error(resolved.error);
      }
      schemelessOptions.skipEscape = true;
      return serialize(resolved, schemelessOptions);
    }
    function resolveComponent(base, relative2, options, skipNormalization) {
      const target = {};
      if (!skipNormalization) {
        base = parse(serialize(base, options), options);
        relative2 = parse(serialize(relative2, options), options);
      }
      options = options || {};
      if (!options.tolerant && relative2.scheme) {
        target.scheme = relative2.scheme;
        target.userinfo = relative2.userinfo;
        target.host = relative2.host;
        target.port = relative2.port;
        target.path = removeDotSegments(relative2.path || "");
        target.query = relative2.query;
      } else {
        if (relative2.userinfo !== void 0 || relative2.host !== void 0 || relative2.port !== void 0) {
          target.userinfo = relative2.userinfo;
          target.host = relative2.host;
          target.port = relative2.port;
          target.path = removeDotSegments(relative2.path || "");
          target.query = relative2.query;
        } else {
          if (!relative2.path) {
            target.path = base.path;
            if (relative2.query !== void 0) {
              target.query = relative2.query;
            } else {
              target.query = base.query;
            }
          } else {
            if (relative2.path[0] === "/") {
              target.path = removeDotSegments(relative2.path);
            } else {
              if ((base.userinfo !== void 0 || base.host !== void 0 || base.port !== void 0) && !base.path) {
                target.path = "/" + relative2.path;
              } else if (!base.path) {
                target.path = relative2.path;
              } else {
                target.path = base.path.slice(0, base.path.lastIndexOf("/") + 1) + relative2.path;
              }
              target.path = removeDotSegments(target.path);
            }
            target.query = relative2.query;
          }
          target.userinfo = base.userinfo;
          target.host = base.host;
          target.port = base.port;
        }
        target.scheme = base.scheme;
      }
      target.fragment = relative2.fragment;
      return target;
    }
    function equal(uriA, uriB, options) {
      const normalizedA = normalizeComparableURI(uriA, options);
      const normalizedB = normalizeComparableURI(uriB, options);
      return normalizedA !== void 0 && normalizedB !== void 0 && normalizedA === normalizedB;
    }
    function serialize(cmpts, opts) {
      const component = {
        host: cmpts.host,
        scheme: cmpts.scheme,
        userinfo: cmpts.userinfo,
        port: cmpts.port,
        path: cmpts.path,
        query: cmpts.query,
        nid: cmpts.nid,
        nss: cmpts.nss,
        uuid: cmpts.uuid,
        fragment: cmpts.fragment,
        reference: cmpts.reference,
        resourceName: cmpts.resourceName,
        secure: cmpts.secure,
        error: ""
      };
      const options = Object.assign({}, opts);
      const uriTokens = [];
      if (component.scheme) {
        component.scheme = decodeValidScheme(component.scheme);
      }
      const schemeHandler = getSchemeHandler(options.scheme || component.scheme);
      if (schemeHandler && schemeHandler.serialize) schemeHandler.serialize(component, options);
      const hasAuthority = component.userinfo !== void 0 || component.host !== void 0 || component.port !== void 0;
      const pathNoScheme = !options.skipEscape && component.scheme === void 0 && !hasAuthority;
      if (component.path !== void 0) {
        if (!options.skipEscape) {
          component.path = serializePathEncoding(component.path, pathNoScheme);
        } else {
          component.path = normalizePercentEncoding(component.path);
        }
      }
      if (options.reference !== "suffix" && component.scheme) {
        component.scheme = decodeValidScheme(component.scheme);
        uriTokens.push(component.scheme, ":");
      }
      const authority = recomposeAuthority(component);
      if (authority !== void 0) {
        if (options.reference !== "suffix") {
          uriTokens.push("//");
        }
        uriTokens.push(authority);
        if (component.path && component.path[0] !== "/") {
          uriTokens.push("/");
        }
      }
      if (component.path !== void 0) {
        let s = component.path;
        if (!options.absolutePath && (!schemeHandler || !schemeHandler.absolutePath)) {
          s = removeDotSegments(s);
        }
        if (pathNoScheme) {
          s = serializePathEncoding(s, true);
        }
        if (authority === void 0 && s[0] === "/" && s[1] === "/") {
          s = "/%2F" + s.slice(2);
        }
        uriTokens.push(s);
      }
      if (component.query !== void 0) {
        uriTokens.push("?", encodeQuery(component.query));
      }
      if (component.fragment !== void 0) {
        uriTokens.push("#", encodeFragment(component.fragment));
      }
      return uriTokens.join("");
    }
    var URI_PARSE = /^(?:([^#/:?]+):)?(?:\/\/((?:([^#/?@]*)@)?(\[[^#/?\]]+\]|[^#/:?]*)(?::(\d*))?))?([^#?]*)(?:\?([^#]*))?(?:#((?:.|[\n\r])*))?/u;
    var AUTHORITY_PREFIX = /^(?:[^#/:?]+:)?\/\/([^/?#]*)/;
    var AUTHORITY_INTRODUCER_REGION = /^(?:[^#/:?]+:)?([/\\\t\n\r]*)/;
    function getParseError(parsed, matches) {
      if (matches[2] !== void 0 && parsed.path && parsed.path[0] !== "/") {
        return 'URI path must start with "/" when authority is present.';
      }
      if (typeof parsed.port === "number" && (parsed.port < 0 || parsed.port > 65535)) {
        return "URI port is malformed.";
      }
      return void 0;
    }
    function hasMalformedPercentEncoding(component) {
      if (component === void 0) return false;
      let percent = component.indexOf("%");
      while (percent !== -1) {
        if (percent + 2 >= component.length || !/^[\da-f]{2}$/iu.test(component.slice(percent + 1, percent + 3))) {
          return true;
        }
        percent = component.indexOf("%", percent + 3);
      }
      return false;
    }
    function isIPLiteral(host) {
      return host[0] === "[" && host[host.length - 1] === "]";
    }
    function hasMalformedComponentPercentEncoding(matches) {
      const host = matches[4];
      return hasMalformedPercentEncoding(matches[3]) || host !== void 0 && !isIPLiteral(host) && hasMalformedPercentEncoding(host) || hasMalformedPercentEncoding(matches[6]) || hasMalformedPercentEncoding(matches[7]) || hasMalformedPercentEncoding(matches[8]);
    }
    function canonicalizeHost(parsed, options, schemeHandler, isIP) {
      if (!options.unicodeSupport && (!schemeHandler || !schemeHandler.unicodeSupport) && parsed.host && !isIPLiteral(parsed.host) && (options.domainHost || schemeHandler && schemeHandler.domainHost) && isIP === false && nonSimpleDomain(parsed.host)) {
        try {
          parsed.host = new URL("http://" + parsed.host).hostname;
        } catch (e) {
          parsed.error = parsed.error || "Host's domain name can not be converted to ASCII: " + e;
          return true;
        }
      }
      return false;
    }
    function parseWithStatus(uri, opts) {
      const options = Object.assign({}, opts);
      const parsed = {
        scheme: void 0,
        userinfo: void 0,
        host: "",
        port: void 0,
        path: "",
        query: void 0,
        fragment: void 0
      };
      let malformedAuthorityOrPort = false;
      let malformedPercentEncoding = false;
      let malformedSchemeSpecific = false;
      let malformedHost = false;
      let malformedIPLiteral = false;
      let malformedScheme = false;
      let isIP = false;
      if (options.reference === "suffix") {
        if (options.scheme) {
          uri = options.scheme + ":" + uri;
        } else {
          uri = "//" + uri;
        }
      }
      const authorityMatch = uri.match(AUTHORITY_PREFIX);
      if (authorityMatch !== null && authorityMatch[1].indexOf("\\") !== -1) {
        parsed.error = "URI authority must not contain a literal backslash.";
        malformedAuthorityOrPort = true;
      }
      const introducerMatch = uri.match(AUTHORITY_INTRODUCER_REGION);
      if (introducerMatch !== null) {
        const region = introducerMatch[1];
        const normalizedRegion = region.replace(/[\t\n\r]/g, "");
        if (normalizedRegion.length >= 2) {
          if (normalizedRegion.slice(0, 2) !== "//") {
            parsed.error = parsed.error || "URI authority must not contain a literal backslash.";
            malformedAuthorityOrPort = true;
          } else if (region.length !== normalizedRegion.length) {
            parsed.error = parsed.error || "URI authority introducer must not contain whitespace.";
            malformedAuthorityOrPort = true;
          }
        }
      }
      const matches = uri.match(URI_PARSE);
      if (matches) {
        parsed.scheme = matches[1];
        parsed.userinfo = matches[3];
        parsed.host = matches[4];
        parsed.port = parseInt(matches[5], 10);
        parsed.path = matches[6] || "";
        parsed.query = matches[7];
        parsed.fragment = matches[8];
        if (parsed.scheme !== void 0) {
          const decodedScheme = unescape(parsed.scheme);
          if (VALID_SCHEME.test(decodedScheme)) {
            parsed.scheme = decodedScheme.toLowerCase();
          } else {
            parsed.error = parsed.error || MALFORMED_SCHEME_ERROR;
            malformedScheme = true;
          }
        }
        malformedPercentEncoding = hasMalformedComponentPercentEncoding(matches);
        if (malformedPercentEncoding) {
          parsed.error = parsed.error || "URI contains malformed percent-encoding.";
        }
        if (isNaN(parsed.port)) {
          parsed.port = matches[5];
        }
        const parseError = getParseError(parsed, matches);
        if (parseError !== void 0) {
          parsed.error = parsed.error || parseError;
          malformedAuthorityOrPort = true;
        }
        if (parsed.host) {
          const ipv4result = isIPv4(parsed.host);
          if (ipv4result === false) {
            const bracketedIPLiteral = isIPLiteral(parsed.host);
            const hasIPLiteralBracket = parsed.host.indexOf("[") !== -1 || parsed.host.indexOf("]") !== -1;
            const ipv6result = normalizeIPv6(parsed.host);
            isIP = ipv6result.isIPV6 || ipv6result.isIPVFuture === true;
            malformedIPLiteral = hasIPLiteralBracket && (!bracketedIPLiteral || ipv6result.error === true);
            parsed.host = isIP ? ipv6result.host : ipv6result.host.toLowerCase();
            if (malformedIPLiteral) {
              parsed.error = parsed.error || "URI host is malformed.";
              malformedAuthorityOrPort = true;
            }
          } else {
            isIP = true;
          }
        }
        if (parsed.scheme === void 0 && parsed.userinfo === void 0 && parsed.host === void 0 && parsed.port === void 0 && parsed.query === void 0 && !parsed.path) {
          parsed.reference = "same-document";
        } else if (parsed.scheme === void 0) {
          parsed.reference = "relative";
        } else if (parsed.fragment === void 0) {
          parsed.reference = "absolute";
        } else {
          parsed.reference = "uri";
        }
        if (options.reference && options.reference !== "suffix" && options.reference !== parsed.reference) {
          parsed.error = parsed.error || "URI is not a " + options.reference + " reference.";
        }
        const schemeHandler = getSchemeHandler(options.scheme || parsed.scheme);
        if (!malformedIPLiteral) {
          malformedHost = canonicalizeHost(parsed, options, schemeHandler, isIP);
        }
        if (uri.indexOf("%") !== -1 && parsed.host !== void 0 && !malformedIPLiteral) {
          let host = isIP ? parsed.host : normalizePercentEncoding(parsed.host, true);
          if (!isIP) {
            host = normalizePercentEncoding(host.toLowerCase());
          }
          parsed.host = reescapeHostDelimiters(host, isIP);
        }
        if (!schemeHandler || schemeHandler && !schemeHandler.skipNormalize) {
          if (parsed.path) {
            parsed.path = normalizePathEncoding(parsed.path);
          }
          if (parsed.query) {
            parsed.query = normalizeQueryFragmentEncoding(parsed.query);
          }
          if (parsed.fragment) {
            parsed.fragment = normalizeQueryFragmentEncoding(parsed.fragment);
          }
        }
        if (schemeHandler && schemeHandler.parse) {
          schemeHandler.parse(parsed, options);
          if (schemeHandler === SCHEMES.urn && parsed.nid === void 0) {
            malformedSchemeSpecific = true;
          }
        }
      } else {
        parsed.error = parsed.error || "URI can not be parsed.";
      }
      return { parsed, malformedAuthorityOrPort, malformedPercentEncoding, malformedSchemeSpecific, malformedHost, malformedScheme };
    }
    function parse(uri, opts) {
      return parseWithStatus(uri, opts).parsed;
    }
    function normalizeString(uri, opts) {
      return normalizeStringWithStatus(uri, opts).normalized;
    }
    function normalizeStringWithStatus(uri, opts) {
      const { parsed, malformedAuthorityOrPort, malformedPercentEncoding, malformedSchemeSpecific, malformedHost, malformedScheme } = parseWithStatus(uri, opts);
      return {
        normalized: malformedAuthorityOrPort || malformedPercentEncoding || malformedSchemeSpecific || malformedHost || malformedScheme ? uri : serialize(parsed, opts),
        malformedAuthorityOrPort,
        malformedPercentEncoding,
        malformedSchemeSpecific,
        malformedHost,
        malformedScheme
      };
    }
    function normalizeComparableURI(uri, opts) {
      if (typeof uri !== "string" && typeof uri !== "object") {
        return void 0;
      }
      let value;
      try {
        value = typeof uri === "string" ? uri : serialize(uri, opts);
      } catch {
        return void 0;
      }
      const { normalized, malformedAuthorityOrPort, malformedPercentEncoding, malformedSchemeSpecific, malformedHost, malformedScheme } = normalizeStringWithStatus(value, opts);
      return malformedAuthorityOrPort || malformedPercentEncoding || malformedSchemeSpecific || malformedHost || malformedScheme ? void 0 : normalized;
    }
    var fastUri = {
      SCHEMES,
      normalize: normalize2,
      resolve: resolve2,
      resolveComponent,
      equal,
      serialize,
      parse
    };
    module2.exports = fastUri;
    module2.exports.default = fastUri;
    module2.exports.fastUri = fastUri;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/runtime/uri.js
var require_uri = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/runtime/uri.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var uri = require_fast_uri();
    uri.code = 'require("ajv/dist/runtime/uri").default';
    exports2.default = uri;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/core.js
var require_core = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/core.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.CodeGen = exports2.Name = exports2.nil = exports2.stringify = exports2.str = exports2._ = exports2.KeywordCxt = void 0;
    var validate_1 = require_validate();
    Object.defineProperty(exports2, "KeywordCxt", { enumerable: true, get: function() {
      return validate_1.KeywordCxt;
    } });
    var codegen_1 = require_codegen();
    Object.defineProperty(exports2, "_", { enumerable: true, get: function() {
      return codegen_1._;
    } });
    Object.defineProperty(exports2, "str", { enumerable: true, get: function() {
      return codegen_1.str;
    } });
    Object.defineProperty(exports2, "stringify", { enumerable: true, get: function() {
      return codegen_1.stringify;
    } });
    Object.defineProperty(exports2, "nil", { enumerable: true, get: function() {
      return codegen_1.nil;
    } });
    Object.defineProperty(exports2, "Name", { enumerable: true, get: function() {
      return codegen_1.Name;
    } });
    Object.defineProperty(exports2, "CodeGen", { enumerable: true, get: function() {
      return codegen_1.CodeGen;
    } });
    var validation_error_1 = require_validation_error();
    var ref_error_1 = require_ref_error();
    var rules_1 = require_rules();
    var compile_1 = require_compile();
    var codegen_2 = require_codegen();
    var resolve_1 = require_resolve();
    var dataType_1 = require_dataType();
    var util_1 = require_util();
    var $dataRefSchema = require_data();
    var uri_1 = require_uri();
    var defaultRegExp = (str, flags) => new RegExp(str, flags);
    defaultRegExp.code = "new RegExp";
    var META_IGNORE_OPTIONS = ["removeAdditional", "useDefaults", "coerceTypes"];
    var EXT_SCOPE_NAMES = /* @__PURE__ */ new Set([
      "validate",
      "serialize",
      "parse",
      "wrapper",
      "root",
      "schema",
      "keyword",
      "pattern",
      "formats",
      "validate$data",
      "func",
      "obj",
      "Error"
    ]);
    var removedOptions = {
      errorDataPath: "",
      format: "`validateFormats: false` can be used instead.",
      nullable: '"nullable" keyword is supported by default.',
      jsonPointers: "Deprecated jsPropertySyntax can be used instead.",
      extendRefs: "Deprecated ignoreKeywordsWithRef can be used instead.",
      missingRefs: "Pass empty schema with $id that should be ignored to ajv.addSchema.",
      processCode: "Use option `code: {process: (code, schemaEnv: object) => string}`",
      sourceCode: "Use option `code: {source: true}`",
      strictDefaults: "It is default now, see option `strict`.",
      strictKeywords: "It is default now, see option `strict`.",
      uniqueItems: '"uniqueItems" keyword is always validated.',
      unknownFormats: "Disable strict mode or pass `true` to `ajv.addFormat` (or `formats` option).",
      cache: "Map is used as cache, schema object as key.",
      serialize: "Map is used as cache, schema object as key.",
      ajvErrors: "It is default now."
    };
    var deprecatedOptions = {
      ignoreKeywordsWithRef: "",
      jsPropertySyntax: "",
      unicode: '"minLength"/"maxLength" account for unicode characters by default.'
    };
    var MAX_EXPRESSION = 200;
    function requiredOptions(o) {
      var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0;
      const s = o.strict;
      const _optz = (_a = o.code) === null || _a === void 0 ? void 0 : _a.optimize;
      const optimize = _optz === true || _optz === void 0 ? 1 : _optz || 0;
      const regExp = (_c = (_b = o.code) === null || _b === void 0 ? void 0 : _b.regExp) !== null && _c !== void 0 ? _c : defaultRegExp;
      const uriResolver = (_d = o.uriResolver) !== null && _d !== void 0 ? _d : uri_1.default;
      return {
        strictSchema: (_f = (_e = o.strictSchema) !== null && _e !== void 0 ? _e : s) !== null && _f !== void 0 ? _f : true,
        strictNumbers: (_h = (_g = o.strictNumbers) !== null && _g !== void 0 ? _g : s) !== null && _h !== void 0 ? _h : true,
        strictTypes: (_k = (_j = o.strictTypes) !== null && _j !== void 0 ? _j : s) !== null && _k !== void 0 ? _k : "log",
        strictTuples: (_m = (_l = o.strictTuples) !== null && _l !== void 0 ? _l : s) !== null && _m !== void 0 ? _m : "log",
        strictRequired: (_p = (_o = o.strictRequired) !== null && _o !== void 0 ? _o : s) !== null && _p !== void 0 ? _p : false,
        code: o.code ? { ...o.code, optimize, regExp } : { optimize, regExp },
        loopRequired: (_q = o.loopRequired) !== null && _q !== void 0 ? _q : MAX_EXPRESSION,
        loopEnum: (_r = o.loopEnum) !== null && _r !== void 0 ? _r : MAX_EXPRESSION,
        meta: (_s = o.meta) !== null && _s !== void 0 ? _s : true,
        messages: (_t = o.messages) !== null && _t !== void 0 ? _t : true,
        inlineRefs: (_u = o.inlineRefs) !== null && _u !== void 0 ? _u : true,
        schemaId: (_v = o.schemaId) !== null && _v !== void 0 ? _v : "$id",
        addUsedSchema: (_w = o.addUsedSchema) !== null && _w !== void 0 ? _w : true,
        validateSchema: (_x = o.validateSchema) !== null && _x !== void 0 ? _x : true,
        validateFormats: (_y = o.validateFormats) !== null && _y !== void 0 ? _y : true,
        unicodeRegExp: (_z = o.unicodeRegExp) !== null && _z !== void 0 ? _z : true,
        int32range: (_0 = o.int32range) !== null && _0 !== void 0 ? _0 : true,
        uriResolver
      };
    }
    var Ajv2 = class {
      constructor(opts = {}) {
        this.schemas = {};
        this.refs = {};
        this.formats = /* @__PURE__ */ Object.create(null);
        this._compilations = /* @__PURE__ */ new Set();
        this._loading = {};
        this._cache = /* @__PURE__ */ new Map();
        opts = this.opts = { ...opts, ...requiredOptions(opts) };
        const { es5, lines } = this.opts.code;
        this.scope = new codegen_2.ValueScope({ scope: {}, prefixes: EXT_SCOPE_NAMES, es5, lines });
        this.logger = getLogger(opts.logger);
        const formatOpt = opts.validateFormats;
        opts.validateFormats = false;
        this.RULES = (0, rules_1.getRules)();
        checkOptions.call(this, removedOptions, opts, "NOT SUPPORTED");
        checkOptions.call(this, deprecatedOptions, opts, "DEPRECATED", "warn");
        this._metaOpts = getMetaSchemaOptions.call(this);
        if (opts.formats)
          addInitialFormats.call(this);
        this._addVocabularies();
        this._addDefaultMetaSchema();
        if (opts.keywords)
          addInitialKeywords.call(this, opts.keywords);
        if (typeof opts.meta == "object")
          this.addMetaSchema(opts.meta);
        addInitialSchemas.call(this);
        opts.validateFormats = formatOpt;
      }
      _addVocabularies() {
        this.addKeyword("$async");
      }
      _addDefaultMetaSchema() {
        const { $data, meta, schemaId } = this.opts;
        let _dataRefSchema = $dataRefSchema;
        if (schemaId === "id") {
          _dataRefSchema = { ...$dataRefSchema };
          _dataRefSchema.id = _dataRefSchema.$id;
          delete _dataRefSchema.$id;
        }
        if (meta && $data)
          this.addMetaSchema(_dataRefSchema, _dataRefSchema[schemaId], false);
      }
      defaultMeta() {
        const { meta, schemaId } = this.opts;
        return this.opts.defaultMeta = typeof meta == "object" ? meta[schemaId] || meta : void 0;
      }
      validate(schemaKeyRef, data) {
        let v;
        if (typeof schemaKeyRef == "string") {
          v = this.getSchema(schemaKeyRef);
          if (!v)
            throw new Error(`no schema with key or ref "${schemaKeyRef}"`);
        } else {
          v = this.compile(schemaKeyRef);
        }
        const valid = v(data);
        if (!("$async" in v))
          this.errors = v.errors;
        return valid;
      }
      compile(schema, _meta) {
        const sch = this._addSchema(schema, _meta);
        return sch.validate || this._compileSchemaEnv(sch);
      }
      compileAsync(schema, meta) {
        if (typeof this.opts.loadSchema != "function") {
          throw new Error("options.loadSchema should be a function");
        }
        const { loadSchema } = this.opts;
        return runCompileAsync.call(this, schema, meta);
        async function runCompileAsync(_schema, _meta) {
          await loadMetaSchema.call(this, _schema.$schema);
          const sch = this._addSchema(_schema, _meta);
          return sch.validate || _compileAsync.call(this, sch);
        }
        async function loadMetaSchema($ref) {
          if ($ref && !this.getSchema($ref)) {
            await runCompileAsync.call(this, { $ref }, true);
          }
        }
        async function _compileAsync(sch) {
          try {
            return this._compileSchemaEnv(sch);
          } catch (e) {
            if (!(e instanceof ref_error_1.default))
              throw e;
            checkLoaded.call(this, e);
            await loadMissingSchema.call(this, e.missingSchema);
            return _compileAsync.call(this, sch);
          }
        }
        function checkLoaded({ missingSchema: ref, missingRef }) {
          if (this.refs[ref]) {
            throw new Error(`AnySchema ${ref} is loaded but ${missingRef} cannot be resolved`);
          }
        }
        async function loadMissingSchema(ref) {
          const _schema = await _loadSchema.call(this, ref);
          if (!this.refs[ref])
            await loadMetaSchema.call(this, _schema.$schema);
          if (!this.refs[ref])
            this.addSchema(_schema, ref, meta);
        }
        async function _loadSchema(ref) {
          const p = this._loading[ref];
          if (p)
            return p;
          try {
            return await (this._loading[ref] = loadSchema(ref));
          } finally {
            delete this._loading[ref];
          }
        }
      }
      // Adds schema to the instance
      addSchema(schema, key, _meta, _validateSchema = this.opts.validateSchema) {
        if (Array.isArray(schema)) {
          for (const sch of schema)
            this.addSchema(sch, void 0, _meta, _validateSchema);
          return this;
        }
        let id;
        if (typeof schema === "object") {
          const { schemaId } = this.opts;
          id = schema[schemaId];
          if (id !== void 0 && typeof id != "string") {
            throw new Error(`schema ${schemaId} must be string`);
          }
        }
        key = (0, resolve_1.normalizeId)(key || id);
        this._checkUnique(key);
        this.schemas[key] = this._addSchema(schema, _meta, key, _validateSchema, true);
        return this;
      }
      // Add schema that will be used to validate other schemas
      // options in META_IGNORE_OPTIONS are alway set to false
      addMetaSchema(schema, key, _validateSchema = this.opts.validateSchema) {
        this.addSchema(schema, key, true, _validateSchema);
        return this;
      }
      //  Validate schema against its meta-schema
      validateSchema(schema, throwOrLogError) {
        if (typeof schema == "boolean")
          return true;
        let $schema;
        $schema = schema.$schema;
        if ($schema !== void 0 && typeof $schema != "string") {
          throw new Error("$schema must be a string");
        }
        $schema = $schema || this.opts.defaultMeta || this.defaultMeta();
        if (!$schema) {
          this.logger.warn("meta-schema not available");
          this.errors = null;
          return true;
        }
        const valid = this.validate($schema, schema);
        if (!valid && throwOrLogError) {
          const message = "schema is invalid: " + this.errorsText();
          if (this.opts.validateSchema === "log")
            this.logger.error(message);
          else
            throw new Error(message);
        }
        return valid;
      }
      // Get compiled schema by `key` or `ref`.
      // (`key` that was passed to `addSchema` or full schema reference - `schema.$id` or resolved id)
      getSchema(keyRef) {
        let sch;
        while (typeof (sch = getSchEnv.call(this, keyRef)) == "string")
          keyRef = sch;
        if (sch === void 0) {
          const { schemaId } = this.opts;
          const root = new compile_1.SchemaEnv({ schema: {}, schemaId });
          sch = compile_1.resolveSchema.call(this, root, keyRef);
          if (!sch)
            return;
          this.refs[keyRef] = sch;
        }
        return sch.validate || this._compileSchemaEnv(sch);
      }
      // Remove cached schema(s).
      // If no parameter is passed all schemas but meta-schemas are removed.
      // If RegExp is passed all schemas with key/id matching pattern but meta-schemas are removed.
      // Even if schema is referenced by other schemas it still can be removed as other schemas have local references.
      removeSchema(schemaKeyRef) {
        if (schemaKeyRef instanceof RegExp) {
          this._removeAllSchemas(this.schemas, schemaKeyRef);
          this._removeAllSchemas(this.refs, schemaKeyRef);
          return this;
        }
        switch (typeof schemaKeyRef) {
          case "undefined":
            this._removeAllSchemas(this.schemas);
            this._removeAllSchemas(this.refs);
            this._cache.clear();
            return this;
          case "string": {
            const sch = getSchEnv.call(this, schemaKeyRef);
            if (typeof sch == "object")
              this._cache.delete(sch.schema);
            delete this.schemas[schemaKeyRef];
            delete this.refs[schemaKeyRef];
            return this;
          }
          case "object": {
            const cacheKey = schemaKeyRef;
            this._cache.delete(cacheKey);
            let id = schemaKeyRef[this.opts.schemaId];
            if (id) {
              id = (0, resolve_1.normalizeId)(id);
              delete this.schemas[id];
              delete this.refs[id];
            }
            return this;
          }
          default:
            throw new Error("ajv.removeSchema: invalid parameter");
        }
      }
      // add "vocabulary" - a collection of keywords
      addVocabulary(definitions) {
        for (const def of definitions)
          this.addKeyword(def);
        return this;
      }
      addKeyword(kwdOrDef, def) {
        let keyword;
        if (typeof kwdOrDef == "string") {
          keyword = kwdOrDef;
          if (typeof def == "object") {
            this.logger.warn("these parameters are deprecated, see docs for addKeyword");
            def.keyword = keyword;
          }
        } else if (typeof kwdOrDef == "object" && def === void 0) {
          def = kwdOrDef;
          keyword = def.keyword;
          if (Array.isArray(keyword) && !keyword.length) {
            throw new Error("addKeywords: keyword must be string or non-empty array");
          }
        } else {
          throw new Error("invalid addKeywords parameters");
        }
        checkKeyword.call(this, keyword, def);
        if (!def) {
          (0, util_1.eachItem)(keyword, (kwd) => addRule.call(this, kwd));
          return this;
        }
        keywordMetaschema.call(this, def);
        const definition = {
          ...def,
          type: (0, dataType_1.getJSONTypes)(def.type),
          schemaType: (0, dataType_1.getJSONTypes)(def.schemaType)
        };
        (0, util_1.eachItem)(keyword, definition.type.length === 0 ? (k) => addRule.call(this, k, definition) : (k) => definition.type.forEach((t) => addRule.call(this, k, definition, t)));
        return this;
      }
      getKeyword(keyword) {
        const rule = this.RULES.all[keyword];
        return typeof rule == "object" ? rule.definition : !!rule;
      }
      // Remove keyword
      removeKeyword(keyword) {
        const { RULES } = this;
        delete RULES.keywords[keyword];
        delete RULES.all[keyword];
        for (const group of RULES.rules) {
          const i = group.rules.findIndex((rule) => rule.keyword === keyword);
          if (i >= 0)
            group.rules.splice(i, 1);
        }
        return this;
      }
      // Add format
      addFormat(name, format) {
        if (typeof format == "string")
          format = new RegExp(format);
        this.formats[name] = format;
        return this;
      }
      errorsText(errors = this.errors, { separator = ", ", dataVar = "data" } = {}) {
        if (!errors || errors.length === 0)
          return "No errors";
        return errors.map((e) => `${dataVar}${e.instancePath} ${e.message}`).reduce((text, msg) => text + separator + msg);
      }
      $dataMetaSchema(metaSchema, keywordsJsonPointers) {
        const rules = this.RULES.all;
        metaSchema = JSON.parse(JSON.stringify(metaSchema));
        for (const jsonPointer of keywordsJsonPointers) {
          const segments = jsonPointer.split("/").slice(1);
          let keywords = metaSchema;
          for (const seg of segments)
            keywords = keywords[seg];
          for (const key in rules) {
            const rule = rules[key];
            if (typeof rule != "object")
              continue;
            const { $data } = rule.definition;
            const schema = keywords[key];
            if ($data && schema)
              keywords[key] = schemaOrData(schema);
          }
        }
        return metaSchema;
      }
      _removeAllSchemas(schemas, regex) {
        for (const keyRef in schemas) {
          const sch = schemas[keyRef];
          if (!regex || regex.test(keyRef)) {
            if (typeof sch == "string") {
              delete schemas[keyRef];
            } else if (sch && !sch.meta) {
              this._cache.delete(sch.schema);
              delete schemas[keyRef];
            }
          }
        }
      }
      _addSchema(schema, meta, baseId, validateSchema = this.opts.validateSchema, addSchema = this.opts.addUsedSchema) {
        let id;
        const { schemaId } = this.opts;
        if (typeof schema == "object") {
          id = schema[schemaId];
        } else {
          if (this.opts.jtd)
            throw new Error("schema must be object");
          else if (typeof schema != "boolean")
            throw new Error("schema must be object or boolean");
        }
        let sch = this._cache.get(schema);
        if (sch !== void 0)
          return sch;
        baseId = (0, resolve_1.normalizeId)(id || baseId);
        const localRefs = resolve_1.getSchemaRefs.call(this, schema, baseId);
        sch = new compile_1.SchemaEnv({ schema, schemaId, meta, baseId, localRefs });
        this._cache.set(sch.schema, sch);
        if (addSchema && !baseId.startsWith("#")) {
          if (baseId)
            this._checkUnique(baseId);
          this.refs[baseId] = sch;
        }
        if (validateSchema)
          this.validateSchema(schema, true);
        return sch;
      }
      _checkUnique(id) {
        if (this.schemas[id] || this.refs[id]) {
          throw new Error(`schema with key or id "${id}" already exists`);
        }
      }
      _compileSchemaEnv(sch) {
        if (sch.meta)
          this._compileMetaSchema(sch);
        else
          compile_1.compileSchema.call(this, sch);
        if (!sch.validate)
          throw new Error("ajv implementation error");
        return sch.validate;
      }
      _compileMetaSchema(sch) {
        const currentOpts = this.opts;
        this.opts = this._metaOpts;
        try {
          compile_1.compileSchema.call(this, sch);
        } finally {
          this.opts = currentOpts;
        }
      }
    };
    Ajv2.ValidationError = validation_error_1.default;
    Ajv2.MissingRefError = ref_error_1.default;
    exports2.default = Ajv2;
    function checkOptions(checkOpts, options, msg, log = "error") {
      for (const key in checkOpts) {
        const opt = key;
        if (opt in options)
          this.logger[log](`${msg}: option ${key}. ${checkOpts[opt]}`);
      }
    }
    function getSchEnv(keyRef) {
      keyRef = (0, resolve_1.normalizeId)(keyRef);
      return this.schemas[keyRef] || this.refs[keyRef];
    }
    function addInitialSchemas() {
      const optsSchemas = this.opts.schemas;
      if (!optsSchemas)
        return;
      if (Array.isArray(optsSchemas))
        this.addSchema(optsSchemas);
      else
        for (const key in optsSchemas)
          this.addSchema(optsSchemas[key], key);
    }
    function addInitialFormats() {
      for (const name in this.opts.formats) {
        const format = this.opts.formats[name];
        if (format)
          this.addFormat(name, format);
      }
    }
    function addInitialKeywords(defs) {
      if (Array.isArray(defs)) {
        this.addVocabulary(defs);
        return;
      }
      this.logger.warn("keywords option as map is deprecated, pass array");
      for (const keyword in defs) {
        const def = defs[keyword];
        if (!def.keyword)
          def.keyword = keyword;
        this.addKeyword(def);
      }
    }
    function getMetaSchemaOptions() {
      const metaOpts = { ...this.opts };
      for (const opt of META_IGNORE_OPTIONS)
        delete metaOpts[opt];
      return metaOpts;
    }
    var noLogs = { log() {
    }, warn() {
    }, error() {
    } };
    function getLogger(logger) {
      if (logger === false)
        return noLogs;
      if (logger === void 0)
        return console;
      if (logger.log && logger.warn && logger.error)
        return logger;
      throw new Error("logger must implement log, warn and error methods");
    }
    var KEYWORD_NAME = /^[a-z_$][a-z0-9_$:-]*$/i;
    function checkKeyword(keyword, def) {
      const { RULES } = this;
      (0, util_1.eachItem)(keyword, (kwd) => {
        if (RULES.keywords[kwd])
          throw new Error(`Keyword ${kwd} is already defined`);
        if (!KEYWORD_NAME.test(kwd))
          throw new Error(`Keyword ${kwd} has invalid name`);
      });
      if (!def)
        return;
      if (def.$data && !("code" in def || "validate" in def)) {
        throw new Error('$data keyword must have "code" or "validate" function');
      }
    }
    function addRule(keyword, definition, dataType) {
      var _a;
      const post = definition === null || definition === void 0 ? void 0 : definition.post;
      if (dataType && post)
        throw new Error('keyword with "post" flag cannot have "type"');
      const { RULES } = this;
      let ruleGroup = post ? RULES.post : RULES.rules.find(({ type: t }) => t === dataType);
      if (!ruleGroup) {
        ruleGroup = { type: dataType, rules: [] };
        RULES.rules.push(ruleGroup);
      }
      RULES.keywords[keyword] = true;
      if (!definition)
        return;
      const rule = {
        keyword,
        definition: {
          ...definition,
          type: (0, dataType_1.getJSONTypes)(definition.type),
          schemaType: (0, dataType_1.getJSONTypes)(definition.schemaType)
        }
      };
      if (definition.before)
        addBeforeRule.call(this, ruleGroup, rule, definition.before);
      else
        ruleGroup.rules.push(rule);
      RULES.all[keyword] = rule;
      (_a = definition.implements) === null || _a === void 0 ? void 0 : _a.forEach((kwd) => this.addKeyword(kwd));
    }
    function addBeforeRule(ruleGroup, rule, before) {
      const i = ruleGroup.rules.findIndex((_rule) => _rule.keyword === before);
      if (i >= 0) {
        ruleGroup.rules.splice(i, 0, rule);
      } else {
        ruleGroup.rules.push(rule);
        this.logger.warn(`rule ${before} is not defined`);
      }
    }
    function keywordMetaschema(def) {
      let { metaSchema } = def;
      if (metaSchema === void 0)
        return;
      if (def.$data && this.opts.$data)
        metaSchema = schemaOrData(metaSchema);
      def.validateSchema = this.compile(metaSchema, true);
    }
    var $dataRef = {
      $ref: "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#"
    };
    function schemaOrData(schema) {
      return { anyOf: [schema, $dataRef] };
    }
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/core/id.js
var require_id = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/core/id.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var def = {
      keyword: "id",
      code() {
        throw new Error('NOT SUPPORTED: keyword "id", use "$id" for schema ID');
      }
    };
    exports2.default = def;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/core/ref.js
var require_ref = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/core/ref.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.callRef = exports2.getValidate = void 0;
    var ref_error_1 = require_ref_error();
    var code_1 = require_code2();
    var codegen_1 = require_codegen();
    var names_1 = require_names();
    var compile_1 = require_compile();
    var util_1 = require_util();
    var def = {
      keyword: "$ref",
      schemaType: "string",
      code(cxt) {
        const { gen, schema: $ref, it } = cxt;
        const { baseId, schemaEnv: env, validateName, opts, self } = it;
        const { root } = env;
        if (($ref === "#" || $ref === "#/") && baseId === root.baseId)
          return callRootRef();
        const schOrEnv = compile_1.resolveRef.call(self, root, baseId, $ref);
        if (schOrEnv === void 0)
          throw new ref_error_1.default(it.opts.uriResolver, baseId, $ref);
        if (schOrEnv instanceof compile_1.SchemaEnv)
          return callValidate(schOrEnv);
        return inlineRefSchema(schOrEnv);
        function callRootRef() {
          if (env === root)
            return callRef(cxt, validateName, env, env.$async);
          const rootName = gen.scopeValue("root", { ref: root });
          return callRef(cxt, (0, codegen_1._)`${rootName}.validate`, root, root.$async);
        }
        function callValidate(sch) {
          const v = getValidate(cxt, sch);
          callRef(cxt, v, sch, sch.$async);
        }
        function inlineRefSchema(sch) {
          const schName = gen.scopeValue("schema", opts.code.source === true ? { ref: sch, code: (0, codegen_1.stringify)(sch) } : { ref: sch });
          const valid = gen.name("valid");
          const schCxt = cxt.subschema({
            schema: sch,
            dataTypes: [],
            schemaPath: codegen_1.nil,
            topSchemaRef: schName,
            errSchemaPath: $ref
          }, valid);
          cxt.mergeEvaluated(schCxt);
          cxt.ok(valid);
        }
      }
    };
    function getValidate(cxt, sch) {
      const { gen } = cxt;
      return sch.validate ? gen.scopeValue("validate", { ref: sch.validate }) : (0, codegen_1._)`${gen.scopeValue("wrapper", { ref: sch })}.validate`;
    }
    exports2.getValidate = getValidate;
    function callRef(cxt, v, sch, $async) {
      const { gen, it } = cxt;
      const { allErrors, schemaEnv: env, opts } = it;
      const passCxt = opts.passContext ? names_1.default.this : codegen_1.nil;
      if ($async)
        callAsyncRef();
      else
        callSyncRef();
      function callAsyncRef() {
        if (!env.$async)
          throw new Error("async schema referenced by sync schema");
        const valid = gen.let("valid");
        gen.try(() => {
          gen.code((0, codegen_1._)`await ${(0, code_1.callValidateCode)(cxt, v, passCxt)}`);
          addEvaluatedFrom(v);
          if (!allErrors)
            gen.assign(valid, true);
        }, (e) => {
          gen.if((0, codegen_1._)`!(${e} instanceof ${it.ValidationError})`, () => gen.throw(e));
          addErrorsFrom(e);
          if (!allErrors)
            gen.assign(valid, false);
        });
        cxt.ok(valid);
      }
      function callSyncRef() {
        cxt.result((0, code_1.callValidateCode)(cxt, v, passCxt), () => addEvaluatedFrom(v), () => addErrorsFrom(v));
      }
      function addErrorsFrom(source) {
        const errs = (0, codegen_1._)`${source}.errors`;
        gen.assign(names_1.default.vErrors, (0, codegen_1._)`${names_1.default.vErrors} === null ? ${errs} : ${names_1.default.vErrors}.concat(${errs})`);
        gen.assign(names_1.default.errors, (0, codegen_1._)`${names_1.default.vErrors}.length`);
      }
      function addEvaluatedFrom(source) {
        var _a;
        if (!it.opts.unevaluated)
          return;
        const schEvaluated = (_a = sch === null || sch === void 0 ? void 0 : sch.validate) === null || _a === void 0 ? void 0 : _a.evaluated;
        if (it.props !== true) {
          if (schEvaluated && !schEvaluated.dynamicProps) {
            if (schEvaluated.props !== void 0) {
              it.props = util_1.mergeEvaluated.props(gen, schEvaluated.props, it.props);
            }
          } else {
            const props = gen.var("props", (0, codegen_1._)`${source}.evaluated.props`);
            it.props = util_1.mergeEvaluated.props(gen, props, it.props, codegen_1.Name);
          }
        }
        if (it.items !== true) {
          if (schEvaluated && !schEvaluated.dynamicItems) {
            if (schEvaluated.items !== void 0) {
              it.items = util_1.mergeEvaluated.items(gen, schEvaluated.items, it.items);
            }
          } else {
            const items = gen.var("items", (0, codegen_1._)`${source}.evaluated.items`);
            it.items = util_1.mergeEvaluated.items(gen, items, it.items, codegen_1.Name);
          }
        }
      }
    }
    exports2.callRef = callRef;
    exports2.default = def;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/core/index.js
var require_core2 = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/core/index.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var id_1 = require_id();
    var ref_1 = require_ref();
    var core = [
      "$schema",
      "$id",
      "$defs",
      "$vocabulary",
      { keyword: "$comment" },
      "definitions",
      id_1.default,
      ref_1.default
    ];
    exports2.default = core;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/limitNumber.js
var require_limitNumber = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/limitNumber.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var ops = codegen_1.operators;
    var KWDs = {
      maximum: { okStr: "<=", ok: ops.LTE, fail: ops.GT },
      minimum: { okStr: ">=", ok: ops.GTE, fail: ops.LT },
      exclusiveMaximum: { okStr: "<", ok: ops.LT, fail: ops.GTE },
      exclusiveMinimum: { okStr: ">", ok: ops.GT, fail: ops.LTE }
    };
    var error = {
      message: ({ keyword, schemaCode }) => (0, codegen_1.str)`must be ${KWDs[keyword].okStr} ${schemaCode}`,
      params: ({ keyword, schemaCode }) => (0, codegen_1._)`{comparison: ${KWDs[keyword].okStr}, limit: ${schemaCode}}`
    };
    var def = {
      keyword: Object.keys(KWDs),
      type: "number",
      schemaType: "number",
      $data: true,
      error,
      code(cxt) {
        const { keyword, data, schemaCode } = cxt;
        cxt.fail$data((0, codegen_1._)`${data} ${KWDs[keyword].fail} ${schemaCode} || isNaN(${data})`);
      }
    };
    exports2.default = def;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/multipleOf.js
var require_multipleOf = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/multipleOf.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var error = {
      message: ({ schemaCode }) => (0, codegen_1.str)`must be multiple of ${schemaCode}`,
      params: ({ schemaCode }) => (0, codegen_1._)`{multipleOf: ${schemaCode}}`
    };
    var def = {
      keyword: "multipleOf",
      type: "number",
      schemaType: "number",
      $data: true,
      error,
      code(cxt) {
        const { gen, data, schemaCode, it } = cxt;
        const prec = it.opts.multipleOfPrecision;
        const res = gen.let("res");
        const invalid = prec ? (0, codegen_1._)`Math.abs(Math.round(${res}) - ${res}) > 1e-${prec}` : (0, codegen_1._)`${res} !== parseInt(${res})`;
        cxt.fail$data((0, codegen_1._)`(${schemaCode} === 0 || (${res} = ${data}/${schemaCode}, ${invalid}))`);
      }
    };
    exports2.default = def;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/runtime/ucs2length.js
var require_ucs2length = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/runtime/ucs2length.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    function ucs2length(str) {
      const len = str.length;
      let length = 0;
      let pos = 0;
      let value;
      while (pos < len) {
        length++;
        value = str.charCodeAt(pos++);
        if (value >= 55296 && value <= 56319 && pos < len) {
          value = str.charCodeAt(pos);
          if ((value & 64512) === 56320)
            pos++;
        }
      }
      return length;
    }
    exports2.default = ucs2length;
    ucs2length.code = 'require("ajv/dist/runtime/ucs2length").default';
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/limitLength.js
var require_limitLength = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/limitLength.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var ucs2length_1 = require_ucs2length();
    var error = {
      message({ keyword, schemaCode }) {
        const comp = keyword === "maxLength" ? "more" : "fewer";
        return (0, codegen_1.str)`must NOT have ${comp} than ${schemaCode} characters`;
      },
      params: ({ schemaCode }) => (0, codegen_1._)`{limit: ${schemaCode}}`
    };
    var def = {
      keyword: ["maxLength", "minLength"],
      type: "string",
      schemaType: "number",
      $data: true,
      error,
      code(cxt) {
        const { keyword, data, schemaCode, it } = cxt;
        const op = keyword === "maxLength" ? codegen_1.operators.GT : codegen_1.operators.LT;
        const len = it.opts.unicode === false ? (0, codegen_1._)`${data}.length` : (0, codegen_1._)`${(0, util_1.useFunc)(cxt.gen, ucs2length_1.default)}(${data})`;
        cxt.fail$data((0, codegen_1._)`${len} ${op} ${schemaCode}`);
      }
    };
    exports2.default = def;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/pattern.js
var require_pattern = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/pattern.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var code_1 = require_code2();
    var util_1 = require_util();
    var codegen_1 = require_codegen();
    var error = {
      message: ({ schemaCode }) => (0, codegen_1.str)`must match pattern "${schemaCode}"`,
      params: ({ schemaCode }) => (0, codegen_1._)`{pattern: ${schemaCode}}`
    };
    var def = {
      keyword: "pattern",
      type: "string",
      schemaType: "string",
      $data: true,
      error,
      code(cxt) {
        const { gen, data, $data, schema, schemaCode, it } = cxt;
        const u = it.opts.unicodeRegExp ? "u" : "";
        if ($data) {
          const { regExp } = it.opts.code;
          const regExpCode = regExp.code === "new RegExp" ? (0, codegen_1._)`new RegExp` : (0, util_1.useFunc)(gen, regExp);
          const valid = gen.let("valid");
          gen.try(() => gen.assign(valid, (0, codegen_1._)`${regExpCode}(${schemaCode}, ${u}).test(${data})`), () => gen.assign(valid, false));
          cxt.fail$data((0, codegen_1._)`!${valid}`);
        } else {
          const regExp = (0, code_1.usePattern)(cxt, schema);
          cxt.fail$data((0, codegen_1._)`!${regExp}.test(${data})`);
        }
      }
    };
    exports2.default = def;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/limitProperties.js
var require_limitProperties = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/limitProperties.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var error = {
      message({ keyword, schemaCode }) {
        const comp = keyword === "maxProperties" ? "more" : "fewer";
        return (0, codegen_1.str)`must NOT have ${comp} than ${schemaCode} properties`;
      },
      params: ({ schemaCode }) => (0, codegen_1._)`{limit: ${schemaCode}}`
    };
    var def = {
      keyword: ["maxProperties", "minProperties"],
      type: "object",
      schemaType: "number",
      $data: true,
      error,
      code(cxt) {
        const { keyword, data, schemaCode } = cxt;
        const op = keyword === "maxProperties" ? codegen_1.operators.GT : codegen_1.operators.LT;
        cxt.fail$data((0, codegen_1._)`Object.keys(${data}).length ${op} ${schemaCode}`);
      }
    };
    exports2.default = def;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/required.js
var require_required = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/required.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var code_1 = require_code2();
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var error = {
      message: ({ params: { missingProperty } }) => (0, codegen_1.str)`must have required property '${missingProperty}'`,
      params: ({ params: { missingProperty } }) => (0, codegen_1._)`{missingProperty: ${missingProperty}}`
    };
    var def = {
      keyword: "required",
      type: "object",
      schemaType: "array",
      $data: true,
      error,
      code(cxt) {
        const { gen, schema, schemaCode, data, $data, it } = cxt;
        const { opts } = it;
        if (!$data && schema.length === 0)
          return;
        const useLoop = schema.length >= opts.loopRequired;
        if (it.allErrors)
          allErrorsMode();
        else
          exitOnErrorMode();
        if (opts.strictRequired) {
          const props = cxt.parentSchema.properties;
          const { definedProperties } = cxt.it;
          for (const requiredKey of schema) {
            if ((props === null || props === void 0 ? void 0 : props[requiredKey]) === void 0 && !definedProperties.has(requiredKey)) {
              const schemaPath = it.schemaEnv.baseId + it.errSchemaPath;
              const msg = `required property "${requiredKey}" is not defined at "${schemaPath}" (strictRequired)`;
              (0, util_1.checkStrictMode)(it, msg, it.opts.strictRequired);
            }
          }
        }
        function allErrorsMode() {
          if (useLoop || $data) {
            cxt.block$data(codegen_1.nil, loopAllRequired);
          } else {
            for (const prop of schema) {
              (0, code_1.checkReportMissingProp)(cxt, prop);
            }
          }
        }
        function exitOnErrorMode() {
          const missing = gen.let("missing");
          if (useLoop || $data) {
            const valid = gen.let("valid", true);
            cxt.block$data(valid, () => loopUntilMissing(missing, valid));
            cxt.ok(valid);
          } else {
            gen.if((0, code_1.checkMissingProp)(cxt, schema, missing));
            (0, code_1.reportMissingProp)(cxt, missing);
            gen.else();
          }
        }
        function loopAllRequired() {
          gen.forOf("prop", schemaCode, (prop) => {
            cxt.setParams({ missingProperty: prop });
            gen.if((0, code_1.noPropertyInData)(gen, data, prop, opts.ownProperties), () => cxt.error());
          });
        }
        function loopUntilMissing(missing, valid) {
          cxt.setParams({ missingProperty: missing });
          gen.forOf(missing, schemaCode, () => {
            gen.assign(valid, (0, code_1.propertyInData)(gen, data, missing, opts.ownProperties));
            gen.if((0, codegen_1.not)(valid), () => {
              cxt.error();
              gen.break();
            });
          }, codegen_1.nil);
        }
      }
    };
    exports2.default = def;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/limitItems.js
var require_limitItems = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/limitItems.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var error = {
      message({ keyword, schemaCode }) {
        const comp = keyword === "maxItems" ? "more" : "fewer";
        return (0, codegen_1.str)`must NOT have ${comp} than ${schemaCode} items`;
      },
      params: ({ schemaCode }) => (0, codegen_1._)`{limit: ${schemaCode}}`
    };
    var def = {
      keyword: ["maxItems", "minItems"],
      type: "array",
      schemaType: "number",
      $data: true,
      error,
      code(cxt) {
        const { keyword, data, schemaCode } = cxt;
        const op = keyword === "maxItems" ? codegen_1.operators.GT : codegen_1.operators.LT;
        cxt.fail$data((0, codegen_1._)`${data}.length ${op} ${schemaCode}`);
      }
    };
    exports2.default = def;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/runtime/equal.js
var require_equal = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/runtime/equal.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var equal = require_fast_deep_equal();
    equal.code = 'require("ajv/dist/runtime/equal").default';
    exports2.default = equal;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/uniqueItems.js
var require_uniqueItems = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/uniqueItems.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var dataType_1 = require_dataType();
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var equal_1 = require_equal();
    var error = {
      message: ({ params: { i, j } }) => (0, codegen_1.str)`must NOT have duplicate items (items ## ${j} and ${i} are identical)`,
      params: ({ params: { i, j } }) => (0, codegen_1._)`{i: ${i}, j: ${j}}`
    };
    var def = {
      keyword: "uniqueItems",
      type: "array",
      schemaType: "boolean",
      $data: true,
      error,
      code(cxt) {
        const { gen, data, $data, schema, parentSchema, schemaCode, it } = cxt;
        if (!$data && !schema)
          return;
        const valid = gen.let("valid");
        const itemTypes = parentSchema.items ? (0, dataType_1.getSchemaTypes)(parentSchema.items) : [];
        cxt.block$data(valid, validateUniqueItems, (0, codegen_1._)`${schemaCode} === false`);
        cxt.ok(valid);
        function validateUniqueItems() {
          const i = gen.let("i", (0, codegen_1._)`${data}.length`);
          const j = gen.let("j");
          cxt.setParams({ i, j });
          gen.assign(valid, true);
          gen.if((0, codegen_1._)`${i} > 1`, () => (canOptimize() ? loopN : loopN2)(i, j));
        }
        function canOptimize() {
          return itemTypes.length > 0 && !itemTypes.some((t) => t === "object" || t === "array");
        }
        function loopN(i, j) {
          const item = gen.name("item");
          const wrongType = (0, dataType_1.checkDataTypes)(itemTypes, item, it.opts.strictNumbers, dataType_1.DataType.Wrong);
          const indices = gen.const("indices", (0, codegen_1._)`{}`);
          gen.for((0, codegen_1._)`;${i}--;`, () => {
            gen.let(item, (0, codegen_1._)`${data}[${i}]`);
            gen.if(wrongType, (0, codegen_1._)`continue`);
            if (itemTypes.length > 1)
              gen.if((0, codegen_1._)`typeof ${item} == "string"`, (0, codegen_1._)`${item} += "_"`);
            gen.if((0, codegen_1._)`typeof ${indices}[${item}] == "number"`, () => {
              gen.assign(j, (0, codegen_1._)`${indices}[${item}]`);
              cxt.error();
              gen.assign(valid, false).break();
            }).code((0, codegen_1._)`${indices}[${item}] = ${i}`);
          });
        }
        function loopN2(i, j) {
          const eql = (0, util_1.useFunc)(gen, equal_1.default);
          const outer = gen.name("outer");
          gen.label(outer).for((0, codegen_1._)`;${i}--;`, () => gen.for((0, codegen_1._)`${j} = ${i}; ${j}--;`, () => gen.if((0, codegen_1._)`${eql}(${data}[${i}], ${data}[${j}])`, () => {
            cxt.error();
            gen.assign(valid, false).break(outer);
          })));
        }
      }
    };
    exports2.default = def;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/const.js
var require_const = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/const.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var equal_1 = require_equal();
    var error = {
      message: "must be equal to constant",
      params: ({ schemaCode }) => (0, codegen_1._)`{allowedValue: ${schemaCode}}`
    };
    var def = {
      keyword: "const",
      $data: true,
      error,
      code(cxt) {
        const { gen, data, $data, schemaCode, schema } = cxt;
        if ($data || schema && typeof schema == "object") {
          cxt.fail$data((0, codegen_1._)`!${(0, util_1.useFunc)(gen, equal_1.default)}(${data}, ${schemaCode})`);
        } else {
          cxt.fail((0, codegen_1._)`${schema} !== ${data}`);
        }
      }
    };
    exports2.default = def;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/enum.js
var require_enum = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/enum.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var equal_1 = require_equal();
    var error = {
      message: "must be equal to one of the allowed values",
      params: ({ schemaCode }) => (0, codegen_1._)`{allowedValues: ${schemaCode}}`
    };
    var def = {
      keyword: "enum",
      schemaType: "array",
      $data: true,
      error,
      code(cxt) {
        const { gen, data, $data, schema, schemaCode, it } = cxt;
        if (!$data && schema.length === 0)
          throw new Error("enum must have non-empty array");
        const useLoop = schema.length >= it.opts.loopEnum;
        let eql;
        const getEql = () => eql !== null && eql !== void 0 ? eql : eql = (0, util_1.useFunc)(gen, equal_1.default);
        let valid;
        if (useLoop || $data) {
          valid = gen.let("valid");
          cxt.block$data(valid, loopEnum);
        } else {
          if (!Array.isArray(schema))
            throw new Error("ajv implementation error");
          const vSchema = gen.const("vSchema", schemaCode);
          valid = (0, codegen_1.or)(...schema.map((_x, i) => equalCode(vSchema, i)));
        }
        cxt.pass(valid);
        function loopEnum() {
          gen.assign(valid, false);
          gen.forOf("v", schemaCode, (v) => gen.if((0, codegen_1._)`${getEql()}(${data}, ${v})`, () => gen.assign(valid, true).break()));
        }
        function equalCode(vSchema, i) {
          const sch = schema[i];
          return typeof sch === "object" && sch !== null ? (0, codegen_1._)`${getEql()}(${data}, ${vSchema}[${i}])` : (0, codegen_1._)`${data} === ${sch}`;
        }
      }
    };
    exports2.default = def;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/index.js
var require_validation = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/index.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var limitNumber_1 = require_limitNumber();
    var multipleOf_1 = require_multipleOf();
    var limitLength_1 = require_limitLength();
    var pattern_1 = require_pattern();
    var limitProperties_1 = require_limitProperties();
    var required_1 = require_required();
    var limitItems_1 = require_limitItems();
    var uniqueItems_1 = require_uniqueItems();
    var const_1 = require_const();
    var enum_1 = require_enum();
    var validation = [
      // number
      limitNumber_1.default,
      multipleOf_1.default,
      // string
      limitLength_1.default,
      pattern_1.default,
      // object
      limitProperties_1.default,
      required_1.default,
      // array
      limitItems_1.default,
      uniqueItems_1.default,
      // any
      { keyword: "type", schemaType: ["string", "array"] },
      { keyword: "nullable", schemaType: "boolean" },
      const_1.default,
      enum_1.default
    ];
    exports2.default = validation;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/additionalItems.js
var require_additionalItems = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/additionalItems.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.validateAdditionalItems = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var error = {
      message: ({ params: { len } }) => (0, codegen_1.str)`must NOT have more than ${len} items`,
      params: ({ params: { len } }) => (0, codegen_1._)`{limit: ${len}}`
    };
    var def = {
      keyword: "additionalItems",
      type: "array",
      schemaType: ["boolean", "object"],
      before: "uniqueItems",
      error,
      code(cxt) {
        const { parentSchema, it } = cxt;
        const { items } = parentSchema;
        if (!Array.isArray(items)) {
          (0, util_1.checkStrictMode)(it, '"additionalItems" is ignored when "items" is not an array of schemas');
          return;
        }
        validateAdditionalItems(cxt, items);
      }
    };
    function validateAdditionalItems(cxt, items) {
      const { gen, schema, data, keyword, it } = cxt;
      it.items = true;
      const len = gen.const("len", (0, codegen_1._)`${data}.length`);
      if (schema === false) {
        cxt.setParams({ len: items.length });
        cxt.pass((0, codegen_1._)`${len} <= ${items.length}`);
      } else if (typeof schema == "object" && !(0, util_1.alwaysValidSchema)(it, schema)) {
        const valid = gen.var("valid", (0, codegen_1._)`${len} <= ${items.length}`);
        gen.if((0, codegen_1.not)(valid), () => validateItems(valid));
        cxt.ok(valid);
      }
      function validateItems(valid) {
        gen.forRange("i", items.length, len, (i) => {
          cxt.subschema({ keyword, dataProp: i, dataPropType: util_1.Type.Num }, valid);
          if (!it.allErrors)
            gen.if((0, codegen_1.not)(valid), () => gen.break());
        });
      }
    }
    exports2.validateAdditionalItems = validateAdditionalItems;
    exports2.default = def;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/items.js
var require_items = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/items.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.validateTuple = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var code_1 = require_code2();
    var def = {
      keyword: "items",
      type: "array",
      schemaType: ["object", "array", "boolean"],
      before: "uniqueItems",
      code(cxt) {
        const { schema, it } = cxt;
        if (Array.isArray(schema))
          return validateTuple(cxt, "additionalItems", schema);
        it.items = true;
        if ((0, util_1.alwaysValidSchema)(it, schema))
          return;
        cxt.ok((0, code_1.validateArray)(cxt));
      }
    };
    function validateTuple(cxt, extraItems, schArr = cxt.schema) {
      const { gen, parentSchema, data, keyword, it } = cxt;
      checkStrictTuple(parentSchema);
      if (it.opts.unevaluated && schArr.length && it.items !== true) {
        it.items = util_1.mergeEvaluated.items(gen, schArr.length, it.items);
      }
      const valid = gen.name("valid");
      const len = gen.const("len", (0, codegen_1._)`${data}.length`);
      schArr.forEach((sch, i) => {
        if ((0, util_1.alwaysValidSchema)(it, sch))
          return;
        gen.if((0, codegen_1._)`${len} > ${i}`, () => cxt.subschema({
          keyword,
          schemaProp: i,
          dataProp: i
        }, valid));
        cxt.ok(valid);
      });
      function checkStrictTuple(sch) {
        const { opts, errSchemaPath } = it;
        const l = schArr.length;
        const fullTuple = l === sch.minItems && (l === sch.maxItems || sch[extraItems] === false);
        if (opts.strictTuples && !fullTuple) {
          const msg = `"${keyword}" is ${l}-tuple, but minItems or maxItems/${extraItems} are not specified or different at path "${errSchemaPath}"`;
          (0, util_1.checkStrictMode)(it, msg, opts.strictTuples);
        }
      }
    }
    exports2.validateTuple = validateTuple;
    exports2.default = def;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/prefixItems.js
var require_prefixItems = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/prefixItems.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var items_1 = require_items();
    var def = {
      keyword: "prefixItems",
      type: "array",
      schemaType: ["array"],
      before: "uniqueItems",
      code: (cxt) => (0, items_1.validateTuple)(cxt, "items")
    };
    exports2.default = def;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/items2020.js
var require_items2020 = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/items2020.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var code_1 = require_code2();
    var additionalItems_1 = require_additionalItems();
    var error = {
      message: ({ params: { len } }) => (0, codegen_1.str)`must NOT have more than ${len} items`,
      params: ({ params: { len } }) => (0, codegen_1._)`{limit: ${len}}`
    };
    var def = {
      keyword: "items",
      type: "array",
      schemaType: ["object", "boolean"],
      before: "uniqueItems",
      error,
      code(cxt) {
        const { schema, parentSchema, it } = cxt;
        const { prefixItems } = parentSchema;
        it.items = true;
        if ((0, util_1.alwaysValidSchema)(it, schema))
          return;
        if (prefixItems)
          (0, additionalItems_1.validateAdditionalItems)(cxt, prefixItems);
        else
          cxt.ok((0, code_1.validateArray)(cxt));
      }
    };
    exports2.default = def;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/contains.js
var require_contains = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/contains.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var error = {
      message: ({ params: { min, max } }) => max === void 0 ? (0, codegen_1.str)`must contain at least ${min} valid item(s)` : (0, codegen_1.str)`must contain at least ${min} and no more than ${max} valid item(s)`,
      params: ({ params: { min, max } }) => max === void 0 ? (0, codegen_1._)`{minContains: ${min}}` : (0, codegen_1._)`{minContains: ${min}, maxContains: ${max}}`
    };
    var def = {
      keyword: "contains",
      type: "array",
      schemaType: ["object", "boolean"],
      before: "uniqueItems",
      trackErrors: true,
      error,
      code(cxt) {
        const { gen, schema, parentSchema, data, it } = cxt;
        let min;
        let max;
        const { minContains, maxContains } = parentSchema;
        if (it.opts.next) {
          min = minContains === void 0 ? 1 : minContains;
          max = maxContains;
        } else {
          min = 1;
        }
        const len = gen.const("len", (0, codegen_1._)`${data}.length`);
        cxt.setParams({ min, max });
        if (max === void 0 && min === 0) {
          (0, util_1.checkStrictMode)(it, `"minContains" == 0 without "maxContains": "contains" keyword ignored`);
          return;
        }
        if (max !== void 0 && min > max) {
          (0, util_1.checkStrictMode)(it, `"minContains" > "maxContains" is always invalid`);
          cxt.fail();
          return;
        }
        if ((0, util_1.alwaysValidSchema)(it, schema)) {
          let cond = (0, codegen_1._)`${len} >= ${min}`;
          if (max !== void 0)
            cond = (0, codegen_1._)`${cond} && ${len} <= ${max}`;
          cxt.pass(cond);
          return;
        }
        it.items = true;
        const valid = gen.name("valid");
        if (max === void 0 && min === 1) {
          validateItems(valid, () => gen.if(valid, () => gen.break()));
        } else if (min === 0) {
          gen.let(valid, true);
          if (max !== void 0)
            gen.if((0, codegen_1._)`${data}.length > 0`, validateItemsWithCount);
        } else {
          gen.let(valid, false);
          validateItemsWithCount();
        }
        cxt.result(valid, () => cxt.reset());
        function validateItemsWithCount() {
          const schValid = gen.name("_valid");
          const count = gen.let("count", 0);
          validateItems(schValid, () => gen.if(schValid, () => checkLimits(count)));
        }
        function validateItems(_valid, block) {
          gen.forRange("i", 0, len, (i) => {
            cxt.subschema({
              keyword: "contains",
              dataProp: i,
              dataPropType: util_1.Type.Num,
              compositeRule: true
            }, _valid);
            block();
          });
        }
        function checkLimits(count) {
          gen.code((0, codegen_1._)`${count}++`);
          if (max === void 0) {
            gen.if((0, codegen_1._)`${count} >= ${min}`, () => gen.assign(valid, true).break());
          } else {
            gen.if((0, codegen_1._)`${count} > ${max}`, () => gen.assign(valid, false).break());
            if (min === 1)
              gen.assign(valid, true);
            else
              gen.if((0, codegen_1._)`${count} >= ${min}`, () => gen.assign(valid, true));
          }
        }
      }
    };
    exports2.default = def;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/dependencies.js
var require_dependencies = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/dependencies.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.validateSchemaDeps = exports2.validatePropertyDeps = exports2.error = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var code_1 = require_code2();
    exports2.error = {
      message: ({ params: { property, depsCount, deps } }) => {
        const property_ies = depsCount === 1 ? "property" : "properties";
        return (0, codegen_1.str)`must have ${property_ies} ${deps} when property ${property} is present`;
      },
      params: ({ params: { property, depsCount, deps, missingProperty } }) => (0, codegen_1._)`{property: ${property},
    missingProperty: ${missingProperty},
    depsCount: ${depsCount},
    deps: ${deps}}`
      // TODO change to reference
    };
    var def = {
      keyword: "dependencies",
      type: "object",
      schemaType: "object",
      error: exports2.error,
      code(cxt) {
        const [propDeps, schDeps] = splitDependencies(cxt);
        validatePropertyDeps(cxt, propDeps);
        validateSchemaDeps(cxt, schDeps);
      }
    };
    function splitDependencies({ schema }) {
      const propertyDeps = {};
      const schemaDeps = {};
      for (const key in schema) {
        if (key === "__proto__")
          continue;
        const deps = Array.isArray(schema[key]) ? propertyDeps : schemaDeps;
        deps[key] = schema[key];
      }
      return [propertyDeps, schemaDeps];
    }
    function validatePropertyDeps(cxt, propertyDeps = cxt.schema) {
      const { gen, data, it } = cxt;
      if (Object.keys(propertyDeps).length === 0)
        return;
      const missing = gen.let("missing");
      for (const prop in propertyDeps) {
        const deps = propertyDeps[prop];
        if (deps.length === 0)
          continue;
        const hasProperty = (0, code_1.propertyInData)(gen, data, prop, it.opts.ownProperties);
        cxt.setParams({
          property: prop,
          depsCount: deps.length,
          deps: deps.join(", ")
        });
        if (it.allErrors) {
          gen.if(hasProperty, () => {
            for (const depProp of deps) {
              (0, code_1.checkReportMissingProp)(cxt, depProp);
            }
          });
        } else {
          gen.if((0, codegen_1._)`${hasProperty} && (${(0, code_1.checkMissingProp)(cxt, deps, missing)})`);
          (0, code_1.reportMissingProp)(cxt, missing);
          gen.else();
        }
      }
    }
    exports2.validatePropertyDeps = validatePropertyDeps;
    function validateSchemaDeps(cxt, schemaDeps = cxt.schema) {
      const { gen, data, keyword, it } = cxt;
      const valid = gen.name("valid");
      for (const prop in schemaDeps) {
        if ((0, util_1.alwaysValidSchema)(it, schemaDeps[prop]))
          continue;
        gen.if(
          (0, code_1.propertyInData)(gen, data, prop, it.opts.ownProperties),
          () => {
            const schCxt = cxt.subschema({ keyword, schemaProp: prop }, valid);
            cxt.mergeValidEvaluated(schCxt, valid);
          },
          () => gen.var(valid, true)
          // TODO var
        );
        cxt.ok(valid);
      }
    }
    exports2.validateSchemaDeps = validateSchemaDeps;
    exports2.default = def;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/propertyNames.js
var require_propertyNames = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/propertyNames.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var error = {
      message: "property name must be valid",
      params: ({ params }) => (0, codegen_1._)`{propertyName: ${params.propertyName}}`
    };
    var def = {
      keyword: "propertyNames",
      type: "object",
      schemaType: ["object", "boolean"],
      error,
      code(cxt) {
        const { gen, schema, data, it } = cxt;
        if ((0, util_1.alwaysValidSchema)(it, schema))
          return;
        const valid = gen.name("valid");
        gen.forIn("key", data, (key) => {
          cxt.setParams({ propertyName: key });
          cxt.subschema({
            keyword: "propertyNames",
            data: key,
            dataTypes: ["string"],
            propertyName: key,
            compositeRule: true
          }, valid);
          gen.if((0, codegen_1.not)(valid), () => {
            cxt.error(true);
            if (!it.allErrors)
              gen.break();
          });
        });
        cxt.ok(valid);
      }
    };
    exports2.default = def;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/additionalProperties.js
var require_additionalProperties = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/additionalProperties.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var code_1 = require_code2();
    var codegen_1 = require_codegen();
    var names_1 = require_names();
    var util_1 = require_util();
    var error = {
      message: "must NOT have additional properties",
      params: ({ params }) => (0, codegen_1._)`{additionalProperty: ${params.additionalProperty}}`
    };
    var def = {
      keyword: "additionalProperties",
      type: ["object"],
      schemaType: ["boolean", "object"],
      allowUndefined: true,
      trackErrors: true,
      error,
      code(cxt) {
        const { gen, schema, parentSchema, data, errsCount, it } = cxt;
        if (!errsCount)
          throw new Error("ajv implementation error");
        const { allErrors, opts } = it;
        it.props = true;
        if (opts.removeAdditional !== "all" && (0, util_1.alwaysValidSchema)(it, schema))
          return;
        const props = (0, code_1.allSchemaProperties)(parentSchema.properties);
        const patProps = (0, code_1.allSchemaProperties)(parentSchema.patternProperties);
        checkAdditionalProperties();
        cxt.ok((0, codegen_1._)`${errsCount} === ${names_1.default.errors}`);
        function checkAdditionalProperties() {
          gen.forIn("key", data, (key) => {
            if (!props.length && !patProps.length)
              additionalPropertyCode(key);
            else
              gen.if(isAdditional(key), () => additionalPropertyCode(key));
          });
        }
        function isAdditional(key) {
          let definedProp;
          if (props.length > 8) {
            const propsSchema = (0, util_1.schemaRefOrVal)(it, parentSchema.properties, "properties");
            definedProp = (0, code_1.isOwnProperty)(gen, propsSchema, key);
          } else if (props.length) {
            definedProp = (0, codegen_1.or)(...props.map((p) => (0, codegen_1._)`${key} === ${p}`));
          } else {
            definedProp = codegen_1.nil;
          }
          if (patProps.length) {
            definedProp = (0, codegen_1.or)(definedProp, ...patProps.map((p) => (0, codegen_1._)`${(0, code_1.usePattern)(cxt, p)}.test(${key})`));
          }
          return (0, codegen_1.not)(definedProp);
        }
        function deleteAdditional(key) {
          gen.code((0, codegen_1._)`delete ${data}[${key}]`);
        }
        function additionalPropertyCode(key) {
          if (opts.removeAdditional === "all" || opts.removeAdditional && schema === false) {
            deleteAdditional(key);
            return;
          }
          if (schema === false) {
            cxt.setParams({ additionalProperty: key });
            cxt.error();
            if (!allErrors)
              gen.break();
            return;
          }
          if (typeof schema == "object" && !(0, util_1.alwaysValidSchema)(it, schema)) {
            const valid = gen.name("valid");
            if (opts.removeAdditional === "failing") {
              applyAdditionalSchema(key, valid, false);
              gen.if((0, codegen_1.not)(valid), () => {
                cxt.reset();
                deleteAdditional(key);
              });
            } else {
              applyAdditionalSchema(key, valid);
              if (!allErrors)
                gen.if((0, codegen_1.not)(valid), () => gen.break());
            }
          }
        }
        function applyAdditionalSchema(key, valid, errors) {
          const subschema = {
            keyword: "additionalProperties",
            dataProp: key,
            dataPropType: util_1.Type.Str
          };
          if (errors === false) {
            Object.assign(subschema, {
              compositeRule: true,
              createErrors: false,
              allErrors: false
            });
          }
          cxt.subschema(subschema, valid);
        }
      }
    };
    exports2.default = def;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/properties.js
var require_properties = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/properties.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var validate_1 = require_validate();
    var code_1 = require_code2();
    var util_1 = require_util();
    var additionalProperties_1 = require_additionalProperties();
    var def = {
      keyword: "properties",
      type: "object",
      schemaType: "object",
      code(cxt) {
        const { gen, schema, parentSchema, data, it } = cxt;
        if (it.opts.removeAdditional === "all" && parentSchema.additionalProperties === void 0) {
          additionalProperties_1.default.code(new validate_1.KeywordCxt(it, additionalProperties_1.default, "additionalProperties"));
        }
        const allProps = (0, code_1.allSchemaProperties)(schema);
        for (const prop of allProps) {
          it.definedProperties.add(prop);
        }
        if (it.opts.unevaluated && allProps.length && it.props !== true) {
          it.props = util_1.mergeEvaluated.props(gen, (0, util_1.toHash)(allProps), it.props);
        }
        const properties = allProps.filter((p) => !(0, util_1.alwaysValidSchema)(it, schema[p]));
        if (properties.length === 0)
          return;
        const valid = gen.name("valid");
        for (const prop of properties) {
          if (hasDefault(prop)) {
            applyPropertySchema(prop);
          } else {
            gen.if((0, code_1.propertyInData)(gen, data, prop, it.opts.ownProperties));
            applyPropertySchema(prop);
            if (!it.allErrors)
              gen.else().var(valid, true);
            gen.endIf();
          }
          cxt.it.definedProperties.add(prop);
          cxt.ok(valid);
        }
        function hasDefault(prop) {
          return it.opts.useDefaults && !it.compositeRule && schema[prop].default !== void 0;
        }
        function applyPropertySchema(prop) {
          cxt.subschema({
            keyword: "properties",
            schemaProp: prop,
            dataProp: prop
          }, valid);
        }
      }
    };
    exports2.default = def;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/patternProperties.js
var require_patternProperties = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/patternProperties.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var code_1 = require_code2();
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var util_2 = require_util();
    var def = {
      keyword: "patternProperties",
      type: "object",
      schemaType: "object",
      code(cxt) {
        const { gen, schema, data, parentSchema, it } = cxt;
        const { opts } = it;
        const patterns = (0, code_1.allSchemaProperties)(schema);
        const alwaysValidPatterns = patterns.filter((p) => (0, util_1.alwaysValidSchema)(it, schema[p]));
        if (patterns.length === 0 || alwaysValidPatterns.length === patterns.length && (!it.opts.unevaluated || it.props === true)) {
          return;
        }
        const checkProperties = opts.strictSchema && !opts.allowMatchingProperties && parentSchema.properties;
        const valid = gen.name("valid");
        if (it.props !== true && !(it.props instanceof codegen_1.Name)) {
          it.props = (0, util_2.evaluatedPropsToName)(gen, it.props);
        }
        const { props } = it;
        validatePatternProperties();
        function validatePatternProperties() {
          for (const pat of patterns) {
            if (checkProperties)
              checkMatchingProperties(pat);
            if (it.allErrors) {
              validateProperties(pat);
            } else {
              gen.var(valid, true);
              validateProperties(pat);
              gen.if(valid);
            }
          }
        }
        function checkMatchingProperties(pat) {
          for (const prop in checkProperties) {
            if (new RegExp(pat).test(prop)) {
              (0, util_1.checkStrictMode)(it, `property ${prop} matches pattern ${pat} (use allowMatchingProperties)`);
            }
          }
        }
        function validateProperties(pat) {
          gen.forIn("key", data, (key) => {
            gen.if((0, codegen_1._)`${(0, code_1.usePattern)(cxt, pat)}.test(${key})`, () => {
              const alwaysValid = alwaysValidPatterns.includes(pat);
              if (!alwaysValid) {
                cxt.subschema({
                  keyword: "patternProperties",
                  schemaProp: pat,
                  dataProp: key,
                  dataPropType: util_2.Type.Str
                }, valid);
              }
              if (it.opts.unevaluated && props !== true) {
                gen.assign((0, codegen_1._)`${props}[${key}]`, true);
              } else if (!alwaysValid && !it.allErrors) {
                gen.if((0, codegen_1.not)(valid), () => gen.break());
              }
            });
          });
        }
      }
    };
    exports2.default = def;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/not.js
var require_not = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/not.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var util_1 = require_util();
    var def = {
      keyword: "not",
      schemaType: ["object", "boolean"],
      trackErrors: true,
      code(cxt) {
        const { gen, schema, it } = cxt;
        if ((0, util_1.alwaysValidSchema)(it, schema)) {
          cxt.fail();
          return;
        }
        const valid = gen.name("valid");
        cxt.subschema({
          keyword: "not",
          compositeRule: true,
          createErrors: false,
          allErrors: false
        }, valid);
        cxt.failResult(valid, () => cxt.reset(), () => cxt.error());
      },
      error: { message: "must NOT be valid" }
    };
    exports2.default = def;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/anyOf.js
var require_anyOf = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/anyOf.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var code_1 = require_code2();
    var def = {
      keyword: "anyOf",
      schemaType: "array",
      trackErrors: true,
      code: code_1.validateUnion,
      error: { message: "must match a schema in anyOf" }
    };
    exports2.default = def;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/oneOf.js
var require_oneOf = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/oneOf.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var error = {
      message: "must match exactly one schema in oneOf",
      params: ({ params }) => (0, codegen_1._)`{passingSchemas: ${params.passing}}`
    };
    var def = {
      keyword: "oneOf",
      schemaType: "array",
      trackErrors: true,
      error,
      code(cxt) {
        const { gen, schema, parentSchema, it } = cxt;
        if (!Array.isArray(schema))
          throw new Error("ajv implementation error");
        if (it.opts.discriminator && parentSchema.discriminator)
          return;
        const schArr = schema;
        const valid = gen.let("valid", false);
        const passing = gen.let("passing", null);
        const schValid = gen.name("_valid");
        cxt.setParams({ passing });
        gen.block(validateOneOf);
        cxt.result(valid, () => cxt.reset(), () => cxt.error(true));
        function validateOneOf() {
          schArr.forEach((sch, i) => {
            let schCxt;
            if ((0, util_1.alwaysValidSchema)(it, sch)) {
              gen.var(schValid, true);
            } else {
              schCxt = cxt.subschema({
                keyword: "oneOf",
                schemaProp: i,
                compositeRule: true
              }, schValid);
            }
            if (i > 0) {
              gen.if((0, codegen_1._)`${schValid} && ${valid}`).assign(valid, false).assign(passing, (0, codegen_1._)`[${passing}, ${i}]`).else();
            }
            gen.if(schValid, () => {
              gen.assign(valid, true);
              gen.assign(passing, i);
              if (schCxt)
                cxt.mergeEvaluated(schCxt, codegen_1.Name);
            });
          });
        }
      }
    };
    exports2.default = def;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/allOf.js
var require_allOf = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/allOf.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var util_1 = require_util();
    var def = {
      keyword: "allOf",
      schemaType: "array",
      code(cxt) {
        const { gen, schema, it } = cxt;
        if (!Array.isArray(schema))
          throw new Error("ajv implementation error");
        const valid = gen.name("valid");
        schema.forEach((sch, i) => {
          if ((0, util_1.alwaysValidSchema)(it, sch))
            return;
          const schCxt = cxt.subschema({ keyword: "allOf", schemaProp: i }, valid);
          cxt.ok(valid);
          cxt.mergeEvaluated(schCxt);
        });
      }
    };
    exports2.default = def;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/if.js
var require_if = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/if.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var error = {
      message: ({ params }) => (0, codegen_1.str)`must match "${params.ifClause}" schema`,
      params: ({ params }) => (0, codegen_1._)`{failingKeyword: ${params.ifClause}}`
    };
    var def = {
      keyword: "if",
      schemaType: ["object", "boolean"],
      trackErrors: true,
      error,
      code(cxt) {
        const { gen, parentSchema, it } = cxt;
        if (parentSchema.then === void 0 && parentSchema.else === void 0) {
          (0, util_1.checkStrictMode)(it, '"if" without "then" and "else" is ignored');
        }
        const hasThen = hasSchema(it, "then");
        const hasElse = hasSchema(it, "else");
        if (!hasThen && !hasElse)
          return;
        const valid = gen.let("valid", true);
        const schValid = gen.name("_valid");
        validateIf();
        cxt.reset();
        if (hasThen && hasElse) {
          const ifClause = gen.let("ifClause");
          cxt.setParams({ ifClause });
          gen.if(schValid, validateClause("then", ifClause), validateClause("else", ifClause));
        } else if (hasThen) {
          gen.if(schValid, validateClause("then"));
        } else {
          gen.if((0, codegen_1.not)(schValid), validateClause("else"));
        }
        cxt.pass(valid, () => cxt.error(true));
        function validateIf() {
          const schCxt = cxt.subschema({
            keyword: "if",
            compositeRule: true,
            createErrors: false,
            allErrors: false
          }, schValid);
          cxt.mergeEvaluated(schCxt);
        }
        function validateClause(keyword, ifClause) {
          return () => {
            const schCxt = cxt.subschema({ keyword }, schValid);
            gen.assign(valid, schValid);
            cxt.mergeValidEvaluated(schCxt, valid);
            if (ifClause)
              gen.assign(ifClause, (0, codegen_1._)`${keyword}`);
            else
              cxt.setParams({ ifClause: keyword });
          };
        }
      }
    };
    function hasSchema(it, keyword) {
      const schema = it.schema[keyword];
      return schema !== void 0 && !(0, util_1.alwaysValidSchema)(it, schema);
    }
    exports2.default = def;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/thenElse.js
var require_thenElse = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/thenElse.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var util_1 = require_util();
    var def = {
      keyword: ["then", "else"],
      schemaType: ["object", "boolean"],
      code({ keyword, parentSchema, it }) {
        if (parentSchema.if === void 0)
          (0, util_1.checkStrictMode)(it, `"${keyword}" without "if" is ignored`);
      }
    };
    exports2.default = def;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/index.js
var require_applicator = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/index.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var additionalItems_1 = require_additionalItems();
    var prefixItems_1 = require_prefixItems();
    var items_1 = require_items();
    var items2020_1 = require_items2020();
    var contains_1 = require_contains();
    var dependencies_1 = require_dependencies();
    var propertyNames_1 = require_propertyNames();
    var additionalProperties_1 = require_additionalProperties();
    var properties_1 = require_properties();
    var patternProperties_1 = require_patternProperties();
    var not_1 = require_not();
    var anyOf_1 = require_anyOf();
    var oneOf_1 = require_oneOf();
    var allOf_1 = require_allOf();
    var if_1 = require_if();
    var thenElse_1 = require_thenElse();
    function getApplicator(draft2020 = false) {
      const applicator = [
        // any
        not_1.default,
        anyOf_1.default,
        oneOf_1.default,
        allOf_1.default,
        if_1.default,
        thenElse_1.default,
        // object
        propertyNames_1.default,
        additionalProperties_1.default,
        dependencies_1.default,
        properties_1.default,
        patternProperties_1.default
      ];
      if (draft2020)
        applicator.push(prefixItems_1.default, items2020_1.default);
      else
        applicator.push(additionalItems_1.default, items_1.default);
      applicator.push(contains_1.default);
      return applicator;
    }
    exports2.default = getApplicator;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/format/format.js
var require_format = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/format/format.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var error = {
      message: ({ schemaCode }) => (0, codegen_1.str)`must match format "${schemaCode}"`,
      params: ({ schemaCode }) => (0, codegen_1._)`{format: ${schemaCode}}`
    };
    var def = {
      keyword: "format",
      type: ["number", "string"],
      schemaType: "string",
      $data: true,
      error,
      code(cxt, ruleType) {
        const { gen, data, $data, schema, schemaCode, it } = cxt;
        const { opts, errSchemaPath, schemaEnv, self } = it;
        if (!opts.validateFormats)
          return;
        if ($data)
          validate$DataFormat();
        else
          validateFormat();
        function validate$DataFormat() {
          const fmts = gen.scopeValue("formats", {
            ref: self.formats,
            code: opts.code.formats
          });
          const fDef = gen.const("fDef", (0, codegen_1._)`${fmts}[${schemaCode}]`);
          const fType = gen.let("fType");
          const format = gen.let("format");
          gen.if((0, codegen_1._)`typeof ${fDef} == "object" && !(${fDef} instanceof RegExp)`, () => gen.assign(fType, (0, codegen_1._)`${fDef}.type || "string"`).assign(format, (0, codegen_1._)`${fDef}.validate`), () => gen.assign(fType, (0, codegen_1._)`"string"`).assign(format, fDef));
          cxt.fail$data((0, codegen_1.or)(unknownFmt(), invalidFmt()));
          function unknownFmt() {
            if (opts.strictSchema === false)
              return codegen_1.nil;
            return (0, codegen_1._)`${schemaCode} && !${format}`;
          }
          function invalidFmt() {
            const callFormat = schemaEnv.$async ? (0, codegen_1._)`(${fDef}.async ? await ${format}(${data}) : ${format}(${data}))` : (0, codegen_1._)`${format}(${data})`;
            const validData = (0, codegen_1._)`(typeof ${format} == "function" ? ${callFormat} : ${format}.test(${data}))`;
            return (0, codegen_1._)`${format} && ${format} !== true && ${fType} === ${ruleType} && !${validData}`;
          }
        }
        function validateFormat() {
          const formatDef = self.formats[schema];
          if (!formatDef) {
            unknownFormat();
            return;
          }
          if (formatDef === true)
            return;
          const [fmtType, format, fmtRef] = getFormat(formatDef);
          if (fmtType === ruleType)
            cxt.pass(validCondition());
          function unknownFormat() {
            if (opts.strictSchema === false) {
              self.logger.warn(unknownMsg());
              return;
            }
            throw new Error(unknownMsg());
            function unknownMsg() {
              return `unknown format "${schema}" ignored in schema at path "${errSchemaPath}"`;
            }
          }
          function getFormat(fmtDef) {
            const code = fmtDef instanceof RegExp ? (0, codegen_1.regexpCode)(fmtDef) : opts.code.formats ? (0, codegen_1._)`${opts.code.formats}${(0, codegen_1.getProperty)(schema)}` : void 0;
            const fmt = gen.scopeValue("formats", { key: schema, ref: fmtDef, code });
            if (typeof fmtDef == "object" && !(fmtDef instanceof RegExp)) {
              return [fmtDef.type || "string", fmtDef.validate, (0, codegen_1._)`${fmt}.validate`];
            }
            return ["string", fmtDef, fmt];
          }
          function validCondition() {
            if (typeof formatDef == "object" && !(formatDef instanceof RegExp) && formatDef.async) {
              if (!schemaEnv.$async)
                throw new Error("async format in sync schema");
              return (0, codegen_1._)`await ${fmtRef}(${data})`;
            }
            return typeof format == "function" ? (0, codegen_1._)`${fmtRef}(${data})` : (0, codegen_1._)`${fmtRef}.test(${data})`;
          }
        }
      }
    };
    exports2.default = def;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/format/index.js
var require_format2 = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/format/index.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var format_1 = require_format();
    var format = [format_1.default];
    exports2.default = format;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/metadata.js
var require_metadata = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/metadata.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.contentVocabulary = exports2.metadataVocabulary = void 0;
    exports2.metadataVocabulary = [
      "title",
      "description",
      "default",
      "deprecated",
      "readOnly",
      "writeOnly",
      "examples"
    ];
    exports2.contentVocabulary = [
      "contentMediaType",
      "contentEncoding",
      "contentSchema"
    ];
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/draft7.js
var require_draft7 = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/draft7.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var core_1 = require_core2();
    var validation_1 = require_validation();
    var applicator_1 = require_applicator();
    var format_1 = require_format2();
    var metadata_1 = require_metadata();
    var draft7Vocabularies = [
      core_1.default,
      validation_1.default,
      (0, applicator_1.default)(),
      format_1.default,
      metadata_1.metadataVocabulary,
      metadata_1.contentVocabulary
    ];
    exports2.default = draft7Vocabularies;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/discriminator/types.js
var require_types = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/discriminator/types.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.DiscrError = void 0;
    var DiscrError;
    (function(DiscrError2) {
      DiscrError2["Tag"] = "tag";
      DiscrError2["Mapping"] = "mapping";
    })(DiscrError || (exports2.DiscrError = DiscrError = {}));
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/discriminator/index.js
var require_discriminator = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/discriminator/index.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var types_1 = require_types();
    var compile_1 = require_compile();
    var ref_error_1 = require_ref_error();
    var util_1 = require_util();
    var error = {
      message: ({ params: { discrError, tagName } }) => discrError === types_1.DiscrError.Tag ? `tag "${tagName}" must be string` : `value of tag "${tagName}" must be in oneOf`,
      params: ({ params: { discrError, tag, tagName } }) => (0, codegen_1._)`{error: ${discrError}, tag: ${tagName}, tagValue: ${tag}}`
    };
    var def = {
      keyword: "discriminator",
      type: "object",
      schemaType: "object",
      error,
      code(cxt) {
        const { gen, data, schema, parentSchema, it } = cxt;
        const { oneOf } = parentSchema;
        if (!it.opts.discriminator) {
          throw new Error("discriminator: requires discriminator option");
        }
        const tagName = schema.propertyName;
        if (typeof tagName != "string")
          throw new Error("discriminator: requires propertyName");
        if (schema.mapping)
          throw new Error("discriminator: mapping is not supported");
        if (!oneOf)
          throw new Error("discriminator: requires oneOf keyword");
        const valid = gen.let("valid", false);
        const tag = gen.const("tag", (0, codegen_1._)`${data}${(0, codegen_1.getProperty)(tagName)}`);
        gen.if((0, codegen_1._)`typeof ${tag} == "string"`, () => validateMapping(), () => cxt.error(false, { discrError: types_1.DiscrError.Tag, tag, tagName }));
        cxt.ok(valid);
        function validateMapping() {
          const mapping = getMapping();
          gen.if(false);
          for (const tagValue in mapping) {
            gen.elseIf((0, codegen_1._)`${tag} === ${tagValue}`);
            gen.assign(valid, applyTagSchema(mapping[tagValue]));
          }
          gen.else();
          cxt.error(false, { discrError: types_1.DiscrError.Mapping, tag, tagName });
          gen.endIf();
        }
        function applyTagSchema(schemaProp) {
          const _valid = gen.name("valid");
          const schCxt = cxt.subschema({ keyword: "oneOf", schemaProp }, _valid);
          cxt.mergeEvaluated(schCxt, codegen_1.Name);
          return _valid;
        }
        function getMapping() {
          var _a;
          const oneOfMapping = {};
          const topRequired = hasRequired(parentSchema);
          let tagRequired = true;
          for (let i = 0; i < oneOf.length; i++) {
            let sch = oneOf[i];
            if ((sch === null || sch === void 0 ? void 0 : sch.$ref) && !(0, util_1.schemaHasRulesButRef)(sch, it.self.RULES)) {
              const ref = sch.$ref;
              sch = compile_1.resolveRef.call(it.self, it.schemaEnv.root, it.baseId, ref);
              if (sch instanceof compile_1.SchemaEnv)
                sch = sch.schema;
              if (sch === void 0)
                throw new ref_error_1.default(it.opts.uriResolver, it.baseId, ref);
            }
            const propSch = (_a = sch === null || sch === void 0 ? void 0 : sch.properties) === null || _a === void 0 ? void 0 : _a[tagName];
            if (typeof propSch != "object") {
              throw new Error(`discriminator: oneOf subschemas (or referenced schemas) must have "properties/${tagName}"`);
            }
            tagRequired = tagRequired && (topRequired || hasRequired(sch));
            addMappings(propSch, i);
          }
          if (!tagRequired)
            throw new Error(`discriminator: "${tagName}" must be required`);
          return oneOfMapping;
          function hasRequired({ required }) {
            return Array.isArray(required) && required.includes(tagName);
          }
          function addMappings(sch, i) {
            if (sch.const) {
              addMapping(sch.const, i);
            } else if (sch.enum) {
              for (const tagValue of sch.enum) {
                addMapping(tagValue, i);
              }
            } else {
              throw new Error(`discriminator: "properties/${tagName}" must have "const" or "enum"`);
            }
          }
          function addMapping(tagValue, i) {
            if (typeof tagValue != "string" || tagValue in oneOfMapping) {
              throw new Error(`discriminator: "${tagName}" values must be unique strings`);
            }
            oneOfMapping[tagValue] = i;
          }
        }
      }
    };
    exports2.default = def;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/refs/json-schema-draft-07.json
var require_json_schema_draft_07 = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/refs/json-schema-draft-07.json"(exports2, module2) {
    module2.exports = {
      $schema: "http://json-schema.org/draft-07/schema#",
      $id: "http://json-schema.org/draft-07/schema#",
      title: "Core schema meta-schema",
      definitions: {
        schemaArray: {
          type: "array",
          minItems: 1,
          items: { $ref: "#" }
        },
        nonNegativeInteger: {
          type: "integer",
          minimum: 0
        },
        nonNegativeIntegerDefault0: {
          allOf: [{ $ref: "#/definitions/nonNegativeInteger" }, { default: 0 }]
        },
        simpleTypes: {
          enum: ["array", "boolean", "integer", "null", "number", "object", "string"]
        },
        stringArray: {
          type: "array",
          items: { type: "string" },
          uniqueItems: true,
          default: []
        }
      },
      type: ["object", "boolean"],
      properties: {
        $id: {
          type: "string",
          format: "uri-reference"
        },
        $schema: {
          type: "string",
          format: "uri"
        },
        $ref: {
          type: "string",
          format: "uri-reference"
        },
        $comment: {
          type: "string"
        },
        title: {
          type: "string"
        },
        description: {
          type: "string"
        },
        default: true,
        readOnly: {
          type: "boolean",
          default: false
        },
        examples: {
          type: "array",
          items: true
        },
        multipleOf: {
          type: "number",
          exclusiveMinimum: 0
        },
        maximum: {
          type: "number"
        },
        exclusiveMaximum: {
          type: "number"
        },
        minimum: {
          type: "number"
        },
        exclusiveMinimum: {
          type: "number"
        },
        maxLength: { $ref: "#/definitions/nonNegativeInteger" },
        minLength: { $ref: "#/definitions/nonNegativeIntegerDefault0" },
        pattern: {
          type: "string",
          format: "regex"
        },
        additionalItems: { $ref: "#" },
        items: {
          anyOf: [{ $ref: "#" }, { $ref: "#/definitions/schemaArray" }],
          default: true
        },
        maxItems: { $ref: "#/definitions/nonNegativeInteger" },
        minItems: { $ref: "#/definitions/nonNegativeIntegerDefault0" },
        uniqueItems: {
          type: "boolean",
          default: false
        },
        contains: { $ref: "#" },
        maxProperties: { $ref: "#/definitions/nonNegativeInteger" },
        minProperties: { $ref: "#/definitions/nonNegativeIntegerDefault0" },
        required: { $ref: "#/definitions/stringArray" },
        additionalProperties: { $ref: "#" },
        definitions: {
          type: "object",
          additionalProperties: { $ref: "#" },
          default: {}
        },
        properties: {
          type: "object",
          additionalProperties: { $ref: "#" },
          default: {}
        },
        patternProperties: {
          type: "object",
          additionalProperties: { $ref: "#" },
          propertyNames: { format: "regex" },
          default: {}
        },
        dependencies: {
          type: "object",
          additionalProperties: {
            anyOf: [{ $ref: "#" }, { $ref: "#/definitions/stringArray" }]
          }
        },
        propertyNames: { $ref: "#" },
        const: true,
        enum: {
          type: "array",
          items: true,
          minItems: 1,
          uniqueItems: true
        },
        type: {
          anyOf: [
            { $ref: "#/definitions/simpleTypes" },
            {
              type: "array",
              items: { $ref: "#/definitions/simpleTypes" },
              minItems: 1,
              uniqueItems: true
            }
          ]
        },
        format: { type: "string" },
        contentMediaType: { type: "string" },
        contentEncoding: { type: "string" },
        if: { $ref: "#" },
        then: { $ref: "#" },
        else: { $ref: "#" },
        allOf: { $ref: "#/definitions/schemaArray" },
        anyOf: { $ref: "#/definitions/schemaArray" },
        oneOf: { $ref: "#/definitions/schemaArray" },
        not: { $ref: "#" }
      },
      default: true
    };
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/ajv.js
var require_ajv = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/ajv.js"(exports2, module2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.MissingRefError = exports2.ValidationError = exports2.CodeGen = exports2.Name = exports2.nil = exports2.stringify = exports2.str = exports2._ = exports2.KeywordCxt = exports2.Ajv = void 0;
    var core_1 = require_core();
    var draft7_1 = require_draft7();
    var discriminator_1 = require_discriminator();
    var draft7MetaSchema = require_json_schema_draft_07();
    var META_SUPPORT_DATA = ["/properties"];
    var META_SCHEMA_ID = "http://json-schema.org/draft-07/schema";
    var Ajv2 = class extends core_1.default {
      _addVocabularies() {
        super._addVocabularies();
        draft7_1.default.forEach((v) => this.addVocabulary(v));
        if (this.opts.discriminator)
          this.addKeyword(discriminator_1.default);
      }
      _addDefaultMetaSchema() {
        super._addDefaultMetaSchema();
        if (!this.opts.meta)
          return;
        const metaSchema = this.opts.$data ? this.$dataMetaSchema(draft7MetaSchema, META_SUPPORT_DATA) : draft7MetaSchema;
        this.addMetaSchema(metaSchema, META_SCHEMA_ID, false);
        this.refs["http://json-schema.org/schema"] = META_SCHEMA_ID;
      }
      defaultMeta() {
        return this.opts.defaultMeta = super.defaultMeta() || (this.getSchema(META_SCHEMA_ID) ? META_SCHEMA_ID : void 0);
      }
    };
    exports2.Ajv = Ajv2;
    module2.exports = exports2 = Ajv2;
    module2.exports.Ajv = Ajv2;
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = Ajv2;
    var validate_1 = require_validate();
    Object.defineProperty(exports2, "KeywordCxt", { enumerable: true, get: function() {
      return validate_1.KeywordCxt;
    } });
    var codegen_1 = require_codegen();
    Object.defineProperty(exports2, "_", { enumerable: true, get: function() {
      return codegen_1._;
    } });
    Object.defineProperty(exports2, "str", { enumerable: true, get: function() {
      return codegen_1.str;
    } });
    Object.defineProperty(exports2, "stringify", { enumerable: true, get: function() {
      return codegen_1.stringify;
    } });
    Object.defineProperty(exports2, "nil", { enumerable: true, get: function() {
      return codegen_1.nil;
    } });
    Object.defineProperty(exports2, "Name", { enumerable: true, get: function() {
      return codegen_1.Name;
    } });
    Object.defineProperty(exports2, "CodeGen", { enumerable: true, get: function() {
      return codegen_1.CodeGen;
    } });
    var validation_error_1 = require_validation_error();
    Object.defineProperty(exports2, "ValidationError", { enumerable: true, get: function() {
      return validation_error_1.default;
    } });
    var ref_error_1 = require_ref_error();
    Object.defineProperty(exports2, "MissingRefError", { enumerable: true, get: function() {
      return ref_error_1.default;
    } });
  }
});

// packages/env/src/index.js
var import_path, import_os, RUDI_HOME, CLAUDE_HOME, PATHS;
var init_src = __esm({
  "packages/env/src/index.js"() {
    import_path = __toESM(require("path"), 1);
    import_os = __toESM(require("os"), 1);
    RUDI_HOME = process.env.RUDI_HOME ? import_path.default.resolve(process.env.RUDI_HOME) : import_path.default.join(import_os.default.homedir(), ".rudi");
    CLAUDE_HOME = process.env.CLAUDE_HOME ? import_path.default.resolve(process.env.CLAUDE_HOME) : import_path.default.join(import_os.default.homedir(), ".claude");
    PATHS = {
      // Root
      home: RUDI_HOME,
      // Installed machine-local applications
      apps: import_path.default.join(RUDI_HOME, "apps"),
      // Installed RUDI packages
      packages: import_path.default.join(RUDI_HOME, "packages"),
      stacks: import_path.default.join(RUDI_HOME, "stacks"),
      skills: import_path.default.join(RUDI_HOME, "skills"),
      prompts: import_path.default.join(RUDI_HOME, "skills"),
      // Backward compat alias -> skills
      workflows: import_path.default.join(RUDI_HOME, "workflows"),
      // Durable generated artifacts. `output/` is retained only as a legacy
      // compatibility path while existing consumers migrate to `outputs/`.
      outputs: import_path.default.join(RUDI_HOME, "outputs"),
      legacyOutput: import_path.default.join(RUDI_HOME, "output"),
      // Runtimes (interpreters: node, python, deno, bun)
      runtimes: import_path.default.join(RUDI_HOME, "runtimes"),
      // Binaries (utility CLIs: ffmpeg, imagemagick, ripgrep, etc.)
      binaries: import_path.default.join(RUDI_HOME, "binaries"),
      // Legacy RUDI-managed agent metadata. Retained only for explicit migration
      // and removal; native Agent Hosts are discovered outside ~/.rudi.
      agents: import_path.default.join(RUDI_HOME, "agents"),
      // Runtime binaries (content-addressed)
      store: import_path.default.join(RUDI_HOME, "store"),
      // Shims (symlinks to store/)
      bins: import_path.default.join(RUDI_HOME, "bins"),
      // Lockfiles
      locks: import_path.default.join(RUDI_HOME, "locks"),
      // Secrets (OS Keychain preferred, encrypted file fallback)
      vault: import_path.default.join(RUDI_HOME, "vault"),
      // Database (shared with Studio)
      db: RUDI_HOME,
      dbFile: import_path.default.join(RUDI_HOME, "rudi.db"),
      // Cache
      cache: import_path.default.join(RUDI_HOME, "cache"),
      registryCache: import_path.default.join(RUDI_HOME, "cache", "registry.json"),
      // Config
      config: import_path.default.join(RUDI_HOME, "config.json"),
      // Logs
      logs: import_path.default.join(RUDI_HOME, "logs")
    };
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/identity.js
var require_identity = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/identity.js"(exports2) {
    "use strict";
    var ALIAS = /* @__PURE__ */ Symbol.for("yaml.alias");
    var DOC = /* @__PURE__ */ Symbol.for("yaml.document");
    var MAP = /* @__PURE__ */ Symbol.for("yaml.map");
    var PAIR = /* @__PURE__ */ Symbol.for("yaml.pair");
    var SCALAR = /* @__PURE__ */ Symbol.for("yaml.scalar");
    var SEQ = /* @__PURE__ */ Symbol.for("yaml.seq");
    var NODE_TYPE = /* @__PURE__ */ Symbol.for("yaml.node.type");
    var isAlias = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === ALIAS;
    var isDocument = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === DOC;
    var isMap = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === MAP;
    var isPair = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === PAIR;
    var isScalar = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SCALAR;
    var isSeq = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SEQ;
    function isCollection(node) {
      if (node && typeof node === "object")
        switch (node[NODE_TYPE]) {
          case MAP:
          case SEQ:
            return true;
        }
      return false;
    }
    function isNode(node) {
      if (node && typeof node === "object")
        switch (node[NODE_TYPE]) {
          case ALIAS:
          case MAP:
          case SCALAR:
          case SEQ:
            return true;
        }
      return false;
    }
    var hasAnchor = (node) => (isScalar(node) || isCollection(node)) && !!node.anchor;
    exports2.ALIAS = ALIAS;
    exports2.DOC = DOC;
    exports2.MAP = MAP;
    exports2.NODE_TYPE = NODE_TYPE;
    exports2.PAIR = PAIR;
    exports2.SCALAR = SCALAR;
    exports2.SEQ = SEQ;
    exports2.hasAnchor = hasAnchor;
    exports2.isAlias = isAlias;
    exports2.isCollection = isCollection;
    exports2.isDocument = isDocument;
    exports2.isMap = isMap;
    exports2.isNode = isNode;
    exports2.isPair = isPair;
    exports2.isScalar = isScalar;
    exports2.isSeq = isSeq;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/visit.js
var require_visit = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/visit.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var BREAK = /* @__PURE__ */ Symbol("break visit");
    var SKIP = /* @__PURE__ */ Symbol("skip children");
    var REMOVE = /* @__PURE__ */ Symbol("remove node");
    function visit(node, visitor) {
      const visitor_ = initVisitor(visitor);
      if (identity.isDocument(node)) {
        const cd = visit_(null, node.contents, visitor_, Object.freeze([node]));
        if (cd === REMOVE)
          node.contents = null;
      } else
        visit_(null, node, visitor_, Object.freeze([]));
    }
    visit.BREAK = BREAK;
    visit.SKIP = SKIP;
    visit.REMOVE = REMOVE;
    function visit_(key, node, visitor, path27) {
      const ctrl = callVisitor(key, node, visitor, path27);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key, path27, ctrl);
        return visit_(key, ctrl, visitor, path27);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node)) {
          path27 = Object.freeze(path27.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            const ci = visit_(i, node.items[i], visitor, path27);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i, 1);
              i -= 1;
            }
          }
        } else if (identity.isPair(node)) {
          path27 = Object.freeze(path27.concat(node));
          const ck = visit_("key", node.key, visitor, path27);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = visit_("value", node.value, visitor, path27);
          if (cv === BREAK)
            return BREAK;
          else if (cv === REMOVE)
            node.value = null;
        }
      }
      return ctrl;
    }
    async function visitAsync(node, visitor) {
      const visitor_ = initVisitor(visitor);
      if (identity.isDocument(node)) {
        const cd = await visitAsync_(null, node.contents, visitor_, Object.freeze([node]));
        if (cd === REMOVE)
          node.contents = null;
      } else
        await visitAsync_(null, node, visitor_, Object.freeze([]));
    }
    visitAsync.BREAK = BREAK;
    visitAsync.SKIP = SKIP;
    visitAsync.REMOVE = REMOVE;
    async function visitAsync_(key, node, visitor, path27) {
      const ctrl = await callVisitor(key, node, visitor, path27);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key, path27, ctrl);
        return visitAsync_(key, ctrl, visitor, path27);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node)) {
          path27 = Object.freeze(path27.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            const ci = await visitAsync_(i, node.items[i], visitor, path27);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i, 1);
              i -= 1;
            }
          }
        } else if (identity.isPair(node)) {
          path27 = Object.freeze(path27.concat(node));
          const ck = await visitAsync_("key", node.key, visitor, path27);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = await visitAsync_("value", node.value, visitor, path27);
          if (cv === BREAK)
            return BREAK;
          else if (cv === REMOVE)
            node.value = null;
        }
      }
      return ctrl;
    }
    function initVisitor(visitor) {
      if (typeof visitor === "object" && (visitor.Collection || visitor.Node || visitor.Value)) {
        return Object.assign({
          Alias: visitor.Node,
          Map: visitor.Node,
          Scalar: visitor.Node,
          Seq: visitor.Node
        }, visitor.Value && {
          Map: visitor.Value,
          Scalar: visitor.Value,
          Seq: visitor.Value
        }, visitor.Collection && {
          Map: visitor.Collection,
          Seq: visitor.Collection
        }, visitor);
      }
      return visitor;
    }
    function callVisitor(key, node, visitor, path27) {
      if (typeof visitor === "function")
        return visitor(key, node, path27);
      if (identity.isMap(node))
        return visitor.Map?.(key, node, path27);
      if (identity.isSeq(node))
        return visitor.Seq?.(key, node, path27);
      if (identity.isPair(node))
        return visitor.Pair?.(key, node, path27);
      if (identity.isScalar(node))
        return visitor.Scalar?.(key, node, path27);
      if (identity.isAlias(node))
        return visitor.Alias?.(key, node, path27);
      return void 0;
    }
    function replaceNode(key, path27, node) {
      const parent = path27[path27.length - 1];
      if (identity.isCollection(parent)) {
        parent.items[key] = node;
      } else if (identity.isPair(parent)) {
        if (key === "key")
          parent.key = node;
        else
          parent.value = node;
      } else if (identity.isDocument(parent)) {
        parent.contents = node;
      } else {
        const pt = identity.isAlias(parent) ? "alias" : "scalar";
        throw new Error(`Cannot replace node with ${pt} parent`);
      }
    }
    exports2.visit = visit;
    exports2.visitAsync = visitAsync;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/directives.js
var require_directives = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/directives.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var visit = require_visit();
    var escapeChars = {
      "!": "%21",
      ",": "%2C",
      "[": "%5B",
      "]": "%5D",
      "{": "%7B",
      "}": "%7D"
    };
    var escapeTagName = (tn) => tn.replace(/[!,[\]{}]/g, (ch) => escapeChars[ch]);
    var Directives = class _Directives {
      constructor(yaml, tags) {
        this.docStart = null;
        this.docEnd = false;
        this.yaml = Object.assign({}, _Directives.defaultYaml, yaml);
        this.tags = Object.assign({}, _Directives.defaultTags, tags);
      }
      clone() {
        const copy = new _Directives(this.yaml, this.tags);
        copy.docStart = this.docStart;
        return copy;
      }
      /**
       * During parsing, get a Directives instance for the current document and
       * update the stream state according to the current version's spec.
       */
      atDocument() {
        const res = new _Directives(this.yaml, this.tags);
        switch (this.yaml.version) {
          case "1.1":
            this.atNextDocument = true;
            break;
          case "1.2":
            this.atNextDocument = false;
            this.yaml = {
              explicit: _Directives.defaultYaml.explicit,
              version: "1.2"
            };
            this.tags = Object.assign({}, _Directives.defaultTags);
            break;
        }
        return res;
      }
      /**
       * @param onError - May be called even if the action was successful
       * @returns `true` on success
       */
      add(line, onError) {
        if (this.atNextDocument) {
          this.yaml = { explicit: _Directives.defaultYaml.explicit, version: "1.1" };
          this.tags = Object.assign({}, _Directives.defaultTags);
          this.atNextDocument = false;
        }
        const parts = line.trim().split(/[ \t]+/);
        const name = parts.shift();
        switch (name) {
          case "%TAG": {
            if (parts.length !== 2) {
              onError(0, "%TAG directive should contain exactly two parts");
              if (parts.length < 2)
                return false;
            }
            const [handle, prefix] = parts;
            this.tags[handle] = prefix;
            return true;
          }
          case "%YAML": {
            this.yaml.explicit = true;
            if (parts.length !== 1) {
              onError(0, "%YAML directive should contain exactly one part");
              return false;
            }
            const [version] = parts;
            if (version === "1.1" || version === "1.2") {
              this.yaml.version = version;
              return true;
            } else {
              const isValid = /^\d+\.\d+$/.test(version);
              onError(6, `Unsupported YAML version ${version}`, isValid);
              return false;
            }
          }
          default:
            onError(0, `Unknown directive ${name}`, true);
            return false;
        }
      }
      /**
       * Resolves a tag, matching handles to those defined in %TAG directives.
       *
       * @returns Resolved tag, which may also be the non-specific tag `'!'` or a
       *   `'!local'` tag, or `null` if unresolvable.
       */
      tagName(source, onError) {
        if (source === "!")
          return "!";
        if (source[0] !== "!") {
          onError(`Not a valid tag: ${source}`);
          return null;
        }
        if (source[1] === "<") {
          const verbatim = source.slice(2, -1);
          if (verbatim === "!" || verbatim === "!!") {
            onError(`Verbatim tags aren't resolved, so ${source} is invalid.`);
            return null;
          }
          if (source[source.length - 1] !== ">")
            onError("Verbatim tags must end with a >");
          return verbatim;
        }
        const [, handle, suffix] = source.match(/^(.*!)([^!]*)$/s);
        if (!suffix)
          onError(`The ${source} tag has no suffix`);
        const prefix = this.tags[handle];
        if (prefix) {
          try {
            return prefix + decodeURIComponent(suffix);
          } catch (error) {
            onError(String(error));
            return null;
          }
        }
        if (handle === "!")
          return source;
        onError(`Could not resolve tag: ${source}`);
        return null;
      }
      /**
       * Given a fully resolved tag, returns its printable string form,
       * taking into account current tag prefixes and defaults.
       */
      tagString(tag) {
        for (const [handle, prefix] of Object.entries(this.tags)) {
          if (tag.startsWith(prefix))
            return handle + escapeTagName(tag.substring(prefix.length));
        }
        return tag[0] === "!" ? tag : `!<${tag}>`;
      }
      toString(doc) {
        const lines = this.yaml.explicit ? [`%YAML ${this.yaml.version || "1.2"}`] : [];
        const tagEntries = Object.entries(this.tags);
        let tagNames;
        if (doc && tagEntries.length > 0 && identity.isNode(doc.contents)) {
          const tags = {};
          visit.visit(doc.contents, (_key, node) => {
            if (identity.isNode(node) && node.tag)
              tags[node.tag] = true;
          });
          tagNames = Object.keys(tags);
        } else
          tagNames = [];
        for (const [handle, prefix] of tagEntries) {
          if (handle === "!!" && prefix === "tag:yaml.org,2002:")
            continue;
          if (!doc || tagNames.some((tn) => tn.startsWith(prefix)))
            lines.push(`%TAG ${handle} ${prefix}`);
        }
        return lines.join("\n");
      }
    };
    Directives.defaultYaml = { explicit: false, version: "1.2" };
    Directives.defaultTags = { "!!": "tag:yaml.org,2002:" };
    exports2.Directives = Directives;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/anchors.js
var require_anchors = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/anchors.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var visit = require_visit();
    function anchorIsValid(anchor) {
      if (/[\x00-\x19\s,[\]{}]/.test(anchor)) {
        const sa = JSON.stringify(anchor);
        const msg = `Anchor must not contain whitespace or control characters: ${sa}`;
        throw new Error(msg);
      }
      return true;
    }
    function anchorNames(root) {
      const anchors = /* @__PURE__ */ new Set();
      visit.visit(root, {
        Value(_key, node) {
          if (node.anchor)
            anchors.add(node.anchor);
        }
      });
      return anchors;
    }
    function findNewAnchor(prefix, exclude) {
      for (let i = 1; true; ++i) {
        const name = `${prefix}${i}`;
        if (!exclude.has(name))
          return name;
      }
    }
    function createNodeAnchors(doc, prefix) {
      const aliasObjects = [];
      const sourceObjects = /* @__PURE__ */ new Map();
      let prevAnchors = null;
      return {
        onAnchor: (source) => {
          aliasObjects.push(source);
          prevAnchors ?? (prevAnchors = anchorNames(doc));
          const anchor = findNewAnchor(prefix, prevAnchors);
          prevAnchors.add(anchor);
          return anchor;
        },
        /**
         * With circular references, the source node is only resolved after all
         * of its child nodes are. This is why anchors are set only after all of
         * the nodes have been created.
         */
        setAnchors: () => {
          for (const source of aliasObjects) {
            const ref = sourceObjects.get(source);
            if (typeof ref === "object" && ref.anchor && (identity.isScalar(ref.node) || identity.isCollection(ref.node))) {
              ref.node.anchor = ref.anchor;
            } else {
              const error = new Error("Failed to resolve repeated object (this should not happen)");
              error.source = source;
              throw error;
            }
          }
        },
        sourceObjects
      };
    }
    exports2.anchorIsValid = anchorIsValid;
    exports2.anchorNames = anchorNames;
    exports2.createNodeAnchors = createNodeAnchors;
    exports2.findNewAnchor = findNewAnchor;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/applyReviver.js
var require_applyReviver = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/applyReviver.js"(exports2) {
    "use strict";
    function applyReviver(reviver, obj, key, val) {
      if (val && typeof val === "object") {
        if (Array.isArray(val)) {
          for (let i = 0, len = val.length; i < len; ++i) {
            const v0 = val[i];
            const v1 = applyReviver(reviver, val, String(i), v0);
            if (v1 === void 0)
              delete val[i];
            else if (v1 !== v0)
              val[i] = v1;
          }
        } else if (val instanceof Map) {
          for (const k of Array.from(val.keys())) {
            const v0 = val.get(k);
            const v1 = applyReviver(reviver, val, k, v0);
            if (v1 === void 0)
              val.delete(k);
            else if (v1 !== v0)
              val.set(k, v1);
          }
        } else if (val instanceof Set) {
          for (const v0 of Array.from(val)) {
            const v1 = applyReviver(reviver, val, v0, v0);
            if (v1 === void 0)
              val.delete(v0);
            else if (v1 !== v0) {
              val.delete(v0);
              val.add(v1);
            }
          }
        } else {
          for (const [k, v0] of Object.entries(val)) {
            const v1 = applyReviver(reviver, val, k, v0);
            if (v1 === void 0)
              delete val[k];
            else if (v1 !== v0)
              val[k] = v1;
          }
        }
      }
      return reviver.call(obj, key, val);
    }
    exports2.applyReviver = applyReviver;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/toJS.js
var require_toJS = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/toJS.js"(exports2) {
    "use strict";
    var identity = require_identity();
    function toJS(value, arg, ctx) {
      if (Array.isArray(value))
        return value.map((v, i) => toJS(v, String(i), ctx));
      if (value && typeof value.toJSON === "function") {
        if (!ctx || !identity.hasAnchor(value))
          return value.toJSON(arg, ctx);
        const data = { aliasCount: 0, count: 1, res: void 0 };
        ctx.anchors.set(value, data);
        ctx.onCreate = (res2) => {
          data.res = res2;
          delete ctx.onCreate;
        };
        const res = value.toJSON(arg, ctx);
        if (ctx.onCreate)
          ctx.onCreate(res);
        return res;
      }
      if (typeof value === "bigint" && !ctx?.keep)
        return Number(value);
      return value;
    }
    exports2.toJS = toJS;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Node.js
var require_Node = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Node.js"(exports2) {
    "use strict";
    var applyReviver = require_applyReviver();
    var identity = require_identity();
    var toJS = require_toJS();
    var NodeBase = class {
      constructor(type) {
        Object.defineProperty(this, identity.NODE_TYPE, { value: type });
      }
      /** Create a copy of this node.  */
      clone() {
        const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /** A plain JavaScript representation of this node. */
      toJS(doc, { mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
        if (!identity.isDocument(doc))
          throw new TypeError("A document argument is required");
        const ctx = {
          anchors: /* @__PURE__ */ new Map(),
          doc,
          keep: true,
          mapAsMap: mapAsMap === true,
          mapKeyWarned: false,
          maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
        };
        const res = toJS.toJS(this, "", ctx);
        if (typeof onAnchor === "function")
          for (const { count, res: res2 } of ctx.anchors.values())
            onAnchor(res2, count);
        return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
      }
    };
    exports2.NodeBase = NodeBase;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Alias.js
var require_Alias = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Alias.js"(exports2) {
    "use strict";
    var anchors = require_anchors();
    var visit = require_visit();
    var identity = require_identity();
    var Node = require_Node();
    var toJS = require_toJS();
    var Alias = class extends Node.NodeBase {
      constructor(source) {
        super(identity.ALIAS);
        this.source = source;
        Object.defineProperty(this, "tag", {
          set() {
            throw new Error("Alias nodes cannot have tags");
          }
        });
      }
      /**
       * Resolve the value of this alias within `doc`, finding the last
       * instance of the `source` anchor before this node.
       */
      resolve(doc, ctx) {
        if (ctx?.maxAliasCount === 0)
          throw new ReferenceError("Alias resolution is disabled");
        let nodes;
        if (ctx?.aliasResolveCache) {
          nodes = ctx.aliasResolveCache;
        } else {
          nodes = [];
          visit.visit(doc, {
            Node: (_key, node) => {
              if (identity.isAlias(node) || identity.hasAnchor(node))
                nodes.push(node);
            }
          });
          if (ctx)
            ctx.aliasResolveCache = nodes;
        }
        let found = void 0;
        for (const node of nodes) {
          if (node === this)
            break;
          if (node.anchor === this.source)
            found = node;
        }
        return found;
      }
      toJSON(_arg, ctx) {
        if (!ctx)
          return { source: this.source };
        const { anchors: anchors2, doc, maxAliasCount } = ctx;
        const source = this.resolve(doc, ctx);
        if (!source) {
          const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
          throw new ReferenceError(msg);
        }
        let data = anchors2.get(source);
        if (!data) {
          toJS.toJS(source, null, ctx);
          data = anchors2.get(source);
        }
        if (data?.res === void 0) {
          const msg = "This should not happen: Alias anchor was not resolved?";
          throw new ReferenceError(msg);
        }
        if (maxAliasCount >= 0) {
          data.count += 1;
          if (data.aliasCount === 0)
            data.aliasCount = getAliasCount(doc, source, anchors2);
          if (data.count * data.aliasCount > maxAliasCount) {
            const msg = "Excessive alias count indicates a resource exhaustion attack";
            throw new ReferenceError(msg);
          }
        }
        return data.res;
      }
      toString(ctx, _onComment, _onChompKeep) {
        const src = `*${this.source}`;
        if (ctx) {
          anchors.anchorIsValid(this.source);
          if (ctx.options.verifyAliasOrder && !ctx.anchors.has(this.source)) {
            const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
            throw new Error(msg);
          }
          if (ctx.implicitKey)
            return `${src} `;
        }
        return src;
      }
    };
    function getAliasCount(doc, node, anchors2) {
      if (identity.isAlias(node)) {
        const source = node.resolve(doc);
        const anchor = anchors2 && source && anchors2.get(source);
        return anchor ? anchor.count * anchor.aliasCount : 0;
      } else if (identity.isCollection(node)) {
        let count = 0;
        for (const item of node.items) {
          const c = getAliasCount(doc, item, anchors2);
          if (c > count)
            count = c;
        }
        return count;
      } else if (identity.isPair(node)) {
        const kc = getAliasCount(doc, node.key, anchors2);
        const vc = getAliasCount(doc, node.value, anchors2);
        return Math.max(kc, vc);
      }
      return 1;
    }
    exports2.Alias = Alias;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Scalar.js
var require_Scalar = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Scalar.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var Node = require_Node();
    var toJS = require_toJS();
    var isScalarValue = (value) => !value || typeof value !== "function" && typeof value !== "object";
    var Scalar = class extends Node.NodeBase {
      constructor(value) {
        super(identity.SCALAR);
        this.value = value;
      }
      toJSON(arg, ctx) {
        return ctx?.keep ? this.value : toJS.toJS(this.value, arg, ctx);
      }
      toString() {
        return String(this.value);
      }
    };
    Scalar.BLOCK_FOLDED = "BLOCK_FOLDED";
    Scalar.BLOCK_LITERAL = "BLOCK_LITERAL";
    Scalar.PLAIN = "PLAIN";
    Scalar.QUOTE_DOUBLE = "QUOTE_DOUBLE";
    Scalar.QUOTE_SINGLE = "QUOTE_SINGLE";
    exports2.Scalar = Scalar;
    exports2.isScalarValue = isScalarValue;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/createNode.js
var require_createNode = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/createNode.js"(exports2) {
    "use strict";
    var Alias = require_Alias();
    var identity = require_identity();
    var Scalar = require_Scalar();
    var defaultTagPrefix = "tag:yaml.org,2002:";
    function findTagObject(value, tagName, tags) {
      if (tagName) {
        const match = tags.filter((t) => t.tag === tagName);
        const tagObj = match.find((t) => !t.format) ?? match[0];
        if (!tagObj)
          throw new Error(`Tag ${tagName} not found`);
        return tagObj;
      }
      return tags.find((t) => t.identify?.(value) && !t.format);
    }
    function createNode(value, tagName, ctx) {
      if (identity.isDocument(value))
        value = value.contents;
      if (identity.isNode(value))
        return value;
      if (identity.isPair(value)) {
        const map = ctx.schema[identity.MAP].createNode?.(ctx.schema, null, ctx);
        map.items.push(value);
        return map;
      }
      if (value instanceof String || value instanceof Number || value instanceof Boolean || typeof BigInt !== "undefined" && value instanceof BigInt) {
        value = value.valueOf();
      }
      const { aliasDuplicateObjects, onAnchor, onTagObj, schema, sourceObjects } = ctx;
      let ref = void 0;
      if (aliasDuplicateObjects && value && typeof value === "object") {
        ref = sourceObjects.get(value);
        if (ref) {
          ref.anchor ?? (ref.anchor = onAnchor(value));
          return new Alias.Alias(ref.anchor);
        } else {
          ref = { anchor: null, node: null };
          sourceObjects.set(value, ref);
        }
      }
      if (tagName?.startsWith("!!"))
        tagName = defaultTagPrefix + tagName.slice(2);
      let tagObj = findTagObject(value, tagName, schema.tags);
      if (!tagObj) {
        if (value && typeof value.toJSON === "function") {
          value = value.toJSON();
        }
        if (!value || typeof value !== "object") {
          const node2 = new Scalar.Scalar(value);
          if (ref)
            ref.node = node2;
          return node2;
        }
        tagObj = value instanceof Map ? schema[identity.MAP] : Symbol.iterator in Object(value) ? schema[identity.SEQ] : schema[identity.MAP];
      }
      if (onTagObj) {
        onTagObj(tagObj);
        delete ctx.onTagObj;
      }
      const node = tagObj?.createNode ? tagObj.createNode(ctx.schema, value, ctx) : typeof tagObj?.nodeClass?.from === "function" ? tagObj.nodeClass.from(ctx.schema, value, ctx) : new Scalar.Scalar(value);
      if (tagName)
        node.tag = tagName;
      else if (!tagObj.default)
        node.tag = tagObj.tag;
      if (ref)
        ref.node = node;
      return node;
    }
    exports2.createNode = createNode;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Collection.js
var require_Collection = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Collection.js"(exports2) {
    "use strict";
    var createNode = require_createNode();
    var identity = require_identity();
    var Node = require_Node();
    function collectionFromPath(schema, path27, value) {
      let v = value;
      for (let i = path27.length - 1; i >= 0; --i) {
        const k = path27[i];
        if (typeof k === "number" && Number.isInteger(k) && k >= 0) {
          const a = [];
          a[k] = v;
          v = a;
        } else {
          v = /* @__PURE__ */ new Map([[k, v]]);
        }
      }
      return createNode.createNode(v, void 0, {
        aliasDuplicateObjects: false,
        keepUndefined: false,
        onAnchor: () => {
          throw new Error("This should not happen, please report a bug.");
        },
        schema,
        sourceObjects: /* @__PURE__ */ new Map()
      });
    }
    var isEmptyPath = (path27) => path27 == null || typeof path27 === "object" && !!path27[Symbol.iterator]().next().done;
    var Collection = class extends Node.NodeBase {
      constructor(type, schema) {
        super(type);
        Object.defineProperty(this, "schema", {
          value: schema,
          configurable: true,
          enumerable: false,
          writable: true
        });
      }
      /**
       * Create a copy of this collection.
       *
       * @param schema - If defined, overwrites the original's schema
       */
      clone(schema) {
        const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
        if (schema)
          copy.schema = schema;
        copy.items = copy.items.map((it) => identity.isNode(it) || identity.isPair(it) ? it.clone(schema) : it);
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /**
       * Adds a value to the collection. For `!!map` and `!!omap` the value must
       * be a Pair instance or a `{ key, value }` object, which may not have a key
       * that already exists in the map.
       */
      addIn(path27, value) {
        if (isEmptyPath(path27))
          this.add(value);
        else {
          const [key, ...rest] = path27;
          const node = this.get(key, true);
          if (identity.isCollection(node))
            node.addIn(rest, value);
          else if (node === void 0 && this.schema)
            this.set(key, collectionFromPath(this.schema, rest, value));
          else
            throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
        }
      }
      /**
       * Removes a value from the collection.
       * @returns `true` if the item was found and removed.
       */
      deleteIn(path27) {
        const [key, ...rest] = path27;
        if (rest.length === 0)
          return this.delete(key);
        const node = this.get(key, true);
        if (identity.isCollection(node))
          return node.deleteIn(rest);
        else
          throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
      }
      /**
       * Returns item at `key`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      getIn(path27, keepScalar) {
        const [key, ...rest] = path27;
        const node = this.get(key, true);
        if (rest.length === 0)
          return !keepScalar && identity.isScalar(node) ? node.value : node;
        else
          return identity.isCollection(node) ? node.getIn(rest, keepScalar) : void 0;
      }
      hasAllNullValues(allowScalar) {
        return this.items.every((node) => {
          if (!identity.isPair(node))
            return false;
          const n = node.value;
          return n == null || allowScalar && identity.isScalar(n) && n.value == null && !n.commentBefore && !n.comment && !n.tag;
        });
      }
      /**
       * Checks if the collection includes a value with the key `key`.
       */
      hasIn(path27) {
        const [key, ...rest] = path27;
        if (rest.length === 0)
          return this.has(key);
        const node = this.get(key, true);
        return identity.isCollection(node) ? node.hasIn(rest) : false;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path27, value) {
        const [key, ...rest] = path27;
        if (rest.length === 0) {
          this.set(key, value);
        } else {
          const node = this.get(key, true);
          if (identity.isCollection(node))
            node.setIn(rest, value);
          else if (node === void 0 && this.schema)
            this.set(key, collectionFromPath(this.schema, rest, value));
          else
            throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
        }
      }
    };
    exports2.Collection = Collection;
    exports2.collectionFromPath = collectionFromPath;
    exports2.isEmptyPath = isEmptyPath;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyComment.js
var require_stringifyComment = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyComment.js"(exports2) {
    "use strict";
    var stringifyComment = (str) => str.replace(/^(?!$)(?: $)?/gm, "#");
    function indentComment(comment, indent) {
      if (/^\n+$/.test(comment))
        return comment.substring(1);
      return indent ? comment.replace(/^(?! *$)/gm, indent) : comment;
    }
    var lineComment = (str, indent, comment) => str.endsWith("\n") ? indentComment(comment, indent) : comment.includes("\n") ? "\n" + indentComment(comment, indent) : (str.endsWith(" ") ? "" : " ") + comment;
    exports2.indentComment = indentComment;
    exports2.lineComment = lineComment;
    exports2.stringifyComment = stringifyComment;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/foldFlowLines.js
var require_foldFlowLines = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/foldFlowLines.js"(exports2) {
    "use strict";
    var FOLD_FLOW = "flow";
    var FOLD_BLOCK = "block";
    var FOLD_QUOTED = "quoted";
    function foldFlowLines(text, indent, mode = "flow", { indentAtStart, lineWidth = 80, minContentWidth = 20, onFold, onOverflow } = {}) {
      if (!lineWidth || lineWidth < 0)
        return text;
      if (lineWidth < minContentWidth)
        minContentWidth = 0;
      const endStep = Math.max(1 + minContentWidth, 1 + lineWidth - indent.length);
      if (text.length <= endStep)
        return text;
      const folds = [];
      const escapedFolds = {};
      let end = lineWidth - indent.length;
      if (typeof indentAtStart === "number") {
        if (indentAtStart > lineWidth - Math.max(2, minContentWidth))
          folds.push(0);
        else
          end = lineWidth - indentAtStart;
      }
      let split = void 0;
      let prev = void 0;
      let overflow = false;
      let i = -1;
      let escStart = -1;
      let escEnd = -1;
      if (mode === FOLD_BLOCK) {
        i = consumeMoreIndentedLines(text, i, indent.length);
        if (i !== -1)
          end = i + endStep;
      }
      for (let ch; ch = text[i += 1]; ) {
        if (mode === FOLD_QUOTED && ch === "\\") {
          escStart = i;
          switch (text[i + 1]) {
            case "x":
              i += 3;
              break;
            case "u":
              i += 5;
              break;
            case "U":
              i += 9;
              break;
            default:
              i += 1;
          }
          escEnd = i;
        }
        if (ch === "\n") {
          if (mode === FOLD_BLOCK)
            i = consumeMoreIndentedLines(text, i, indent.length);
          end = i + indent.length + endStep;
          split = void 0;
        } else {
          if (ch === " " && prev && prev !== " " && prev !== "\n" && prev !== "	") {
            const next = text[i + 1];
            if (next && next !== " " && next !== "\n" && next !== "	")
              split = i;
          }
          if (i >= end) {
            if (split) {
              folds.push(split);
              end = split + endStep;
              split = void 0;
            } else if (mode === FOLD_QUOTED) {
              while (prev === " " || prev === "	") {
                prev = ch;
                ch = text[i += 1];
                overflow = true;
              }
              const j = i > escEnd + 1 ? i - 2 : escStart - 1;
              if (escapedFolds[j])
                return text;
              folds.push(j);
              escapedFolds[j] = true;
              end = j + endStep;
              split = void 0;
            } else {
              overflow = true;
            }
          }
        }
        prev = ch;
      }
      if (overflow && onOverflow)
        onOverflow();
      if (folds.length === 0)
        return text;
      if (onFold)
        onFold();
      let res = text.slice(0, folds[0]);
      for (let i2 = 0; i2 < folds.length; ++i2) {
        const fold = folds[i2];
        const end2 = folds[i2 + 1] || text.length;
        if (fold === 0)
          res = `
${indent}${text.slice(0, end2)}`;
        else {
          if (mode === FOLD_QUOTED && escapedFolds[fold])
            res += `${text[fold]}\\`;
          res += `
${indent}${text.slice(fold + 1, end2)}`;
        }
      }
      return res;
    }
    function consumeMoreIndentedLines(text, i, indent) {
      let end = i;
      let start = i + 1;
      let ch = text[start];
      while (ch === " " || ch === "	") {
        if (i < start + indent) {
          ch = text[++i];
        } else {
          do {
            ch = text[++i];
          } while (ch && ch !== "\n");
          end = i;
          start = i + 1;
          ch = text[start];
        }
      }
      return end;
    }
    exports2.FOLD_BLOCK = FOLD_BLOCK;
    exports2.FOLD_FLOW = FOLD_FLOW;
    exports2.FOLD_QUOTED = FOLD_QUOTED;
    exports2.foldFlowLines = foldFlowLines;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyString.js
var require_stringifyString = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyString.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    var foldFlowLines = require_foldFlowLines();
    var getFoldOptions = (ctx, isBlock) => ({
      indentAtStart: isBlock ? ctx.indent.length : ctx.indentAtStart,
      lineWidth: ctx.options.lineWidth,
      minContentWidth: ctx.options.minContentWidth
    });
    var containsDocumentMarker = (str) => /^(%|---|\.\.\.)/m.test(str);
    function lineLengthOverLimit(str, lineWidth, indentLength) {
      if (!lineWidth || lineWidth < 0)
        return false;
      const limit = lineWidth - indentLength;
      const strLen = str.length;
      if (strLen <= limit)
        return false;
      for (let i = 0, start = 0; i < strLen; ++i) {
        if (str[i] === "\n") {
          if (i - start > limit)
            return true;
          start = i + 1;
          if (strLen - start <= limit)
            return false;
        }
      }
      return true;
    }
    function doubleQuotedString(value, ctx) {
      const json = JSON.stringify(value);
      if (ctx.options.doubleQuotedAsJSON)
        return json;
      const { implicitKey } = ctx;
      const minMultiLineLength = ctx.options.doubleQuotedMinMultiLineLength;
      const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
      let str = "";
      let start = 0;
      for (let i = 0, ch = json[i]; ch; ch = json[++i]) {
        if (ch === " " && json[i + 1] === "\\" && json[i + 2] === "n") {
          str += json.slice(start, i) + "\\ ";
          i += 1;
          start = i;
          ch = "\\";
        }
        if (ch === "\\")
          switch (json[i + 1]) {
            case "u":
              {
                str += json.slice(start, i);
                const code = json.substr(i + 2, 4);
                switch (code) {
                  case "0000":
                    str += "\\0";
                    break;
                  case "0007":
                    str += "\\a";
                    break;
                  case "000b":
                    str += "\\v";
                    break;
                  case "001b":
                    str += "\\e";
                    break;
                  case "0085":
                    str += "\\N";
                    break;
                  case "00a0":
                    str += "\\_";
                    break;
                  case "2028":
                    str += "\\L";
                    break;
                  case "2029":
                    str += "\\P";
                    break;
                  default:
                    if (code.substr(0, 2) === "00")
                      str += "\\x" + code.substr(2);
                    else
                      str += json.substr(i, 6);
                }
                i += 5;
                start = i + 1;
              }
              break;
            case "n":
              if (implicitKey || json[i + 2] === '"' || json.length < minMultiLineLength) {
                i += 1;
              } else {
                str += json.slice(start, i) + "\n\n";
                while (json[i + 2] === "\\" && json[i + 3] === "n" && json[i + 4] !== '"') {
                  str += "\n";
                  i += 2;
                }
                str += indent;
                if (json[i + 2] === " ")
                  str += "\\";
                i += 1;
                start = i + 1;
              }
              break;
            default:
              i += 1;
          }
      }
      str = start ? str + json.slice(start) : json;
      return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_QUOTED, getFoldOptions(ctx, false));
    }
    function singleQuotedString(value, ctx) {
      if (ctx.options.singleQuote === false || ctx.implicitKey && value.includes("\n") || /[ \t]\n|\n[ \t]/.test(value))
        return doubleQuotedString(value, ctx);
      const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
      const res = "'" + value.replace(/'/g, "''").replace(/\n+/g, `$&
${indent}`) + "'";
      return ctx.implicitKey ? res : foldFlowLines.foldFlowLines(res, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
    }
    function quotedString(value, ctx) {
      const { singleQuote } = ctx.options;
      let qs;
      if (singleQuote === false)
        qs = doubleQuotedString;
      else {
        const hasDouble = value.includes('"');
        const hasSingle = value.includes("'");
        if (hasDouble && !hasSingle)
          qs = singleQuotedString;
        else if (hasSingle && !hasDouble)
          qs = doubleQuotedString;
        else
          qs = singleQuote ? singleQuotedString : doubleQuotedString;
      }
      return qs(value, ctx);
    }
    var blockEndNewlines;
    try {
      blockEndNewlines = new RegExp("(^|(?<!\n))\n+(?!\n|$)", "g");
    } catch {
      blockEndNewlines = /\n+(?!\n|$)/g;
    }
    function blockString({ comment, type, value }, ctx, onComment, onChompKeep) {
      const { blockQuote, commentString, lineWidth } = ctx.options;
      if (!blockQuote || /\n[\t ]+$/.test(value)) {
        return quotedString(value, ctx);
      }
      const indent = ctx.indent || (ctx.forceBlockIndent || containsDocumentMarker(value) ? "  " : "");
      const literal = blockQuote === "literal" ? true : blockQuote === "folded" || type === Scalar.Scalar.BLOCK_FOLDED ? false : type === Scalar.Scalar.BLOCK_LITERAL ? true : !lineLengthOverLimit(value, lineWidth, indent.length);
      if (!value)
        return literal ? "|\n" : ">\n";
      let chomp;
      let endStart;
      for (endStart = value.length; endStart > 0; --endStart) {
        const ch = value[endStart - 1];
        if (ch !== "\n" && ch !== "	" && ch !== " ")
          break;
      }
      let end = value.substring(endStart);
      const endNlPos = end.indexOf("\n");
      if (endNlPos === -1) {
        chomp = "-";
      } else if (value === end || endNlPos !== end.length - 1) {
        chomp = "+";
        if (onChompKeep)
          onChompKeep();
      } else {
        chomp = "";
      }
      if (end) {
        value = value.slice(0, -end.length);
        if (end[end.length - 1] === "\n")
          end = end.slice(0, -1);
        end = end.replace(blockEndNewlines, `$&${indent}`);
      }
      let startWithSpace = false;
      let startEnd;
      let startNlPos = -1;
      for (startEnd = 0; startEnd < value.length; ++startEnd) {
        const ch = value[startEnd];
        if (ch === " ")
          startWithSpace = true;
        else if (ch === "\n")
          startNlPos = startEnd;
        else
          break;
      }
      let start = value.substring(0, startNlPos < startEnd ? startNlPos + 1 : startEnd);
      if (start) {
        value = value.substring(start.length);
        start = start.replace(/\n+/g, `$&${indent}`);
      }
      const indentSize = indent ? "2" : "1";
      let header = (startWithSpace ? indentSize : "") + chomp;
      if (comment) {
        header += " " + commentString(comment.replace(/ ?[\r\n]+/g, " "));
        if (onComment)
          onComment();
      }
      if (!literal) {
        const foldedValue = value.replace(/\n+/g, "\n$&").replace(/(?:^|\n)([\t ].*)(?:([\n\t ]*)\n(?![\n\t ]))?/g, "$1$2").replace(/\n+/g, `$&${indent}`);
        let literalFallback = false;
        const foldOptions = getFoldOptions(ctx, true);
        if (blockQuote !== "folded" && type !== Scalar.Scalar.BLOCK_FOLDED) {
          foldOptions.onOverflow = () => {
            literalFallback = true;
          };
        }
        const body = foldFlowLines.foldFlowLines(`${start}${foldedValue}${end}`, indent, foldFlowLines.FOLD_BLOCK, foldOptions);
        if (!literalFallback)
          return `>${header}
${indent}${body}`;
      }
      value = value.replace(/\n+/g, `$&${indent}`);
      return `|${header}
${indent}${start}${value}${end}`;
    }
    function plainString(item, ctx, onComment, onChompKeep) {
      const { type, value } = item;
      const { actualString, implicitKey, indent, indentStep, inFlow } = ctx;
      if (implicitKey && value.includes("\n") || inFlow && /[[\]{},]/.test(value)) {
        return quotedString(value, ctx);
      }
      if (/^[\n\t ,[\]{}#&*!|>'"%@`]|^[?-]$|^[?-][ \t]|[\n:][ \t]|[ \t]\n|[\n\t ]#|[\n\t :]$/.test(value)) {
        return implicitKey || inFlow || !value.includes("\n") ? quotedString(value, ctx) : blockString(item, ctx, onComment, onChompKeep);
      }
      if (!implicitKey && !inFlow && type !== Scalar.Scalar.PLAIN && value.includes("\n")) {
        return blockString(item, ctx, onComment, onChompKeep);
      }
      if (containsDocumentMarker(value)) {
        if (indent === "") {
          ctx.forceBlockIndent = true;
          return blockString(item, ctx, onComment, onChompKeep);
        } else if (implicitKey && indent === indentStep) {
          return quotedString(value, ctx);
        }
      }
      const str = value.replace(/\n+/g, `$&
${indent}`);
      if (actualString) {
        const test = (tag) => tag.default && tag.tag !== "tag:yaml.org,2002:str" && tag.test?.test(str);
        const { compat, tags } = ctx.doc.schema;
        if (tags.some(test) || compat?.some(test))
          return quotedString(value, ctx);
      }
      return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
    }
    function stringifyString(item, ctx, onComment, onChompKeep) {
      const { implicitKey, inFlow } = ctx;
      const ss = typeof item.value === "string" ? item : Object.assign({}, item, { value: String(item.value) });
      let { type } = item;
      if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
        if (/[\x00-\x08\x0b-\x1f\x7f-\x9f\u{D800}-\u{DFFF}]/u.test(ss.value))
          type = Scalar.Scalar.QUOTE_DOUBLE;
      }
      const _stringify = (_type) => {
        switch (_type) {
          case Scalar.Scalar.BLOCK_FOLDED:
          case Scalar.Scalar.BLOCK_LITERAL:
            return implicitKey || inFlow ? quotedString(ss.value, ctx) : blockString(ss, ctx, onComment, onChompKeep);
          case Scalar.Scalar.QUOTE_DOUBLE:
            return doubleQuotedString(ss.value, ctx);
          case Scalar.Scalar.QUOTE_SINGLE:
            return singleQuotedString(ss.value, ctx);
          case Scalar.Scalar.PLAIN:
            return plainString(ss, ctx, onComment, onChompKeep);
          default:
            return null;
        }
      };
      let res = _stringify(type);
      if (res === null) {
        const { defaultKeyType, defaultStringType } = ctx.options;
        const t = implicitKey && defaultKeyType || defaultStringType;
        res = _stringify(t);
        if (res === null)
          throw new Error(`Unsupported default string type ${t}`);
      }
      return res;
    }
    exports2.stringifyString = stringifyString;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringify.js
var require_stringify = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringify.js"(exports2) {
    "use strict";
    var anchors = require_anchors();
    var identity = require_identity();
    var stringifyComment = require_stringifyComment();
    var stringifyString = require_stringifyString();
    function createStringifyContext(doc, options) {
      const opt = Object.assign({
        blockQuote: true,
        commentString: stringifyComment.stringifyComment,
        defaultKeyType: null,
        defaultStringType: "PLAIN",
        directives: null,
        doubleQuotedAsJSON: false,
        doubleQuotedMinMultiLineLength: 40,
        falseStr: "false",
        flowCollectionPadding: true,
        indentSeq: true,
        lineWidth: 80,
        minContentWidth: 20,
        nullStr: "null",
        simpleKeys: false,
        singleQuote: null,
        trailingComma: false,
        trueStr: "true",
        verifyAliasOrder: true
      }, doc.schema.toStringOptions, options);
      let inFlow;
      switch (opt.collectionStyle) {
        case "block":
          inFlow = false;
          break;
        case "flow":
          inFlow = true;
          break;
        default:
          inFlow = null;
      }
      return {
        anchors: /* @__PURE__ */ new Set(),
        doc,
        flowCollectionPadding: opt.flowCollectionPadding ? " " : "",
        indent: "",
        indentStep: typeof opt.indent === "number" ? " ".repeat(opt.indent) : "  ",
        inFlow,
        options: opt
      };
    }
    function getTagObject(tags, item) {
      if (item.tag) {
        const match = tags.filter((t) => t.tag === item.tag);
        if (match.length > 0)
          return match.find((t) => t.format === item.format) ?? match[0];
      }
      let tagObj = void 0;
      let obj;
      if (identity.isScalar(item)) {
        obj = item.value;
        let match = tags.filter((t) => t.identify?.(obj));
        if (match.length > 1) {
          const testMatch = match.filter((t) => t.test);
          if (testMatch.length > 0)
            match = testMatch;
        }
        tagObj = match.find((t) => t.format === item.format) ?? match.find((t) => !t.format);
      } else {
        obj = item;
        tagObj = tags.find((t) => t.nodeClass && obj instanceof t.nodeClass);
      }
      if (!tagObj) {
        const name = obj?.constructor?.name ?? (obj === null ? "null" : typeof obj);
        throw new Error(`Tag not resolved for ${name} value`);
      }
      return tagObj;
    }
    function stringifyProps(node, tagObj, { anchors: anchors$1, doc }) {
      if (!doc.directives)
        return "";
      const props = [];
      const anchor = (identity.isScalar(node) || identity.isCollection(node)) && node.anchor;
      if (anchor && anchors.anchorIsValid(anchor)) {
        anchors$1.add(anchor);
        props.push(`&${anchor}`);
      }
      const tag = node.tag ?? (tagObj.default ? null : tagObj.tag);
      if (tag)
        props.push(doc.directives.tagString(tag));
      return props.join(" ");
    }
    function stringify(item, ctx, onComment, onChompKeep) {
      if (identity.isPair(item))
        return item.toString(ctx, onComment, onChompKeep);
      if (identity.isAlias(item)) {
        if (ctx.doc.directives)
          return item.toString(ctx);
        if (ctx.resolvedAliases?.has(item)) {
          throw new TypeError(`Cannot stringify circular structure without alias nodes`);
        } else {
          if (ctx.resolvedAliases)
            ctx.resolvedAliases.add(item);
          else
            ctx.resolvedAliases = /* @__PURE__ */ new Set([item]);
          item = item.resolve(ctx.doc);
        }
      }
      let tagObj = void 0;
      const node = identity.isNode(item) ? item : ctx.doc.createNode(item, { onTagObj: (o) => tagObj = o });
      tagObj ?? (tagObj = getTagObject(ctx.doc.schema.tags, node));
      const props = stringifyProps(node, tagObj, ctx);
      if (props.length > 0)
        ctx.indentAtStart = (ctx.indentAtStart ?? 0) + props.length + 1;
      const str = typeof tagObj.stringify === "function" ? tagObj.stringify(node, ctx, onComment, onChompKeep) : identity.isScalar(node) ? stringifyString.stringifyString(node, ctx, onComment, onChompKeep) : node.toString(ctx, onComment, onChompKeep);
      if (!props)
        return str;
      return identity.isScalar(node) || str[0] === "{" || str[0] === "[" ? `${props} ${str}` : `${props}
${ctx.indent}${str}`;
    }
    exports2.createStringifyContext = createStringifyContext;
    exports2.stringify = stringify;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyPair.js
var require_stringifyPair = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyPair.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var stringify = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyPair({ key, value }, ctx, onComment, onChompKeep) {
      const { allNullValues, doc, indent, indentStep, options: { commentString, indentSeq, simpleKeys } } = ctx;
      let keyComment = identity.isNode(key) && key.comment || null;
      if (simpleKeys) {
        if (keyComment) {
          throw new Error("With simple keys, key nodes cannot have comments");
        }
        if (identity.isCollection(key) || !identity.isNode(key) && typeof key === "object") {
          const msg = "With simple keys, collection cannot be used as a key value";
          throw new Error(msg);
        }
      }
      let explicitKey = !simpleKeys && (!key || keyComment && value == null && !ctx.inFlow || identity.isCollection(key) || (identity.isScalar(key) ? key.type === Scalar.Scalar.BLOCK_FOLDED || key.type === Scalar.Scalar.BLOCK_LITERAL : typeof key === "object"));
      ctx = Object.assign({}, ctx, {
        allNullValues: false,
        implicitKey: !explicitKey && (simpleKeys || !allNullValues),
        indent: indent + indentStep
      });
      let keyCommentDone = false;
      let chompKeep = false;
      let str = stringify.stringify(key, ctx, () => keyCommentDone = true, () => chompKeep = true);
      if (!explicitKey && !ctx.inFlow && str.length > 1024) {
        if (simpleKeys)
          throw new Error("With simple keys, single line scalar must not span more than 1024 characters");
        explicitKey = true;
      }
      if (ctx.inFlow) {
        if (allNullValues || value == null) {
          if (keyCommentDone && onComment)
            onComment();
          return str === "" ? "?" : explicitKey ? `? ${str}` : str;
        }
      } else if (allNullValues && !simpleKeys || value == null && explicitKey) {
        str = `? ${str}`;
        if (keyComment && !keyCommentDone) {
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
        } else if (chompKeep && onChompKeep)
          onChompKeep();
        return str;
      }
      if (keyCommentDone)
        keyComment = null;
      if (explicitKey) {
        if (keyComment)
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
        str = `? ${str}
${indent}:`;
      } else {
        str = `${str}:`;
        if (keyComment)
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
      }
      let vsb, vcb, valueComment;
      if (identity.isNode(value)) {
        vsb = !!value.spaceBefore;
        vcb = value.commentBefore;
        valueComment = value.comment;
      } else {
        vsb = false;
        vcb = null;
        valueComment = null;
        if (value && typeof value === "object")
          value = doc.createNode(value);
      }
      ctx.implicitKey = false;
      if (!explicitKey && !keyComment && identity.isScalar(value))
        ctx.indentAtStart = str.length + 1;
      chompKeep = false;
      if (!indentSeq && indentStep.length >= 2 && !ctx.inFlow && !explicitKey && identity.isSeq(value) && !value.flow && !value.tag && !value.anchor) {
        ctx.indent = ctx.indent.substring(2);
      }
      let valueCommentDone = false;
      const valueStr = stringify.stringify(value, ctx, () => valueCommentDone = true, () => chompKeep = true);
      let ws = " ";
      if (keyComment || vsb || vcb) {
        ws = vsb ? "\n" : "";
        if (vcb) {
          const cs = commentString(vcb);
          ws += `
${stringifyComment.indentComment(cs, ctx.indent)}`;
        }
        if (valueStr === "" && !ctx.inFlow) {
          if (ws === "\n" && valueComment)
            ws = "\n\n";
        } else {
          ws += `
${ctx.indent}`;
        }
      } else if (!explicitKey && identity.isCollection(value)) {
        const vs0 = valueStr[0];
        const nl0 = valueStr.indexOf("\n");
        const hasNewline = nl0 !== -1;
        const flow = ctx.inFlow ?? value.flow ?? value.items.length === 0;
        if (hasNewline || !flow) {
          let hasPropsLine = false;
          if (hasNewline && (vs0 === "&" || vs0 === "!")) {
            let sp0 = valueStr.indexOf(" ");
            if (vs0 === "&" && sp0 !== -1 && sp0 < nl0 && valueStr[sp0 + 1] === "!") {
              sp0 = valueStr.indexOf(" ", sp0 + 1);
            }
            if (sp0 === -1 || nl0 < sp0)
              hasPropsLine = true;
          }
          if (!hasPropsLine)
            ws = `
${ctx.indent}`;
        }
      } else if (valueStr === "" || valueStr[0] === "\n") {
        ws = "";
      }
      str += ws + valueStr;
      if (ctx.inFlow) {
        if (valueCommentDone && onComment)
          onComment();
      } else if (valueComment && !valueCommentDone) {
        str += stringifyComment.lineComment(str, ctx.indent, commentString(valueComment));
      } else if (chompKeep && onChompKeep) {
        onChompKeep();
      }
      return str;
    }
    exports2.stringifyPair = stringifyPair;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/log.js
var require_log = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/log.js"(exports2) {
    "use strict";
    var node_process = require("process");
    function debug(logLevel, ...messages) {
      if (logLevel === "debug")
        console.log(...messages);
    }
    function warn(logLevel, warning) {
      if (logLevel === "debug" || logLevel === "warn") {
        if (typeof node_process.emitWarning === "function")
          node_process.emitWarning(warning);
        else
          console.warn(warning);
      }
    }
    exports2.debug = debug;
    exports2.warn = warn;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/merge.js
var require_merge = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/merge.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var MERGE_KEY = "<<";
    var merge = {
      identify: (value) => value === MERGE_KEY || typeof value === "symbol" && value.description === MERGE_KEY,
      default: "key",
      tag: "tag:yaml.org,2002:merge",
      test: /^<<$/,
      resolve: () => Object.assign(new Scalar.Scalar(Symbol(MERGE_KEY)), {
        addToJSMap: addMergeToJSMap
      }),
      stringify: () => MERGE_KEY
    };
    var isMergeKey = (ctx, key) => (merge.identify(key) || identity.isScalar(key) && (!key.type || key.type === Scalar.Scalar.PLAIN) && merge.identify(key.value)) && ctx?.doc.schema.tags.some((tag) => tag.tag === merge.tag && tag.default);
    function addMergeToJSMap(ctx, map, value) {
      const source = resolveAliasValue(ctx, value);
      if (identity.isSeq(source))
        for (const it of source.items)
          mergeValue(ctx, map, it);
      else if (Array.isArray(source))
        for (const it of source)
          mergeValue(ctx, map, it);
      else
        mergeValue(ctx, map, source);
    }
    function mergeValue(ctx, map, value) {
      const source = resolveAliasValue(ctx, value);
      if (!identity.isMap(source))
        throw new Error("Merge sources must be maps or map aliases");
      const srcMap = source.toJSON(null, ctx, Map);
      for (const [key, value2] of srcMap) {
        if (map instanceof Map) {
          if (!map.has(key))
            map.set(key, value2);
        } else if (map instanceof Set) {
          map.add(key);
        } else if (!Object.prototype.hasOwnProperty.call(map, key)) {
          Object.defineProperty(map, key, {
            value: value2,
            writable: true,
            enumerable: true,
            configurable: true
          });
        }
      }
      return map;
    }
    function resolveAliasValue(ctx, value) {
      return ctx && identity.isAlias(value) ? value.resolve(ctx.doc, ctx) : value;
    }
    exports2.addMergeToJSMap = addMergeToJSMap;
    exports2.isMergeKey = isMergeKey;
    exports2.merge = merge;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/addPairToJSMap.js
var require_addPairToJSMap = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/addPairToJSMap.js"(exports2) {
    "use strict";
    var log = require_log();
    var merge = require_merge();
    var stringify = require_stringify();
    var identity = require_identity();
    var toJS = require_toJS();
    function addPairToJSMap(ctx, map, { key, value }) {
      if (identity.isNode(key) && key.addToJSMap)
        key.addToJSMap(ctx, map, value);
      else if (merge.isMergeKey(ctx, key))
        merge.addMergeToJSMap(ctx, map, value);
      else {
        const jsKey = toJS.toJS(key, "", ctx);
        if (map instanceof Map) {
          map.set(jsKey, toJS.toJS(value, jsKey, ctx));
        } else if (map instanceof Set) {
          map.add(jsKey);
        } else {
          const stringKey = stringifyKey(key, jsKey, ctx);
          const jsValue = toJS.toJS(value, stringKey, ctx);
          if (stringKey in map)
            Object.defineProperty(map, stringKey, {
              value: jsValue,
              writable: true,
              enumerable: true,
              configurable: true
            });
          else
            map[stringKey] = jsValue;
        }
      }
      return map;
    }
    function stringifyKey(key, jsKey, ctx) {
      if (jsKey === null)
        return "";
      if (typeof jsKey !== "object")
        return String(jsKey);
      if (identity.isNode(key) && ctx?.doc) {
        const strCtx = stringify.createStringifyContext(ctx.doc, {});
        strCtx.anchors = /* @__PURE__ */ new Set();
        for (const node of ctx.anchors.keys())
          strCtx.anchors.add(node.anchor);
        strCtx.inFlow = true;
        strCtx.inStringifyKey = true;
        const strKey = key.toString(strCtx);
        if (!ctx.mapKeyWarned) {
          let jsonStr = JSON.stringify(strKey);
          if (jsonStr.length > 40)
            jsonStr = jsonStr.substring(0, 36) + '..."';
          log.warn(ctx.doc.options.logLevel, `Keys with collection values will be stringified due to JS Object restrictions: ${jsonStr}. Set mapAsMap: true to use object keys.`);
          ctx.mapKeyWarned = true;
        }
        return strKey;
      }
      return JSON.stringify(jsKey);
    }
    exports2.addPairToJSMap = addPairToJSMap;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Pair.js
var require_Pair = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Pair.js"(exports2) {
    "use strict";
    var createNode = require_createNode();
    var stringifyPair = require_stringifyPair();
    var addPairToJSMap = require_addPairToJSMap();
    var identity = require_identity();
    function createPair(key, value, ctx) {
      const k = createNode.createNode(key, void 0, ctx);
      const v = createNode.createNode(value, void 0, ctx);
      return new Pair(k, v);
    }
    var Pair = class _Pair {
      constructor(key, value = null) {
        Object.defineProperty(this, identity.NODE_TYPE, { value: identity.PAIR });
        this.key = key;
        this.value = value;
      }
      clone(schema) {
        let { key, value } = this;
        if (identity.isNode(key))
          key = key.clone(schema);
        if (identity.isNode(value))
          value = value.clone(schema);
        return new _Pair(key, value);
      }
      toJSON(_, ctx) {
        const pair = ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
        return addPairToJSMap.addPairToJSMap(ctx, pair, this);
      }
      toString(ctx, onComment, onChompKeep) {
        return ctx?.doc ? stringifyPair.stringifyPair(this, ctx, onComment, onChompKeep) : JSON.stringify(this);
      }
    };
    exports2.Pair = Pair;
    exports2.createPair = createPair;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyCollection.js
var require_stringifyCollection = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyCollection.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var stringify = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyCollection(collection, ctx, options) {
      const flow = ctx.inFlow ?? collection.flow;
      const stringify2 = flow ? stringifyFlowCollection : stringifyBlockCollection;
      return stringify2(collection, ctx, options);
    }
    function stringifyBlockCollection({ comment, items }, ctx, { blockItemPrefix, flowChars, itemIndent, onChompKeep, onComment }) {
      const { indent, options: { commentString } } = ctx;
      const itemCtx = Object.assign({}, ctx, { indent: itemIndent, type: null });
      let chompKeep = false;
      const lines = [];
      for (let i = 0; i < items.length; ++i) {
        const item = items[i];
        let comment2 = null;
        if (identity.isNode(item)) {
          if (!chompKeep && item.spaceBefore)
            lines.push("");
          addCommentBefore(ctx, lines, item.commentBefore, chompKeep);
          if (item.comment)
            comment2 = item.comment;
        } else if (identity.isPair(item)) {
          const ik = identity.isNode(item.key) ? item.key : null;
          if (ik) {
            if (!chompKeep && ik.spaceBefore)
              lines.push("");
            addCommentBefore(ctx, lines, ik.commentBefore, chompKeep);
          }
        }
        chompKeep = false;
        let str2 = stringify.stringify(item, itemCtx, () => comment2 = null, () => chompKeep = true);
        if (comment2)
          str2 += stringifyComment.lineComment(str2, itemIndent, commentString(comment2));
        if (chompKeep && comment2)
          chompKeep = false;
        lines.push(blockItemPrefix + str2);
      }
      let str;
      if (lines.length === 0) {
        str = flowChars.start + flowChars.end;
      } else {
        str = lines[0];
        for (let i = 1; i < lines.length; ++i) {
          const line = lines[i];
          str += line ? `
${indent}${line}` : "\n";
        }
      }
      if (comment) {
        str += "\n" + stringifyComment.indentComment(commentString(comment), indent);
        if (onComment)
          onComment();
      } else if (chompKeep && onChompKeep)
        onChompKeep();
      return str;
    }
    function stringifyFlowCollection({ items }, ctx, { flowChars, itemIndent }) {
      const { indent, indentStep, flowCollectionPadding: fcPadding, options: { commentString } } = ctx;
      itemIndent += indentStep;
      const itemCtx = Object.assign({}, ctx, {
        indent: itemIndent,
        inFlow: true,
        type: null
      });
      let reqNewline = false;
      let linesAtValue = 0;
      const lines = [];
      for (let i = 0; i < items.length; ++i) {
        const item = items[i];
        let comment = null;
        if (identity.isNode(item)) {
          if (item.spaceBefore)
            lines.push("");
          addCommentBefore(ctx, lines, item.commentBefore, false);
          if (item.comment)
            comment = item.comment;
        } else if (identity.isPair(item)) {
          const ik = identity.isNode(item.key) ? item.key : null;
          if (ik) {
            if (ik.spaceBefore)
              lines.push("");
            addCommentBefore(ctx, lines, ik.commentBefore, false);
            if (ik.comment)
              reqNewline = true;
          }
          const iv = identity.isNode(item.value) ? item.value : null;
          if (iv) {
            if (iv.comment)
              comment = iv.comment;
            if (iv.commentBefore)
              reqNewline = true;
          } else if (item.value == null && ik?.comment) {
            comment = ik.comment;
          }
        }
        if (comment)
          reqNewline = true;
        let str = stringify.stringify(item, itemCtx, () => comment = null);
        reqNewline || (reqNewline = lines.length > linesAtValue || str.includes("\n"));
        if (i < items.length - 1) {
          str += ",";
        } else if (ctx.options.trailingComma) {
          if (ctx.options.lineWidth > 0) {
            reqNewline || (reqNewline = lines.reduce((sum, line) => sum + line.length + 2, 2) + (str.length + 2) > ctx.options.lineWidth);
          }
          if (reqNewline) {
            str += ",";
          }
        }
        if (comment)
          str += stringifyComment.lineComment(str, itemIndent, commentString(comment));
        lines.push(str);
        linesAtValue = lines.length;
      }
      const { start, end } = flowChars;
      if (lines.length === 0) {
        return start + end;
      } else {
        if (!reqNewline) {
          const len = lines.reduce((sum, line) => sum + line.length + 2, 2);
          reqNewline = ctx.options.lineWidth > 0 && len > ctx.options.lineWidth;
        }
        if (reqNewline) {
          let str = start;
          for (const line of lines)
            str += line ? `
${indentStep}${indent}${line}` : "\n";
          return `${str}
${indent}${end}`;
        } else {
          return `${start}${fcPadding}${lines.join(" ")}${fcPadding}${end}`;
        }
      }
    }
    function addCommentBefore({ indent, options: { commentString } }, lines, comment, chompKeep) {
      if (comment && chompKeep)
        comment = comment.replace(/^\n+/, "");
      if (comment) {
        const ic = stringifyComment.indentComment(commentString(comment), indent);
        lines.push(ic.trimStart());
      }
    }
    exports2.stringifyCollection = stringifyCollection;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/YAMLMap.js
var require_YAMLMap = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/YAMLMap.js"(exports2) {
    "use strict";
    var stringifyCollection = require_stringifyCollection();
    var addPairToJSMap = require_addPairToJSMap();
    var Collection = require_Collection();
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    function findPair(items, key) {
      const k = identity.isScalar(key) ? key.value : key;
      for (const it of items) {
        if (identity.isPair(it)) {
          if (it.key === key || it.key === k)
            return it;
          if (identity.isScalar(it.key) && it.key.value === k)
            return it;
        }
      }
      return void 0;
    }
    var YAMLMap = class extends Collection.Collection {
      static get tagName() {
        return "tag:yaml.org,2002:map";
      }
      constructor(schema) {
        super(identity.MAP, schema);
        this.items = [];
      }
      /**
       * A generic collection parsing method that can be extended
       * to other node classes that inherit from YAMLMap
       */
      static from(schema, obj, ctx) {
        const { keepUndefined, replacer } = ctx;
        const map = new this(schema);
        const add = (key, value) => {
          if (typeof replacer === "function")
            value = replacer.call(obj, key, value);
          else if (Array.isArray(replacer) && !replacer.includes(key))
            return;
          if (value !== void 0 || keepUndefined)
            map.items.push(Pair.createPair(key, value, ctx));
        };
        if (obj instanceof Map) {
          for (const [key, value] of obj)
            add(key, value);
        } else if (obj && typeof obj === "object") {
          for (const key of Object.keys(obj))
            add(key, obj[key]);
        }
        if (typeof schema.sortMapEntries === "function") {
          map.items.sort(schema.sortMapEntries);
        }
        return map;
      }
      /**
       * Adds a value to the collection.
       *
       * @param overwrite - If not set `true`, using a key that is already in the
       *   collection will throw. Otherwise, overwrites the previous value.
       */
      add(pair, overwrite) {
        let _pair;
        if (identity.isPair(pair))
          _pair = pair;
        else if (!pair || typeof pair !== "object" || !("key" in pair)) {
          _pair = new Pair.Pair(pair, pair?.value);
        } else
          _pair = new Pair.Pair(pair.key, pair.value);
        const prev = findPair(this.items, _pair.key);
        const sortEntries = this.schema?.sortMapEntries;
        if (prev) {
          if (!overwrite)
            throw new Error(`Key ${_pair.key} already set`);
          if (identity.isScalar(prev.value) && Scalar.isScalarValue(_pair.value))
            prev.value.value = _pair.value;
          else
            prev.value = _pair.value;
        } else if (sortEntries) {
          const i = this.items.findIndex((item) => sortEntries(_pair, item) < 0);
          if (i === -1)
            this.items.push(_pair);
          else
            this.items.splice(i, 0, _pair);
        } else {
          this.items.push(_pair);
        }
      }
      delete(key) {
        const it = findPair(this.items, key);
        if (!it)
          return false;
        const del = this.items.splice(this.items.indexOf(it), 1);
        return del.length > 0;
      }
      get(key, keepScalar) {
        const it = findPair(this.items, key);
        const node = it?.value;
        return (!keepScalar && identity.isScalar(node) ? node.value : node) ?? void 0;
      }
      has(key) {
        return !!findPair(this.items, key);
      }
      set(key, value) {
        this.add(new Pair.Pair(key, value), true);
      }
      /**
       * @param ctx - Conversion context, originally set in Document#toJS()
       * @param {Class} Type - If set, forces the returned collection type
       * @returns Instance of Type, Map, or Object
       */
      toJSON(_, ctx, Type) {
        const map = Type ? new Type() : ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
        if (ctx?.onCreate)
          ctx.onCreate(map);
        for (const item of this.items)
          addPairToJSMap.addPairToJSMap(ctx, map, item);
        return map;
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        for (const item of this.items) {
          if (!identity.isPair(item))
            throw new Error(`Map items must all be pairs; found ${JSON.stringify(item)} instead`);
        }
        if (!ctx.allNullValues && this.hasAllNullValues(false))
          ctx = Object.assign({}, ctx, { allNullValues: true });
        return stringifyCollection.stringifyCollection(this, ctx, {
          blockItemPrefix: "",
          flowChars: { start: "{", end: "}" },
          itemIndent: ctx.indent || "",
          onChompKeep,
          onComment
        });
      }
    };
    exports2.YAMLMap = YAMLMap;
    exports2.findPair = findPair;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/map.js
var require_map = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/map.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var YAMLMap = require_YAMLMap();
    var map = {
      collection: "map",
      default: true,
      nodeClass: YAMLMap.YAMLMap,
      tag: "tag:yaml.org,2002:map",
      resolve(map2, onError) {
        if (!identity.isMap(map2))
          onError("Expected a mapping for this tag");
        return map2;
      },
      createNode: (schema, obj, ctx) => YAMLMap.YAMLMap.from(schema, obj, ctx)
    };
    exports2.map = map;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/YAMLSeq.js
var require_YAMLSeq = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/YAMLSeq.js"(exports2) {
    "use strict";
    var createNode = require_createNode();
    var stringifyCollection = require_stringifyCollection();
    var Collection = require_Collection();
    var identity = require_identity();
    var Scalar = require_Scalar();
    var toJS = require_toJS();
    var YAMLSeq = class extends Collection.Collection {
      static get tagName() {
        return "tag:yaml.org,2002:seq";
      }
      constructor(schema) {
        super(identity.SEQ, schema);
        this.items = [];
      }
      add(value) {
        this.items.push(value);
      }
      /**
       * Removes a value from the collection.
       *
       * `key` must contain a representation of an integer for this to succeed.
       * It may be wrapped in a `Scalar`.
       *
       * @returns `true` if the item was found and removed.
       */
      delete(key) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          return false;
        const del = this.items.splice(idx, 1);
        return del.length > 0;
      }
      get(key, keepScalar) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          return void 0;
        const it = this.items[idx];
        return !keepScalar && identity.isScalar(it) ? it.value : it;
      }
      /**
       * Checks if the collection includes a value with the key `key`.
       *
       * `key` must contain a representation of an integer for this to succeed.
       * It may be wrapped in a `Scalar`.
       */
      has(key) {
        const idx = asItemIndex(key);
        return typeof idx === "number" && idx < this.items.length;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       *
       * If `key` does not contain a representation of an integer, this will throw.
       * It may be wrapped in a `Scalar`.
       */
      set(key, value) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          throw new Error(`Expected a valid index, not ${key}.`);
        const prev = this.items[idx];
        if (identity.isScalar(prev) && Scalar.isScalarValue(value))
          prev.value = value;
        else
          this.items[idx] = value;
      }
      toJSON(_, ctx) {
        const seq = [];
        if (ctx?.onCreate)
          ctx.onCreate(seq);
        let i = 0;
        for (const item of this.items)
          seq.push(toJS.toJS(item, String(i++), ctx));
        return seq;
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        return stringifyCollection.stringifyCollection(this, ctx, {
          blockItemPrefix: "- ",
          flowChars: { start: "[", end: "]" },
          itemIndent: (ctx.indent || "") + "  ",
          onChompKeep,
          onComment
        });
      }
      static from(schema, obj, ctx) {
        const { replacer } = ctx;
        const seq = new this(schema);
        if (obj && Symbol.iterator in Object(obj)) {
          let i = 0;
          for (let it of obj) {
            if (typeof replacer === "function") {
              const key = obj instanceof Set ? it : String(i++);
              it = replacer.call(obj, key, it);
            }
            seq.items.push(createNode.createNode(it, void 0, ctx));
          }
        }
        return seq;
      }
    };
    function asItemIndex(key) {
      let idx = identity.isScalar(key) ? key.value : key;
      if (idx && typeof idx === "string")
        idx = Number(idx);
      return typeof idx === "number" && Number.isInteger(idx) && idx >= 0 ? idx : null;
    }
    exports2.YAMLSeq = YAMLSeq;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/seq.js
var require_seq = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/seq.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var YAMLSeq = require_YAMLSeq();
    var seq = {
      collection: "seq",
      default: true,
      nodeClass: YAMLSeq.YAMLSeq,
      tag: "tag:yaml.org,2002:seq",
      resolve(seq2, onError) {
        if (!identity.isSeq(seq2))
          onError("Expected a sequence for this tag");
        return seq2;
      },
      createNode: (schema, obj, ctx) => YAMLSeq.YAMLSeq.from(schema, obj, ctx)
    };
    exports2.seq = seq;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/string.js
var require_string = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/string.js"(exports2) {
    "use strict";
    var stringifyString = require_stringifyString();
    var string = {
      identify: (value) => typeof value === "string",
      default: true,
      tag: "tag:yaml.org,2002:str",
      resolve: (str) => str,
      stringify(item, ctx, onComment, onChompKeep) {
        ctx = Object.assign({ actualString: true }, ctx);
        return stringifyString.stringifyString(item, ctx, onComment, onChompKeep);
      }
    };
    exports2.string = string;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/null.js
var require_null = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/null.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    var nullTag = {
      identify: (value) => value == null,
      createNode: () => new Scalar.Scalar(null),
      default: true,
      tag: "tag:yaml.org,2002:null",
      test: /^(?:~|[Nn]ull|NULL)?$/,
      resolve: () => new Scalar.Scalar(null),
      stringify: ({ source }, ctx) => typeof source === "string" && nullTag.test.test(source) ? source : ctx.options.nullStr
    };
    exports2.nullTag = nullTag;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/bool.js
var require_bool = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/bool.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    var boolTag = {
      identify: (value) => typeof value === "boolean",
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$/,
      resolve: (str) => new Scalar.Scalar(str[0] === "t" || str[0] === "T"),
      stringify({ source, value }, ctx) {
        if (source && boolTag.test.test(source)) {
          const sv = source[0] === "t" || source[0] === "T";
          if (value === sv)
            return source;
        }
        return value ? ctx.options.trueStr : ctx.options.falseStr;
      }
    };
    exports2.boolTag = boolTag;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyNumber.js
var require_stringifyNumber = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyNumber.js"(exports2) {
    "use strict";
    function stringifyNumber({ format, minFractionDigits, tag, value }) {
      if (typeof value === "bigint")
        return String(value);
      const num = typeof value === "number" ? value : Number(value);
      if (!isFinite(num))
        return isNaN(num) ? ".nan" : num < 0 ? "-.inf" : ".inf";
      let n = Object.is(value, -0) ? "-0" : JSON.stringify(value);
      if (!format && minFractionDigits && (!tag || tag === "tag:yaml.org,2002:float") && /^-?\d/.test(n) && !n.includes("e")) {
        let i = n.indexOf(".");
        if (i < 0) {
          i = n.length;
          n += ".";
        }
        let d = minFractionDigits - (n.length - i - 1);
        while (d-- > 0)
          n += "0";
      }
      return n;
    }
    exports2.stringifyNumber = stringifyNumber;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/float.js
var require_float = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/float.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    var stringifyNumber = require_stringifyNumber();
    var floatNaN = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
      resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
      stringify: stringifyNumber.stringifyNumber
    };
    var floatExp = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "EXP",
      test: /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$/,
      resolve: (str) => parseFloat(str),
      stringify(node) {
        const num = Number(node.value);
        return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
      }
    };
    var float = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$/,
      resolve(str) {
        const node = new Scalar.Scalar(parseFloat(str));
        const dot = str.indexOf(".");
        if (dot !== -1 && str[str.length - 1] === "0")
          node.minFractionDigits = str.length - dot - 1;
        return node;
      },
      stringify: stringifyNumber.stringifyNumber
    };
    exports2.float = float;
    exports2.floatExp = floatExp;
    exports2.floatNaN = floatNaN;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/int.js
var require_int = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/int.js"(exports2) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    var intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
    var intResolve = (str, offset, radix, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str.substring(offset), radix);
    function intStringify(node, radix, prefix) {
      const { value } = node;
      if (intIdentify(value) && value >= 0)
        return prefix + value.toString(radix);
      return stringifyNumber.stringifyNumber(node);
    }
    var intOct = {
      identify: (value) => intIdentify(value) && value >= 0,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "OCT",
      test: /^0o[0-7]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 8, opt),
      stringify: (node) => intStringify(node, 8, "0o")
    };
    var int = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      test: /^[-+]?[0-9]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
      stringify: stringifyNumber.stringifyNumber
    };
    var intHex = {
      identify: (value) => intIdentify(value) && value >= 0,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "HEX",
      test: /^0x[0-9a-fA-F]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
      stringify: (node) => intStringify(node, 16, "0x")
    };
    exports2.int = int;
    exports2.intHex = intHex;
    exports2.intOct = intOct;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/schema.js
var require_schema = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/schema.js"(exports2) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var bool = require_bool();
    var float = require_float();
    var int = require_int();
    var schema = [
      map.map,
      seq.seq,
      string.string,
      _null.nullTag,
      bool.boolTag,
      int.intOct,
      int.int,
      int.intHex,
      float.floatNaN,
      float.floatExp,
      float.float
    ];
    exports2.schema = schema;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/json/schema.js
var require_schema2 = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/json/schema.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    var map = require_map();
    var seq = require_seq();
    function intIdentify(value) {
      return typeof value === "bigint" || Number.isInteger(value);
    }
    var stringifyJSON = ({ value }) => JSON.stringify(value);
    var jsonScalars = [
      {
        identify: (value) => typeof value === "string",
        default: true,
        tag: "tag:yaml.org,2002:str",
        resolve: (str) => str,
        stringify: stringifyJSON
      },
      {
        identify: (value) => value == null,
        createNode: () => new Scalar.Scalar(null),
        default: true,
        tag: "tag:yaml.org,2002:null",
        test: /^null$/,
        resolve: () => null,
        stringify: stringifyJSON
      },
      {
        identify: (value) => typeof value === "boolean",
        default: true,
        tag: "tag:yaml.org,2002:bool",
        test: /^true$|^false$/,
        resolve: (str) => str === "true",
        stringify: stringifyJSON
      },
      {
        identify: intIdentify,
        default: true,
        tag: "tag:yaml.org,2002:int",
        test: /^-?(?:0|[1-9][0-9]*)$/,
        resolve: (str, _onError, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str, 10),
        stringify: ({ value }) => intIdentify(value) ? value.toString() : JSON.stringify(value)
      },
      {
        identify: (value) => typeof value === "number",
        default: true,
        tag: "tag:yaml.org,2002:float",
        test: /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$/,
        resolve: (str) => parseFloat(str),
        stringify: stringifyJSON
      }
    ];
    var jsonError = {
      default: true,
      tag: "",
      test: /^/,
      resolve(str, onError) {
        onError(`Unresolved plain scalar ${JSON.stringify(str)}`);
        return str;
      }
    };
    var schema = [map.map, seq.seq].concat(jsonScalars, jsonError);
    exports2.schema = schema;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/binary.js
var require_binary = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/binary.js"(exports2) {
    "use strict";
    var node_buffer = require("buffer");
    var Scalar = require_Scalar();
    var stringifyString = require_stringifyString();
    var binary = {
      identify: (value) => value instanceof Uint8Array,
      // Buffer inherits from Uint8Array
      default: false,
      tag: "tag:yaml.org,2002:binary",
      /**
       * Returns a Buffer in node and an Uint8Array in browsers
       *
       * To use the resulting buffer as an image, you'll want to do something like:
       *
       *   const blob = new Blob([buffer], { type: 'image/jpeg' })
       *   document.querySelector('#photo').src = URL.createObjectURL(blob)
       */
      resolve(src, onError) {
        if (typeof node_buffer.Buffer === "function") {
          return node_buffer.Buffer.from(src, "base64");
        } else if (typeof atob === "function") {
          const str = atob(src.replace(/[\n\r]/g, ""));
          const buffer = new Uint8Array(str.length);
          for (let i = 0; i < str.length; ++i)
            buffer[i] = str.charCodeAt(i);
          return buffer;
        } else {
          onError("This environment does not support reading binary tags; either Buffer or atob is required");
          return src;
        }
      },
      stringify({ comment, type, value }, ctx, onComment, onChompKeep) {
        if (!value)
          return "";
        const buf = value;
        let str;
        if (typeof node_buffer.Buffer === "function") {
          str = buf instanceof node_buffer.Buffer ? buf.toString("base64") : node_buffer.Buffer.from(buf.buffer).toString("base64");
        } else if (typeof btoa === "function") {
          let s = "";
          for (let i = 0; i < buf.length; ++i)
            s += String.fromCharCode(buf[i]);
          str = btoa(s);
        } else {
          throw new Error("This environment does not support writing binary tags; either Buffer or btoa is required");
        }
        type ?? (type = Scalar.Scalar.BLOCK_LITERAL);
        if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
          const lineWidth = Math.max(ctx.options.lineWidth - ctx.indent.length, ctx.options.minContentWidth);
          const n = Math.ceil(str.length / lineWidth);
          const lines = new Array(n);
          for (let i = 0, o = 0; i < n; ++i, o += lineWidth) {
            lines[i] = str.substr(o, lineWidth);
          }
          str = lines.join(type === Scalar.Scalar.BLOCK_LITERAL ? "\n" : " ");
        }
        return stringifyString.stringifyString({ comment, type, value: str }, ctx, onComment, onChompKeep);
      }
    };
    exports2.binary = binary;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/pairs.js
var require_pairs = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/pairs.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    var YAMLSeq = require_YAMLSeq();
    function resolvePairs(seq, onError) {
      if (identity.isSeq(seq)) {
        for (let i = 0; i < seq.items.length; ++i) {
          let item = seq.items[i];
          if (identity.isPair(item))
            continue;
          else if (identity.isMap(item)) {
            if (item.items.length > 1)
              onError("Each pair must have its own sequence indicator");
            const pair = item.items[0] || new Pair.Pair(new Scalar.Scalar(null));
            if (item.commentBefore)
              pair.key.commentBefore = pair.key.commentBefore ? `${item.commentBefore}
${pair.key.commentBefore}` : item.commentBefore;
            if (item.comment) {
              const cn = pair.value ?? pair.key;
              cn.comment = cn.comment ? `${item.comment}
${cn.comment}` : item.comment;
            }
            item = pair;
          }
          seq.items[i] = identity.isPair(item) ? item : new Pair.Pair(item);
        }
      } else
        onError("Expected a sequence for this tag");
      return seq;
    }
    function createPairs(schema, iterable, ctx) {
      const { replacer } = ctx;
      const pairs2 = new YAMLSeq.YAMLSeq(schema);
      pairs2.tag = "tag:yaml.org,2002:pairs";
      let i = 0;
      if (iterable && Symbol.iterator in Object(iterable))
        for (let it of iterable) {
          if (typeof replacer === "function")
            it = replacer.call(iterable, String(i++), it);
          let key, value;
          if (Array.isArray(it)) {
            if (it.length === 2) {
              key = it[0];
              value = it[1];
            } else
              throw new TypeError(`Expected [key, value] tuple: ${it}`);
          } else if (it && it instanceof Object) {
            const keys = Object.keys(it);
            if (keys.length === 1) {
              key = keys[0];
              value = it[key];
            } else {
              throw new TypeError(`Expected tuple with one key, not ${keys.length} keys`);
            }
          } else {
            key = it;
          }
          pairs2.items.push(Pair.createPair(key, value, ctx));
        }
      return pairs2;
    }
    var pairs = {
      collection: "seq",
      default: false,
      tag: "tag:yaml.org,2002:pairs",
      resolve: resolvePairs,
      createNode: createPairs
    };
    exports2.createPairs = createPairs;
    exports2.pairs = pairs;
    exports2.resolvePairs = resolvePairs;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/omap.js
var require_omap = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/omap.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var toJS = require_toJS();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var pairs = require_pairs();
    var YAMLOMap = class _YAMLOMap extends YAMLSeq.YAMLSeq {
      constructor() {
        super();
        this.add = YAMLMap.YAMLMap.prototype.add.bind(this);
        this.delete = YAMLMap.YAMLMap.prototype.delete.bind(this);
        this.get = YAMLMap.YAMLMap.prototype.get.bind(this);
        this.has = YAMLMap.YAMLMap.prototype.has.bind(this);
        this.set = YAMLMap.YAMLMap.prototype.set.bind(this);
        this.tag = _YAMLOMap.tag;
      }
      /**
       * If `ctx` is given, the return type is actually `Map<unknown, unknown>`,
       * but TypeScript won't allow widening the signature of a child method.
       */
      toJSON(_, ctx) {
        if (!ctx)
          return super.toJSON(_);
        const map = /* @__PURE__ */ new Map();
        if (ctx?.onCreate)
          ctx.onCreate(map);
        for (const pair of this.items) {
          let key, value;
          if (identity.isPair(pair)) {
            key = toJS.toJS(pair.key, "", ctx);
            value = toJS.toJS(pair.value, key, ctx);
          } else {
            key = toJS.toJS(pair, "", ctx);
          }
          if (map.has(key))
            throw new Error("Ordered maps must not include duplicate keys");
          map.set(key, value);
        }
        return map;
      }
      static from(schema, iterable, ctx) {
        const pairs$1 = pairs.createPairs(schema, iterable, ctx);
        const omap2 = new this();
        omap2.items = pairs$1.items;
        return omap2;
      }
    };
    YAMLOMap.tag = "tag:yaml.org,2002:omap";
    var omap = {
      collection: "seq",
      identify: (value) => value instanceof Map,
      nodeClass: YAMLOMap,
      default: false,
      tag: "tag:yaml.org,2002:omap",
      resolve(seq, onError) {
        const pairs$1 = pairs.resolvePairs(seq, onError);
        const seenKeys = [];
        for (const { key } of pairs$1.items) {
          if (identity.isScalar(key)) {
            if (seenKeys.includes(key.value)) {
              onError(`Ordered maps must not include duplicate keys: ${key.value}`);
            } else {
              seenKeys.push(key.value);
            }
          }
        }
        return Object.assign(new YAMLOMap(), pairs$1);
      },
      createNode: (schema, iterable, ctx) => YAMLOMap.from(schema, iterable, ctx)
    };
    exports2.YAMLOMap = YAMLOMap;
    exports2.omap = omap;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/bool.js
var require_bool2 = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/bool.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    function boolStringify({ value, source }, ctx) {
      const boolObj = value ? trueTag : falseTag;
      if (source && boolObj.test.test(source))
        return source;
      return value ? ctx.options.trueStr : ctx.options.falseStr;
    }
    var trueTag = {
      identify: (value) => value === true,
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:Y|y|[Yy]es|YES|[Tt]rue|TRUE|[Oo]n|ON)$/,
      resolve: () => new Scalar.Scalar(true),
      stringify: boolStringify
    };
    var falseTag = {
      identify: (value) => value === false,
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:N|n|[Nn]o|NO|[Ff]alse|FALSE|[Oo]ff|OFF)$/,
      resolve: () => new Scalar.Scalar(false),
      stringify: boolStringify
    };
    exports2.falseTag = falseTag;
    exports2.trueTag = trueTag;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/float.js
var require_float2 = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/float.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    var stringifyNumber = require_stringifyNumber();
    var floatNaN = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
      resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
      stringify: stringifyNumber.stringifyNumber
    };
    var floatExp = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "EXP",
      test: /^[-+]?(?:[0-9][0-9_]*)?(?:\.[0-9_]*)?[eE][-+]?[0-9]+$/,
      resolve: (str) => parseFloat(str.replace(/_/g, "")),
      stringify(node) {
        const num = Number(node.value);
        return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
      }
    };
    var float = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^[-+]?(?:[0-9][0-9_]*)?\.[0-9_]*$/,
      resolve(str) {
        const node = new Scalar.Scalar(parseFloat(str.replace(/_/g, "")));
        const dot = str.indexOf(".");
        if (dot !== -1) {
          const f = str.substring(dot + 1).replace(/_/g, "");
          if (f[f.length - 1] === "0")
            node.minFractionDigits = f.length;
        }
        return node;
      },
      stringify: stringifyNumber.stringifyNumber
    };
    exports2.float = float;
    exports2.floatExp = floatExp;
    exports2.floatNaN = floatNaN;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/int.js
var require_int2 = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/int.js"(exports2) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    var intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
    function intResolve(str, offset, radix, { intAsBigInt }) {
      const sign = str[0];
      if (sign === "-" || sign === "+")
        offset += 1;
      str = str.substring(offset).replace(/_/g, "");
      if (intAsBigInt) {
        switch (radix) {
          case 2:
            str = `0b${str}`;
            break;
          case 8:
            str = `0o${str}`;
            break;
          case 16:
            str = `0x${str}`;
            break;
        }
        const n2 = BigInt(str);
        return sign === "-" ? BigInt(-1) * n2 : n2;
      }
      const n = parseInt(str, radix);
      return sign === "-" ? -1 * n : n;
    }
    function intStringify(node, radix, prefix) {
      const { value } = node;
      if (intIdentify(value)) {
        const str = value.toString(radix);
        return value < 0 ? "-" + prefix + str.substr(1) : prefix + str;
      }
      return stringifyNumber.stringifyNumber(node);
    }
    var intBin = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "BIN",
      test: /^[-+]?0b[0-1_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 2, opt),
      stringify: (node) => intStringify(node, 2, "0b")
    };
    var intOct = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "OCT",
      test: /^[-+]?0[0-7_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 1, 8, opt),
      stringify: (node) => intStringify(node, 8, "0")
    };
    var int = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      test: /^[-+]?[0-9][0-9_]*$/,
      resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
      stringify: stringifyNumber.stringifyNumber
    };
    var intHex = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "HEX",
      test: /^[-+]?0x[0-9a-fA-F_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
      stringify: (node) => intStringify(node, 16, "0x")
    };
    exports2.int = int;
    exports2.intBin = intBin;
    exports2.intHex = intHex;
    exports2.intOct = intOct;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/set.js
var require_set = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/set.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var YAMLSet = class _YAMLSet extends YAMLMap.YAMLMap {
      constructor(schema) {
        super(schema);
        this.tag = _YAMLSet.tag;
      }
      add(key) {
        let pair;
        if (identity.isPair(key))
          pair = key;
        else if (key && typeof key === "object" && "key" in key && "value" in key && key.value === null)
          pair = new Pair.Pair(key.key, null);
        else
          pair = new Pair.Pair(key, null);
        const prev = YAMLMap.findPair(this.items, pair.key);
        if (!prev)
          this.items.push(pair);
      }
      /**
       * If `keepPair` is `true`, returns the Pair matching `key`.
       * Otherwise, returns the value of that Pair's key.
       */
      get(key, keepPair) {
        const pair = YAMLMap.findPair(this.items, key);
        return !keepPair && identity.isPair(pair) ? identity.isScalar(pair.key) ? pair.key.value : pair.key : pair;
      }
      set(key, value) {
        if (typeof value !== "boolean")
          throw new Error(`Expected boolean value for set(key, value) in a YAML set, not ${typeof value}`);
        const prev = YAMLMap.findPair(this.items, key);
        if (prev && !value) {
          this.items.splice(this.items.indexOf(prev), 1);
        } else if (!prev && value) {
          this.items.push(new Pair.Pair(key));
        }
      }
      toJSON(_, ctx) {
        return super.toJSON(_, ctx, Set);
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        if (this.hasAllNullValues(true))
          return super.toString(Object.assign({}, ctx, { allNullValues: true }), onComment, onChompKeep);
        else
          throw new Error("Set items must all have null values");
      }
      static from(schema, iterable, ctx) {
        const { replacer } = ctx;
        const set2 = new this(schema);
        if (iterable && Symbol.iterator in Object(iterable))
          for (let value of iterable) {
            if (typeof replacer === "function")
              value = replacer.call(iterable, value, value);
            set2.items.push(Pair.createPair(value, null, ctx));
          }
        return set2;
      }
    };
    YAMLSet.tag = "tag:yaml.org,2002:set";
    var set = {
      collection: "map",
      identify: (value) => value instanceof Set,
      nodeClass: YAMLSet,
      default: false,
      tag: "tag:yaml.org,2002:set",
      createNode: (schema, iterable, ctx) => YAMLSet.from(schema, iterable, ctx),
      resolve(map, onError) {
        if (identity.isMap(map)) {
          if (map.hasAllNullValues(true))
            return Object.assign(new YAMLSet(), map);
          else
            onError("Set items must all have null values");
        } else
          onError("Expected a mapping for this tag");
        return map;
      }
    };
    exports2.YAMLSet = YAMLSet;
    exports2.set = set;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/timestamp.js
var require_timestamp = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/timestamp.js"(exports2) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    function parseSexagesimal(str, asBigInt) {
      const sign = str[0];
      const parts = sign === "-" || sign === "+" ? str.substring(1) : str;
      const num = (n) => asBigInt ? BigInt(n) : Number(n);
      const res = parts.replace(/_/g, "").split(":").reduce((res2, p) => res2 * num(60) + num(p), num(0));
      return sign === "-" ? num(-1) * res : res;
    }
    function stringifySexagesimal(node) {
      let { value } = node;
      let num = (n) => n;
      if (typeof value === "bigint")
        num = (n) => BigInt(n);
      else if (isNaN(value) || !isFinite(value))
        return stringifyNumber.stringifyNumber(node);
      let sign = "";
      if (value < 0) {
        sign = "-";
        value *= num(-1);
      }
      const _60 = num(60);
      const parts = [value % _60];
      if (value < 60) {
        parts.unshift(0);
      } else {
        value = (value - parts[0]) / _60;
        parts.unshift(value % _60);
        if (value >= 60) {
          value = (value - parts[0]) / _60;
          parts.unshift(value);
        }
      }
      return sign + parts.map((n) => String(n).padStart(2, "0")).join(":").replace(/000000\d*$/, "");
    }
    var intTime = {
      identify: (value) => typeof value === "bigint" || Number.isInteger(value),
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "TIME",
      test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+$/,
      resolve: (str, _onError, { intAsBigInt }) => parseSexagesimal(str, intAsBigInt),
      stringify: stringifySexagesimal
    };
    var floatTime = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "TIME",
      test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*$/,
      resolve: (str) => parseSexagesimal(str, false),
      stringify: stringifySexagesimal
    };
    var timestamp = {
      identify: (value) => value instanceof Date,
      default: true,
      tag: "tag:yaml.org,2002:timestamp",
      // If the time zone is omitted, the timestamp is assumed to be specified in UTC. The time part
      // may be omitted altogether, resulting in a date format. In such a case, the time part is
      // assumed to be 00:00:00Z (start of day, UTC).
      test: RegExp("^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?:(?:t|T|[ \\t]+)([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2}(\\.[0-9]+)?)(?:[ \\t]*(Z|[-+][012]?[0-9](?::[0-9]{2})?))?)?$"),
      resolve(str) {
        const match = str.match(timestamp.test);
        if (!match)
          throw new Error("!!timestamp expects a date, starting with yyyy-mm-dd");
        const [, year, month, day, hour, minute, second] = match.map(Number);
        const millisec = match[7] ? Number((match[7] + "00").substr(1, 3)) : 0;
        let date = Date.UTC(year, month - 1, day, hour || 0, minute || 0, second || 0, millisec);
        const tz = match[8];
        if (tz && tz !== "Z") {
          let d = parseSexagesimal(tz, false);
          if (Math.abs(d) < 30)
            d *= 60;
          date -= 6e4 * d;
        }
        return new Date(date);
      },
      stringify: ({ value }) => value?.toISOString().replace(/(T00:00:00)?\.000Z$/, "") ?? ""
    };
    exports2.floatTime = floatTime;
    exports2.intTime = intTime;
    exports2.timestamp = timestamp;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/schema.js
var require_schema3 = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/schema.js"(exports2) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var binary = require_binary();
    var bool = require_bool2();
    var float = require_float2();
    var int = require_int2();
    var merge = require_merge();
    var omap = require_omap();
    var pairs = require_pairs();
    var set = require_set();
    var timestamp = require_timestamp();
    var schema = [
      map.map,
      seq.seq,
      string.string,
      _null.nullTag,
      bool.trueTag,
      bool.falseTag,
      int.intBin,
      int.intOct,
      int.int,
      int.intHex,
      float.floatNaN,
      float.floatExp,
      float.float,
      binary.binary,
      merge.merge,
      omap.omap,
      pairs.pairs,
      set.set,
      timestamp.intTime,
      timestamp.floatTime,
      timestamp.timestamp
    ];
    exports2.schema = schema;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/tags.js
var require_tags = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/tags.js"(exports2) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var bool = require_bool();
    var float = require_float();
    var int = require_int();
    var schema = require_schema();
    var schema$1 = require_schema2();
    var binary = require_binary();
    var merge = require_merge();
    var omap = require_omap();
    var pairs = require_pairs();
    var schema$2 = require_schema3();
    var set = require_set();
    var timestamp = require_timestamp();
    var schemas = /* @__PURE__ */ new Map([
      ["core", schema.schema],
      ["failsafe", [map.map, seq.seq, string.string]],
      ["json", schema$1.schema],
      ["yaml11", schema$2.schema],
      ["yaml-1.1", schema$2.schema]
    ]);
    var tagsByName = {
      binary: binary.binary,
      bool: bool.boolTag,
      float: float.float,
      floatExp: float.floatExp,
      floatNaN: float.floatNaN,
      floatTime: timestamp.floatTime,
      int: int.int,
      intHex: int.intHex,
      intOct: int.intOct,
      intTime: timestamp.intTime,
      map: map.map,
      merge: merge.merge,
      null: _null.nullTag,
      omap: omap.omap,
      pairs: pairs.pairs,
      seq: seq.seq,
      set: set.set,
      timestamp: timestamp.timestamp
    };
    var coreKnownTags = {
      "tag:yaml.org,2002:binary": binary.binary,
      "tag:yaml.org,2002:merge": merge.merge,
      "tag:yaml.org,2002:omap": omap.omap,
      "tag:yaml.org,2002:pairs": pairs.pairs,
      "tag:yaml.org,2002:set": set.set,
      "tag:yaml.org,2002:timestamp": timestamp.timestamp
    };
    function getTags(customTags, schemaName, addMergeTag) {
      const schemaTags = schemas.get(schemaName);
      if (schemaTags && !customTags) {
        return addMergeTag && !schemaTags.includes(merge.merge) ? schemaTags.concat(merge.merge) : schemaTags.slice();
      }
      let tags = schemaTags;
      if (!tags) {
        if (Array.isArray(customTags))
          tags = [];
        else {
          const keys = Array.from(schemas.keys()).filter((key) => key !== "yaml11").map((key) => JSON.stringify(key)).join(", ");
          throw new Error(`Unknown schema "${schemaName}"; use one of ${keys} or define customTags array`);
        }
      }
      if (Array.isArray(customTags)) {
        for (const tag of customTags)
          tags = tags.concat(tag);
      } else if (typeof customTags === "function") {
        tags = customTags(tags.slice());
      }
      if (addMergeTag)
        tags = tags.concat(merge.merge);
      return tags.reduce((tags2, tag) => {
        const tagObj = typeof tag === "string" ? tagsByName[tag] : tag;
        if (!tagObj) {
          const tagName = JSON.stringify(tag);
          const keys = Object.keys(tagsByName).map((key) => JSON.stringify(key)).join(", ");
          throw new Error(`Unknown custom tag ${tagName}; use one of ${keys}`);
        }
        if (!tags2.includes(tagObj))
          tags2.push(tagObj);
        return tags2;
      }, []);
    }
    exports2.coreKnownTags = coreKnownTags;
    exports2.getTags = getTags;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/Schema.js
var require_Schema = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/Schema.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var map = require_map();
    var seq = require_seq();
    var string = require_string();
    var tags = require_tags();
    var sortMapEntriesByKey = (a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    var Schema = class _Schema {
      constructor({ compat, customTags, merge, resolveKnownTags, schema, sortMapEntries, toStringDefaults }) {
        this.compat = Array.isArray(compat) ? tags.getTags(compat, "compat") : compat ? tags.getTags(null, compat) : null;
        this.name = typeof schema === "string" && schema || "core";
        this.knownTags = resolveKnownTags ? tags.coreKnownTags : {};
        this.tags = tags.getTags(customTags, this.name, merge);
        this.toStringOptions = toStringDefaults ?? null;
        Object.defineProperty(this, identity.MAP, { value: map.map });
        Object.defineProperty(this, identity.SCALAR, { value: string.string });
        Object.defineProperty(this, identity.SEQ, { value: seq.seq });
        this.sortMapEntries = typeof sortMapEntries === "function" ? sortMapEntries : sortMapEntries === true ? sortMapEntriesByKey : null;
      }
      clone() {
        const copy = Object.create(_Schema.prototype, Object.getOwnPropertyDescriptors(this));
        copy.tags = this.tags.slice();
        return copy;
      }
    };
    exports2.Schema = Schema;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyDocument.js
var require_stringifyDocument = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyDocument.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var stringify = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyDocument(doc, options) {
      const lines = [];
      let hasDirectives = options.directives === true;
      if (options.directives !== false && doc.directives) {
        const dir = doc.directives.toString(doc);
        if (dir) {
          lines.push(dir);
          hasDirectives = true;
        } else if (doc.directives.docStart)
          hasDirectives = true;
      }
      if (hasDirectives)
        lines.push("---");
      const ctx = stringify.createStringifyContext(doc, options);
      const { commentString } = ctx.options;
      if (doc.commentBefore) {
        if (lines.length !== 1)
          lines.unshift("");
        const cs = commentString(doc.commentBefore);
        lines.unshift(stringifyComment.indentComment(cs, ""));
      }
      let chompKeep = false;
      let contentComment = null;
      if (doc.contents) {
        if (identity.isNode(doc.contents)) {
          if (doc.contents.spaceBefore && hasDirectives)
            lines.push("");
          if (doc.contents.commentBefore) {
            const cs = commentString(doc.contents.commentBefore);
            lines.push(stringifyComment.indentComment(cs, ""));
          }
          ctx.forceBlockIndent = !!doc.comment;
          contentComment = doc.contents.comment;
        }
        const onChompKeep = contentComment ? void 0 : () => chompKeep = true;
        let body = stringify.stringify(doc.contents, ctx, () => contentComment = null, onChompKeep);
        if (contentComment)
          body += stringifyComment.lineComment(body, "", commentString(contentComment));
        if ((body[0] === "|" || body[0] === ">") && lines[lines.length - 1] === "---") {
          lines[lines.length - 1] = `--- ${body}`;
        } else
          lines.push(body);
      } else {
        lines.push(stringify.stringify(doc.contents, ctx));
      }
      if (doc.directives?.docEnd) {
        if (doc.comment) {
          const cs = commentString(doc.comment);
          if (cs.includes("\n")) {
            lines.push("...");
            lines.push(stringifyComment.indentComment(cs, ""));
          } else {
            lines.push(`... ${cs}`);
          }
        } else {
          lines.push("...");
        }
      } else {
        let dc = doc.comment;
        if (dc && chompKeep)
          dc = dc.replace(/^\n+/, "");
        if (dc) {
          if ((!chompKeep || contentComment) && lines[lines.length - 1] !== "")
            lines.push("");
          lines.push(stringifyComment.indentComment(commentString(dc), ""));
        }
      }
      return lines.join("\n") + "\n";
    }
    exports2.stringifyDocument = stringifyDocument;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/Document.js
var require_Document = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/Document.js"(exports2) {
    "use strict";
    var Alias = require_Alias();
    var Collection = require_Collection();
    var identity = require_identity();
    var Pair = require_Pair();
    var toJS = require_toJS();
    var Schema = require_Schema();
    var stringifyDocument = require_stringifyDocument();
    var anchors = require_anchors();
    var applyReviver = require_applyReviver();
    var createNode = require_createNode();
    var directives = require_directives();
    var Document = class _Document {
      constructor(value, replacer, options) {
        this.commentBefore = null;
        this.comment = null;
        this.errors = [];
        this.warnings = [];
        Object.defineProperty(this, identity.NODE_TYPE, { value: identity.DOC });
        let _replacer = null;
        if (typeof replacer === "function" || Array.isArray(replacer)) {
          _replacer = replacer;
        } else if (options === void 0 && replacer) {
          options = replacer;
          replacer = void 0;
        }
        const opt = Object.assign({
          intAsBigInt: false,
          keepSourceTokens: false,
          logLevel: "warn",
          prettyErrors: true,
          strict: true,
          stringKeys: false,
          uniqueKeys: true,
          version: "1.2"
        }, options);
        this.options = opt;
        let { version } = opt;
        if (options?._directives) {
          this.directives = options._directives.atDocument();
          if (this.directives.yaml.explicit)
            version = this.directives.yaml.version;
        } else
          this.directives = new directives.Directives({ version });
        this.setSchema(version, options);
        this.contents = value === void 0 ? null : this.createNode(value, _replacer, options);
      }
      /**
       * Create a deep copy of this Document and its contents.
       *
       * Custom Node values that inherit from `Object` still refer to their original instances.
       */
      clone() {
        const copy = Object.create(_Document.prototype, {
          [identity.NODE_TYPE]: { value: identity.DOC }
        });
        copy.commentBefore = this.commentBefore;
        copy.comment = this.comment;
        copy.errors = this.errors.slice();
        copy.warnings = this.warnings.slice();
        copy.options = Object.assign({}, this.options);
        if (this.directives)
          copy.directives = this.directives.clone();
        copy.schema = this.schema.clone();
        copy.contents = identity.isNode(this.contents) ? this.contents.clone(copy.schema) : this.contents;
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /** Adds a value to the document. */
      add(value) {
        if (assertCollection(this.contents))
          this.contents.add(value);
      }
      /** Adds a value to the document. */
      addIn(path27, value) {
        if (assertCollection(this.contents))
          this.contents.addIn(path27, value);
      }
      /**
       * Create a new `Alias` node, ensuring that the target `node` has the required anchor.
       *
       * If `node` already has an anchor, `name` is ignored.
       * Otherwise, the `node.anchor` value will be set to `name`,
       * or if an anchor with that name is already present in the document,
       * `name` will be used as a prefix for a new unique anchor.
       * If `name` is undefined, the generated anchor will use 'a' as a prefix.
       */
      createAlias(node, name) {
        if (!node.anchor) {
          const prev = anchors.anchorNames(this);
          node.anchor = // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          !name || prev.has(name) ? anchors.findNewAnchor(name || "a", prev) : name;
        }
        return new Alias.Alias(node.anchor);
      }
      createNode(value, replacer, options) {
        let _replacer = void 0;
        if (typeof replacer === "function") {
          value = replacer.call({ "": value }, "", value);
          _replacer = replacer;
        } else if (Array.isArray(replacer)) {
          const keyToStr = (v) => typeof v === "number" || v instanceof String || v instanceof Number;
          const asStr = replacer.filter(keyToStr).map(String);
          if (asStr.length > 0)
            replacer = replacer.concat(asStr);
          _replacer = replacer;
        } else if (options === void 0 && replacer) {
          options = replacer;
          replacer = void 0;
        }
        const { aliasDuplicateObjects, anchorPrefix, flow, keepUndefined, onTagObj, tag } = options ?? {};
        const { onAnchor, setAnchors, sourceObjects } = anchors.createNodeAnchors(
          this,
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          anchorPrefix || "a"
        );
        const ctx = {
          aliasDuplicateObjects: aliasDuplicateObjects ?? true,
          keepUndefined: keepUndefined ?? false,
          onAnchor,
          onTagObj,
          replacer: _replacer,
          schema: this.schema,
          sourceObjects
        };
        const node = createNode.createNode(value, tag, ctx);
        if (flow && identity.isCollection(node))
          node.flow = true;
        setAnchors();
        return node;
      }
      /**
       * Convert a key and a value into a `Pair` using the current schema,
       * recursively wrapping all values as `Scalar` or `Collection` nodes.
       */
      createPair(key, value, options = {}) {
        const k = this.createNode(key, null, options);
        const v = this.createNode(value, null, options);
        return new Pair.Pair(k, v);
      }
      /**
       * Removes a value from the document.
       * @returns `true` if the item was found and removed.
       */
      delete(key) {
        return assertCollection(this.contents) ? this.contents.delete(key) : false;
      }
      /**
       * Removes a value from the document.
       * @returns `true` if the item was found and removed.
       */
      deleteIn(path27) {
        if (Collection.isEmptyPath(path27)) {
          if (this.contents == null)
            return false;
          this.contents = null;
          return true;
        }
        return assertCollection(this.contents) ? this.contents.deleteIn(path27) : false;
      }
      /**
       * Returns item at `key`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      get(key, keepScalar) {
        return identity.isCollection(this.contents) ? this.contents.get(key, keepScalar) : void 0;
      }
      /**
       * Returns item at `path`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      getIn(path27, keepScalar) {
        if (Collection.isEmptyPath(path27))
          return !keepScalar && identity.isScalar(this.contents) ? this.contents.value : this.contents;
        return identity.isCollection(this.contents) ? this.contents.getIn(path27, keepScalar) : void 0;
      }
      /**
       * Checks if the document includes a value with the key `key`.
       */
      has(key) {
        return identity.isCollection(this.contents) ? this.contents.has(key) : false;
      }
      /**
       * Checks if the document includes a value at `path`.
       */
      hasIn(path27) {
        if (Collection.isEmptyPath(path27))
          return this.contents !== void 0;
        return identity.isCollection(this.contents) ? this.contents.hasIn(path27) : false;
      }
      /**
       * Sets a value in this document. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      set(key, value) {
        if (this.contents == null) {
          this.contents = Collection.collectionFromPath(this.schema, [key], value);
        } else if (assertCollection(this.contents)) {
          this.contents.set(key, value);
        }
      }
      /**
       * Sets a value in this document. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path27, value) {
        if (Collection.isEmptyPath(path27)) {
          this.contents = value;
        } else if (this.contents == null) {
          this.contents = Collection.collectionFromPath(this.schema, Array.from(path27), value);
        } else if (assertCollection(this.contents)) {
          this.contents.setIn(path27, value);
        }
      }
      /**
       * Change the YAML version and schema used by the document.
       * A `null` version disables support for directives, explicit tags, anchors, and aliases.
       * It also requires the `schema` option to be given as a `Schema` instance value.
       *
       * Overrides all previously set schema options.
       */
      setSchema(version, options = {}) {
        if (typeof version === "number")
          version = String(version);
        let opt;
        switch (version) {
          case "1.1":
            if (this.directives)
              this.directives.yaml.version = "1.1";
            else
              this.directives = new directives.Directives({ version: "1.1" });
            opt = { resolveKnownTags: false, schema: "yaml-1.1" };
            break;
          case "1.2":
          case "next":
            if (this.directives)
              this.directives.yaml.version = version;
            else
              this.directives = new directives.Directives({ version });
            opt = { resolveKnownTags: true, schema: "core" };
            break;
          case null:
            if (this.directives)
              delete this.directives;
            opt = null;
            break;
          default: {
            const sv = JSON.stringify(version);
            throw new Error(`Expected '1.1', '1.2' or null as first argument, but found: ${sv}`);
          }
        }
        if (options.schema instanceof Object)
          this.schema = options.schema;
        else if (opt)
          this.schema = new Schema.Schema(Object.assign(opt, options));
        else
          throw new Error(`With a null YAML version, the { schema: Schema } option is required`);
      }
      // json & jsonArg are only used from toJSON()
      toJS({ json, jsonArg, mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
        const ctx = {
          anchors: /* @__PURE__ */ new Map(),
          doc: this,
          keep: !json,
          mapAsMap: mapAsMap === true,
          mapKeyWarned: false,
          maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
        };
        const res = toJS.toJS(this.contents, jsonArg ?? "", ctx);
        if (typeof onAnchor === "function")
          for (const { count, res: res2 } of ctx.anchors.values())
            onAnchor(res2, count);
        return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
      }
      /**
       * A JSON representation of the document `contents`.
       *
       * @param jsonArg Used by `JSON.stringify` to indicate the array index or
       *   property name.
       */
      toJSON(jsonArg, onAnchor) {
        return this.toJS({ json: true, jsonArg, mapAsMap: false, onAnchor });
      }
      /** A YAML representation of the document. */
      toString(options = {}) {
        if (this.errors.length > 0)
          throw new Error("Document with errors cannot be stringified");
        if ("indent" in options && (!Number.isInteger(options.indent) || Number(options.indent) <= 0)) {
          const s = JSON.stringify(options.indent);
          throw new Error(`"indent" option must be a positive integer, not ${s}`);
        }
        return stringifyDocument.stringifyDocument(this, options);
      }
    };
    function assertCollection(contents) {
      if (identity.isCollection(contents))
        return true;
      throw new Error("Expected a YAML collection as document contents");
    }
    exports2.Document = Document;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/errors.js
var require_errors2 = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/errors.js"(exports2) {
    "use strict";
    var YAMLError = class extends Error {
      constructor(name, pos, code, message) {
        super();
        this.name = name;
        this.code = code;
        this.message = message;
        this.pos = pos;
      }
    };
    var YAMLParseError = class extends YAMLError {
      constructor(pos, code, message) {
        super("YAMLParseError", pos, code, message);
      }
    };
    var YAMLWarning = class extends YAMLError {
      constructor(pos, code, message) {
        super("YAMLWarning", pos, code, message);
      }
    };
    var prettifyError = (src, lc) => (error) => {
      if (error.pos[0] === -1)
        return;
      error.linePos = error.pos.map((pos) => lc.linePos(pos));
      const { line, col } = error.linePos[0];
      error.message += ` at line ${line}, column ${col}`;
      let ci = col - 1;
      let lineStr = src.substring(lc.lineStarts[line - 1], lc.lineStarts[line]).replace(/[\n\r]+$/, "");
      if (ci >= 60 && lineStr.length > 80) {
        const trimStart = Math.min(ci - 39, lineStr.length - 79);
        lineStr = "\u2026" + lineStr.substring(trimStart);
        ci -= trimStart - 1;
      }
      if (lineStr.length > 80)
        lineStr = lineStr.substring(0, 79) + "\u2026";
      if (line > 1 && /^ *$/.test(lineStr.substring(0, ci))) {
        let prev = src.substring(lc.lineStarts[line - 2], lc.lineStarts[line - 1]);
        if (prev.length > 80)
          prev = prev.substring(0, 79) + "\u2026\n";
        lineStr = prev + lineStr;
      }
      if (/[^ ]/.test(lineStr)) {
        let count = 1;
        const end = error.linePos[1];
        if (end?.line === line && end.col > col) {
          count = Math.max(1, Math.min(end.col - col, 80 - ci));
        }
        const pointer = " ".repeat(ci) + "^".repeat(count);
        error.message += `:

${lineStr}
${pointer}
`;
      }
    };
    exports2.YAMLError = YAMLError;
    exports2.YAMLParseError = YAMLParseError;
    exports2.YAMLWarning = YAMLWarning;
    exports2.prettifyError = prettifyError;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-props.js
var require_resolve_props = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-props.js"(exports2) {
    "use strict";
    function resolveProps(tokens, { flow, indicator, next, offset, onError, parentIndent, startOnNewline }) {
      let spaceBefore = false;
      let atNewline = startOnNewline;
      let hasSpace = startOnNewline;
      let comment = "";
      let commentSep = "";
      let hasNewline = false;
      let reqSpace = false;
      let tab = null;
      let anchor = null;
      let tag = null;
      let newlineAfterProp = null;
      let comma = null;
      let found = null;
      let start = null;
      for (const token of tokens) {
        if (reqSpace) {
          if (token.type !== "space" && token.type !== "newline" && token.type !== "comma")
            onError(token.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
          reqSpace = false;
        }
        if (tab) {
          if (atNewline && token.type !== "comment" && token.type !== "newline") {
            onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
          }
          tab = null;
        }
        switch (token.type) {
          case "space":
            if (!flow && (indicator !== "doc-start" || next?.type !== "flow-collection") && token.source.includes("	")) {
              tab = token;
            }
            hasSpace = true;
            break;
          case "comment": {
            if (!hasSpace)
              onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
            const cb = token.source.substring(1) || " ";
            if (!comment)
              comment = cb;
            else
              comment += commentSep + cb;
            commentSep = "";
            atNewline = false;
            break;
          }
          case "newline":
            if (atNewline) {
              if (comment)
                comment += token.source;
              else if (!found || indicator !== "seq-item-ind")
                spaceBefore = true;
            } else
              commentSep += token.source;
            atNewline = true;
            hasNewline = true;
            if (anchor || tag)
              newlineAfterProp = token;
            hasSpace = true;
            break;
          case "anchor":
            if (anchor)
              onError(token, "MULTIPLE_ANCHORS", "A node can have at most one anchor");
            if (token.source.endsWith(":"))
              onError(token.offset + token.source.length - 1, "BAD_ALIAS", "Anchor ending in : is ambiguous", true);
            anchor = token;
            start ?? (start = token.offset);
            atNewline = false;
            hasSpace = false;
            reqSpace = true;
            break;
          case "tag": {
            if (tag)
              onError(token, "MULTIPLE_TAGS", "A node can have at most one tag");
            tag = token;
            start ?? (start = token.offset);
            atNewline = false;
            hasSpace = false;
            reqSpace = true;
            break;
          }
          case indicator:
            if (anchor || tag)
              onError(token, "BAD_PROP_ORDER", `Anchors and tags must be after the ${token.source} indicator`);
            if (found)
              onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.source} in ${flow ?? "collection"}`);
            found = token;
            atNewline = indicator === "seq-item-ind" || indicator === "explicit-key-ind";
            hasSpace = false;
            break;
          case "comma":
            if (flow) {
              if (comma)
                onError(token, "UNEXPECTED_TOKEN", `Unexpected , in ${flow}`);
              comma = token;
              atNewline = false;
              hasSpace = false;
              break;
            }
          // else fallthrough
          default:
            onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.type} token`);
            atNewline = false;
            hasSpace = false;
        }
      }
      const last = tokens[tokens.length - 1];
      const end = last ? last.offset + last.source.length : offset;
      if (reqSpace && next && next.type !== "space" && next.type !== "newline" && next.type !== "comma" && (next.type !== "scalar" || next.source !== "")) {
        onError(next.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
      }
      if (tab && (atNewline && tab.indent <= parentIndent || next?.type === "block-map" || next?.type === "block-seq"))
        onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
      return {
        comma,
        found,
        spaceBefore,
        comment,
        hasNewline,
        anchor,
        tag,
        newlineAfterProp,
        end,
        start: start ?? end
      };
    }
    exports2.resolveProps = resolveProps;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-contains-newline.js
var require_util_contains_newline = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-contains-newline.js"(exports2) {
    "use strict";
    function containsNewline(key) {
      if (!key)
        return null;
      switch (key.type) {
        case "alias":
        case "scalar":
        case "double-quoted-scalar":
        case "single-quoted-scalar":
          if (key.source.includes("\n"))
            return true;
          if (key.end) {
            for (const st of key.end)
              if (st.type === "newline")
                return true;
          }
          return false;
        case "flow-collection":
          for (const it of key.items) {
            for (const st of it.start)
              if (st.type === "newline")
                return true;
            if (it.sep) {
              for (const st of it.sep)
                if (st.type === "newline")
                  return true;
            }
            if (containsNewline(it.key) || containsNewline(it.value))
              return true;
          }
          return false;
        default:
          return true;
      }
    }
    exports2.containsNewline = containsNewline;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-flow-indent-check.js
var require_util_flow_indent_check = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-flow-indent-check.js"(exports2) {
    "use strict";
    var utilContainsNewline = require_util_contains_newline();
    function flowIndentCheck(indent, fc, onError) {
      if (fc?.type === "flow-collection") {
        const end = fc.end[0];
        if (end.indent === indent && (end.source === "]" || end.source === "}") && utilContainsNewline.containsNewline(fc)) {
          const msg = "Flow end indicator should be more indented than parent";
          onError(end, "BAD_INDENT", msg, true);
        }
      }
    }
    exports2.flowIndentCheck = flowIndentCheck;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-map-includes.js
var require_util_map_includes = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-map-includes.js"(exports2) {
    "use strict";
    var identity = require_identity();
    function mapIncludes(ctx, items, search) {
      const { uniqueKeys } = ctx.options;
      if (uniqueKeys === false)
        return false;
      const isEqual = typeof uniqueKeys === "function" ? uniqueKeys : (a, b) => a === b || identity.isScalar(a) && identity.isScalar(b) && a.value === b.value;
      return items.some((pair) => isEqual(pair.key, search));
    }
    exports2.mapIncludes = mapIncludes;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-block-map.js
var require_resolve_block_map = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-block-map.js"(exports2) {
    "use strict";
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var resolveProps = require_resolve_props();
    var utilContainsNewline = require_util_contains_newline();
    var utilFlowIndentCheck = require_util_flow_indent_check();
    var utilMapIncludes = require_util_map_includes();
    var startColMsg = "All mapping items must start at the same column";
    function resolveBlockMap({ composeNode, composeEmptyNode }, ctx, bm, onError, tag) {
      const NodeClass = tag?.nodeClass ?? YAMLMap.YAMLMap;
      const map = new NodeClass(ctx.schema);
      if (ctx.atRoot)
        ctx.atRoot = false;
      let offset = bm.offset;
      let commentEnd = null;
      for (const collItem of bm.items) {
        const { start, key, sep: sep2, value } = collItem;
        const keyProps = resolveProps.resolveProps(start, {
          indicator: "explicit-key-ind",
          next: key ?? sep2?.[0],
          offset,
          onError,
          parentIndent: bm.indent,
          startOnNewline: true
        });
        const implicitKey = !keyProps.found;
        if (implicitKey) {
          if (key) {
            if (key.type === "block-seq")
              onError(offset, "BLOCK_AS_IMPLICIT_KEY", "A block sequence may not be used as an implicit map key");
            else if ("indent" in key && key.indent !== bm.indent)
              onError(offset, "BAD_INDENT", startColMsg);
          }
          if (!keyProps.anchor && !keyProps.tag && !sep2) {
            commentEnd = keyProps.end;
            if (keyProps.comment) {
              if (map.comment)
                map.comment += "\n" + keyProps.comment;
              else
                map.comment = keyProps.comment;
            }
            continue;
          }
          if (keyProps.newlineAfterProp || utilContainsNewline.containsNewline(key)) {
            onError(key ?? start[start.length - 1], "MULTILINE_IMPLICIT_KEY", "Implicit keys need to be on a single line");
          }
        } else if (keyProps.found?.indent !== bm.indent) {
          onError(offset, "BAD_INDENT", startColMsg);
        }
        ctx.atKey = true;
        const keyStart = keyProps.end;
        const keyNode = key ? composeNode(ctx, key, keyProps, onError) : composeEmptyNode(ctx, keyStart, start, null, keyProps, onError);
        if (ctx.schema.compat)
          utilFlowIndentCheck.flowIndentCheck(bm.indent, key, onError);
        ctx.atKey = false;
        if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode))
          onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
        const valueProps = resolveProps.resolveProps(sep2 ?? [], {
          indicator: "map-value-ind",
          next: value,
          offset: keyNode.range[2],
          onError,
          parentIndent: bm.indent,
          startOnNewline: !key || key.type === "block-scalar"
        });
        offset = valueProps.end;
        if (valueProps.found) {
          if (implicitKey) {
            if (value?.type === "block-map" && !valueProps.hasNewline)
              onError(offset, "BLOCK_AS_IMPLICIT_KEY", "Nested mappings are not allowed in compact mappings");
            if (ctx.options.strict && keyProps.start < valueProps.found.offset - 1024)
              onError(keyNode.range, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit block mapping key");
          }
          const valueNode = value ? composeNode(ctx, value, valueProps, onError) : composeEmptyNode(ctx, offset, sep2, null, valueProps, onError);
          if (ctx.schema.compat)
            utilFlowIndentCheck.flowIndentCheck(bm.indent, value, onError);
          offset = valueNode.range[2];
          const pair = new Pair.Pair(keyNode, valueNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          map.items.push(pair);
        } else {
          if (implicitKey)
            onError(keyNode.range, "MISSING_CHAR", "Implicit map keys need to be followed by map values");
          if (valueProps.comment) {
            if (keyNode.comment)
              keyNode.comment += "\n" + valueProps.comment;
            else
              keyNode.comment = valueProps.comment;
          }
          const pair = new Pair.Pair(keyNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          map.items.push(pair);
        }
      }
      if (commentEnd && commentEnd < offset)
        onError(commentEnd, "IMPOSSIBLE", "Map comment with trailing content");
      map.range = [bm.offset, offset, commentEnd ?? offset];
      return map;
    }
    exports2.resolveBlockMap = resolveBlockMap;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-block-seq.js
var require_resolve_block_seq = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-block-seq.js"(exports2) {
    "use strict";
    var YAMLSeq = require_YAMLSeq();
    var resolveProps = require_resolve_props();
    var utilFlowIndentCheck = require_util_flow_indent_check();
    function resolveBlockSeq({ composeNode, composeEmptyNode }, ctx, bs, onError, tag) {
      const NodeClass = tag?.nodeClass ?? YAMLSeq.YAMLSeq;
      const seq = new NodeClass(ctx.schema);
      if (ctx.atRoot)
        ctx.atRoot = false;
      if (ctx.atKey)
        ctx.atKey = false;
      let offset = bs.offset;
      let commentEnd = null;
      for (const { start, value } of bs.items) {
        const props = resolveProps.resolveProps(start, {
          indicator: "seq-item-ind",
          next: value,
          offset,
          onError,
          parentIndent: bs.indent,
          startOnNewline: true
        });
        if (!props.found) {
          if (props.anchor || props.tag || value) {
            if (value?.type === "block-seq")
              onError(props.end, "BAD_INDENT", "All sequence items must start at the same column");
            else
              onError(offset, "MISSING_CHAR", "Sequence item without - indicator");
          } else {
            commentEnd = props.end;
            if (props.comment)
              seq.comment = props.comment;
            continue;
          }
        }
        const node = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, start, null, props, onError);
        if (ctx.schema.compat)
          utilFlowIndentCheck.flowIndentCheck(bs.indent, value, onError);
        offset = node.range[2];
        seq.items.push(node);
      }
      seq.range = [bs.offset, offset, commentEnd ?? offset];
      return seq;
    }
    exports2.resolveBlockSeq = resolveBlockSeq;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-end.js
var require_resolve_end = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-end.js"(exports2) {
    "use strict";
    function resolveEnd(end, offset, reqSpace, onError) {
      let comment = "";
      if (end) {
        let hasSpace = false;
        let sep2 = "";
        for (const token of end) {
          const { source, type } = token;
          switch (type) {
            case "space":
              hasSpace = true;
              break;
            case "comment": {
              if (reqSpace && !hasSpace)
                onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
              const cb = source.substring(1) || " ";
              if (!comment)
                comment = cb;
              else
                comment += sep2 + cb;
              sep2 = "";
              break;
            }
            case "newline":
              if (comment)
                sep2 += source;
              hasSpace = true;
              break;
            default:
              onError(token, "UNEXPECTED_TOKEN", `Unexpected ${type} at node end`);
          }
          offset += source.length;
        }
      }
      return { comment, offset };
    }
    exports2.resolveEnd = resolveEnd;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-flow-collection.js
var require_resolve_flow_collection = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-flow-collection.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var resolveEnd = require_resolve_end();
    var resolveProps = require_resolve_props();
    var utilContainsNewline = require_util_contains_newline();
    var utilMapIncludes = require_util_map_includes();
    var blockMsg = "Block collections are not allowed within flow collections";
    var isBlock = (token) => token && (token.type === "block-map" || token.type === "block-seq");
    function resolveFlowCollection({ composeNode, composeEmptyNode }, ctx, fc, onError, tag) {
      const isMap = fc.start.source === "{";
      const fcName = isMap ? "flow map" : "flow sequence";
      const NodeClass = tag?.nodeClass ?? (isMap ? YAMLMap.YAMLMap : YAMLSeq.YAMLSeq);
      const coll = new NodeClass(ctx.schema);
      coll.flow = true;
      const atRoot = ctx.atRoot;
      if (atRoot)
        ctx.atRoot = false;
      if (ctx.atKey)
        ctx.atKey = false;
      let offset = fc.offset + fc.start.source.length;
      for (let i = 0; i < fc.items.length; ++i) {
        const collItem = fc.items[i];
        const { start, key, sep: sep2, value } = collItem;
        const props = resolveProps.resolveProps(start, {
          flow: fcName,
          indicator: "explicit-key-ind",
          next: key ?? sep2?.[0],
          offset,
          onError,
          parentIndent: fc.indent,
          startOnNewline: false
        });
        if (!props.found) {
          if (!props.anchor && !props.tag && !sep2 && !value) {
            if (i === 0 && props.comma)
              onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
            else if (i < fc.items.length - 1)
              onError(props.start, "UNEXPECTED_TOKEN", `Unexpected empty item in ${fcName}`);
            if (props.comment) {
              if (coll.comment)
                coll.comment += "\n" + props.comment;
              else
                coll.comment = props.comment;
            }
            offset = props.end;
            continue;
          }
          if (!isMap && ctx.options.strict && utilContainsNewline.containsNewline(key))
            onError(
              key,
              // checked by containsNewline()
              "MULTILINE_IMPLICIT_KEY",
              "Implicit keys of flow sequence pairs need to be on a single line"
            );
        }
        if (i === 0) {
          if (props.comma)
            onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
        } else {
          if (!props.comma)
            onError(props.start, "MISSING_CHAR", `Missing , between ${fcName} items`);
          if (props.comment) {
            let prevItemComment = "";
            loop: for (const st of start) {
              switch (st.type) {
                case "comma":
                case "space":
                  break;
                case "comment":
                  prevItemComment = st.source.substring(1);
                  break loop;
                default:
                  break loop;
              }
            }
            if (prevItemComment) {
              let prev = coll.items[coll.items.length - 1];
              if (identity.isPair(prev))
                prev = prev.value ?? prev.key;
              if (prev.comment)
                prev.comment += "\n" + prevItemComment;
              else
                prev.comment = prevItemComment;
              props.comment = props.comment.substring(prevItemComment.length + 1);
            }
          }
        }
        if (!isMap && !sep2 && !props.found) {
          const valueNode = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, sep2, null, props, onError);
          coll.items.push(valueNode);
          offset = valueNode.range[2];
          if (isBlock(value))
            onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
        } else {
          ctx.atKey = true;
          const keyStart = props.end;
          const keyNode = key ? composeNode(ctx, key, props, onError) : composeEmptyNode(ctx, keyStart, start, null, props, onError);
          if (isBlock(key))
            onError(keyNode.range, "BLOCK_IN_FLOW", blockMsg);
          ctx.atKey = false;
          const valueProps = resolveProps.resolveProps(sep2 ?? [], {
            flow: fcName,
            indicator: "map-value-ind",
            next: value,
            offset: keyNode.range[2],
            onError,
            parentIndent: fc.indent,
            startOnNewline: false
          });
          if (valueProps.found) {
            if (!isMap && !props.found && ctx.options.strict) {
              if (sep2)
                for (const st of sep2) {
                  if (st === valueProps.found)
                    break;
                  if (st.type === "newline") {
                    onError(st, "MULTILINE_IMPLICIT_KEY", "Implicit keys of flow sequence pairs need to be on a single line");
                    break;
                  }
                }
              if (props.start < valueProps.found.offset - 1024)
                onError(valueProps.found, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit flow sequence key");
            }
          } else if (value) {
            if ("source" in value && value.source?.[0] === ":")
              onError(value, "MISSING_CHAR", `Missing space after : in ${fcName}`);
            else
              onError(valueProps.start, "MISSING_CHAR", `Missing , or : between ${fcName} items`);
          }
          const valueNode = value ? composeNode(ctx, value, valueProps, onError) : valueProps.found ? composeEmptyNode(ctx, valueProps.end, sep2, null, valueProps, onError) : null;
          if (valueNode) {
            if (isBlock(value))
              onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
          } else if (valueProps.comment) {
            if (keyNode.comment)
              keyNode.comment += "\n" + valueProps.comment;
            else
              keyNode.comment = valueProps.comment;
          }
          const pair = new Pair.Pair(keyNode, valueNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          if (isMap) {
            const map = coll;
            if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode))
              onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
            map.items.push(pair);
          } else {
            const map = new YAMLMap.YAMLMap(ctx.schema);
            map.flow = true;
            map.items.push(pair);
            const endRange = (valueNode ?? keyNode).range;
            map.range = [keyNode.range[0], endRange[1], endRange[2]];
            coll.items.push(map);
          }
          offset = valueNode ? valueNode.range[2] : valueProps.end;
        }
      }
      const expectedEnd = isMap ? "}" : "]";
      const [ce, ...ee] = fc.end;
      let cePos = offset;
      if (ce?.source === expectedEnd)
        cePos = ce.offset + ce.source.length;
      else {
        const name = fcName[0].toUpperCase() + fcName.substring(1);
        const msg = atRoot ? `${name} must end with a ${expectedEnd}` : `${name} in block collection must be sufficiently indented and end with a ${expectedEnd}`;
        onError(offset, atRoot ? "MISSING_CHAR" : "BAD_INDENT", msg);
        if (ce && ce.source.length !== 1)
          ee.unshift(ce);
      }
      if (ee.length > 0) {
        const end = resolveEnd.resolveEnd(ee, cePos, ctx.options.strict, onError);
        if (end.comment) {
          if (coll.comment)
            coll.comment += "\n" + end.comment;
          else
            coll.comment = end.comment;
        }
        coll.range = [fc.offset, cePos, end.offset];
      } else {
        coll.range = [fc.offset, cePos, cePos];
      }
      return coll;
    }
    exports2.resolveFlowCollection = resolveFlowCollection;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-collection.js
var require_compose_collection = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-collection.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var resolveBlockMap = require_resolve_block_map();
    var resolveBlockSeq = require_resolve_block_seq();
    var resolveFlowCollection = require_resolve_flow_collection();
    function resolveCollection(CN, ctx, token, onError, tagName, tag) {
      const coll = token.type === "block-map" ? resolveBlockMap.resolveBlockMap(CN, ctx, token, onError, tag) : token.type === "block-seq" ? resolveBlockSeq.resolveBlockSeq(CN, ctx, token, onError, tag) : resolveFlowCollection.resolveFlowCollection(CN, ctx, token, onError, tag);
      const Coll = coll.constructor;
      if (tagName === "!" || tagName === Coll.tagName) {
        coll.tag = Coll.tagName;
        return coll;
      }
      if (tagName)
        coll.tag = tagName;
      return coll;
    }
    function composeCollection(CN, ctx, token, props, onError) {
      const tagToken = props.tag;
      const tagName = !tagToken ? null : ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg));
      if (token.type === "block-seq") {
        const { anchor, newlineAfterProp: nl } = props;
        const lastProp = anchor && tagToken ? anchor.offset > tagToken.offset ? anchor : tagToken : anchor ?? tagToken;
        if (lastProp && (!nl || nl.offset < lastProp.offset)) {
          const message = "Missing newline after block sequence props";
          onError(lastProp, "MISSING_CHAR", message);
        }
      }
      const expType = token.type === "block-map" ? "map" : token.type === "block-seq" ? "seq" : token.start.source === "{" ? "map" : "seq";
      if (!tagToken || !tagName || tagName === "!" || tagName === YAMLMap.YAMLMap.tagName && expType === "map" || tagName === YAMLSeq.YAMLSeq.tagName && expType === "seq") {
        return resolveCollection(CN, ctx, token, onError, tagName);
      }
      let tag = ctx.schema.tags.find((t) => t.tag === tagName && t.collection === expType);
      if (!tag) {
        const kt = ctx.schema.knownTags[tagName];
        if (kt?.collection === expType) {
          ctx.schema.tags.push(Object.assign({}, kt, { default: false }));
          tag = kt;
        } else {
          if (kt) {
            onError(tagToken, "BAD_COLLECTION_TYPE", `${kt.tag} used for ${expType} collection, but expects ${kt.collection ?? "scalar"}`, true);
          } else {
            onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, true);
          }
          return resolveCollection(CN, ctx, token, onError, tagName);
        }
      }
      const coll = resolveCollection(CN, ctx, token, onError, tagName, tag);
      const res = tag.resolve?.(coll, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg), ctx.options) ?? coll;
      const node = identity.isNode(res) ? res : new Scalar.Scalar(res);
      node.range = coll.range;
      node.tag = tagName;
      if (tag?.format)
        node.format = tag.format;
      return node;
    }
    exports2.composeCollection = composeCollection;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-block-scalar.js
var require_resolve_block_scalar = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-block-scalar.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    function resolveBlockScalar(ctx, scalar, onError) {
      const start = scalar.offset;
      const header = parseBlockScalarHeader(scalar, ctx.options.strict, onError);
      if (!header)
        return { value: "", type: null, comment: "", range: [start, start, start] };
      const type = header.mode === ">" ? Scalar.Scalar.BLOCK_FOLDED : Scalar.Scalar.BLOCK_LITERAL;
      const lines = scalar.source ? splitLines(scalar.source) : [];
      let chompStart = lines.length;
      for (let i = lines.length - 1; i >= 0; --i) {
        const content = lines[i][1];
        if (content === "" || content === "\r")
          chompStart = i;
        else
          break;
      }
      if (chompStart === 0) {
        const value2 = header.chomp === "+" && lines.length > 0 ? "\n".repeat(Math.max(1, lines.length - 1)) : "";
        let end2 = start + header.length;
        if (scalar.source)
          end2 += scalar.source.length;
        return { value: value2, type, comment: header.comment, range: [start, end2, end2] };
      }
      let trimIndent = scalar.indent + header.indent;
      let offset = scalar.offset + header.length;
      let contentStart = 0;
      for (let i = 0; i < chompStart; ++i) {
        const [indent, content] = lines[i];
        if (content === "" || content === "\r") {
          if (header.indent === 0 && indent.length > trimIndent)
            trimIndent = indent.length;
        } else {
          if (indent.length < trimIndent) {
            const message = "Block scalars with more-indented leading empty lines must use an explicit indentation indicator";
            onError(offset + indent.length, "MISSING_CHAR", message);
          }
          if (header.indent === 0)
            trimIndent = indent.length;
          contentStart = i;
          if (trimIndent === 0 && !ctx.atRoot) {
            const message = "Block scalar values in collections must be indented";
            onError(offset, "BAD_INDENT", message);
          }
          break;
        }
        offset += indent.length + content.length + 1;
      }
      for (let i = lines.length - 1; i >= chompStart; --i) {
        if (lines[i][0].length > trimIndent)
          chompStart = i + 1;
      }
      let value = "";
      let sep2 = "";
      let prevMoreIndented = false;
      for (let i = 0; i < contentStart; ++i)
        value += lines[i][0].slice(trimIndent) + "\n";
      for (let i = contentStart; i < chompStart; ++i) {
        let [indent, content] = lines[i];
        offset += indent.length + content.length + 1;
        const crlf = content[content.length - 1] === "\r";
        if (crlf)
          content = content.slice(0, -1);
        if (content && indent.length < trimIndent) {
          const src = header.indent ? "explicit indentation indicator" : "first line";
          const message = `Block scalar lines must not be less indented than their ${src}`;
          onError(offset - content.length - (crlf ? 2 : 1), "BAD_INDENT", message);
          indent = "";
        }
        if (type === Scalar.Scalar.BLOCK_LITERAL) {
          value += sep2 + indent.slice(trimIndent) + content;
          sep2 = "\n";
        } else if (indent.length > trimIndent || content[0] === "	") {
          if (sep2 === " ")
            sep2 = "\n";
          else if (!prevMoreIndented && sep2 === "\n")
            sep2 = "\n\n";
          value += sep2 + indent.slice(trimIndent) + content;
          sep2 = "\n";
          prevMoreIndented = true;
        } else if (content === "") {
          if (sep2 === "\n")
            value += "\n";
          else
            sep2 = "\n";
        } else {
          value += sep2 + content;
          sep2 = " ";
          prevMoreIndented = false;
        }
      }
      switch (header.chomp) {
        case "-":
          break;
        case "+":
          for (let i = chompStart; i < lines.length; ++i)
            value += "\n" + lines[i][0].slice(trimIndent);
          if (value[value.length - 1] !== "\n")
            value += "\n";
          break;
        default:
          value += "\n";
      }
      const end = start + header.length + scalar.source.length;
      return { value, type, comment: header.comment, range: [start, end, end] };
    }
    function parseBlockScalarHeader({ offset, props }, strict, onError) {
      if (props[0].type !== "block-scalar-header") {
        onError(props[0], "IMPOSSIBLE", "Block scalar header not found");
        return null;
      }
      const { source } = props[0];
      const mode = source[0];
      let indent = 0;
      let chomp = "";
      let error = -1;
      for (let i = 1; i < source.length; ++i) {
        const ch = source[i];
        if (!chomp && (ch === "-" || ch === "+"))
          chomp = ch;
        else {
          const n = Number(ch);
          if (!indent && n)
            indent = n;
          else if (error === -1)
            error = offset + i;
        }
      }
      if (error !== -1)
        onError(error, "UNEXPECTED_TOKEN", `Block scalar header includes extra characters: ${source}`);
      let hasSpace = false;
      let comment = "";
      let length = source.length;
      for (let i = 1; i < props.length; ++i) {
        const token = props[i];
        switch (token.type) {
          case "space":
            hasSpace = true;
          // fallthrough
          case "newline":
            length += token.source.length;
            break;
          case "comment":
            if (strict && !hasSpace) {
              const message = "Comments must be separated from other tokens by white space characters";
              onError(token, "MISSING_CHAR", message);
            }
            length += token.source.length;
            comment = token.source.substring(1);
            break;
          case "error":
            onError(token, "UNEXPECTED_TOKEN", token.message);
            length += token.source.length;
            break;
          /* istanbul ignore next should not happen */
          default: {
            const message = `Unexpected token in block scalar header: ${token.type}`;
            onError(token, "UNEXPECTED_TOKEN", message);
            const ts = token.source;
            if (ts && typeof ts === "string")
              length += ts.length;
          }
        }
      }
      return { mode, indent, chomp, comment, length };
    }
    function splitLines(source) {
      const split = source.split(/\n( *)/);
      const first = split[0];
      const m = first.match(/^( *)/);
      const line0 = m?.[1] ? [m[1], first.slice(m[1].length)] : ["", first];
      const lines = [line0];
      for (let i = 1; i < split.length; i += 2)
        lines.push([split[i], split[i + 1]]);
      return lines;
    }
    exports2.resolveBlockScalar = resolveBlockScalar;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-flow-scalar.js
var require_resolve_flow_scalar = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-flow-scalar.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    var resolveEnd = require_resolve_end();
    function resolveFlowScalar(scalar, strict, onError) {
      const { offset, type, source, end } = scalar;
      let _type;
      let value;
      const _onError = (rel, code, msg) => onError(offset + rel, code, msg);
      switch (type) {
        case "scalar":
          _type = Scalar.Scalar.PLAIN;
          value = plainValue(source, _onError);
          break;
        case "single-quoted-scalar":
          _type = Scalar.Scalar.QUOTE_SINGLE;
          value = singleQuotedValue(source, _onError);
          break;
        case "double-quoted-scalar":
          _type = Scalar.Scalar.QUOTE_DOUBLE;
          value = doubleQuotedValue(source, _onError);
          break;
        /* istanbul ignore next should not happen */
        default:
          onError(scalar, "UNEXPECTED_TOKEN", `Expected a flow scalar value, but found: ${type}`);
          return {
            value: "",
            type: null,
            comment: "",
            range: [offset, offset + source.length, offset + source.length]
          };
      }
      const valueEnd = offset + source.length;
      const re = resolveEnd.resolveEnd(end, valueEnd, strict, onError);
      return {
        value,
        type: _type,
        comment: re.comment,
        range: [offset, valueEnd, re.offset]
      };
    }
    function plainValue(source, onError) {
      let badChar = "";
      switch (source[0]) {
        /* istanbul ignore next should not happen */
        case "	":
          badChar = "a tab character";
          break;
        case ",":
          badChar = "flow indicator character ,";
          break;
        case "%":
          badChar = "directive indicator character %";
          break;
        case "|":
        case ">": {
          badChar = `block scalar indicator ${source[0]}`;
          break;
        }
        case "@":
        case "`": {
          badChar = `reserved character ${source[0]}`;
          break;
        }
      }
      if (badChar)
        onError(0, "BAD_SCALAR_START", `Plain value cannot start with ${badChar}`);
      return foldLines(source);
    }
    function singleQuotedValue(source, onError) {
      if (source[source.length - 1] !== "'" || source.length === 1)
        onError(source.length, "MISSING_CHAR", "Missing closing 'quote");
      return foldLines(source.slice(1, -1)).replace(/''/g, "'");
    }
    function foldLines(source) {
      let first, line;
      try {
        first = new RegExp("(.*?)(?<![ 	])[ 	]*\r?\n", "sy");
        line = new RegExp("[ 	]*(.*?)(?:(?<![ 	])[ 	]*)?\r?\n", "sy");
      } catch {
        first = /(.*?)[ \t]*\r?\n/sy;
        line = /[ \t]*(.*?)[ \t]*\r?\n/sy;
      }
      let match = first.exec(source);
      if (!match)
        return source;
      let res = match[1];
      let sep2 = " ";
      let pos = first.lastIndex;
      line.lastIndex = pos;
      while (match = line.exec(source)) {
        if (match[1] === "") {
          if (sep2 === "\n")
            res += sep2;
          else
            sep2 = "\n";
        } else {
          res += sep2 + match[1];
          sep2 = " ";
        }
        pos = line.lastIndex;
      }
      const last = /[ \t]*(.*)/sy;
      last.lastIndex = pos;
      match = last.exec(source);
      return res + sep2 + (match?.[1] ?? "");
    }
    function doubleQuotedValue(source, onError) {
      let res = "";
      for (let i = 1; i < source.length - 1; ++i) {
        const ch = source[i];
        if (ch === "\r" && source[i + 1] === "\n")
          continue;
        if (ch === "\n") {
          const { fold, offset } = foldNewline(source, i);
          res += fold;
          i = offset;
        } else if (ch === "\\") {
          let next = source[++i];
          const cc = escapeCodes[next];
          if (cc)
            res += cc;
          else if (next === "\n") {
            next = source[i + 1];
            while (next === " " || next === "	")
              next = source[++i + 1];
          } else if (next === "\r" && source[i + 1] === "\n") {
            next = source[++i + 1];
            while (next === " " || next === "	")
              next = source[++i + 1];
          } else if (next === "x" || next === "u" || next === "U") {
            const length = next === "x" ? 2 : next === "u" ? 4 : 8;
            res += parseCharCode(source, i + 1, length, onError);
            i += length;
          } else {
            const raw = source.substr(i - 1, 2);
            onError(i - 1, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
            res += raw;
          }
        } else if (ch === " " || ch === "	") {
          const wsStart = i;
          let next = source[i + 1];
          while (next === " " || next === "	")
            next = source[++i + 1];
          if (next !== "\n" && !(next === "\r" && source[i + 2] === "\n"))
            res += i > wsStart ? source.slice(wsStart, i + 1) : ch;
        } else {
          res += ch;
        }
      }
      if (source[source.length - 1] !== '"' || source.length === 1)
        onError(source.length, "MISSING_CHAR", 'Missing closing "quote');
      return res;
    }
    function foldNewline(source, offset) {
      let fold = "";
      let ch = source[offset + 1];
      while (ch === " " || ch === "	" || ch === "\n" || ch === "\r") {
        if (ch === "\r" && source[offset + 2] !== "\n")
          break;
        if (ch === "\n")
          fold += "\n";
        offset += 1;
        ch = source[offset + 1];
      }
      if (!fold)
        fold = " ";
      return { fold, offset };
    }
    var escapeCodes = {
      "0": "\0",
      // null character
      a: "\x07",
      // bell character
      b: "\b",
      // backspace
      e: "\x1B",
      // escape character
      f: "\f",
      // form feed
      n: "\n",
      // line feed
      r: "\r",
      // carriage return
      t: "	",
      // horizontal tab
      v: "\v",
      // vertical tab
      N: "\x85",
      // Unicode next line
      _: "\xA0",
      // Unicode non-breaking space
      L: "\u2028",
      // Unicode line separator
      P: "\u2029",
      // Unicode paragraph separator
      " ": " ",
      '"': '"',
      "/": "/",
      "\\": "\\",
      "	": "	"
    };
    function parseCharCode(source, offset, length, onError) {
      const cc = source.substr(offset, length);
      const ok = cc.length === length && /^[0-9a-fA-F]+$/.test(cc);
      const code = ok ? parseInt(cc, 16) : NaN;
      try {
        return String.fromCodePoint(code);
      } catch {
        const raw = source.substr(offset - 2, length + 2);
        onError(offset - 2, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
        return raw;
      }
    }
    exports2.resolveFlowScalar = resolveFlowScalar;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-scalar.js
var require_compose_scalar = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-scalar.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var resolveBlockScalar = require_resolve_block_scalar();
    var resolveFlowScalar = require_resolve_flow_scalar();
    function composeScalar(ctx, token, tagToken, onError) {
      const { value, type, comment, range } = token.type === "block-scalar" ? resolveBlockScalar.resolveBlockScalar(ctx, token, onError) : resolveFlowScalar.resolveFlowScalar(token, ctx.options.strict, onError);
      const tagName = tagToken ? ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg)) : null;
      let tag;
      if (ctx.options.stringKeys && ctx.atKey) {
        tag = ctx.schema[identity.SCALAR];
      } else if (tagName)
        tag = findScalarTagByName(ctx.schema, value, tagName, tagToken, onError);
      else if (token.type === "scalar")
        tag = findScalarTagByTest(ctx, value, token, onError);
      else
        tag = ctx.schema[identity.SCALAR];
      let scalar;
      try {
        const res = tag.resolve(value, (msg) => onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg), ctx.options);
        scalar = identity.isScalar(res) ? res : new Scalar.Scalar(res);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg);
        scalar = new Scalar.Scalar(value);
      }
      scalar.range = range;
      scalar.source = value;
      if (type)
        scalar.type = type;
      if (tagName)
        scalar.tag = tagName;
      if (tag.format)
        scalar.format = tag.format;
      if (comment)
        scalar.comment = comment;
      return scalar;
    }
    function findScalarTagByName(schema, value, tagName, tagToken, onError) {
      if (tagName === "!")
        return schema[identity.SCALAR];
      const matchWithTest = [];
      for (const tag of schema.tags) {
        if (!tag.collection && tag.tag === tagName) {
          if (tag.default && tag.test)
            matchWithTest.push(tag);
          else
            return tag;
        }
      }
      for (const tag of matchWithTest)
        if (tag.test?.test(value))
          return tag;
      const kt = schema.knownTags[tagName];
      if (kt && !kt.collection) {
        schema.tags.push(Object.assign({}, kt, { default: false, test: void 0 }));
        return kt;
      }
      onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, tagName !== "tag:yaml.org,2002:str");
      return schema[identity.SCALAR];
    }
    function findScalarTagByTest({ atKey, directives, schema }, value, token, onError) {
      const tag = schema.tags.find((tag2) => (tag2.default === true || atKey && tag2.default === "key") && tag2.test?.test(value)) || schema[identity.SCALAR];
      if (schema.compat) {
        const compat = schema.compat.find((tag2) => tag2.default && tag2.test?.test(value)) ?? schema[identity.SCALAR];
        if (tag.tag !== compat.tag) {
          const ts = directives.tagString(tag.tag);
          const cs = directives.tagString(compat.tag);
          const msg = `Value may be parsed as either ${ts} or ${cs}`;
          onError(token, "TAG_RESOLVE_FAILED", msg, true);
        }
      }
      return tag;
    }
    exports2.composeScalar = composeScalar;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-empty-scalar-position.js
var require_util_empty_scalar_position = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-empty-scalar-position.js"(exports2) {
    "use strict";
    function emptyScalarPosition(offset, before, pos) {
      if (before) {
        pos ?? (pos = before.length);
        for (let i = pos - 1; i >= 0; --i) {
          let st = before[i];
          switch (st.type) {
            case "space":
            case "comment":
            case "newline":
              offset -= st.source.length;
              continue;
          }
          st = before[++i];
          while (st?.type === "space") {
            offset += st.source.length;
            st = before[++i];
          }
          break;
        }
      }
      return offset;
    }
    exports2.emptyScalarPosition = emptyScalarPosition;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-node.js
var require_compose_node = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-node.js"(exports2) {
    "use strict";
    var Alias = require_Alias();
    var identity = require_identity();
    var composeCollection = require_compose_collection();
    var composeScalar = require_compose_scalar();
    var resolveEnd = require_resolve_end();
    var utilEmptyScalarPosition = require_util_empty_scalar_position();
    var CN = { composeNode, composeEmptyNode };
    function composeNode(ctx, token, props, onError) {
      const atKey = ctx.atKey;
      const { spaceBefore, comment, anchor, tag } = props;
      let node;
      let isSrcToken = true;
      switch (token.type) {
        case "alias":
          node = composeAlias(ctx, token, onError);
          if (anchor || tag)
            onError(token, "ALIAS_PROPS", "An alias node must not specify any properties");
          break;
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
        case "block-scalar":
          node = composeScalar.composeScalar(ctx, token, tag, onError);
          if (anchor)
            node.anchor = anchor.source.substring(1);
          break;
        case "block-map":
        case "block-seq":
        case "flow-collection":
          try {
            node = composeCollection.composeCollection(CN, ctx, token, props, onError);
            if (anchor)
              node.anchor = anchor.source.substring(1);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            onError(token, "RESOURCE_EXHAUSTION", message);
          }
          break;
        default: {
          const message = token.type === "error" ? token.message : `Unsupported token (type: ${token.type})`;
          onError(token, "UNEXPECTED_TOKEN", message);
          isSrcToken = false;
        }
      }
      node ?? (node = composeEmptyNode(ctx, token.offset, void 0, null, props, onError));
      if (anchor && node.anchor === "")
        onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
      if (atKey && ctx.options.stringKeys && (!identity.isScalar(node) || typeof node.value !== "string" || node.tag && node.tag !== "tag:yaml.org,2002:str")) {
        const msg = "With stringKeys, all keys must be strings";
        onError(tag ?? token, "NON_STRING_KEY", msg);
      }
      if (spaceBefore)
        node.spaceBefore = true;
      if (comment) {
        if (token.type === "scalar" && token.source === "")
          node.comment = comment;
        else
          node.commentBefore = comment;
      }
      if (ctx.options.keepSourceTokens && isSrcToken)
        node.srcToken = token;
      return node;
    }
    function composeEmptyNode(ctx, offset, before, pos, { spaceBefore, comment, anchor, tag, end }, onError) {
      const token = {
        type: "scalar",
        offset: utilEmptyScalarPosition.emptyScalarPosition(offset, before, pos),
        indent: -1,
        source: ""
      };
      const node = composeScalar.composeScalar(ctx, token, tag, onError);
      if (anchor) {
        node.anchor = anchor.source.substring(1);
        if (node.anchor === "")
          onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
      }
      if (spaceBefore)
        node.spaceBefore = true;
      if (comment) {
        node.comment = comment;
        node.range[2] = end;
      }
      return node;
    }
    function composeAlias({ options }, { offset, source, end }, onError) {
      const alias = new Alias.Alias(source.substring(1));
      if (alias.source === "")
        onError(offset, "BAD_ALIAS", "Alias cannot be an empty string");
      if (alias.source.endsWith(":"))
        onError(offset + source.length - 1, "BAD_ALIAS", "Alias ending in : is ambiguous", true);
      const valueEnd = offset + source.length;
      const re = resolveEnd.resolveEnd(end, valueEnd, options.strict, onError);
      alias.range = [offset, valueEnd, re.offset];
      if (re.comment)
        alias.comment = re.comment;
      return alias;
    }
    exports2.composeEmptyNode = composeEmptyNode;
    exports2.composeNode = composeNode;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-doc.js
var require_compose_doc = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-doc.js"(exports2) {
    "use strict";
    var Document = require_Document();
    var composeNode = require_compose_node();
    var resolveEnd = require_resolve_end();
    var resolveProps = require_resolve_props();
    function composeDoc(options, directives, { offset, start, value, end }, onError) {
      const opts = Object.assign({ _directives: directives }, options);
      const doc = new Document.Document(void 0, opts);
      const ctx = {
        atKey: false,
        atRoot: true,
        directives: doc.directives,
        options: doc.options,
        schema: doc.schema
      };
      const props = resolveProps.resolveProps(start, {
        indicator: "doc-start",
        next: value ?? end?.[0],
        offset,
        onError,
        parentIndent: 0,
        startOnNewline: true
      });
      if (props.found) {
        doc.directives.docStart = true;
        if (value && (value.type === "block-map" || value.type === "block-seq") && !props.hasNewline)
          onError(props.end, "MISSING_CHAR", "Block collection cannot start on same line with directives-end marker");
      }
      doc.contents = value ? composeNode.composeNode(ctx, value, props, onError) : composeNode.composeEmptyNode(ctx, props.end, start, null, props, onError);
      const contentEnd = doc.contents.range[2];
      const re = resolveEnd.resolveEnd(end, contentEnd, false, onError);
      if (re.comment)
        doc.comment = re.comment;
      doc.range = [offset, contentEnd, re.offset];
      return doc;
    }
    exports2.composeDoc = composeDoc;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/composer.js
var require_composer = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/composer.js"(exports2) {
    "use strict";
    var node_process = require("process");
    var directives = require_directives();
    var Document = require_Document();
    var errors = require_errors2();
    var identity = require_identity();
    var composeDoc = require_compose_doc();
    var resolveEnd = require_resolve_end();
    function getErrorPos(src) {
      if (typeof src === "number")
        return [src, src + 1];
      if (Array.isArray(src))
        return src.length === 2 ? src : [src[0], src[1]];
      const { offset, source } = src;
      return [offset, offset + (typeof source === "string" ? source.length : 1)];
    }
    function parsePrelude(prelude) {
      let comment = "";
      let atComment = false;
      let afterEmptyLine = false;
      for (let i = 0; i < prelude.length; ++i) {
        const source = prelude[i];
        switch (source[0]) {
          case "#":
            comment += (comment === "" ? "" : afterEmptyLine ? "\n\n" : "\n") + (source.substring(1) || " ");
            atComment = true;
            afterEmptyLine = false;
            break;
          case "%":
            if (prelude[i + 1]?.[0] !== "#")
              i += 1;
            atComment = false;
            break;
          default:
            if (!atComment)
              afterEmptyLine = true;
            atComment = false;
        }
      }
      return { comment, afterEmptyLine };
    }
    var Composer = class {
      constructor(options = {}) {
        this.doc = null;
        this.atDirectives = false;
        this.prelude = [];
        this.errors = [];
        this.warnings = [];
        this.onError = (source, code, message, warning) => {
          const pos = getErrorPos(source);
          if (warning)
            this.warnings.push(new errors.YAMLWarning(pos, code, message));
          else
            this.errors.push(new errors.YAMLParseError(pos, code, message));
        };
        this.directives = new directives.Directives({ version: options.version || "1.2" });
        this.options = options;
      }
      decorate(doc, afterDoc) {
        const { comment, afterEmptyLine } = parsePrelude(this.prelude);
        if (comment) {
          const dc = doc.contents;
          if (afterDoc) {
            doc.comment = doc.comment ? `${doc.comment}
${comment}` : comment;
          } else if (afterEmptyLine || doc.directives.docStart || !dc) {
            doc.commentBefore = comment;
          } else if (identity.isCollection(dc) && !dc.flow && dc.items.length > 0) {
            let it = dc.items[0];
            if (identity.isPair(it))
              it = it.key;
            const cb = it.commentBefore;
            it.commentBefore = cb ? `${comment}
${cb}` : comment;
          } else {
            const cb = dc.commentBefore;
            dc.commentBefore = cb ? `${comment}
${cb}` : comment;
          }
        }
        if (afterDoc) {
          for (let i = 0; i < this.errors.length; ++i)
            doc.errors.push(this.errors[i]);
          for (let i = 0; i < this.warnings.length; ++i)
            doc.warnings.push(this.warnings[i]);
        } else {
          doc.errors = this.errors;
          doc.warnings = this.warnings;
        }
        this.prelude = [];
        this.errors = [];
        this.warnings = [];
      }
      /**
       * Current stream status information.
       *
       * Mostly useful at the end of input for an empty stream.
       */
      streamInfo() {
        return {
          comment: parsePrelude(this.prelude).comment,
          directives: this.directives,
          errors: this.errors,
          warnings: this.warnings
        };
      }
      /**
       * Compose tokens into documents.
       *
       * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
       * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
       */
      *compose(tokens, forceDoc = false, endOffset = -1) {
        for (const token of tokens)
          yield* this.next(token);
        yield* this.end(forceDoc, endOffset);
      }
      /** Advance the composer by one CST token. */
      *next(token) {
        if (node_process.env.LOG_STREAM)
          console.dir(token, { depth: null });
        switch (token.type) {
          case "directive":
            this.directives.add(token.source, (offset, message, warning) => {
              const pos = getErrorPos(token);
              pos[0] += offset;
              this.onError(pos, "BAD_DIRECTIVE", message, warning);
            });
            this.prelude.push(token.source);
            this.atDirectives = true;
            break;
          case "document": {
            const doc = composeDoc.composeDoc(this.options, this.directives, token, this.onError);
            if (this.atDirectives && !doc.directives.docStart)
              this.onError(token, "MISSING_CHAR", "Missing directives-end/doc-start indicator line");
            this.decorate(doc, false);
            if (this.doc)
              yield this.doc;
            this.doc = doc;
            this.atDirectives = false;
            break;
          }
          case "byte-order-mark":
          case "space":
            break;
          case "comment":
          case "newline":
            this.prelude.push(token.source);
            break;
          case "error": {
            const msg = token.source ? `${token.message}: ${JSON.stringify(token.source)}` : token.message;
            const error = new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg);
            if (this.atDirectives || !this.doc)
              this.errors.push(error);
            else
              this.doc.errors.push(error);
            break;
          }
          case "doc-end": {
            if (!this.doc) {
              const msg = "Unexpected doc-end without preceding document";
              this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg));
              break;
            }
            this.doc.directives.docEnd = true;
            const end = resolveEnd.resolveEnd(token.end, token.offset + token.source.length, this.doc.options.strict, this.onError);
            this.decorate(this.doc, true);
            if (end.comment) {
              const dc = this.doc.comment;
              this.doc.comment = dc ? `${dc}
${end.comment}` : end.comment;
            }
            this.doc.range[2] = end.offset;
            break;
          }
          default:
            this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", `Unsupported token ${token.type}`));
        }
      }
      /**
       * Call at end of input to yield any remaining document.
       *
       * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
       * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
       */
      *end(forceDoc = false, endOffset = -1) {
        if (this.doc) {
          this.decorate(this.doc, true);
          yield this.doc;
          this.doc = null;
        } else if (forceDoc) {
          const opts = Object.assign({ _directives: this.directives }, this.options);
          const doc = new Document.Document(void 0, opts);
          if (this.atDirectives)
            this.onError(endOffset, "MISSING_CHAR", "Missing directives-end indicator line");
          doc.range = [0, endOffset, endOffset];
          this.decorate(doc, false);
          yield doc;
        }
      }
    };
    exports2.Composer = Composer;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst-scalar.js
var require_cst_scalar = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst-scalar.js"(exports2) {
    "use strict";
    var resolveBlockScalar = require_resolve_block_scalar();
    var resolveFlowScalar = require_resolve_flow_scalar();
    var errors = require_errors2();
    var stringifyString = require_stringifyString();
    function resolveAsScalar(token, strict = true, onError) {
      if (token) {
        const _onError = (pos, code, message) => {
          const offset = typeof pos === "number" ? pos : Array.isArray(pos) ? pos[0] : pos.offset;
          if (onError)
            onError(offset, code, message);
          else
            throw new errors.YAMLParseError([offset, offset + 1], code, message);
        };
        switch (token.type) {
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return resolveFlowScalar.resolveFlowScalar(token, strict, _onError);
          case "block-scalar":
            return resolveBlockScalar.resolveBlockScalar({ options: { strict } }, token, _onError);
        }
      }
      return null;
    }
    function createScalarToken(value, context) {
      const { implicitKey = false, indent, inFlow = false, offset = -1, type = "PLAIN" } = context;
      const source = stringifyString.stringifyString({ type, value }, {
        implicitKey,
        indent: indent > 0 ? " ".repeat(indent) : "",
        inFlow,
        options: { blockQuote: true, lineWidth: -1 }
      });
      const end = context.end ?? [
        { type: "newline", offset: -1, indent, source: "\n" }
      ];
      switch (source[0]) {
        case "|":
        case ">": {
          const he = source.indexOf("\n");
          const head = source.substring(0, he);
          const body = source.substring(he + 1) + "\n";
          const props = [
            { type: "block-scalar-header", offset, indent, source: head }
          ];
          if (!addEndtoBlockProps(props, end))
            props.push({ type: "newline", offset: -1, indent, source: "\n" });
          return { type: "block-scalar", offset, indent, props, source: body };
        }
        case '"':
          return { type: "double-quoted-scalar", offset, indent, source, end };
        case "'":
          return { type: "single-quoted-scalar", offset, indent, source, end };
        default:
          return { type: "scalar", offset, indent, source, end };
      }
    }
    function setScalarValue(token, value, context = {}) {
      let { afterKey = false, implicitKey = false, inFlow = false, type } = context;
      let indent = "indent" in token ? token.indent : null;
      if (afterKey && typeof indent === "number")
        indent += 2;
      if (!type)
        switch (token.type) {
          case "single-quoted-scalar":
            type = "QUOTE_SINGLE";
            break;
          case "double-quoted-scalar":
            type = "QUOTE_DOUBLE";
            break;
          case "block-scalar": {
            const header = token.props[0];
            if (header.type !== "block-scalar-header")
              throw new Error("Invalid block scalar header");
            type = header.source[0] === ">" ? "BLOCK_FOLDED" : "BLOCK_LITERAL";
            break;
          }
          default:
            type = "PLAIN";
        }
      const source = stringifyString.stringifyString({ type, value }, {
        implicitKey: implicitKey || indent === null,
        indent: indent !== null && indent > 0 ? " ".repeat(indent) : "",
        inFlow,
        options: { blockQuote: true, lineWidth: -1 }
      });
      switch (source[0]) {
        case "|":
        case ">":
          setBlockScalarValue(token, source);
          break;
        case '"':
          setFlowScalarValue(token, source, "double-quoted-scalar");
          break;
        case "'":
          setFlowScalarValue(token, source, "single-quoted-scalar");
          break;
        default:
          setFlowScalarValue(token, source, "scalar");
      }
    }
    function setBlockScalarValue(token, source) {
      const he = source.indexOf("\n");
      const head = source.substring(0, he);
      const body = source.substring(he + 1) + "\n";
      if (token.type === "block-scalar") {
        const header = token.props[0];
        if (header.type !== "block-scalar-header")
          throw new Error("Invalid block scalar header");
        header.source = head;
        token.source = body;
      } else {
        const { offset } = token;
        const indent = "indent" in token ? token.indent : -1;
        const props = [
          { type: "block-scalar-header", offset, indent, source: head }
        ];
        if (!addEndtoBlockProps(props, "end" in token ? token.end : void 0))
          props.push({ type: "newline", offset: -1, indent, source: "\n" });
        for (const key of Object.keys(token))
          if (key !== "type" && key !== "offset")
            delete token[key];
        Object.assign(token, { type: "block-scalar", indent, props, source: body });
      }
    }
    function addEndtoBlockProps(props, end) {
      if (end)
        for (const st of end)
          switch (st.type) {
            case "space":
            case "comment":
              props.push(st);
              break;
            case "newline":
              props.push(st);
              return true;
          }
      return false;
    }
    function setFlowScalarValue(token, source, type) {
      switch (token.type) {
        case "scalar":
        case "double-quoted-scalar":
        case "single-quoted-scalar":
          token.type = type;
          token.source = source;
          break;
        case "block-scalar": {
          const end = token.props.slice(1);
          let oa = source.length;
          if (token.props[0].type === "block-scalar-header")
            oa -= token.props[0].source.length;
          for (const tok of end)
            tok.offset += oa;
          delete token.props;
          Object.assign(token, { type, source, end });
          break;
        }
        case "block-map":
        case "block-seq": {
          const offset = token.offset + source.length;
          const nl = { type: "newline", offset, indent: token.indent, source: "\n" };
          delete token.items;
          Object.assign(token, { type, source, end: [nl] });
          break;
        }
        default: {
          const indent = "indent" in token ? token.indent : -1;
          const end = "end" in token && Array.isArray(token.end) ? token.end.filter((st) => st.type === "space" || st.type === "comment" || st.type === "newline") : [];
          for (const key of Object.keys(token))
            if (key !== "type" && key !== "offset")
              delete token[key];
          Object.assign(token, { type, indent, source, end });
        }
      }
    }
    exports2.createScalarToken = createScalarToken;
    exports2.resolveAsScalar = resolveAsScalar;
    exports2.setScalarValue = setScalarValue;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst-stringify.js
var require_cst_stringify = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst-stringify.js"(exports2) {
    "use strict";
    var stringify = (cst) => "type" in cst ? stringifyToken(cst) : stringifyItem(cst);
    function stringifyToken(token) {
      switch (token.type) {
        case "block-scalar": {
          let res = "";
          for (const tok of token.props)
            res += stringifyToken(tok);
          return res + token.source;
        }
        case "block-map":
        case "block-seq": {
          let res = "";
          for (const item of token.items)
            res += stringifyItem(item);
          return res;
        }
        case "flow-collection": {
          let res = token.start.source;
          for (const item of token.items)
            res += stringifyItem(item);
          for (const st of token.end)
            res += st.source;
          return res;
        }
        case "document": {
          let res = stringifyItem(token);
          if (token.end)
            for (const st of token.end)
              res += st.source;
          return res;
        }
        default: {
          let res = token.source;
          if ("end" in token && token.end)
            for (const st of token.end)
              res += st.source;
          return res;
        }
      }
    }
    function stringifyItem({ start, key, sep: sep2, value }) {
      let res = "";
      for (const st of start)
        res += st.source;
      if (key)
        res += stringifyToken(key);
      if (sep2)
        for (const st of sep2)
          res += st.source;
      if (value)
        res += stringifyToken(value);
      return res;
    }
    exports2.stringify = stringify;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst-visit.js
var require_cst_visit = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst-visit.js"(exports2) {
    "use strict";
    var BREAK = /* @__PURE__ */ Symbol("break visit");
    var SKIP = /* @__PURE__ */ Symbol("skip children");
    var REMOVE = /* @__PURE__ */ Symbol("remove item");
    function visit(cst, visitor) {
      if ("type" in cst && cst.type === "document")
        cst = { start: cst.start, value: cst.value };
      _visit(Object.freeze([]), cst, visitor);
    }
    visit.BREAK = BREAK;
    visit.SKIP = SKIP;
    visit.REMOVE = REMOVE;
    visit.itemAtPath = (cst, path27) => {
      let item = cst;
      for (const [field, index] of path27) {
        const tok = item?.[field];
        if (tok && "items" in tok) {
          item = tok.items[index];
        } else
          return void 0;
      }
      return item;
    };
    visit.parentCollection = (cst, path27) => {
      const parent = visit.itemAtPath(cst, path27.slice(0, -1));
      const field = path27[path27.length - 1][0];
      const coll = parent?.[field];
      if (coll && "items" in coll)
        return coll;
      throw new Error("Parent collection not found");
    };
    function _visit(path27, item, visitor) {
      let ctrl = visitor(item, path27);
      if (typeof ctrl === "symbol")
        return ctrl;
      for (const field of ["key", "value"]) {
        const token = item[field];
        if (token && "items" in token) {
          for (let i = 0; i < token.items.length; ++i) {
            const ci = _visit(Object.freeze(path27.concat([[field, i]])), token.items[i], visitor);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              token.items.splice(i, 1);
              i -= 1;
            }
          }
          if (typeof ctrl === "function" && field === "key")
            ctrl = ctrl(item, path27);
        }
      }
      return typeof ctrl === "function" ? ctrl(item, path27) : ctrl;
    }
    exports2.visit = visit;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst.js
var require_cst = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst.js"(exports2) {
    "use strict";
    var cstScalar = require_cst_scalar();
    var cstStringify = require_cst_stringify();
    var cstVisit = require_cst_visit();
    var BOM = "\uFEFF";
    var DOCUMENT = "";
    var FLOW_END = "";
    var SCALAR = "";
    var isCollection = (token) => !!token && "items" in token;
    var isScalar = (token) => !!token && (token.type === "scalar" || token.type === "single-quoted-scalar" || token.type === "double-quoted-scalar" || token.type === "block-scalar");
    function prettyToken(token) {
      switch (token) {
        case BOM:
          return "<BOM>";
        case DOCUMENT:
          return "<DOC>";
        case FLOW_END:
          return "<FLOW_END>";
        case SCALAR:
          return "<SCALAR>";
        default:
          return JSON.stringify(token);
      }
    }
    function tokenType(source) {
      switch (source) {
        case BOM:
          return "byte-order-mark";
        case DOCUMENT:
          return "doc-mode";
        case FLOW_END:
          return "flow-error-end";
        case SCALAR:
          return "scalar";
        case "---":
          return "doc-start";
        case "...":
          return "doc-end";
        case "":
        case "\n":
        case "\r\n":
          return "newline";
        case "-":
          return "seq-item-ind";
        case "?":
          return "explicit-key-ind";
        case ":":
          return "map-value-ind";
        case "{":
          return "flow-map-start";
        case "}":
          return "flow-map-end";
        case "[":
          return "flow-seq-start";
        case "]":
          return "flow-seq-end";
        case ",":
          return "comma";
      }
      switch (source[0]) {
        case " ":
        case "	":
          return "space";
        case "#":
          return "comment";
        case "%":
          return "directive-line";
        case "*":
          return "alias";
        case "&":
          return "anchor";
        case "!":
          return "tag";
        case "'":
          return "single-quoted-scalar";
        case '"':
          return "double-quoted-scalar";
        case "|":
        case ">":
          return "block-scalar-header";
      }
      return null;
    }
    exports2.createScalarToken = cstScalar.createScalarToken;
    exports2.resolveAsScalar = cstScalar.resolveAsScalar;
    exports2.setScalarValue = cstScalar.setScalarValue;
    exports2.stringify = cstStringify.stringify;
    exports2.visit = cstVisit.visit;
    exports2.BOM = BOM;
    exports2.DOCUMENT = DOCUMENT;
    exports2.FLOW_END = FLOW_END;
    exports2.SCALAR = SCALAR;
    exports2.isCollection = isCollection;
    exports2.isScalar = isScalar;
    exports2.prettyToken = prettyToken;
    exports2.tokenType = tokenType;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/lexer.js
var require_lexer = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/lexer.js"(exports2) {
    "use strict";
    var cst = require_cst();
    function isEmpty(ch) {
      switch (ch) {
        case void 0:
        case " ":
        case "\n":
        case "\r":
        case "	":
          return true;
        default:
          return false;
      }
    }
    var hexDigits = new Set("0123456789ABCDEFabcdef");
    var tagChars = new Set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-#;/?:@&=+$_.!~*'()");
    var flowIndicatorChars = new Set(",[]{}");
    var invalidAnchorChars = new Set(" ,[]{}\n\r	");
    var isNotAnchorChar = (ch) => !ch || invalidAnchorChars.has(ch);
    var Lexer = class {
      constructor() {
        this.atEnd = false;
        this.blockScalarIndent = -1;
        this.blockScalarKeep = false;
        this.buffer = "";
        this.flowKey = false;
        this.flowLevel = 0;
        this.indentNext = 0;
        this.indentValue = 0;
        this.lineEndPos = null;
        this.next = null;
        this.pos = 0;
      }
      /**
       * Generate YAML tokens from the `source` string. If `incomplete`,
       * a part of the last line may be left as a buffer for the next call.
       *
       * @returns A generator of lexical tokens
       */
      *lex(source, incomplete = false) {
        if (source) {
          if (typeof source !== "string")
            throw TypeError("source is not a string");
          this.buffer = this.buffer ? this.buffer + source : source;
          this.lineEndPos = null;
        }
        this.atEnd = !incomplete;
        let next = this.next ?? "stream";
        while (next && (incomplete || this.hasChars(1)))
          next = yield* this.parseNext(next);
      }
      atLineEnd() {
        let i = this.pos;
        let ch = this.buffer[i];
        while (ch === " " || ch === "	")
          ch = this.buffer[++i];
        if (!ch || ch === "#" || ch === "\n")
          return true;
        if (ch === "\r")
          return this.buffer[i + 1] === "\n";
        return false;
      }
      charAt(n) {
        return this.buffer[this.pos + n];
      }
      continueScalar(offset) {
        let ch = this.buffer[offset];
        if (this.indentNext > 0) {
          let indent = 0;
          while (ch === " ")
            ch = this.buffer[++indent + offset];
          if (ch === "\r") {
            const next = this.buffer[indent + offset + 1];
            if (next === "\n" || !next && !this.atEnd)
              return offset + indent + 1;
          }
          return ch === "\n" || indent >= this.indentNext || !ch && !this.atEnd ? offset + indent : -1;
        }
        if (ch === "-" || ch === ".") {
          const dt = this.buffer.substr(offset, 3);
          if ((dt === "---" || dt === "...") && isEmpty(this.buffer[offset + 3]))
            return -1;
        }
        return offset;
      }
      getLine() {
        let end = this.lineEndPos;
        if (typeof end !== "number" || end !== -1 && end < this.pos) {
          end = this.buffer.indexOf("\n", this.pos);
          this.lineEndPos = end;
        }
        if (end === -1)
          return this.atEnd ? this.buffer.substring(this.pos) : null;
        if (this.buffer[end - 1] === "\r")
          end -= 1;
        return this.buffer.substring(this.pos, end);
      }
      hasChars(n) {
        return this.pos + n <= this.buffer.length;
      }
      setNext(state) {
        this.buffer = this.buffer.substring(this.pos);
        this.pos = 0;
        this.lineEndPos = null;
        this.next = state;
        return null;
      }
      peek(n) {
        return this.buffer.substr(this.pos, n);
      }
      *parseNext(next) {
        switch (next) {
          case "stream":
            return yield* this.parseStream();
          case "line-start":
            return yield* this.parseLineStart();
          case "block-start":
            return yield* this.parseBlockStart();
          case "doc":
            return yield* this.parseDocument();
          case "flow":
            return yield* this.parseFlowCollection();
          case "quoted-scalar":
            return yield* this.parseQuotedScalar();
          case "block-scalar":
            return yield* this.parseBlockScalar();
          case "plain-scalar":
            return yield* this.parsePlainScalar();
        }
      }
      *parseStream() {
        let line = this.getLine();
        if (line === null)
          return this.setNext("stream");
        if (line[0] === cst.BOM) {
          yield* this.pushCount(1);
          line = line.substring(1);
        }
        if (line[0] === "%") {
          let dirEnd = line.length;
          let cs = line.indexOf("#");
          while (cs !== -1) {
            const ch = line[cs - 1];
            if (ch === " " || ch === "	") {
              dirEnd = cs - 1;
              break;
            } else {
              cs = line.indexOf("#", cs + 1);
            }
          }
          while (true) {
            const ch = line[dirEnd - 1];
            if (ch === " " || ch === "	")
              dirEnd -= 1;
            else
              break;
          }
          const n = (yield* this.pushCount(dirEnd)) + (yield* this.pushSpaces(true));
          yield* this.pushCount(line.length - n);
          this.pushNewline();
          return "stream";
        }
        if (this.atLineEnd()) {
          const sp = yield* this.pushSpaces(true);
          yield* this.pushCount(line.length - sp);
          yield* this.pushNewline();
          return "stream";
        }
        yield cst.DOCUMENT;
        return yield* this.parseLineStart();
      }
      *parseLineStart() {
        const ch = this.charAt(0);
        if (!ch && !this.atEnd)
          return this.setNext("line-start");
        if (ch === "-" || ch === ".") {
          if (!this.atEnd && !this.hasChars(4))
            return this.setNext("line-start");
          const s = this.peek(3);
          if ((s === "---" || s === "...") && isEmpty(this.charAt(3))) {
            yield* this.pushCount(3);
            this.indentValue = 0;
            this.indentNext = 0;
            return s === "---" ? "doc" : "stream";
          }
        }
        this.indentValue = yield* this.pushSpaces(false);
        if (this.indentNext > this.indentValue && !isEmpty(this.charAt(1)))
          this.indentNext = this.indentValue;
        return yield* this.parseBlockStart();
      }
      *parseBlockStart() {
        const [ch0, ch1] = this.peek(2);
        if (!ch1 && !this.atEnd)
          return this.setNext("block-start");
        if ((ch0 === "-" || ch0 === "?" || ch0 === ":") && isEmpty(ch1)) {
          const n = (yield* this.pushCount(1)) + (yield* this.pushSpaces(true));
          this.indentNext = this.indentValue + 1;
          this.indentValue += n;
          return "block-start";
        }
        return "doc";
      }
      *parseDocument() {
        yield* this.pushSpaces(true);
        const line = this.getLine();
        if (line === null)
          return this.setNext("doc");
        let n = yield* this.pushIndicators();
        switch (line[n]) {
          case "#":
            yield* this.pushCount(line.length - n);
          // fallthrough
          case void 0:
            yield* this.pushNewline();
            return yield* this.parseLineStart();
          case "{":
          case "[":
            yield* this.pushCount(1);
            this.flowKey = false;
            this.flowLevel = 1;
            return "flow";
          case "}":
          case "]":
            yield* this.pushCount(1);
            return "doc";
          case "*":
            yield* this.pushUntil(isNotAnchorChar);
            return "doc";
          case '"':
          case "'":
            return yield* this.parseQuotedScalar();
          case "|":
          case ">":
            n += yield* this.parseBlockScalarHeader();
            n += yield* this.pushSpaces(true);
            yield* this.pushCount(line.length - n);
            yield* this.pushNewline();
            return yield* this.parseBlockScalar();
          default:
            return yield* this.parsePlainScalar();
        }
      }
      *parseFlowCollection() {
        let nl, sp;
        let indent = -1;
        do {
          nl = yield* this.pushNewline();
          if (nl > 0) {
            sp = yield* this.pushSpaces(false);
            this.indentValue = indent = sp;
          } else {
            sp = 0;
          }
          sp += yield* this.pushSpaces(true);
        } while (nl + sp > 0);
        const line = this.getLine();
        if (line === null)
          return this.setNext("flow");
        if (indent !== -1 && indent < this.indentNext && line[0] !== "#" || indent === 0 && (line.startsWith("---") || line.startsWith("...")) && isEmpty(line[3])) {
          const atFlowEndMarker = indent === this.indentNext - 1 && this.flowLevel === 1 && (line[0] === "]" || line[0] === "}");
          if (!atFlowEndMarker) {
            this.flowLevel = 0;
            yield cst.FLOW_END;
            return yield* this.parseLineStart();
          }
        }
        let n = 0;
        while (line[n] === ",") {
          n += yield* this.pushCount(1);
          n += yield* this.pushSpaces(true);
          this.flowKey = false;
        }
        n += yield* this.pushIndicators();
        switch (line[n]) {
          case void 0:
            return "flow";
          case "#":
            yield* this.pushCount(line.length - n);
            return "flow";
          case "{":
          case "[":
            yield* this.pushCount(1);
            this.flowKey = false;
            this.flowLevel += 1;
            return "flow";
          case "}":
          case "]":
            yield* this.pushCount(1);
            this.flowKey = true;
            this.flowLevel -= 1;
            return this.flowLevel ? "flow" : "doc";
          case "*":
            yield* this.pushUntil(isNotAnchorChar);
            return "flow";
          case '"':
          case "'":
            this.flowKey = true;
            return yield* this.parseQuotedScalar();
          case ":": {
            const next = this.charAt(1);
            if (this.flowKey || isEmpty(next) || next === ",") {
              this.flowKey = false;
              yield* this.pushCount(1);
              yield* this.pushSpaces(true);
              return "flow";
            }
          }
          // fallthrough
          default:
            this.flowKey = false;
            return yield* this.parsePlainScalar();
        }
      }
      *parseQuotedScalar() {
        const quote = this.charAt(0);
        let end = this.buffer.indexOf(quote, this.pos + 1);
        if (quote === "'") {
          while (end !== -1 && this.buffer[end + 1] === "'")
            end = this.buffer.indexOf("'", end + 2);
        } else {
          while (end !== -1) {
            let n = 0;
            while (this.buffer[end - 1 - n] === "\\")
              n += 1;
            if (n % 2 === 0)
              break;
            end = this.buffer.indexOf('"', end + 1);
          }
        }
        const qb = this.buffer.substring(0, end);
        let nl = qb.indexOf("\n", this.pos);
        if (nl !== -1) {
          while (nl !== -1) {
            const cs = this.continueScalar(nl + 1);
            if (cs === -1)
              break;
            nl = qb.indexOf("\n", cs);
          }
          if (nl !== -1) {
            end = nl - (qb[nl - 1] === "\r" ? 2 : 1);
          }
        }
        if (end === -1) {
          if (!this.atEnd)
            return this.setNext("quoted-scalar");
          end = this.buffer.length;
        }
        yield* this.pushToIndex(end + 1, false);
        return this.flowLevel ? "flow" : "doc";
      }
      *parseBlockScalarHeader() {
        this.blockScalarIndent = -1;
        this.blockScalarKeep = false;
        let i = this.pos;
        while (true) {
          const ch = this.buffer[++i];
          if (ch === "+")
            this.blockScalarKeep = true;
          else if (ch > "0" && ch <= "9")
            this.blockScalarIndent = Number(ch) - 1;
          else if (ch !== "-")
            break;
        }
        return yield* this.pushUntil((ch) => isEmpty(ch) || ch === "#");
      }
      *parseBlockScalar() {
        let nl = this.pos - 1;
        let indent = 0;
        let ch;
        loop: for (let i2 = this.pos; ch = this.buffer[i2]; ++i2) {
          switch (ch) {
            case " ":
              indent += 1;
              break;
            case "\n":
              nl = i2;
              indent = 0;
              break;
            case "\r": {
              const next = this.buffer[i2 + 1];
              if (!next && !this.atEnd)
                return this.setNext("block-scalar");
              if (next === "\n")
                break;
            }
            // fallthrough
            default:
              break loop;
          }
        }
        if (!ch && !this.atEnd)
          return this.setNext("block-scalar");
        if (indent >= this.indentNext) {
          if (this.blockScalarIndent === -1)
            this.indentNext = indent;
          else {
            this.indentNext = this.blockScalarIndent + (this.indentNext === 0 ? 1 : this.indentNext);
          }
          do {
            const cs = this.continueScalar(nl + 1);
            if (cs === -1)
              break;
            nl = this.buffer.indexOf("\n", cs);
          } while (nl !== -1);
          if (nl === -1) {
            if (!this.atEnd)
              return this.setNext("block-scalar");
            nl = this.buffer.length;
          }
        }
        let i = nl + 1;
        ch = this.buffer[i];
        while (ch === " ")
          ch = this.buffer[++i];
        if (ch === "	") {
          while (ch === "	" || ch === " " || ch === "\r" || ch === "\n")
            ch = this.buffer[++i];
          nl = i - 1;
        } else if (!this.blockScalarKeep) {
          do {
            let i2 = nl - 1;
            let ch2 = this.buffer[i2];
            if (ch2 === "\r")
              ch2 = this.buffer[--i2];
            const lastChar = i2;
            while (ch2 === " ")
              ch2 = this.buffer[--i2];
            if (ch2 === "\n" && i2 >= this.pos && i2 + 1 + indent > lastChar)
              nl = i2;
            else
              break;
          } while (true);
        }
        yield cst.SCALAR;
        yield* this.pushToIndex(nl + 1, true);
        return yield* this.parseLineStart();
      }
      *parsePlainScalar() {
        const inFlow = this.flowLevel > 0;
        let end = this.pos - 1;
        let i = this.pos - 1;
        let ch;
        while (ch = this.buffer[++i]) {
          if (ch === ":") {
            const next = this.buffer[i + 1];
            if (isEmpty(next) || inFlow && flowIndicatorChars.has(next))
              break;
            end = i;
          } else if (isEmpty(ch)) {
            let next = this.buffer[i + 1];
            if (ch === "\r") {
              if (next === "\n") {
                i += 1;
                ch = "\n";
                next = this.buffer[i + 1];
              } else
                end = i;
            }
            if (next === "#" || inFlow && flowIndicatorChars.has(next))
              break;
            if (ch === "\n") {
              const cs = this.continueScalar(i + 1);
              if (cs === -1)
                break;
              i = Math.max(i, cs - 2);
            }
          } else {
            if (inFlow && flowIndicatorChars.has(ch))
              break;
            end = i;
          }
        }
        if (!ch && !this.atEnd)
          return this.setNext("plain-scalar");
        yield cst.SCALAR;
        yield* this.pushToIndex(end + 1, true);
        return inFlow ? "flow" : "doc";
      }
      *pushCount(n) {
        if (n > 0) {
          yield this.buffer.substr(this.pos, n);
          this.pos += n;
          return n;
        }
        return 0;
      }
      *pushToIndex(i, allowEmpty) {
        const s = this.buffer.slice(this.pos, i);
        if (s) {
          yield s;
          this.pos += s.length;
          return s.length;
        } else if (allowEmpty)
          yield "";
        return 0;
      }
      *pushIndicators() {
        let n = 0;
        loop: while (true) {
          switch (this.charAt(0)) {
            case "!":
              n += yield* this.pushTag();
              n += yield* this.pushSpaces(true);
              continue loop;
            case "&":
              n += yield* this.pushUntil(isNotAnchorChar);
              n += yield* this.pushSpaces(true);
              continue loop;
            case "-":
            // this is an error
            case "?":
            // this is an error outside flow collections
            case ":": {
              const inFlow = this.flowLevel > 0;
              const ch1 = this.charAt(1);
              if (isEmpty(ch1) || inFlow && flowIndicatorChars.has(ch1)) {
                if (!inFlow)
                  this.indentNext = this.indentValue + 1;
                else if (this.flowKey)
                  this.flowKey = false;
                n += yield* this.pushCount(1);
                n += yield* this.pushSpaces(true);
                continue loop;
              }
            }
          }
          break loop;
        }
        return n;
      }
      *pushTag() {
        if (this.charAt(1) === "<") {
          let i = this.pos + 2;
          let ch = this.buffer[i];
          while (!isEmpty(ch) && ch !== ">")
            ch = this.buffer[++i];
          return yield* this.pushToIndex(ch === ">" ? i + 1 : i, false);
        } else {
          let i = this.pos + 1;
          let ch = this.buffer[i];
          while (ch) {
            if (tagChars.has(ch))
              ch = this.buffer[++i];
            else if (ch === "%" && hexDigits.has(this.buffer[i + 1]) && hexDigits.has(this.buffer[i + 2])) {
              ch = this.buffer[i += 3];
            } else
              break;
          }
          return yield* this.pushToIndex(i, false);
        }
      }
      *pushNewline() {
        const ch = this.buffer[this.pos];
        if (ch === "\n")
          return yield* this.pushCount(1);
        else if (ch === "\r" && this.charAt(1) === "\n")
          return yield* this.pushCount(2);
        else
          return 0;
      }
      *pushSpaces(allowTabs) {
        let i = this.pos - 1;
        let ch;
        do {
          ch = this.buffer[++i];
        } while (ch === " " || allowTabs && ch === "	");
        const n = i - this.pos;
        if (n > 0) {
          yield this.buffer.substr(this.pos, n);
          this.pos = i;
        }
        return n;
      }
      *pushUntil(test) {
        let i = this.pos;
        let ch = this.buffer[i];
        while (!test(ch))
          ch = this.buffer[++i];
        return yield* this.pushToIndex(i, false);
      }
    };
    exports2.Lexer = Lexer;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/line-counter.js
var require_line_counter = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/line-counter.js"(exports2) {
    "use strict";
    var LineCounter = class {
      constructor() {
        this.lineStarts = [];
        this.addNewLine = (offset) => this.lineStarts.push(offset);
        this.linePos = (offset) => {
          let low = 0;
          let high = this.lineStarts.length;
          while (low < high) {
            const mid = low + high >> 1;
            if (this.lineStarts[mid] < offset)
              low = mid + 1;
            else
              high = mid;
          }
          if (this.lineStarts[low] === offset)
            return { line: low + 1, col: 1 };
          if (low === 0)
            return { line: 0, col: offset };
          const start = this.lineStarts[low - 1];
          return { line: low, col: offset - start + 1 };
        };
      }
    };
    exports2.LineCounter = LineCounter;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/parser.js
var require_parser = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/parser.js"(exports2) {
    "use strict";
    var node_process = require("process");
    var cst = require_cst();
    var lexer = require_lexer();
    function includesToken(list, type) {
      for (let i = 0; i < list.length; ++i)
        if (list[i].type === type)
          return true;
      return false;
    }
    function findNonEmptyIndex(list) {
      for (let i = 0; i < list.length; ++i) {
        switch (list[i].type) {
          case "space":
          case "comment":
          case "newline":
            break;
          default:
            return i;
        }
      }
      return -1;
    }
    function isFlowToken(token) {
      switch (token?.type) {
        case "alias":
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
        case "flow-collection":
          return true;
        default:
          return false;
      }
    }
    function getPrevProps(parent) {
      switch (parent.type) {
        case "document":
          return parent.start;
        case "block-map": {
          const it = parent.items[parent.items.length - 1];
          return it.sep ?? it.start;
        }
        case "block-seq":
          return parent.items[parent.items.length - 1].start;
        /* istanbul ignore next should not happen */
        default:
          return [];
      }
    }
    function getFirstKeyStartProps(prev) {
      if (prev.length === 0)
        return [];
      let i = prev.length;
      loop: while (--i >= 0) {
        switch (prev[i].type) {
          case "doc-start":
          case "explicit-key-ind":
          case "map-value-ind":
          case "seq-item-ind":
          case "newline":
            break loop;
        }
      }
      while (prev[++i]?.type === "space") {
      }
      return prev.splice(i, prev.length);
    }
    function arrayPushArray(target, source) {
      if (source.length < 1e5)
        Array.prototype.push.apply(target, source);
      else
        for (let i = 0; i < source.length; ++i)
          target.push(source[i]);
    }
    function fixFlowSeqItems(fc) {
      if (fc.start.type === "flow-seq-start") {
        for (const it of fc.items) {
          if (it.sep && !it.value && !includesToken(it.start, "explicit-key-ind") && !includesToken(it.sep, "map-value-ind")) {
            if (it.key)
              it.value = it.key;
            delete it.key;
            if (isFlowToken(it.value)) {
              if (it.value.end)
                arrayPushArray(it.value.end, it.sep);
              else
                it.value.end = it.sep;
            } else
              arrayPushArray(it.start, it.sep);
            delete it.sep;
          }
        }
      }
    }
    var Parser = class {
      /**
       * @param onNewLine - If defined, called separately with the start position of
       *   each new line (in `parse()`, including the start of input).
       */
      constructor(onNewLine) {
        this.atNewLine = true;
        this.atScalar = false;
        this.indent = 0;
        this.offset = 0;
        this.onKeyLine = false;
        this.stack = [];
        this.source = "";
        this.type = "";
        this.lexer = new lexer.Lexer();
        this.onNewLine = onNewLine;
      }
      /**
       * Parse `source` as a YAML stream.
       * If `incomplete`, a part of the last line may be left as a buffer for the next call.
       *
       * Errors are not thrown, but yielded as `{ type: 'error', message }` tokens.
       *
       * @returns A generator of tokens representing each directive, document, and other structure.
       */
      *parse(source, incomplete = false) {
        if (this.onNewLine && this.offset === 0)
          this.onNewLine(0);
        for (const lexeme of this.lexer.lex(source, incomplete))
          yield* this.next(lexeme);
        if (!incomplete)
          yield* this.end();
      }
      /**
       * Advance the parser by the `source` of one lexical token.
       */
      *next(source) {
        this.source = source;
        if (node_process.env.LOG_TOKENS)
          console.log("|", cst.prettyToken(source));
        if (this.atScalar) {
          this.atScalar = false;
          yield* this.step();
          this.offset += source.length;
          return;
        }
        const type = cst.tokenType(source);
        if (!type) {
          const message = `Not a YAML token: ${source}`;
          yield* this.pop({ type: "error", offset: this.offset, message, source });
          this.offset += source.length;
        } else if (type === "scalar") {
          this.atNewLine = false;
          this.atScalar = true;
          this.type = "scalar";
        } else {
          this.type = type;
          yield* this.step();
          switch (type) {
            case "newline":
              this.atNewLine = true;
              this.indent = 0;
              if (this.onNewLine)
                this.onNewLine(this.offset + source.length);
              break;
            case "space":
              if (this.atNewLine && source[0] === " ")
                this.indent += source.length;
              break;
            case "explicit-key-ind":
            case "map-value-ind":
            case "seq-item-ind":
              if (this.atNewLine)
                this.indent += source.length;
              break;
            case "doc-mode":
            case "flow-error-end":
              return;
            default:
              this.atNewLine = false;
          }
          this.offset += source.length;
        }
      }
      /** Call at end of input to push out any remaining constructions */
      *end() {
        while (this.stack.length > 0)
          yield* this.pop();
      }
      get sourceToken() {
        const st = {
          type: this.type,
          offset: this.offset,
          indent: this.indent,
          source: this.source
        };
        return st;
      }
      *step() {
        const top = this.peek(1);
        if (this.type === "doc-end" && top?.type !== "doc-end") {
          while (this.stack.length > 0)
            yield* this.pop();
          this.stack.push({
            type: "doc-end",
            offset: this.offset,
            source: this.source
          });
          return;
        }
        if (!top)
          return yield* this.stream();
        switch (top.type) {
          case "document":
            return yield* this.document(top);
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return yield* this.scalar(top);
          case "block-scalar":
            return yield* this.blockScalar(top);
          case "block-map":
            return yield* this.blockMap(top);
          case "block-seq":
            return yield* this.blockSequence(top);
          case "flow-collection":
            return yield* this.flowCollection(top);
          case "doc-end":
            return yield* this.documentEnd(top);
        }
        yield* this.pop();
      }
      peek(n) {
        return this.stack[this.stack.length - n];
      }
      *pop(error) {
        const token = error ?? this.stack.pop();
        if (!token) {
          const message = "Tried to pop an empty stack";
          yield { type: "error", offset: this.offset, source: "", message };
        } else if (this.stack.length === 0) {
          yield token;
        } else {
          const top = this.peek(1);
          if (token.type === "block-scalar") {
            token.indent = "indent" in top ? top.indent : 0;
          } else if (token.type === "flow-collection" && top.type === "document") {
            token.indent = 0;
          }
          if (token.type === "flow-collection")
            fixFlowSeqItems(token);
          switch (top.type) {
            case "document":
              top.value = token;
              break;
            case "block-scalar":
              top.props.push(token);
              break;
            case "block-map": {
              const it = top.items[top.items.length - 1];
              if (it.value) {
                top.items.push({ start: [], key: token, sep: [] });
                this.onKeyLine = true;
                return;
              } else if (it.sep) {
                it.value = token;
              } else {
                Object.assign(it, { key: token, sep: [] });
                this.onKeyLine = !it.explicitKey;
                return;
              }
              break;
            }
            case "block-seq": {
              const it = top.items[top.items.length - 1];
              if (it.value)
                top.items.push({ start: [], value: token });
              else
                it.value = token;
              break;
            }
            case "flow-collection": {
              const it = top.items[top.items.length - 1];
              if (!it || it.value)
                top.items.push({ start: [], key: token, sep: [] });
              else if (it.sep)
                it.value = token;
              else
                Object.assign(it, { key: token, sep: [] });
              return;
            }
            /* istanbul ignore next should not happen */
            default:
              yield* this.pop();
              yield* this.pop(token);
          }
          if ((top.type === "document" || top.type === "block-map" || top.type === "block-seq") && (token.type === "block-map" || token.type === "block-seq")) {
            const last = token.items[token.items.length - 1];
            if (last && !last.sep && !last.value && last.start.length > 0 && findNonEmptyIndex(last.start) === -1 && (token.indent === 0 || last.start.every((st) => st.type !== "comment" || st.indent < token.indent))) {
              if (top.type === "document")
                top.end = last.start;
              else
                top.items.push({ start: last.start });
              token.items.splice(-1, 1);
            }
          }
        }
      }
      *stream() {
        switch (this.type) {
          case "directive-line":
            yield { type: "directive", offset: this.offset, source: this.source };
            return;
          case "byte-order-mark":
          case "space":
          case "comment":
          case "newline":
            yield this.sourceToken;
            return;
          case "doc-mode":
          case "doc-start": {
            const doc = {
              type: "document",
              offset: this.offset,
              start: []
            };
            if (this.type === "doc-start")
              doc.start.push(this.sourceToken);
            this.stack.push(doc);
            return;
          }
        }
        yield {
          type: "error",
          offset: this.offset,
          message: `Unexpected ${this.type} token in YAML stream`,
          source: this.source
        };
      }
      *document(doc) {
        if (doc.value)
          return yield* this.lineEnd(doc);
        switch (this.type) {
          case "doc-start": {
            if (findNonEmptyIndex(doc.start) !== -1) {
              yield* this.pop();
              yield* this.step();
            } else
              doc.start.push(this.sourceToken);
            return;
          }
          case "anchor":
          case "tag":
          case "space":
          case "comment":
          case "newline":
            doc.start.push(this.sourceToken);
            return;
        }
        const bv = this.startBlockValue(doc);
        if (bv)
          this.stack.push(bv);
        else {
          yield {
            type: "error",
            offset: this.offset,
            message: `Unexpected ${this.type} token in YAML document`,
            source: this.source
          };
        }
      }
      *scalar(scalar) {
        if (this.type === "map-value-ind") {
          const prev = getPrevProps(this.peek(2));
          const start = getFirstKeyStartProps(prev);
          let sep2;
          if (scalar.end) {
            sep2 = scalar.end;
            sep2.push(this.sourceToken);
            delete scalar.end;
          } else
            sep2 = [this.sourceToken];
          const map = {
            type: "block-map",
            offset: scalar.offset,
            indent: scalar.indent,
            items: [{ start, key: scalar, sep: sep2 }]
          };
          this.onKeyLine = true;
          this.stack[this.stack.length - 1] = map;
        } else
          yield* this.lineEnd(scalar);
      }
      *blockScalar(scalar) {
        switch (this.type) {
          case "space":
          case "comment":
          case "newline":
            scalar.props.push(this.sourceToken);
            return;
          case "scalar":
            scalar.source = this.source;
            this.atNewLine = true;
            this.indent = 0;
            if (this.onNewLine) {
              let nl = this.source.indexOf("\n") + 1;
              while (nl !== 0) {
                this.onNewLine(this.offset + nl);
                nl = this.source.indexOf("\n", nl) + 1;
              }
            }
            yield* this.pop();
            break;
          /* istanbul ignore next should not happen */
          default:
            yield* this.pop();
            yield* this.step();
        }
      }
      *blockMap(map) {
        const it = map.items[map.items.length - 1];
        switch (this.type) {
          case "newline":
            this.onKeyLine = false;
            if (it.value) {
              const end = "end" in it.value ? it.value.end : void 0;
              const last = Array.isArray(end) ? end[end.length - 1] : void 0;
              if (last?.type === "comment")
                end?.push(this.sourceToken);
              else
                map.items.push({ start: [this.sourceToken] });
            } else if (it.sep) {
              it.sep.push(this.sourceToken);
            } else {
              it.start.push(this.sourceToken);
            }
            return;
          case "space":
          case "comment":
            if (it.value) {
              map.items.push({ start: [this.sourceToken] });
            } else if (it.sep) {
              it.sep.push(this.sourceToken);
            } else {
              if (this.atIndentedComment(it.start, map.indent)) {
                const prev = map.items[map.items.length - 2];
                const end = prev?.value?.end;
                if (Array.isArray(end)) {
                  arrayPushArray(end, it.start);
                  end.push(this.sourceToken);
                  map.items.pop();
                  return;
                }
              }
              it.start.push(this.sourceToken);
            }
            return;
        }
        if (this.indent >= map.indent) {
          const atMapIndent = !this.onKeyLine && this.indent === map.indent;
          const atNextItem = atMapIndent && (it.sep || it.explicitKey) && this.type !== "seq-item-ind";
          let start = [];
          if (atNextItem && it.sep && !it.value) {
            const nl = [];
            for (let i = 0; i < it.sep.length; ++i) {
              const st = it.sep[i];
              switch (st.type) {
                case "newline":
                  nl.push(i);
                  break;
                case "space":
                  break;
                case "comment":
                  if (st.indent > map.indent)
                    nl.length = 0;
                  break;
                default:
                  nl.length = 0;
              }
            }
            if (nl.length >= 2)
              start = it.sep.splice(nl[1]);
          }
          switch (this.type) {
            case "anchor":
            case "tag":
              if (atNextItem || it.value) {
                start.push(this.sourceToken);
                map.items.push({ start });
                this.onKeyLine = true;
              } else if (it.sep) {
                it.sep.push(this.sourceToken);
              } else {
                it.start.push(this.sourceToken);
              }
              return;
            case "explicit-key-ind":
              if (!it.sep && !it.explicitKey) {
                it.start.push(this.sourceToken);
                it.explicitKey = true;
              } else if (atNextItem || it.value) {
                start.push(this.sourceToken);
                map.items.push({ start, explicitKey: true });
              } else {
                this.stack.push({
                  type: "block-map",
                  offset: this.offset,
                  indent: this.indent,
                  items: [{ start: [this.sourceToken], explicitKey: true }]
                });
              }
              this.onKeyLine = true;
              return;
            case "map-value-ind":
              if (it.explicitKey) {
                if (!it.sep) {
                  if (includesToken(it.start, "newline")) {
                    Object.assign(it, { key: null, sep: [this.sourceToken] });
                  } else {
                    const start2 = getFirstKeyStartProps(it.start);
                    this.stack.push({
                      type: "block-map",
                      offset: this.offset,
                      indent: this.indent,
                      items: [{ start: start2, key: null, sep: [this.sourceToken] }]
                    });
                  }
                } else if (it.value) {
                  map.items.push({ start: [], key: null, sep: [this.sourceToken] });
                } else if (includesToken(it.sep, "map-value-ind")) {
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start, key: null, sep: [this.sourceToken] }]
                  });
                } else if (isFlowToken(it.key) && !includesToken(it.sep, "newline")) {
                  const start2 = getFirstKeyStartProps(it.start);
                  const key = it.key;
                  const sep2 = it.sep;
                  sep2.push(this.sourceToken);
                  delete it.key;
                  delete it.sep;
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: start2, key, sep: sep2 }]
                  });
                } else if (start.length > 0) {
                  it.sep = it.sep.concat(start, this.sourceToken);
                } else {
                  it.sep.push(this.sourceToken);
                }
              } else {
                if (!it.sep) {
                  Object.assign(it, { key: null, sep: [this.sourceToken] });
                } else if (it.value || atNextItem) {
                  map.items.push({ start, key: null, sep: [this.sourceToken] });
                } else if (includesToken(it.sep, "map-value-ind")) {
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: [], key: null, sep: [this.sourceToken] }]
                  });
                } else {
                  it.sep.push(this.sourceToken);
                }
              }
              this.onKeyLine = true;
              return;
            case "alias":
            case "scalar":
            case "single-quoted-scalar":
            case "double-quoted-scalar": {
              const fs18 = this.flowScalar(this.type);
              if (atNextItem || it.value) {
                map.items.push({ start, key: fs18, sep: [] });
                this.onKeyLine = true;
              } else if (it.sep) {
                this.stack.push(fs18);
              } else {
                Object.assign(it, { key: fs18, sep: [] });
                this.onKeyLine = true;
              }
              return;
            }
            default: {
              const bv = this.startBlockValue(map);
              if (bv) {
                if (bv.type === "block-seq") {
                  if (!it.explicitKey && it.sep && !includesToken(it.sep, "newline")) {
                    yield* this.pop({
                      type: "error",
                      offset: this.offset,
                      message: "Unexpected block-seq-ind on same line with key",
                      source: this.source
                    });
                    return;
                  }
                } else if (atMapIndent) {
                  map.items.push({ start });
                }
                this.stack.push(bv);
                return;
              }
            }
          }
        }
        yield* this.pop();
        yield* this.step();
      }
      *blockSequence(seq) {
        const it = seq.items[seq.items.length - 1];
        switch (this.type) {
          case "newline":
            if (it.value) {
              const end = "end" in it.value ? it.value.end : void 0;
              const last = Array.isArray(end) ? end[end.length - 1] : void 0;
              if (last?.type === "comment")
                end?.push(this.sourceToken);
              else
                seq.items.push({ start: [this.sourceToken] });
            } else
              it.start.push(this.sourceToken);
            return;
          case "space":
          case "comment":
            if (it.value)
              seq.items.push({ start: [this.sourceToken] });
            else {
              if (this.atIndentedComment(it.start, seq.indent)) {
                const prev = seq.items[seq.items.length - 2];
                const end = prev?.value?.end;
                if (Array.isArray(end)) {
                  arrayPushArray(end, it.start);
                  end.push(this.sourceToken);
                  seq.items.pop();
                  return;
                }
              }
              it.start.push(this.sourceToken);
            }
            return;
          case "anchor":
          case "tag":
            if (it.value || this.indent <= seq.indent)
              break;
            it.start.push(this.sourceToken);
            return;
          case "seq-item-ind":
            if (this.indent !== seq.indent)
              break;
            if (it.value || includesToken(it.start, "seq-item-ind"))
              seq.items.push({ start: [this.sourceToken] });
            else
              it.start.push(this.sourceToken);
            return;
        }
        if (this.indent > seq.indent) {
          const bv = this.startBlockValue(seq);
          if (bv) {
            this.stack.push(bv);
            return;
          }
        }
        yield* this.pop();
        yield* this.step();
      }
      *flowCollection(fc) {
        const it = fc.items[fc.items.length - 1];
        if (this.type === "flow-error-end") {
          let top;
          do {
            yield* this.pop();
            top = this.peek(1);
          } while (top?.type === "flow-collection");
        } else if (fc.end.length === 0) {
          switch (this.type) {
            case "comma":
            case "explicit-key-ind":
              if (!it || it.sep)
                fc.items.push({ start: [this.sourceToken] });
              else
                it.start.push(this.sourceToken);
              return;
            case "map-value-ind":
              if (!it || it.value)
                fc.items.push({ start: [], key: null, sep: [this.sourceToken] });
              else if (it.sep)
                it.sep.push(this.sourceToken);
              else
                Object.assign(it, { key: null, sep: [this.sourceToken] });
              return;
            case "space":
            case "comment":
            case "newline":
            case "anchor":
            case "tag":
              if (!it || it.value)
                fc.items.push({ start: [this.sourceToken] });
              else if (it.sep)
                it.sep.push(this.sourceToken);
              else
                it.start.push(this.sourceToken);
              return;
            case "alias":
            case "scalar":
            case "single-quoted-scalar":
            case "double-quoted-scalar": {
              const fs18 = this.flowScalar(this.type);
              if (!it || it.value)
                fc.items.push({ start: [], key: fs18, sep: [] });
              else if (it.sep)
                this.stack.push(fs18);
              else
                Object.assign(it, { key: fs18, sep: [] });
              return;
            }
            case "flow-map-end":
            case "flow-seq-end":
              fc.end.push(this.sourceToken);
              return;
          }
          const bv = this.startBlockValue(fc);
          if (bv)
            this.stack.push(bv);
          else {
            yield* this.pop();
            yield* this.step();
          }
        } else {
          const parent = this.peek(2);
          if (parent.type === "block-map" && (this.type === "map-value-ind" && parent.indent === fc.indent || this.type === "newline" && !parent.items[parent.items.length - 1].sep)) {
            yield* this.pop();
            yield* this.step();
          } else if (this.type === "map-value-ind" && parent.type !== "flow-collection") {
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            fixFlowSeqItems(fc);
            const sep2 = fc.end.splice(1, fc.end.length);
            sep2.push(this.sourceToken);
            const map = {
              type: "block-map",
              offset: fc.offset,
              indent: fc.indent,
              items: [{ start, key: fc, sep: sep2 }]
            };
            this.onKeyLine = true;
            this.stack[this.stack.length - 1] = map;
          } else {
            yield* this.lineEnd(fc);
          }
        }
      }
      flowScalar(type) {
        if (this.onNewLine) {
          let nl = this.source.indexOf("\n") + 1;
          while (nl !== 0) {
            this.onNewLine(this.offset + nl);
            nl = this.source.indexOf("\n", nl) + 1;
          }
        }
        return {
          type,
          offset: this.offset,
          indent: this.indent,
          source: this.source
        };
      }
      startBlockValue(parent) {
        switch (this.type) {
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return this.flowScalar(this.type);
          case "block-scalar-header":
            return {
              type: "block-scalar",
              offset: this.offset,
              indent: this.indent,
              props: [this.sourceToken],
              source: ""
            };
          case "flow-map-start":
          case "flow-seq-start":
            return {
              type: "flow-collection",
              offset: this.offset,
              indent: this.indent,
              start: this.sourceToken,
              items: [],
              end: []
            };
          case "seq-item-ind":
            return {
              type: "block-seq",
              offset: this.offset,
              indent: this.indent,
              items: [{ start: [this.sourceToken] }]
            };
          case "explicit-key-ind": {
            this.onKeyLine = true;
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            start.push(this.sourceToken);
            return {
              type: "block-map",
              offset: this.offset,
              indent: this.indent,
              items: [{ start, explicitKey: true }]
            };
          }
          case "map-value-ind": {
            this.onKeyLine = true;
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            return {
              type: "block-map",
              offset: this.offset,
              indent: this.indent,
              items: [{ start, key: null, sep: [this.sourceToken] }]
            };
          }
        }
        return null;
      }
      atIndentedComment(start, indent) {
        if (this.type !== "comment")
          return false;
        if (this.indent <= indent)
          return false;
        return start.every((st) => st.type === "newline" || st.type === "space");
      }
      *documentEnd(docEnd) {
        if (this.type !== "doc-mode") {
          if (docEnd.end)
            docEnd.end.push(this.sourceToken);
          else
            docEnd.end = [this.sourceToken];
          if (this.type === "newline")
            yield* this.pop();
        }
      }
      *lineEnd(token) {
        switch (this.type) {
          case "comma":
          case "doc-start":
          case "doc-end":
          case "flow-seq-end":
          case "flow-map-end":
          case "map-value-ind":
            yield* this.pop();
            yield* this.step();
            break;
          case "newline":
            this.onKeyLine = false;
          // fallthrough
          case "space":
          case "comment":
          default:
            if (token.end)
              token.end.push(this.sourceToken);
            else
              token.end = [this.sourceToken];
            if (this.type === "newline")
              yield* this.pop();
        }
      }
    };
    exports2.Parser = Parser;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/public-api.js
var require_public_api = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/public-api.js"(exports2) {
    "use strict";
    var composer = require_composer();
    var Document = require_Document();
    var errors = require_errors2();
    var log = require_log();
    var identity = require_identity();
    var lineCounter = require_line_counter();
    var parser = require_parser();
    function parseOptions(options) {
      const prettyErrors = options.prettyErrors !== false;
      const lineCounter$1 = options.lineCounter || prettyErrors && new lineCounter.LineCounter() || null;
      return { lineCounter: lineCounter$1, prettyErrors };
    }
    function parseAllDocuments(source, options = {}) {
      const { lineCounter: lineCounter2, prettyErrors } = parseOptions(options);
      const parser$1 = new parser.Parser(lineCounter2?.addNewLine);
      const composer$1 = new composer.Composer(options);
      const docs = Array.from(composer$1.compose(parser$1.parse(source)));
      if (prettyErrors && lineCounter2)
        for (const doc of docs) {
          doc.errors.forEach(errors.prettifyError(source, lineCounter2));
          doc.warnings.forEach(errors.prettifyError(source, lineCounter2));
        }
      if (docs.length > 0)
        return docs;
      return Object.assign([], { empty: true }, composer$1.streamInfo());
    }
    function parseDocument(source, options = {}) {
      const { lineCounter: lineCounter2, prettyErrors } = parseOptions(options);
      const parser$1 = new parser.Parser(lineCounter2?.addNewLine);
      const composer$1 = new composer.Composer(options);
      let doc = null;
      for (const _doc of composer$1.compose(parser$1.parse(source), true, source.length)) {
        if (!doc)
          doc = _doc;
        else if (doc.options.logLevel !== "silent") {
          doc.errors.push(new errors.YAMLParseError(_doc.range.slice(0, 2), "MULTIPLE_DOCS", "Source contains multiple documents; please use YAML.parseAllDocuments()"));
          break;
        }
      }
      if (prettyErrors && lineCounter2) {
        doc.errors.forEach(errors.prettifyError(source, lineCounter2));
        doc.warnings.forEach(errors.prettifyError(source, lineCounter2));
      }
      return doc;
    }
    function parse(src, reviver, options) {
      let _reviver = void 0;
      if (typeof reviver === "function") {
        _reviver = reviver;
      } else if (options === void 0 && reviver && typeof reviver === "object") {
        options = reviver;
      }
      const doc = parseDocument(src, options);
      if (!doc)
        return null;
      doc.warnings.forEach((warning) => log.warn(doc.options.logLevel, warning));
      if (doc.errors.length > 0) {
        if (doc.options.logLevel !== "silent")
          throw doc.errors[0];
        else
          doc.errors = [];
      }
      return doc.toJS(Object.assign({ reviver: _reviver }, options));
    }
    function stringify(value, replacer, options) {
      let _replacer = null;
      if (typeof replacer === "function" || Array.isArray(replacer)) {
        _replacer = replacer;
      } else if (options === void 0 && replacer) {
        options = replacer;
      }
      if (typeof options === "string")
        options = options.length;
      if (typeof options === "number") {
        const indent = Math.round(options);
        options = indent < 1 ? void 0 : indent > 8 ? { indent: 8 } : { indent };
      }
      if (value === void 0) {
        const { keepUndefined } = options ?? replacer ?? {};
        if (!keepUndefined)
          return void 0;
      }
      if (identity.isDocument(value) && !_replacer)
        return value.toString(options);
      return new Document.Document(value, _replacer, options).toString(options);
    }
    exports2.parse = parse;
    exports2.parseAllDocuments = parseAllDocuments;
    exports2.parseDocument = parseDocument;
    exports2.stringify = stringify;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/index.js
var require_dist = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/index.js"(exports2) {
    "use strict";
    var composer = require_composer();
    var Document = require_Document();
    var Schema = require_Schema();
    var errors = require_errors2();
    var Alias = require_Alias();
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var cst = require_cst();
    var lexer = require_lexer();
    var lineCounter = require_line_counter();
    var parser = require_parser();
    var publicApi = require_public_api();
    var visit = require_visit();
    exports2.Composer = composer.Composer;
    exports2.Document = Document.Document;
    exports2.Schema = Schema.Schema;
    exports2.YAMLError = errors.YAMLError;
    exports2.YAMLParseError = errors.YAMLParseError;
    exports2.YAMLWarning = errors.YAMLWarning;
    exports2.Alias = Alias.Alias;
    exports2.isAlias = identity.isAlias;
    exports2.isCollection = identity.isCollection;
    exports2.isDocument = identity.isDocument;
    exports2.isMap = identity.isMap;
    exports2.isNode = identity.isNode;
    exports2.isPair = identity.isPair;
    exports2.isScalar = identity.isScalar;
    exports2.isSeq = identity.isSeq;
    exports2.Pair = Pair.Pair;
    exports2.Scalar = Scalar.Scalar;
    exports2.YAMLMap = YAMLMap.YAMLMap;
    exports2.YAMLSeq = YAMLSeq.YAMLSeq;
    exports2.CST = cst;
    exports2.Lexer = lexer.Lexer;
    exports2.LineCounter = lineCounter.LineCounter;
    exports2.Parser = parser.Parser;
    exports2.parse = publicApi.parse;
    exports2.parseAllDocuments = publicApi.parseAllDocuments;
    exports2.parseDocument = publicApi.parseDocument;
    exports2.stringify = publicApi.stringify;
    exports2.visit = visit.visit;
    exports2.visitAsync = visit.visitAsync;
  }
});

// packages/core/src/npm-runtime.js
var init_npm_runtime = __esm({
  "packages/core/src/npm-runtime.js"() {
    init_src();
  }
});

// packages/core/src/shims.js
var init_shims = __esm({
  "packages/core/src/shims.js"() {
    init_src();
    init_npm_runtime();
  }
});

// src/agent-host/task-capsule-worker.js
var import_node_fs17 = __toESM(require("node:fs"), 1);
var import_node_path20 = __toESM(require("node:path"), 1);
var import_node_child_process12 = require("node:child_process");

// src/agent-host/task-audit.js
var import_node_fs = __toESM(require("node:fs"), 1);
var import_node_path = __toESM(require("node:path"), 1);
var import_node_os = __toESM(require("node:os"), 1);
var import_node_url = require("node:url");
var import_node_child_process = require("node:child_process");
var import_meta = {};
function isQualifiedTaskAuditHost() {
  return process.platform === "darwin" && import_node_os.default.release().startsWith("24.") && process.arch === "x64";
}
function auditHelperPath() {
  if (!isQualifiedTaskAuditHost()) throw new Error("task audit containment requires the qualified Darwin 24 x64 host");
  const entry = process.argv[1] || "";
  const helper = entry.endsWith(".cjs") ? import_node_path.default.join(import_node_path.default.dirname(entry), "task-audit-darwin") : (0, import_node_url.fileURLToPath)(new URL("../../dist/task-audit-darwin", import_meta.url));
  const stat = import_node_fs.default.lstatSync(helper);
  if (!stat.isFile() || stat.nlink !== 1 || import_node_fs.default.realpathSync(helper) !== helper) throw new Error("invalid task audit helper");
  import_node_fs.default.accessSync(helper, import_node_fs.default.constants.X_OK);
  return helper;
}
function invoke(args) {
  return JSON.parse((0, import_node_child_process.execFileSync)(auditHelperPath(), args, {
    encoding: "utf8",
    timeout: 5e3,
    maxBuffer: 16384,
    env: { PATH: "/usr/bin:/bin" },
    stdio: ["ignore", "pipe", "pipe"]
  }));
}
function auditIdentity(pid) {
  return invoke(["identity", String(pid)]);
}
function validateAuditIdentity(value) {
  if (!value || Object.keys(value).sort().join(",") !== "asid,pid,uid,unique,version" || ![value.pid, value.version, value.asid, value.uid].every(Number.isSafeInteger) || value.pid < 2 || value.version < 1 || value.asid < 1e5 || value.uid !== process.getuid() || !/^[1-9][0-9]{0,19}$/u.test(value.unique) || BigInt(value.unique) > 18446744073709551615n) throw new Error("invalid task audit identity");
  return value;
}
function createAuditScope(capsule) {
  if (!capsule || !/^com\.learnrudi\.(?:fixture\.)?containment\.[a-f0-9-]{36}$/u.test(capsule.label || "") || !Number.isSafeInteger(capsule.creatorPid) || capsule.creatorPid < 2 || process.ppid !== 1) {
    throw new Error("task requires a launchd audit-session capsule");
  }
  const owner = validateAuditIdentity(auditIdentity(process.pid));
  const creator = validateAuditIdentity(auditIdentity(capsule.creatorPid));
  const job = (0, import_node_child_process.execFileSync)(
    "/bin/launchctl",
    ["print", `gui/${process.getuid()}/${capsule.label}`],
    { encoding: "utf8", timeout: 5e3, maxBuffer: 65536, stdio: ["ignore", "pipe", "pipe"] }
  );
  const pid = job.match(/^\s*pid = (\d+)$/mu);
  if (!pid || Number(pid[1]) !== process.pid || owner.asid === creator.asid) throw new Error("capsule session isolation unconfirmed");
  return { schema_version: 1, label: capsule.label, owner };
}
async function drainAuditScope(scope, guardian = null) {
  if (scope?.schema_version !== 1) throw new Error("invalid audit scope");
  const owner = validateAuditIdentity(scope.owner);
  if (guardian && validateAuditIdentity(guardian).asid !== owner.asid) throw new Error("guardian audit scope mismatch");
  const args = [
    "sweep",
    owner.asid,
    owner.unique,
    owner.pid,
    owner.version,
    guardian?.pid || 0,
    guardian?.version || 0,
    9
  ].map(String);
  const end = Date.now() + 7e3;
  let quiet = false;
  let last;
  while (Date.now() < end) {
    const result = invoke(args);
    last = result;
    const empty = result.members === 0 && result.uncertain === 0;
    if (empty && quiet) return;
    quiet = empty;
    await new Promise((resolve2) => setTimeout(resolve2, 25));
  }
  throw new Error(`audit session drain unconfirmed; custody blocked: ${JSON.stringify(last)}`);
}

// src/agent-host/task-capsule.js
var import_node_fs4 = __toESM(require("node:fs"), 1);

// src/agent-host/task-profile.js
var import_node_fs3 = __toESM(require("node:fs"), 1);
var import_node_path3 = __toESM(require("node:path"), 1);
var import_node_crypto = __toESM(require("node:crypto"), 1);

// src/agent-host/providers/catalog.js
var import_node_fs2 = require("node:fs");
var import_node_path2 = require("node:path");
var import_node_os2 = require("node:os");

// src/utils/subprocess.js
var import_node_child_process2 = require("node:child_process");
function assertCommandValue(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new Error(`Invalid command ${label}`);
  }
  return value;
}
function createCommandPlan(command, args = []) {
  return {
    command: assertCommandValue(command, "name"),
    args: Array.isArray(args) ? args.map((arg, index) => assertCommandValue(arg, `arg ${index}`)) : []
  };
}
function createWhichCommand(commandName) {
  return createCommandPlan("which", [commandName]);
}
function runCommandPlan(plan, options = {}) {
  const { execFileSync: execFileSync4 = import_node_child_process2.execFileSync, ...execOptions } = options;
  const normalized = createCommandPlan(plan?.command, plan?.args || []);
  const mergedOptions = plan?.cwd ? { cwd: assertCommandValue(plan.cwd, "cwd"), ...execOptions } : execOptions;
  return execFileSync4(normalized.command, normalized.args, mergedOptions);
}

// src/agent-host/providers/config/claude.json
var claude_default = {
  $schema: "https://learnrudi.com/schemas/headless-agent-v1.json",
  id: "claude",
  name: "Claude Code",
  description: "Anthropic Claude Code CLI \u2014 headless mode",
  version: "1.0.0",
  binary: {
    name: "claude",
    resolvePaths: [
      "~/.local/bin/claude",
      "/opt/homebrew/bin/claude",
      "/usr/local/bin/claude"
    ],
    fallback: "which",
    checkCommand: ["claude", "--version"],
    loginCommand: ["claude", "auth", "login"],
    authCheck: ["claude", "auth", "status"]
  },
  headless: {
    command: "claude",
    promptDelivery: "arg-or-stdin",
    privateAutomation: {
      profile: "private-automation-v1",
      promptDelivery: "stdin",
      sessionPersistence: false,
      tools: false
    },
    args: {
      base: [
        "--output-format",
        "stream-json",
        "--verbose"
      ],
      conditionals: [
        { if: "print", args: ["--print"] },
        { if: "prompt", args: ["-p", "{{prompt}}"] },
        { if: "model", args: ["--model", "{{model}}"] },
        { if: "fallbackModel", args: ["--fallback-model", "{{fallbackModel}}"] },
        { if: "systemPrompt", args: ["--append-system-prompt", "{{systemPrompt}}"] },
        { if: "systemPromptFile", args: ["--append-system-prompt-file", "{{systemPromptFile}}"] },
        { if: "replaceSystemPrompt", args: ["--system-prompt", "{{replaceSystemPrompt}}"] },
        { if: "replaceSystemPromptFile", args: ["--system-prompt-file", "{{replaceSystemPromptFile}}"] },
        { if: "allowedTools", args: ["--allowedTools", "{{allowedTools|join: }}"] },
        { if: "disallowedTools", args: ["--disallowedTools", "{{disallowedTools|join: }}"] },
        { if: "tools", args: ["--tools", "{{tools|join:,}}"] },
        { if: "mcpConfig", args: ["--mcp-config", "{{mcpConfig}}"] },
        { if: "strictMcpConfig", args: ["--strict-mcp-config"] },
        { if: "resumeSessionId", args: ["--resume", "{{resumeSessionId}}"] },
        { if: "continueSession", args: ["--continue"] },
        { if: "sessionId", args: ["--session-id", "{{sessionId}}"] },
        { if: "forkSession", args: ["--fork-session"] },
        { if: "jsonSchema", args: ["--json-schema", "{{jsonSchema}}"] },
        { if: "maxTurns", args: ["--max-turns", "{{maxTurns}}"] },
        { if: "maxBudgetUsd", args: ["--max-budget-usd", "{{maxBudgetUsd}}"] },
        { if: "noSessionPersistence", args: ["--no-session-persistence"] },
        { if: "addDirs", args: ["--add-dir", "{{addDirs|join: }}"] },
        { if: "agents", args: ["--agents", "{{agents}}"] },
        { if: "agent", args: ["--agent", "{{agent}}"] },
        { if: "effort", args: ["--effort", "{{effort}}"] },
        { if: "bare", args: ["--bare"] },
        { if: "safeMode", args: ["--safe-mode"] },
        { if: "background", args: ["--background"] },
        { if: "worktree", args: ["--worktree", "{{worktree}}"] },
        { if: "tmux", args: ["--tmux", "{{tmux}}"] },
        { if: "name", args: ["--name", "{{name}}"] },
        { if: "includeHookEvents", args: ["--include-hook-events"] },
        { if: "promptSuggestions", args: ["--prompt-suggestions", "{{promptSuggestions}}"] },
        { if: "pluginUrl", args: ["--plugin-url", "{{pluginUrl}}"] },
        { if: "includePartialMessages", args: ["--include-partial-messages"] },
        { if: "inputFormat", args: ["--input-format", "{{inputFormat}}"] },
        { if: "replayUserMessages", args: ["--replay-user-messages"] },
        { if: "chrome", args: ["--chrome"] },
        { if: "noChrome", args: ["--no-chrome"] },
        { if: "debug", args: ["--debug", "{{debug}}"] },
        { if: "debugFile", args: ["--debug-file", "{{debugFile}}"] },
        { if: "betas", args: ["--betas", "{{betas|join: }}"] },
        { if: "settings", args: ["--settings", "{{settings}}"] },
        { if: "settingSources", args: ["--setting-sources", "{{settingSources}}"] },
        { if: "pluginDir", args: ["--plugin-dir", "{{pluginDir}}"] },
        { if: "disableSlashCommands", args: ["--disable-slash-commands"] },
        { if: "permissionPromptTool", args: ["--permission-prompt-tool", "{{permissionPromptTool}}"] },
        { if: "teammateMode", args: ["--teammate-mode", "{{teammateMode}}"] },
        { if: "file", args: ["--file", "{{file|join: }}"] },
        { if: "fromPr", args: ["--from-pr", "{{fromPr}}"] },
        { if: "remote", args: ["--remote", "{{remote}}"] },
        { if: "teleport", args: ["--teleport"] },
        { if: "ide", args: ["--ide"] },
        { if: "init", args: ["--init"] },
        { if: "initOnly", args: ["--init-only"] },
        { if: "maintenance", args: ["--maintenance"] },
        { if: "allowDangerouslySkipPermissions", args: ["--allow-dangerously-skip-permissions"] },
        { if: "outputFormat", args: ["--output-format", "{{outputFormat}}"] }
      ]
    },
    permissionModes: {
      agent: ["--dangerously-skip-permissions"],
      plan: ["--permission-mode", "plan"],
      acceptEdits: ["--permission-mode", "acceptEdits"],
      auto: ["--permission-mode", "auto"],
      dontAsk: ["--permission-mode", "dontAsk"],
      bypassPermissions: ["--permission-mode", "bypassPermissions"],
      default: ["--permission-mode", "default"]
    },
    env: {
      TERM: "xterm-256color",
      CI: "true",
      CLAUDE_NO_UPDATE_CHECK: "true",
      CLAUDE_CODE_SKIP_PROMPT_HISTORY: "1",
      DISABLE_AUTOUPDATE: "1",
      NO_COLOR: "1"
    },
    authEnvVars: [
      "ANTHROPIC_API_KEY",
      "CLAUDE_CODE_OAUTH_TOKEN"
    ],
    stdin: "pipe",
    timeouts: {
      startupMs: 12e4,
      runtimeMs: 9e5,
      shutdownGraceMs: 5e3
    }
  },
  eventStream: {
    format: "json-lines",
    sessionIdExtractor: {
      path: "$.session_id",
      fromEventTypes: ["assistant", "result"]
    },
    events: {
      system: {
        condition: "$.type === 'system'",
        fields: {
          subtype: "$.subtype",
          message: "$.message",
          content: "$.message.content[*]",
          compactMetadata: "$.compactMetadata"
        },
        subtypes: ["init", "compact_boundary"]
      },
      assistant: {
        condition: "$.type === 'assistant'",
        fields: {
          messageId: "$.message.id",
          role: "$.message.role",
          model: "$.message.model",
          stopReason: "$.message.stop_reason",
          content: "$.message.content[*]",
          usage: {
            inputTokens: "$.message.usage.input_tokens",
            outputTokens: "$.message.usage.output_tokens",
            cacheReadTokens: "$.message.usage.cache_read_input_tokens",
            cacheCreationTokens: "$.message.usage.cache_creation_input_tokens"
          }
        },
        contentBlockTypes: {
          text: {
            condition: "block.type === 'text'",
            fields: { text: "block.text" }
          },
          tool_use: {
            condition: "block.type === 'tool_use'",
            fields: {
              id: "block.id",
              name: "block.name",
              input: "block.input"
            }
          },
          tool_result: {
            condition: "block.type === 'tool_result'",
            fields: {
              id: "block.id",
              content: "block.content"
            }
          },
          thinking: {
            condition: "block.type === 'thinking'",
            fields: { thinking: "block.thinking" }
          }
        }
      },
      result: {
        condition: "$.type === 'result'",
        fields: {
          sessionId: "$.session_id",
          result: "$.result",
          structuredOutput: "$.structured_output",
          totalCostUsd: "$.total_cost_usd",
          durationMs: "$.duration_ms",
          numTurns: "$.num_turns",
          usage: {
            inputTokens: "$.usage.input_tokens",
            outputTokens: "$.usage.output_tokens",
            cacheReadTokens: "$.usage.cache_read_input_tokens",
            cacheCreationTokens: "$.usage.cache_creation_input_tokens"
          }
        }
      },
      error: {
        condition: "$.type === 'error'",
        fields: {
          message: "$.result",
          errorCode: "$.error_code"
        }
      },
      stream_event: {
        condition: "$.type === 'stream_event'",
        note: "Only emitted with --include-partial-messages",
        fields: {
          eventType: "$.event.type",
          event: "$.event"
        },
        innerEventTypes: {
          message_start: {},
          content_block_start: {
            fields: {
              blockType: "$.event.content_block.type",
              blockId: "$.event.content_block.id",
              toolName: "$.event.content_block.name"
            }
          },
          content_block_delta: {
            deltaTypes: {
              text_delta: { fields: { text: "$.event.delta.text" } },
              input_json_delta: { fields: { partialJson: "$.event.delta.partial_json" } }
            }
          },
          content_block_stop: {},
          message_delta: {
            fields: {
              stopReason: "$.event.delta.stop_reason",
              usage: "$.event.usage"
            }
          },
          message_stop: {}
        }
      }
    }
  },
  models: {
    default: "claude-opus-5",
    available: [
      {
        id: "claude-fable-5",
        reasoningEfforts: [
          "low",
          "medium",
          "high",
          "xhigh",
          "max"
        ],
        alias: "fable",
        name: "Claude Fable 5",
        description: "Anthropic's highest-capability widely released model for long-running agents",
        tier: "frontier",
        pricing: {
          inputPerMTok: 10,
          outputPerMTok: 50
        },
        contextWindow: 1e6,
        maxOutputTokens: 128e3,
        knowledgeCutoff: "2026-01",
        trainingCutoff: "2026-01",
        adaptiveThinking: true
      },
      {
        id: "claude-opus-5",
        reasoningEfforts: [
          "low",
          "medium",
          "high",
          "xhigh",
          "max"
        ],
        alias: "opus",
        name: "Claude Opus 5",
        description: "Recommended for complex agentic coding and enterprise work",
        tier: "pro",
        default: true,
        pricing: {
          inputPerMTok: 5,
          outputPerMTok: 25,
          cachedReadPerMTok: 0.5,
          cachedWritePerMTok: 6.25
        },
        contextWindow: 1e6,
        maxOutputTokens: 128e3,
        knowledgeCutoff: "2026-05",
        trainingCutoff: "2026-05",
        adaptiveThinking: true
      },
      {
        id: "claude-sonnet-5",
        reasoningEfforts: [
          "low",
          "medium",
          "high",
          "xhigh",
          "max"
        ],
        alias: "sonnet",
        name: "Claude Sonnet 5",
        description: "Best combination of speed and intelligence",
        tier: "pro",
        pricing: {
          inputPerMTok: 3,
          outputPerMTok: 15,
          cachedReadPerMTok: 0.3,
          cachedWritePerMTok: 3.75
        },
        contextWindow: 1e6,
        maxOutputTokens: 128e3,
        knowledgeCutoff: "2026-01",
        trainingCutoff: "2026-01",
        adaptiveThinking: true
      },
      {
        id: "claude-haiku-4-5-20251001",
        alias: "haiku",
        name: "Haiku 4.5",
        description: "Fastest model with near-frontier intelligence",
        tier: "free",
        pricing: {
          inputPerMTok: 1,
          outputPerMTok: 5,
          cachedReadPerMTok: 0.1,
          cachedWritePerMTok: 1.25
        },
        contextWindow: 2e5,
        maxOutputTokens: 64e3,
        knowledgeCutoff: "2025-02",
        trainingCutoff: "2025-07"
      },
      {
        id: "claude-fable-5-1",
        alias: "fable-5-1",
        name: "Claude Fable 5.1",
        description: "Exact Claude model ID; account access and runtime qualification apply.",
        reasoningEfforts: [
          "low",
          "medium",
          "high",
          "xhigh",
          "max"
        ]
      },
      {
        id: "claude-opus-5-5",
        alias: "opus-5-5",
        name: "Claude Opus 5.5",
        description: "Exact Claude model ID; account access and runtime qualification apply.",
        reasoningEfforts: [
          "low",
          "medium",
          "high",
          "xhigh",
          "max"
        ]
      },
      {
        id: "claude-sonnet-5-5",
        alias: "sonnet-5-5",
        name: "Claude Sonnet 5.5",
        description: "Exact Claude model ID; account access and runtime qualification apply.",
        reasoningEfforts: [
          "low",
          "medium",
          "high",
          "xhigh",
          "max"
        ]
      },
      {
        id: "claude-haiku-5-5",
        alias: "haiku-5-5",
        name: "Claude Haiku 5.5",
        description: "Exact Claude model ID; account access and runtime qualification apply.",
        reasoningEfforts: [
          "low",
          "medium",
          "high",
          "xhigh",
          "max"
        ]
      },
      {
        id: "claude-opus-4-8",
        alias: "opus-4-8",
        name: "Claude Opus 4.8",
        description: "Exact Claude model ID; account access and runtime qualification apply.",
        reasoningEfforts: [
          "low",
          "medium",
          "high",
          "xhigh",
          "max"
        ]
      },
      {
        id: "claude-opus-4-7",
        alias: "opus-4-7",
        name: "Claude Opus 4.7",
        description: "Exact Claude model ID; account access and runtime qualification apply.",
        reasoningEfforts: [
          "low",
          "medium",
          "high",
          "xhigh",
          "max"
        ]
      },
      {
        id: "claude-opus-4-6",
        alias: "opus-4-6",
        name: "Claude Opus 4.6",
        description: "Exact Claude model ID; account access and runtime qualification apply.",
        reasoningEfforts: [
          "low",
          "medium",
          "high",
          "max"
        ]
      },
      {
        id: "claude-sonnet-4-6",
        alias: "sonnet-4-6",
        name: "Claude Sonnet 4.6",
        description: "Exact Claude model ID; account access and runtime qualification apply.",
        reasoningEfforts: [
          "low",
          "medium",
          "high",
          "max"
        ]
      },
      {
        id: "claude-opus-4-5-20251101",
        alias: "opus-4-5-20251101",
        name: "Claude Opus 4.5",
        description: "Exact Claude model ID; account access and runtime qualification apply."
      }
    ]
  },
  capabilities: {
    streaming: true,
    partialStreaming: true,
    tools: true,
    thinking: true,
    adaptiveThinking: true,
    systemPrompt: { append: true, replace: true, fromFile: true },
    sessionResume: true,
    sessionContinue: true,
    forkSession: true,
    conversationHistory: "server",
    contextLimitTokens: 2e5,
    contextLimitExtended: 1e6,
    structuredOutput: true,
    subagents: true,
    skills: true,
    plugins: true,
    rawArgs: true,
    chrome: true,
    planMode: true,
    opusPlan: true,
    maxTurns: true,
    maxBudget: true,
    permissionPromptTool: true,
    inputStreaming: true,
    addDirs: true,
    pluginDirs: true,
    mcpConfig: true,
    settingsOverride: true,
    imageInput: true,
    imageGeneration: { native: false, via: "RUDI image-generator stack" },
    webSearch: false,
    codeReview: false,
    sandbox: false,
    effortLevel: true,
    remote: true,
    teleport: true
  }
};

// src/agent-host/providers/config/codex.json
var codex_default = {
  $schema: "https://learnrudi.com/schemas/headless-agent-v1.json",
  id: "codex",
  name: "Codex",
  description: "OpenAI Codex CLI \u2014 headless mode",
  version: "1.0.0",
  binary: {
    name: "codex",
    resolvePaths: [
      "~/.local/bin/codex",
      "/opt/homebrew/bin/codex",
      "/usr/local/bin/codex"
    ],
    fallback: "which",
    checkCommand: ["codex", "--version"],
    loginCommand: ["codex", "login"],
    authCheck: ["codex", "login", "status"]
  },
  headless: {
    command: "codex",
    subcommand: "exec",
    promptDelivery: "arg",
    stdinPrompt: "-",
    privateAutomation: {
      minimumVersion: "0.147.0",
      profile: "private-automation-v1",
      promptDelivery: "stdin",
      sessionPersistence: false,
      tools: false
    },
    args: {
      prefixConditionals: [
        { if: "approvalPolicy", args: ["--ask-for-approval", "{{approvalPolicy}}"] },
        { if: "search", args: ["--search"] }
      ],
      base: [
        "exec",
        "{{prompt}}",
        "--json",
        "--skip-git-repo-check",
        "--color",
        "never"
      ],
      conditionals: [
        { if: "cwd", args: ["-C", "{{cwd}}"] },
        { if: "model", args: ["-m", "{{model}}"] },
        { if: "config", args: ["-c", "{{config}}"] },
        { if: "image", args: ["-i", "{{image|join:,}}"] },
        { if: "profile", args: ["-p", "{{profile}}"] },
        { if: "outputSchema", args: ["--output-schema", "{{outputSchema}}"] },
        { if: "outputLastMessage", args: ["-o", "{{outputLastMessage}}"] },
        { if: "addDir", args: ["--add-dir", "{{addDir}}"] },
        { if: "ephemeral", args: ["--ephemeral"] },
        { if: "enableFeature", args: ["--enable", "{{enableFeature}}"] },
        { if: "disableFeature", args: ["--disable", "{{disableFeature}}"] },
        { if: "oss", args: ["--oss"] },
        { if: "localProvider", args: ["--local-provider", "{{localProvider}}"] },
        { if: "strictConfig", args: ["--strict-config"] },
        { if: "ignoreUserConfig", args: ["--ignore-user-config"] },
        { if: "ignoreRules", args: ["--ignore-rules"] },
        { if: "dangerouslyBypassHookTrust", args: ["--dangerously-bypass-hook-trust"] },
        { if: "noAltScreen", args: ["-c", "tui.alternate_screen=false"] }
      ]
    },
    permissionModes: {
      agent: ["-c", 'approval_policy="never"', "-s", "workspace-write"],
      dangerous: ["--dangerously-bypass-approvals-and-sandbox"],
      approve: ["-s", "workspace-write"],
      readonly: ["-s", "read-only"],
      fullAccess: ["-s", "danger-full-access"]
    },
    approvalModes: {
      untrusted: ["-c", 'approval_policy="untrusted"'],
      onRequest: ["-c", 'approval_policy="on-request"'],
      never: ["-c", 'approval_policy="never"']
    },
    subcommands: {
      resume: {
        args: ["exec", "resume"],
        conditionals: [
          { if: "sessionId", args: ["{{sessionId}}"] },
          { if: "last", args: ["--last"] },
          { if: "all", args: ["--all"] },
          { if: "prompt", args: ["{{prompt}}"] },
          { if: "image", args: ["-i", "{{image}}"] }
        ]
      },
      review: {
        args: ["exec", "review"],
        conditionals: [
          { if: "uncommitted", args: ["--uncommitted"] },
          { if: "base", args: ["--base", "{{base}}"] },
          { if: "commit", args: ["--commit", "{{commit}}"] },
          { if: "title", args: ["--title", "{{title}}"] },
          { if: "prompt", args: ["{{prompt}}"] }
        ]
      },
      fork: {
        args: ["fork"],
        conditionals: [
          { if: "sessionId", args: ["{{sessionId}}"] },
          { if: "last", args: ["--last"] },
          { if: "all", args: ["--all"] }
        ]
      },
      cloud: {
        args: ["cloud", "exec"],
        conditionals: [
          { if: "prompt", args: ["{{prompt}}"] },
          { if: "env", args: ["--env", "{{env}}"] },
          { if: "attempts", args: ["--attempts", "{{attempts}}"] }
        ]
      },
      cloudList: {
        args: ["cloud", "list"],
        conditionals: [
          { if: "env", args: ["--env", "{{env}}"] },
          { if: "limit", args: ["--limit", "{{limit}}"] },
          { if: "cursor", args: ["--cursor", "{{cursor}}"] },
          { if: "json", args: ["--json"] }
        ]
      },
      apply: {
        args: ["apply"],
        conditionals: [
          { if: "taskId", args: ["{{taskId}}"] }
        ]
      }
    },
    env: {
      TERM: "xterm-256color",
      CI: "true"
    },
    authEnvVars: [
      "CODEX_API_KEY",
      "OPENAI_API_KEY"
    ],
    stdin: "pipe",
    timeouts: {
      startupMs: 12e4,
      runtimeMs: 9e5,
      shutdownGraceMs: 5e3
    }
  },
  eventStream: {
    format: "json-lines",
    sessionIdExtractor: {
      path: "$.thread_id",
      fromEventTypes: ["thread.started"]
    },
    events: {
      "thread.started": {
        condition: "$.type === 'thread.started'",
        fields: {
          threadId: "$.thread_id"
        }
      },
      "turn.started": {
        condition: "$.type === 'turn.started'",
        fields: {}
      },
      "turn.completed": {
        condition: "$.type === 'turn.completed'",
        fields: {
          usage: {
            inputTokens: "$.usage.input_tokens",
            cachedInputTokens: "$.usage.cached_input_tokens",
            outputTokens: "$.usage.output_tokens"
          }
        }
      },
      "turn.failed": {
        condition: "$.type === 'turn.failed'",
        fields: {
          errorMessage: "$.error.message"
        }
      },
      error: {
        condition: "$.type === 'error'",
        fields: {
          message: "$.message"
        }
      },
      "item.started": {
        condition: "$.type === 'item.started'",
        fields: {
          itemId: "$.item.id",
          itemType: "$.item.type",
          status: "$.item.status"
        }
      },
      "item.updated": {
        condition: "$.type === 'item.updated'",
        fields: {
          itemId: "$.item.id",
          itemType: "$.item.type",
          status: "$.item.status"
        }
      },
      "item.completed": {
        condition: "$.type === 'item.completed'",
        fields: {
          itemId: "$.item.id",
          itemType: "$.item.type",
          status: "$.item.status"
        }
      }
    },
    itemTypes: {
      agent_message: {
        lifecycle: ["completed"],
        fields: {
          text: "$.item.text"
        }
      },
      reasoning: {
        lifecycle: ["completed"],
        fields: {
          text: "$.item.text"
        }
      },
      command_execution: {
        lifecycle: ["started", "completed"],
        fields: {
          command: "$.item.command",
          output: "$.item.output",
          exitCode: "$.item.exit_code",
          status: "$.item.status"
        },
        notes: "output max 64 KiB"
      },
      file_change: {
        lifecycle: ["completed"],
        fields: {
          changes: "$.item.changes[*]",
          changePath: "$.item.changes[*].path",
          changeKind: "$.item.changes[*].kind",
          status: "$.item.status"
        },
        changeKinds: ["add", "delete", "update"]
      },
      mcp_tool_call: {
        lifecycle: ["started", "completed"],
        fields: {
          server: "$.item.server",
          tool: "$.item.tool",
          arguments: "$.item.arguments",
          resultContent: "$.item.result.content[*]",
          resultStructured: "$.item.result.structured_content",
          resultError: "$.item.result.error",
          status: "$.item.status"
        },
        mcpContentTypes: ["text", "image", "audio", "resource_link", "embedded_resource"]
      },
      web_search: {
        lifecycle: ["completed"],
        fields: {
          query: "$.item.query"
        }
      },
      todo_list: {
        lifecycle: ["started", "updated", "completed"],
        fields: {
          items: "$.item.items[*]",
          itemText: "$.item.items[*].text",
          itemCompleted: "$.item.items[*].completed"
        }
      },
      error: {
        lifecycle: ["completed"],
        fields: {
          message: "$.item.message"
        },
        notes: "Non-fatal item-level error"
      }
    },
    sessionFileEvents: {
      note: "Events from ~/.codex/sessions/ JSONL files (different schema from exec --json)",
      types: {
        session_meta: {
          fields: {
            id: "$.payload.id",
            timestamp: "$.payload.timestamp",
            cwd: "$.payload.cwd",
            originator: "$.payload.originator",
            cliVersion: "$.payload.cli_version",
            instructions: "$.payload.instructions",
            source: "$.payload.source",
            modelProvider: "$.payload.model_provider"
          }
        },
        response_item: {
          fields: {
            type: "$.payload.type",
            role: "$.payload.role",
            content: "$.payload.content[*]",
            summary: "$.payload.summary[*]",
            encryptedContent: "$.payload.encrypted_content"
          },
          payloadTypes: ["message", "reasoning"]
        },
        event_msg: {
          fields: {
            type: "$.payload.type",
            message: "$.payload.message",
            text: "$.payload.text",
            images: "$.payload.images[*]",
            totalTokenUsage: "$.payload.info.total_token_usage",
            lastTokenUsage: "$.payload.info.last_token_usage",
            modelContextWindow: "$.payload.info.model_context_window"
          },
          payloadTypes: ["user_message", "agent_message", "agent_reasoning", "token_count"],
          tokenUsageFields: ["input_tokens", "cached_input_tokens", "output_tokens", "reasoning_output_tokens", "total_tokens"]
        },
        turn_context: {
          fields: {
            cwd: "$.payload.cwd",
            approvalPolicy: "$.payload.approval_policy",
            sandboxPolicy: "$.payload.sandbox_policy",
            model: "$.payload.model",
            effort: "$.payload.effort",
            summary: "$.payload.summary"
          }
        }
      }
    }
  },
  models: {
    default: "gpt-5.6-sol",
    available: [
      {
        id: "gpt-6-luna",
        reasoningEfforts: [
          "low",
          "medium",
          "high",
          "xhigh",
          "max"
        ],
        alias: "6-luna",
        name: "GPT-6-Luna",
        description: "Fast and affordable model for easier tasks."
      },
      {
        id: "gpt-6-sol",
        reasoningEfforts: [
          "low",
          "medium",
          "high",
          "xhigh",
          "max",
          "ultra"
        ],
        alias: "6-sol",
        name: "GPT-6-Sol",
        description: "Previous generation workhorse model."
      },
      {
        id: "gpt-6.1-sol",
        reasoningEfforts: [
          "low",
          "medium",
          "high",
          "xhigh",
          "max",
          "ultra"
        ],
        alias: "6.1-sol",
        name: "GPT-6.1-Sol",
        description: "Latest workhorse model for coding and everyday work."
      },
      {
        id: "gpt-6-astra",
        reasoningEfforts: [
          "low",
          "medium",
          "high",
          "xhigh",
          "max",
          "ultra"
        ],
        alias: "astra",
        name: "GPT-6 Astra",
        description: "Frontier intelligence for the most demanding work."
      },
      {
        id: "gpt-5.6-sol",
        reasoningEfforts: [
          "low",
          "medium",
          "high",
          "xhigh",
          "max",
          "ultra"
        ],
        alias: "sol",
        name: "GPT-5.6 Sol",
        description: "Flagship model for complex coding, computer use, research, and security work",
        default: true
      },
      {
        id: "gpt-5.6-terra",
        reasoningEfforts: [
          "low",
          "medium",
          "high",
          "xhigh",
          "max",
          "ultra"
        ],
        alias: "terra",
        name: "GPT-5.6 Terra",
        description: "Balanced everyday workhorse for production tasks and coordinating subagents"
      },
      {
        id: "gpt-5.6-luna",
        reasoningEfforts: [
          "low",
          "medium",
          "high",
          "xhigh",
          "max"
        ],
        alias: "luna",
        name: "GPT-5.6 Luna",
        description: "Fast, low-cost model for narrow, repeatable, and high-volume work"
      }
    ]
  },
  capabilities: {
    streaming: true,
    partialStreaming: false,
    tools: true,
    thinking: true,
    systemPrompt: false,
    sessionResume: true,
    sessionContinue: true,
    forkSession: true,
    conversationHistory: "client",
    contextLimitTokens: 4e5,
    structuredOutput: true,
    subagents: true,
    skills: true,
    plugins: true,
    rawArgs: true,
    chrome: false,
    planMode: false,
    maxTurns: false,
    maxBudget: false,
    permissionPromptTool: false,
    inputStreaming: true,
    addDirs: true,
    pluginDirs: true,
    mcpConfig: true,
    settingsOverride: true,
    imageInput: true,
    imageGeneration: { native: true, via: "imagegen tool" },
    webSearch: true,
    codeReview: true,
    sandbox: true
  }
};

// src/agent-host/providers/config/gemini.json
var gemini_default = {
  $schema: "https://learnrudi.com/schemas/headless-agent-v1.json",
  id: "gemini",
  name: "Gemini CLI",
  description: "Google Gemini CLI \u2014 headless mode for API key, Vertex AI, or enterprise Code Assist credentials",
  version: "1.0.0",
  binary: {
    name: "gemini",
    resolvePaths: [
      "~/.local/bin/gemini",
      "/opt/homebrew/bin/gemini",
      "/usr/local/bin/gemini"
    ],
    fallback: "which",
    checkCommand: ["gemini", "--version"],
    loginCommand: ["gemini"],
    authCheck: ["gemini", "--version"]
  },
  headless: {
    command: "gemini",
    promptDelivery: "arg-or-stdin",
    args: {
      base: ["--output-format", "stream-json"],
      conditionals: [
        { if: "prompt", args: ["--prompt", "{{prompt}}"] },
        { if: "model", args: ["--model", "{{model}}"] },
        { if: "resume", args: ["--resume", "{{resume}}"] },
        { if: "sessionFile", args: ["--session-file", "{{sessionFile}}"] },
        { if: "sessionId", args: ["--session-id", "{{sessionId}}"] },
        { if: "includeDirectories", args: ["--include-directories", "{{includeDirectories|join:,}}"] },
        { if: "worktree", args: ["--worktree", "{{worktree}}"] },
        { if: "sandbox", args: ["--sandbox"] },
        { if: "approvalMode", args: ["--approval-mode", "{{approvalMode}}"] },
        { if: "policy", args: ["--policy", "{{policy|join:,}}"] },
        { if: "allowedMcpServerNames", args: ["--allowed-mcp-server-names", "{{allowedMcpServerNames|join:,}}"] },
        { if: "extensions", args: ["--extensions", "{{extensions|join:,}}"] },
        { if: "skipTrust", args: ["--skip-trust"] },
        { if: "outputFormat", args: ["--output-format", "{{outputFormat}}"] },
        { if: "rawOutput", args: ["--raw-output", "--accept-raw-output-risk"] },
        { if: "acp", args: ["--acp"] }
      ]
    },
    permissionModes: {
      agent: ["--approval-mode", "yolo"],
      plan: ["--approval-mode", "plan"],
      acceptEdits: ["--approval-mode", "auto_edit"],
      default: ["--approval-mode", "default"]
    },
    env: { TERM: "xterm-256color", CI: "true", NO_COLOR: "1" },
    authEnvVars: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENAI_USE_VERTEXAI", "GOOGLE_CLOUD_PROJECT"],
    stdin: "pipe",
    timeouts: { startupMs: 12e4, runtimeMs: 9e5, shutdownGraceMs: 5e3 }
  },
  eventStream: {
    format: "json-lines",
    sessionIdExtractor: { path: "$.session_id", fromEventTypes: ["init", "result"] },
    events: {
      init: { condition: "$.type === 'init'" },
      message: { condition: "$.type === 'message'" },
      tool_use: { condition: "$.type === 'tool_use'" },
      tool_result: { condition: "$.type === 'tool_result'" },
      result: { condition: "$.type === 'result'" },
      error: { condition: "$.type === 'error'" }
    }
  },
  models: {
    default: "auto",
    available: [
      { id: "auto", alias: "auto", name: "Gemini Auto", description: "Let Gemini CLI route to the best available model", default: true },
      { id: "gemini-3.1-pro-preview", alias: "pro", name: "Gemini 3.1 Pro Preview", description: "Google's current high-capability reasoning model" },
      { id: "gemini-3.6-flash", alias: "flash", name: "Gemini 3.6 Flash", description: "Latest GA agentic and multimodal Flash model" },
      { id: "gemini-3.5-flash-lite", alias: "flash-lite", name: "Gemini 3.5 Flash-Lite", description: "Latest GA low-latency high-volume model" },
      { id: "gemini-3.1-flash-image", alias: "image", name: "Gemini 3.1 Flash Image", description: "Nano Banana 2 native image model" },
      { id: "gemini-3-pro-image", alias: "image-pro", name: "Gemini 3 Pro Image", description: "Nano Banana Pro native image model" }
    ]
  },
  capabilities: {
    streaming: true,
    tools: true,
    thinking: true,
    sessionResume: true,
    sessionContinue: true,
    forkSession: false,
    structuredOutput: true,
    subagents: true,
    skills: true,
    extensions: true,
    hooks: true,
    rawArgs: true,
    planMode: true,
    inputStreaming: true,
    addDirs: true,
    mcpConfig: true,
    settingsOverride: true,
    imageInput: true,
    imageGeneration: { native: false, via: "RUDI image-generator stack or Gemini image API" },
    webSearch: true,
    sandbox: true,
    acp: true
  }
};

// src/agent-host/providers/config/antigravity.json
var antigravity_default = {
  $schema: "https://learnrudi.com/schemas/headless-agent-v1.json",
  id: "antigravity",
  name: "Antigravity CLI",
  description: "Google Antigravity CLI \u2014 subscription-backed headless agent host",
  version: "1.0.0",
  binary: {
    name: "agy",
    resolvePaths: ["~/.local/bin/agy", "/opt/homebrew/bin/agy", "/usr/local/bin/agy"],
    fallback: "which",
    checkCommand: ["agy", "--version"],
    loginCommand: ["agy"],
    authCheck: ["agy", "models"]
  },
  headless: {
    command: "agy",
    promptDelivery: "arg",
    args: {
      base: ["--output-format", "stream-json"],
      conditionals: [
        { if: "prompt", args: ["--print", "{{prompt}}"] },
        { if: "model", args: ["--model", "{{model}}"] },
        { if: "continueSession", args: ["--continue"] },
        { if: "conversation", args: ["--conversation", "{{conversation}}"] },
        { if: "jsonSchema", args: ["--json-schema", "{{jsonSchema}}"] },
        { if: "addDirs", args: ["--add-dir", "{{addDirs|join: }}"] },
        { if: "agent", args: ["--agent", "{{agent}}"] },
        { if: "effort", args: ["--effort", "{{effort}}"] },
        { if: "mode", args: ["--mode", "{{mode}}"] },
        { if: "project", args: ["--project", "{{project}}"] },
        { if: "newProject", args: ["--new-project"] },
        { if: "sandbox", args: ["--sandbox"] },
        { if: "disableSlashCommands", args: ["--disable-slash-commands"] },
        { if: "printTimeout", args: ["--print-timeout", "{{printTimeout}}"] },
        { if: "outputFormat", args: ["--output-format", "{{outputFormat}}"] }
      ]
    },
    permissionModes: {
      agent: ["--dangerously-skip-permissions"],
      plan: ["--mode", "plan"],
      acceptEdits: ["--mode", "accept-edits"],
      default: []
    },
    env: { TERM: "xterm-256color", CI: "true", NO_COLOR: "1" },
    authEnvVars: [],
    stdin: "pipe",
    timeouts: { startupMs: 12e4, runtimeMs: 9e5, shutdownGraceMs: 5e3 }
  },
  eventStream: {
    format: "json-lines",
    sessionIdExtractor: { path: "$.conversation_id", fromEventTypes: ["init", "result"] },
    events: {
      init: { condition: "$.type === 'init'" },
      assistant: { condition: "$.type === 'assistant'" },
      tool_use: { condition: "$.type === 'tool_use'" },
      tool_result: { condition: "$.type === 'tool_result'" },
      result: { condition: "$.type === 'result'" },
      error: { condition: "$.type === 'error'" }
    }
  },
  models: {
    default: "gemini-3.1-pro-high",
    available: [
      { id: "gemini-3.1-pro-high", alias: "pro", name: "Gemini 3.1 Pro High", description: "Highest reasoning Antigravity Gemini profile", default: true },
      { id: "gemini-3.1-pro-low", alias: "pro-low", name: "Gemini 3.1 Pro Low", description: "Lower-effort Gemini 3.1 Pro profile" },
      { id: "gemini-3.6-flash-high", alias: "flash", name: "Gemini 3.6 Flash High", description: "Latest Gemini Flash with high reasoning" },
      { id: "gemini-3.6-flash-medium", alias: "flash-medium", name: "Gemini 3.6 Flash Medium", description: "Balanced Gemini 3.6 Flash profile" },
      { id: "gemini-3.6-flash-low", alias: "flash-low", name: "Gemini 3.6 Flash Low", description: "Fast Gemini 3.6 Flash profile" },
      { id: "gemini-3.5-flash-high", alias: "3.5-flash", name: "Gemini 3.5 Flash High", description: "Gemini 3.5 Flash high reasoning profile" },
      { id: "claude-sonnet-4-6", alias: "claude", name: "Claude Sonnet 4.6", description: "Anthropic model exposed by Antigravity" },
      { id: "claude-opus-4-6-thinking", alias: "claude-opus", name: "Claude Opus 4.6 Thinking", description: "Anthropic thinking model exposed by Antigravity" },
      { id: "gpt-oss-120b-medium", alias: "gpt-oss", name: "GPT-OSS 120B Medium", description: "Open-weight model exposed by Antigravity" }
    ]
  },
  capabilities: {
    streaming: true,
    tools: true,
    thinking: true,
    sessionResume: true,
    sessionContinue: true,
    forkSession: false,
    structuredOutput: true,
    subagents: true,
    skills: true,
    plugins: true,
    rawArgs: true,
    planMode: true,
    inputStreaming: false,
    addDirs: true,
    mcpConfig: true,
    imageInput: true,
    imageGeneration: { native: true, tool: "generate_image", model: "Nano Banana 2" },
    webSearch: true,
    sandbox: true,
    effortLevel: true
  }
};

// src/agent-host/providers/catalog.js
var PROVIDER_CONFIGS = {
  claude: claude_default,
  codex: codex_default,
  gemini: gemini_default,
  antigravity: antigravity_default
};
function listProviders() {
  return Object.keys(PROVIDER_CONFIGS);
}
function loadProviderConfig(providerId) {
  const config = PROVIDER_CONFIGS[providerId];
  if (!config) {
    const available = listProviders().join(", ");
    throw new Error(`Unknown agent provider: ${providerId}. Available: ${available}`);
  }
  return config;
}
function canonicalPath(candidate, realpathSyncImpl) {
  const absolute = (0, import_node_path2.resolve)(candidate);
  try {
    return realpathSyncImpl(absolute);
  } catch {
    return absolute;
  }
}
function isInside(root, candidate) {
  const child = (0, import_node_path2.relative)(root, candidate);
  return child === "" || child !== ".." && !child.startsWith(`..${import_node_path2.sep}`) && !(0, import_node_path2.isAbsolute)(child);
}
function isExternalAgentBinaryPath(candidate, options = {}) {
  if (typeof candidate !== "string" || !(0, import_node_path2.isAbsolute)(candidate.trim()) || candidate.length > 4096 || /[\r\n\0]/u.test(candidate)) return false;
  const home = options.home || (0, import_node_os2.homedir)();
  const realpathSyncImpl = options.realpathSyncImpl || import_node_fs2.realpathSync;
  const lexicalCandidate = (0, import_node_path2.resolve)(candidate.trim());
  const canonicalCandidate = canonicalPath(lexicalCandidate, realpathSyncImpl);
  const rudiRoots = [(0, import_node_path2.join)(home, ".rudi"), options.rudiHome || process.env.RUDI_HOME].filter((root) => typeof root === "string" && (0, import_node_path2.isAbsolute)(root) && root.length <= 4096 && !/[\r\n\0]/u.test(root)).flatMap((root) => [(0, import_node_path2.resolve)(root), canonicalPath(root, realpathSyncImpl)]);
  return !rudiRoots.some((root) => isInside(root, lexicalCandidate) || isInside(root, canonicalCandidate));
}
function resolveProviderBinary(config, dependencies = {}) {
  const home = dependencies.home || (0, import_node_os2.homedir)();
  const arch = process.arch;
  const accessSyncImpl = dependencies.accessSyncImpl || import_node_fs2.accessSync;
  const existsSyncImpl = dependencies.existsSyncImpl || import_node_fs2.existsSync;
  const runCommandPlanImpl = dependencies.runCommandPlanImpl || runCommandPlan;
  const externalPathCheck = dependencies.isExternalAgentBinaryPathImpl || ((candidate) => isExternalAgentBinaryPath(candidate, {
    home,
    realpathSyncImpl: dependencies.realpathSyncImpl,
    rudiHome: dependencies.rudiHome
  }));
  const isExecutable = (candidate) => {
    try {
      accessSyncImpl(candidate, import_node_fs2.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  };
  for (const rawPath of config.binary.resolvePaths) {
    const resolved = rawPath.replace(/^~/, home).replace(/\{arch\}/g, arch);
    if (existsSyncImpl(resolved) && externalPathCheck(resolved) && isExecutable(resolved)) {
      return resolved;
    }
  }
  if (config.binary.fallback === "which") {
    try {
      const fallback = runCommandPlanImpl(
        createWhichCommand(config.binary.name),
        { encoding: "utf-8" }
      ).trim();
      return externalPathCheck(fallback) && isExecutable(fallback) ? fallback : null;
    } catch {
    }
  }
  return null;
}
function resolveModel(config, aliasOrId) {
  if (!aliasOrId) return config.models.default;
  for (const m of config.models.available) {
    if (m.alias === aliasOrId || m.id === aliasOrId) return m.id;
  }
  return aliasOrId;
}
function getModelDef(config, aliasOrId) {
  const id = resolveModel(config, aliasOrId);
  return config.models.available.find((m) => m.id === id) || null;
}
function buildArgs(config, options = {}) {
  const globalExtraArgs = normalizeExtraArgs(options.globalExtraArgs, "globalExtraArgs");
  const extraArgs = normalizeExtraArgs(options.extraArgs);
  const args = [...globalExtraArgs];
  appendConditionals(args, config.headless.args.prefixConditionals || [], options);
  for (const arg of config.headless.args.base) {
    args.push(expandTemplate(arg, options));
  }
  appendConditionals(args, config.headless.args.conditionals, options);
  args.push(...extraArgs);
  return args;
}
function appendConditionals(args, conditionals, options) {
  for (const cond of conditionals) {
    const key = cond.if;
    if (options[key] == null || options[key] === false) continue;
    for (const arg of cond.args) {
      const expanded = expandTemplate(arg, options);
      if (expanded !== arg || !arg.includes("{{")) {
        args.push(expanded);
      }
    }
  }
}
function normalizeExtraArgs(value, optionName = "extraArgs") {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new TypeError(`${optionName} must be an array of strings`);
  }
  return value.map((arg, index) => {
    if (typeof arg !== "string" || arg.trim() === "" || arg.includes("\0")) {
      throw new TypeError(`${optionName}[${index}] must be a non-empty string without NUL bytes`);
    }
    return arg;
  });
}
function getPermissionArgs(config, mode) {
  const modes = config.headless.permissionModes;
  if (!modes[mode]) {
    throw new Error(`Unknown permission mode: ${mode}. Available: ${Object.keys(modes).join(", ")}`);
  }
  return modes[mode];
}
function buildEnv(config, secrets = {}) {
  const env = { ...config.headless.env };
  for (const key of config.headless.authEnvVars) {
    if (secrets[key]) env[key] = secrets[key];
  }
  return env;
}
function buildSubcommandArgs(config, subcommand, options = {}) {
  const extraArgs = normalizeExtraArgs(options.extraArgs);
  const subs = config.headless.subcommands;
  if (!subs) return null;
  if (!subs[subcommand]) {
    throw new Error(`Unknown subcommand: ${subcommand}. Available: ${Object.keys(subs).join(", ")}`);
  }
  const sub = subs[subcommand];
  const args = [...sub.args];
  for (const cond of sub.conditionals) {
    const key = cond.if;
    if (options[key] == null || options[key] === false) continue;
    for (const arg of cond.args) {
      args.push(expandTemplate(arg, options));
    }
  }
  args.push(...extraArgs);
  return args;
}
function expandTemplate(str, options) {
  return str.replace(/\{\{(\w+)(?:\|join:(.+?))?\}\}/g, (_, key, joinSep) => {
    const val = options[key];
    if (val == null) return "";
    if (Array.isArray(val) && joinSep != null) return val.join(joinSep);
    if (Array.isArray(val)) return val.join(" ");
    return String(val);
  });
}

// src/agent-host/task-profile.js
var validatedProfiles = /* @__PURE__ */ new WeakSet();
var TASK_MODE = "registered-shared";
var TASK_MAX_BYTES = 262144;
function exactFields(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== [...fields].sort().join(",")) {
    throw new Error(`${label} has invalid fields`);
  }
}
function taskText(value, label, max = 4096) {
  if (typeof value !== "string" || !value.trim() || !value.isWellFormed() || /[\u0000-\u001f\u007f]/u.test(value) || Buffer.byteLength(value) > max) {
    throw new Error(`${label} must be bounded valid text`);
  }
  return value;
}
function inside(candidate, root) {
  const relative2 = import_node_path3.default.relative(root, candidate);
  return relative2 === "" || !relative2.startsWith(`..${import_node_path3.default.sep}`) && relative2 !== ".." && !import_node_path3.default.isAbsolute(relative2);
}
function canonicalDirectory(value, label) {
  taskText(value, label);
  if (!import_node_path3.default.isAbsolute(value) || import_node_path3.default.normalize(value) !== value || /[\*?\[\]]/u.test(value) || import_node_fs3.default.realpathSync(value) !== value || !import_node_fs3.default.statSync(value).isDirectory()) {
    throw new Error(`${label} must be an existing canonical directory without aliases or glob characters`);
  }
  return value;
}
function sha256(bytes) {
  return import_node_crypto.default.createHash("sha256").update(bytes).digest("hex");
}
function readTaskReference(reference, label) {
  exactFields(reference, ["path", "sha256"], label);
  taskText(reference.path, `${label} path`);
  if (!/^[a-f0-9]{64}$/u.test(reference.sha256)) throw new Error(`${label} requires SHA-256`);
  const name = reference.path;
  if (!import_node_path3.default.isAbsolute(name) || import_node_fs3.default.realpathSync(name) !== name) throw new Error(`${label} path must be canonical`);
  const bytes = readTaskRegularFile(name, TASK_MAX_BYTES);
  if (bytes.length < 1 || sha256(bytes) !== reference.sha256) throw new Error(`${label} hash mismatch`);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
function readTaskRegularFile(filename, maximum, singleLink = false) {
  const flags = import_node_fs3.default.constants.O_RDONLY | import_node_fs3.default.constants.O_NOFOLLOW | import_node_fs3.default.constants.O_NONBLOCK;
  const fd = import_node_fs3.default.openSync(filename, flags);
  try {
    const before = import_node_fs3.default.fstatSync(fd);
    if (!before.isFile() || before.size > maximum || singleLink && before.nlink !== 1) {
      throw new Error("invalid bounded regular file or hardlink");
    }
    const buffer = Buffer.alloc(maximum + 1);
    let size = 0;
    while (size <= maximum) {
      const count = import_node_fs3.default.readSync(fd, buffer, size, buffer.length - size, null);
      if (!count) break;
      size += count;
    }
    const after = import_node_fs3.default.fstatSync(fd);
    if (size > maximum || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      throw new Error("file overflow or changed during verification");
    }
    return buffer.subarray(0, size);
  } finally {
    import_node_fs3.default.closeSync(fd);
  }
}
function roots(value, label) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) throw new Error(`${label} requires 1..16 roots`);
  const result = value.map((entry) => canonicalDirectory(entry, label));
  if (new Set(result).size !== result.length) throw new Error(`${label} duplicates`);
  return result;
}
function validateTaskProfile(value, binding) {
  exactFields(value, [
    "schema_version",
    "provider",
    "model",
    "workspace_mode",
    "working_directory",
    "read_roots",
    "write_roots",
    "network",
    "timeout_ms",
    ...Object.hasOwn(value || {}, "access_mode") ? ["access_mode"] : [],
    ...value?.provider === "claude" || Object.hasOwn(value || {}, "account") ? ["account"] : [],
    ...Object.hasOwn(value || {}, "reasoning_effort") ? ["reasoning_effort"] : []
  ], "execution profile");
  if (value.schema_version !== 1 || !["codex", "claude"].includes(value.provider) || value.workspace_mode !== TASK_MODE) {
    throw new Error("unsupported task provider/profile version/workspace mode");
  }
  const model = getModelDef(loadProviderConfig(value.provider), value.model);
  if (model?.id !== value.model) throw new Error("task requires an exact configured model");
  if (Object.hasOwn(value, "reasoning_effort") && !model.reasoningEfforts?.includes(value.reasoning_effort)) {
    throw new Error("unsupported reasoning effort for task provider/model");
  }
  if (!["enabled", "disabled"].includes(value.network)) throw new Error("network must be enabled or disabled");
  if (Object.hasOwn(value, "access_mode") && !["restricted", "trusted"].includes(value.access_mode)) throw new Error("unsupported task access mode");
  const trusted = value.access_mode === "trusted";
  if (trusted && (!value.account || value.network !== "enabled")) throw new Error("trusted tasks require an explicit account and enabled network");
  if (!Number.isSafeInteger(value.timeout_ms) || value.timeout_ms < 1 || value.timeout_ms > 36e5) throw new Error("invalid task timeout");
  const project = canonicalDirectory(value.working_directory, "working_directory");
  const read2 = roots(value.read_roots, "read roots");
  const write = roots(value.write_roots, "write roots");
  const runtime = canonicalDirectory(binding.outputs.runtime, "runtime");
  const deliverables = roots(binding.outputs.deliverables, "deliverables");
  if (project !== binding.working_directory || !read2.includes(project)) throw new Error("shared working directory must match and be a read root");
  if (trusted ? deliverables.some((root) => !write.some((allowed) => inside(root, allowed))) : [...write].sort().join("\0") !== [...deliverables].sort().join("\0") || write.some((root) => inside(project, root) || inside(runtime, root) || inside(root, runtime))) {
    throw new Error("write roots must exactly match deliverables and exclude project/control roots");
  }
  const accountRoots = trusted ? [] : [...read2, ...write, runtime];
  const account = value.provider === "claude" ? validateClaudeAccount(value.account, accountRoots) : Object.hasOwn(value, "account") ? validateCodexAccount(value.account, accountRoots, trusted) : null;
  const profile = Object.freeze({ ...value, ...account ? { account } : {}, read_roots: Object.freeze(read2), write_roots: Object.freeze(write) });
  assertWritableTaskRoots(profile);
  validatedProfiles.add(profile);
  return profile;
}
function validateCodexAccount(value, workspaceRoots, trusted = false) {
  exactFields(value, ["id", "email", "config_directory"], "Codex account");
  if (typeof value.id !== "string" || !/^codex-[a-z0-9][a-z0-9-]{0,47}$/u.test(value.id)) throw new Error("invalid Codex account id");
  taskText(value.email, "Codex account email", 254);
  if (!/^[^\s@]+@[^\s@]+$/u.test(value.email)) throw new Error("invalid Codex account email");
  const directory = canonicalDirectory(value.config_directory, "Codex account directory");
  const stat = import_node_fs3.default.statSync(directory);
  if (stat.uid !== process.getuid() || (stat.mode & 63) !== 0) throw new Error("Codex account directory must be private and owned by this user");
  if (workspaceRoots.some((root) => inside(root, directory) || inside(directory, root))) throw new Error("Codex account directory overlaps task roots");
  for (const name of ["config.toml", "managed_config.toml", "requirements.toml"]) {
    if (!trusted && import_node_fs3.default.existsSync(import_node_path3.default.join(directory, name))) throw new Error("Codex account configuration requires separate qualification");
  }
  return Object.freeze({ ...value });
}
function assertTaskProfile(profile) {
  if (!validatedProfiles.has(profile)) throw new Error("registered shared workspace requires a validated task profile");
}
function assertWritableTaskRoots(profile) {
  if (profile.access_mode === "trusted") return;
  const pending = [...profile.write_roots];
  let visited = 0;
  while (pending.length) {
    if (++visited > 1e5) throw new Error("task writable tree exceeds preflight limit");
    const filename = pending.pop();
    const entry = import_node_fs3.default.lstatSync(filename);
    if (entry.isSymbolicLink() || !entry.isDirectory() && !entry.isFile()) {
      throw new Error("task writable tree contains a symlink or special file");
    }
    if (entry.isFile() && entry.nlink !== 1) throw new Error("task writable tree contains a hardlink");
    if (entry.isDirectory()) {
      for (const name of import_node_fs3.default.readdirSync(filename)) pending.push(import_node_path3.default.join(filename, name));
    }
  }
}
function parseTaskJson(source) {
  const value = JSON.parse(source, (_key, entry) => {
    if (typeof entry === "number" && !Number.isFinite(entry)) throw new Error("non-finite task JSON");
    return entry;
  });
  const stack = [];
  for (const [token] of source.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\],:]/gu)) {
    const frame = stack.at(-1);
    if (token === "{") stack.push({ keys: /* @__PURE__ */ new Set(), key: true });
    else if (token === "[") stack.push(null);
    else if (token === "}" || token === "]") stack.pop();
    else if (token === "," && frame) frame.key = true;
    else if (token.startsWith('"') && frame?.key) {
      const key = JSON.parse(token);
      if (frame.keys.has(key)) throw new Error("duplicate task JSON key");
      frame.keys.add(key);
      frame.key = false;
    }
  }
  return value;
}
function validateClaudeAccount(value, workspaceRoots) {
  exactFields(value, ["id", "email", "organization_id", "config_directory", "anthropic_directory"], "Claude account");
  if (typeof value.id !== "string" || !/^claude-[a-z0-9][a-z0-9-]{0,47}$/u.test(value.id)) throw new Error("invalid Claude account id");
  taskText(value.email, "Claude account email", 254);
  taskText(value.organization_id, "Claude organization id", 128);
  if (!/^[^\s@]+@[^\s@]+$/u.test(value.email)) throw new Error("invalid Claude account email");
  const directories = [value.config_directory, value.anthropic_directory];
  for (const directory of directories) {
    canonicalDirectory(directory, "Claude account directory");
    const stat = import_node_fs3.default.statSync(directory);
    if (stat.uid !== process.getuid() || (stat.mode & 63) !== 0) throw new Error("Claude account directory must be private and owned by this user");
    if (workspaceRoots.some((root) => inside(root, directory) || inside(directory, root))) throw new Error("Claude account directory overlaps task roots");
  }
  if (inside(directories[0], directories[1]) || inside(directories[1], directories[0])) throw new Error("Claude account directories overlap");
  return Object.freeze({ ...value });
}

// src/agent-host/task-capsule.js
function capsuleRecord(filename, value) {
  const fd = import_node_fs4.default.openSync(filename, "wx", 384);
  try {
    import_node_fs4.default.writeFileSync(fd, JSON.stringify(value) + "\n");
    import_node_fs4.default.fsyncSync(fd);
  } finally {
    import_node_fs4.default.closeSync(fd);
  }
}

// src/agent-host/task-run.js
var import_node_fs16 = __toESM(require("node:fs"), 1);
var import_node_path19 = __toESM(require("node:path"), 1);

// src/agent-host/task-codex-account.js
var import_node_child_process3 = require("node:child_process");
var PROBE_SUPERVISOR = `
const { spawn } = require('node:child_process');
const stop = () => process.kill(-process.pid, 'SIGKILL');
process.on('disconnect', stop);
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
setTimeout(stop, 10000);
const native = spawn(process.argv[1], process.argv.slice(2), { stdio: [0, 1, 2] });
const failed = () => {
  if (process.connected) process.send('native-exited', error => { if (error) stop(); });
  else stop();
};
native.on('error', failed);
native.on('exit', failed);
`;
async function inspectCodexTaskSeat(binaryPath, profile, environment, { spawnImpl = import_node_child_process3.spawn } = {}) {
  const expected = profile.account;
  if (!expected) throw new Error("Codex account selection required");
  const account = await readNativeAccount(binaryPath, expected.config_directory, environment, spawnImpl);
  if (account?.type !== "chatgpt" || account.email !== expected.email) {
    throw new Error("native Codex account does not match the pinned execution profile");
  }
  return Object.freeze({ ...expected, auth_method: "chatgpt" });
}
function readNativeAccount(binaryPath, directory, environment, spawnImpl) {
  return new Promise((resolve2, reject) => {
    const child = spawnImpl(
      process.execPath,
      [
        "-e",
        PROBE_SUPERVISOR,
        binaryPath,
        "--no-daemon",
        "-c",
        'cli_auth_credentials_store="file"',
        "-c",
        "mcp_servers={}",
        "-c",
        'model_provider="openai"',
        "app-server",
        "--stdio",
        "--strict-config"
      ],
      { cwd: directory, env: environment, stdio: ["pipe", "pipe", "pipe", "ipc"], detached: true }
    );
    let buffer = "", bytes = 0, state = "initialize", result, failure, stopping = false, settled = false, exited = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      if (child.connected) child.disconnect();
      child.unref?.();
      if (error) reject(error);
      else resolve2(result);
    };
    const stop = (error) => {
      if (stopping) return;
      stopping = true;
      failure = error;
      if (!exited) {
        try {
          if (child.pid) process.kill(-child.pid, "SIGKILL");
          else child.kill("SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
    };
    const fail = () => stop(new Error("native Codex account inspection failed"));
    const timer = setTimeout(() => {
      const error = new Error("native Codex account inspection timed out");
      stop(error);
      finish(error);
    }, 1e4);
    const send = (value) => child.stdin.write(`${JSON.stringify(value)}
`);
    child.on("error", () => {
      const error = new Error("native Codex account inspection unavailable");
      stop(error);
      finish(error);
    });
    child.stdin.on("error", fail);
    child.on("message", fail);
    child.stderr.on("data", (data) => {
      bytes += data.length;
      if (bytes > 262144) fail();
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (data) => {
      if (stopping) return;
      bytes += Buffer.byteLength(data);
      if (bytes > 262144) {
        fail();
        return;
      }
      buffer += data;
      while (buffer.includes("\n") && !stopping) {
        const end = buffer.indexOf("\n");
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        let message;
        try {
          message = parseTaskJson(line);
        } catch {
          fail();
          return;
        }
        if (!message || typeof message !== "object" || Array.isArray(message)) {
          fail();
          return;
        }
        if (message.id === void 0) continue;
        if (message.error || !message.result) {
          fail();
          return;
        }
        if (state === "initialize" && message.id === 1) {
          state = "account";
          send({ method: "initialized", params: {} });
          send({ id: 2, method: "account/read", params: { refreshToken: false } });
        } else if (state === "account" && message.id === 2) {
          result = message.result.account;
          stop(null);
        } else {
          fail();
          return;
        }
      }
    });
    const onExit = () => {
      exited = true;
      finish(failure || !stopping && new Error("native Codex account inspection ended early"));
    };
    child.on("exit", onExit);
    child.on("close", onExit);
    send({ id: 1, method: "initialize", params: { clientInfo: { name: "rudi_task_account_check", version: "1" }, capabilities: {} } });
  });
}

// src/agent-host/task-codex.js
var import_node_fs6 = __toESM(require("node:fs"), 1);
var import_node_os4 = __toESM(require("node:os"), 1);
var import_node_path6 = __toESM(require("node:path"), 1);
var import_node_child_process5 = require("node:child_process");

// src/agent-host/private-automation-profile.js
var import_node_path4 = __toESM(require("node:path"), 1);
var import_node_child_process4 = require("node:child_process");
var import_ajv = __toESM(require_ajv(), 1);
var PRIVATE_AUTOMATION_PROFILE_ID = "private-automation-v1";
var PRIVATE_AUTOMATION_MAX_FINAL_OUTPUT_BYTES = 64 * 1024;
var PRIVATE_AUTOMATION_MAX_RAW_OUTPUT_BYTES = 2 * 1024 * 1024;
var PRIVATE_AUTOMATION_MAX_SCHEMA_BYTES = 64 * 1024;
var PRIVATE_PROVIDERS = /* @__PURE__ */ new Set(["claude", "codex"]);
var PRIVATE_RAW_EVENT_TYPES = Object.freeze({
  claude: /* @__PURE__ */ new Set(["assistant", "error", "rate_limit_event", "result", "system", "user"]),
  codex: /* @__PURE__ */ new Set([
    "error",
    "item.completed",
    "item.started",
    "item.updated",
    "thread.started",
    "turn.completed",
    "turn.failed",
    "turn.started"
  ])
});
var PRIVATE_CODEX_ITEM_TYPES = /* @__PURE__ */ new Set(["agent_message", "reasoning"]);
var PRIVATE_CODEX_DISABLED_CAPABILITY_DIAGNOSTIC = "Code Mode is unavailable because code-mode host is disabled.";
var PRIVATE_CLAUDE_ASSISTANT_BLOCK_TYPES = /* @__PURE__ */ new Set(["text", "thinking"]);
var PRIVATE_CLAUDE_SYSTEM_SUBTYPES = /* @__PURE__ */ new Set(["init", "thinking_tokens"]);
var PRIVATE_CLAUDE_THINKING_TOKEN_KEYS = /* @__PURE__ */ new Set([
  "estimated_tokens",
  "estimated_tokens_delta",
  "session_id",
  "subtype",
  "type",
  "uuid"
]);
var PRIVATE_CLAUDE_SYNTHETIC_USER_KEYS = /* @__PURE__ */ new Set([
  "isSynthetic",
  "message",
  "parent_tool_use_id",
  "session_id",
  "timestamp",
  "type",
  "uuid"
]);
var PRIVATE_OUTPUT_SCHEMA_COMPILER = new import_ajv.default({ allErrors: true, strict: false });
var PRIVATE_CODEX_DISABLED_FEATURES = Object.freeze([
  "apps",
  "browser_use",
  "browser_use_external",
  "browser_use_full_cdp_access",
  "code_mode_host",
  "computer_use",
  "enable_mcp_apps",
  "image_generation",
  "in_app_browser",
  "multi_agent",
  "plugins",
  "remote_plugin",
  "shell_snapshot",
  "shell_tool",
  "skill_search",
  "tool_call_mcp_elicitation",
  "tool_suggest",
  "unified_exec",
  "view_image"
]);
function getPrivateCodexDisabledFeatures() {
  return [...PRIVATE_CODEX_DISABLED_FEATURES];
}
function requiredText(value, field, maxBytes = 4096) {
  if (typeof value !== "string" || value.trim() === "" || value.includes("\0")) {
    throw new Error(`${field} must be a non-empty string without NUL bytes`);
  }
  if (Buffer.byteLength(value, "utf8") > maxBytes) {
    throw new Error(`${field} exceeds ${maxBytes} bytes`);
  }
  return value;
}
function containsToolEvent(value) {
  if (Array.isArray(value)) return value.some(containsToolEvent);
  if (!value || typeof value !== "object") return false;
  if ([
    "command_execution",
    "file_change",
    "mcp_tool_call",
    "permission",
    "permission_request",
    "server_tool_use",
    "tool_result",
    "tool_use"
  ].includes(value.type)) return true;
  return Object.values(value).some(containsToolEvent);
}
function boundedUsage(usage2) {
  if (!usage2 || typeof usage2 !== "object" || Array.isArray(usage2)) return void 0;
  const projected = {};
  for (const [key, raw] of Object.entries(usage2)) {
    const value = Number(raw);
    if (Number.isSafeInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER) {
      projected[key] = value;
    }
  }
  return Object.keys(projected).length > 0 ? projected : void 0;
}
function projectPrivateAutomationEventMetadata(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new Error("private automation event must be an object");
  }
  if (containsToolEvent(event)) {
    throw new Error("private automation tool event is forbidden");
  }
  const metadata = { type: requiredText(event.type, "private automation event type", 128) };
  if (typeof event.model === "string" && event.model.length > 0) metadata.model = event.model;
  if (Array.isArray(event.content)) metadata.contentBlockCount = event.content.length;
  const usage2 = boundedUsage(event.usage);
  if (usage2) metadata.usage = usage2;
  if (typeof event.durationMs === "number" && Number.isFinite(event.durationMs) && event.durationMs >= 0) {
    metadata.durationMs = Math.floor(event.durationMs);
  }
  if (typeof event.numTurns === "number" && Number.isSafeInteger(event.numTurns) && event.numTurns >= 0) {
    metadata.numTurns = event.numTurns;
  }
  return Object.freeze(metadata);
}
function assertPrivateAutomationRawEvent(provider, event, expectedModel = null) {
  if (!PRIVATE_PROVIDERS.has(provider) || !event || typeof event !== "object" || Array.isArray(event)) {
    throw new Error("private automation provider event is invalid");
  }
  if (!PRIVATE_RAW_EVENT_TYPES[provider].has(event.type)) {
    throw new Error("private automation provider event type is not allowlisted");
  }
  if (provider === "codex" && event.type.startsWith("item.")) {
    const itemType = event.item?.type;
    const isBlockedCapabilityDiagnostic = event.type === "item.completed" && itemType === "error" && typeof event.item?.message === "string" && event.item.message.startsWith(PRIVATE_CODEX_DISABLED_CAPABILITY_DIAGNOSTIC);
    if (!PRIVATE_CODEX_ITEM_TYPES.has(itemType) && !isBlockedCapabilityDiagnostic) {
      throw new Error("private automation Codex item type is not allowlisted");
    }
  }
  if (provider === "claude" && event.type === "system") {
    if (!PRIVATE_CLAUDE_SYSTEM_SUBTYPES.has(event.subtype)) {
      throw new Error("private automation Claude system subtype is not allowlisted");
    }
    if (Array.isArray(event.tools) && event.tools.length > 0 || Array.isArray(event.mcp_servers) && event.mcp_servers.length > 0) {
      throw new Error("private automation Claude init capabilities are not empty");
    }
    if (event.subtype === "thinking_tokens" && (Object.keys(event).some((key) => !PRIVATE_CLAUDE_THINKING_TOKEN_KEYS.has(key)) || !Number.isFinite(event.estimated_tokens) || event.estimated_tokens < 0 || !Number.isFinite(event.estimated_tokens_delta) || event.estimated_tokens_delta < 0)) {
      throw new Error("private automation Claude thinking-token metadata is invalid");
    }
  }
  if (provider === "claude" && event.type === "assistant") {
    const message = event.message && typeof event.message === "object" ? event.message : null;
    const content = Array.isArray(event.content) ? event.content : Array.isArray(message?.content) ? message.content : [];
    if (content.some((block) => !block || typeof block !== "object" || !PRIVATE_CLAUDE_ASSISTANT_BLOCK_TYPES.has(block.type))) {
      throw new Error("private automation Claude content block is not allowlisted");
    }
  }
  if (provider === "claude" && event.type === "user") {
    const content = Array.isArray(event.message?.content) ? event.message.content : [];
    const textBytes = content.reduce((total, block) => total + (typeof block?.text === "string" ? Buffer.byteLength(block.text, "utf8") : 0), 0);
    if (event.isSynthetic !== true || event.parent_tool_use_id != null || Object.keys(event).some((key) => !PRIVATE_CLAUDE_SYNTHETIC_USER_KEYS.has(key)) || event.message?.role !== "user" || content.length < 1 || content.length > 4 || content.some((block) => block?.type !== "text" || typeof block.text !== "string") || textBytes > 4096) {
      throw new Error("private automation Claude synthetic user metadata is invalid");
    }
  }
  if (provider === "claude" && event.type === "result" && expectedModel != null) {
    const observedModels = event.modelUsage && typeof event.modelUsage === "object" && !Array.isArray(event.modelUsage) ? Object.keys(event.modelUsage) : [];
    if (observedModels.length !== 1 || observedModels[0] !== expectedModel) {
      throw new Error("private automation Claude model usage does not match the exact model");
    }
  }
  if (containsToolEvent(event)) {
    throw new Error("private automation tool event is forbidden");
  }
  return event;
}
function successfulProbe(result) {
  return result && !result.error && result.status === 0;
}
function probeOutput(result) {
  return `${String(result?.stdout || "")}
${String(result?.stderr || "")}`;
}
function semverAtLeast(actual, minimum) {
  const actualParts = actual.split(".").map(Number);
  const minimumParts = minimum.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (actualParts[index] > minimumParts[index]) return true;
    if (actualParts[index] < minimumParts[index]) return false;
  }
  return true;
}
function assertPrivateAutomationHostCapabilities({ binaryPath, profile }, dependencies = {}) {
  const spawnSyncImpl = dependencies.spawnSyncImpl || import_node_child_process4.spawnSync;
  if (!profile || profile.id !== PRIVATE_AUTOMATION_PROFILE_ID) {
    throw new Error("private automation profile is required for capability preflight");
  }
  if (profile.provider === "codex") {
    const versionProbe = spawnSyncImpl(binaryPath, ["--version"], {
      encoding: "utf8",
      timeout: 5e3
    });
    const versionMatch = probeOutput(versionProbe).match(/codex-cli\s+(\d+)\.(\d+)\.(\d+)/u);
    const minimumVersion = loadProviderConfig("codex").headless.privateAutomation.minimumVersion;
    const versionSupported = versionMatch && semverAtLeast(
      `${versionMatch[1]}.${versionMatch[2]}.${versionMatch[3]}`,
      minimumVersion
    );
    if (!successfulProbe(versionProbe) || !versionSupported) {
      throw new Error("Codex host version does not satisfy private automation config controls");
    }
    const disabledFeatures = getPrivateCodexDisabledFeatures();
    const configArgs = ["--ask-for-approval", "never"];
    for (const feature of disabledFeatures) configArgs.push("--disable", feature);
    configArgs.push(
      "-c",
      "mcp_servers={}",
      "-c",
      'web_search="disabled"',
      "exec",
      "-",
      "--json",
      "--skip-git-repo-check",
      "--color",
      "never",
      "-C",
      import_node_path4.default.dirname(profile.outputSchema.path),
      "-m",
      profile.model,
      "--output-schema",
      profile.outputSchema.path,
      "--ephemeral",
      "--strict-config",
      "--ignore-user-config",
      "--ignore-rules",
      "-s",
      "read-only"
    );
    const configProbe2 = spawnSyncImpl(binaryPath, configArgs, {
      encoding: "utf8",
      input: "",
      timeout: 5e3
    });
    if (configProbe2?.error || configProbe2?.status === 0 || !probeOutput(configProbe2).includes("No prompt provided via stdin.")) {
      throw new Error("Codex host does not satisfy private automation config controls");
    }
    const helpProbe = spawnSyncImpl(binaryPath, ["exec", "--help"], {
      encoding: "utf8",
      timeout: 5e3
    });
    const help = probeOutput(helpProbe);
    const requiredHelp = [
      "--ephemeral",
      "--ignore-rules",
      "--ignore-user-config",
      "--output-schema",
      "--sandbox"
    ];
    if (!successfulProbe(helpProbe) || requiredHelp.some((flag) => !help.includes(flag))) {
      throw new Error("Codex host does not satisfy private automation config and CLI capabilities");
    }
    const featureProbe = spawnSyncImpl(binaryPath, ["features", "list"], {
      encoding: "utf8",
      timeout: 5e3
    });
    const features = probeOutput(featureProbe);
    const missingFeature = PRIVATE_CODEX_DISABLED_FEATURES.some((feature) => {
      const line = features.split("\n").find((candidate) => candidate.trim().startsWith(`${feature} `));
      return !line || /\bremoved\b/u.test(line);
    });
    if (!successfulProbe(featureProbe) || missingFeature) {
      throw new Error("Codex host does not satisfy private automation feature controls");
    }
    return true;
  }
  const configProbe = spawnSyncImpl(binaryPath, [
    "--output-format",
    "stream-json",
    "--verbose",
    "--print",
    "--input-format",
    "text",
    "--model",
    profile.model,
    "--no-session-persistence",
    "--safe-mode",
    "--no-chrome",
    "--disable-slash-commands",
    "--tools",
    "",
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
    "--setting-sources",
    "",
    "--permission-mode",
    "plan"
  ], {
    encoding: "utf8",
    input: "",
    timeout: 5e3
  });
  if (configProbe?.error || configProbe?.status === 0 || !probeOutput(configProbe).includes("Input must be provided either through stdin")) {
    throw new Error("Claude host does not satisfy private automation CLI capabilities");
  }
  return true;
}

// src/agent-host/task-integrations.js
var import_node_fs5 = __toESM(require("node:fs"), 1);
var import_node_os3 = __toESM(require("node:os"), 1);
var import_node_path5 = __toESM(require("node:path"), 1);
function taskRouter() {
  const command = import_node_path5.default.join(import_node_os3.default.homedir(), ".rudi", "bins", "rudi-router");
  try {
    if (!import_node_fs5.default.statSync(command).isFile()) throw new Error();
    import_node_fs5.default.accessSync(command, import_node_fs5.default.constants.X_OK);
  } catch {
    throw new Error("trusted task requires an installed executable RUDI router");
  }
  return command;
}
function trustedTaskPath(binaryPath) {
  return [
    import_node_path5.default.dirname(binaryPath),
    import_node_path5.default.dirname(taskRouter()),
    import_node_path5.default.join(import_node_os3.default.homedir(), ".local/bin"),
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
    "/usr/local/bin",
    "/opt/homebrew/bin"
  ].join(":");
}

// src/agent-host/task-codex.js
var TASK_CODEX_VERSION = "0.160.1";
var TASK_DISABLED = getPrivateCodexDisabledFeatures().filter((feature) => !["shell_tool", "unified_exec", "code_mode_host"].includes(feature));
function taskEnvironment(binaryPath, profile = null) {
  const result = { PATH: `${import_node_path6.default.dirname(binaryPath)}:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin` };
  if (profile?.access_mode === "trusted") result.PATH = trustedTaskPath(binaryPath);
  for (const key of ["HOME", "USER", "LOGNAME", "LANG", "LC_ALL"]) {
    if (typeof process.env[key] === "string") result[key] = process.env[key];
  }
  if (profile?.account) result.CODEX_HOME = profile.account.config_directory;
  return result;
}
function taskPermissionArgs(profile) {
  const filesystem = { ":minimal": "read" };
  for (const root of profile.read_roots) {
    filesystem[root] = profile.access_mode === "trusted" && profile.write_roots.some((allowed) => inside(root, allowed)) ? "write" : "read";
  }
  for (const root of profile.write_roots) filesystem[root] = "write";
  if (profile.access_mode === "trusted") {
    for (const root of /* @__PURE__ */ new Set([profile.working_directory, ...profile.write_roots])) {
      for (const name of [".git", ".codex", ".agents", "AGENTS.md"]) {
        const candidate = import_node_path6.default.join(root, name);
        const target = import_node_fs6.default.existsSync(candidate) ? import_node_fs6.default.realpathSync(candidate) : candidate;
        if (profile.write_roots.some((allowed) => inside(target, allowed))) filesystem[target] = "write";
      }
    }
  }
  const rules = Object.entries(filesystem).map(([key, value]) => `${JSON.stringify(key)}=${JSON.stringify(value)}`).join(",");
  return ["-c", 'default_permissions="rudi_task"', "-c", `permissions={rudi_task={filesystem={${rules}},network={enabled=${profile.network === "enabled"}}}}`];
}
function taskCodexArgs(context) {
  const args = ["--ask-for-approval", "never", "--no-daemon", "--enable", "code_mode_host"];
  if (context.taskProfile.account) args.push("-c", 'cli_auth_credentials_store="file"');
  if (context.taskProfile.reasoning_effort !== void 0) {
    args.push("-c", `model_reasoning_effort=${JSON.stringify(context.taskProfile.reasoning_effort)}`);
  }
  const trusted = context.taskProfile.access_mode === "trusted";
  if (trusted) {
    if (import_node_fs6.default.existsSync(import_node_path6.default.join(context.taskProfile.account.config_directory, "rudi-trusted.config.toml"))) {
      args.push("--profile", "rudi-trusted");
    }
    args.push(
      "-c",
      `mcp_servers.rudi.command=${JSON.stringify(taskRouter())}`,
      "-c",
      "mcp_servers.rudi.enabled=true",
      "-c",
      'model_provider="openai"',
      "-c",
      'web_search="live"'
    );
  } else {
    for (const feature of TASK_DISABLED) args.push("--disable", feature);
    args.push("-c", "mcp_servers={}", "-c", 'web_search="disabled"');
  }
  args.push(
    ...taskPermissionArgs(context.taskProfile),
    "-c",
    `shell_environment_policy.inherit=${trusted ? '"all"' : '"none"'}`,
    "exec",
    "-",
    "--json",
    "--skip-git-repo-check",
    "--color",
    "never",
    "--strict-config",
    ...!trusted ? ["--ignore-user-config", "--ignore-rules"] : [],
    "-C",
    context.cwd,
    "-m",
    context.model
  );
  return args;
}
async function assertTaskHostCapabilities({ binaryPath, profile }, { spawnSyncImpl = import_node_child_process5.spawnSync, spawnImpl } = {}) {
  if (process.platform !== "darwin") throw new Error("task shared permissions currently qualified on macOS only");
  for (let cursor = profile.working_directory; ; cursor = import_node_path6.default.dirname(cursor)) {
    if (profile.access_mode !== "trusted" && cursor !== import_node_os4.default.homedir() && import_node_fs6.default.existsSync(import_node_path6.default.join(cursor, ".codex", "config.toml"))) {
      throw new Error("task workspace ancestor contains native config; explicit qualification required");
    }
    if (cursor === import_node_path6.default.dirname(cursor)) break;
  }
  if (profile.access_mode !== "trusted" && import_node_fs6.default.existsSync("/etc/codex/config.toml")) throw new Error("system Codex config requires explicit task qualification");
  const environment = taskEnvironment(binaryPath, profile);
  const account = profile.account ? await inspectCodexTaskSeat(binaryPath, profile, environment, { spawnImpl }) : null;
  const probe = (args2, input) => spawnSyncImpl(binaryPath, args2, { encoding: "utf8", input, timeout: 5e3, maxBuffer: 262144, env: environment });
  const version = probe(["--version"]);
  if (version.status !== 0 || String(version.stdout).trim() !== `codex-cli ${TASK_CODEX_VERSION}`) {
    throw new Error("native Codex version is not qualified for task permissions");
  }
  const args = taskCodexArgs({ taskProfile: profile, cwd: profile.working_directory, model: profile.model });
  const config = probe(args, "");
  if (config.error || config.status === 0 || !`${config.stdout}${config.stderr}`.includes("No prompt provided via stdin.")) {
    throw new Error("native task configuration probe failed");
  }
  const helper = auditHelperPath();
  const containment = probe([
    "sandbox",
    "-P",
    "rudi_task",
    ...taskPermissionArgs({ ...profile, read_roots: [...profile.read_roots, helper] }),
    "-C",
    profile.working_directory,
    "--",
    helper,
    "probe",
    String(process.pid)
  ]);
  if (containment.status !== 0 || String(containment.stdout).trim() !== JSON.stringify({ audit_session_escape_denied: true, supervisor_signal_denied: true })) {
    throw new Error("native audit containment capability probe failed");
  }
  return { version: TASK_CODEX_VERSION, ...account ? { account } : {} };
}

// src/agent-host/launch.js
var import_node_crypto5 = __toESM(require("node:crypto"), 1);

// src/agent-host/artifacts.js
var import_node_fs7 = __toESM(require("node:fs"), 1);
var import_node_path7 = __toESM(require("node:path"), 1);
init_src();
var LAUNCH_ID_PATTERN = /^launch_[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
var OWNERSHIP_MARKER = ".rudi-agent-launch.json";
var EVENTS_FILE = "events.jsonl";
var STDERR_FILE = "stderr.log";
var MAX_EVENT_BYTES = 1024 * 1024;
var MAX_EVENT_PAGE_BYTES = 10 * 1024 * 1024;
function assertLaunchId(launchId) {
  if (typeof launchId !== "string" || !LAUNCH_ID_PATTERN.test(launchId)) {
    throw new Error("Invalid launch ID");
  }
  return launchId;
}
function getAgentHostPaths({
  launchId = null,
  rudiHome = PATHS.home
} = {}) {
  const home = import_node_path7.default.resolve(rudiHome);
  const stateDirectory = import_node_path7.default.join(home, "state");
  const artifactsRoot = import_node_path7.default.join(home, "artifacts", "agent-launches");
  const result = {
    artifactsRoot,
    stateDatabase: import_node_path7.default.join(stateDirectory, "agent-hosts.db"),
    stateDirectory
  };
  if (launchId != null) {
    assertLaunchId(launchId);
    result.launchDirectory = import_node_path7.default.join(artifactsRoot, launchId);
    result.workspaceDirectory = import_node_path7.default.join(result.launchDirectory, "workspace");
  }
  return result;
}
function getLaunchArtifactFiles(launchDirectory) {
  const directory = import_node_path7.default.resolve(launchDirectory);
  return Object.freeze({
    events: import_node_path7.default.join(directory, EVENTS_FILE),
    marker: import_node_path7.default.join(directory, OWNERSHIP_MARKER),
    stderr: import_node_path7.default.join(directory, STDERR_FILE)
  });
}
function createLaunchOwnershipMarker({ launchDirectory, launchId }) {
  assertLaunchId(launchId);
  const directory = import_node_path7.default.resolve(launchDirectory);
  const stat = import_node_fs7.default.statSync(directory);
  if (!stat.isDirectory()) throw new Error(`Launch artifact path is not a directory: ${directory}`);
  const { marker } = getLaunchArtifactFiles(directory);
  const payload = `${JSON.stringify({ launchId, schemaVersion: 1 })}
`;
  const handle = import_node_fs7.default.openSync(marker, "wx", 384);
  try {
    import_node_fs7.default.writeFileSync(handle, payload, "utf8");
  } finally {
    import_node_fs7.default.closeSync(handle);
  }
  return marker;
}
function appendLaunchEvent(eventFile, event) {
  const serialized = `${JSON.stringify(event)}
`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_EVENT_BYTES) {
    throw new Error(`Agent event exceeds ${MAX_EVENT_BYTES} bytes`);
  }
  const file = import_node_path7.default.resolve(eventFile);
  const handle = import_node_fs7.default.openSync(file, "a", 384);
  try {
    import_node_fs7.default.writeFileSync(handle, serialized, "utf8");
  } finally {
    import_node_fs7.default.closeSync(handle);
  }
  import_node_fs7.default.chmodSync(file, 384);
}

// src/agent-host/events/stream.js
var import_node_child_process7 = require("node:child_process");

// src/agent-host/events/providers/claude-task.js
function consumeClaudeTaskEvent(state, event) {
  if (state.terminal) throw new Error("Claude output after terminal result");
  if (event.session_id !== void 0) {
    if (typeof event.session_id !== "string" || !/^[A-Za-z0-9_-]{1,256}$/u.test(event.session_id) || state.observedSessionId && event.session_id !== state.observedSessionId) throw new Error("Claude session mismatch");
    state.observedSessionId = event.session_id;
  }
  if (event.type === "system" && event.subtype === "init") {
    if (state.sessionId || typeof event.session_id !== "string" || !/^[A-Za-z0-9_-]{1,256}$/u.test(event.session_id)) throw new Error("invalid Claude session initialization");
    state.sessionId = event.session_id;
  }
  if (!state.sessionId && event.type !== "system") throw new Error("Claude event before initialization");
  if (event.type === "error" || event.error) throw new Error("Claude native failure");
  if (event.type !== "result") return;
  if (!state.sessionId || event.session_id !== state.sessionId || event.subtype !== "success" || event.is_error !== false || !Array.isArray(event.permission_denials) || event.permission_denials.length !== 0 || typeof event.result !== "string" || Buffer.byteLength(event.result) > 65536) throw new Error("invalid Claude terminal result");
  state.terminal = true;
  state.finalOutput = event.result;
}

// src/agent-host/task-custody.js
var import_node_fs8 = __toESM(require("node:fs"), 1);
var import_node_path8 = __toESM(require("node:path"), 1);
var import_node_crypto2 = __toESM(require("node:crypto"), 1);
var import_node_url2 = require("node:url");
var import_node_child_process6 = require("node:child_process");
var import_meta2 = {};
var delay = (ms) => new Promise((resolve2) => setTimeout(resolve2, ms));
function processIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid < 2) throw new Error("invalid custody PID");
  try {
    const value = (0, import_node_child_process6.execFileSync)(
      "/bin/ps",
      ["-p", String(pid), "-o", "pid=,pgid=,uid=,lstart="],
      { encoding: "utf8", timeout: 2e3, maxBuffer: 4096, env: { PATH: "/usr/bin:/bin", LC_ALL: "C" }, stdio: ["ignore", "pipe", "pipe"] }
    ).trim();
    const match = value.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/u);
    if (!match) throw new Error("invalid process identity");
    const boot = process.platform === "linux" ? import_node_fs8.default.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim() : (0, import_node_child_process6.execFileSync)(
      "/usr/sbin/sysctl",
      ["-n", "kern.bootsessionuuid"],
      { encoding: "utf8", timeout: 2e3, maxBuffer: 4096, stdio: ["ignore", "pipe", "pipe"] }
    ).trim();
    return { pid: Number(match[1]), pgid: Number(match[2]), uid: Number(match[3]), started: match[4], boot };
  } catch (error) {
    if (error.status === 1 && !String(error.stdout || "").trim()) return null;
    throw new Error("cannot establish process identity");
  }
}
function sameProcess(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
function record(directory, name, value) {
  const fd = import_node_fs8.default.openSync(import_node_path8.default.join(directory, name), "wx", 384);
  try {
    import_node_fs8.default.writeFileSync(fd, `${JSON.stringify(value)}
`);
    import_node_fs8.default.fsyncSync(fd);
  } finally {
    import_node_fs8.default.closeSync(fd);
  }
}
function read(directory, name) {
  return parseTaskJson(readTaskRegularFile(import_node_path8.default.join(directory, name), 16384, true).toString("utf8"));
}
function quarantineTaskCustody(directory, reason) {
  try {
    record(directory, "quarantine.json", { reason, at: (/* @__PURE__ */ new Date()).toISOString() });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    read(directory, "quarantine.json");
  }
}
function validateIdentity(value) {
  if (!value || !Number.isSafeInteger(value.pid) || value.pid < 2 || !Number.isSafeInteger(value.pgid) || value.uid !== process.getuid() || typeof value.started !== "string" || typeof value.boot !== "string" || Object.keys(value).sort().join(",") !== "boot,pgid,pid,started,uid") throw new Error("invalid custody identity");
  return value;
}
function groupAlive(pgid) {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}
async function stopOwnedNative(directory) {
  if (import_node_fs8.default.existsSync(import_node_path8.default.join(directory, "session.json"))) {
    const scope = read(directory, "session.json");
    if (read(directory, "owner.json").process.boot !== processIdentity(process.pid).boot) return;
    const guardian = import_node_fs8.default.existsSync(import_node_path8.default.join(directory, "guardian-audit.json")) ? read(directory, "guardian-audit.json") : null;
    await drainAuditScope(scope, guardian);
    return;
  }
  const native = validateIdentity(read(directory, "native.json"));
  if (native.pid !== native.pgid) throw new Error("native custody requires its own process group");
  const currentBoot = processIdentity(process.pid).boot;
  if (native.boot !== currentBoot) return;
  for (const [signal, budget] of [["SIGTERM", 5e3], ["SIGKILL", 2e3]]) {
    if (!groupAlive(native.pgid)) return;
    if (!sameProcess(processIdentity(native.pid), native)) throw new Error("native group ownership ambiguous; custody blocked");
    process.kill(-native.pgid, signal);
    const end = Date.now() + budget;
    while (Date.now() < end) {
      if (!groupAlive(native.pgid)) return;
      await delay(50);
    }
  }
  throw new Error("native process group did not exit; custody blocked");
}
async function recoverTaskCustody(runtime) {
  canonicalDirectory(runtime, "task runtime");
  const directory = import_node_path8.default.join(runtime, "custody.lock");
  if (!import_node_fs8.default.existsSync(directory)) return { status: "clear" };
  canonicalDirectory(directory, "custody directory");
  const gate = import_node_path8.default.join(runtime, "custody-recovery.lock");
  import_node_fs8.default.mkdirSync(gate, { mode: 448 });
  try {
    const owner = read(directory, "owner.json");
    validateIdentity(owner.process);
    if (sameProcess(processIdentity(owner.process.pid), owner.process)) throw new Error("active task custody");
    quarantineTaskCustody(directory, "owner lost; task outcome requires reconciliation");
    if (import_node_fs8.default.existsSync(import_node_path8.default.join(directory, "guardian.json"))) {
      const guardian = validateIdentity(read(directory, "guardian.json"));
      const end = Date.now() + 8e3;
      while (sameProcess(processIdentity(guardian.pid), guardian) && Date.now() < end) await delay(100);
      if (sameProcess(processIdentity(guardian.pid), guardian)) throw new Error("active guardian custody");
    }
    const cleaned = import_node_fs8.default.existsSync(import_node_path8.default.join(directory, "orphan-cleanup.json")) && read(directory, "orphan-cleanup.json").audit_session_drained === true;
    if (!cleaned) await stopOwnedNative(directory);
    record(directory, `recovery-${import_node_crypto2.default.randomUUID()}.json`, { native_group_gone: true, at: (/* @__PURE__ */ new Date()).toISOString() });
    return { status: "quarantined", evidence: directory };
  } finally {
    import_node_fs8.default.rmdirSync(gate);
  }
}
async function openTaskCustody({ runtime, runDirectory, jobId, workerPath, capsule }) {
  canonicalDirectory(runtime, "task runtime");
  canonicalDirectory(runDirectory, "task attempt");
  if (!/^job_[A-Za-z0-9_-]{4,123}$/u.test(jobId)) throw new Error("invalid custody job");
  const recovered = await recoverTaskCustody(runtime);
  if (recovered.status !== "clear") throw new Error("task custody quarantined; containment reconciliation required");
  const scope = createAuditScope(capsule);
  const directory = import_node_path8.default.join(runtime, "custody.lock");
  import_node_fs8.default.mkdirSync(directory, { mode: 448 });
  record(directory, "owner.json", { process: processIdentity(process.pid), job_id: jobId, attempt: runDirectory });
  record(directory, "session.json", scope);
  let guardian = null;
  let guardianExit = null;
  let closed = false;
  let closing = false;
  let guardianLost = false;
  let stopPromise = null;
  const stop = () => {
    if (!stopPromise) stopPromise = stopOwnedNative(directory).finally(() => {
      stopPromise = null;
    });
    return stopPromise;
  };
  const entry = process.argv[1] || "";
  const worker = workerPath || (entry.endsWith(".cjs") ? import_node_path8.default.join(import_node_path8.default.dirname(entry), "task-custody-worker.cjs") : (0, import_node_url2.fileURLToPath)(new URL("./task-custody-worker.js", import_meta2.url)));
  guardian = (0, import_node_child_process6.spawn)(process.execPath, [worker, directory], { detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"], env: { PATH: "/usr/bin:/bin" } });
  guardianExit = new Promise((resolve2) => guardian.once("exit", (code) => {
    if (!closing || code !== 0) {
      guardianLost = true;
      void stop().catch(() => {
      });
    }
    resolve2(code);
  }));
  await new Promise((resolve2, reject) => {
    const timer = setTimeout(() => reject(new Error("custody watchdog startup timed out")), 5e3);
    guardian.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    guardian.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("custody watchdog exited"));
    });
    guardian.once("message", (message) => {
      clearTimeout(timer);
      if (message === "ready") resolve2();
      else reject(new Error("invalid watchdog response"));
    });
  });
  return {
    async track(pid) {
      const expectedGuardian = read(directory, "guardian-audit.json");
      if (guardianLost || !guardian.connected || JSON.stringify(auditIdentity(guardian.pid)) !== JSON.stringify(expectedGuardian)) {
        await stop();
        throw new Error("watchdog custody lost before native prompt");
      }
      const native = processIdentity(pid);
      if (!native || native.pid !== native.pgid) throw new Error("native process lacks isolated group");
      const audit = validateAuditIdentity(auditIdentity(pid));
      if (audit.asid !== scope.owner.asid) throw new Error("native escaped audit session");
      record(directory, "native.json", native);
      record(directory, "native-audit.json", audit);
    },
    stop,
    async close() {
      if (closed) return;
      closing = true;
      await stop();
      if (guardian?.connected) guardian.send(import_node_fs8.default.existsSync(import_node_path8.default.join(directory, "quarantine.json")) ? "abort" : "done");
      if (guardianExit) {
        let timer;
        try {
          await Promise.race([guardianExit, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error("watchdog shutdown unconfirmed")), 9e3);
          })]);
        } finally {
          clearTimeout(timer);
        }
      }
      if (guardianLost) throw new Error("watchdog custody lost");
      if (import_node_fs8.default.existsSync(import_node_path8.default.join(directory, "quarantine.json"))) throw new Error("task custody quarantined");
      if (guardian && read(directory, "orphan-cleanup.json").mode !== "normal") throw new Error("watchdog normal completion unconfirmed");
      record(directory, "closed.json", { at: (/* @__PURE__ */ new Date()).toISOString(), native_group_gone: true, audit_session_drained: true });
      import_node_fs8.default.renameSync(directory, import_node_path8.default.join(runDirectory, "custody"));
      closed = true;
    }
  };
}

// src/agent-host/events/providers/claude.js
var claude_exports = {};
__export(claude_exports, {
  normalize: () => normalize
});
function toNumber(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function toString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}
function toUsage(rawUsage) {
  if (!rawUsage || typeof rawUsage !== "object") return void 0;
  const inputTokens = rawUsage.inputTokens ?? rawUsage.input_tokens;
  const outputTokens = rawUsage.outputTokens ?? rawUsage.output_tokens;
  if (typeof inputTokens !== "number" || typeof outputTokens !== "number") return void 0;
  const usage2 = {
    inputTokens: toNumber(inputTokens),
    outputTokens: toNumber(outputTokens)
  };
  const cacheReadTokens = rawUsage.cacheReadTokens ?? rawUsage.cache_read_input_tokens ?? rawUsage.cached_input_tokens;
  if (typeof cacheReadTokens === "number") {
    usage2.cacheReadTokens = toNumber(cacheReadTokens);
  }
  const cacheCreationTokens = rawUsage.cacheCreationTokens ?? rawUsage.cache_creation_input_tokens;
  if (typeof cacheCreationTokens === "number") {
    usage2.cacheCreationTokens = toNumber(cacheCreationTokens);
  }
  return usage2;
}
function normalizeContentBlock(block) {
  if (!block || typeof block !== "object") return null;
  if (block.type === "text") {
    return { type: "text", text: toString(block.text) };
  }
  if (block.type === "thinking") {
    return { type: "thinking", thinking: toString(block.thinking) };
  }
  if (block.type === "tool_use") {
    return {
      type: "tool_use",
      id: toString(block.id),
      name: toString(block.name, "unknown"),
      input: block.input && typeof block.input === "object" ? block.input : {}
    };
  }
  if (block.type === "tool_result") {
    const normalized = {
      type: "tool_result",
      toolUseId: toString(block.toolUseId ?? block.tool_use_id),
      content: block.content ?? ""
    };
    const isError = block.isError ?? block.is_error;
    if (typeof isError === "boolean") normalized.isError = isError;
    return normalized;
  }
  return null;
}
function normalizeAssistantEvent(event) {
  const message = event.message && typeof event.message === "object" ? event.message : null;
  const rawContent = Array.isArray(event.content) ? event.content : Array.isArray(message?.content) ? message.content : [];
  const content = rawContent.map(normalizeContentBlock).filter(Boolean);
  const usage2 = toUsage(event.usage || message?.usage);
  const model = toString(event.model || message?.model, "");
  const finishReason = toString(event.finishReason || event.stopReason || message?.stop_reason, "");
  const normalized = {
    type: "assistant",
    content
  };
  if (usage2) normalized.usage = usage2;
  if (model) normalized.model = model;
  if (finishReason) normalized.finishReason = finishReason;
  if (event.error) normalized.error = event.error;
  return normalized;
}
function normalizeResultEvent(event) {
  const message = event.message && typeof event.message === "object" ? event.message : null;
  const usage2 = toUsage(event.usage || message?.usage);
  const model = toString(event.model || message?.model, "");
  const finishReason = toString(event.finishReason || event.stopReason || message?.stop_reason, "");
  const normalized = {
    type: "result"
  };
  const providerSessionId = event.providerSessionId ?? event.session_id;
  if (typeof providerSessionId === "string" && providerSessionId) {
    normalized.providerSessionId = providerSessionId;
  }
  const costUsd = event.costUsd ?? event.total_cost_usd;
  if (typeof costUsd === "number") normalized.costUsd = costUsd;
  const durationMs = event.durationMs ?? event.duration_ms;
  if (typeof durationMs === "number") normalized.durationMs = durationMs;
  const numTurns = event.numTurns ?? event.num_turns;
  if (typeof numTurns === "number") normalized.numTurns = numTurns;
  const result = event.result;
  if (typeof result === "string") normalized.result = result;
  if (usage2) normalized.usage = usage2;
  if (model) normalized.model = model;
  if (finishReason) normalized.finishReason = finishReason;
  if (event.is_error === true) normalized.isError = true;
  return normalized;
}
function normalizeSystemEvent(event) {
  const subtype = toString(event.subtype, "unknown");
  const normalized = {
    type: "system",
    subtype,
    message: toString(event.message, "System event")
  };
  const rawCompaction = event.compaction || event.microcompactMetadata || event.compactMetadata;
  if (rawCompaction && typeof rawCompaction === "object") {
    const compaction = {
      trigger: toString(rawCompaction.trigger, "unknown"),
      preTokens: toNumber(rawCompaction.preTokens ?? rawCompaction.pre_tokens),
      tokensSaved: toNumber(rawCompaction.tokensSaved ?? rawCompaction.tokens_saved)
    };
    const compactedToolIds = rawCompaction.compactedToolIds ?? rawCompaction.compacted_tool_ids;
    if (Array.isArray(compactedToolIds)) {
      compaction.compactedToolIds = compactedToolIds.filter((id) => typeof id === "string");
    }
    normalized.compaction = compaction;
  }
  const isPermissionEvent = subtype === "permission_request";
  const rawPermission = event.permission && typeof event.permission === "object" ? event.permission : event;
  const requestId = rawPermission.requestId ?? rawPermission.request_id;
  if (isPermissionEvent && typeof requestId === "string" && requestId) {
    const permission = { requestId };
    const batchId = rawPermission.batchId ?? rawPermission.batch_id;
    const toolName = rawPermission.toolName ?? rawPermission.tool_name;
    const toolInput = rawPermission.toolInput ?? rawPermission.tool_input;
    if (typeof batchId === "string") permission.batchId = batchId;
    if (typeof toolName === "string") permission.toolName = toolName;
    if (toolInput && typeof toolInput === "object") {
      permission.toolInput = toolInput;
    }
    normalized.permission = permission;
  }
  return normalized;
}
function normalizeRateLimitEvent(event) {
  const raw = event.rate_limit_info && typeof event.rate_limit_info === "object" ? event.rate_limit_info : {};
  const status = toString(raw.status, "unknown");
  const rateLimit = { status };
  if (Number.isFinite(raw.resetsAt)) rateLimit.resetsAt = raw.resetsAt;
  if (typeof raw.rateLimitType === "string") rateLimit.rateLimitType = raw.rateLimitType;
  if (typeof raw.overageStatus === "string") rateLimit.overageStatus = raw.overageStatus;
  if (Number.isFinite(raw.overageResetsAt)) rateLimit.overageResetsAt = raw.overageResetsAt;
  if (typeof raw.isUsingOverage === "boolean") rateLimit.isUsingOverage = raw.isUsingOverage;
  return {
    type: "system",
    subtype: "rate_limit",
    message: `Claude rate limit status: ${status}`,
    rateLimit
  };
}
function normalizeErrorEvent(event) {
  const rawError = event.error && typeof event.error === "object" ? event.error : null;
  const message = toString(
    event.message || rawError?.message,
    "Unknown error"
  );
  const normalized = {
    type: "error",
    message
  };
  const code = event.code || rawError?.code;
  if (typeof code === "string" && code) normalized.code = code;
  const details = event.details ?? rawError?.details ?? rawError;
  if (details !== void 0) normalized.details = details;
  return normalized;
}
function normalize(event) {
  if (!event || typeof event !== "object") {
    return { type: "error", message: "Invalid event payload" };
  }
  if (event.type === "assistant") return normalizeAssistantEvent(event);
  if (event.type === "result") return normalizeResultEvent(event);
  if (event.type === "system") return normalizeSystemEvent(event);
  if (event.type === "rate_limit_event") return normalizeRateLimitEvent(event);
  if (event.type === "error") return normalizeErrorEvent(event);
  return {
    type: "system",
    subtype: "unknown",
    message: `Unrecognized Claude event: ${toString(event.type, "unknown")}`
  };
}

// src/agent-host/events/providers/codex.js
var UNKNOWN_EVENT_RAW_PAYLOAD_MAX_CHARS = 16e3;
var CodexNormalizer = class {
  constructor() {
    this.pendingItems = /* @__PURE__ */ new Map();
    this.sessionId = null;
  }
  /**
   * Normalize a raw Codex event into 0+ RudiEvent objects.
   * @param {object} rawEvent
   * @returns {Array<{ normalized: object, raw: object }>}
   */
  normalize(rawEvent) {
    if (!rawEvent || typeof rawEvent !== "object") return [];
    const type = rawEvent.type;
    if (type === "thread.started") {
      this.sessionId = rawEvent.thread_id || null;
      return [this._wrap({
        type: "system",
        subtype: "thread_started",
        message: "Thread started"
      }, rawEvent)];
    }
    if (type === "turn.started") {
      return [this._wrap({
        type: "system",
        subtype: "turn_started",
        message: `Turn ${rawEvent.turn_number || 1} started`
      }, rawEvent)];
    }
    if (type === "item.started") return this._handleItemStarted(rawEvent);
    if (type === "item.updated") return this._handleItemUpdated(rawEvent);
    if (type === "item.completed") return this._handleItemCompleted(rawEvent);
    if (type === "turn.completed") return this._handleTurnCompleted(rawEvent);
    if (type === "turn.failed") {
      const normalized = {
        type: "result",
        result: rawEvent.error?.message || "Turn failed",
        usage: this._normalizeUsage({})
      };
      const sid = this._sid(rawEvent);
      if (sid) normalized.providerSessionId = sid;
      if (typeof rawEvent.model === "string" && rawEvent.model) normalized.model = rawEvent.model;
      return [this._wrap(normalized, rawEvent)];
    }
    if (type === "error") {
      const normalized = {
        type: "error",
        message: rawEvent.error?.message || rawEvent.message || "Unknown error"
      };
      const code = rawEvent.error?.code || rawEvent.code;
      if (typeof code === "string" && code) normalized.code = code;
      const details = rawEvent.error || rawEvent.details;
      if (details !== void 0) normalized.details = details;
      return [this._wrap(normalized, rawEvent)];
    }
    return [this._wrap(this._normalizeUnknownEvent(rawEvent), rawEvent)];
  }
  /**
   * Flush any remaining buffered items.
   * @returns {Array<{ normalized: object, raw: object }>}
   */
  flush() {
    const results = [];
    for (const [itemId, pending] of this.pendingItems) {
      const flushed = this._flushItem(itemId, pending, pending.startEvent);
      if (flushed) results.push(flushed);
    }
    this.pendingItems.clear();
    return results;
  }
  /**
   * Reset state between turns.
   */
  reset() {
    this.pendingItems.clear();
  }
  // ---- Private helpers ----
  _wrap(normalized, raw) {
    return { normalized, raw };
  }
  _sid(event) {
    return this.sessionId || event.thread_id || null;
  }
  _toString(value, fallback = "") {
    return typeof value === "string" ? value : fallback;
  }
  _toText(value) {
    if (typeof value === "string") return value;
    if (value == null) return "";
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  _serializeUnknownPayload(rawEvent) {
    try {
      const rawPayload = JSON.stringify(rawEvent);
      if (typeof rawPayload !== "string") {
        return { rawPayloadUnavailable: true };
      }
      if (rawPayload.length > UNKNOWN_EVENT_RAW_PAYLOAD_MAX_CHARS) {
        return {
          rawPayload: rawPayload.slice(0, UNKNOWN_EVENT_RAW_PAYLOAD_MAX_CHARS),
          rawPayloadTruncated: true
        };
      }
      return { rawPayload };
    } catch (error) {
      return {
        rawPayloadUnavailable: true,
        rawPayloadError: error instanceof Error ? error.message : "serialization_failed"
      };
    }
  }
  _normalizeUnknownEvent(rawEvent) {
    const providerEventType = this._toString(rawEvent?.type);
    const providerItemType = this._toString(rawEvent?.item?.type || rawEvent?.payload?.type);
    const unknownReason = providerEventType ? "unknown_event_type" : "malformed_event";
    const normalized = {
      type: "system",
      subtype: "unknown",
      message: providerEventType ? `Unrecognized Codex event: ${providerEventType}` : "Malformed Codex event",
      unknownReason,
      ...this._serializeUnknownPayload(rawEvent)
    };
    if (providerEventType) normalized.providerEventType = providerEventType;
    if (providerItemType) normalized.providerItemType = providerItemType;
    return normalized;
  }
  _normalizeUsage(rawUsage = {}) {
    const usage2 = {
      inputTokens: typeof rawUsage.input_tokens === "number" ? rawUsage.input_tokens : 0,
      outputTokens: typeof rawUsage.output_tokens === "number" ? rawUsage.output_tokens : 0
    };
    const cacheRead = rawUsage.cache_read_input_tokens ?? rawUsage.cached_input_tokens;
    if (typeof cacheRead === "number") usage2.cacheReadTokens = cacheRead;
    if (typeof rawUsage.cache_creation_input_tokens === "number") {
      usage2.cacheCreationTokens = rawUsage.cache_creation_input_tokens;
    }
    return usage2;
  }
  _ensureRecord(value) {
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
    return {};
  }
  _itemId(item, rawEvent) {
    return this._toString(item?.id || rawEvent.item_id);
  }
  _toolName(item) {
    return this._toString(item.tool || item.command || item.name, "unknown");
  }
  _extractDeltaText(rawEvent, item) {
    if (typeof rawEvent.delta === "string") return rawEvent.delta;
    if (rawEvent.delta && typeof rawEvent.delta === "object") {
      if (typeof rawEvent.delta.text === "string") return rawEvent.delta.text;
      if (Array.isArray(rawEvent.delta.content)) {
        return rawEvent.delta.content.map((block) => block && typeof block.text === "string" ? block.text : "").join("");
      }
    }
    if (typeof item?.text === "string") return item.text;
    if (Array.isArray(item?.content)) {
      return item.content.map((block) => block && typeof block.text === "string" ? block.text : "").join("");
    }
    return "";
  }
  _assistantWithContent(rawEvent, content) {
    const normalized = {
      type: "assistant",
      content
    };
    const model = rawEvent.item?.model || rawEvent.model;
    if (typeof model === "string" && model) normalized.model = model;
    return this._wrap(normalized, rawEvent);
  }
  _handleItemStarted(rawEvent) {
    const item = rawEvent.item || {};
    const itemId = this._itemId(item, rawEvent);
    const itemType = item.type;
    if (!itemId) return [];
    if (itemType === "agent_message" || itemType === "reasoning") {
      this.pendingItems.set(itemId, {
        type: itemType,
        name: itemType,
        contentBuffer: this._extractDeltaText(rawEvent, item),
        startEvent: rawEvent
      });
      return [];
    }
    if (itemType === "command_execution" || itemType === "mcp_tool_call") {
      this.pendingItems.set(itemId, {
        type: itemType,
        name: this._toolName(item),
        contentBuffer: "",
        startEvent: rawEvent
      });
      return [this._assistantWithContent(rawEvent, [{
        type: "tool_use",
        id: itemId,
        name: this._toolName(item),
        input: this._ensureRecord(item.arguments || item.input || item.args)
      }])];
    }
    this.pendingItems.set(itemId, {
      type: itemType || "unknown",
      name: itemType || "unknown",
      contentBuffer: this._extractDeltaText(rawEvent, item),
      startEvent: rawEvent
    });
    return [];
  }
  _handleItemUpdated(rawEvent) {
    const item = rawEvent.item || {};
    const itemId = this._itemId(item, rawEvent);
    if (!itemId) return [];
    const pending = this.pendingItems.get(itemId);
    if (!pending) return [];
    const delta = this._extractDeltaText(rawEvent, item);
    if (delta) pending.contentBuffer += delta;
    return [];
  }
  _handleItemCompleted(rawEvent) {
    const item = rawEvent.item || {};
    const itemId = this._itemId(item, rawEvent);
    const itemType = item.type;
    if (!itemId) return [];
    const pending = this.pendingItems.get(itemId);
    if (itemType === "agent_message" || itemType === "reasoning") {
      const text2 = this._extractDeltaText(rawEvent, item) || pending?.contentBuffer || "";
      this.pendingItems.delete(itemId);
      const blockType = itemType === "reasoning" ? "thinking" : "text";
      const content = [{
        type: blockType,
        [blockType === "thinking" ? "thinking" : "text"]: text2
      }];
      return [this._assistantWithContent(rawEvent, content)];
    }
    if (itemType === "command_execution" || itemType === "mcp_tool_call") {
      this.pendingItems.delete(itemId);
      const output = item.output ?? item.result?.content?.[0]?.text ?? item.result ?? pending?.contentBuffer ?? "";
      return [this._assistantWithContent(rawEvent, [{
        type: "tool_result",
        toolUseId: itemId,
        content: this._toText(output),
        isError: !!(item.error || item.exit_code != null && item.exit_code !== 0)
      }])];
    }
    if (itemType === "file_change") {
      this.pendingItems.delete(itemId);
      const changes = Array.isArray(item.changes) ? item.changes : [];
      const summary = changes.map((c) => `${c.kind || "change"}: ${c.path || "unknown"}`).join("\n");
      return [this._assistantWithContent(rawEvent, [{
        type: "text",
        text: summary || this._toText(item)
      }])];
    }
    this.pendingItems.delete(itemId);
    const text = this._extractDeltaText(rawEvent, item) || pending?.contentBuffer || this._toText(item);
    return [this._assistantWithContent(rawEvent, [{
      type: "text",
      text
    }])];
  }
  _handleTurnCompleted(rawEvent) {
    const flushed = this.flush();
    const normalized = {
      type: "result",
      numTurns: typeof rawEvent.turn_number === "number" ? rawEvent.turn_number : 1,
      usage: this._normalizeUsage(rawEvent.usage || {})
    };
    const sid = this._sid(rawEvent);
    if (sid) normalized.providerSessionId = sid;
    if (typeof rawEvent.cost_usd === "number") normalized.costUsd = rawEvent.cost_usd;
    if (typeof rawEvent.duration_ms === "number") normalized.durationMs = rawEvent.duration_ms;
    if (typeof rawEvent.model === "string" && rawEvent.model) normalized.model = rawEvent.model;
    if (typeof rawEvent.result === "string") normalized.result = rawEvent.result;
    flushed.push(this._wrap(normalized, rawEvent));
    return flushed;
  }
  /**
   * Flush one buffered item into an assistant event.
   * Used when a turn completes before item.completed arrives.
   */
  _flushItem(itemId, pending, rawEvent) {
    const isTool = pending.type === "command_execution" || pending.type === "mcp_tool_call";
    if (!pending.contentBuffer && !isTool) return null;
    if (pending.type === "agent_message" || pending.type === "reasoning") {
      const blockType = pending.type === "reasoning" ? "thinking" : "text";
      return this._assistantWithContent(rawEvent, [{
        type: blockType,
        [blockType === "thinking" ? "thinking" : "text"]: pending.contentBuffer
      }]);
    }
    if (isTool) {
      return this._assistantWithContent(rawEvent, [{
        type: "tool_result",
        toolUseId: itemId,
        content: pending.contentBuffer || "(no output)",
        isError: false
      }]);
    }
    return this._assistantWithContent(rawEvent, [{
      type: "text",
      text: pending.contentBuffer
    }]);
  }
};

// src/agent-host/events/providers/index.js
var NORMALIZERS = {
  claude: claude_exports
};
function createNormalizer(provider) {
  if (provider === "codex") return new CodexNormalizer();
  return null;
}
function getNormalizer(provider) {
  const normalizer = NORMALIZERS[provider];
  if (normalizer && typeof normalizer.normalize === "function") {
    return normalizer.normalize;
  }
  return (event) => event;
}
function normalizeEvent(provider, rawEvent, normalizer) {
  if (normalizer) {
    return normalizer.normalize(rawEvent);
  }
  const normalize2 = getNormalizer(provider);
  const normalized = normalize2(rawEvent);
  return [{ normalized, raw: rawEvent }];
}

// src/agent-host/events/antigravity.js
function usage(raw) {
  if (!raw || typeof raw !== "object") return void 0;
  if (typeof raw.input_tokens !== "number" || typeof raw.output_tokens !== "number") return void 0;
  const normalized = {
    inputTokens: raw.input_tokens,
    outputTokens: raw.output_tokens
  };
  if (typeof raw.cache_read_tokens === "number") normalized.cacheReadTokens = raw.cache_read_tokens;
  return normalized;
}
function normalizeAntigravityEvent(rawEvent) {
  if (!rawEvent || typeof rawEvent !== "object") {
    return { message: "Invalid Antigravity event", type: "error" };
  }
  if (rawEvent.event === "init") {
    return {
      message: "Antigravity conversation initialized",
      subtype: "init",
      type: "system"
    };
  }
  if (rawEvent.event === "step_update") {
    const step = rawEvent.step_update || {};
    if (step.step_type === "agent_response" && typeof step.text_delta === "string") {
      const normalized = {
        content: [{ text: step.text_delta, type: "text" }],
        type: "assistant"
      };
      const normalizedUsage = usage(step.usage);
      if (normalizedUsage) normalized.usage = normalizedUsage;
      return normalized;
    }
    return {
      message: `Antigravity step ${step.step_type || "unknown"}: ${step.state || "unknown"}`,
      subtype: "step_update",
      type: "system"
    };
  }
  if (rawEvent.event === "result") {
    const result = rawEvent.result || {};
    const normalized = {
      providerSessionId: result.conversation_id,
      result: typeof result.response === "string" ? result.response : void 0,
      type: "result"
    };
    if (typeof result.duration_seconds === "number") normalized.durationMs = Math.round(result.duration_seconds * 1e3);
    if (typeof result.num_turns === "number") normalized.numTurns = result.num_turns;
    const normalizedUsage = usage(result.usage);
    if (normalizedUsage) normalized.usage = normalizedUsage;
    if (result.status && result.status !== "SUCCESS") normalized.isError = true;
    return normalized;
  }
  if (rawEvent.event === "error") {
    return {
      message: rawEvent.error?.message || rawEvent.message || "Antigravity error",
      type: "error"
    };
  }
  return {
    message: `Unrecognized Antigravity event: ${rawEvent.event || "unknown"}`,
    subtype: "unknown",
    type: "system"
  };
}

// src/agent-host/events/gemini.js
function usageFromStats(stats) {
  const raw = stats?.usage || stats;
  if (!raw || typeof raw !== "object") return void 0;
  const inputTokens = raw.input_tokens ?? raw.inputTokens;
  const outputTokens = raw.output_tokens ?? raw.outputTokens;
  if (typeof inputTokens !== "number" || typeof outputTokens !== "number") return void 0;
  const usage2 = { inputTokens, outputTokens };
  const cacheReadTokens = raw.cache_read_tokens ?? raw.cacheReadTokens;
  if (typeof cacheReadTokens === "number") usage2.cacheReadTokens = cacheReadTokens;
  return usage2;
}
function normalizeGeminiEvent(rawEvent) {
  if (!rawEvent || typeof rawEvent !== "object") {
    return { message: "Invalid Gemini event", type: "error" };
  }
  if (rawEvent.type === "init") {
    return {
      message: "Gemini session initialized",
      subtype: "init",
      type: "system"
    };
  }
  if (rawEvent.type === "message") {
    if (rawEvent.role === "assistant" && typeof rawEvent.content === "string") {
      return {
        content: [{ text: rawEvent.content, type: "text" }],
        type: "assistant"
      };
    }
    return {
      message: `Gemini ${rawEvent.role || "unknown"} message`,
      subtype: "message",
      type: "system"
    };
  }
  if (rawEvent.type === "tool_use") {
    return {
      content: [{
        id: rawEvent.tool_id || "",
        input: rawEvent.parameters && typeof rawEvent.parameters === "object" ? rawEvent.parameters : {},
        name: rawEvent.tool_name || "unknown",
        type: "tool_use"
      }],
      type: "assistant"
    };
  }
  if (rawEvent.type === "tool_result") {
    return {
      content: [{
        content: rawEvent.output || rawEvent.error?.message || "",
        isError: rawEvent.status === "error",
        toolUseId: rawEvent.tool_id || "",
        type: "tool_result"
      }],
      type: "assistant"
    };
  }
  if (rawEvent.type === "error") {
    return {
      message: rawEvent.message || "Gemini error",
      type: "error"
    };
  }
  if (rawEvent.type === "result") {
    const normalized = { type: "result" };
    const durationMs = rawEvent.stats?.duration_ms ?? rawEvent.stats?.durationMs;
    if (typeof durationMs === "number") normalized.durationMs = durationMs;
    const normalizedUsage = usageFromStats(rawEvent.stats);
    if (normalizedUsage) normalized.usage = normalizedUsage;
    if (rawEvent.status && rawEvent.status !== "success") normalized.isError = true;
    return normalized;
  }
  return {
    message: `Unrecognized Gemini event: ${rawEvent.type || "unknown"}`,
    subtype: "unknown",
    type: "system"
  };
}

// src/agent-host/events/normalize.js
var SESSION_ID_KEYS = [
  "session_id",
  "sessionId",
  "thread_id",
  "threadId",
  "conversation_id",
  "conversationId"
];
function extractNativeSessionId(rawEvent) {
  if (!rawEvent || typeof rawEvent !== "object") return null;
  for (const key of SESSION_ID_KEYS) {
    if (typeof rawEvent[key] === "string" && rawEvent[key].trim()) return rawEvent[key];
  }
  for (const containerKey of ["session", "thread", "conversation", "init", "step_update", "result"]) {
    const container = rawEvent[containerKey];
    if (container && typeof container === "object") {
      const value = container.id || container.session_id || container.thread_id || container.conversation_id;
      if (typeof value === "string" && value.trim()) return value;
    }
  }
  return null;
}
function createAgentEventNormalizer(provider) {
  const directNormalizer = provider === "antigravity" ? normalizeAntigravityEvent : provider === "gemini" ? normalizeGeminiEvent : null;
  const stateful = createNormalizer(provider);
  return {
    flush() {
      return typeof stateful?.flush === "function" ? stateful.flush() : [];
    },
    normalize(rawEvent) {
      if (directNormalizer) {
        return [{ normalized: directNormalizer(rawEvent), raw: rawEvent }];
      }
      return normalizeEvent(provider, rawEvent, stateful);
    }
  };
}
function renderAgentEvent(event) {
  if (!event || typeof event !== "object") return [];
  if (event.type === "assistant" && Array.isArray(event.content)) {
    return event.content.flatMap((block) => {
      if (block?.type === "text" && typeof block.text === "string" && block.text) return [block.text];
      return [];
    });
  }
  if (event.type === "result" && typeof event.result === "string" && event.result) {
    return [event.result];
  }
  return [];
}

// src/agent-host/events/stream.js
function boundedAppend(current, value, maxLength = 4096) {
  const combined = `${current}${value}`;
  return combined.length <= maxLength ? combined : combined.slice(-maxLength);
}
function writeLine(stream, value) {
  stream.write(value.endsWith("\n") ? value : `${value}
`);
}
function parsePrivateFinalOutput(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/u);
    if (!fenced) throw new Error("invalid");
    try {
      return JSON.parse(fenced[1]);
    } catch {
      throw new Error("invalid");
    }
  }
}
function executeForegroundLaunch({
  eventSink = null,
  jsonOutput = false,
  launchId,
  onSpawn = null,
  plan,
  spawnImpl = import_node_child_process7.spawn,
  taskStop = null,
  stderr = process.stderr,
  stdout = process.stdout,
  store,
  timeoutMs = plan.timeouts.runtimeMs,
  signalEmitter = process
}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 24 * 60 * 60 * 1e3) {
    throw new Error("timeoutMs must be an integer between 1 and 86400000");
  }
  return new Promise((resolve2, reject) => {
    const privateAutomation = plan.privateAutomationProfile != null;
    const taskExecution = plan.taskProfile != null;
    const supervised = privateAutomation || taskExecution;
    let taskTerminal = false;
    let taskFailure = null;
    let taskFinalOutput = null;
    const claudeTask = { terminal: false, sessionId: null, finalOutput: null };
    let taskIdentity = null;
    const normalizer = createAgentEventNormalizer(plan.provider);
    let child;
    let finalized = false;
    let stdoutBuffer = "";
    let stderrTail = "";
    let sawAssistantText = false;
    let timedOut = false;
    let forceTimer = null;
    let requestedSignal = null;
    let sinkFailure = null;
    let privateFailure = null;
    let privateFinalOutput = null;
    let privateObservedModel = privateAutomation && plan.provider === "codex" ? plan.model : null;
    let privateRawOutputBytes = 0;
    let privateUsage = null;
    function terminateProvider(signal) {
      if (taskExecution && taskStop) {
        void taskStop().catch(() => {
          taskFailure = "task audit cleanup unresolved";
        });
        return true;
      }
      if (taskExecution) {
        try {
          if (!taskIdentity || JSON.stringify(processIdentity(child.pid)) !== JSON.stringify(taskIdentity)) {
            taskFailure = "task process ownership unresolved";
            return false;
          }
          process.kill(-taskIdentity.pgid, signal);
          return true;
        } catch {
          taskFailure = "task process termination unconfirmed";
          return false;
        }
      }
      if (supervised && Number.isSafeInteger(child?.pid) && child.pid > 0) {
        try {
          process.kill(-child.pid, signal);
          return true;
        } catch {
        }
      }
      try {
        return child?.kill(signal) === true;
      } catch {
        return false;
      }
    }
    function privateProviderGroupAlive() {
      if (!supervised || !Number.isSafeInteger(child?.pid) || child.pid < 1) {
        return false;
      }
      try {
        process.kill(-child.pid, 0);
        return true;
      } catch {
        return false;
      }
    }
    function armForceTimer() {
      if (forceTimer || !supervised) return;
      forceTimer = setTimeout(() => terminateProvider("SIGKILL"), plan.timeouts.shutdownGraceMs || 5e3);
    }
    function recordSinkFailure(kind, error) {
      if (sinkFailure) return;
      sinkFailure = `${kind} persistence failed: ${error.message}`;
      try {
        writeLine(stderr, sinkFailure);
      } catch {
      }
      if (!finalized) {
        terminateProvider("SIGTERM");
        armForceTimer();
      }
    }
    function publishEvent(payload, persistedPayload = payload) {
      try {
        eventSink?.(persistedPayload);
      } catch (error) {
        recordSinkFailure("Agent event", error);
      }
      return payload;
    }
    const onSigint = () => {
      requestedSignal = "SIGINT";
      terminateProvider("SIGINT");
      armForceTimer();
    };
    const onSigterm = () => {
      requestedSignal = "SIGTERM";
      terminateProvider("SIGTERM");
      armForceTimer();
    };
    function persistNativeSession(rawEvent, normalized) {
      if (privateAutomation) return;
      const nativeSessionId = extractNativeSessionId(rawEvent) || normalized?.providerSessionId || null;
      if (!nativeSessionId) return;
      const current = store.get(launchId);
      if (current?.nativeSessionId !== nativeSessionId) {
        store.setNativeSessionId(launchId, nativeSessionId);
      }
    }
    function emitEvent(normalized, rawEvent) {
      persistNativeSession(rawEvent, normalized);
      const isDelta = rawEvent?.type === "message" && rawEvent.delta === true || rawEvent?.event === "step_update" && rawEvent.step_update?.step_type === "agent_response";
      let persistedEvent = normalized;
      if (privateAutomation) {
        try {
          assertPrivateAutomationRawEvent(plan.provider, rawEvent, plan.model);
          persistedEvent = projectPrivateAutomationEventMetadata(normalized);
        } catch (error) {
          privateFailure = String(error?.message || "").includes("model usage") ? "private_model_mismatch" : "private_tool_event";
          terminateProvider("SIGTERM");
          return;
        }
        if (normalized.model) {
          if (normalized.model !== plan.model) {
            privateFailure = "private_model_mismatch";
            terminateProvider("SIGTERM");
            return;
          }
          privateObservedModel = normalized.model;
        }
        if (normalized.usage) privateUsage = persistedEvent.usage || privateUsage;
        const structuredOutput = rawEvent?.structured_output ?? rawEvent?.structuredOutput;
        if (structuredOutput && typeof structuredOutput === "object" && !Array.isArray(structuredOutput)) {
          privateFinalOutput = structuredOutput;
        } else if (normalized.type === "assistant" && Array.isArray(normalized.content)) {
          const text = normalized.content.filter((block) => block?.type === "text" && typeof block.text === "string").map((block) => block.text).join("");
          if (text) privateFinalOutput = text;
        } else if (normalized.type === "result" && typeof normalized.result === "string") {
          privateFinalOutput = normalized.result;
        }
      }
      const persistedPayload = {
        delta: isDelta,
        event: persistedEvent,
        launchId,
        provider: plan.provider,
        type: "agent.event"
      };
      const payload = privateAutomation ? publishEvent(persistedPayload) : publishEvent({
        event: normalized,
        launchId,
        provider: plan.provider,
        rawEvent,
        type: "agent.event"
      }, persistedPayload);
      if (supervised) return;
      if (jsonOutput) {
        writeLine(stdout, JSON.stringify(payload));
        return;
      }
      const rendered = renderAgentEvent(normalized);
      if (normalized?.type === "assistant" && rendered.length > 0) sawAssistantText = true;
      if (normalized?.type === "result" && sawAssistantText) return;
      for (const text of rendered) {
        if (isDelta) stdout.write(text);
        else writeLine(stdout, text);
      }
      if (normalized?.type === "error" && normalized.message) writeLine(stderr, normalized.message);
    }
    function consumeLine(line) {
      if (!line.trim()) return;
      try {
        const rawEvent = taskExecution ? parseTaskJson(line) : JSON.parse(line);
        if (taskExecution) {
          if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) throw new Error("invalid event");
          if (plan.provider === "claude") {
            consumeClaudeTaskEvent(claudeTask, rawEvent);
            taskTerminal = claudeTask.terminal;
            taskFinalOutput = claudeTask.finalOutput;
          } else {
            if (rawEvent.type === "turn.completed") taskTerminal = true;
            if (rawEvent.type === "turn.failed" || rawEvent.type === "error") taskFailure = "native terminal failure";
            if (rawEvent.type === "item.completed" && rawEvent.item?.type === "agent_message") {
              if (Buffer.byteLength(rawEvent.item.text || "") > 65536) throw new Error("final output overflow");
              taskFinalOutput = rawEvent.item.text;
            }
          }
        }
        for (const result of normalizer.normalize(rawEvent)) {
          if (result?.normalized) emitEvent(result.normalized, result.raw || rawEvent);
        }
      } catch {
        if (taskExecution) {
          taskFailure = "malformed native output";
          terminateProvider("SIGTERM");
          armForceTimer();
          return;
        }
        if (privateAutomation) {
          privateFailure = "private_output_malformed";
          terminateProvider("SIGTERM");
          return;
        }
        const payload = publishEvent({
          event: { message: line, subtype: "provider_stdout", type: "system" },
          launchId,
          provider: plan.provider,
          type: "agent.event"
        });
        if (jsonOutput) {
          writeLine(stdout, JSON.stringify(payload));
        } else {
          writeLine(stdout, line);
        }
      }
    }
    function flushStdout() {
      if (stdoutBuffer.trim()) consumeLine(stdoutBuffer);
      stdoutBuffer = "";
      for (const result of normalizer.flush()) {
        if (result?.normalized) emitEvent(result.normalized, result.raw || {});
      }
    }
    function complete(status, exitCode, lastError = null) {
      try {
        finishLaunch(status, exitCode, lastError);
      } catch (error) {
        terminateProvider("SIGKILL");
        clearTimeout(runtimeTimer);
        if (forceTimer) clearTimeout(forceTimer);
        signalEmitter.removeListener("SIGINT", onSigint);
        signalEmitter.removeListener("SIGTERM", onSigterm);
        finalized = true;
        reject(error);
      }
    }
    function finishLaunch(status, exitCode, lastError) {
      if (finalized) return;
      flushStdout();
      clearTimeout(runtimeTimer);
      if (forceTimer) clearTimeout(forceTimer);
      signalEmitter.removeListener("SIGINT", onSigint);
      signalEmitter.removeListener("SIGTERM", onSigterm);
      finalized = true;
      if (sinkFailure) {
        status = "failed";
        lastError = sinkFailure;
      }
      if (privateAutomation) {
        if (privateFailure) {
          status = "failed";
          lastError = `Private automation failed: ${privateFailure}`;
        } else if (status === "completed" && privateObservedModel === null) {
          status = "failed";
          lastError = "Private automation failed: private_model_unobserved";
        } else if (status === "completed") {
          try {
            const parsed = parsePrivateFinalOutput(privateFinalOutput);
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
              throw new Error("not_object");
            }
            const serialized = JSON.stringify(parsed);
            if (Buffer.byteLength(serialized, "utf8") > plan.maxFinalOutputBytes) {
              throw new Error("too_large");
            }
            if (!plan.privateAutomationProfile.outputSchema.validate(parsed)) {
              throw new Error("schema");
            }
            privateFinalOutput = parsed;
          } catch (error) {
            status = "failed";
            const reason = error.message === "too_large" ? "private_final_output_overflow" : error.message === "schema" ? "private_final_output_schema_invalid" : "private_final_output_invalid";
            lastError = `Private automation failed: ${reason}`;
          }
        } else {
          lastError = timedOut ? "Private automation failed: private_timeout" : requestedSignal ? "Private automation failed: private_stopped" : "Private automation failed: private_provider_error";
        }
      }
      if (taskExecution && status === "completed") {
        try {
          if (taskFailure || !taskTerminal || !store.get(launchId)?.nativeSessionId) throw new Error(taskFailure || "missing native terminal/session evidence");
          taskFinalOutput = parseTaskJson(taskFinalOutput);
          if (!taskFinalOutput || !["complete", "no_work", "needs_evidence", "partial", "failed"].includes(taskFinalOutput.outcome) || !Array.isArray(taskFinalOutput.outputs) || taskFinalOutput.outputs.length > 64 || Object.keys(taskFinalOutput).sort().join(",") !== "outcome,outputs") throw new Error("invalid task final manifest");
          if (taskFinalOutput.outcome === "failed") throw new Error("task reported failure");
        } catch (error) {
          status = "failed";
          lastError = error.message;
        }
      }
      const current = store.get(launchId);
      if (current?.status === "starting" && status !== "failed") {
        store.transition(launchId, "running", { pid: child?.pid || 0 });
      }
      const updated = store.transition(launchId, status, {
        exitCode,
        lastError
      });
      const terminalEvent = publishEvent({ launch: updated, type: `launch.${status}` });
      if (taskExecution && sinkFailure && status === "completed") {
        reject(new Error(sinkFailure));
        return;
      }
      if (privateAutomation && status === "completed") {
        const privateResult = {
          model: privateObservedModel,
          output: privateFinalOutput,
          provider: plan.provider,
          type: "private-automation.result",
          ...privateUsage ? { usage: privateUsage } : {}
        };
        writeLine(stdout, jsonOutput ? JSON.stringify(privateResult) : JSON.stringify(privateFinalOutput));
      }
      if (jsonOutput) {
        if (!privateAutomation) writeLine(stdout, JSON.stringify(terminalEvent));
      }
      resolve2(taskExecution ? { ...updated, taskFinalOutput } : updated);
    }
    const runtimeTimer = setTimeout(() => {
      timedOut = true;
      terminateProvider("SIGTERM");
      forceTimer = setTimeout(
        () => terminateProvider("SIGKILL"),
        plan.timeouts.shutdownGraceMs || 5e3
      );
    }, timeoutMs);
    try {
      child = spawnImpl(plan.spawn.command, plan.args, {
        cwd: plan.spawn.cwd,
        detached: supervised,
        env: supervised ? plan.environment : { ...process.env, ...plan.environment },
        stdio: [supervised ? "pipe" : "ignore", "pipe", "pipe"]
      });
    } catch (error) {
      clearTimeout(runtimeTimer);
      reject(error);
      return;
    }
    if (supervised) {
      child.stdin.on("error", () => {
        if (taskExecution) taskFailure = "task stdin error";
        privateFailure = "private_stdin_error";
        terminateProvider("SIGTERM");
      });
      if (!taskExecution) child.stdin.end(plan.stdin);
    }
    child.once("spawn", async () => {
      try {
        if (taskExecution && Number.isSafeInteger(child.pid)) {
          taskIdentity = processIdentity(child.pid);
          if (!taskIdentity || taskIdentity.pgid !== child.pid) throw new Error("task process identity unavailable");
        }
        const current = store.get(launchId);
        if (current?.status === "starting") {
          const running = store.transition(launchId, "running", { pid: child.pid || 0 });
          await onSpawn?.(running);
        } else if (current) {
          await onSpawn?.(current);
        }
        if (taskExecution && !finalized) child.stdin.end(plan.stdin);
      } catch (error) {
        recordSinkFailure("Launch startup", error);
      }
    });
    signalEmitter.once("SIGINT", onSigint);
    signalEmitter.once("SIGTERM", onSigterm);
    child.stdout.on("data", (chunk) => {
      if (supervised) {
        privateRawOutputBytes += Buffer.byteLength(chunk);
        if (privateRawOutputBytes > plan.maxRawOutputBytes) {
          if (taskExecution) taskFailure = "task native output overflow";
          privateFailure = "private_raw_output_overflow";
          armForceTimer();
          stdoutBuffer = "";
          terminateProvider("SIGTERM");
          return;
        }
      }
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) consumeLine(line);
    });
    child.stderr.on("data", (chunk) => {
      if (taskExecution) stderrTail = boundedAppend(stderrTail, chunk.toString());
      if (supervised) return;
      const text = chunk.toString();
      stderrTail = boundedAppend(stderrTail, text);
      try {
        stderr.write(text);
      } catch (error) {
        recordSinkFailure("Provider stderr", error);
      }
    });
    child.once("error", (error) => {
      complete(
        "failed",
        null,
        privateAutomation ? "Private automation failed: private_spawn_error" : `Provider process error: ${error.message}`
      );
    });
    if (taskExecution && taskStop) child.once("exit", () => terminateProvider("SIGKILL"));
    child.once("close", (exitCode, signal) => {
      if (!(taskExecution && taskStop) && privateProviderGroupAlive()) {
        terminateProvider("SIGKILL");
        if (taskExecution) taskFailure = "task process group remained alive";
        privateFailure = "private_termination_unconfirmed";
      }
      if (sinkFailure) {
        complete("failed", exitCode, sinkFailure);
        return;
      }
      if (timedOut) {
        complete("failed", exitCode, `Provider process timed out after ${timeoutMs}ms`);
        return;
      }
      if (requestedSignal) {
        complete("stopped", exitCode, `Provider process stopped by ${requestedSignal}`);
        return;
      }
      if (exitCode === 0) {
        complete("completed", 0);
        return;
      }
      const detail = stderrTail.trim() || `Provider process exited with code ${exitCode}${signal ? ` (${signal})` : ""}`;
      complete("failed", exitCode, detail);
    });
  });
}

// src/agent-host/launch-store.js
var import_node_fs9 = __toESM(require("node:fs"), 1);
var import_node_path9 = __toESM(require("node:path"), 1);
var import_better_sqlite3 = __toESM(require("better-sqlite3"), 1);

// src/runtime/node-policy.js
var SUPPORTED_NODE_DESCRIPTION = "Node 22 LTS or Node 24.22+ LTS";
function isSupportedNodeVersion(version) {
  const parsed = typeof version === "string" && /^v?(\d+)\.(\d+)\.\d+$/.exec(version);
  if (!parsed) return false;
  const major = Number(parsed[1]);
  const minor = Number(parsed[2]);
  return major === 22 || major === 24 && minor >= 22;
}
function assertSupportedNodeVersion(version = process.version) {
  if (isSupportedNodeVersion(version)) return;
  const error = new Error(
    `Unsupported Node.js ${version}; use ${SUPPORTED_NODE_DESCRIPTION}. Earlier Node 24 runtimes can abort during native SQLite cleanup.`
  );
  error.code = "RUDI_UNSUPPORTED_NODE";
  throw error;
}

// src/agent-host/launch-store.js
var LAUNCH_STATUSES = Object.freeze([
  "starting",
  "running",
  "completed",
  "failed",
  "stopped"
]);
var LAUNCH_DISPOSITIONS = Object.freeze(["retained", "promoted", "discarded"]);
var LAUNCH_EXECUTION_KINDS = Object.freeze(["foreground", "detached"]);
var GROUP_ID_PATTERN = /^group_[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
var TERMINAL_STATUSES = /* @__PURE__ */ new Set(["completed", "failed", "stopped"]);
var TRANSITIONS = Object.freeze({
  starting: /* @__PURE__ */ new Set(["running", "failed", "stopped"]),
  running: /* @__PURE__ */ new Set(["completed", "failed", "stopped"]),
  completed: /* @__PURE__ */ new Set(),
  failed: /* @__PURE__ */ new Set(),
  stopped: /* @__PURE__ */ new Set()
});
function requiredString(value, field, maxLength = 4096) {
  if (typeof value !== "string" || value.trim() === "" || value.includes("\0")) {
    throw new Error(`${field} must be a non-empty string without NUL bytes`);
  }
  if (value.length > maxLength) {
    throw new Error(`${field} exceeds ${maxLength} characters`);
  }
  return value;
}
function optionalString(value, field, maxLength = 4096) {
  if (value == null) return null;
  return requiredString(value, field, maxLength);
}
function mapLaunch(row) {
  if (!row) return null;
  return {
    baseRef: row.base_ref,
    disposition: row.disposition,
    executionKind: row.execution_kind,
    executionWorkspace: row.execution_workspace,
    exitCode: row.exit_code,
    finishedAt: row.finished_at,
    lastError: row.last_error,
    launchId: row.launch_id,
    model: row.model,
    nativeSessionId: row.native_session_id,
    originDirectory: row.origin_directory,
    ownerPid: row.owner_pid,
    outputDestination: row.output_destination,
    parentLaunchId: row.parent_launch_id,
    pid: row.pid,
    projectRoot: row.project_root,
    provider: row.provider,
    startedAt: row.started_at,
    status: row.status,
    updatedAt: row.updated_at,
    workspaceMode: row.workspace_mode,
    worktreeBranch: row.worktree_branch
  };
}
function validateStatus(status) {
  if (!LAUNCH_STATUSES.includes(status)) {
    throw new Error(`Unknown launch status: ${status}`);
  }
  return status;
}
function validateEnum(value, field, allowed) {
  if (!allowed.includes(value)) {
    throw new Error(`Unknown ${field}: ${value}`);
  }
  return value;
}
function optionalPid(value, field) {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${field} must be a positive integer`);
  }
  return parsed;
}
function assertAgentGroupId(groupId) {
  if (typeof groupId !== "string" || !GROUP_ID_PATTERN.test(groupId)) {
    throw new Error("Invalid Agent Host group ID");
  }
  return groupId;
}
function deriveGroupStatus(launches) {
  const statuses = launches.map((launch) => launch.status);
  if (statuses.includes("running")) return "running";
  if (statuses.includes("starting")) return "starting";
  if (statuses.every((status) => status === "completed")) return "completed";
  if (statuses.some((status) => status === "completed")) return "partial";
  if (statuses.every((status) => status === "stopped")) return "stopped";
  return "failed";
}
function ensureColumn(database, name, definition) {
  const columns = new Set(database.prepare("PRAGMA table_info(agent_launches)").all().map((row) => row.name));
  if (!columns.has(name)) database.exec(`ALTER TABLE agent_launches ADD COLUMN ${name} ${definition}`);
}
function migrateSharedWorkspace(database) {
  const sql = database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='agent_launches'").get().sql;
  if (sql.includes("'registered-shared'")) return;
  const indexes = database.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='agent_launches' AND sql IS NOT NULL").all();
  const replacement = sql.replace("CREATE TABLE agent_launches", "CREATE TABLE agent_launches_next").replace("'isolated-copy'", "'isolated-copy', 'registered-shared'");
  if (replacement === sql || !replacement.includes("CREATE TABLE agent_launches_next")) throw new Error("unrecognized Agent Host launch schema");
  database.pragma("foreign_keys = OFF");
  try {
    database.transaction(() => {
      database.exec(replacement);
      database.exec("INSERT INTO agent_launches_next SELECT * FROM agent_launches");
      database.exec("DROP TABLE agent_launches");
      database.exec("ALTER TABLE agent_launches_next RENAME TO agent_launches");
      for (const index of indexes) database.exec(index.sql);
      if (database.pragma("foreign_key_check").length) throw new Error("Agent Host migration foreign-key failure");
    })();
  } finally {
    database.pragma("foreign_keys = ON");
  }
}
function initialize(database) {
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE IF NOT EXISTS agent_launches (
      launch_id TEXT PRIMARY KEY,
      parent_launch_id TEXT REFERENCES agent_launches(launch_id),
      provider TEXT NOT NULL,
      native_session_id TEXT,
      origin_directory TEXT NOT NULL,
      project_root TEXT NOT NULL,
      execution_workspace TEXT NOT NULL,
      output_destination TEXT NOT NULL,
      workspace_mode TEXT NOT NULL CHECK (workspace_mode IN ('read-only', 'worktree', 'isolated-copy', 'registered-shared')),
      worktree_branch TEXT,
      base_ref TEXT,
      model TEXT NOT NULL,
      execution_kind TEXT NOT NULL DEFAULT 'foreground' CHECK (execution_kind IN ('foreground', 'detached')),
      owner_pid INTEGER,
      disposition TEXT NOT NULL DEFAULT 'retained' CHECK (disposition IN ('retained', 'promoted', 'discarded')),
      status TEXT NOT NULL CHECK (status IN ('starting', 'running', 'completed', 'failed', 'stopped')),
      pid INTEGER,
      exit_code INTEGER,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      updated_at TEXT NOT NULL,
      last_error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_agent_launches_status_started
      ON agent_launches(status, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_launches_native_session
      ON agent_launches(provider, native_session_id);

    CREATE TABLE IF NOT EXISTS agent_groups (
      group_id TEXT PRIMARY KEY,
      origin_directory TEXT NOT NULL,
      workspace TEXT NOT NULL,
      workspace_mode TEXT NOT NULL CHECK (workspace_mode IN ('auto', 'read-only', 'worktree', 'isolated-copy')),
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_group_launches (
      group_id TEXT NOT NULL REFERENCES agent_groups(group_id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL,
      launch_id TEXT NOT NULL UNIQUE,
      provider TEXT NOT NULL,
      last_error TEXT,
      PRIMARY KEY (group_id, ordinal)
    );

    CREATE INDEX IF NOT EXISTS idx_agent_group_launches_group
      ON agent_group_launches(group_id, ordinal);
  `);
  migrateSharedWorkspace(database);
  ensureColumn(database, "execution_kind", "TEXT NOT NULL DEFAULT 'foreground' CHECK (execution_kind IN ('foreground', 'detached'))");
  ensureColumn(database, "owner_pid", "INTEGER");
  ensureColumn(database, "disposition", "TEXT NOT NULL DEFAULT 'retained' CHECK (disposition IN ('retained', 'promoted', 'discarded'))");
}
function createLaunchStore({
  databasePath = getAgentHostPaths().stateDatabase,
  now = () => (/* @__PURE__ */ new Date()).toISOString()
} = {}) {
  assertSupportedNodeVersion();
  const resolvedPath = import_node_path9.default.resolve(databasePath);
  import_node_fs9.default.mkdirSync(import_node_path9.default.dirname(resolvedPath), { recursive: true, mode: 448 });
  const database = new import_better_sqlite3.default(resolvedPath);
  import_node_fs9.default.chmodSync(resolvedPath, 384);
  initialize(database);
  const getStatement = database.prepare("SELECT * FROM agent_launches WHERE launch_id = ?");
  function get(launchId) {
    assertLaunchId(launchId);
    return mapLaunch(getStatement.get(launchId));
  }
  function create(projection) {
    const launchId = assertLaunchId(projection?.launchId);
    const status = validateStatus(projection?.status || "starting");
    if (status !== "starting") {
      throw new Error("New launches must start in the starting state");
    }
    const timestamp = now();
    const record2 = {
      baseRef: optionalString(projection.baseRef, "baseRef", 512),
      disposition: validateEnum(projection.disposition || "retained", "launch disposition", LAUNCH_DISPOSITIONS),
      executionKind: validateEnum(projection.executionKind || "foreground", "execution kind", LAUNCH_EXECUTION_KINDS),
      executionWorkspace: requiredString(projection.executionWorkspace, "executionWorkspace"),
      launchId,
      model: requiredString(projection.model, "model", 512),
      nativeSessionId: optionalString(projection.nativeSessionId, "nativeSessionId", 1024),
      originDirectory: requiredString(projection.originDirectory, "originDirectory"),
      ownerPid: optionalPid(projection.ownerPid, "ownerPid"),
      outputDestination: requiredString(projection.outputDestination, "outputDestination"),
      parentLaunchId: projection.parentLaunchId == null ? null : assertLaunchId(projection.parentLaunchId),
      projectRoot: requiredString(projection.projectRoot, "projectRoot"),
      provider: requiredString(projection.provider, "provider", 64),
      status,
      workspaceMode: requiredString(projection.workspaceMode, "workspaceMode", 32),
      worktreeBranch: optionalString(projection.worktreeBranch, "worktreeBranch", 512)
    };
    database.prepare(`
      INSERT INTO agent_launches (
        launch_id, parent_launch_id, provider, native_session_id,
        origin_directory, project_root, execution_workspace, output_destination,
        workspace_mode, worktree_branch, base_ref, model, status,
        execution_kind, owner_pid, disposition, started_at, updated_at
      ) VALUES (
        @launchId, @parentLaunchId, @provider, @nativeSessionId,
        @originDirectory, @projectRoot, @executionWorkspace, @outputDestination,
        @workspaceMode, @worktreeBranch, @baseRef, @model, @status,
        @executionKind, @ownerPid, @disposition, @startedAt, @updatedAt
      )
    `).run({ ...record2, startedAt: timestamp, updatedAt: timestamp });
    return get(launchId);
  }
  function transition(launchId, nextStatus, patch = {}) {
    assertLaunchId(launchId);
    validateStatus(nextStatus);
    const current = get(launchId);
    if (!current) throw new Error(`Launch not found: ${launchId}`);
    if (!TRANSITIONS[current.status].has(nextStatus)) {
      throw new Error(`Invalid launch transition: ${current.status} -> ${nextStatus}`);
    }
    const timestamp = now();
    const pid = patch.pid == null ? current.pid : Number(patch.pid);
    const exitCode = patch.exitCode == null ? current.exitCode : Number(patch.exitCode);
    if (pid != null && (!Number.isSafeInteger(pid) || pid < 0)) {
      throw new Error("pid must be a non-negative integer");
    }
    if (exitCode != null && !Number.isSafeInteger(exitCode)) {
      throw new Error("exitCode must be an integer");
    }
    database.prepare(`
      UPDATE agent_launches
      SET status = @status,
          pid = @pid,
          owner_pid = @ownerPid,
          exit_code = @exitCode,
          native_session_id = COALESCE(@nativeSessionId, native_session_id),
          last_error = @lastError,
          finished_at = @finishedAt,
          updated_at = @updatedAt
      WHERE launch_id = @launchId
    `).run({
      exitCode,
      finishedAt: TERMINAL_STATUSES.has(nextStatus) ? timestamp : null,
      lastError: optionalString(patch.lastError, "lastError", 4096),
      launchId,
      nativeSessionId: optionalString(patch.nativeSessionId, "nativeSessionId", 1024),
      ownerPid: TERMINAL_STATUSES.has(nextStatus) ? null : optionalPid(patch.ownerPid == null ? current.ownerPid : patch.ownerPid, "ownerPid"),
      pid,
      status: nextStatus,
      updatedAt: timestamp
    });
    return get(launchId);
  }
  function setDisposition(launchId, disposition) {
    assertLaunchId(launchId);
    const next = validateEnum(disposition, "launch disposition", LAUNCH_DISPOSITIONS);
    const current = get(launchId);
    if (!current) throw new Error(`Launch not found: ${launchId}`);
    if (current.disposition === next) return current;
    if (current.disposition !== "retained") {
      throw new Error(`Launch is already ${current.disposition}: ${launchId}`);
    }
    if (next === "retained") return current;
    database.prepare(`
      UPDATE agent_launches
      SET disposition = ?, updated_at = ?
      WHERE launch_id = ?
    `).run(next, now(), launchId);
    return get(launchId);
  }
  function setNativeSessionId(launchId, nativeSessionId) {
    assertLaunchId(launchId);
    const validNativeId = requiredString(nativeSessionId, "nativeSessionId", 1024);
    const result = database.prepare(`
      UPDATE agent_launches
      SET native_session_id = ?, updated_at = ?
      WHERE launch_id = ?
    `).run(validNativeId, now(), launchId);
    if (result.changes === 0) throw new Error(`Launch not found: ${launchId}`);
    return get(launchId);
  }
  function list({ limit = 50, status = null } = {}) {
    const numericLimit = Number(limit);
    if (!Number.isSafeInteger(numericLimit) || numericLimit < 1 || numericLimit > 1e3) {
      throw new Error("limit must be an integer between 1 and 1000");
    }
    if (status != null) validateStatus(status);
    const rows = status == null ? database.prepare(`
          SELECT * FROM agent_launches
          ORDER BY started_at DESC, rowid DESC
          LIMIT ?
        `).all(numericLimit) : database.prepare(`
          SELECT * FROM agent_launches
          WHERE status = ?
          ORDER BY started_at DESC, rowid DESC
          LIMIT ?
        `).all(status, numericLimit);
    return rows.map(mapLaunch);
  }
  function getGroup(groupId) {
    assertAgentGroupId(groupId);
    const row = database.prepare("SELECT * FROM agent_groups WHERE group_id = ?").get(groupId);
    if (!row) return null;
    const taskRows = database.prepare(`
      SELECT launch_id, provider, last_error
      FROM agent_group_launches
      WHERE group_id = ?
      ORDER BY ordinal ASC
    `).all(groupId);
    const launches = taskRows.map((task) => {
      const launch = get(task.launch_id);
      if (launch) return launch;
      return {
        lastError: task.last_error,
        launchId: task.launch_id,
        provider: task.provider,
        status: task.last_error ? "failed" : "starting"
      };
    });
    const status = deriveGroupStatus(launches);
    const finishedAt = ["completed", "partial", "failed", "stopped"].includes(status) ? launches.map((launch) => launch.finishedAt).filter(Boolean).sort().at(-1) || row.updated_at : null;
    return {
      finishedAt,
      groupId: row.group_id,
      launches,
      originDirectory: row.origin_directory,
      startedAt: row.started_at,
      status,
      updatedAt: row.updated_at,
      workspace: row.workspace,
      workspaceMode: row.workspace_mode
    };
  }
  function createGroup(projection) {
    const groupId = assertAgentGroupId(projection?.groupId);
    const tasks = projection?.tasks;
    if (!Array.isArray(tasks) || tasks.length < 2 || tasks.length > 10) {
      throw new Error("Agent Host group requires between 2 and 10 tasks");
    }
    const validatedTasks = tasks.map((task, ordinal) => ({
      launchId: assertLaunchId(task?.launchId),
      ordinal,
      provider: requiredString(task?.provider, `tasks[${ordinal}].provider`, 64)
    }));
    if (new Set(validatedTasks.map((task) => task.launchId)).size !== validatedTasks.length) {
      throw new Error("Agent Host group launch IDs must be unique");
    }
    const timestamp = now();
    const record2 = {
      groupId,
      originDirectory: requiredString(projection.originDirectory, "originDirectory"),
      startedAt: timestamp,
      updatedAt: timestamp,
      workspace: requiredString(projection.workspace, "workspace"),
      workspaceMode: validateEnum(
        projection.workspaceMode || "auto",
        "group workspace mode",
        ["auto", "read-only", "worktree", "isolated-copy"]
      )
    };
    database.transaction(() => {
      database.prepare(`
        INSERT INTO agent_groups (
          group_id, origin_directory, workspace, workspace_mode, started_at, updated_at
        ) VALUES (
          @groupId, @originDirectory, @workspace, @workspaceMode, @startedAt, @updatedAt
        )
      `).run(record2);
      const insertTask = database.prepare(`
        INSERT INTO agent_group_launches (group_id, ordinal, launch_id, provider)
        VALUES (?, ?, ?, ?)
      `);
      for (const task of validatedTasks) {
        insertTask.run(groupId, task.ordinal, task.launchId, task.provider);
      }
    })();
    return getGroup(groupId);
  }
  function setGroupLaunchError(groupId, launchId, lastError) {
    assertAgentGroupId(groupId);
    assertLaunchId(launchId);
    const result = database.prepare(`
      UPDATE agent_group_launches
      SET last_error = ?
      WHERE group_id = ? AND launch_id = ?
    `).run(requiredString(lastError, "lastError", 4096), groupId, launchId);
    if (result.changes === 0) throw new Error(`Group launch not found: ${groupId}/${launchId}`);
    database.prepare("UPDATE agent_groups SET updated_at = ? WHERE group_id = ?").run(now(), groupId);
    return getGroup(groupId);
  }
  function listGroups({ limit = 50 } = {}) {
    const numericLimit = Number(limit);
    if (!Number.isSafeInteger(numericLimit) || numericLimit < 1 || numericLimit > 1e3) {
      throw new Error("limit must be an integer between 1 and 1000");
    }
    return database.prepare(`
      SELECT group_id FROM agent_groups
      ORDER BY started_at DESC, rowid DESC
      LIMIT ?
    `).all(numericLimit).map((row) => getGroup(row.group_id));
  }
  return {
    close() {
      if (database.open) database.close();
    },
    create,
    createGroup,
    database,
    get,
    getGroup,
    list,
    listGroups,
    setDisposition,
    setGroupLaunchError,
    setNativeSessionId,
    transition
  };
}

// src/agent-host/preflight.js
var import_node_path15 = __toESM(require("node:path"), 1);
var import_node_child_process9 = require("node:child_process");

// packages/mcp/src/agents.js
var import_fs = __toESM(require("fs"), 1);
var import_path2 = __toESM(require("path"), 1);
var import_os2 = __toESM(require("os"), 1);
var AGENT_CONFIGS = [
  // Claude Desktop (Anthropic)
  {
    id: "claude-desktop",
    name: "Claude Desktop",
    key: "mcpServers",
    paths: {
      darwin: ["Library/Application Support/Claude/claude_desktop_config.json"],
      win32: ["AppData/Roaming/Claude/claude_desktop_config.json"],
      linux: [".config/claude/claude_desktop_config.json"]
    }
  },
  // Claude Code CLI (Anthropic)
  {
    id: "claude-code",
    name: "Claude Code",
    key: "mcpServers",
    paths: {
      darwin: [".claude.json"],
      win32: [".claude.json"],
      linux: [".claude.json"]
    }
  },
  // Cursor (Anysphere)
  {
    id: "cursor",
    name: "Cursor",
    key: "mcpServers",
    paths: {
      darwin: [".cursor/mcp.json"],
      win32: [".cursor/mcp.json"],
      linux: [".cursor/mcp.json"]
    }
  },
  // Windsurf (Codeium)
  {
    id: "windsurf",
    name: "Windsurf",
    key: "mcpServers",
    paths: {
      darwin: [".codeium/windsurf/mcp_config.json"],
      win32: [".codeium/windsurf/mcp_config.json"],
      linux: [".codeium/windsurf/mcp_config.json"]
    }
  },
  // Cline (VS Code extension)
  {
    id: "cline",
    name: "Cline",
    key: "mcpServers",
    paths: {
      darwin: ["Documents/Cline/cline_mcp_settings.json"],
      win32: ["Documents/Cline/cline_mcp_settings.json"],
      linux: ["Documents/Cline/cline_mcp_settings.json"]
    }
  },
  // Zed Editor
  {
    id: "zed",
    name: "Zed",
    key: "context_servers",
    paths: {
      darwin: [".zed/settings.json"],
      win32: [".config/zed/settings.json"],
      linux: [".config/zed/settings.json"]
    }
  },
  // VS Code / GitHub Copilot
  {
    id: "vscode",
    name: "VS Code",
    key: "servers",
    paths: {
      darwin: ["Library/Application Support/Code/User/mcp.json"],
      win32: ["AppData/Roaming/Code/User/mcp.json"],
      linux: [".config/Code/User/mcp.json"]
    }
  },
  // Gemini CLI (Google)
  {
    id: "gemini",
    name: "Gemini",
    key: "mcpServers",
    paths: {
      darwin: [".gemini/settings.json"],
      win32: [".gemini/settings.json"],
      linux: [".gemini/settings.json"]
    }
  },
  // Antigravity CLI (Google)
  {
    id: "antigravity",
    name: "Antigravity",
    key: "mcpServers",
    paths: {
      darwin: [".gemini/config/mcp_config.json"],
      win32: [".gemini/config/mcp_config.json"],
      linux: [".gemini/config/mcp_config.json"]
    }
  },
  // Codex CLI (OpenAI)
  {
    id: "codex",
    name: "Codex",
    key: "mcp_servers",
    paths: {
      darwin: [".codex/config.toml", ".codex/config.json", ".codex/settings.json"],
      win32: [".codex/config.toml", ".codex/config.json", ".codex/settings.json"],
      linux: [".codex/config.toml", ".codex/config.json", ".codex/settings.json"]
    }
  }
];
function getAgentConfigPaths(agentConfig) {
  const home = import_os2.default.homedir();
  const platform = process.platform;
  const relativePaths = agentConfig.paths[platform] || agentConfig.paths.linux || [];
  return relativePaths.map((p) => import_path2.default.join(home, p));
}
function findAgentConfig(agentConfig) {
  const paths = getAgentConfigPaths(agentConfig);
  for (const configPath of paths) {
    if (import_fs.default.existsSync(configPath)) {
      return configPath;
    }
  }
  return null;
}
function parseTomlScalar(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') || trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1).split(",").map((item) => parseTomlScalar(item)).filter((item) => item !== "");
  }
  return trimmed;
}
function readCodexTomlMcpServers(content, configPath) {
  const servers = [];
  let current = null;
  for (const line of content.split("\n")) {
    const tableMatch = line.match(/^\s*\[mcp_servers\.([^\].]+)]\s*(?:#.*)?$/);
    if (tableMatch) {
      current = {
        name: tableMatch[1].replace(/^"(.*)"$/, "$1"),
        command: null,
        args: void 0,
        cwd: void 0,
        url: void 0
      };
      servers.push(current);
      continue;
    }
    if (!current) continue;
    const kvMatch = line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*(.+?)\s*(?:#.*)?$/);
    if (!kvMatch) continue;
    const [, key, value] = kvMatch;
    if (key === "command" || key === "cwd" || key === "url") {
      current[key] = parseTomlScalar(value);
    } else if (key === "args") {
      current.args = parseTomlScalar(value);
    }
  }
  return servers.map((server) => ({
    name: server.name,
    agent: "codex",
    agentName: "Codex",
    command: server.command || server.url || "unknown",
    args: server.args,
    cwd: server.cwd,
    env: [],
    configFile: configPath
  }));
}
function readAgentMcpServers(agentConfig) {
  const configPath = findAgentConfig(agentConfig);
  if (!configPath) return [];
  try {
    if (agentConfig.id === "codex" && configPath.endsWith(".toml")) {
      return readCodexTomlMcpServers(import_fs.default.readFileSync(configPath, "utf-8"), configPath);
    }
    const content = JSON.parse(import_fs.default.readFileSync(configPath, "utf-8"));
    const mcpServers = content[agentConfig.key] || {};
    return Object.entries(mcpServers).map(([name, config]) => {
      const command = config.command || config.path || config.command?.path;
      return {
        name,
        agent: agentConfig.id,
        agentName: agentConfig.name,
        command: command || "unknown",
        args: config.args,
        cwd: config.cwd,
        env: config.env ? Object.keys(config.env) : [],
        configFile: configPath
      };
    });
  } catch (e) {
    return [];
  }
}

// packages/mcp/src/registry.js
var path11 = __toESM(require("path"), 1);
var os6 = __toESM(require("os"), 1);
var HOME = os6.homedir();
var AGENT_CONFIGS2 = {
  claude: path11.join(HOME, ".claude", "settings.json"),
  codex: path11.join(HOME, ".codex", "config.toml"),
  gemini: path11.join(HOME, ".gemini", "settings.json")
};
var RUDI_ROUTER_SHIM = path11.join(HOME, ".rudi", "bins", "rudi-router");

// src/agent-host/providers/common.js
var import_node_fs10 = __toESM(require("node:fs"), 1);
var import_node_os5 = __toESM(require("node:os"), 1);
var import_node_path10 = __toESM(require("node:path"), 1);
var MAX_PROMPT_BYTES = 10 * 1024 * 1024;
var PERMISSION_ALIASES = Object.freeze({
  "accept-edits": "acceptEdits",
  "auto-edit": "acceptEdits",
  "dangerously-skip-permissions": "agent",
  "full-access": "fullAccess",
  "read-only": "readonly"
});
var READ_ONLY_PERMISSION = Object.freeze({
  antigravity: "plan",
  claude: "plan",
  codex: "readonly",
  gemini: "plan"
});
var WRITABLE_PERMISSION = Object.freeze({
  antigravity: "acceptEdits",
  claude: "acceptEdits",
  codex: "approve",
  gemini: "acceptEdits"
});
function requiredText2(value, field, maxBytes = MAX_PROMPT_BYTES) {
  if (typeof value !== "string" || value.trim() === "" || value.includes("\0")) {
    throw new Error(`${field} must be a non-empty string without NUL bytes`);
  }
  if (Buffer.byteLength(value, "utf8") > maxBytes) {
    throw new Error(`${field} exceeds ${maxBytes} bytes`);
  }
  return value;
}
function validateExtraArgs(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error("extraArgs must be an array of strings");
  return value.map((arg, index) => requiredText2(arg, `extraArgs[${index}]`, 64 * 1024));
}
function providerContext(options, provider) {
  const config = loadProviderConfig(provider);
  const taskProfile = options.taskProfile || null;
  if (taskProfile) {
    assertTaskProfile(taskProfile);
    if (provider !== taskProfile.provider || options.model !== taskProfile.model || options.nativeSessionId || options.workspaceMode !== TASK_MODE || options.cwd !== taskProfile.working_directory) {
      throw new Error("task execution binding mismatch or resume forbidden");
    }
  } else if (options.workspaceMode === TASK_MODE) assertTaskProfile(null);
  const privateAutomationProfile = options.privateAutomationProfile || null;
  if (privateAutomationProfile != null) {
    if (privateAutomationProfile.id !== PRIVATE_AUTOMATION_PROFILE_ID) {
      throw new Error("invalid private automation profile");
    }
    if (privateAutomationProfile.provider !== provider) {
      throw new Error("private automation provider does not match process plan");
    }
    if (privateAutomationProfile.model !== options.model) {
      throw new Error("private automation model does not match process plan");
    }
    if (options.nativeSessionId != null) {
      throw new Error("private automation session resume is forbidden");
    }
  }
  const prompt = requiredText2(
    options.prompt,
    "prompt",
    privateAutomationProfile?.maxPromptBytes || MAX_PROMPT_BYTES
  );
  const cwd = requiredText2(options.cwd, "cwd", 4096);
  const binaryPath = requiredText2(options.binaryPath, "binaryPath", 4096);
  const requestedModel = options.model || config.models.default;
  const modelDefinition = getModelDef(config, requestedModel);
  if (!modelDefinition) {
    throw new Error(`Unknown model '${requestedModel}' for ${provider}. Run: rudi agent models ${provider}`);
  }
  const workspaceMode = options.workspaceMode;
  if (!["read-only", "worktree", "isolated-copy", TASK_MODE].includes(workspaceMode)) {
    throw new Error(`Unknown resolved workspace mode: ${workspaceMode}`);
  }
  return {
    binaryPath,
    config,
    cwd,
    extraArgs: validateExtraArgs(options.extraArgs),
    model: resolveModel(config, requestedModel),
    nativeSessionId: options.nativeSessionId == null ? null : requiredText2(options.nativeSessionId, "nativeSessionId", 1024),
    prompt,
    privateAutomationProfile,
    taskProfile,
    provider,
    runtimeDirectory: options.runtimeDirectory == null ? null : requiredText2(options.runtimeDirectory, "runtimeDirectory", 4096),
    workspaceMode
  };
}
function permissionArgs(context, requestedMode) {
  const defaultMode = context.workspaceMode === "read-only" ? READ_ONLY_PERMISSION[context.provider] : WRITABLE_PERMISSION[context.provider];
  const normalizedMode = PERMISSION_ALIASES[requestedMode] || requestedMode || defaultMode;
  const modes = context.config.headless.permissionModes || {};
  if (!modes[normalizedMode]) {
    throw new Error(
      `Unknown permission mode '${requestedMode || normalizedMode}' for ${context.provider}. Available: ${Object.keys(modes).join(", ")}`
    );
  }
  if (context.workspaceMode === "read-only" && normalizedMode !== READ_ONLY_PERMISSION[context.provider]) {
    throw new Error(`permission mode ${requestedMode || normalizedMode} is incompatible with read-only workspace mode`);
  }
  return { args: getPermissionArgs(context.config, normalizedMode), mode: normalizedMode };
}
function validateImages(images) {
  if (images == null) return [];
  if (!Array.isArray(images)) throw new Error("images must be an array of paths");
  return images.map((image, index) => requiredText2(image, `images[${index}]`, 4096));
}
function canonicalPath2(candidate) {
  const absolute = import_node_path10.default.resolve(candidate);
  try {
    return import_node_fs10.default.realpathSync(absolute);
  } catch {
    return absolute;
  }
}
function isInsidePath(root, candidate) {
  const child = import_node_path10.default.relative(root, candidate);
  return child === "" || child !== ".." && !child.startsWith(`..${import_node_path10.default.sep}`) && !import_node_path10.default.isAbsolute(child);
}
function rudiOwnedPathRoots(environment) {
  const home = environment.HOME || import_node_os5.default.homedir();
  return [
    import_node_path10.default.join(home, ".rudi"),
    environment.RUDI_HOME,
    process.env.RUDI_HOME
  ].filter((root) => typeof root === "string" && import_node_path10.default.isAbsolute(root)).flatMap((root) => [import_node_path10.default.resolve(root), canonicalPath2(root)]);
}
function isRudiOwnedPathEntry(entry, roots2) {
  if (typeof entry !== "string" || entry.length === 0) return false;
  const lexicalEntry = import_node_path10.default.resolve(entry);
  const canonicalEntry = canonicalPath2(entry);
  return roots2.some((root) => isInsidePath(root, lexicalEntry) || isInsidePath(root, canonicalEntry));
}
function buildAgentExecutableEnvironment(binaryPath, overrides = {}, baseEnvironment = process.env) {
  const merged = { ...baseEnvironment, ...overrides };
  const rudiRoots = rudiOwnedPathRoots(merged);
  const entries = [
    import_node_path10.default.dirname(binaryPath),
    ...String(merged.PATH || "").split(import_node_path10.default.delimiter)
  ].filter((entry) => entry && import_node_path10.default.isAbsolute(entry) && !isRudiOwnedPathEntry(entry, rudiRoots));
  merged.PATH = [...new Set(entries)].join(import_node_path10.default.delimiter);
  return merged;
}
var PRIVATE_OPERATIONAL_ENVIRONMENT_KEYS = Object.freeze([
  "HOME",
  "LANG",
  "LC_ALL",
  "LOGNAME",
  "PATH",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "TMPDIR",
  "USER"
]);
function buildPrivateProviderEnvironment(config, binaryPath, options = {}) {
  const baseEnvironment = options.baseEnvironment || process.env;
  const operational = Object.fromEntries(
    PRIVATE_OPERATIONAL_ENVIRONMENT_KEYS.filter((key) => typeof baseEnvironment[key] === "string" && baseEnvironment[key].length > 0).map((key) => [key, baseEnvironment[key]])
  );
  const providerEnvironment = buildProviderEnvironment(config, options);
  return buildAgentExecutableEnvironment(
    binaryPath,
    { ...operational, ...providerEnvironment },
    {}
  );
}
function buildProviderEnvironment(config, options = {}) {
  const baseEnvironment = options.baseEnvironment || process.env;
  const rudiHome = options.rudiHome || process.env.RUDI_HOME || import_node_path10.default.join(import_node_os5.default.homedir(), ".rudi");
  let storedSecrets = {};
  try {
    const parsed = JSON.parse(import_node_fs10.default.readFileSync(import_node_path10.default.join(rudiHome, "secrets.json"), "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      storedSecrets = Object.fromEntries(
        Object.entries(parsed).filter(([, value]) => typeof value === "string" && value.length > 0)
      );
    }
  } catch {
  }
  return buildEnv(config, { ...storedSecrets, ...baseEnvironment });
}
function finishPlan(context, args, permissionMode, providerEnvironment = null) {
  const resolvedProviderEnvironment = providerEnvironment || (context.privateAutomationProfile ? buildPrivateProviderEnvironment(context.config, context.binaryPath) : buildProviderEnvironment(context.config));
  const environment = context.privateAutomationProfile || context.taskProfile ? resolvedProviderEnvironment : buildAgentExecutableEnvironment(context.binaryPath, resolvedProviderEnvironment);
  return Object.freeze({
    args,
    environment,
    ...context.privateAutomationProfile ? {
      maxFinalOutputBytes: context.privateAutomationProfile.maxFinalOutputBytes,
      maxRawOutputBytes: context.privateAutomationProfile.maxRawOutputBytes,
      privateAutomationProfile: context.privateAutomationProfile,
      stdin: context.prompt
    } : {},
    ...context.taskProfile ? { taskProfile: context.taskProfile, stdin: context.prompt, maxRawOutputBytes: 8 * 1024 * 1024 } : {},
    model: context.model,
    permissionMode,
    provider: context.provider,
    spawn: Object.freeze({ command: context.binaryPath, cwd: context.cwd }),
    timeouts: Object.freeze({ ...context.config.headless.timeouts })
  });
}

// src/agent-host/providers/antigravity.js
function buildAntigravityPlan(options) {
  const context = providerContext(options, "antigravity");
  const images = validateImages(options.images);
  if (images.length > 0) {
    throw new Error("Antigravity image attachments require provider-specific arguments after --");
  }
  if (options.approvalMode != null) {
    throw new Error("Antigravity does not support --approval-mode; use --permission-mode");
  }
  const permission = permissionArgs(context, options.permissionMode);
  const args = buildArgs(context.config, {
    conversation: context.nativeSessionId,
    model: context.model,
    prompt: context.prompt
  });
  args.push(...permission.args, ...context.extraArgs);
  return finishPlan(context, args, permission.mode);
}

// src/agent-host/task-claude-sandbox.js
var import_node_fs11 = __toESM(require("node:fs"), 1);
var import_node_os6 = __toESM(require("node:os"), 1);
var import_node_path11 = __toESM(require("node:path"), 1);
function claudeSandboxPolicy(binaryPath, profile, temporaryDirectory, homeDirectory = import_node_os6.default.homedir()) {
  const account = profile.account;
  if (!account) throw new Error("Claude sandbox requires an explicit account");
  const read2 = [
    "/System",
    "/usr/lib",
    "/usr/bin",
    "/usr/sbin",
    "/usr/share",
    "/bin",
    "/sbin",
    "/dev",
    "/Library/Apple",
    "/Library/Preferences",
    "/private/etc",
    "/private/var/db/timezone",
    `/private/var/db/mds/messages/${process.getuid()}`,
    binaryPath,
    account.config_directory,
    account.anthropic_directory,
    temporaryDirectory,
    ...profile.read_roots,
    ...profile.write_roots
  ];
  const write = [account.config_directory, account.anthropic_directory, temporaryDirectory, ...profile.write_roots];
  if (profile.access_mode === "trusted") {
    const localRuntime = import_node_path11.default.join(homeDirectory, ".rudi");
    read2.push("/opt/homebrew", "/usr/local", import_node_path11.default.join(homeDirectory, ".local"), localRuntime);
    write.push(localRuntime);
  }
  const subpaths = (values) => [...new Set(values)].map((value) => `(subpath ${JSON.stringify(value)})`).join("");
  const directories = /* @__PURE__ */ new Set([
    "/",
    import_node_path11.default.dirname(binaryPath),
    import_node_path11.default.dirname(account.config_directory),
    import_node_path11.default.join(homeDirectory, ".CFUserTextEncoding")
  ]);
  for (let cursor = homeDirectory; cursor !== import_node_path11.default.dirname(cursor); cursor = import_node_path11.default.dirname(cursor)) directories.add(cursor);
  return `(version 1)(allow default)(deny system-audit)(deny signal)(allow signal (target self))(deny file-read-data)(deny file-write*)(allow file-read-data ${subpaths(read2)}${[...directories].map((value) => `(literal ${JSON.stringify(value)})`).join("")})(allow file-write* (literal "/dev/null")${subpaths(write)})`;
}
function claudeSandboxPlan(context, plan) {
  const temporaryDirectory = import_node_path11.default.join(canonicalDirectory(context.runtimeDirectory, "Claude runtime"), "native-tmp");
  import_node_fs11.default.mkdirSync(temporaryDirectory, { mode: 448 });
  canonicalDirectory(temporaryDirectory, "Claude temporary directory");
  return Object.freeze({
    ...plan,
    args: ["-p", claudeSandboxPolicy(context.binaryPath, context.taskProfile, temporaryDirectory), context.binaryPath, ...plan.args],
    spawn: Object.freeze({ command: "/usr/bin/sandbox-exec", cwd: context.cwd }),
    environment: { ...plan.environment, TMPDIR: temporaryDirectory, CLAUDE_CODE_TMPDIR: temporaryDirectory }
  });
}

// src/agent-host/task-claude.js
var import_node_path12 = __toESM(require("node:path"), 1);
var import_node_child_process8 = require("node:child_process");
function taskClaudeArgs(context) {
  const profile = context.taskProfile;
  if (profile.access_mode === "trusted") return trustedClaudeArgs(context);
  if (profile.network !== "disabled") throw new Error("Claude task requires disabled tool network");
  const roots2 = [.../* @__PURE__ */ new Set([...profile.read_roots, ...profile.write_roots])];
  if (roots2.some((root) => /[(){}!,\\]/u.test(root))) throw new Error("Claude task root cannot be represented as a literal permission rule");
  const settings = {
    permissions: {
      defaultMode: "dontAsk",
      blockReadsOutsideWorkingDirectories: true,
      allow: profile.write_roots.flatMap((root) => [`Write(/${root}/**)`, `Edit(/${root}/**)`])
    },
    disableAllHooks: true
  };
  return [
    "--print",
    "--verbose",
    "--output-format",
    "stream-json",
    "--input-format",
    "text",
    "--model",
    context.model,
    "--safe-mode",
    "--restricted",
    ...profile.reasoning_effort !== void 0 ? ["--effort", profile.reasoning_effort] : [],
    "--no-chrome",
    "--disable-slash-commands",
    "--tools",
    "Read,Write,Edit",
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
    "--setting-sources",
    "",
    "--permission-mode",
    "dontAsk",
    "--settings",
    JSON.stringify(settings),
    ...roots2.flatMap((root) => ["--add-dir", root])
  ];
}
function trustedClaudeArgs({ taskProfile: profile, model }) {
  const roots2 = [.../* @__PURE__ */ new Set([...profile.read_roots, ...profile.write_roots])];
  return [
    "--print",
    "--verbose",
    "--output-format",
    "stream-json",
    "--input-format",
    "text",
    "--model",
    model,
    ...profile.reasoning_effort !== void 0 ? ["--effort", profile.reasoning_effort] : [],
    "--tools",
    "default",
    "--permission-mode",
    "bypassPermissions",
    "--permission-prompts",
    "none",
    "--settings",
    JSON.stringify({ disableAllHooks: true }),
    "--mcp-config",
    JSON.stringify({ mcpServers: { rudi: { command: taskRouter(), args: [] } } }),
    ...roots2.flatMap((root) => ["--add-dir", root])
  ];
}
function taskClaudeEnvironment(binaryPath, profile = null) {
  const environment = {
    PATH: `${import_node_path12.default.dirname(binaryPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    CLAUDE_CODE_NO_MODEL_FALLBACK: "1"
  };
  if (profile?.access_mode === "trusted") environment.PATH = trustedTaskPath(binaryPath);
  for (const key of ["HOME", "USER", "LOGNAME", "LANG", "LC_ALL"]) {
    if (typeof process.env[key] === "string") environment[key] = process.env[key];
  }
  if (profile?.account) {
    environment.CLAUDE_CONFIG_DIR = profile.account.config_directory;
    environment.ANTHROPIC_CONFIG_DIR = profile.account.anthropic_directory;
  }
  return environment;
}
function inspectClaudeTaskSeat(binaryPath, { spawnSyncImpl = import_node_child_process8.spawnSync, profile = null } = {}) {
  const result = spawnSyncImpl(binaryPath, ["auth", "status"], {
    encoding: "utf8",
    timeout: 5e3,
    maxBuffer: 65536,
    env: taskClaudeEnvironment(binaryPath, profile)
  });
  let status;
  try {
    status = JSON.parse(result.stdout);
  } catch {
  }
  if (result.error || result.status !== 0 || status?.loggedIn !== true || status.authMethod !== "claude.ai" || status.apiProvider !== "firstParty") {
    throw new Error("native Claude authenticated first-party seat required; run claude auth login on this host");
  }
  let account;
  if (profile?.account) {
    const expected = profile.account;
    if (status.email !== expected.email || status.orgId !== expected.organization_id || status.configDirectory !== expected.config_directory || status.projectsDirectory !== import_node_path12.default.join(expected.config_directory, "projects")) {
      throw new Error("native Claude account does not match the pinned execution profile");
    }
    account = Object.freeze({ ...expected, projects_directory: status.projectsDirectory });
  }
  return { authenticated: true, authMethod: "claude.ai", apiProvider: "firstParty", ...account ? { account } : {} };
}

// src/agent-host/providers/claude.js
function buildClaudePlan(options) {
  const context = providerContext(options, "claude");
  if (context.taskProfile) {
    if ((options.extraArgs || []).length || (options.images || []).length || options.approvalMode != null || options.permissionMode != null || options.privateAutomationProfile) {
      throw new Error("task execution forbids permission overrides, images, private profiles and passthrough arguments");
    }
    return claudeSandboxPlan(context, finishPlan(context, taskClaudeArgs(context), "registered-shared", taskClaudeEnvironment(context.binaryPath, context.taskProfile)));
  }
  if (context.privateAutomationProfile) {
    if ((options.extraArgs || []).length > 0 || (options.images || []).length > 0) {
      throw new Error("private automation forbids Claude passthrough arguments and images");
    }
    if (options.approvalMode != null) {
      throw new Error("private automation forbids Claude approval overrides");
    }
    if (options.permissionMode != null && options.permissionMode !== "plan") {
      throw new Error("private automation requires Claude plan permission mode");
    }
    const args2 = [
      "--output-format",
      "stream-json",
      "--verbose",
      "--print",
      "--input-format",
      "text",
      "--model",
      context.model,
      "--no-session-persistence",
      "--safe-mode",
      "--no-chrome",
      "--disable-slash-commands",
      "--tools",
      "",
      "--strict-mcp-config",
      "--mcp-config",
      '{"mcpServers":{}}',
      "--setting-sources",
      "",
      "--permission-mode",
      "plan"
    ];
    const environment = buildPrivateProviderEnvironment(
      context.config,
      context.binaryPath
    );
    return finishPlan(context, args2, "plan", {
      ...environment,
      CLAUDE_CODE_AUTO_MODE_MODEL: context.model,
      CLAUDE_CODE_BG_CLASSIFIER_MODEL: context.model,
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
      CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
      CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1",
      CLAUDE_CODE_DISABLE_CLAUDE_API_SKILL: "1",
      CLAUDE_CODE_DISABLE_CLAUDE_CODE_SKILL: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      CLAUDE_CODE_DISABLE_WORKFLOWS: "1",
      CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: "0",
      CLAUDE_CODE_ENABLE_TELEMETRY: "0",
      CLAUDE_CODE_NO_MODEL_FALLBACK: "1",
      CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT: "1",
      CLAUDE_CODE_SUBAGENT_MODEL: context.model
    });
  }
  const images = validateImages(options.images);
  if (images.length > 0) {
    throw new Error("Claude local image attachments are not exposed as a headless CLI flag; reference a readable workspace file in the prompt");
  }
  const permission = permissionArgs(context, options.permissionMode);
  const args = buildArgs(context.config, {
    model: context.model,
    print: true,
    prompt: context.prompt,
    resumeSessionId: context.nativeSessionId
  });
  args.push(...permission.args, ...context.extraArgs);
  return finishPlan(context, args, permission.mode);
}

// src/agent-host/providers/codex.js
var APPROVAL_ALIASES = Object.freeze({
  onRequest: "on-request",
  "on-request": "on-request",
  never: "never",
  untrusted: "untrusted"
});
function approvalPolicy(value) {
  if (value == null) return null;
  const normalized = APPROVAL_ALIASES[value];
  if (!normalized) {
    throw new Error("Unknown approval mode for codex. Available: untrusted, on-request, never");
  }
  return normalized;
}
function buildCodexPlan(options) {
  const context = providerContext(options, "codex");
  if (context.taskProfile) {
    if ((options.extraArgs || []).length || (options.images || []).length || options.approvalMode || options.permissionMode) {
      throw new Error("task execution forbids permission overrides, images and passthrough arguments");
    }
    return finishPlan(context, taskCodexArgs(context), "registered-shared", taskEnvironment(context.binaryPath, context.taskProfile));
  }
  if (context.privateAutomationProfile) {
    if ((options.extraArgs || []).length > 0 || (options.images || []).length > 0) {
      throw new Error("private automation forbids Codex passthrough arguments and images");
    }
    if (options.approvalMode != null && options.approvalMode !== "never") {
      throw new Error("private automation requires Codex approval mode never");
    }
    if (options.permissionMode != null && !["readonly", "read-only"].includes(options.permissionMode)) {
      throw new Error("private automation requires Codex read-only sandbox");
    }
    const disabledFeatures = getPrivateCodexDisabledFeatures();
    const args2 = ["--ask-for-approval", "never"];
    for (const feature of disabledFeatures) args2.push("--disable", feature);
    args2.push(
      "-c",
      "mcp_servers={}",
      "-c",
      'web_search="disabled"',
      "exec",
      "-",
      "--json",
      "--skip-git-repo-check",
      "--color",
      "never",
      "-C",
      context.cwd,
      "-m",
      context.model,
      "--output-schema",
      context.privateAutomationProfile.outputSchema.path,
      "--ephemeral",
      "--strict-config",
      "--ignore-user-config",
      "--ignore-rules",
      "-s",
      "read-only"
    );
    return finishPlan(context, args2, "readonly");
  }
  const images = validateImages(options.images);
  const permission = permissionArgs(context, options.permissionMode);
  const approval = approvalPolicy(options.approvalMode);
  let args;
  if (context.nativeSessionId) {
    args = [];
    if (approval) args.push("--ask-for-approval", approval);
    args.push("-C", context.cwd, "-m", context.model, ...permission.args);
    args.push(...buildSubcommandArgs(context.config, "resume", {
      image: images.length === 1 ? images[0] : null,
      prompt: context.prompt,
      sessionId: context.nativeSessionId
    }));
    for (const image of images.slice(1)) args.push("-i", image);
    args.push("--json", ...context.extraArgs);
  } else {
    args = buildArgs(context.config, {
      approvalPolicy: approval,
      cwd: context.cwd,
      image: images.length > 0 ? images : null,
      model: context.model,
      prompt: context.prompt
    });
    args.push(...permission.args, ...context.extraArgs);
  }
  return finishPlan(context, args, permission.mode);
}

// src/agent-host/providers/gemini.js
var import_node_fs12 = __toESM(require("node:fs"), 1);
var import_node_path13 = __toESM(require("node:path"), 1);
function defaultSystemSettingsPath(platform = process.platform) {
  if (platform === "darwin") return "/Library/Application Support/GeminiCli/settings.json";
  if (platform === "win32") return "C:\\ProgramData\\gemini-cli\\settings.json";
  return "/etc/gemini-cli/settings.json";
}
function buildGeminiProviderEnvironment(config, options = {}) {
  const baseEnvironment = options.baseEnvironment || process.env;
  const environment = buildProviderEnvironment(config, options);
  if (!environment.GEMINI_API_KEY || !options.runtimeDirectory) return environment;
  if (baseEnvironment.GEMINI_CLI_SYSTEM_SETTINGS_PATH) return environment;
  const systemSettingsPath = options.systemSettingsPath || defaultSystemSettingsPath(options.platform);
  if (import_node_fs12.default.existsSync(systemSettingsPath)) return environment;
  const settingsPath = import_node_path13.default.join(options.runtimeDirectory, "gemini-system-settings.json");
  import_node_fs12.default.writeFileSync(settingsPath, JSON.stringify({
    security: { auth: { selectedType: "gemini-api-key" } }
  }, null, 2), { encoding: "utf8", mode: 384 });
  return {
    ...environment,
    GEMINI_CLI_SYSTEM_SETTINGS_PATH: settingsPath
  };
}
function buildGeminiPlan(options) {
  const context = providerContext(options, "gemini");
  const images = validateImages(options.images);
  if (images.length > 0) {
    throw new Error("Gemini image attachments require provider-specific arguments after --");
  }
  if (options.approvalMode != null) {
    throw new Error("Gemini does not support --approval-mode; use --permission-mode");
  }
  const permission = permissionArgs(context, options.permissionMode);
  const args = buildArgs(context.config, {
    model: context.model,
    prompt: context.prompt,
    resume: context.nativeSessionId,
    skipTrust: true
  });
  args.push(...permission.args, ...context.extraArgs);
  const providerEnvironment = buildGeminiProviderEnvironment(context.config, {
    runtimeDirectory: context.runtimeDirectory
  });
  return finishPlan(context, args, permission.mode, providerEnvironment);
}

// src/agent-host/providers/index.js
var PUBLIC_PROVIDERS = Object.freeze(["claude", "codex", "antigravity", "gemini"]);
var PROVIDER_ALIASES = Object.freeze({ google: "antigravity" });
var BUILDERS = Object.freeze({
  antigravity: buildAntigravityPlan,
  claude: buildClaudePlan,
  codex: buildCodexPlan,
  gemini: buildGeminiPlan
});
function resolveAgentProviderId(provider) {
  if (typeof provider !== "string" || provider.trim() === "") {
    throw new Error(`Agent provider is required. Available: ${PUBLIC_PROVIDERS.join(", ")} (google aliases antigravity)`);
  }
  const normalized = provider.trim().toLowerCase();
  const canonical = PROVIDER_ALIASES[normalized] || normalized;
  if (!listProviders().includes(canonical)) {
    throw new Error(`Unknown agent provider: ${provider}. Available: ${PUBLIC_PROVIDERS.join(", ")} (google aliases antigravity)`);
  }
  return canonical;
}
function getAgentProviderConfig(provider) {
  return loadProviderConfig(resolveAgentProviderId(provider));
}
function resolveAgentProviderBinary(provider) {
  return resolveProviderBinary(getAgentProviderConfig(provider));
}
function getMissingAgentProviderMessage(provider) {
  const config = getAgentProviderConfig(provider);
  return `Vendor-managed ${config.name} CLI was not found. Install it with the provider's supported installer, then verify discovery with: rudi agent hosts --json`;
}
function buildProviderProcessPlan(options) {
  const provider = resolveAgentProviderId(options?.provider);
  return BUILDERS[provider]({ ...options, provider });
}

// src/native-skills/lifecycle.js
var import_node_crypto3 = __toESM(require("node:crypto"), 1);

// packages/core/src/index.js
init_src();

// node_modules/.pnpm/@learnrudi+env@1.0.0/node_modules/@learnrudi/env/src/index.js
var import_path3 = __toESM(require("path"), 1);
var import_os3 = __toESM(require("os"), 1);
var RUDI_HOME2 = import_path3.default.join(import_os3.default.homedir(), ".rudi");
var PATHS2 = {
  // Root
  home: RUDI_HOME2,
  // Installed packages - shared with Studio for unified discovery
  packages: import_path3.default.join(RUDI_HOME2, "packages"),
  stacks: import_path3.default.join(RUDI_HOME2, "stacks"),
  // Shared with Studio
  prompts: import_path3.default.join(RUDI_HOME2, "prompts"),
  // Shared with Studio
  // Runtimes (interpreters: node, python, deno, bun)
  runtimes: import_path3.default.join(RUDI_HOME2, "runtimes"),
  // Binaries (utility CLIs: ffmpeg, imagemagick, ripgrep, etc.)
  binaries: import_path3.default.join(RUDI_HOME2, "binaries"),
  // Agents (AI CLI tools: claude, codex, gemini, copilot, ollama)
  agents: import_path3.default.join(RUDI_HOME2, "agents"),
  // Runtime binaries (content-addressed)
  store: import_path3.default.join(RUDI_HOME2, "store"),
  // Shims (symlinks to store/)
  bins: import_path3.default.join(RUDI_HOME2, "bins"),
  // Lockfiles
  locks: import_path3.default.join(RUDI_HOME2, "locks"),
  // Secrets (OS Keychain preferred, encrypted file fallback)
  vault: import_path3.default.join(RUDI_HOME2, "vault"),
  // Database (shared with Studio)
  db: RUDI_HOME2,
  dbFile: import_path3.default.join(RUDI_HOME2, "rudi.db"),
  // Cache
  cache: import_path3.default.join(RUDI_HOME2, "cache"),
  registryCache: import_path3.default.join(RUDI_HOME2, "cache", "registry.json"),
  // Config
  config: import_path3.default.join(RUDI_HOME2, "config.json"),
  // Logs
  logs: import_path3.default.join(RUDI_HOME2, "logs")
};

// packages/registry-client/src/index.js
var CACHE_TTL = 60 * 60 * 1e3;

// packages/core/src/resolver.js
init_src();

// packages/core/src/lockfile.js
var import_yaml = __toESM(require_dist(), 1);
init_src();

// packages/core/src/resolver.js
init_npm_runtime();

// packages/core/src/package-metadata.js
var import_yaml2 = __toESM(require_dist(), 1);

// packages/core/src/installer.js
init_src();
init_shims();
init_npm_runtime();

// packages/core/src/skill-install.js
var import_yaml3 = __toESM(require_dist(), 1);
init_src();

// packages/core/src/deps.js
init_src();

// packages/core/src/rudi-config.js
var path17 = __toESM(require("path"), 1);
init_src();
var RUDI_JSON_PATH = path17.join(RUDI_HOME, "rudi.json");
var RUDI_JSON_TMP = path17.join(RUDI_HOME, "rudi.json.tmp");
var RUDI_JSON_LOCK = path17.join(RUDI_HOME, "rudi.json.lock");

// packages/core/src/tool-index.js
var path18 = __toESM(require("path"), 1);
init_src();
var TOOL_INDEX_PATH = path18.join(RUDI_HOME, "cache", "tool-index.json");
var TOOL_INDEX_TMP = path18.join(RUDI_HOME, "cache", "tool-index.json.tmp");
var SECRETS_PATH = path18.join(RUDI_HOME, "secrets.json");
var WINDOWS_DESCENDANT_SWEEP_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$rootProcessId = 0
$notBeforeMs = 0L
$rootProcessIdText = [Environment]::GetEnvironmentVariable('RUDI_TOOL_INDEX_SWEEP_ROOT_PID')
$notBeforeText = [Environment]::GetEnvironmentVariable('RUDI_TOOL_INDEX_SWEEP_NOT_BEFORE_MS')
if (-not [int]::TryParse($rootProcessIdText, [ref]$rootProcessId)) { exit 2 }
if (-not [long]::TryParse($notBeforeText, [ref]$notBeforeMs)) { exit 2 }
$force = [Environment]::GetEnvironmentVariable('RUDI_TOOL_INDEX_SWEEP_MODE') -eq 'force'
$notBefore = [DateTimeOffset]::FromUnixTimeMilliseconds($notBeforeMs).UtcDateTime
$pending = [System.Collections.Generic.Queue[int]]::new()
$visited = [System.Collections.Generic.HashSet[int]]::new()
$descendants = [System.Collections.Generic.List[int]]::new()
$pending.Enqueue($rootProcessId)
$visited.Add($rootProcessId) | Out-Null
while ($pending.Count -gt 0) {
  $parentProcessId = $pending.Dequeue()
  Get-CimInstance Win32_Process -Filter "ParentProcessId = $parentProcessId" | ForEach-Object {
    $childProcessId = [int]$_.ProcessId
    $createdAt = $_.CreationDate.ToUniversalTime()
    if ($createdAt -ge $notBefore -and $visited.Add($childProcessId)) {
      $descendants.Add($childProcessId)
      $pending.Enqueue($childProcessId)
    }
  }
}
for ($index = $descendants.Count - 1; $index -ge 0; $index -= 1) {
  Stop-Process -Id $descendants[$index] -Force:$force
}
`.trim();

// packages/core/src/index.js
init_shims();

// packages/core/src/system-registry.js
init_src();
init_shims();

// packages/secrets/src/index.js
var path19 = __toESM(require("path"), 1);
init_src();
var SECRETS_FILE = path19.join(PATHS.home, "secrets.json");

// src/native-skills/lifecycle.js
var fsp = __toESM(require("node:fs/promises"), 1);
var import_node_os7 = __toESM(require("node:os"), 1);
var import_node_path14 = __toESM(require("node:path"), 1);

// src/native-skills/policy.js
var NATIVE_SKILL_HOSTS = Object.freeze(["codex", "claude", "gemini", "antigravity"]);

// src/native-skills/lifecycle.js
var RESOURCE_DIRECTORIES = Object.freeze(["assets", "references", "scripts"]);
var RECEIPT_SCHEMA_VERSION = 3;
var DIGEST_PATTERN = /^[a-f0-9]{64}$/;
var SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
var TRUSTED_PLATFORM_SYMLINKS = new Set(
  process.platform === "darwin" ? ["/etc", "/tmp", "/var"] : []
);
function sha2562(value) {
  return import_node_crypto3.default.createHash("sha256").update(value).digest("hex");
}
function assertSupportedHost(host) {
  if (!NATIVE_SKILL_HOSTS.includes(host)) {
    throw new Error(`Unsupported native skill host: ${host}`);
  }
}
function taskHome(options = {}) {
  return import_node_path14.default.resolve(options.homeDir || options.env?.HOME || import_node_os7.default.homedir());
}
function getNativeSkillRoot(host, options = {}) {
  assertSupportedHost(host);
  const env = options.env || process.env;
  const home = taskHome(options);
  if (host === "codex") {
    return import_node_path14.default.join(import_node_path14.default.resolve(env.CODEX_HOME || import_node_path14.default.join(home, ".codex")), "skills");
  }
  if (host === "claude") {
    return import_node_path14.default.join(import_node_path14.default.resolve(env.CLAUDE_HOME || import_node_path14.default.join(home, ".claude")), "skills");
  }
  if (host === "gemini") {
    return import_node_path14.default.join(import_node_path14.default.resolve(env.GEMINI_HOME || import_node_path14.default.join(home, ".gemini")), "skills");
  }
  return import_node_path14.default.join(
    import_node_path14.default.resolve(env.ANTIGRAVITY_HOME || import_node_path14.default.join(home, ".gemini", "antigravity-cli")),
    "skills"
  );
}
function getNativeSkillReceiptRoot(options = {}) {
  const env = options.env || process.env;
  const rudiHome = import_node_path14.default.resolve(env.RUDI_HOME || import_node_path14.default.join(taskHome(options), ".rudi"));
  return import_node_path14.default.join(rudiHome, "state", "native-skills");
}
function safeRelativePath(relativePath) {
  if (!relativePath || import_node_path14.default.isAbsolute(relativePath) || relativePath.includes("\0") || relativePath.split(import_node_path14.default.sep).some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`Unsafe native skill resource path: ${relativePath}`);
  }
  return relativePath;
}
function assertRealEntry(stat, entryPath, expected) {
  if (stat.isSymbolicLink()) {
    throw new Error(`Native skill resources cannot contain symbolic links: ${entryPath}`);
  }
  if (expected === "file" && !stat.isFile()) {
    throw new Error(`Native skill resource must be a regular file: ${entryPath}`);
  }
  if (expected === "directory" && !stat.isDirectory()) {
    throw new Error(`Native skill resource must be a directory: ${entryPath}`);
  }
}
async function assertNoSymlinkPathComponents(candidate, label, options = {}) {
  const absolute = import_node_path14.default.resolve(candidate);
  const parsed = import_node_path14.default.parse(absolute);
  const segments = absolute.slice(parsed.root.length).split(import_node_path14.default.sep).filter(Boolean);
  let current = parsed.root;
  for (let index = 0; index < segments.length; index += 1) {
    current = import_node_path14.default.join(current, segments[index]);
    let stat;
    try {
      stat = await fsp.lstat(current);
    } catch (error) {
      if (error.code === "ENOENT" && options.allowMissingTail === true) return;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      if (!TRUSTED_PLATFORM_SYMLINKS.has(current)) {
        throw new Error(`${label} cannot contain symbolic links: ${current}`);
      }
      continue;
    }
    if (index < segments.length - 1 && !stat.isDirectory()) {
      throw new Error(`${label} ancestor must be a real directory: ${current}`);
    }
  }
}
async function assertSafeRoot(root, label) {
  await assertNoSymlinkPathComponents(root, label, { allowMissingTail: true });
  try {
    const stat = await fsp.lstat(root);
    assertRealEntry(stat, root, "directory");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
function manifestEntry(entry) {
  if (entry.type === "directory") {
    return { path: entry.relativePath, type: entry.type, mode: entry.mode };
  }
  return {
    path: entry.relativePath,
    type: entry.type,
    mode: entry.mode,
    size: entry.content.length,
    digest: sha2562(entry.content)
  };
}
function digestEntries(entries) {
  const manifest = entries.map(manifestEntry).sort((a, b) => a.path.localeCompare(b.path));
  return { manifest, digest: sha2562(JSON.stringify(manifest)) };
}
async function inspectTree(root) {
  const entries = [];
  let stat;
  try {
    stat = await fsp.lstat(root);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  assertRealEntry(stat, root, "directory");
  async function walk(directory, relativeDirectory = "") {
    const children = await fsp.readdir(directory, { withFileTypes: true });
    children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      const childPath = import_node_path14.default.join(directory, child.name);
      const relativePath = safeRelativePath(
        relativeDirectory ? import_node_path14.default.join(relativeDirectory, child.name) : child.name
      );
      const childStat = await fsp.lstat(childPath);
      if (childStat.isSymbolicLink()) {
        throw new Error(`Native skill trees cannot contain symbolic links: ${childPath}`);
      }
      if (childStat.isDirectory()) {
        entries.push({
          type: "directory",
          relativePath,
          mode: childStat.mode & 511
        });
        await walk(childPath, relativePath);
      } else if (childStat.isFile()) {
        entries.push({
          type: "file",
          relativePath,
          mode: childStat.mode & 511,
          content: await fsp.readFile(childPath)
        });
      } else {
        throw new Error(`Unsupported native skill tree entry: ${childPath}`);
      }
    }
  }
  await walk(root);
  return digestEntries(entries);
}
async function assertTargetOwnership(receiptRoot, host, skillId, targetDir) {
  const directory = import_node_path14.default.join(receiptRoot, host);
  await assertSafeRoot(directory, "Native skill receipt directory");
  let names;
  try {
    names = await fsp.readdir(directory);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const name of names.filter((name2) => name2.endsWith(".json"))) {
    const packageName = name.slice(0, -5);
    if (!SKILL_NAME_PATTERN.test(packageName)) throw new Error(`Invalid receipt name: ${name}`);
    if (`skill:${packageName}` === skillId) continue;
    const receipt = await readReceipt(import_node_path14.default.join(directory, name), { host, skillId: `skill:${packageName}` });
    if (receipt?.targetDir === targetDir) {
      throw new Error(`Native skill target already owned by ${receipt.skillId}: ${targetDir}`);
    }
  }
}
function isIsoTimestamp(value) {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}
function validateReceipt(receipt, expected = {}) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    throw new Error("Native skill receipt must be an object");
  }
  if (![2, RECEIPT_SCHEMA_VERSION].includes(receipt.schemaVersion)) {
    throw new Error(`Unsupported native skill receipt schema: ${receipt.schemaVersion}`);
  }
  if (!NATIVE_SKILL_HOSTS.includes(receipt.host)) {
    throw new Error(`Invalid native skill receipt host: ${receipt.host}`);
  }
  if (!String(receipt.skillId || "").startsWith("skill:") || !SKILL_NAME_PATTERN.test(receipt.skillId.slice(6))) {
    throw new Error("Invalid native skill receipt skillId");
  }
  if (!SKILL_NAME_PATTERN.test(receipt.skillName || "")) {
    throw new Error("Invalid native skill receipt skillName");
  }
  if (receipt.schemaVersion === 2 && receipt.skillId !== `skill:${receipt.skillName}`) {
    throw new Error("Native skill receipt id/name mismatch");
  }
  if (typeof receipt.packageVersion !== "string" || !receipt.packageVersion.trim()) {
    throw new Error("Invalid native skill receipt packageVersion");
  }
  if (receipt.sourceIdentity !== null && (typeof receipt.sourceIdentity !== "string" || !receipt.sourceIdentity.trim())) {
    throw new Error("Invalid native skill receipt sourceIdentity");
  }
  if (!DIGEST_PATTERN.test(receipt.sourceDigest || "")) {
    throw new Error("Invalid native skill receipt sourceDigest");
  }
  if (!DIGEST_PATTERN.test(receipt.packageDigest || "")) {
    throw new Error("Invalid native skill receipt packageDigest");
  }
  if (!DIGEST_PATTERN.test(receipt.renderedTreeDigest || "")) {
    throw new Error("Invalid native skill receipt renderedTreeDigest");
  }
  if (typeof receipt.targetDir !== "string" || import_node_path14.default.resolve(receipt.targetDir) !== receipt.targetDir) {
    throw new Error("Invalid native skill receipt targetDir");
  }
  if (!isIsoTimestamp(receipt.createdAt) || !isIsoTimestamp(receipt.updatedAt)) {
    throw new Error("Invalid native skill receipt timestamps");
  }
  if (receipt.createdAt > receipt.updatedAt) {
    throw new Error("Invalid native skill receipt timestamp order");
  }
  if (expected.host && receipt.host !== expected.host) {
    throw new Error(`Native skill receipt host mismatch: ${receipt.host}`);
  }
  if (expected.skillId && receipt.skillId !== expected.skillId) {
    throw new Error(`Native skill receipt skill mismatch: ${receipt.skillId}`);
  }
  if (expected.skillName && receipt.skillName !== expected.skillName) {
    throw new Error(`Native skill receipt name mismatch: ${receipt.skillName}`);
  }
  if (expected.targetDir && receipt.targetDir !== import_node_path14.default.resolve(expected.targetDir)) {
    throw new Error(`Native skill receipt target mismatch: ${receipt.targetDir}`);
  }
  return receipt;
}
async function readReceipt(receiptPath, expected = {}) {
  await assertNoSymlinkPathComponents(receiptPath, "Native skill receipt path", {
    allowMissingTail: true
  });
  let stat;
  try {
    stat = await fsp.lstat(receiptPath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  assertRealEntry(stat, receiptPath, "file");
  let receipt;
  try {
    receipt = JSON.parse(await fsp.readFile(receiptPath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid native skill receipt ${receiptPath}: ${error.message}`);
  }
  return validateReceipt(receipt, expected);
}
async function summarizeNativeSkillHost(host, options = {}) {
  assertSupportedHost(host);
  const targetRoot = import_node_path14.default.resolve(options.targetRoot || getNativeSkillRoot(host, options));
  const receiptRoot = import_node_path14.default.resolve(options.receiptRoot || getNativeSkillReceiptRoot(options));
  try {
    await assertSafeRoot(targetRoot, "Native skill target root");
    await assertSafeRoot(receiptRoot, "Native skill receipt root");
  } catch (error) {
    return {
      current: 0,
      drifted: 0,
      missing: 0,
      failed: 1,
      totalManaged: 0,
      skillsSynchronized: false,
      error: error.message
    };
  }
  const hostReceiptRoot = import_node_path14.default.join(receiptRoot, host);
  const summary = { current: 0, drifted: 0, missing: 0, failed: 0, totalManaged: 0 };
  let names;
  try {
    const stat = await fsp.lstat(hostReceiptRoot);
    assertRealEntry(stat, hostReceiptRoot, "directory");
    names = (await fsp.readdir(hostReceiptRoot)).filter((name) => name.endsWith(".json")).sort();
  } catch (error) {
    if (error.code === "ENOENT") return { ...summary, skillsSynchronized: false };
    return { ...summary, failed: 1, skillsSynchronized: false, error: error.message };
  }
  for (const name of names) {
    try {
      const packageName = name.slice(0, -".json".length);
      if (!SKILL_NAME_PATTERN.test(packageName)) throw new Error(`Invalid receipt name: ${name}`);
      const receipt = await readReceipt(import_node_path14.default.join(hostReceiptRoot, name), {
        host,
        skillId: `skill:${packageName}`
      });
      const targetDir = import_node_path14.default.join(targetRoot, receipt.skillName);
      validateReceipt(receipt, { targetDir });
      await assertTargetOwnership(receiptRoot, host, receipt.skillId, targetDir);
      const actual = await inspectTree(targetDir);
      summary.totalManaged += 1;
      if (!actual) summary.missing += 1;
      else if (actual.digest === receipt.renderedTreeDigest) summary.current += 1;
      else summary.drifted += 1;
    } catch {
      summary.failed += 1;
    }
  }
  return {
    ...summary,
    skillsSynchronized: summary.totalManaged > 0 && summary.current === summary.totalManaged && summary.failed === 0
  };
}

// src/agent-host/preflight.js
var MCP_AGENT_IDS = Object.freeze({ claude: "claude-code" });
function commandArgs(configuredCommand) {
  return Array.isArray(configuredCommand) ? configuredCommand.slice(1) : [];
}
function runCheck(binaryPath, args, spawnSyncImpl, timeout = 5e3) {
  const result = spawnSyncImpl(binaryPath, args, {
    encoding: "utf8",
    env: buildAgentExecutableEnvironment(binaryPath),
    timeout
  });
  return {
    ok: !result.error && result.status === 0,
    output: String(result.stdout || result.stderr || "").trim().slice(0, 512)
  };
}
function hasRudiRouter(provider) {
  const agentId = MCP_AGENT_IDS[provider] || provider;
  const config = AGENT_CONFIGS.find((item) => item.id === agentId);
  if (!config) return false;
  return readAgentMcpServers(config).some((server) => server.name === "rudi" || import_node_path15.default.basename(String(server.command)) === "rudi-router");
}
async function inspectAgentHost(provider, dependencies = {}) {
  const { spawnSyncImpl = import_node_child_process9.spawnSync } = dependencies;
  const canonicalProvider = resolveAgentProviderId(provider);
  const summarizeSkills = dependencies.summarizeNativeSkillHostImpl || summarizeNativeSkillHost;
  let skillProjection;
  try {
    skillProjection = await summarizeSkills(canonicalProvider);
  } catch (error) {
    skillProjection = {
      current: 0,
      drifted: 0,
      missing: 0,
      failed: 1,
      totalManaged: 0,
      skillsSynchronized: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
  const config = getAgentProviderConfig(canonicalProvider);
  const binaryPath = dependencies.binaryPath || resolveAgentProviderBinary(canonicalProvider);
  if (!binaryPath) {
    return {
      authenticated: false,
      authentication: "unavailable",
      installed: false,
      provider: canonicalProvider,
      routerConfigured: hasRudiRouter(canonicalProvider),
      skillProjection,
      skillsSynchronized: skillProjection.skillsSynchronized,
      version: null
    };
  }
  const version = runCheck(binaryPath, commandArgs(config.binary.checkCommand), spawnSyncImpl);
  const authArgs = commandArgs(config.binary.authCheck);
  const versionArgs = commandArgs(config.binary.checkCommand);
  const authIsObservable = JSON.stringify(authArgs) !== JSON.stringify(versionArgs);
  const auth = authIsObservable ? runCheck(binaryPath, authArgs, spawnSyncImpl) : { ok: null };
  return {
    authenticated: auth.ok,
    authentication: auth.ok == null ? "unknown" : auth.ok ? "authenticated" : "unauthenticated",
    binaryPath,
    installed: version.ok,
    provider: canonicalProvider,
    routerConfigured: hasRudiRouter(canonicalProvider),
    skillProjection,
    skillsSynchronized: skillProjection.skillsSynchronized,
    version: version.output.split("\n")[0] || null
  };
}
async function assertAgentHostReady({ binaryPath, provider }, dependencies = {}) {
  const inspected = await inspectAgentHost(provider, { ...dependencies, binaryPath });
  if (!inspected.installed) {
    throw new Error(`${provider} host is not installed or did not pass its version check`);
  }
  if (inspected.authenticated === false) {
    throw new Error(`${provider} host is not authenticated`);
  }
  return inspected;
}

// src/agent-host/workspace.js
var import_node_fs14 = __toESM(require("node:fs"), 1);
var import_node_path17 = __toESM(require("node:path"), 1);
var import_node_child_process10 = require("node:child_process");

// src/agent-host/workspace-manifest.js
var import_node_crypto4 = __toESM(require("node:crypto"), 1);
var import_node_fs13 = __toESM(require("node:fs"), 1);
var import_node_path16 = __toESM(require("node:path"), 1);
var WORKSPACE_BASELINE_FILE = "workspace-base.json";
function shouldSkip(relativePath) {
  const first = relativePath.split(import_node_path16.default.sep)[0];
  return first === ".git" || first === ".rudi";
}
function portablePath(relativePath) {
  return relativePath.split(import_node_path16.default.sep).join("/");
}
function hashFile(file) {
  return import_node_crypto4.default.createHash("sha256").update(import_node_fs13.default.readFileSync(file)).digest("hex");
}
function createWorkspaceManifest(rootDirectory) {
  const root = import_node_fs13.default.realpathSync(import_node_path16.default.resolve(rootDirectory));
  const entries = {};
  function visit(directory, prefix = "") {
    const children = import_node_fs13.default.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const relative2 = prefix ? import_node_path16.default.join(prefix, child.name) : child.name;
      if (shouldSkip(relative2)) continue;
      const absolute = import_node_path16.default.join(directory, child.name);
      const stat = import_node_fs13.default.lstatSync(absolute);
      const key = portablePath(relative2);
      if (stat.isDirectory()) {
        entries[key] = { mode: stat.mode & 511, type: "directory" };
        visit(absolute, relative2);
      } else if (stat.isFile()) {
        entries[key] = {
          hash: hashFile(absolute),
          mode: stat.mode & 511,
          size: stat.size,
          type: "file"
        };
      } else if (stat.isSymbolicLink()) {
        entries[key] = {
          mode: stat.mode & 511,
          target: import_node_fs13.default.readlinkSync(absolute),
          type: "symlink"
        };
      } else {
        throw new Error(`Unsupported workspace entry type: ${absolute}`);
      }
    }
  }
  visit(root);
  return { entries, schemaVersion: 1 };
}
function writeWorkspaceBaseline({ launchDirectory, workspace }) {
  const destination = import_node_path16.default.join(import_node_path16.default.resolve(launchDirectory), WORKSPACE_BASELINE_FILE);
  const manifest = createWorkspaceManifest(workspace);
  const handle = import_node_fs13.default.openSync(destination, "wx", 384);
  try {
    import_node_fs13.default.writeFileSync(handle, `${JSON.stringify(manifest)}
`, "utf8");
  } finally {
    import_node_fs13.default.closeSync(handle);
  }
  return destination;
}

// src/agent-host/workspace.js
var WORKSPACE_MODES = Object.freeze({
  AUTO: "auto",
  ISOLATED_COPY: "isolated-copy",
  READ_ONLY: "read-only",
  WORKTREE: "worktree",
  REGISTERED_SHARED: TASK_MODE
});
var VALID_MODES = new Set(Object.values(WORKSPACE_MODES));
function existingDirectory(candidate, label) {
  const resolved = import_node_path17.default.resolve(candidate);
  let stat;
  try {
    stat = import_node_fs14.default.statSync(resolved);
  } catch {
    throw new Error(`${label} does not exist: ${resolved}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`${label} is not a directory: ${resolved}`);
  }
  return import_node_fs14.default.realpathSync(resolved);
}
function isInside2(candidate, parent) {
  const relative2 = import_node_path17.default.relative(parent, candidate);
  return relative2 === "" || !relative2.startsWith(`..${import_node_path17.default.sep}`) && relative2 !== ".." && !import_node_path17.default.isAbsolute(relative2);
}
function findGitProjectRoot(workspace, execFileSyncImpl) {
  try {
    const output = execFileSyncImpl("git", ["rev-parse", "--show-toplevel"], {
      cwd: workspace,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    return existingDirectory(String(output).trim(), "Git project root");
  } catch {
    return null;
  }
}
function gitOutput(execFileSyncImpl, cwd, args) {
  return String(execFileSyncImpl("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  })).trim();
}
function assertOutputOutsideProject(outputDestination, projectRoot) {
  if (isInside2(outputDestination, projectRoot)) {
    throw new Error(`Output destination must be outside the project: ${outputDestination}`);
  }
}
function createGitWorktree({
  destination,
  execFileSyncImpl,
  launchId,
  projectRoot
}) {
  const branch = `rudi/agent/${launchId}`;
  const baseRef = gitOutput(execFileSyncImpl, projectRoot, ["rev-parse", "--verify", "HEAD"]);
  try {
    execFileSyncImpl("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], {
      cwd: projectRoot,
      stdio: "ignore"
    });
    throw new Error(`Worktree branch already exists: ${branch}`);
  } catch (error) {
    if (error?.message?.startsWith("Worktree branch already exists:")) throw error;
  }
  import_node_fs14.default.mkdirSync(import_node_path17.default.dirname(destination), { recursive: true, mode: 448 });
  try {
    execFileSyncImpl("git", ["worktree", "add", "-b", branch, destination, baseRef], {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    try {
      execFileSyncImpl("git", ["worktree", "remove", "--force", destination], {
        cwd: projectRoot,
        stdio: "ignore"
      });
    } catch {
    }
    import_node_fs14.default.rmSync(destination, { recursive: true, force: true });
    try {
      execFileSyncImpl("git", ["branch", "-D", "--", branch], {
        cwd: projectRoot,
        stdio: "ignore"
      });
    } catch {
    }
    throw new Error(`Unable to create isolated Git worktree: ${error.message}`);
  }
  return { baseRef, branch };
}
function copyIsolatedWorkspace({ destination, projectRoot }) {
  if (isInside2(destination, projectRoot)) {
    throw new Error("Isolated workspace destination cannot be inside the source project");
  }
  try {
    import_node_fs14.default.cpSync(projectRoot, destination, {
      errorOnExist: true,
      filter(candidate) {
        const relative2 = import_node_path17.default.relative(projectRoot, candidate);
        const firstPart = relative2.split(import_node_path17.default.sep)[0];
        if (firstPart === ".git" || firstPart === ".rudi") return false;
        const stat = import_node_fs14.default.lstatSync(candidate);
        if (stat.isSymbolicLink()) {
          const target = import_node_fs14.default.realpathSync(candidate);
          if (!isInside2(target, projectRoot)) {
            throw new Error(`Workspace contains a symlink outside the project: ${candidate}`);
          }
        }
        return true;
      },
      force: false,
      recursive: true
    });
  } catch (error) {
    import_node_fs14.default.rmSync(destination, { recursive: true, force: true });
    throw new Error(`Unable to create isolated workspace copy: ${error.message}`);
  }
}
function resolveAgentWorkspace(options, dependencies = {}) {
  const {
    artifactsRoot,
    launchId,
    mode = WORKSPACE_MODES.AUTO,
    originDirectory = process.cwd(),
    outputDirectory = null,
    privateAutomation = false,
    taskProfile = null,
    workspace = null
  } = options || {};
  const { execFileSyncImpl = import_node_child_process10.execFileSync } = dependencies;
  assertLaunchId(launchId);
  if (mode === TASK_MODE) assertTaskProfile(taskProfile);
  if (!VALID_MODES.has(mode)) {
    throw new Error(`Unknown workspace mode: ${mode}. Available: ${[...VALID_MODES].join(", ")}`);
  }
  if (privateAutomation === true && mode !== WORKSPACE_MODES.READ_ONLY) {
    throw new Error("private automation requires read-only workspace mode");
  }
  if (typeof artifactsRoot !== "string" || artifactsRoot.trim() === "") {
    throw new Error("artifactsRoot is required");
  }
  const resolvedOrigin = existingDirectory(originDirectory, "Origin directory");
  const requestedWorkspace = workspace == null ? resolvedOrigin : import_node_path17.default.resolve(resolvedOrigin, workspace);
  const validWorkspace = existingDirectory(requestedWorkspace, "Workspace");
  const gitProjectRoot = findGitProjectRoot(validWorkspace, execFileSyncImpl);
  const projectRoot = gitProjectRoot || validWorkspace;
  if (mode === TASK_MODE && validWorkspace !== taskProfile.working_directory) {
    throw new Error("registered shared workspace differs from profile");
  }
  const isGitRepository = Boolean(gitProjectRoot);
  const launchDirectory = outputDirectory == null ? import_node_path17.default.resolve(artifactsRoot, launchId) : import_node_path17.default.resolve(resolvedOrigin, outputDirectory);
  let resolvedMode = mode;
  if (resolvedMode === WORKSPACE_MODES.AUTO) {
    resolvedMode = isGitRepository ? WORKSPACE_MODES.WORKTREE : WORKSPACE_MODES.ISOLATED_COPY;
  }
  if (resolvedMode === WORKSPACE_MODES.WORKTREE && !isGitRepository) {
    throw new Error("Workspace mode worktree requires a Git repository");
  }
  assertOutputOutsideProject(launchDirectory, projectRoot);
  if (import_node_fs14.default.existsSync(launchDirectory)) {
    throw new Error(`Output destination already exists: ${launchDirectory}`);
  }
  import_node_fs14.default.mkdirSync(launchDirectory, { recursive: true, mode: 448 });
  createLaunchOwnershipMarker({ launchDirectory, launchId });
  let executionWorkspace = mode === TASK_MODE ? validWorkspace : projectRoot;
  let worktreeBranch = null;
  let baseRef = null;
  try {
    if (privateAutomation === true) {
      executionWorkspace = import_node_path17.default.join(launchDirectory, "private-workspace");
      import_node_fs14.default.mkdirSync(executionWorkspace, { mode: 320 });
      import_node_fs14.default.chmodSync(executionWorkspace, 320);
    } else if (resolvedMode === WORKSPACE_MODES.WORKTREE) {
      executionWorkspace = import_node_path17.default.join(launchDirectory, "workspace");
      const created = createGitWorktree({
        destination: executionWorkspace,
        execFileSyncImpl,
        launchId,
        projectRoot
      });
      worktreeBranch = created.branch;
      baseRef = created.baseRef;
    } else if (resolvedMode === WORKSPACE_MODES.ISOLATED_COPY) {
      executionWorkspace = import_node_path17.default.join(launchDirectory, "workspace");
      copyIsolatedWorkspace({ destination: executionWorkspace, projectRoot });
      writeWorkspaceBaseline({ launchDirectory, workspace: executionWorkspace });
    }
  } catch (error) {
    import_node_fs14.default.rmSync(launchDirectory, { recursive: true, force: true });
    throw error;
  }
  return Object.freeze({
    baseRef,
    executionWorkspace: existingDirectory(executionWorkspace, "Execution workspace"),
    isGitRepository,
    mode: resolvedMode,
    originDirectory: resolvedOrigin,
    outputDestination: launchDirectory,
    projectRoot,
    privateAutomation: privateAutomation === true,
    worktreeBranch
  });
}
function cleanupUnstartedWorkspace(workspace, dependencies = {}) {
  if (!workspace || typeof workspace !== "object") return;
  const { execFileSyncImpl = import_node_child_process10.execFileSync } = dependencies;
  const outputDestination = import_node_path17.default.resolve(workspace.outputDestination);
  const executionWorkspace = import_node_path17.default.resolve(workspace.executionWorkspace);
  if (!isInside2(executionWorkspace, outputDestination) && ![WORKSPACE_MODES.READ_ONLY, TASK_MODE].includes(workspace.mode)) {
    throw new Error("Refusing to clean an execution workspace outside its launch output destination");
  }
  if (workspace.mode === WORKSPACE_MODES.WORKTREE) {
    if (!/^rudi\/agent\/launch_[A-Za-z0-9_-]+$/.test(workspace.worktreeBranch || "")) {
      throw new Error("Refusing to clean an unexpected worktree branch");
    }
    try {
      execFileSyncImpl("git", ["worktree", "remove", "--force", executionWorkspace], {
        cwd: workspace.projectRoot,
        stdio: "ignore"
      });
    } catch {
    }
    try {
      execFileSyncImpl("git", ["branch", "-D", "--", workspace.worktreeBranch], {
        cwd: workspace.projectRoot,
        stdio: "ignore"
      });
    } catch {
    }
  }
  import_node_fs14.default.rmSync(outputDestination, { recursive: true, force: true });
}

// src/agent-host/task-claude-capabilities.js
var import_node_fs15 = __toESM(require("node:fs"), 1);
var import_node_os8 = __toESM(require("node:os"), 1);
var import_node_path18 = __toESM(require("node:path"), 1);
var import_node_child_process11 = require("node:child_process");
var TASK_CLAUDE_VERSION = "2.1.294";
function assertClaudeTaskCapabilities({ binaryPath, profile }, { spawnSyncImpl = import_node_child_process11.spawnSync, helperPathImpl = auditHelperPath } = {}) {
  const helper = helperPathImpl();
  if (!profile.account || profile.access_mode !== "trusted" && profile.network !== "disabled") throw new Error("Claude task requires an explicit account and disabled tool network");
  for (const policy of [
    "/Library/Application Support/ClaudeCode/managed-settings.json",
    "/Library/Application Support/ClaudeCode/managed-settings.d",
    import_node_path18.default.join(profile.account.config_directory, "managed-settings.json")
  ]) {
    if (profile.access_mode !== "trusted" && import_node_fs15.default.existsSync(policy)) throw new Error("Managed Claude policy requires separate task qualification");
  }
  const env = taskClaudeEnvironment(binaryPath, profile);
  const version = spawnSyncImpl(binaryPath, ["--version"], { encoding: "utf8", timeout: 5e3, maxBuffer: 65536, env });
  if (version.error || version.status !== 0 || version.stdout.trim() !== `${TASK_CLAUDE_VERSION} (Claude Code)`) {
    throw new Error("Native Claude version is not qualified for task execution");
  }
  const seat = inspectClaudeTaskSeat(binaryPath, { profile, spawnSyncImpl });
  const temporary = import_node_fs15.default.realpathSync(import_node_fs15.default.mkdtempSync(import_node_path18.default.join(import_node_os8.default.tmpdir(), "rudi-claude-capability-")));
  try {
    const probe = import_node_path18.default.join(temporary, "audit-probe");
    import_node_fs15.default.copyFileSync(helper, probe, import_node_fs15.default.constants.COPYFILE_EXCL);
    import_node_fs15.default.chmodSync(probe, 448);
    const checked = spawnSyncImpl(
      "/usr/bin/sandbox-exec",
      ["-p", claudeSandboxPolicy(binaryPath, profile, temporary), probe, "probe", String(process.pid)],
      { encoding: "utf8", timeout: 5e3, maxBuffer: 65536, env }
    );
    if (checked.error || checked.status !== 0 || checked.stdout.trim() !== '{"audit_session_escape_denied":true,"supervisor_signal_denied":true}') {
      throw new Error("Claude OS sandbox containment capability probe failed");
    }
  } finally {
    import_node_fs15.default.rmSync(temporary, { recursive: true, force: true });
  }
  return { version: TASK_CLAUDE_VERSION, account: seat.account };
}

// src/agent-host/task-provider.js
function assertTaskProviderQualified(profile) {
  assertTaskProfile(profile);
  if (!["codex", "claude"].includes(profile.provider)) throw new Error("unsupported task provider");
}
function assertTaskHostCapabilities2(context, dependencies) {
  assertTaskProviderQualified(context.profile);
  return context.profile.provider === "claude" ? assertClaudeTaskCapabilities(context, dependencies) : assertTaskHostCapabilities(context, dependencies);
}

// src/agent-host/launch.js
function createLaunchId() {
  return `launch_${import_node_crypto5.default.randomUUID().replaceAll("-", "")}`;
}
async function launchAgent(options, dependencies = {}) {
  const {
    artifactsRoot = getAgentHostPaths().artifactsRoot,
    eventSink = null,
    idFactory = createLaunchId,
    ownerPid = null,
    onSpawn = null,
    preflightImpl = assertAgentHostReady,
    privatePreflightImpl = assertPrivateAutomationHostCapabilities,
    taskPreflightImpl = assertTaskHostCapabilities2,
    resolveBinaryImpl = resolveAgentProviderBinary,
    spawnImpl,
    taskStop,
    stderr = process.stderr,
    stdout = process.stdout,
    signalEmitter = process,
    workspaceResolver = resolveAgentWorkspace
  } = dependencies;
  const launchId = idFactory();
  const privateAutomationProfile = options?.privateAutomationProfile || null;
  if (privateAutomationProfile && options?.executionKind && options.executionKind !== "foreground") {
    throw new Error("private automation supports foreground execution only");
  }
  const taskProfile = options?.taskProfile || null;
  if (taskProfile) {
    assertTaskProfile(taskProfile);
    if (options.executionKind && options.executionKind !== "foreground") throw new Error("task execution is foreground only");
  }
  const provider = resolveAgentProviderId(options?.provider);
  const binaryPath = resolveBinaryImpl(provider);
  if (!binaryPath) {
    throw new Error(getMissingAgentProviderMessage(provider));
  }
  if (!taskProfile?.account) await preflightImpl({ binaryPath, provider });
  if (privateAutomationProfile) {
    await privatePreflightImpl({ binaryPath, profile: privateAutomationProfile });
  }
  const taskCapabilities = taskProfile ? await taskPreflightImpl({ binaryPath, profile: taskProfile }) : null;
  const workspace = workspaceResolver({
    artifactsRoot,
    launchId,
    mode: options.workspaceMode || "auto",
    originDirectory: options.originDirectory || process.cwd(),
    outputDirectory: options.outputDirectory || null,
    privateAutomation: privateAutomationProfile != null,
    taskProfile,
    workspace: options.workspace || null
  });
  const resolvedEventSink = eventSink || ((event) => appendLaunchEvent(
    getLaunchArtifactFiles(workspace.outputDestination).events,
    event
  ));
  let plan;
  try {
    plan = buildProviderProcessPlan({
      approvalMode: options.approvalMode,
      binaryPath,
      cwd: workspace.executionWorkspace,
      extraArgs: options.extraArgs,
      images: options.images,
      model: options.model,
      permissionMode: options.permissionMode,
      privateAutomationProfile,
      taskProfile,
      prompt: options.prompt,
      provider,
      runtimeDirectory: workspace.outputDestination,
      workspaceMode: workspace.mode
    });
  } catch (error) {
    cleanupUnstartedWorkspace(workspace);
    throw error;
  }
  const ownsStore = !dependencies.store;
  const store = dependencies.store || createLaunchStore();
  try {
    store.create({
      baseRef: workspace.baseRef,
      executionKind: options.executionKind || "foreground",
      executionWorkspace: workspace.executionWorkspace,
      launchId,
      model: plan.model,
      originDirectory: workspace.originDirectory,
      ownerPid,
      outputDestination: workspace.outputDestination,
      projectRoot: workspace.projectRoot,
      provider,
      status: "starting",
      workspaceMode: workspace.mode,
      worktreeBranch: workspace.worktreeBranch
    });
    if (taskProfile) assertWritableTaskRoots(taskProfile);
    const result = await executeForegroundLaunch({
      eventSink: resolvedEventSink,
      jsonOutput: options.json === true,
      launchId,
      onSpawn: onSpawn ? (value) => onSpawn({ ...value, taskAccount: taskCapabilities?.account || null }) : null,
      plan,
      spawnImpl,
      taskStop,
      stderr,
      stdout,
      store,
      signalEmitter,
      timeoutMs: taskProfile?.timeout_ms || options.timeoutMs || plan.timeouts.runtimeMs
    });
    return taskProfile ? { ...result, taskAccount: taskCapabilities?.account || null } : result;
  } catch (error) {
    const current = store.get(launchId);
    if (current?.status === "starting" || current?.status === "running") {
      store.transition(launchId, "failed", { lastError: error.message });
    } else if (!current) {
      cleanupUnstartedWorkspace(workspace);
    }
    throw error;
  } finally {
    if (ownsStore) store.close();
  }
}

// src/agent-host/task-run.js
function pinnedNative(environment, provider) {
  const foreign = provider === "claude" ? "CODEX" : "CLAUDE";
  if (environment[`RUDI_AGENT_TASK_${foreign}_PATH`] !== void 0 || environment[`RUDI_AGENT_TASK_${foreign}_SHA256`] !== void 0) {
    throw new Error("task provider executable pin mismatch");
  }
  const binary = environment[`RUDI_AGENT_TASK_${provider.toUpperCase()}_PATH`];
  const digest = environment[`RUDI_AGENT_TASK_${provider.toUpperCase()}_SHA256`];
  if (binary === void 0 && digest === void 0) return null;
  if (typeof binary !== "string" || !import_node_path19.default.isAbsolute(binary) || !/^[a-f0-9]{64}$/u.test(digest || "") || import_node_fs16.default.realpathSync(binary) !== binary || sha256(readTaskRegularFile(binary, 512 * 1024 * 1024, true)) !== digest) {
    throw new Error("task native executable pin mismatch");
  }
  import_node_fs16.default.accessSync(binary, import_node_fs16.default.constants.X_OK);
  return binary;
}
function readAgentTask(reference, environment = process.env) {
  const request = parseTaskJson(readTaskReference(reference, "task request"));
  exactFields(request, ["schema_version", "task", "instructions", "execution_profile", "working_directory", "outputs", "timeout_seconds"], "task request");
  exactFields(request.task, ["id", "revision", "definition_sha256"], "task binding");
  exactFields(request.outputs, ["deliverables", "runtime"], "task outputs");
  if (request.schema_version !== 1 || !/^[a-z][a-z0-9-]{0,63}$/u.test(request.task.id) || !Number.isSafeInteger(request.task.revision) || request.task.revision < 1 || !/^[a-f0-9]{64}$/u.test(request.task.definition_sha256) || !Number.isSafeInteger(request.timeout_seconds) || request.timeout_seconds < 21 || request.timeout_seconds > 3620) {
    throw new Error("invalid task request identity/version/budget");
  }
  canonicalDirectory(request.working_directory, "task working directory");
  const instructions = readTaskReference(request.instructions, "task instructions");
  if (!instructions.trim()) throw new Error("empty instructions");
  const profile = validateTaskProfile(parseTaskJson(readTaskReference(request.execution_profile, "execution profile")), request);
  const nativeBinary = pinnedNative(environment, profile.provider);
  if (profile.timeout_ms > (request.timeout_seconds - 20) * 1e3) throw new Error("native timeout must leave 20 seconds for bridge shutdown");
  if (inside(request.outputs.runtime, request.working_directory) || inside(request.working_directory, request.outputs.runtime)) throw new Error("task runtime and workspace overlap");
  for (const control of [reference.path, request.instructions.path, request.execution_profile.path]) {
    if (profile.access_mode !== "trusted" && profile.write_roots.some((root) => inside(control, root))) throw new Error("task control references cannot be writable outputs");
  }
  return { request, profile, instructions, nativeBinary };
}
function writeReceipt(filename, value) {
  const bytes = `${JSON.stringify(value, null, 2)}
`;
  const fd = import_node_fs16.default.openSync(filename, "wx", 384);
  try {
    import_node_fs16.default.writeFileSync(fd, bytes);
    import_node_fs16.default.fsyncSync(fd);
  } finally {
    import_node_fs16.default.closeSync(fd);
  }
  return { path: filename, sha256: sha256(bytes) };
}
function computeBinding(environment) {
  const job = environment.RUDI_COMPUTE_JOB_ID;
  const attempt = environment.RUDI_COMPUTE_ATTEMPT;
  const hash = environment.RUDI_COMPUTE_SPEC_HASH;
  if (!/^job_[A-Za-z0-9_-]{4,123}$/u.test(job || "") || attempt !== "1" || !/^[a-f0-9]{64}$/u.test(hash || "")) {
    throw new Error("task runner requires a valid Compute job/spec binding and first attempt");
  }
  return { job_id: job, attempt: 1, spec_sha256: hash };
}
function verifyOutputs(manifest, deliverables) {
  exactFields(manifest, ["outcome", "outputs"], "task final manifest");
  if (!["complete", "no_work", "partial", "needs_evidence"].includes(manifest.outcome) || !Array.isArray(manifest.outputs) || manifest.outputs.length > 64 || manifest.outcome === "complete" && manifest.outputs.length === 0 || manifest.outcome === "no_work" && manifest.outputs.length !== 0 || new Set(manifest.outputs).size !== manifest.outputs.length) throw new Error("invalid task output manifest");
  return manifest.outputs.map((filename) => {
    taskText(filename, "output path");
    if (!import_node_path19.default.isAbsolute(filename) || import_node_fs16.default.realpathSync(filename) !== filename || !deliverables.some((root) => inside(filename, root))) throw new Error("output path outside declared deliverables or aliased");
    const bytes = readTaskRegularFile(filename, 32 * 1024 * 1024, true);
    return { path: filename, sha256: sha256(bytes), bytes: bytes.length };
  });
}
async function runAgentTaskInSession(reference, dependencies = {}) {
  const { request, profile, instructions, nativeBinary } = readAgentTask(reference, dependencies.environment || process.env);
  const compute = computeBinding(dependencies.environment || process.env);
  const runDirectory = import_node_path19.default.join(request.outputs.runtime, `${compute.job_id}-attempt-1`);
  import_node_fs16.default.mkdirSync(runDirectory, { mode: 448 });
  const base = {
    schema_version: 1,
    task: request.task,
    request: reference,
    compute,
    instructions: request.instructions,
    execution_profile: request.execution_profile,
    access_mode: profile.access_mode || "restricted",
    ...profile.reasoning_effort !== void 0 ? { reasoning_effort: profile.reasoning_effort } : {},
    ...profile.account ? { account: profile.account } : {}
  };
  const store = createLaunchStore({ databasePath: import_node_path19.default.join(request.outputs.runtime, "agent-hosts.db") });
  let custody;
  try {
    custody = await (dependencies.custodyFactory || openTaskCustody)({
      capsule: dependencies.capsule,
      runtime: request.outputs.runtime,
      runDirectory,
      jobId: compute.job_id,
      workerPath: dependencies.custodyWorkerPath
    });
  } catch (error2) {
    store.close();
    throw error2;
  }
  let launchReference = null;
  let launch = null;
  let outputs = [];
  let error = null;
  const recordLaunch = (value) => {
    if (!launchReference) launchReference = writeReceipt(import_node_path19.default.join(runDirectory, "launch.json"), {
      ...base,
      launch_id: value.launchId,
      provider: profile.provider,
      model: profile.model,
      working_directory: request.working_directory,
      workspace_mode: profile.workspace_mode,
      ...profile.account ? { observed_account: value.taskAccount || null } : {}
    });
  };
  try {
    const launchImpl = dependencies.launchImpl || launchAgent;
    launch = await launchImpl({
      provider: profile.provider,
      model: profile.model,
      taskProfile: profile,
      workspaceMode: profile.workspace_mode,
      workspace: request.working_directory,
      originDirectory: request.working_directory,
      outputDirectory: import_node_path19.default.join(runDirectory, "host"),
      prompt: `${instructions}

Return a final JSON object with exactly outcome and outputs. outcome is complete, no_work, partial, needs_evidence, or failed. outputs is an array of absolute paths to files produced in the declared deliverable roots. complete requires at least one file; no_work requires none. Do not include Markdown fences.
Declared deliverable roots: ${JSON.stringify(request.outputs.deliverables)}
Filesystem write roots: ${JSON.stringify(profile.write_roots)}`
    }, {
      ...dependencies.launchDependencies,
      ...nativeBinary ? { resolveBinaryImpl: () => nativeBinary } : {},
      taskStop: () => custody.stop(),
      store,
      onSpawn: async (value) => {
        await custody.track(value.pid);
        recordLaunch(value);
      },
      stdout: { write() {
      } }
    });
    recordLaunch(launch);
    if (launch.status !== "completed" || !launch.nativeSessionId) throw new Error(launch.lastError || "native launch did not complete");
  } catch (caught) {
    error = String(caught.message || "task execution failed").slice(0, 2048);
  } finally {
    store.close();
    dependencies.beforeCustodyClose?.();
    try {
      await custody.close();
    } catch (caught) {
      error = `Task custody unresolved: ${caught.message}`.slice(0, 2048);
    }
  }
  if (!error) {
    try {
      outputs = verifyOutputs(launch.taskFinalOutput, request.outputs.deliverables);
    } catch (caught) {
      error = String(caught.message).slice(0, 2048);
    }
  }
  const receipt = writeReceipt(import_node_path19.default.join(runDirectory, "completion.json"), {
    ...base,
    status: error ? "failed" : "completed",
    outcome: error ? "failed" : launch.taskFinalOutput.outcome,
    ...profile.account ? { observed_account: launch?.taskAccount || null } : {},
    launch_receipt: launchReference,
    launch: launch ? { id: launch.launchId, native_session_id: launch.nativeSessionId || null } : null,
    outputs,
    error,
    finished_at: (/* @__PURE__ */ new Date()).toISOString()
  });
  return { status: error ? "failed" : "completed", receipt };
}

// src/agent-host/task-capsule-worker.js
async function main() {
  const directory = canonicalDirectory(process.argv[2], "capsule directory");
  const input = parseTaskJson(readTaskRegularFile(import_node_path20.default.join(directory, "input.json"), 32768, true).toString("utf8"));
  let creatorLost = false;
  function creatorAlive() {
    try {
      return JSON.stringify(auditIdentity(input.creator.pid)) === JSON.stringify(input.creator);
    } catch {
      return false;
    }
  }
  if (!creatorAlive()) throw new Error("capsule creator identity lost before execution");
  const monitor = setInterval(() => {
    if (creatorAlive() || creatorLost) return;
    creatorLost = true;
    const lock = import_node_path20.default.join(import_node_path20.default.dirname(directory), "custody.lock");
    if (import_node_fs17.default.existsSync(lock)) quarantineTaskCustody(lock, "capsule creator lost");
    process.kill(process.pid, "SIGTERM");
  }, 500);
  try {
    const value = await runAgentTaskInSession(input.reference, {
      environment: input.environment,
      capsule: { label: input.label, creatorPid: input.creator.pid },
      beforeCustodyClose: () => clearInterval(monitor)
    });
    capsuleRecord(import_node_path20.default.join(directory, "result.json"), { value });
  } catch (error) {
    capsuleRecord(import_node_path20.default.join(directory, "result.json"), { error: String(error.message).slice(0, 2048) });
  } finally {
    clearInterval(monitor);
    if (creatorLost) (0, import_node_child_process12.spawnSync)("/bin/launchctl", ["bootout", `gui/${process.getuid()}/${input.label}`], { timeout: 1e4, stdio: "ignore" });
  }
}
main().catch((error) => {
  process.stderr.write(`${error.message}
`);
  process.exitCode = 1;
});
