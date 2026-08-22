/**
* @vue/shared v3.5.18
* (c) 2018-present Yuxi (Evan) You and Vue contributors
* @license MIT
**/
/*! #__NO_SIDE_EFFECTS__ */
// @__NO_SIDE_EFFECTS__
function dn(e) {
  const t = /* @__PURE__ */ Object.create(null);
  for (const s of e.split(",")) t[s] = 1;
  return (s) => s in t;
}
const Q = {}, Dt = [], Ye = () => {
}, Wi = () => !1, ks = (e) => e.charCodeAt(0) === 111 && e.charCodeAt(1) === 110 && // uppercase letter
(e.charCodeAt(2) > 122 || e.charCodeAt(2) < 97), pn = (e) => e.startsWith("onUpdate:"), Te = Object.assign, hn = (e, t) => {
  const s = e.indexOf(t);
  s > -1 && e.splice(s, 1);
}, zi = Object.prototype.hasOwnProperty, G = (e, t) => zi.call(e, t), D = Array.isArray, Ut = (e) => rs(e) === "[object Map]", Ht = (e) => rs(e) === "[object Set]", tl = (e) => rs(e) === "[object Date]", K = (e) => typeof e == "function", de = (e) => typeof e == "string", Ze = (e) => typeof e == "symbol", le = (e) => e !== null && typeof e == "object", Rl = (e) => (le(e) || K(e)) && K(e.then) && K(e.catch), Fl = Object.prototype.toString, rs = (e) => Fl.call(e), qi = (e) => rs(e).slice(8, -1), Dl = (e) => rs(e) === "[object Object]", gn = (e) => de(e) && e !== "NaN" && e[0] !== "-" && "" + parseInt(e, 10) === e, Gt = /* @__PURE__ */ dn(
  // the leading comma is intentional so empty string "" is also included
  ",key,ref,ref_for,ref_key,onVnodeBeforeMount,onVnodeMounted,onVnodeBeforeUpdate,onVnodeUpdated,onVnodeBeforeUnmount,onVnodeUnmounted"
), Os = (e) => {
  const t = /* @__PURE__ */ Object.create(null);
  return (s) => t[s] || (t[s] = e(s));
}, Ji = /-(\w)/g, yt = Os(
  (e) => e.replace(Ji, (t, s) => s ? s.toUpperCase() : "")
), Gi = /\B([A-Z])/g, wt = Os(
  (e) => e.replace(Gi, "-$1").toLowerCase()
), Ul = Os((e) => e.charAt(0).toUpperCase() + e.slice(1)), Vs = Os(
  (e) => e ? `on${Ul(e)}` : ""
), mt = (e, t) => !Object.is(e, t), vs = (e, ...t) => {
  for (let s = 0; s < e.length; s++)
    e[s](...t);
}, Qs = (e, t, s, n = !1) => {
  Object.defineProperty(e, t, {
    configurable: !0,
    enumerable: !1,
    writable: n,
    value: s
  });
}, xs = (e) => {
  const t = parseFloat(e);
  return isNaN(t) ? e : t;
};
let sl;
const Ms = () => sl || (sl = typeof globalThis < "u" ? globalThis : typeof self < "u" ? self : typeof window < "u" ? window : typeof global < "u" ? global : {});
function Es(e) {
  if (D(e)) {
    const t = {};
    for (let s = 0; s < e.length; s++) {
      const n = e[s], l = de(n) ? Qi(n) : Es(n);
      if (l)
        for (const i in l)
          t[i] = l[i];
    }
    return t;
  } else if (de(e) || le(e))
    return e;
}
const Yi = /;(?![^(]*\))/g, Xi = /:([^]+)/, Zi = /\/\*[^]*?\*\//g;
function Qi(e) {
  const t = {};
  return e.replace(Zi, "").split(Yi).forEach((s) => {
    if (s) {
      const n = s.split(Xi);
      n.length > 1 && (t[n[0].trim()] = n[1].trim());
    }
  }), t;
}
function ie(e) {
  let t = "";
  if (de(e))
    t = e;
  else if (D(e))
    for (let s = 0; s < e.length; s++) {
      const n = ie(e[s]);
      n && (t += n + " ");
    }
  else if (le(e))
    for (const s in e)
      e[s] && (t += s + " ");
  return t.trim();
}
const eo = "itemscope,allowfullscreen,formnovalidate,ismap,nomodule,novalidate,readonly", to = /* @__PURE__ */ dn(eo);
function Kl(e) {
  return !!e || e === "";
}
function so(e, t) {
  if (e.length !== t.length) return !1;
  let s = !0;
  for (let n = 0; s && n < e.length; n++)
    s = Ot(e[n], t[n]);
  return s;
}
function Ot(e, t) {
  if (e === t) return !0;
  let s = tl(e), n = tl(t);
  if (s || n)
    return s && n ? e.getTime() === t.getTime() : !1;
  if (s = Ze(e), n = Ze(t), s || n)
    return e === t;
  if (s = D(e), n = D(t), s || n)
    return s && n ? so(e, t) : !1;
  if (s = le(e), n = le(t), s || n) {
    if (!s || !n)
      return !1;
    const l = Object.keys(e).length, i = Object.keys(t).length;
    if (l !== i)
      return !1;
    for (const r in e) {
      const u = e.hasOwnProperty(r), f = t.hasOwnProperty(r);
      if (u && !f || !u && f || !Ot(e[r], t[r]))
        return !1;
    }
  }
  return String(e) === String(t);
}
function vn(e, t) {
  return e.findIndex((s) => Ot(s, t));
}
const jl = (e) => !!(e && e.__v_isRef === !0), C = (e) => de(e) ? e : e == null ? "" : D(e) || le(e) && (e.toString === Fl || !K(e.toString)) ? jl(e) ? C(e.value) : JSON.stringify(e, Nl, 2) : String(e), Nl = (e, t) => jl(t) ? Nl(e, t.value) : Ut(t) ? {
  [`Map(${t.size})`]: [...t.entries()].reduce(
    (s, [n, l], i) => (s[Hs(n, i) + " =>"] = l, s),
    {}
  )
} : Ht(t) ? {
  [`Set(${t.size})`]: [...t.values()].map((s) => Hs(s))
} : Ze(t) ? Hs(t) : le(t) && !D(t) && !Dl(t) ? String(t) : t, Hs = (e, t = "") => {
  var s;
  return (
    // Symbol.description in es2019+ so we need to cast here to pass
    // the lib: es2016 check
    Ze(e) ? `Symbol(${(s = e.description) != null ? s : t})` : e
  );
};
/**
* @vue/reactivity v3.5.18
* (c) 2018-present Yuxi (Evan) You and Vue contributors
* @license MIT
**/
let Ie;
class no {
  constructor(t = !1) {
    this.detached = t, this._active = !0, this._on = 0, this.effects = [], this.cleanups = [], this._isPaused = !1, this.parent = Ie, !t && Ie && (this.index = (Ie.scopes || (Ie.scopes = [])).push(
      this
    ) - 1);
  }
  get active() {
    return this._active;
  }
  pause() {
    if (this._active) {
      this._isPaused = !0;
      let t, s;
      if (this.scopes)
        for (t = 0, s = this.scopes.length; t < s; t++)
          this.scopes[t].pause();
      for (t = 0, s = this.effects.length; t < s; t++)
        this.effects[t].pause();
    }
  }
  /**
   * Resumes the effect scope, including all child scopes and effects.
   */
  resume() {
    if (this._active && this._isPaused) {
      this._isPaused = !1;
      let t, s;
      if (this.scopes)
        for (t = 0, s = this.scopes.length; t < s; t++)
          this.scopes[t].resume();
      for (t = 0, s = this.effects.length; t < s; t++)
        this.effects[t].resume();
    }
  }
  run(t) {
    if (this._active) {
      const s = Ie;
      try {
        return Ie = this, t();
      } finally {
        Ie = s;
      }
    }
  }
  /**
   * This should only be called on non-detached scopes
   * @internal
   */
  on() {
    ++this._on === 1 && (this.prevScope = Ie, Ie = this);
  }
  /**
   * This should only be called on non-detached scopes
   * @internal
   */
  off() {
    this._on > 0 && --this._on === 0 && (Ie = this.prevScope, this.prevScope = void 0);
  }
  stop(t) {
    if (this._active) {
      this._active = !1;
      let s, n;
      for (s = 0, n = this.effects.length; s < n; s++)
        this.effects[s].stop();
      for (this.effects.length = 0, s = 0, n = this.cleanups.length; s < n; s++)
        this.cleanups[s]();
      if (this.cleanups.length = 0, this.scopes) {
        for (s = 0, n = this.scopes.length; s < n; s++)
          this.scopes[s].stop(!0);
        this.scopes.length = 0;
      }
      if (!this.detached && this.parent && !t) {
        const l = this.parent.scopes.pop();
        l && l !== this && (this.parent.scopes[this.index] = l, l.index = this.index);
      }
      this.parent = void 0;
    }
  }
}
function lo() {
  return Ie;
}
let te;
const Ls = /* @__PURE__ */ new WeakSet();
class $l {
  constructor(t) {
    this.fn = t, this.deps = void 0, this.depsTail = void 0, this.flags = 5, this.next = void 0, this.cleanup = void 0, this.scheduler = void 0, Ie && Ie.active && Ie.effects.push(this);
  }
  pause() {
    this.flags |= 64;
  }
  resume() {
    this.flags & 64 && (this.flags &= -65, Ls.has(this) && (Ls.delete(this), this.trigger()));
  }
  /**
   * @internal
   */
  notify() {
    this.flags & 2 && !(this.flags & 32) || this.flags & 8 || Hl(this);
  }
  run() {
    if (!(this.flags & 1))
      return this.fn();
    this.flags |= 2, nl(this), Ll(this);
    const t = te, s = Le;
    te = this, Le = !0;
    try {
      return this.fn();
    } finally {
      Bl(this), te = t, Le = s, this.flags &= -3;
    }
  }
  stop() {
    if (this.flags & 1) {
      for (let t = this.deps; t; t = t.nextDep)
        bn(t);
      this.deps = this.depsTail = void 0, nl(this), this.onStop && this.onStop(), this.flags &= -2;
    }
  }
  trigger() {
    this.flags & 64 ? Ls.add(this) : this.scheduler ? this.scheduler() : this.runIfDirty();
  }
  /**
   * @internal
   */
  runIfDirty() {
    en(this) && this.run();
  }
  get dirty() {
    return en(this);
  }
}
let Vl = 0, Yt, Xt;
function Hl(e, t = !1) {
  if (e.flags |= 8, t) {
    e.next = Xt, Xt = e;
    return;
  }
  e.next = Yt, Yt = e;
}
function mn() {
  Vl++;
}
function yn() {
  if (--Vl > 0)
    return;
  if (Xt) {
    let t = Xt;
    for (Xt = void 0; t; ) {
      const s = t.next;
      t.next = void 0, t.flags &= -9, t = s;
    }
  }
  let e;
  for (; Yt; ) {
    let t = Yt;
    for (Yt = void 0; t; ) {
      const s = t.next;
      if (t.next = void 0, t.flags &= -9, t.flags & 1)
        try {
          t.trigger();
        } catch (n) {
          e || (e = n);
        }
      t = s;
    }
  }
  if (e) throw e;
}
function Ll(e) {
  for (let t = e.deps; t; t = t.nextDep)
    t.version = -1, t.prevActiveLink = t.dep.activeLink, t.dep.activeLink = t;
}
function Bl(e) {
  let t, s = e.depsTail, n = s;
  for (; n; ) {
    const l = n.prevDep;
    n.version === -1 ? (n === s && (s = l), bn(n), io(n)) : t = n, n.dep.activeLink = n.prevActiveLink, n.prevActiveLink = void 0, n = l;
  }
  e.deps = t, e.depsTail = s;
}
function en(e) {
  for (let t = e.deps; t; t = t.nextDep)
    if (t.dep.version !== t.version || t.dep.computed && (Wl(t.dep.computed) || t.dep.version !== t.version))
      return !0;
  return !!e._dirty;
}
function Wl(e) {
  if (e.flags & 4 && !(e.flags & 16) || (e.flags &= -17, e.globalVersion === ss) || (e.globalVersion = ss, !e.isSSR && e.flags & 128 && (!e.deps && !e._dirty || !en(e))))
    return;
  e.flags |= 2;
  const t = e.dep, s = te, n = Le;
  te = e, Le = !0;
  try {
    Ll(e);
    const l = e.fn(e._value);
    (t.version === 0 || mt(l, e._value)) && (e.flags |= 128, e._value = l, t.version++);
  } catch (l) {
    throw t.version++, l;
  } finally {
    te = s, Le = n, Bl(e), e.flags &= -3;
  }
}
function bn(e, t = !1) {
  const { dep: s, prevSub: n, nextSub: l } = e;
  if (n && (n.nextSub = l, e.prevSub = void 0), l && (l.prevSub = n, e.nextSub = void 0), s.subs === e && (s.subs = n, !n && s.computed)) {
    s.computed.flags &= -5;
    for (let i = s.computed.deps; i; i = i.nextDep)
      bn(i, !0);
  }
  !t && !--s.sc && s.map && s.map.delete(s.key);
}
function io(e) {
  const { prevDep: t, nextDep: s } = e;
  t && (t.nextDep = s, e.prevDep = void 0), s && (s.prevDep = t, e.nextDep = void 0);
}
let Le = !0;
const zl = [];
function ut() {
  zl.push(Le), Le = !1;
}
function ct() {
  const e = zl.pop();
  Le = e === void 0 ? !0 : e;
}
function nl(e) {
  const { cleanup: t } = e;
  if (e.cleanup = void 0, t) {
    const s = te;
    te = void 0;
    try {
      t();
    } finally {
      te = s;
    }
  }
}
let ss = 0;
class oo {
  constructor(t, s) {
    this.sub = t, this.dep = s, this.version = s.version, this.nextDep = this.prevDep = this.nextSub = this.prevSub = this.prevActiveLink = void 0;
  }
}
class _n {
  // TODO isolatedDeclarations "__v_skip"
  constructor(t) {
    this.computed = t, this.version = 0, this.activeLink = void 0, this.subs = void 0, this.map = void 0, this.key = void 0, this.sc = 0, this.__v_skip = !0;
  }
  track(t) {
    if (!te || !Le || te === this.computed)
      return;
    let s = this.activeLink;
    if (s === void 0 || s.sub !== te)
      s = this.activeLink = new oo(te, this), te.deps ? (s.prevDep = te.depsTail, te.depsTail.nextDep = s, te.depsTail = s) : te.deps = te.depsTail = s, ql(s);
    else if (s.version === -1 && (s.version = this.version, s.nextDep)) {
      const n = s.nextDep;
      n.prevDep = s.prevDep, s.prevDep && (s.prevDep.nextDep = n), s.prevDep = te.depsTail, s.nextDep = void 0, te.depsTail.nextDep = s, te.depsTail = s, te.deps === s && (te.deps = n);
    }
    return s;
  }
  trigger(t) {
    this.version++, ss++, this.notify(t);
  }
  notify(t) {
    mn();
    try {
      for (let s = this.subs; s; s = s.prevSub)
        s.sub.notify() && s.sub.dep.notify();
    } finally {
      yn();
    }
  }
}
function ql(e) {
  if (e.dep.sc++, e.sub.flags & 4) {
    const t = e.dep.computed;
    if (t && !e.dep.subs) {
      t.flags |= 20;
      for (let n = t.deps; n; n = n.nextDep)
        ql(n);
    }
    const s = e.dep.subs;
    s !== e && (e.prevSub = s, s && (s.nextSub = e)), e.dep.subs = e;
  }
}
const tn = /* @__PURE__ */ new WeakMap(), kt = Symbol(
  ""
), sn = Symbol(
  ""
), ns = Symbol(
  ""
);
function ge(e, t, s) {
  if (Le && te) {
    let n = tn.get(e);
    n || tn.set(e, n = /* @__PURE__ */ new Map());
    let l = n.get(s);
    l || (n.set(s, l = new _n()), l.map = n, l.key = s), l.track();
  }
}
function ot(e, t, s, n, l, i) {
  const r = tn.get(e);
  if (!r) {
    ss++;
    return;
  }
  const u = (f) => {
    f && f.trigger();
  };
  if (mn(), t === "clear")
    r.forEach(u);
  else {
    const f = D(e), g = f && gn(s);
    if (f && s === "length") {
      const p = Number(n);
      r.forEach((m, O) => {
        (O === "length" || O === ns || !Ze(O) && O >= p) && u(m);
      });
    } else
      switch ((s !== void 0 || r.has(void 0)) && u(r.get(s)), g && u(r.get(ns)), t) {
        case "add":
          f ? g && u(r.get("length")) : (u(r.get(kt)), Ut(e) && u(r.get(sn)));
          break;
        case "delete":
          f || (u(r.get(kt)), Ut(e) && u(r.get(sn)));
          break;
        case "set":
          Ut(e) && u(r.get(kt));
          break;
      }
  }
  yn();
}
function Rt(e) {
  const t = J(e);
  return t === e ? t : (ge(t, "iterate", ns), je(e) ? t : t.map(he));
}
function Is(e) {
  return ge(e = J(e), "iterate", ns), e;
}
const ro = {
  __proto__: null,
  [Symbol.iterator]() {
    return Bs(this, Symbol.iterator, he);
  },
  concat(...e) {
    return Rt(this).concat(
      ...e.map((t) => D(t) ? Rt(t) : t)
    );
  },
  entries() {
    return Bs(this, "entries", (e) => (e[1] = he(e[1]), e));
  },
  every(e, t) {
    return lt(this, "every", e, t, void 0, arguments);
  },
  filter(e, t) {
    return lt(this, "filter", e, t, (s) => s.map(he), arguments);
  },
  find(e, t) {
    return lt(this, "find", e, t, he, arguments);
  },
  findIndex(e, t) {
    return lt(this, "findIndex", e, t, void 0, arguments);
  },
  findLast(e, t) {
    return lt(this, "findLast", e, t, he, arguments);
  },
  findLastIndex(e, t) {
    return lt(this, "findLastIndex", e, t, void 0, arguments);
  },
  // flat, flatMap could benefit from ARRAY_ITERATE but are not straight-forward to implement
  forEach(e, t) {
    return lt(this, "forEach", e, t, void 0, arguments);
  },
  includes(...e) {
    return Ws(this, "includes", e);
  },
  indexOf(...e) {
    return Ws(this, "indexOf", e);
  },
  join(e) {
    return Rt(this).join(e);
  },
  // keys() iterator only reads `length`, no optimisation required
  lastIndexOf(...e) {
    return Ws(this, "lastIndexOf", e);
  },
  map(e, t) {
    return lt(this, "map", e, t, void 0, arguments);
  },
  pop() {
    return Wt(this, "pop");
  },
  push(...e) {
    return Wt(this, "push", e);
  },
  reduce(e, ...t) {
    return ll(this, "reduce", e, t);
  },
  reduceRight(e, ...t) {
    return ll(this, "reduceRight", e, t);
  },
  shift() {
    return Wt(this, "shift");
  },
  // slice could use ARRAY_ITERATE but also seems to beg for range tracking
  some(e, t) {
    return lt(this, "some", e, t, void 0, arguments);
  },
  splice(...e) {
    return Wt(this, "splice", e);
  },
  toReversed() {
    return Rt(this).toReversed();
  },
  toSorted(e) {
    return Rt(this).toSorted(e);
  },
  toSpliced(...e) {
    return Rt(this).toSpliced(...e);
  },
  unshift(...e) {
    return Wt(this, "unshift", e);
  },
  values() {
    return Bs(this, "values", he);
  }
};
function Bs(e, t, s) {
  const n = Is(e), l = n[t]();
  return n !== e && !je(e) && (l._next = l.next, l.next = () => {
    const i = l._next();
    return i.value && (i.value = s(i.value)), i;
  }), l;
}
const ao = Array.prototype;
function lt(e, t, s, n, l, i) {
  const r = Is(e), u = r !== e && !je(e), f = r[t];
  if (f !== ao[t]) {
    const m = f.apply(e, i);
    return u ? he(m) : m;
  }
  let g = s;
  r !== e && (u ? g = function(m, O) {
    return s.call(this, he(m), O, e);
  } : s.length > 2 && (g = function(m, O) {
    return s.call(this, m, O, e);
  }));
  const p = f.call(r, g, n);
  return u && l ? l(p) : p;
}
function ll(e, t, s, n) {
  const l = Is(e);
  let i = s;
  return l !== e && (je(e) ? s.length > 3 && (i = function(r, u, f) {
    return s.call(this, r, u, f, e);
  }) : i = function(r, u, f) {
    return s.call(this, r, he(u), f, e);
  }), l[t](i, ...n);
}
function Ws(e, t, s) {
  const n = J(e);
  ge(n, "iterate", ns);
  const l = n[t](...s);
  return (l === -1 || l === !1) && Cn(s[0]) ? (s[0] = J(s[0]), n[t](...s)) : l;
}
function Wt(e, t, s = []) {
  ut(), mn();
  const n = J(e)[t].apply(e, s);
  return yn(), ct(), n;
}
const uo = /* @__PURE__ */ dn("__proto__,__v_isRef,__isVue"), Jl = new Set(
  /* @__PURE__ */ Object.getOwnPropertyNames(Symbol).filter((e) => e !== "arguments" && e !== "caller").map((e) => Symbol[e]).filter(Ze)
);
function co(e) {
  Ze(e) || (e = String(e));
  const t = J(this);
  return ge(t, "has", e), t.hasOwnProperty(e);
}
class Gl {
  constructor(t = !1, s = !1) {
    this._isReadonly = t, this._isShallow = s;
  }
  get(t, s, n) {
    if (s === "__v_skip") return t.__v_skip;
    const l = this._isReadonly, i = this._isShallow;
    if (s === "__v_isReactive")
      return !l;
    if (s === "__v_isReadonly")
      return l;
    if (s === "__v_isShallow")
      return i;
    if (s === "__v_raw")
      return n === (l ? i ? xo : Ql : i ? Zl : Xl).get(t) || // receiver is not the reactive proxy, but has the same prototype
      // this means the receiver is a user proxy of the reactive proxy
      Object.getPrototypeOf(t) === Object.getPrototypeOf(n) ? t : void 0;
    const r = D(t);
    if (!l) {
      let f;
      if (r && (f = ro[s]))
        return f;
      if (s === "hasOwnProperty")
        return co;
    }
    const u = Reflect.get(
      t,
      s,
      // if this is a proxy wrapping a ref, return methods using the raw ref
      // as receiver so that we don't have to call `toRaw` on the ref in all
      // its class methods
      ve(t) ? t : n
    );
    return (Ze(s) ? Jl.has(s) : uo(s)) || (l || ge(t, "get", s), i) ? u : ve(u) ? r && gn(s) ? u : u.value : le(u) ? l ? ei(u) : wn(u) : u;
  }
}
class Yl extends Gl {
  constructor(t = !1) {
    super(!1, t);
  }
  set(t, s, n, l) {
    let i = t[s];
    if (!this._isShallow) {
      const f = bt(i);
      if (!je(n) && !bt(n) && (i = J(i), n = J(n)), !D(t) && ve(i) && !ve(n))
        return f ? !1 : (i.value = n, !0);
    }
    const r = D(t) && gn(s) ? Number(s) < t.length : G(t, s), u = Reflect.set(
      t,
      s,
      n,
      ve(t) ? t : l
    );
    return t === J(l) && (r ? mt(n, i) && ot(t, "set", s, n) : ot(t, "add", s, n)), u;
  }
  deleteProperty(t, s) {
    const n = G(t, s);
    t[s];
    const l = Reflect.deleteProperty(t, s);
    return l && n && ot(t, "delete", s, void 0), l;
  }
  has(t, s) {
    const n = Reflect.has(t, s);
    return (!Ze(s) || !Jl.has(s)) && ge(t, "has", s), n;
  }
  ownKeys(t) {
    return ge(
      t,
      "iterate",
      D(t) ? "length" : kt
    ), Reflect.ownKeys(t);
  }
}
class fo extends Gl {
  constructor(t = !1) {
    super(!0, t);
  }
  set(t, s) {
    return !0;
  }
  deleteProperty(t, s) {
    return !0;
  }
}
const po = /* @__PURE__ */ new Yl(), ho = /* @__PURE__ */ new fo(), go = /* @__PURE__ */ new Yl(!0);
const nn = (e) => e, ds = (e) => Reflect.getPrototypeOf(e);
function vo(e, t, s) {
  return function(...n) {
    const l = this.__v_raw, i = J(l), r = Ut(i), u = e === "entries" || e === Symbol.iterator && r, f = e === "keys" && r, g = l[e](...n), p = s ? nn : t ? ws : he;
    return !t && ge(
      i,
      "iterate",
      f ? sn : kt
    ), {
      // iterator protocol
      next() {
        const { value: m, done: O } = g.next();
        return O ? { value: m, done: O } : {
          value: u ? [p(m[0]), p(m[1])] : p(m),
          done: O
        };
      },
      // iterable protocol
      [Symbol.iterator]() {
        return this;
      }
    };
  };
}
function ps(e) {
  return function(...t) {
    return e === "delete" ? !1 : e === "clear" ? void 0 : this;
  };
}
function mo(e, t) {
  const s = {
    get(l) {
      const i = this.__v_raw, r = J(i), u = J(l);
      e || (mt(l, u) && ge(r, "get", l), ge(r, "get", u));
      const { has: f } = ds(r), g = t ? nn : e ? ws : he;
      if (f.call(r, l))
        return g(i.get(l));
      if (f.call(r, u))
        return g(i.get(u));
      i !== r && i.get(l);
    },
    get size() {
      const l = this.__v_raw;
      return !e && ge(J(l), "iterate", kt), Reflect.get(l, "size", l);
    },
    has(l) {
      const i = this.__v_raw, r = J(i), u = J(l);
      return e || (mt(l, u) && ge(r, "has", l), ge(r, "has", u)), l === u ? i.has(l) : i.has(l) || i.has(u);
    },
    forEach(l, i) {
      const r = this, u = r.__v_raw, f = J(u), g = t ? nn : e ? ws : he;
      return !e && ge(f, "iterate", kt), u.forEach((p, m) => l.call(i, g(p), g(m), r));
    }
  };
  return Te(
    s,
    e ? {
      add: ps("add"),
      set: ps("set"),
      delete: ps("delete"),
      clear: ps("clear")
    } : {
      add(l) {
        !t && !je(l) && !bt(l) && (l = J(l));
        const i = J(this);
        return ds(i).has.call(i, l) || (i.add(l), ot(i, "add", l, l)), this;
      },
      set(l, i) {
        !t && !je(i) && !bt(i) && (i = J(i));
        const r = J(this), { has: u, get: f } = ds(r);
        let g = u.call(r, l);
        g || (l = J(l), g = u.call(r, l));
        const p = f.call(r, l);
        return r.set(l, i), g ? mt(i, p) && ot(r, "set", l, i) : ot(r, "add", l, i), this;
      },
      delete(l) {
        const i = J(this), { has: r, get: u } = ds(i);
        let f = r.call(i, l);
        f || (l = J(l), f = r.call(i, l)), u && u.call(i, l);
        const g = i.delete(l);
        return f && ot(i, "delete", l, void 0), g;
      },
      clear() {
        const l = J(this), i = l.size !== 0, r = l.clear();
        return i && ot(
          l,
          "clear",
          void 0,
          void 0
        ), r;
      }
    }
  ), [
    "keys",
    "values",
    "entries",
    Symbol.iterator
  ].forEach((l) => {
    s[l] = vo(l, e, t);
  }), s;
}
function xn(e, t) {
  const s = mo(e, t);
  return (n, l, i) => l === "__v_isReactive" ? !e : l === "__v_isReadonly" ? e : l === "__v_raw" ? n : Reflect.get(
    G(s, l) && l in n ? s : n,
    l,
    i
  );
}
const yo = {
  get: /* @__PURE__ */ xn(!1, !1)
}, bo = {
  get: /* @__PURE__ */ xn(!1, !0)
}, _o = {
  get: /* @__PURE__ */ xn(!0, !1)
};
const Xl = /* @__PURE__ */ new WeakMap(), Zl = /* @__PURE__ */ new WeakMap(), Ql = /* @__PURE__ */ new WeakMap(), xo = /* @__PURE__ */ new WeakMap();
function wo(e) {
  switch (e) {
    case "Object":
    case "Array":
      return 1;
    case "Map":
    case "Set":
    case "WeakMap":
    case "WeakSet":
      return 2;
    default:
      return 0;
  }
}
function So(e) {
  return e.__v_skip || !Object.isExtensible(e) ? 0 : wo(qi(e));
}
function wn(e) {
  return bt(e) ? e : Sn(
    e,
    !1,
    po,
    yo,
    Xl
  );
}
function Co(e) {
  return Sn(
    e,
    !1,
    go,
    bo,
    Zl
  );
}
function ei(e) {
  return Sn(
    e,
    !0,
    ho,
    _o,
    Ql
  );
}
function Sn(e, t, s, n, l) {
  if (!le(e) || e.__v_raw && !(t && e.__v_isReactive))
    return e;
  const i = So(e);
  if (i === 0)
    return e;
  const r = l.get(e);
  if (r)
    return r;
  const u = new Proxy(
    e,
    i === 2 ? n : s
  );
  return l.set(e, u), u;
}
function Kt(e) {
  return bt(e) ? Kt(e.__v_raw) : !!(e && e.__v_isReactive);
}
function bt(e) {
  return !!(e && e.__v_isReadonly);
}
function je(e) {
  return !!(e && e.__v_isShallow);
}
function Cn(e) {
  return e ? !!e.__v_raw : !1;
}
function J(e) {
  const t = e && e.__v_raw;
  return t ? J(t) : e;
}
function To(e) {
  return !G(e, "__v_skip") && Object.isExtensible(e) && Qs(e, "__v_skip", !0), e;
}
const he = (e) => le(e) ? wn(e) : e, ws = (e) => le(e) ? ei(e) : e;
function ve(e) {
  return e ? e.__v_isRef === !0 : !1;
}
function z(e) {
  return Ao(e, !1);
}
function Ao(e, t) {
  return ve(e) ? e : new Po(e, t);
}
class Po {
  constructor(t, s) {
    this.dep = new _n(), this.__v_isRef = !0, this.__v_isShallow = !1, this._rawValue = s ? t : J(t), this._value = s ? t : he(t), this.__v_isShallow = s;
  }
  get value() {
    return this.dep.track(), this._value;
  }
  set value(t) {
    const s = this._rawValue, n = this.__v_isShallow || je(t) || bt(t);
    t = n ? t : J(t), mt(t, s) && (this._rawValue = t, this._value = n ? t : he(t), this.dep.trigger());
  }
}
function ti(e) {
  return ve(e) ? e.value : e;
}
const ko = {
  get: (e, t, s) => t === "__v_raw" ? e : ti(Reflect.get(e, t, s)),
  set: (e, t, s, n) => {
    const l = e[t];
    return ve(l) && !ve(s) ? (l.value = s, !0) : Reflect.set(e, t, s, n);
  }
};
function si(e) {
  return Kt(e) ? e : new Proxy(e, ko);
}
class Oo {
  constructor(t, s, n) {
    this.fn = t, this.setter = s, this._value = void 0, this.dep = new _n(this), this.__v_isRef = !0, this.deps = void 0, this.depsTail = void 0, this.flags = 16, this.globalVersion = ss - 1, this.next = void 0, this.effect = this, this.__v_isReadonly = !s, this.isSSR = n;
  }
  /**
   * @internal
   */
  notify() {
    if (this.flags |= 16, !(this.flags & 8) && // avoid infinite self recursion
    te !== this)
      return Hl(this, !0), !0;
  }
  get value() {
    const t = this.dep.track();
    return Wl(this), t && (t.version = this.dep.version), this._value;
  }
  set value(t) {
    this.setter && this.setter(t);
  }
}
function Mo(e, t, s = !1) {
  let n, l;
  return K(e) ? n = e : (n = e.get, l = e.set), new Oo(n, l, s);
}
const hs = {}, Ss = /* @__PURE__ */ new WeakMap();
let Pt;
function Eo(e, t = !1, s = Pt) {
  if (s) {
    let n = Ss.get(s);
    n || Ss.set(s, n = []), n.push(e);
  }
}
function Io(e, t, s = Q) {
  const { immediate: n, deep: l, once: i, scheduler: r, augmentJob: u, call: f } = s, g = (F) => l ? F : je(F) || l === !1 || l === 0 ? rt(F, 1) : rt(F);
  let p, m, O, E, V = !1, j = !1;
  if (ve(e) ? (m = () => e.value, V = je(e)) : Kt(e) ? (m = () => g(e), V = !0) : D(e) ? (j = !0, V = e.some((F) => Kt(F) || je(F)), m = () => e.map((F) => {
    if (ve(F))
      return F.value;
    if (Kt(F))
      return g(F);
    if (K(F))
      return f ? f(F, 2) : F();
  })) : K(e) ? t ? m = f ? () => f(e, 2) : e : m = () => {
    if (O) {
      ut();
      try {
        O();
      } finally {
        ct();
      }
    }
    const F = Pt;
    Pt = p;
    try {
      return f ? f(e, 3, [E]) : e(E);
    } finally {
      Pt = F;
    }
  } : m = Ye, t && l) {
    const F = m, oe = l === !0 ? 1 / 0 : l;
    m = () => rt(F(), oe);
  }
  const H = lo(), N = () => {
    p.stop(), H && H.active && hn(H.effects, p);
  };
  if (i && t) {
    const F = t;
    t = (...oe) => {
      F(...oe), N();
    };
  }
  let se = j ? new Array(e.length).fill(hs) : hs;
  const L = (F) => {
    if (!(!(p.flags & 1) || !p.dirty && !F))
      if (t) {
        const oe = p.run();
        if (l || V || (j ? oe.some((me, Z) => mt(me, se[Z])) : mt(oe, se))) {
          O && O();
          const me = Pt;
          Pt = p;
          try {
            const Z = [
              oe,
              // pass undefined as the old value when it's changed for the first time
              se === hs ? void 0 : j && se[0] === hs ? [] : se,
              E
            ];
            se = oe, f ? f(t, 3, Z) : (
              // @ts-expect-error
              t(...Z)
            );
          } finally {
            Pt = me;
          }
        }
      } else
        p.run();
  };
  return u && u(L), p = new $l(m), p.scheduler = r ? () => r(L, !1) : L, E = (F) => Eo(F, !1, p), O = p.onStop = () => {
    const F = Ss.get(p);
    if (F) {
      if (f)
        f(F, 4);
      else
        for (const oe of F) oe();
      Ss.delete(p);
    }
  }, t ? n ? L(!0) : se = p.run() : r ? r(L.bind(null, !0), !0) : p.run(), N.pause = p.pause.bind(p), N.resume = p.resume.bind(p), N.stop = N, N;
}
function rt(e, t = 1 / 0, s) {
  if (t <= 0 || !le(e) || e.__v_skip || (s = s || /* @__PURE__ */ new Set(), s.has(e)))
    return e;
  if (s.add(e), t--, ve(e))
    rt(e.value, t, s);
  else if (D(e))
    for (let n = 0; n < e.length; n++)
      rt(e[n], t, s);
  else if (Ht(e) || Ut(e))
    e.forEach((n) => {
      rt(n, t, s);
    });
  else if (Dl(e)) {
    for (const n in e)
      rt(e[n], t, s);
    for (const n of Object.getOwnPropertySymbols(e))
      Object.prototype.propertyIsEnumerable.call(e, n) && rt(e[n], t, s);
  }
  return e;
}
/**
* @vue/runtime-core v3.5.18
* (c) 2018-present Yuxi (Evan) You and Vue contributors
* @license MIT
**/
function as(e, t, s, n) {
  try {
    return n ? e(...n) : e();
  } catch (l) {
    Rs(l, t, s);
  }
}
function Qe(e, t, s, n) {
  if (K(e)) {
    const l = as(e, t, s, n);
    return l && Rl(l) && l.catch((i) => {
      Rs(i, t, s);
    }), l;
  }
  if (D(e)) {
    const l = [];
    for (let i = 0; i < e.length; i++)
      l.push(Qe(e[i], t, s, n));
    return l;
  }
}
function Rs(e, t, s, n = !0) {
  const l = t ? t.vnode : null, { errorHandler: i, throwUnhandledErrorInProduction: r } = t && t.appContext.config || Q;
  if (t) {
    let u = t.parent;
    const f = t.proxy, g = `https://vuejs.org/error-reference/#runtime-${s}`;
    for (; u; ) {
      const p = u.ec;
      if (p) {
        for (let m = 0; m < p.length; m++)
          if (p[m](e, f, g) === !1)
            return;
      }
      u = u.parent;
    }
    if (i) {
      ut(), as(i, null, 10, [
        e,
        f,
        g
      ]), ct();
      return;
    }
  }
  Ro(e, s, l, n, r);
}
function Ro(e, t, s, n = !0, l = !1) {
  if (l)
    throw e;
  console.error(e);
}
const Se = [];
let Je = -1;
const jt = [];
let gt = null, Ft = 0;
const ni = /* @__PURE__ */ Promise.resolve();
let Cs = null;
function li(e) {
  const t = Cs || ni;
  return e ? t.then(this ? e.bind(this) : e) : t;
}
function Fo(e) {
  let t = Je + 1, s = Se.length;
  for (; t < s; ) {
    const n = t + s >>> 1, l = Se[n], i = ls(l);
    i < e || i === e && l.flags & 2 ? t = n + 1 : s = n;
  }
  return t;
}
function Tn(e) {
  if (!(e.flags & 1)) {
    const t = ls(e), s = Se[Se.length - 1];
    !s || // fast path when the job id is larger than the tail
    !(e.flags & 2) && t >= ls(s) ? Se.push(e) : Se.splice(Fo(t), 0, e), e.flags |= 1, ii();
  }
}
function ii() {
  Cs || (Cs = ni.then(ri));
}
function Do(e) {
  D(e) ? jt.push(...e) : gt && e.id === -1 ? gt.splice(Ft + 1, 0, e) : e.flags & 1 || (jt.push(e), e.flags |= 1), ii();
}
function il(e, t, s = Je + 1) {
  for (; s < Se.length; s++) {
    const n = Se[s];
    if (n && n.flags & 2) {
      if (e && n.id !== e.uid)
        continue;
      Se.splice(s, 1), s--, n.flags & 4 && (n.flags &= -2), n(), n.flags & 4 || (n.flags &= -2);
    }
  }
}
function oi(e) {
  if (jt.length) {
    const t = [...new Set(jt)].sort(
      (s, n) => ls(s) - ls(n)
    );
    if (jt.length = 0, gt) {
      gt.push(...t);
      return;
    }
    for (gt = t, Ft = 0; Ft < gt.length; Ft++) {
      const s = gt[Ft];
      s.flags & 4 && (s.flags &= -2), s.flags & 8 || s(), s.flags &= -2;
    }
    gt = null, Ft = 0;
  }
}
const ls = (e) => e.id == null ? e.flags & 2 ? -1 : 1 / 0 : e.id;
function ri(e) {
  try {
    for (Je = 0; Je < Se.length; Je++) {
      const t = Se[Je];
      t && !(t.flags & 8) && (t.flags & 4 && (t.flags &= -2), as(
        t,
        t.i,
        t.i ? 15 : 14
      ), t.flags & 4 || (t.flags &= -2));
    }
  } finally {
    for (; Je < Se.length; Je++) {
      const t = Se[Je];
      t && (t.flags &= -2);
    }
    Je = -1, Se.length = 0, oi(), Cs = null, (Se.length || jt.length) && ri();
  }
}
let Ke = null, ai = null;
function Ts(e) {
  const t = Ke;
  return Ke = e, ai = e && e.type.__scopeId || null, t;
}
function Uo(e, t = Ke, s) {
  if (!t || e._n)
    return e;
  const n = (...l) => {
    n._d && hl(-1);
    const i = Ts(t);
    let r;
    try {
      r = e(...l);
    } finally {
      Ts(i), n._d && hl(1);
    }
    return r;
  };
  return n._n = !0, n._c = !0, n._d = !0, n;
}
function xe(e, t) {
  if (Ke === null)
    return e;
  const s = Ks(Ke), n = e.dirs || (e.dirs = []);
  for (let l = 0; l < t.length; l++) {
    let [i, r, u, f = Q] = t[l];
    i && (K(i) && (i = {
      mounted: i,
      updated: i
    }), i.deep && rt(r), n.push({
      dir: i,
      instance: s,
      value: r,
      oldValue: void 0,
      arg: u,
      modifiers: f
    }));
  }
  return e;
}
function Tt(e, t, s, n) {
  const l = e.dirs, i = t && t.dirs;
  for (let r = 0; r < l.length; r++) {
    const u = l[r];
    i && (u.oldValue = i[r].value);
    let f = u.dir[n];
    f && (ut(), Qe(f, s, 8, [
      e.el,
      u,
      e,
      t
    ]), ct());
  }
}
const Ko = Symbol("_vte"), jo = (e) => e.__isTeleport;
function An(e, t) {
  e.shapeFlag & 6 && e.component ? (e.transition = t, An(e.component.subTree, t)) : e.shapeFlag & 128 ? (e.ssContent.transition = t.clone(e.ssContent), e.ssFallback.transition = t.clone(e.ssFallback)) : e.transition = t;
}
function ui(e) {
  e.ids = [e.ids[0] + e.ids[2]++ + "-", 0, 0];
}
function Zt(e, t, s, n, l = !1) {
  if (D(e)) {
    e.forEach(
      (V, j) => Zt(
        V,
        t && (D(t) ? t[j] : t),
        s,
        n,
        l
      )
    );
    return;
  }
  if (Qt(n) && !l) {
    n.shapeFlag & 512 && n.type.__asyncResolved && n.component.subTree.component && Zt(e, t, s, n.component.subTree);
    return;
  }
  const i = n.shapeFlag & 4 ? Ks(n.component) : n.el, r = l ? null : i, { i: u, r: f } = e, g = t && t.r, p = u.refs === Q ? u.refs = {} : u.refs, m = u.setupState, O = J(m), E = m === Q ? () => !1 : (V) => G(O, V);
  if (g != null && g !== f && (de(g) ? (p[g] = null, E(g) && (m[g] = null)) : ve(g) && (g.value = null)), K(f))
    as(f, u, 12, [r, p]);
  else {
    const V = de(f), j = ve(f);
    if (V || j) {
      const H = () => {
        if (e.f) {
          const N = V ? E(f) ? m[f] : p[f] : f.value;
          l ? D(N) && hn(N, i) : D(N) ? N.includes(i) || N.push(i) : V ? (p[f] = [i], E(f) && (m[f] = p[f])) : (f.value = [i], e.k && (p[e.k] = f.value));
        } else V ? (p[f] = r, E(f) && (m[f] = r)) : j && (f.value = r, e.k && (p[e.k] = r));
      };
      r ? (H.id = -1, Fe(H, s)) : H();
    }
  }
}
Ms().requestIdleCallback;
Ms().cancelIdleCallback;
const Qt = (e) => !!e.type.__asyncLoader, ci = (e) => e.type.__isKeepAlive;
function No(e, t) {
  fi(e, "a", t);
}
function $o(e, t) {
  fi(e, "da", t);
}
function fi(e, t, s = Ce) {
  const n = e.__wdc || (e.__wdc = () => {
    let l = s;
    for (; l; ) {
      if (l.isDeactivated)
        return;
      l = l.parent;
    }
    return e();
  });
  if (Fs(t, n, s), s) {
    let l = s.parent;
    for (; l && l.parent; )
      ci(l.parent.vnode) && Vo(n, t, s, l), l = l.parent;
  }
}
function Vo(e, t, s, n) {
  const l = Fs(
    t,
    e,
    n,
    !0
    /* prepend */
  );
  pi(() => {
    hn(n[t], l);
  }, s);
}
function Fs(e, t, s = Ce, n = !1) {
  if (s) {
    const l = s[e] || (s[e] = []), i = t.__weh || (t.__weh = (...r) => {
      ut();
      const u = us(s), f = Qe(t, s, e, r);
      return u(), ct(), f;
    });
    return n ? l.unshift(i) : l.push(i), i;
  }
}
const ft = (e) => (t, s = Ce) => {
  (!os || e === "sp") && Fs(e, (...n) => t(...n), s);
}, Ho = ft("bm"), di = ft("m"), Lo = ft(
  "bu"
), Bo = ft("u"), Wo = ft(
  "bum"
), pi = ft("um"), zo = ft(
  "sp"
), qo = ft("rtg"), Jo = ft("rtc");
function Go(e, t = Ce) {
  Fs("ec", e, t);
}
const Yo = Symbol.for("v-ndc");
function He(e, t, s, n) {
  let l;
  const i = s, r = D(e);
  if (r || de(e)) {
    const u = r && Kt(e);
    let f = !1, g = !1;
    u && (f = !je(e), g = bt(e), e = Is(e)), l = new Array(e.length);
    for (let p = 0, m = e.length; p < m; p++)
      l[p] = t(
        f ? g ? ws(he(e[p])) : he(e[p]) : e[p],
        p,
        void 0,
        i
      );
  } else if (typeof e == "number") {
    l = new Array(e);
    for (let u = 0; u < e; u++)
      l[u] = t(u + 1, u, void 0, i);
  } else if (le(e))
    if (e[Symbol.iterator])
      l = Array.from(
        e,
        (u, f) => t(u, f, void 0, i)
      );
    else {
      const u = Object.keys(e);
      l = new Array(u.length);
      for (let f = 0, g = u.length; f < g; f++) {
        const p = u[f];
        l[f] = t(e[p], p, f, i);
      }
    }
  else
    l = [];
  return l;
}
const ln = (e) => e ? Fi(e) ? Ks(e) : ln(e.parent) : null, es = (
  // Move PURE marker to new line to workaround compiler discarding it
  // due to type annotation
  /* @__PURE__ */ Te(/* @__PURE__ */ Object.create(null), {
    $: (e) => e,
    $el: (e) => e.vnode.el,
    $data: (e) => e.data,
    $props: (e) => e.props,
    $attrs: (e) => e.attrs,
    $slots: (e) => e.slots,
    $refs: (e) => e.refs,
    $parent: (e) => ln(e.parent),
    $root: (e) => ln(e.root),
    $host: (e) => e.ce,
    $emit: (e) => e.emit,
    $options: (e) => gi(e),
    $forceUpdate: (e) => e.f || (e.f = () => {
      Tn(e.update);
    }),
    $nextTick: (e) => e.n || (e.n = li.bind(e.proxy)),
    $watch: (e) => yr.bind(e)
  })
), zs = (e, t) => e !== Q && !e.__isScriptSetup && G(e, t), Xo = {
  get({ _: e }, t) {
    if (t === "__v_skip")
      return !0;
    const { ctx: s, setupState: n, data: l, props: i, accessCache: r, type: u, appContext: f } = e;
    let g;
    if (t[0] !== "$") {
      const E = r[t];
      if (E !== void 0)
        switch (E) {
          case 1:
            return n[t];
          case 2:
            return l[t];
          case 4:
            return s[t];
          case 3:
            return i[t];
        }
      else {
        if (zs(n, t))
          return r[t] = 1, n[t];
        if (l !== Q && G(l, t))
          return r[t] = 2, l[t];
        if (
          // only cache other properties when instance has declared (thus stable)
          // props
          (g = e.propsOptions[0]) && G(g, t)
        )
          return r[t] = 3, i[t];
        if (s !== Q && G(s, t))
          return r[t] = 4, s[t];
        on && (r[t] = 0);
      }
    }
    const p = es[t];
    let m, O;
    if (p)
      return t === "$attrs" && ge(e.attrs, "get", ""), p(e);
    if (
      // css module (injected by vue-loader)
      (m = u.__cssModules) && (m = m[t])
    )
      return m;
    if (s !== Q && G(s, t))
      return r[t] = 4, s[t];
    if (
      // global properties
      O = f.config.globalProperties, G(O, t)
    )
      return O[t];
  },
  set({ _: e }, t, s) {
    const { data: n, setupState: l, ctx: i } = e;
    return zs(l, t) ? (l[t] = s, !0) : n !== Q && G(n, t) ? (n[t] = s, !0) : G(e.props, t) || t[0] === "$" && t.slice(1) in e ? !1 : (i[t] = s, !0);
  },
  has({
    _: { data: e, setupState: t, accessCache: s, ctx: n, appContext: l, propsOptions: i }
  }, r) {
    let u;
    return !!s[r] || e !== Q && G(e, r) || zs(t, r) || (u = i[0]) && G(u, r) || G(n, r) || G(es, r) || G(l.config.globalProperties, r);
  },
  defineProperty(e, t, s) {
    return s.get != null ? e._.accessCache[t] = 0 : G(s, "value") && this.set(e, t, s.value, null), Reflect.defineProperty(e, t, s);
  }
};
function ol(e) {
  return D(e) ? e.reduce(
    (t, s) => (t[s] = null, t),
    {}
  ) : e;
}
let on = !0;
function Zo(e) {
  const t = gi(e), s = e.proxy, n = e.ctx;
  on = !1, t.beforeCreate && rl(t.beforeCreate, e, "bc");
  const {
    // state
    data: l,
    computed: i,
    methods: r,
    watch: u,
    provide: f,
    inject: g,
    // lifecycle
    created: p,
    beforeMount: m,
    mounted: O,
    beforeUpdate: E,
    updated: V,
    activated: j,
    deactivated: H,
    beforeDestroy: N,
    beforeUnmount: se,
    destroyed: L,
    unmounted: F,
    render: oe,
    renderTracked: me,
    renderTriggered: Z,
    errorCaptured: Ae,
    serverPrefetch: et,
    // public API
    expose: Pe,
    inheritAttrs: $e,
    // assets
    components: dt,
    directives: pt,
    filters: Be
  } = t;
  if (g && Qo(g, n, null), r)
    for (const Y in r) {
      const q = r[Y];
      K(q) && (n[Y] = q.bind(s));
    }
  if (l) {
    const Y = l.call(s, s);
    le(Y) && (e.data = wn(Y));
  }
  if (on = !0, i)
    for (const Y in i) {
      const q = i[Y], Ve = K(q) ? q.bind(s, s) : K(q.get) ? q.get.bind(s, s) : Ye, tt = !K(q) && K(q.set) ? q.set.bind(s) : Ye, ke = ee({
        get: Ve,
        set: tt
      });
      Object.defineProperty(n, Y, {
        enumerable: !0,
        configurable: !0,
        get: () => ke.value,
        set: (Oe) => ke.value = Oe
      });
    }
  if (u)
    for (const Y in u)
      hi(u[Y], n, s, Y);
  if (f) {
    const Y = K(f) ? f.call(s) : f;
    Reflect.ownKeys(Y).forEach((q) => {
      ir(q, Y[q]);
    });
  }
  p && rl(p, e, "c");
  function fe(Y, q) {
    D(q) ? q.forEach((Ve) => Y(Ve.bind(s))) : q && Y(q.bind(s));
  }
  if (fe(Ho, m), fe(di, O), fe(Lo, E), fe(Bo, V), fe(No, j), fe($o, H), fe(Go, Ae), fe(Jo, me), fe(qo, Z), fe(Wo, se), fe(pi, F), fe(zo, et), D(Pe))
    if (Pe.length) {
      const Y = e.exposed || (e.exposed = {});
      Pe.forEach((q) => {
        Object.defineProperty(Y, q, {
          get: () => s[q],
          set: (Ve) => s[q] = Ve,
          enumerable: !0
        });
      });
    } else e.exposed || (e.exposed = {});
  oe && e.render === Ye && (e.render = oe), $e != null && (e.inheritAttrs = $e), dt && (e.components = dt), pt && (e.directives = pt), et && ui(e);
}
function Qo(e, t, s = Ye) {
  D(e) && (e = rn(e));
  for (const n in e) {
    const l = e[n];
    let i;
    le(l) ? "default" in l ? i = ms(
      l.from || n,
      l.default,
      !0
    ) : i = ms(l.from || n) : i = ms(l), ve(i) ? Object.defineProperty(t, n, {
      enumerable: !0,
      configurable: !0,
      get: () => i.value,
      set: (r) => i.value = r
    }) : t[n] = i;
  }
}
function rl(e, t, s) {
  Qe(
    D(e) ? e.map((n) => n.bind(t.proxy)) : e.bind(t.proxy),
    t,
    s
  );
}
function hi(e, t, s, n) {
  let l = n.includes(".") ? ki(s, n) : () => s[n];
  if (de(e)) {
    const i = t[e];
    K(i) && Js(l, i);
  } else if (K(e))
    Js(l, e.bind(s));
  else if (le(e))
    if (D(e))
      e.forEach((i) => hi(i, t, s, n));
    else {
      const i = K(e.handler) ? e.handler.bind(s) : t[e.handler];
      K(i) && Js(l, i, e);
    }
}
function gi(e) {
  const t = e.type, { mixins: s, extends: n } = t, {
    mixins: l,
    optionsCache: i,
    config: { optionMergeStrategies: r }
  } = e.appContext, u = i.get(t);
  let f;
  return u ? f = u : !l.length && !s && !n ? f = t : (f = {}, l.length && l.forEach(
    (g) => As(f, g, r, !0)
  ), As(f, t, r)), le(t) && i.set(t, f), f;
}
function As(e, t, s, n = !1) {
  const { mixins: l, extends: i } = t;
  i && As(e, i, s, !0), l && l.forEach(
    (r) => As(e, r, s, !0)
  );
  for (const r in t)
    if (!(n && r === "expose")) {
      const u = er[r] || s && s[r];
      e[r] = u ? u(e[r], t[r]) : t[r];
    }
  return e;
}
const er = {
  data: al,
  props: ul,
  emits: ul,
  // objects
  methods: Jt,
  computed: Jt,
  // lifecycle
  beforeCreate: we,
  created: we,
  beforeMount: we,
  mounted: we,
  beforeUpdate: we,
  updated: we,
  beforeDestroy: we,
  beforeUnmount: we,
  destroyed: we,
  unmounted: we,
  activated: we,
  deactivated: we,
  errorCaptured: we,
  serverPrefetch: we,
  // assets
  components: Jt,
  directives: Jt,
  // watch
  watch: sr,
  // provide / inject
  provide: al,
  inject: tr
};
function al(e, t) {
  return t ? e ? function() {
    return Te(
      K(e) ? e.call(this, this) : e,
      K(t) ? t.call(this, this) : t
    );
  } : t : e;
}
function tr(e, t) {
  return Jt(rn(e), rn(t));
}
function rn(e) {
  if (D(e)) {
    const t = {};
    for (let s = 0; s < e.length; s++)
      t[e[s]] = e[s];
    return t;
  }
  return e;
}
function we(e, t) {
  return e ? [...new Set([].concat(e, t))] : t;
}
function Jt(e, t) {
  return e ? Te(/* @__PURE__ */ Object.create(null), e, t) : t;
}
function ul(e, t) {
  return e ? D(e) && D(t) ? [.../* @__PURE__ */ new Set([...e, ...t])] : Te(
    /* @__PURE__ */ Object.create(null),
    ol(e),
    ol(t ?? {})
  ) : t;
}
function sr(e, t) {
  if (!e) return t;
  if (!t) return e;
  const s = Te(/* @__PURE__ */ Object.create(null), e);
  for (const n in t)
    s[n] = we(e[n], t[n]);
  return s;
}
function vi() {
  return {
    app: null,
    config: {
      isNativeTag: Wi,
      performance: !1,
      globalProperties: {},
      optionMergeStrategies: {},
      errorHandler: void 0,
      warnHandler: void 0,
      compilerOptions: {}
    },
    mixins: [],
    components: {},
    directives: {},
    provides: /* @__PURE__ */ Object.create(null),
    optionsCache: /* @__PURE__ */ new WeakMap(),
    propsCache: /* @__PURE__ */ new WeakMap(),
    emitsCache: /* @__PURE__ */ new WeakMap()
  };
}
let nr = 0;
function lr(e, t) {
  return function(n, l = null) {
    K(n) || (n = Te({}, n)), l != null && !le(l) && (l = null);
    const i = vi(), r = /* @__PURE__ */ new WeakSet(), u = [];
    let f = !1;
    const g = i.app = {
      _uid: nr++,
      _component: n,
      _props: l,
      _container: null,
      _context: i,
      _instance: null,
      version: Vr,
      get config() {
        return i.config;
      },
      set config(p) {
      },
      use(p, ...m) {
        return r.has(p) || (p && K(p.install) ? (r.add(p), p.install(g, ...m)) : K(p) && (r.add(p), p(g, ...m))), g;
      },
      mixin(p) {
        return i.mixins.includes(p) || i.mixins.push(p), g;
      },
      component(p, m) {
        return m ? (i.components[p] = m, g) : i.components[p];
      },
      directive(p, m) {
        return m ? (i.directives[p] = m, g) : i.directives[p];
      },
      mount(p, m, O) {
        if (!f) {
          const E = g._ceVNode || Xe(n, l);
          return E.appContext = i, O === !0 ? O = "svg" : O === !1 && (O = void 0), e(E, p, O), f = !0, g._container = p, p.__vue_app__ = g, Ks(E.component);
        }
      },
      onUnmount(p) {
        u.push(p);
      },
      unmount() {
        f && (Qe(
          u,
          g._instance,
          16
        ), e(null, g._container), delete g._container.__vue_app__);
      },
      provide(p, m) {
        return i.provides[p] = m, g;
      },
      runWithContext(p) {
        const m = Nt;
        Nt = g;
        try {
          return p();
        } finally {
          Nt = m;
        }
      }
    };
    return g;
  };
}
let Nt = null;
function ir(e, t) {
  if (Ce) {
    let s = Ce.provides;
    const n = Ce.parent && Ce.parent.provides;
    n === s && (s = Ce.provides = Object.create(n)), s[e] = t;
  }
}
function ms(e, t, s = !1) {
  const n = Dr();
  if (n || Nt) {
    let l = Nt ? Nt._context.provides : n ? n.parent == null || n.ce ? n.vnode.appContext && n.vnode.appContext.provides : n.parent.provides : void 0;
    if (l && e in l)
      return l[e];
    if (arguments.length > 1)
      return s && K(t) ? t.call(n && n.proxy) : t;
  }
}
const mi = {}, yi = () => Object.create(mi), bi = (e) => Object.getPrototypeOf(e) === mi;
function or(e, t, s, n = !1) {
  const l = {}, i = yi();
  e.propsDefaults = /* @__PURE__ */ Object.create(null), _i(e, t, l, i);
  for (const r in e.propsOptions[0])
    r in l || (l[r] = void 0);
  s ? e.props = n ? l : Co(l) : e.type.props ? e.props = l : e.props = i, e.attrs = i;
}
function rr(e, t, s, n) {
  const {
    props: l,
    attrs: i,
    vnode: { patchFlag: r }
  } = e, u = J(l), [f] = e.propsOptions;
  let g = !1;
  if (
    // always force full diff in dev
    // - #1942 if hmr is enabled with sfc component
    // - vite#872 non-sfc component used by sfc component
    (n || r > 0) && !(r & 16)
  ) {
    if (r & 8) {
      const p = e.vnode.dynamicProps;
      for (let m = 0; m < p.length; m++) {
        let O = p[m];
        if (Ds(e.emitsOptions, O))
          continue;
        const E = t[O];
        if (f)
          if (G(i, O))
            E !== i[O] && (i[O] = E, g = !0);
          else {
            const V = yt(O);
            l[V] = an(
              f,
              u,
              V,
              E,
              e,
              !1
            );
          }
        else
          E !== i[O] && (i[O] = E, g = !0);
      }
    }
  } else {
    _i(e, t, l, i) && (g = !0);
    let p;
    for (const m in u)
      (!t || // for camelCase
      !G(t, m) && // it's possible the original props was passed in as kebab-case
      // and converted to camelCase (#955)
      ((p = wt(m)) === m || !G(t, p))) && (f ? s && // for camelCase
      (s[m] !== void 0 || // for kebab-case
      s[p] !== void 0) && (l[m] = an(
        f,
        u,
        m,
        void 0,
        e,
        !0
      )) : delete l[m]);
    if (i !== u)
      for (const m in i)
        (!t || !G(t, m)) && (delete i[m], g = !0);
  }
  g && ot(e.attrs, "set", "");
}
function _i(e, t, s, n) {
  const [l, i] = e.propsOptions;
  let r = !1, u;
  if (t)
    for (let f in t) {
      if (Gt(f))
        continue;
      const g = t[f];
      let p;
      l && G(l, p = yt(f)) ? !i || !i.includes(p) ? s[p] = g : (u || (u = {}))[p] = g : Ds(e.emitsOptions, f) || (!(f in n) || g !== n[f]) && (n[f] = g, r = !0);
    }
  if (i) {
    const f = J(s), g = u || Q;
    for (let p = 0; p < i.length; p++) {
      const m = i[p];
      s[m] = an(
        l,
        f,
        m,
        g[m],
        e,
        !G(g, m)
      );
    }
  }
  return r;
}
function an(e, t, s, n, l, i) {
  const r = e[s];
  if (r != null) {
    const u = G(r, "default");
    if (u && n === void 0) {
      const f = r.default;
      if (r.type !== Function && !r.skipFactory && K(f)) {
        const { propsDefaults: g } = l;
        if (s in g)
          n = g[s];
        else {
          const p = us(l);
          n = g[s] = f.call(
            null,
            t
          ), p();
        }
      } else
        n = f;
      l.ce && l.ce._setProp(s, n);
    }
    r[
      0
      /* shouldCast */
    ] && (i && !u ? n = !1 : r[
      1
      /* shouldCastTrue */
    ] && (n === "" || n === wt(s)) && (n = !0));
  }
  return n;
}
const ar = /* @__PURE__ */ new WeakMap();
function xi(e, t, s = !1) {
  const n = s ? ar : t.propsCache, l = n.get(e);
  if (l)
    return l;
  const i = e.props, r = {}, u = [];
  let f = !1;
  if (!K(e)) {
    const p = (m) => {
      f = !0;
      const [O, E] = xi(m, t, !0);
      Te(r, O), E && u.push(...E);
    };
    !s && t.mixins.length && t.mixins.forEach(p), e.extends && p(e.extends), e.mixins && e.mixins.forEach(p);
  }
  if (!i && !f)
    return le(e) && n.set(e, Dt), Dt;
  if (D(i))
    for (let p = 0; p < i.length; p++) {
      const m = yt(i[p]);
      cl(m) && (r[m] = Q);
    }
  else if (i)
    for (const p in i) {
      const m = yt(p);
      if (cl(m)) {
        const O = i[p], E = r[m] = D(O) || K(O) ? { type: O } : Te({}, O), V = E.type;
        let j = !1, H = !0;
        if (D(V))
          for (let N = 0; N < V.length; ++N) {
            const se = V[N], L = K(se) && se.name;
            if (L === "Boolean") {
              j = !0;
              break;
            } else L === "String" && (H = !1);
          }
        else
          j = K(V) && V.name === "Boolean";
        E[
          0
          /* shouldCast */
        ] = j, E[
          1
          /* shouldCastTrue */
        ] = H, (j || G(E, "default")) && u.push(m);
      }
    }
  const g = [r, u];
  return le(e) && n.set(e, g), g;
}
function cl(e) {
  return e[0] !== "$" && !Gt(e);
}
const Pn = (e) => e === "_" || e === "__" || e === "_ctx" || e === "$stable", kn = (e) => D(e) ? e.map(Ge) : [Ge(e)], ur = (e, t, s) => {
  if (t._n)
    return t;
  const n = Uo((...l) => kn(t(...l)), s);
  return n._c = !1, n;
}, wi = (e, t, s) => {
  const n = e._ctx;
  for (const l in e) {
    if (Pn(l)) continue;
    const i = e[l];
    if (K(i))
      t[l] = ur(l, i, n);
    else if (i != null) {
      const r = kn(i);
      t[l] = () => r;
    }
  }
}, Si = (e, t) => {
  const s = kn(t);
  e.slots.default = () => s;
}, Ci = (e, t, s) => {
  for (const n in t)
    (s || !Pn(n)) && (e[n] = t[n]);
}, cr = (e, t, s) => {
  const n = e.slots = yi();
  if (e.vnode.shapeFlag & 32) {
    const l = t.__;
    l && Qs(n, "__", l, !0);
    const i = t._;
    i ? (Ci(n, t, s), s && Qs(n, "_", i, !0)) : wi(t, n);
  } else t && Si(e, t);
}, fr = (e, t, s) => {
  const { vnode: n, slots: l } = e;
  let i = !0, r = Q;
  if (n.shapeFlag & 32) {
    const u = t._;
    u ? s && u === 1 ? i = !1 : Ci(l, t, s) : (i = !t.$stable, wi(t, l)), r = t;
  } else t && (Si(e, t), r = { default: 1 });
  if (i)
    for (const u in l)
      !Pn(u) && r[u] == null && delete l[u];
}, Fe = Tr;
function dr(e) {
  return pr(e);
}
function pr(e, t) {
  const s = Ms();
  s.__VUE__ = !0;
  const {
    insert: n,
    remove: l,
    patchProp: i,
    createElement: r,
    createText: u,
    createComment: f,
    setText: g,
    setElementText: p,
    parentNode: m,
    nextSibling: O,
    setScopeId: E = Ye,
    insertStaticContent: V
  } = e, j = (c, d, h, x = null, b = null, _ = null, P = void 0, T = null, S = !!d.dynamicChildren) => {
    if (c === d)
      return;
    c && !zt(c, d) && (x = ht(c), Oe(c, b, _, !0), c = null), d.patchFlag === -2 && (S = !1, d.dynamicChildren = null);
    const { type: w, ref: I, shapeFlag: A } = d;
    switch (w) {
      case Us:
        H(c, d, h, x);
        break;
      case _t:
        N(c, d, h, x);
        break;
      case ys:
        c == null && se(d, h, x, P);
        break;
      case ue:
        dt(
          c,
          d,
          h,
          x,
          b,
          _,
          P,
          T,
          S
        );
        break;
      default:
        A & 1 ? oe(
          c,
          d,
          h,
          x,
          b,
          _,
          P,
          T,
          S
        ) : A & 6 ? pt(
          c,
          d,
          h,
          x,
          b,
          _,
          P,
          T,
          S
        ) : (A & 64 || A & 128) && w.process(
          c,
          d,
          h,
          x,
          b,
          _,
          P,
          T,
          S,
          st
        );
    }
    I != null && b ? Zt(I, c && c.ref, _, d || c, !d) : I == null && c && c.ref != null && Zt(c.ref, null, _, c, !0);
  }, H = (c, d, h, x) => {
    if (c == null)
      n(
        d.el = u(d.children),
        h,
        x
      );
    else {
      const b = d.el = c.el;
      d.children !== c.children && g(b, d.children);
    }
  }, N = (c, d, h, x) => {
    c == null ? n(
      d.el = f(d.children || ""),
      h,
      x
    ) : d.el = c.el;
  }, se = (c, d, h, x) => {
    [c.el, c.anchor] = V(
      c.children,
      d,
      h,
      x,
      c.el,
      c.anchor
    );
  }, L = ({ el: c, anchor: d }, h, x) => {
    let b;
    for (; c && c !== d; )
      b = O(c), n(c, h, x), c = b;
    n(d, h, x);
  }, F = ({ el: c, anchor: d }) => {
    let h;
    for (; c && c !== d; )
      h = O(c), l(c), c = h;
    l(d);
  }, oe = (c, d, h, x, b, _, P, T, S) => {
    d.type === "svg" ? P = "svg" : d.type === "math" && (P = "mathml"), c == null ? me(
      d,
      h,
      x,
      b,
      _,
      P,
      T,
      S
    ) : et(
      c,
      d,
      b,
      _,
      P,
      T,
      S
    );
  }, me = (c, d, h, x, b, _, P, T) => {
    let S, w;
    const { props: I, shapeFlag: A, transition: R, dirs: U } = c;
    if (S = c.el = r(
      c.type,
      _,
      I && I.is,
      I
    ), A & 8 ? p(S, c.children) : A & 16 && Ae(
      c.children,
      S,
      null,
      x,
      b,
      qs(c, _),
      P,
      T
    ), U && Tt(c, null, x, "created"), Z(S, c, c.scopeId, P, x), I) {
      for (const X in I)
        X !== "value" && !Gt(X) && i(S, X, null, I[X], _, x);
      "value" in I && i(S, "value", null, I.value, _), (w = I.onVnodeBeforeMount) && qe(w, x, c);
    }
    U && Tt(c, null, x, "beforeMount");
    const $ = hr(b, R);
    $ && R.beforeEnter(S), n(S, d, h), ((w = I && I.onVnodeMounted) || $ || U) && Fe(() => {
      w && qe(w, x, c), $ && R.enter(S), U && Tt(c, null, x, "mounted");
    }, b);
  }, Z = (c, d, h, x, b) => {
    if (h && E(c, h), x)
      for (let _ = 0; _ < x.length; _++)
        E(c, x[_]);
    if (b) {
      let _ = b.subTree;
      if (d === _ || Mi(_.type) && (_.ssContent === d || _.ssFallback === d)) {
        const P = b.vnode;
        Z(
          c,
          P,
          P.scopeId,
          P.slotScopeIds,
          b.parent
        );
      }
    }
  }, Ae = (c, d, h, x, b, _, P, T, S = 0) => {
    for (let w = S; w < c.length; w++) {
      const I = c[w] = T ? vt(c[w]) : Ge(c[w]);
      j(
        null,
        I,
        d,
        h,
        x,
        b,
        _,
        P,
        T
      );
    }
  }, et = (c, d, h, x, b, _, P) => {
    const T = d.el = c.el;
    let { patchFlag: S, dynamicChildren: w, dirs: I } = d;
    S |= c.patchFlag & 16;
    const A = c.props || Q, R = d.props || Q;
    let U;
    if (h && At(h, !1), (U = R.onVnodeBeforeUpdate) && qe(U, h, d, c), I && Tt(d, c, h, "beforeUpdate"), h && At(h, !0), (A.innerHTML && R.innerHTML == null || A.textContent && R.textContent == null) && p(T, ""), w ? Pe(
      c.dynamicChildren,
      w,
      T,
      h,
      x,
      qs(d, b),
      _
    ) : P || q(
      c,
      d,
      T,
      null,
      h,
      x,
      qs(d, b),
      _,
      !1
    ), S > 0) {
      if (S & 16)
        $e(T, A, R, h, b);
      else if (S & 2 && A.class !== R.class && i(T, "class", null, R.class, b), S & 4 && i(T, "style", A.style, R.style, b), S & 8) {
        const $ = d.dynamicProps;
        for (let X = 0; X < $.length; X++) {
          const B = $[X], re = A[B], pe = R[B];
          (pe !== re || B === "value") && i(T, B, re, pe, b, h);
        }
      }
      S & 1 && c.children !== d.children && p(T, d.children);
    } else !P && w == null && $e(T, A, R, h, b);
    ((U = R.onVnodeUpdated) || I) && Fe(() => {
      U && qe(U, h, d, c), I && Tt(d, c, h, "updated");
    }, x);
  }, Pe = (c, d, h, x, b, _, P) => {
    for (let T = 0; T < d.length; T++) {
      const S = c[T], w = d[T], I = (
        // oldVNode may be an errored async setup() component inside Suspense
        // which will not have a mounted element
        S.el && // - In the case of a Fragment, we need to provide the actual parent
        // of the Fragment itself so it can move its children.
        (S.type === ue || // - In the case of different nodes, there is going to be a replacement
        // which also requires the correct parent container
        !zt(S, w) || // - In the case of a component, it could contain anything.
        S.shapeFlag & 198) ? m(S.el) : (
          // In other cases, the parent container is not actually used so we
          // just pass the block element here to avoid a DOM parentNode call.
          h
        )
      );
      j(
        S,
        w,
        I,
        null,
        x,
        b,
        _,
        P,
        !0
      );
    }
  }, $e = (c, d, h, x, b) => {
    if (d !== h) {
      if (d !== Q)
        for (const _ in d)
          !Gt(_) && !(_ in h) && i(
            c,
            _,
            d[_],
            null,
            b,
            x
          );
      for (const _ in h) {
        if (Gt(_)) continue;
        const P = h[_], T = d[_];
        P !== T && _ !== "value" && i(c, _, T, P, b, x);
      }
      "value" in h && i(c, "value", d.value, h.value, b);
    }
  }, dt = (c, d, h, x, b, _, P, T, S) => {
    const w = d.el = c ? c.el : u(""), I = d.anchor = c ? c.anchor : u("");
    let { patchFlag: A, dynamicChildren: R, slotScopeIds: U } = d;
    U && (T = T ? T.concat(U) : U), c == null ? (n(w, h, x), n(I, h, x), Ae(
      // #10007
      // such fragment like `<></>` will be compiled into
      // a fragment which doesn't have a children.
      // In this case fallback to an empty array
      d.children || [],
      h,
      I,
      b,
      _,
      P,
      T,
      S
    )) : A > 0 && A & 64 && R && // #2715 the previous fragment could've been a BAILed one as a result
    // of renderSlot() with no valid children
    c.dynamicChildren ? (Pe(
      c.dynamicChildren,
      R,
      h,
      b,
      _,
      P,
      T
    ), // #2080 if the stable fragment has a key, it's a <template v-for> that may
    //  get moved around. Make sure all root level vnodes inherit el.
    // #2134 or if it's a component root, it may also get moved around
    // as the component is being moved.
    (d.key != null || b && d === b.subTree) && Ti(
      c,
      d,
      !0
      /* shallow */
    )) : q(
      c,
      d,
      h,
      I,
      b,
      _,
      P,
      T,
      S
    );
  }, pt = (c, d, h, x, b, _, P, T, S) => {
    d.slotScopeIds = T, c == null ? d.shapeFlag & 512 ? b.ctx.activate(
      d,
      h,
      x,
      P,
      S
    ) : Be(
      d,
      h,
      x,
      b,
      _,
      P,
      S
    ) : We(c, d, S);
  }, Be = (c, d, h, x, b, _, P) => {
    const T = c.component = Fr(
      c,
      x,
      b
    );
    if (ci(c) && (T.ctx.renderer = st), Ur(T, !1, P), T.asyncDep) {
      if (b && b.registerDep(T, fe, P), !c.el) {
        const S = T.subTree = Xe(_t);
        N(null, S, d, h), c.placeholder = S.el;
      }
    } else
      fe(
        T,
        c,
        d,
        h,
        b,
        _,
        P
      );
  }, We = (c, d, h) => {
    const x = d.component = c.component;
    if (Sr(c, d, h))
      if (x.asyncDep && !x.asyncResolved) {
        Y(x, d, h);
        return;
      } else
        x.next = d, x.update();
    else
      d.el = c.el, x.vnode = d;
  }, fe = (c, d, h, x, b, _, P) => {
    const T = () => {
      if (c.isMounted) {
        let { next: A, bu: R, u: U, parent: $, vnode: X } = c;
        {
          const Ee = Ai(c);
          if (Ee) {
            A && (A.el = X.el, Y(c, A, P)), Ee.asyncDep.then(() => {
              c.isUnmounted || T();
            });
            return;
          }
        }
        let B = A, re;
        At(c, !1), A ? (A.el = X.el, Y(c, A, P)) : A = X, R && vs(R), (re = A.props && A.props.onVnodeBeforeUpdate) && qe(re, $, A, X), At(c, !0);
        const pe = dl(c), ye = c.subTree;
        c.subTree = pe, j(
          ye,
          pe,
          // parent may have changed if it's in a teleport
          m(ye.el),
          // anchor may have changed if it's in a fragment
          ht(ye),
          c,
          b,
          _
        ), A.el = pe.el, B === null && Cr(c, pe.el), U && Fe(U, b), (re = A.props && A.props.onVnodeUpdated) && Fe(
          () => qe(re, $, A, X),
          b
        );
      } else {
        let A;
        const { el: R, props: U } = d, { bm: $, m: X, parent: B, root: re, type: pe } = c, ye = Qt(d);
        At(c, !1), $ && vs($), !ye && (A = U && U.onVnodeBeforeMount) && qe(A, B, d), At(c, !0);
        {
          re.ce && // @ts-expect-error _def is private
          re.ce._def.shadowRoot !== !1 && re.ce._injectChildStyle(pe);
          const Ee = c.subTree = dl(c);
          j(
            null,
            Ee,
            h,
            x,
            c,
            b,
            _
          ), d.el = Ee.el;
        }
        if (X && Fe(X, b), !ye && (A = U && U.onVnodeMounted)) {
          const Ee = d;
          Fe(
            () => qe(A, B, Ee),
            b
          );
        }
        (d.shapeFlag & 256 || B && Qt(B.vnode) && B.vnode.shapeFlag & 256) && c.a && Fe(c.a, b), c.isMounted = !0, d = h = x = null;
      }
    };
    c.scope.on();
    const S = c.effect = new $l(T);
    c.scope.off();
    const w = c.update = S.run.bind(S), I = c.job = S.runIfDirty.bind(S);
    I.i = c, I.id = c.uid, S.scheduler = () => Tn(I), At(c, !0), w();
  }, Y = (c, d, h) => {
    d.component = c;
    const x = c.vnode.props;
    c.vnode = d, c.next = null, rr(c, d.props, x, h), fr(c, d.children, h), ut(), il(c), ct();
  }, q = (c, d, h, x, b, _, P, T, S = !1) => {
    const w = c && c.children, I = c ? c.shapeFlag : 0, A = d.children, { patchFlag: R, shapeFlag: U } = d;
    if (R > 0) {
      if (R & 128) {
        tt(
          w,
          A,
          h,
          x,
          b,
          _,
          P,
          T,
          S
        );
        return;
      } else if (R & 256) {
        Ve(
          w,
          A,
          h,
          x,
          b,
          _,
          P,
          T,
          S
        );
        return;
      }
    }
    U & 8 ? (I & 16 && ce(w, b, _), A !== w && p(h, A)) : I & 16 ? U & 16 ? tt(
      w,
      A,
      h,
      x,
      b,
      _,
      P,
      T,
      S
    ) : ce(w, b, _, !0) : (I & 8 && p(h, ""), U & 16 && Ae(
      A,
      h,
      x,
      b,
      _,
      P,
      T,
      S
    ));
  }, Ve = (c, d, h, x, b, _, P, T, S) => {
    c = c || Dt, d = d || Dt;
    const w = c.length, I = d.length, A = Math.min(w, I);
    let R;
    for (R = 0; R < A; R++) {
      const U = d[R] = S ? vt(d[R]) : Ge(d[R]);
      j(
        c[R],
        U,
        h,
        null,
        b,
        _,
        P,
        T,
        S
      );
    }
    w > I ? ce(
      c,
      b,
      _,
      !0,
      !1,
      A
    ) : Ae(
      d,
      h,
      x,
      b,
      _,
      P,
      T,
      S,
      A
    );
  }, tt = (c, d, h, x, b, _, P, T, S) => {
    let w = 0;
    const I = d.length;
    let A = c.length - 1, R = I - 1;
    for (; w <= A && w <= R; ) {
      const U = c[w], $ = d[w] = S ? vt(d[w]) : Ge(d[w]);
      if (zt(U, $))
        j(
          U,
          $,
          h,
          null,
          b,
          _,
          P,
          T,
          S
        );
      else
        break;
      w++;
    }
    for (; w <= A && w <= R; ) {
      const U = c[A], $ = d[R] = S ? vt(d[R]) : Ge(d[R]);
      if (zt(U, $))
        j(
          U,
          $,
          h,
          null,
          b,
          _,
          P,
          T,
          S
        );
      else
        break;
      A--, R--;
    }
    if (w > A) {
      if (w <= R) {
        const U = R + 1, $ = U < I ? d[U].el : x;
        for (; w <= R; )
          j(
            null,
            d[w] = S ? vt(d[w]) : Ge(d[w]),
            h,
            $,
            b,
            _,
            P,
            T,
            S
          ), w++;
      }
    } else if (w > R)
      for (; w <= A; )
        Oe(c[w], b, _, !0), w++;
    else {
      const U = w, $ = w, X = /* @__PURE__ */ new Map();
      for (w = $; w <= R; w++) {
        const be = d[w] = S ? vt(d[w]) : Ge(d[w]);
        be.key != null && X.set(be.key, w);
      }
      let B, re = 0;
      const pe = R - $ + 1;
      let ye = !1, Ee = 0;
      const nt = new Array(pe);
      for (w = 0; w < pe; w++) nt[w] = 0;
      for (w = U; w <= A; w++) {
        const be = c[w];
        if (re >= pe) {
          Oe(be, b, _, !0);
          continue;
        }
        let Re;
        if (be.key != null)
          Re = X.get(be.key);
        else
          for (B = $; B <= R; B++)
            if (nt[B - $] === 0 && zt(be, d[B])) {
              Re = B;
              break;
            }
        Re === void 0 ? Oe(be, b, _, !0) : (nt[Re - $] = w + 1, Re >= Ee ? Ee = Re : ye = !0, j(
          be,
          d[Re],
          h,
          null,
          b,
          _,
          P,
          T,
          S
        ), re++);
      }
      const Et = ye ? gr(nt) : Dt;
      for (B = Et.length - 1, w = pe - 1; w >= 0; w--) {
        const be = $ + w, Re = d[be], Bt = d[be + 1], fs = be + 1 < I ? (
          // #13559, fallback to el placeholder for unresolved async component
          Bt.el || Bt.placeholder
        ) : x;
        nt[w] === 0 ? j(
          null,
          Re,
          h,
          fs,
          b,
          _,
          P,
          T,
          S
        ) : ye && (B < 0 || w !== Et[B] ? ke(Re, h, fs, 2) : B--);
      }
    }
  }, ke = (c, d, h, x, b = null) => {
    const { el: _, type: P, transition: T, children: S, shapeFlag: w } = c;
    if (w & 6) {
      ke(c.component.subTree, d, h, x);
      return;
    }
    if (w & 128) {
      c.suspense.move(d, h, x);
      return;
    }
    if (w & 64) {
      P.move(c, d, h, st);
      return;
    }
    if (P === ue) {
      n(_, d, h);
      for (let A = 0; A < S.length; A++)
        ke(S[A], d, h, x);
      n(c.anchor, d, h);
      return;
    }
    if (P === ys) {
      L(c, d, h);
      return;
    }
    if (x !== 2 && w & 1 && T)
      if (x === 0)
        T.beforeEnter(_), n(_, d, h), Fe(() => T.enter(_), b);
      else {
        const { leave: A, delayLeave: R, afterLeave: U } = T, $ = () => {
          c.ctx.isUnmounted ? l(_) : n(_, d, h);
        }, X = () => {
          A(_, () => {
            $(), U && U();
          });
        };
        R ? R(_, $, X) : X();
      }
    else
      n(_, d, h);
  }, Oe = (c, d, h, x = !1, b = !1) => {
    const {
      type: _,
      props: P,
      ref: T,
      children: S,
      dynamicChildren: w,
      shapeFlag: I,
      patchFlag: A,
      dirs: R,
      cacheIndex: U
    } = c;
    if (A === -2 && (b = !1), T != null && (ut(), Zt(T, null, h, c, !0), ct()), U != null && (d.renderCache[U] = void 0), I & 256) {
      d.ctx.deactivate(c);
      return;
    }
    const $ = I & 1 && R, X = !Qt(c);
    let B;
    if (X && (B = P && P.onVnodeBeforeUnmount) && qe(B, d, c), I & 6)
      js(c.component, h, x);
    else {
      if (I & 128) {
        c.suspense.unmount(h, x);
        return;
      }
      $ && Tt(c, null, d, "beforeUnmount"), I & 64 ? c.type.remove(
        c,
        d,
        h,
        st,
        x
      ) : w && // #5154
      // when v-once is used inside a block, setBlockTracking(-1) marks the
      // parent block with hasOnce: true
      // so that it doesn't take the fast path during unmount - otherwise
      // components nested in v-once are never unmounted.
      !w.hasOnce && // #1153: fast path should not be taken for non-stable (v-for) fragments
      (_ !== ue || A > 0 && A & 64) ? ce(
        w,
        d,
        h,
        !1,
        !0
      ) : (_ === ue && A & 384 || !b && I & 16) && ce(S, d, h), x && Me(c);
    }
    (X && (B = P && P.onVnodeUnmounted) || $) && Fe(() => {
      B && qe(B, d, c), $ && Tt(c, null, d, "unmounted");
    }, h);
  }, Me = (c) => {
    const { type: d, el: h, anchor: x, transition: b } = c;
    if (d === ue) {
      Lt(h, x);
      return;
    }
    if (d === ys) {
      F(c);
      return;
    }
    const _ = () => {
      l(h), b && !b.persisted && b.afterLeave && b.afterLeave();
    };
    if (c.shapeFlag & 1 && b && !b.persisted) {
      const { leave: P, delayLeave: T } = b, S = () => P(h, _);
      T ? T(c.el, _, S) : S();
    } else
      _();
  }, Lt = (c, d) => {
    let h;
    for (; c !== d; )
      h = O(c), l(c), c = h;
    l(d);
  }, js = (c, d, h) => {
    const {
      bum: x,
      scope: b,
      job: _,
      subTree: P,
      um: T,
      m: S,
      a: w,
      parent: I,
      slots: { __: A }
    } = c;
    fl(S), fl(w), x && vs(x), I && D(A) && A.forEach((R) => {
      I.renderCache[R] = void 0;
    }), b.stop(), _ && (_.flags |= 8, Oe(P, c, d, h)), T && Fe(T, d), Fe(() => {
      c.isUnmounted = !0;
    }, d), d && d.pendingBranch && !d.isUnmounted && c.asyncDep && !c.asyncResolved && c.suspenseId === d.pendingId && (d.deps--, d.deps === 0 && d.resolve());
  }, ce = (c, d, h, x = !1, b = !1, _ = 0) => {
    for (let P = _; P < c.length; P++)
      Oe(c[P], d, h, x, b);
  }, ht = (c) => {
    if (c.shapeFlag & 6)
      return ht(c.component.subTree);
    if (c.shapeFlag & 128)
      return c.suspense.next();
    const d = O(c.anchor || c.el), h = d && d[Ko];
    return h ? O(h) : d;
  };
  let St = !1;
  const Mt = (c, d, h) => {
    c == null ? d._vnode && Oe(d._vnode, null, null, !0) : j(
      d._vnode || null,
      c,
      d,
      null,
      null,
      null,
      h
    ), d._vnode = c, St || (St = !0, il(), oi(), St = !1);
  }, st = {
    p: j,
    um: Oe,
    m: ke,
    r: Me,
    mt: Be,
    mc: Ae,
    pc: q,
    pbc: Pe,
    n: ht,
    o: e
  };
  return {
    render: Mt,
    hydrate: void 0,
    createApp: lr(Mt)
  };
}
function qs({ type: e, props: t }, s) {
  return s === "svg" && e === "foreignObject" || s === "mathml" && e === "annotation-xml" && t && t.encoding && t.encoding.includes("html") ? void 0 : s;
}
function At({ effect: e, job: t }, s) {
  s ? (e.flags |= 32, t.flags |= 4) : (e.flags &= -33, t.flags &= -5);
}
function hr(e, t) {
  return (!e || e && !e.pendingBranch) && t && !t.persisted;
}
function Ti(e, t, s = !1) {
  const n = e.children, l = t.children;
  if (D(n) && D(l))
    for (let i = 0; i < n.length; i++) {
      const r = n[i];
      let u = l[i];
      u.shapeFlag & 1 && !u.dynamicChildren && ((u.patchFlag <= 0 || u.patchFlag === 32) && (u = l[i] = vt(l[i]), u.el = r.el), !s && u.patchFlag !== -2 && Ti(r, u)), u.type === Us && (u.el = r.el), u.type === _t && !u.el && (u.el = r.el);
    }
}
function gr(e) {
  const t = e.slice(), s = [0];
  let n, l, i, r, u;
  const f = e.length;
  for (n = 0; n < f; n++) {
    const g = e[n];
    if (g !== 0) {
      if (l = s[s.length - 1], e[l] < g) {
        t[n] = l, s.push(n);
        continue;
      }
      for (i = 0, r = s.length - 1; i < r; )
        u = i + r >> 1, e[s[u]] < g ? i = u + 1 : r = u;
      g < e[s[i]] && (i > 0 && (t[n] = s[i - 1]), s[i] = n);
    }
  }
  for (i = s.length, r = s[i - 1]; i-- > 0; )
    s[i] = r, r = t[r];
  return s;
}
function Ai(e) {
  const t = e.subTree.component;
  if (t)
    return t.asyncDep && !t.asyncResolved ? t : Ai(t);
}
function fl(e) {
  if (e)
    for (let t = 0; t < e.length; t++)
      e[t].flags |= 8;
}
const vr = Symbol.for("v-scx"), mr = () => ms(vr);
function Js(e, t, s) {
  return Pi(e, t, s);
}
function Pi(e, t, s = Q) {
  const { immediate: n, deep: l, flush: i, once: r } = s, u = Te({}, s), f = t && n || !t && i !== "post";
  let g;
  if (os) {
    if (i === "sync") {
      const E = mr();
      g = E.__watcherHandles || (E.__watcherHandles = []);
    } else if (!f) {
      const E = () => {
      };
      return E.stop = Ye, E.resume = Ye, E.pause = Ye, E;
    }
  }
  const p = Ce;
  u.call = (E, V, j) => Qe(E, p, V, j);
  let m = !1;
  i === "post" ? u.scheduler = (E) => {
    Fe(E, p && p.suspense);
  } : i !== "sync" && (m = !0, u.scheduler = (E, V) => {
    V ? E() : Tn(E);
  }), u.augmentJob = (E) => {
    t && (E.flags |= 4), m && (E.flags |= 2, p && (E.id = p.uid, E.i = p));
  };
  const O = Io(e, t, u);
  return os && (g ? g.push(O) : f && O()), O;
}
function yr(e, t, s) {
  const n = this.proxy, l = de(e) ? e.includes(".") ? ki(n, e) : () => n[e] : e.bind(n, n);
  let i;
  K(t) ? i = t : (i = t.handler, s = t);
  const r = us(this), u = Pi(l, i.bind(n), s);
  return r(), u;
}
function ki(e, t) {
  const s = t.split(".");
  return () => {
    let n = e;
    for (let l = 0; l < s.length && n; l++)
      n = n[s[l]];
    return n;
  };
}
const br = (e, t) => t === "modelValue" || t === "model-value" ? e.modelModifiers : e[`${t}Modifiers`] || e[`${yt(t)}Modifiers`] || e[`${wt(t)}Modifiers`];
function _r(e, t, ...s) {
  if (e.isUnmounted) return;
  const n = e.vnode.props || Q;
  let l = s;
  const i = t.startsWith("update:"), r = i && br(n, t.slice(7));
  r && (r.trim && (l = s.map((p) => de(p) ? p.trim() : p)), r.number && (l = s.map(xs)));
  let u, f = n[u = Vs(t)] || // also try camelCase event handler (#2249)
  n[u = Vs(yt(t))];
  !f && i && (f = n[u = Vs(wt(t))]), f && Qe(
    f,
    e,
    6,
    l
  );
  const g = n[u + "Once"];
  if (g) {
    if (!e.emitted)
      e.emitted = {};
    else if (e.emitted[u])
      return;
    e.emitted[u] = !0, Qe(
      g,
      e,
      6,
      l
    );
  }
}
function Oi(e, t, s = !1) {
  const n = t.emitsCache, l = n.get(e);
  if (l !== void 0)
    return l;
  const i = e.emits;
  let r = {}, u = !1;
  if (!K(e)) {
    const f = (g) => {
      const p = Oi(g, t, !0);
      p && (u = !0, Te(r, p));
    };
    !s && t.mixins.length && t.mixins.forEach(f), e.extends && f(e.extends), e.mixins && e.mixins.forEach(f);
  }
  return !i && !u ? (le(e) && n.set(e, null), null) : (D(i) ? i.forEach((f) => r[f] = null) : Te(r, i), le(e) && n.set(e, r), r);
}
function Ds(e, t) {
  return !e || !ks(t) ? !1 : (t = t.slice(2).replace(/Once$/, ""), G(e, t[0].toLowerCase() + t.slice(1)) || G(e, wt(t)) || G(e, t));
}
function dl(e) {
  const {
    type: t,
    vnode: s,
    proxy: n,
    withProxy: l,
    propsOptions: [i],
    slots: r,
    attrs: u,
    emit: f,
    render: g,
    renderCache: p,
    props: m,
    data: O,
    setupState: E,
    ctx: V,
    inheritAttrs: j
  } = e, H = Ts(e);
  let N, se;
  try {
    if (s.shapeFlag & 4) {
      const F = l || n, oe = F;
      N = Ge(
        g.call(
          oe,
          F,
          p,
          m,
          E,
          O,
          V
        )
      ), se = u;
    } else {
      const F = t;
      N = Ge(
        F.length > 1 ? F(
          m,
          { attrs: u, slots: r, emit: f }
        ) : F(
          m,
          null
        )
      ), se = t.props ? u : xr(u);
    }
  } catch (F) {
    ts.length = 0, Rs(F, e, 1), N = Xe(_t);
  }
  let L = N;
  if (se && j !== !1) {
    const F = Object.keys(se), { shapeFlag: oe } = L;
    F.length && oe & 7 && (i && F.some(pn) && (se = wr(
      se,
      i
    )), L = $t(L, se, !1, !0));
  }
  return s.dirs && (L = $t(L, null, !1, !0), L.dirs = L.dirs ? L.dirs.concat(s.dirs) : s.dirs), s.transition && An(L, s.transition), N = L, Ts(H), N;
}
const xr = (e) => {
  let t;
  for (const s in e)
    (s === "class" || s === "style" || ks(s)) && ((t || (t = {}))[s] = e[s]);
  return t;
}, wr = (e, t) => {
  const s = {};
  for (const n in e)
    (!pn(n) || !(n.slice(9) in t)) && (s[n] = e[n]);
  return s;
};
function Sr(e, t, s) {
  const { props: n, children: l, component: i } = e, { props: r, children: u, patchFlag: f } = t, g = i.emitsOptions;
  if (t.dirs || t.transition)
    return !0;
  if (s && f >= 0) {
    if (f & 1024)
      return !0;
    if (f & 16)
      return n ? pl(n, r, g) : !!r;
    if (f & 8) {
      const p = t.dynamicProps;
      for (let m = 0; m < p.length; m++) {
        const O = p[m];
        if (r[O] !== n[O] && !Ds(g, O))
          return !0;
      }
    }
  } else
    return (l || u) && (!u || !u.$stable) ? !0 : n === r ? !1 : n ? r ? pl(n, r, g) : !0 : !!r;
  return !1;
}
function pl(e, t, s) {
  const n = Object.keys(t);
  if (n.length !== Object.keys(e).length)
    return !0;
  for (let l = 0; l < n.length; l++) {
    const i = n[l];
    if (t[i] !== e[i] && !Ds(s, i))
      return !0;
  }
  return !1;
}
function Cr({ vnode: e, parent: t }, s) {
  for (; t; ) {
    const n = t.subTree;
    if (n.suspense && n.suspense.activeBranch === e && (n.el = e.el), n === e)
      (e = t.vnode).el = s, t = t.parent;
    else
      break;
  }
}
const Mi = (e) => e.__isSuspense;
function Tr(e, t) {
  t && t.pendingBranch ? D(e) ? t.effects.push(...e) : t.effects.push(e) : Do(e);
}
const ue = Symbol.for("v-fgt"), Us = Symbol.for("v-txt"), _t = Symbol.for("v-cmt"), ys = Symbol.for("v-stc"), ts = [];
let De = null;
function k(e = !1) {
  ts.push(De = e ? null : []);
}
function Ar() {
  ts.pop(), De = ts[ts.length - 1] || null;
}
let is = 1;
function hl(e, t = !1) {
  is += e, e < 0 && De && t && (De.hasOnce = !0);
}
function Ei(e) {
  return e.dynamicChildren = is > 0 ? De || Dt : null, Ar(), is > 0 && De && De.push(e), e;
}
function M(e, t, s, n, l, i) {
  return Ei(
    o(
      e,
      t,
      s,
      n,
      l,
      i,
      !0
    )
  );
}
function Pr(e, t, s, n, l) {
  return Ei(
    Xe(
      e,
      t,
      s,
      n,
      l,
      !0
    )
  );
}
function Ii(e) {
  return e ? e.__v_isVNode === !0 : !1;
}
function zt(e, t) {
  return e.type === t.type && e.key === t.key;
}
const Ri = ({ key: e }) => e ?? null, bs = ({
  ref: e,
  ref_key: t,
  ref_for: s
}) => (typeof e == "number" && (e = "" + e), e != null ? de(e) || ve(e) || K(e) ? { i: Ke, r: e, k: t, f: !!s } : e : null);
function o(e, t = null, s = null, n = 0, l = null, i = e === ue ? 0 : 1, r = !1, u = !1) {
  const f = {
    __v_isVNode: !0,
    __v_skip: !0,
    type: e,
    props: t,
    key: t && Ri(t),
    ref: t && bs(t),
    scopeId: ai,
    slotScopeIds: null,
    children: s,
    component: null,
    suspense: null,
    ssContent: null,
    ssFallback: null,
    dirs: null,
    transition: null,
    el: null,
    anchor: null,
    target: null,
    targetStart: null,
    targetAnchor: null,
    staticCount: 0,
    shapeFlag: i,
    patchFlag: n,
    dynamicProps: l,
    dynamicChildren: null,
    appContext: null,
    ctx: Ke
  };
  return u ? (On(f, s), i & 128 && e.normalize(f)) : s && (f.shapeFlag |= de(s) ? 8 : 16), is > 0 && // avoid a block node from tracking itself
  !r && // has current parent block
  De && // presence of a patch flag indicates this node needs patching on updates.
  // component nodes also should always be patched, because even if the
  // component doesn't need to update, it needs to persist the instance on to
  // the next vnode so that it can be properly unmounted later.
  (f.patchFlag > 0 || i & 6) && // the EVENTS flag is only for hydration and if it is the only flag, the
  // vnode should not be considered dynamic due to handler caching.
  f.patchFlag !== 32 && De.push(f), f;
}
const Xe = kr;
function kr(e, t = null, s = null, n = 0, l = null, i = !1) {
  if ((!e || e === Yo) && (e = _t), Ii(e)) {
    const u = $t(
      e,
      t,
      !0
      /* mergeRef: true */
    );
    return s && On(u, s), is > 0 && !i && De && (u.shapeFlag & 6 ? De[De.indexOf(e)] = u : De.push(u)), u.patchFlag = -2, u;
  }
  if ($r(e) && (e = e.__vccOpts), t) {
    t = Or(t);
    let { class: u, style: f } = t;
    u && !de(u) && (t.class = ie(u)), le(f) && (Cn(f) && !D(f) && (f = Te({}, f)), t.style = Es(f));
  }
  const r = de(e) ? 1 : Mi(e) ? 128 : jo(e) ? 64 : le(e) ? 4 : K(e) ? 2 : 0;
  return o(
    e,
    t,
    s,
    n,
    l,
    r,
    i,
    !0
  );
}
function Or(e) {
  return e ? Cn(e) || bi(e) ? Te({}, e) : e : null;
}
function $t(e, t, s = !1, n = !1) {
  const { props: l, ref: i, patchFlag: r, children: u, transition: f } = e, g = t ? Er(l || {}, t) : l, p = {
    __v_isVNode: !0,
    __v_skip: !0,
    type: e.type,
    props: g,
    key: g && Ri(g),
    ref: t && t.ref ? (
      // #2078 in the case of <component :is="vnode" ref="extra"/>
      // if the vnode itself already has a ref, cloneVNode will need to merge
      // the refs so the single vnode can be set on multiple refs
      s && i ? D(i) ? i.concat(bs(t)) : [i, bs(t)] : bs(t)
    ) : i,
    scopeId: e.scopeId,
    slotScopeIds: e.slotScopeIds,
    children: u,
    target: e.target,
    targetStart: e.targetStart,
    targetAnchor: e.targetAnchor,
    staticCount: e.staticCount,
    shapeFlag: e.shapeFlag,
    // if the vnode is cloned with extra props, we can no longer assume its
    // existing patch flag to be reliable and need to add the FULL_PROPS flag.
    // note: preserve flag for fragments since they use the flag for children
    // fast paths only.
    patchFlag: t && e.type !== ue ? r === -1 ? 16 : r | 16 : r,
    dynamicProps: e.dynamicProps,
    dynamicChildren: e.dynamicChildren,
    appContext: e.appContext,
    dirs: e.dirs,
    transition: f,
    // These should technically only be non-null on mounted VNodes. However,
    // they *should* be copied for kept-alive vnodes. So we just always copy
    // them since them being non-null during a mount doesn't affect the logic as
    // they will simply be overwritten.
    component: e.component,
    suspense: e.suspense,
    ssContent: e.ssContent && $t(e.ssContent),
    ssFallback: e.ssFallback && $t(e.ssFallback),
    placeholder: e.placeholder,
    el: e.el,
    anchor: e.anchor,
    ctx: e.ctx,
    ce: e.ce
  };
  return f && n && An(
    p,
    f.clone(p)
  ), p;
}
function ae(e = " ", t = 0) {
  return Xe(Us, null, e, t);
}
function Mr(e, t) {
  const s = Xe(ys, null, e);
  return s.staticCount = t, s;
}
function ne(e = "", t = !1) {
  return t ? (k(), Pr(_t, null, e)) : Xe(_t, null, e);
}
function Ge(e) {
  return e == null || typeof e == "boolean" ? Xe(_t) : D(e) ? Xe(
    ue,
    null,
    // #3666, avoid reference pollution when reusing vnode
    e.slice()
  ) : Ii(e) ? vt(e) : Xe(Us, null, String(e));
}
function vt(e) {
  return e.el === null && e.patchFlag !== -1 || e.memo ? e : $t(e);
}
function On(e, t) {
  let s = 0;
  const { shapeFlag: n } = e;
  if (t == null)
    t = null;
  else if (D(t))
    s = 16;
  else if (typeof t == "object")
    if (n & 65) {
      const l = t.default;
      l && (l._c && (l._d = !1), On(e, l()), l._c && (l._d = !0));
      return;
    } else {
      s = 32;
      const l = t._;
      !l && !bi(t) ? t._ctx = Ke : l === 3 && Ke && (Ke.slots._ === 1 ? t._ = 1 : (t._ = 2, e.patchFlag |= 1024));
    }
  else K(t) ? (t = { default: t, _ctx: Ke }, s = 32) : (t = String(t), n & 64 ? (s = 16, t = [ae(t)]) : s = 8);
  e.children = t, e.shapeFlag |= s;
}
function Er(...e) {
  const t = {};
  for (let s = 0; s < e.length; s++) {
    const n = e[s];
    for (const l in n)
      if (l === "class")
        t.class !== n.class && (t.class = ie([t.class, n.class]));
      else if (l === "style")
        t.style = Es([t.style, n.style]);
      else if (ks(l)) {
        const i = t[l], r = n[l];
        r && i !== r && !(D(i) && i.includes(r)) && (t[l] = i ? [].concat(i, r) : r);
      } else l !== "" && (t[l] = n[l]);
  }
  return t;
}
function qe(e, t, s, n = null) {
  Qe(e, t, 7, [
    s,
    n
  ]);
}
const Ir = vi();
let Rr = 0;
function Fr(e, t, s) {
  const n = e.type, l = (t ? t.appContext : e.appContext) || Ir, i = {
    uid: Rr++,
    vnode: e,
    type: n,
    parent: t,
    appContext: l,
    root: null,
    // to be immediately set
    next: null,
    subTree: null,
    // will be set synchronously right after creation
    effect: null,
    update: null,
    // will be set synchronously right after creation
    job: null,
    scope: new no(
      !0
      /* detached */
    ),
    render: null,
    proxy: null,
    exposed: null,
    exposeProxy: null,
    withProxy: null,
    provides: t ? t.provides : Object.create(l.provides),
    ids: t ? t.ids : ["", 0, 0],
    accessCache: null,
    renderCache: [],
    // local resolved assets
    components: null,
    directives: null,
    // resolved props and emits options
    propsOptions: xi(n, l),
    emitsOptions: Oi(n, l),
    // emit
    emit: null,
    // to be set immediately
    emitted: null,
    // props default value
    propsDefaults: Q,
    // inheritAttrs
    inheritAttrs: n.inheritAttrs,
    // state
    ctx: Q,
    data: Q,
    props: Q,
    attrs: Q,
    slots: Q,
    refs: Q,
    setupState: Q,
    setupContext: null,
    // suspense related
    suspense: s,
    suspenseId: s ? s.pendingId : 0,
    asyncDep: null,
    asyncResolved: !1,
    // lifecycle hooks
    // not using enums here because it results in computed properties
    isMounted: !1,
    isUnmounted: !1,
    isDeactivated: !1,
    bc: null,
    c: null,
    bm: null,
    m: null,
    bu: null,
    u: null,
    um: null,
    bum: null,
    da: null,
    a: null,
    rtg: null,
    rtc: null,
    ec: null,
    sp: null
  };
  return i.ctx = { _: i }, i.root = t ? t.root : i, i.emit = _r.bind(null, i), e.ce && e.ce(i), i;
}
let Ce = null;
const Dr = () => Ce || Ke;
let Ps, un;
{
  const e = Ms(), t = (s, n) => {
    let l;
    return (l = e[s]) || (l = e[s] = []), l.push(n), (i) => {
      l.length > 1 ? l.forEach((r) => r(i)) : l[0](i);
    };
  };
  Ps = t(
    "__VUE_INSTANCE_SETTERS__",
    (s) => Ce = s
  ), un = t(
    "__VUE_SSR_SETTERS__",
    (s) => os = s
  );
}
const us = (e) => {
  const t = Ce;
  return Ps(e), e.scope.on(), () => {
    e.scope.off(), Ps(t);
  };
}, gl = () => {
  Ce && Ce.scope.off(), Ps(null);
};
function Fi(e) {
  return e.vnode.shapeFlag & 4;
}
let os = !1;
function Ur(e, t = !1, s = !1) {
  t && un(t);
  const { props: n, children: l } = e.vnode, i = Fi(e);
  or(e, n, i, t), cr(e, l, s || t);
  const r = i ? Kr(e, t) : void 0;
  return t && un(!1), r;
}
function Kr(e, t) {
  const s = e.type;
  e.accessCache = /* @__PURE__ */ Object.create(null), e.proxy = new Proxy(e.ctx, Xo);
  const { setup: n } = s;
  if (n) {
    ut();
    const l = e.setupContext = n.length > 1 ? Nr(e) : null, i = us(e), r = as(
      n,
      e,
      0,
      [
        e.props,
        l
      ]
    ), u = Rl(r);
    if (ct(), i(), (u || e.sp) && !Qt(e) && ui(e), u) {
      if (r.then(gl, gl), t)
        return r.then((f) => {
          vl(e, f);
        }).catch((f) => {
          Rs(f, e, 0);
        });
      e.asyncDep = r;
    } else
      vl(e, r);
  } else
    Di(e);
}
function vl(e, t, s) {
  K(t) ? e.type.__ssrInlineRender ? e.ssrRender = t : e.render = t : le(t) && (e.setupState = si(t)), Di(e);
}
function Di(e, t, s) {
  const n = e.type;
  e.render || (e.render = n.render || Ye);
  {
    const l = us(e);
    ut();
    try {
      Zo(e);
    } finally {
      ct(), l();
    }
  }
}
const jr = {
  get(e, t) {
    return ge(e, "get", ""), e[t];
  }
};
function Nr(e) {
  const t = (s) => {
    e.exposed = s || {};
  };
  return {
    attrs: new Proxy(e.attrs, jr),
    slots: e.slots,
    emit: e.emit,
    expose: t
  };
}
function Ks(e) {
  return e.exposed ? e.exposeProxy || (e.exposeProxy = new Proxy(si(To(e.exposed)), {
    get(t, s) {
      if (s in t)
        return t[s];
      if (s in es)
        return es[s](e);
    },
    has(t, s) {
      return s in t || s in es;
    }
  })) : e.proxy;
}
function $r(e) {
  return K(e) && "__vccOpts" in e;
}
const ee = (e, t) => Mo(e, t, os), Vr = "3.5.18";
/**
* @vue/runtime-dom v3.5.18
* (c) 2018-present Yuxi (Evan) You and Vue contributors
* @license MIT
**/
let cn;
const ml = typeof window < "u" && window.trustedTypes;
if (ml)
  try {
    cn = /* @__PURE__ */ ml.createPolicy("vue", {
      createHTML: (e) => e
    });
  } catch {
  }
const Ui = cn ? (e) => cn.createHTML(e) : (e) => e, Hr = "http://www.w3.org/2000/svg", Lr = "http://www.w3.org/1998/Math/MathML", it = typeof document < "u" ? document : null, yl = it && /* @__PURE__ */ it.createElement("template"), Br = {
  insert: (e, t, s) => {
    t.insertBefore(e, s || null);
  },
  remove: (e) => {
    const t = e.parentNode;
    t && t.removeChild(e);
  },
  createElement: (e, t, s, n) => {
    const l = t === "svg" ? it.createElementNS(Hr, e) : t === "mathml" ? it.createElementNS(Lr, e) : s ? it.createElement(e, { is: s }) : it.createElement(e);
    return e === "select" && n && n.multiple != null && l.setAttribute("multiple", n.multiple), l;
  },
  createText: (e) => it.createTextNode(e),
  createComment: (e) => it.createComment(e),
  setText: (e, t) => {
    e.nodeValue = t;
  },
  setElementText: (e, t) => {
    e.textContent = t;
  },
  parentNode: (e) => e.parentNode,
  nextSibling: (e) => e.nextSibling,
  querySelector: (e) => it.querySelector(e),
  setScopeId(e, t) {
    e.setAttribute(t, "");
  },
  // __UNSAFE__
  // Reason: innerHTML.
  // Static content here can only come from compiled templates.
  // As long as the user only uses trusted templates, this is safe.
  insertStaticContent(e, t, s, n, l, i) {
    const r = s ? s.previousSibling : t.lastChild;
    if (l && (l === i || l.nextSibling))
      for (; t.insertBefore(l.cloneNode(!0), s), !(l === i || !(l = l.nextSibling)); )
        ;
    else {
      yl.innerHTML = Ui(
        n === "svg" ? `<svg>${e}</svg>` : n === "mathml" ? `<math>${e}</math>` : e
      );
      const u = yl.content;
      if (n === "svg" || n === "mathml") {
        const f = u.firstChild;
        for (; f.firstChild; )
          u.appendChild(f.firstChild);
        u.removeChild(f);
      }
      t.insertBefore(u, s);
    }
    return [
      // first
      r ? r.nextSibling : t.firstChild,
      // last
      s ? s.previousSibling : t.lastChild
    ];
  }
}, Wr = Symbol("_vtc");
function zr(e, t, s) {
  const n = e[Wr];
  n && (t = (t ? [t, ...n] : [...n]).join(" ")), t == null ? e.removeAttribute("class") : s ? e.setAttribute("class", t) : e.className = t;
}
const bl = Symbol("_vod"), qr = Symbol("_vsh"), Jr = Symbol(""), Gr = /(^|;)\s*display\s*:/;
function Yr(e, t, s) {
  const n = e.style, l = de(s);
  let i = !1;
  if (s && !l) {
    if (t)
      if (de(t))
        for (const r of t.split(";")) {
          const u = r.slice(0, r.indexOf(":")).trim();
          s[u] == null && _s(n, u, "");
        }
      else
        for (const r in t)
          s[r] == null && _s(n, r, "");
    for (const r in s)
      r === "display" && (i = !0), _s(n, r, s[r]);
  } else if (l) {
    if (t !== s) {
      const r = n[Jr];
      r && (s += ";" + r), n.cssText = s, i = Gr.test(s);
    }
  } else t && e.removeAttribute("style");
  bl in e && (e[bl] = i ? n.display : "", e[qr] && (n.display = "none"));
}
const _l = /\s*!important$/;
function _s(e, t, s) {
  if (D(s))
    s.forEach((n) => _s(e, t, n));
  else if (s == null && (s = ""), t.startsWith("--"))
    e.setProperty(t, s);
  else {
    const n = Xr(e, t);
    _l.test(s) ? e.setProperty(
      wt(n),
      s.replace(_l, ""),
      "important"
    ) : e[n] = s;
  }
}
const xl = ["Webkit", "Moz", "ms"], Gs = {};
function Xr(e, t) {
  const s = Gs[t];
  if (s)
    return s;
  let n = yt(t);
  if (n !== "filter" && n in e)
    return Gs[t] = n;
  n = Ul(n);
  for (let l = 0; l < xl.length; l++) {
    const i = xl[l] + n;
    if (i in e)
      return Gs[t] = i;
  }
  return t;
}
const wl = "http://www.w3.org/1999/xlink";
function Sl(e, t, s, n, l, i = to(t)) {
  n && t.startsWith("xlink:") ? s == null ? e.removeAttributeNS(wl, t.slice(6, t.length)) : e.setAttributeNS(wl, t, s) : s == null || i && !Kl(s) ? e.removeAttribute(t) : e.setAttribute(
    t,
    i ? "" : Ze(s) ? String(s) : s
  );
}
function Cl(e, t, s, n, l) {
  if (t === "innerHTML" || t === "textContent") {
    s != null && (e[t] = t === "innerHTML" ? Ui(s) : s);
    return;
  }
  const i = e.tagName;
  if (t === "value" && i !== "PROGRESS" && // custom elements may use _value internally
  !i.includes("-")) {
    const u = i === "OPTION" ? e.getAttribute("value") || "" : e.value, f = s == null ? (
      // #11647: value should be set as empty string for null and undefined,
      // but <input type="checkbox"> should be set as 'on'.
      e.type === "checkbox" ? "on" : ""
    ) : String(s);
    (u !== f || !("_value" in e)) && (e.value = f), s == null && e.removeAttribute(t), e._value = s;
    return;
  }
  let r = !1;
  if (s === "" || s == null) {
    const u = typeof e[t];
    u === "boolean" ? s = Kl(s) : s == null && u === "string" ? (s = "", r = !0) : u === "number" && (s = 0, r = !0);
  }
  try {
    e[t] = s;
  } catch {
  }
  r && e.removeAttribute(l || t);
}
function at(e, t, s, n) {
  e.addEventListener(t, s, n);
}
function Zr(e, t, s, n) {
  e.removeEventListener(t, s, n);
}
const Tl = Symbol("_vei");
function Qr(e, t, s, n, l = null) {
  const i = e[Tl] || (e[Tl] = {}), r = i[t];
  if (n && r)
    r.value = n;
  else {
    const [u, f] = ea(t);
    if (n) {
      const g = i[t] = na(
        n,
        l
      );
      at(e, u, g, f);
    } else r && (Zr(e, u, r, f), i[t] = void 0);
  }
}
const Al = /(?:Once|Passive|Capture)$/;
function ea(e) {
  let t;
  if (Al.test(e)) {
    t = {};
    let n;
    for (; n = e.match(Al); )
      e = e.slice(0, e.length - n[0].length), t[n[0].toLowerCase()] = !0;
  }
  return [e[2] === ":" ? e.slice(3) : wt(e.slice(2)), t];
}
let Ys = 0;
const ta = /* @__PURE__ */ Promise.resolve(), sa = () => Ys || (ta.then(() => Ys = 0), Ys = Date.now());
function na(e, t) {
  const s = (n) => {
    if (!n._vts)
      n._vts = Date.now();
    else if (n._vts <= s.attached)
      return;
    Qe(
      la(n, s.value),
      t,
      5,
      [n]
    );
  };
  return s.value = e, s.attached = sa(), s;
}
function la(e, t) {
  if (D(t)) {
    const s = e.stopImmediatePropagation;
    return e.stopImmediatePropagation = () => {
      s.call(e), e._stopped = !0;
    }, t.map(
      (n) => (l) => !l._stopped && n && n(l)
    );
  } else
    return t;
}
const Pl = (e) => e.charCodeAt(0) === 111 && e.charCodeAt(1) === 110 && // lowercase letter
e.charCodeAt(2) > 96 && e.charCodeAt(2) < 123, ia = (e, t, s, n, l, i) => {
  const r = l === "svg";
  t === "class" ? zr(e, n, r) : t === "style" ? Yr(e, s, n) : ks(t) ? pn(t) || Qr(e, t, s, n, i) : (t[0] === "." ? (t = t.slice(1), !0) : t[0] === "^" ? (t = t.slice(1), !1) : oa(e, t, n, r)) ? (Cl(e, t, n), !e.tagName.includes("-") && (t === "value" || t === "checked" || t === "selected") && Sl(e, t, n, r, i, t !== "value")) : /* #11081 force set props for possible async custom element */ e._isVueCE && (/[A-Z]/.test(t) || !de(n)) ? Cl(e, yt(t), n, i, t) : (t === "true-value" ? e._trueValue = n : t === "false-value" && (e._falseValue = n), Sl(e, t, n, r));
};
function oa(e, t, s, n) {
  if (n)
    return !!(t === "innerHTML" || t === "textContent" || t in e && Pl(t) && K(s));
  if (t === "spellcheck" || t === "draggable" || t === "translate" || t === "autocorrect" || t === "form" || t === "list" && e.tagName === "INPUT" || t === "type" && e.tagName === "TEXTAREA")
    return !1;
  if (t === "width" || t === "height") {
    const l = e.tagName;
    if (l === "IMG" || l === "VIDEO" || l === "CANVAS" || l === "SOURCE")
      return !1;
  }
  return Pl(t) && de(s) ? !1 : t in e;
}
const xt = (e) => {
  const t = e.props["onUpdate:modelValue"] || !1;
  return D(t) ? (s) => vs(t, s) : t;
};
function ra(e) {
  e.target.composing = !0;
}
function kl(e) {
  const t = e.target;
  t.composing && (t.composing = !1, t.dispatchEvent(new Event("input")));
}
const Ne = Symbol("_assign"), Ue = {
  created(e, { modifiers: { lazy: t, trim: s, number: n } }, l) {
    e[Ne] = xt(l);
    const i = n || l.props && l.props.type === "number";
    at(e, t ? "change" : "input", (r) => {
      if (r.target.composing) return;
      let u = e.value;
      s && (u = u.trim()), i && (u = xs(u)), e[Ne](u);
    }), s && at(e, "change", () => {
      e.value = e.value.trim();
    }), t || (at(e, "compositionstart", ra), at(e, "compositionend", kl), at(e, "change", kl));
  },
  // set value on mounted so it's after min/max for type="range"
  mounted(e, { value: t }) {
    e.value = t ?? "";
  },
  beforeUpdate(e, { value: t, oldValue: s, modifiers: { lazy: n, trim: l, number: i } }, r) {
    if (e[Ne] = xt(r), e.composing) return;
    const u = (i || e.type === "number") && !/^0\d/.test(e.value) ? xs(e.value) : e.value, f = t ?? "";
    u !== f && (document.activeElement === e && e.type !== "range" && (n && t === s || l && e.value.trim() === f) || (e.value = f));
  }
}, fn = {
  // #4096 array checkboxes need to be deep traversed
  deep: !0,
  created(e, t, s) {
    e[Ne] = xt(s), at(e, "change", () => {
      const n = e._modelValue, l = Vt(e), i = e.checked, r = e[Ne];
      if (D(n)) {
        const u = vn(n, l), f = u !== -1;
        if (i && !f)
          r(n.concat(l));
        else if (!i && f) {
          const g = [...n];
          g.splice(u, 1), r(g);
        }
      } else if (Ht(n)) {
        const u = new Set(n);
        i ? u.add(l) : u.delete(l), r(u);
      } else
        r(ji(e, i));
    });
  },
  // set initial checked on mount to wait for true-value/false-value
  mounted: Ol,
  beforeUpdate(e, t, s) {
    e[Ne] = xt(s), Ol(e, t, s);
  }
};
function Ol(e, { value: t, oldValue: s }, n) {
  e._modelValue = t;
  let l;
  if (D(t))
    l = vn(t, n.props.value) > -1;
  else if (Ht(t))
    l = t.has(n.props.value);
  else {
    if (t === s) return;
    l = Ot(t, ji(e, !0));
  }
  e.checked !== l && (e.checked = l);
}
const aa = {
  created(e, { value: t }, s) {
    e.checked = Ot(t, s.props.value), e[Ne] = xt(s), at(e, "change", () => {
      e[Ne](Vt(e));
    });
  },
  beforeUpdate(e, { value: t, oldValue: s }, n) {
    e[Ne] = xt(n), t !== s && (e.checked = Ot(t, n.props.value));
  }
}, Ki = {
  // <select multiple> value need to be deep traversed
  deep: !0,
  created(e, { value: t, modifiers: { number: s } }, n) {
    const l = Ht(t);
    at(e, "change", () => {
      const i = Array.prototype.filter.call(e.options, (r) => r.selected).map(
        (r) => s ? xs(Vt(r)) : Vt(r)
      );
      e[Ne](
        e.multiple ? l ? new Set(i) : i : i[0]
      ), e._assigning = !0, li(() => {
        e._assigning = !1;
      });
    }), e[Ne] = xt(n);
  },
  // set value in mounted & updated because <select> relies on its children
  // <option>s.
  mounted(e, { value: t }) {
    Ml(e, t);
  },
  beforeUpdate(e, t, s) {
    e[Ne] = xt(s);
  },
  updated(e, { value: t }) {
    e._assigning || Ml(e, t);
  }
};
function Ml(e, t) {
  const s = e.multiple, n = D(t);
  if (!(s && !n && !Ht(t))) {
    for (let l = 0, i = e.options.length; l < i; l++) {
      const r = e.options[l], u = Vt(r);
      if (s)
        if (n) {
          const f = typeof u;
          f === "string" || f === "number" ? r.selected = t.some((g) => String(g) === String(u)) : r.selected = vn(t, u) > -1;
        } else
          r.selected = t.has(u);
      else if (Ot(Vt(r), t)) {
        e.selectedIndex !== l && (e.selectedIndex = l);
        return;
      }
    }
    !s && e.selectedIndex !== -1 && (e.selectedIndex = -1);
  }
}
function Vt(e) {
  return "_value" in e ? e._value : e.value;
}
function ji(e, t) {
  const s = t ? "_trueValue" : "_falseValue";
  return s in e ? e[s] : t;
}
const El = {
  created(e, t, s) {
    gs(e, t, s, null, "created");
  },
  mounted(e, t, s) {
    gs(e, t, s, null, "mounted");
  },
  beforeUpdate(e, t, s, n) {
    gs(e, t, s, n, "beforeUpdate");
  },
  updated(e, t, s, n) {
    gs(e, t, s, n, "updated");
  }
};
function ua(e, t) {
  switch (e) {
    case "SELECT":
      return Ki;
    case "TEXTAREA":
      return Ue;
    default:
      switch (t) {
        case "checkbox":
          return fn;
        case "radio":
          return aa;
        default:
          return Ue;
      }
  }
}
function gs(e, t, s, n, l) {
  const r = ua(
    e.tagName,
    s.props && s.props.type
  )[l];
  r && r(e, t, s, n);
}
const ca = ["ctrl", "shift", "alt", "meta"], fa = {
  stop: (e) => e.stopPropagation(),
  prevent: (e) => e.preventDefault(),
  self: (e) => e.target !== e.currentTarget,
  ctrl: (e) => !e.ctrlKey,
  shift: (e) => !e.shiftKey,
  alt: (e) => !e.altKey,
  meta: (e) => !e.metaKey,
  left: (e) => "button" in e && e.button !== 0,
  middle: (e) => "button" in e && e.button !== 1,
  right: (e) => "button" in e && e.button !== 2,
  exact: (e, t) => ca.some((s) => e[`${s}Key`] && !t.includes(s))
}, qt = (e, t) => {
  const s = e._withMods || (e._withMods = {}), n = t.join(".");
  return s[n] || (s[n] = (l, ...i) => {
    for (let r = 0; r < t.length; r++) {
      const u = fa[t[r]];
      if (u && u(l, t)) return;
    }
    return e(l, ...i);
  });
}, da = {
  esc: "escape",
  space: " ",
  up: "arrow-up",
  left: "arrow-left",
  right: "arrow-right",
  down: "arrow-down",
  delete: "backspace"
}, pa = (e, t) => {
  const s = e._withKeys || (e._withKeys = {}), n = t.join(".");
  return s[n] || (s[n] = (l) => {
    if (!("key" in l))
      return;
    const i = wt(l.key);
    if (t.some(
      (r) => r === i || da[r] === i
    ))
      return e(l);
  });
}, ha = /* @__PURE__ */ Te({ patchProp: ia }, Br);
let Il;
function ga() {
  return Il || (Il = dr(ha));
}
const va = (...e) => {
  const t = ga().createApp(...e), { mount: s } = t;
  return t.mount = (n) => {
    const l = ya(n);
    if (!l) return;
    const i = t._component;
    !K(i) && !i.render && !i.template && (i.template = l.innerHTML), l.nodeType === 1 && (l.textContent = "");
    const r = s(l, !1, ma(l));
    return l instanceof Element && (l.removeAttribute("v-cloak"), l.setAttribute("data-v-app", "")), r;
  }, t;
};
function ma(e) {
  if (e instanceof SVGElement)
    return "svg";
  if (typeof MathMLElement == "function" && e instanceof MathMLElement)
    return "mathml";
}
function ya(e) {
  return de(e) ? document.querySelector(e) : e;
}
const ba = {
  key: 0,
  class: "app-shell"
}, _a = { class: "nav" }, xa = { class: "nav-email" }, wa = { class: "hero" }, Sa = { class: "hero-copy" }, Ca = { class: "actions" }, Ta = {
  class: "text-link",
  href: "#today"
}, Aa = { class: "hero-card" }, Pa = { class: "card-top" }, ka = { class: "live" }, Oa = { class: "temperature" }, Ma = { class: "signal" }, Ea = {
  key: 0,
  id: "market",
  class: "market-band"
}, Ia = {
  key: 0,
  class: "band-block"
}, Ra = { class: "index-strip" }, Fa = { key: 0 }, Da = {
  key: 1,
  class: "band-block"
}, Ua = { class: "breadth-grid" }, Ka = {
  key: 2,
  class: "band-block"
}, ja = { class: "chip-row" }, Na = {
  key: 3,
  class: "band-block"
}, $a = { class: "ladder-row" }, Va = {
  key: 4,
  class: "band-block"
}, Ha = { class: "focus-list" }, La = {
  id: "today",
  class: "section"
}, Ba = { class: "section-heading" }, Wa = {
  key: 0,
  class: "waiting-panel",
  role: "status",
  "aria-live": "polite"
}, za = {
  key: 1,
  class: "prev-note"
}, qa = { class: "report-preview" }, Ja = ["href"], Ga = { class: "modal-card" }, Ya = {
  key: 0,
  class: "alert",
  role: "status",
  "aria-live": "polite"
}, Xa = ["disabled"], Za = {
  key: 1,
  class: "admin-body"
}, Qa = { class: "admin-shell" }, eu = {
  key: 0,
  class: "admin-loading",
  role: "status",
  "aria-live": "polite"
}, tu = {
  key: 1,
  class: "admin-gate"
}, su = { class: "gate-error" }, nu = { class: "admin-sidebar" }, lu = { class: "admin-content" }, iu = {
  key: 0,
  class: "toast",
  role: "status",
  "aria-live": "polite"
}, ou = {
  key: 1,
  class: "admin-page"
}, ru = { class: "panel" }, au = { class: "page-title" }, uu = { class: "today-date" }, cu = { class: "stats today-stats" }, fu = { class: "stat" }, du = {
  key: 0,
  class: "task-spinner",
  "aria-hidden": "true"
}, pu = { class: "stat" }, hu = { class: "stat" }, gu = { class: "stats" }, vu = { class: "stat" }, mu = { class: "stat" }, yu = { class: "admin-actions" }, bu = ["disabled"], _u = {
  key: 2,
  class: "admin-page report-page"
}, xu = { class: "panel" }, wu = { class: "page-title" }, Su = { class: "page-count" }, Cu = { class: "report-grid" }, Tu = { class: "report-card-head" }, Au = {
  key: 0,
  class: "report-temp"
}, Pu = { class: "report-badges" }, ku = {
  key: 0,
  class: "status"
}, Ou = {
  key: 1,
  class: "status fail"
}, Mu = {
  key: 0,
  class: "report-row-summary"
}, Eu = { class: "report-card-actions" }, Iu = ["href"], Ru = ["onClick"], Fu = ["onClick"], Du = {
  key: 0,
  class: "notice"
}, Uu = { class: "pagination" }, Ku = ["disabled"], ju = ["onClick"], Nu = ["disabled"], $u = {
  key: 3,
  class: "admin-page"
}, Vu = { class: "panel" }, Hu = { class: "table-wrap" }, Lu = { class: "admin-table" }, Bu = {
  key: 0,
  class: "task-spinner",
  "aria-hidden": "true"
}, Wu = { key: 0 }, zu = {
  key: 4,
  class: "admin-page"
}, qu = { class: "panel" }, Ju = { class: "table-wrap" }, Gu = { class: "admin-table" }, Yu = { class: "rate-cell" }, Xu = { class: "progress-bar" }, Zu = { key: 0 }, Qu = {
  key: 5,
  class: "admin-page"
}, ec = { class: "panel" }, tc = { class: "page-title" }, sc = { class: "page-count" }, nc = { class: "table-toolbar" }, lc = { class: "table-wrap" }, ic = { class: "admin-table" }, oc = { key: 0 }, rc = {
  colspan: "3",
  class: "empty-cell"
}, ac = {
  key: 0,
  class: "pagination"
}, uc = ["disabled"], cc = ["onClick"], fc = ["disabled"], dc = {
  key: 6,
  class: "admin-page settings-page"
}, pc = { class: "panel" }, hc = { class: "page-title" }, gc = { class: "settings-summary" }, vc = { class: "settings-grid" }, mc = { class: "settings-span-2" }, yc = { class: "settings-span-2" }, bc = { class: "secret-input" }, _c = ["type"], xc = ["aria-label", "aria-pressed"], wc = { class: "settings-switches" }, Sc = { class: "settings-actions" }, Cc = ["disabled"], Tc = {
  role: "status",
  "aria-live": "polite"
}, Ac = {
  key: 7,
  class: "admin-page settings-page"
}, Pc = { class: "panel" }, kc = { class: "page-title" }, Oc = { class: "settings-summary" }, Mc = { class: "settings-grid" }, Ec = { class: "settings-span-2" }, Ic = { class: "secret-input" }, Rc = ["type"], Fc = ["aria-label", "aria-pressed"], Dc = { class: "settings-span-2" }, Uc = { class: "settings-switches" }, Kc = { class: "settings-actions" }, jc = {
  role: "status",
  "aria-live": "polite"
}, Nc = {
  key: 8,
  class: "admin-page settings-page"
}, $c = { class: "panel" }, Vc = { class: "page-title" }, Hc = { class: "settings-grid" }, Lc = { class: "skill-editor" }, Bc = { class: "editor-head" }, Wc = {
  role: "status",
  "aria-live": "polite"
}, zc = ["disabled"], qc = {
  key: 9,
  class: "admin-page settings-page"
}, Jc = { class: "panel" }, Gc = { class: "settings-summary api-cred" }, Yc = { class: "secret-input" }, Xc = ["type", "value"], Zc = ["aria-label", "aria-pressed"], Qc = {
  class: "settings-actions",
  style: { "justify-content": "space-between" }
}, ef = {
  role: "status",
  "aria-live": "polite"
}, tf = ["disabled"], sf = {
  key: 0,
  class: "manual-pre"
}, nf = {
  key: 1,
  class: "notice"
}, Xs = 10, Zs = 10, lf = {
  __name: "App",
  setup(e) {
    const t = ["today", "report-upload", "reports", "analysis", "progress", "users", "ai", "email", "api-manual"], s = location.pathname.split("/")[2], n = location.pathname === "/admin" || location.pathname.startsWith("/admin/") && t.includes(s), l = z({ date: "今日", analysisStatus: "waiting", analysis: null, reportPath: null }), i = z(null), r = ee(() => {
      var y, a;
      return !!((a = (y = i.value) == null ? void 0 : y.subscriptions) != null && a.includes("daily-review"));
    }), u = z(!1), f = z({ email: "" }), g = z(""), p = z(!1), m = z(null), O = z(n), E = z(""), V = z(""), j = z(""), H = z(t.includes(s) ? s : "today"), N = z(1), se = z(null), L = z(null), F = z({ apiKey: "", from: "", enabled: !0 }), oe = z(""), me = z(!1), Z = z({ provider: "OpenAI Compatible", protocol: "openai_responses", baseUrl: "", apiKey: "", model: "", timeoutSeconds: 300, enabled: !0 }), Ae = z(""), et = z(!1), Pe = z(!1), $e = z(""), dt = z(""), pt = z(""), Be = z(!1), We = z(""), fe = z(!1), Y = z({ date: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(/* @__PURE__ */ new Date()), markdown: "" }), q = z(!1), Ve = z(""), tt = z(""), ke = ee(() => l.value.analysisStatus === "analyzed"), Oe = ee(() => l.value.latestAnalyzed || null), Me = ee(() => ke.value ? l.value : Oe.value || l.value), Lt = ee(() => !ke.value && !!Oe.value), js = ee(() => !ke.value && !Oe.value), ce = ee(() => Me.value.analysis || {}), ht = ee(() => Array.isArray(ce.value.indices) ? ce.value.indices : []), St = ee(() => Array.isArray(ce.value.mainline) ? ce.value.mainline : []), Mt = ee(() => Array.isArray(ce.value.leadingStocks) ? ce.value.leadingStocks : []), st = ee(() => Array.isArray(ce.value.nextFocus) ? ce.value.nextFocus : []), cs = ee(() => {
      const y = ce.value.breadth || {};
      return [
        { label: "上涨", value: y.up, cls: "up" },
        { label: "下跌", value: y.down, cls: "down" },
        { label: "涨停", value: y.limitUp, cls: "up" },
        { label: "跌停", value: y.limitDown, cls: "down" },
        { label: "连板", value: y.streak, cls: "" },
        { label: "成交额", value: y.turnover, cls: "" }
      ].filter((a) => a.value !== null && a.value !== void 0 && a.value !== "");
    }), c = ee(() => ht.value.length || cs.value.length || St.value.length || Mt.value.length || st.value.length);
    function d(y) {
      const a = String(y || "");
      return a.startsWith("+") ? "up" : a.startsWith("-") ? "down" : "";
    }
    let h = null;
    function x(y) {
      tt.value = y, h && clearTimeout(h), h = setTimeout(() => {
        tt.value = "";
      }, 4e3);
    }
    function b(y) {
      if (!y) return "-";
      const a = new Date(y);
      return Number.isNaN(a.getTime()) ? y : new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: !1 }).format(a);
    }
    function _(y) {
      return y === "analyzed" ? "已生成" : y === "waiting_market" ? "待生成" : y === "failed" ? "失败" : y === "running" ? "生成中" : y || "-";
    }
    function P(y) {
      return y === "running" ? "渲染中" : y === "failed" ? "渲染失败" : y === "completed" ? "已完成" : "-";
    }
    ee(() => {
      var y;
      return ((y = m.value) == null ? void 0 : y.users.filter((a) => a.subscriptions.includes("daily-review")).length) || 0;
    });
    const T = ee(() => {
      var y, a;
      return (a = (y = m.value) == null ? void 0 : y.analysisTasks) == null ? void 0 : a.find((W) => W.date === m.value.today.date);
    }), S = ee(() => {
      var y, a;
      return (a = (y = m.value) == null ? void 0 : y.dailyProgress) == null ? void 0 : a.find((W) => W.date === m.value.today.date);
    }), w = ee(() => {
      var y;
      return ((y = T.value) == null ? void 0 : y.status) || null;
    });
    ee(() => {
      const y = T.value;
      if (!(y != null && y.startedAt) || !(y != null && y.completedAt)) return "进行中";
      const a = Math.max(0, Math.round((new Date(y.completedAt) - new Date(y.startedAt)) / 1e3));
      return a < 60 ? a + " 秒" : Math.floor(a / 60) + " 分 " + a % 60 + " 秒";
    });
    const I = ee(() => {
      var y;
      return (((y = m.value) == null ? void 0 : y.reportList) || []).slice(0, 60);
    }), A = ee(() => Math.max(1, Math.ceil(I.value.length / Xs))), R = ee(() => I.value.slice((N.value - 1) * Xs, N.value * Xs));
    function U(y) {
      N.value = Math.min(A.value, Math.max(1, y)), se.value = null;
    }
    async function $(y) {
      const a = y.date;
      if (!confirm(`确定重置 ${a} 的报告？将删除该日已生成报告并允许重新上传。`)) return;
      const W = await ze("/api/admin/reports/reset", { method: "POST", body: JSON.stringify({ date: a }) }), _e = await W.json();
      x(W.ok ? `已重置 ${a} 的报告` : _e.error || "重置失败"), W.ok && (se.value = null, await It());
    }
    async function X(y) {
      const a = y.date;
      if (!confirm(`确定重新生成 ${a} 的报告？将用当前 AI 配置重新排版该日报告，约 1-2 分钟完成。`)) return;
      const W = await ze("/api/admin/reports/regenerate", { method: "POST", body: JSON.stringify({ date: a }) }), _e = await W.json();
      x(W.ok ? `已触发 ${a} 报告重新生成，约 1-2 分钟后完成。` : _e.error || "重新生成失败");
    }
    const B = z(""), re = z(1), pe = ee(() => {
      var W;
      const y = B.value.trim().toLowerCase(), a = ((W = m.value) == null ? void 0 : W.users) || [];
      return y ? a.filter((_e) => String(_e.email || "").toLowerCase().includes(y)) : a;
    }), ye = ee(() => Math.max(1, Math.ceil(pe.value.length / Zs))), Ee = ee(() => {
      const y = (re.value - 1) * Zs;
      return pe.value.slice(y, y + Zs);
    }), nt = ee(() => {
      var a;
      const y = ((a = m.value) == null ? void 0 : a.users) || [];
      return { total: y.length, verified: y.filter((W) => W.verified).length, pending: y.filter((W) => !W.verified).length };
    });
    function Et(y) {
      re.value = Math.min(ye.value, Math.max(1, y));
    }
    async function be() {
      const [y, a] = await Promise.all([fetch("/api/today"), fetch("/api/me")]);
      y.ok && (l.value = await y.json()), a.ok && (i.value = (await a.json()).user || null);
    }
    async function Re() {
      const y = r.value ? "/api/unsubscribe" : "/api/subscribe", a = await fetch(y, { method: "POST", headers: { "Content-Type": "application/json" } }), W = await a.json();
      a.ok ? i.value = { ...i.value, subscriptions: W.subscriptions || [] } : (g.value = W.error || "操作失败，请稍后重试。", u.value = !0);
    }
    function Bt() {
      g.value = "", u.value = !0;
    }
    async function fs() {
      p.value = !0;
      try {
        const y = await fetch("/api/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f.value) }), a = await y.json();
        y.ok ? g.value = a.message : g.value = a.error || "操作失败，请稍后重试。";
      } finally {
        p.value = !1;
      }
    }
    const ze = (y, a = {}) => fetch(y, { ...a, headers: { "Content-Type": "application/json", "x-admin-key": j.value || E.value, ...a.headers || {} } });
    async function Mn() {
      if (!(await fetch("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: E.value }) })).ok) {
        V.value = "授权密码不正确。";
        return;
      }
      j.value = E.value, E.value = "", await It();
    }
    async function It() {
      const y = await ze("/api/admin/overview");
      y.ok && (m.value = await y.json(), await Ns());
    }
    async function Ns() {
      const y = await ze("/api/admin/settings");
      if (!y.ok) return;
      L.value = await y.json();
      const a = L.value.email;
      F.value = { apiKey: a.apiKey || "", from: a.from || "", enabled: a.enabled !== !1 };
      const W = L.value.ai;
      Z.value = { provider: W.provider || "OpenAI Compatible", protocol: W.protocol || "openai_responses", baseUrl: W.baseUrl || "", apiKey: W.apiKey || "", model: W.model || "", timeoutSeconds: W.timeoutSeconds || 300, enabled: W.enabled !== !1 };
    }
    async function Ni() {
      Ae.value = "保存中…";
      const y = await ze("/api/admin/settings/ai", { method: "PUT", body: JSON.stringify(Z.value) }), a = await y.json();
      Ae.value = y.ok ? "AI 配置已保存" : a.error || "保存失败", y.ok && await Ns();
    }
    async function $i() {
      et.value = !0, Ae.value = "正在检测模型服务…";
      try {
        const y = await ze("/api/admin/settings/ai/test", { method: "POST", body: "{}" }), a = await y.json();
        Ae.value = y.ok ? a.message : a.error || "检测失败";
      } finally {
        et.value = !1;
      }
    }
    async function Vi() {
      oe.value = "保存中…";
      const y = await ze("/api/admin/settings/email", { method: "PUT", body: JSON.stringify(F.value) }), a = await y.json();
      oe.value = y.ok ? "邮件配置已保存" : a.error || "保存失败", y.ok && await Ns();
    }
    async function Hi() {
      q.value = !0, Ve.value = "正在保存并生成报告…";
      try {
        const y = await ze("/api/admin/reports/upload", { method: "POST", body: JSON.stringify(Y.value) }), a = await y.json();
        Ve.value = y.ok ? `已保存报告：${a.title}（${a.date}），AI 排版约 1-2 分钟完成。` : a.error || "保存失败", y.ok && await It();
      } finally {
        q.value = !1;
      }
    }
    async function Li() {
      const y = await ze("/api/admin/send-daily", { method: "POST" }), a = await y.json().catch(() => ({}));
      x(y.ok ? `已发送今日日报（${a.recipients ?? 0} 位订阅用户）` : a.error || "发送失败"), await It();
    }
    async function En() {
      fe.value = !0;
      try {
        const y = await ze("/api/admin/api-manual");
        if (!y.ok) return;
        const a = await y.json();
        $e.value = a.manual || "", dt.value = a.baseUrl || "", pt.value = a.uploadKey || "";
      } finally {
        fe.value = !1;
      }
    }
    async function $s(y, a) {
      const W = () => {
        We.value = a, setTimeout(() => {
          We.value === a && (We.value = "");
        }, 2e3);
      };
      try {
        await navigator.clipboard.writeText(String(y || "")), W();
      } catch {
        const _e = document.createElement("textarea");
        _e.value = String(y || ""), _e.style.position = "fixed", _e.style.opacity = "0", document.body.appendChild(_e), _e.select();
        try {
          document.execCommand("copy"), W();
        } catch {
          We.value = "";
        }
        document.body.removeChild(_e);
      }
    }
    return di(async () => {
      if (n)
        try {
          (await fetch("/api/admin/session").then((a) => a.json())).authenticated && await Promise.all([It(), En()]);
        } finally {
          O.value = !1;
        }
      else await be();
    }), (y, a) => {
      var W, _e, In, Rn, Fn, Dn, Un, Kn, jn, Nn, $n, Vn, Hn, Ln, Bn, Wn, zn, qn, Jn, Gn, Yn, Xn, Zn, Qn;
      return ti(n) ? (k(), M("div", Za, [
        a[97] || (a[97] = o("header", { class: "nav" }, [
          o("a", {
            class: "logo",
            href: "/"
          }, [
            ae("行情日报"),
            o("span", null, "ADMIN CONSOLE")
          ]),
          o("nav", null, [
            o("a", { href: "/" }, "返回首页")
          ])
        ], -1)),
        o("main", Qa, [
          O.value ? (k(), M("section", eu, "正在验证后台会话…")) : m.value ? (k(), M(ue, { key: 2 }, [
            o("aside", nu, [
              a[50] || (a[50] = o("h2", null, "行情日报", -1)),
              a[51] || (a[51] = o("small", null, "OPERATIONS DESK", -1)),
              o("nav", null, [
                o("a", {
                  href: "/admin/today",
                  class: ie({ active: H.value === "today" })
                }, "今日状态", 2),
                o("a", {
                  href: "/admin/report-upload",
                  class: ie({ active: H.value === "report-upload" })
                }, "报告上传", 2),
                o("a", {
                  href: "/admin/reports",
                  class: ie({ active: H.value === "reports" })
                }, "每日报告", 2),
                o("a", {
                  href: "/admin/analysis",
                  class: ie({ active: H.value === "analysis" })
                }, "分析任务", 2),
                o("a", {
                  href: "/admin/progress",
                  class: ie({ active: H.value === "progress" })
                }, "发送进度", 2),
                o("a", {
                  href: "/admin/users",
                  class: ie({ active: H.value === "users" })
                }, "订阅用户", 2),
                o("a", {
                  href: "/admin/ai",
                  class: ie({ active: H.value === "ai" })
                }, "AI 设置", 2),
                o("a", {
                  href: "/admin/email",
                  class: ie({ active: H.value === "email" })
                }, "邮件设置", 2),
                o("a", {
                  href: "/admin/api-manual",
                  class: ie({ active: H.value === "api-manual" })
                }, "API 对接手册", 2)
              ]),
              a[52] || (a[52] = o("div", { class: "side-status" }, [
                ae("授权状态"),
                o("br"),
                o("strong", null, "已验证会话")
              ], -1))
            ]),
            o("section", lu, [
              o("div", { class: "admin-head" }, [
                a[53] || (a[53] = o("div", null, [
                  o("p", { class: "kicker" }, "OPERATIONS"),
                  o("h1", null, "行情日报后台"),
                  o("p", null, "外部分析服务上传当日报告后，即可预览并推送订阅邮件。")
                ], -1)),
                o("button", {
                  class: "ghost",
                  onClick: It
                }, "↻ 刷新数据")
              ]),
              tt.value ? (k(), M("p", iu, C(tt.value), 1)) : ne("", !0),
              H.value === "today" ? (k(), M("div", ou, [
                o("section", ru, [
                  o("div", au, [
                    o("div", null, [
                      a[54] || (a[54] = o("h2", null, "今日行情分析", -1)),
                      o("p", uu, C(m.value.today.date), 1)
                    ]),
                    o("span", {
                      class: ie(["status", m.value.today.analysisStatus === "analyzed" ? "ready" : ""])
                    }, C(m.value.today.analysisStatus === "analyzed" ? "报告已生成" : "报告未生成"), 3)
                  ]),
                  o("div", cu, [
                    o("div", fu, [
                      a[55] || (a[55] = o("small", null, "AI 渲染", -1)),
                      o("b", null, [
                        w.value === "running" ? (k(), M("span", du)) : ne("", !0),
                        ae(C(P(w.value)), 1)
                      ])
                    ]),
                    o("div", pu, [
                      a[56] || (a[56] = o("small", null, "已发送邮件", -1)),
                      o("b", null, C(((W = S.value) == null ? void 0 : W.sent) || 0) + " 个", 1)
                    ]),
                    o("div", hu, [
                      a[57] || (a[57] = o("small", null, "应发送", -1)),
                      o("b", null, C(((_e = S.value) == null ? void 0 : _e.expected) || 0), 1)
                    ])
                  ]),
                  o("div", gu, [
                    o("div", vu, [
                      a[58] || (a[58] = o("small", null, "发送失败", -1)),
                      o("b", null, C(((In = S.value) == null ? void 0 : In.failed) || 0), 1)
                    ]),
                    o("div", mu, [
                      a[59] || (a[59] = o("small", null, "待发送", -1)),
                      o("b", null, C(((Rn = S.value) == null ? void 0 : Rn.pending) || 0), 1)
                    ])
                  ]),
                  o("div", yu, [
                    o("button", {
                      class: "primary",
                      disabled: m.value.today.analysisStatus !== "analyzed",
                      onClick: Li
                    }, "发送今日日报", 8, bu)
                  ])
                ])
              ])) : H.value === "reports" ? (k(), M("div", _u, [
                o("section", xu, [
                  o("div", wu, [
                    a[60] || (a[60] = o("div", null, [
                      o("h2", null, "每日报告"),
                      o("p", null, "最近 60 个交易日，按日期从新到旧排列。可对已生成报告重新生成，或重置后重新上传。")
                    ], -1)),
                    o("span", Su, C(I.value.length) + " 个交易日", 1)
                  ]),
                  o("div", Cu, [
                    (k(!0), M(ue, null, He(R.value, (v) => {
                      var Ct, el;
                      return k(), M("div", {
                        key: v.date,
                        class: "report-card"
                      }, [
                        o("div", Tu, [
                          o("strong", null, C(v.date), 1),
                          ((Ct = v.analysis) == null ? void 0 : Ct.temperature) != null ? (k(), M("span", Au, C(v.analysis.temperature) + "°", 1)) : ne("", !0)
                        ]),
                        o("div", Pu, [
                          o("span", {
                            class: ie(["status", v.analysisStatus === "analyzed" ? "ready" : ""])
                          }, C(v.analysisStatus === "analyzed" ? "已生成" : "待生成"), 3),
                          o("span", {
                            class: ie(["status", v.sendStatus === "sent" ? "ready" : v.sendStatus === "failed" ? "fail" : ""])
                          }, C(v.sendStatus === "sent" ? "已发送" : v.sendStatus === "failed" ? "失败" : "未发送"), 3),
                          v.renderStatus === "running" ? (k(), M("span", ku, a[61] || (a[61] = [
                            o("span", {
                              class: "task-spinner",
                              "aria-hidden": "true"
                            }, null, -1),
                            ae("渲染中", -1)
                          ]))) : v.renderStatus === "failed" ? (k(), M("span", Ou, "渲染失败")) : ne("", !0)
                        ]),
                        (el = v.analysis) != null && el.summary ? (k(), M("p", Mu, C(v.analysis.summary), 1)) : ne("", !0),
                        o("div", Eu, [
                          v.reportPath ? (k(), M("a", {
                            key: 0,
                            href: v.reportPath,
                            target: "_blank",
                            rel: "noreferrer"
                          }, "查看报告 ↗", 8, Iu)) : ne("", !0),
                          v.analysisStatus === "analyzed" ? (k(), M("button", {
                            key: 1,
                            type: "button",
                            class: "report-reset",
                            onClick: (Bi) => X(v)
                          }, "重新生成", 8, Ru)) : ne("", !0),
                          o("button", {
                            type: "button",
                            class: "report-reset",
                            onClick: (Bi) => $(v)
                          }, "重置", 8, Fu)
                        ])
                      ]);
                    }), 128))
                  ]),
                  R.value.length ? ne("", !0) : (k(), M("p", Du, "暂无交易日报记录。")),
                  o("div", Uu, [
                    o("button", {
                      type: "button",
                      disabled: N.value === 1,
                      onClick: a[4] || (a[4] = (v) => U(N.value - 1))
                    }, "上一页", 8, Ku),
                    (k(!0), M(ue, null, He(A.value, (v) => (k(), M("button", {
                      key: v,
                      type: "button",
                      class: ie({ current: N.value === v }),
                      onClick: (Ct) => U(v)
                    }, C(v), 11, ju))), 128)),
                    o("button", {
                      type: "button",
                      disabled: N.value === A.value,
                      onClick: a[5] || (a[5] = (v) => U(N.value + 1))
                    }, "下一页", 8, Nu)
                  ])
                ])
              ])) : H.value === "analysis" ? (k(), M("div", $u, [
                o("section", Vu, [
                  a[64] || (a[64] = o("h2", null, "分析任务", -1)),
                  o("div", Hu, [
                    o("table", Lu, [
                      a[63] || (a[63] = o("thead", null, [
                        o("tr", null, [
                          o("th", null, "交易日"),
                          o("th", null, "触发方式"),
                          o("th", null, "状态"),
                          o("th", null, "开始时间"),
                          o("th", null, "完成时间")
                        ])
                      ], -1)),
                      o("tbody", null, [
                        (k(!0), M(ue, null, He(m.value.analysisTasks, (v) => (k(), M("tr", {
                          key: v.date
                        }, [
                          o("td", null, C(v.date), 1),
                          o("td", null, C(v.trigger === "upload" ? "外部分析上传" : v.trigger === "manual" ? "后台重新生成" : v.trigger || "-"), 1),
                          o("td", null, [
                            o("span", {
                              class: ie(["task-status", v.status])
                            }, [
                              v.status === "running" ? (k(), M("span", Bu)) : ne("", !0),
                              ae(C(v.status === "running" ? "生成中" : v.status === "completed" ? "已完成" : v.status === "failed" ? "失败" : "等待中"), 1)
                            ], 2)
                          ]),
                          o("td", null, C(b(v.startedAt)), 1),
                          o("td", null, C(b(v.completedAt)), 1)
                        ]))), 128)),
                        (Fn = m.value.analysisTasks) != null && Fn.length ? ne("", !0) : (k(), M("tr", Wu, a[62] || (a[62] = [
                          o("td", {
                            colspan: "5",
                            class: "empty-cell"
                          }, "暂无分析任务。", -1)
                        ])))
                      ])
                    ])
                  ])
                ])
              ])) : H.value === "progress" ? (k(), M("div", zu, [
                o("section", qu, [
                  a[67] || (a[67] = o("h2", null, "每日发送进度", -1)),
                  o("div", Ju, [
                    o("table", Gu, [
                      a[66] || (a[66] = o("thead", null, [
                        o("tr", null, [
                          o("th", null, "交易日"),
                          o("th", null, "分析"),
                          o("th", null, "应发送"),
                          o("th", null, "已发送"),
                          o("th", null, "失败"),
                          o("th", null, "待发送"),
                          o("th", null, "完成率")
                        ])
                      ], -1)),
                      o("tbody", null, [
                        (k(!0), M(ue, null, He(m.value.dailyProgress, (v) => (k(), M("tr", {
                          key: v.date
                        }, [
                          o("td", null, C(v.date), 1),
                          o("td", null, C(_(v.analysisStatus)), 1),
                          o("td", null, C(v.expected), 1),
                          o("td", null, C(v.sent), 1),
                          o("td", null, C(v.failed), 1),
                          o("td", null, C(v.pending), 1),
                          o("td", null, [
                            o("div", Yu, [
                              o("div", Xu, [
                                o("span", {
                                  style: Es({ width: (v.expected ? Math.round(v.sent / v.expected * 100) : 0) + "%" })
                                }, null, 4)
                              ]),
                              o("b", null, C(v.expected ? Math.round(v.sent / v.expected * 100) : 0) + "%", 1)
                            ])
                          ])
                        ]))), 128)),
                        (Dn = m.value.dailyProgress) != null && Dn.length ? ne("", !0) : (k(), M("tr", Zu, a[65] || (a[65] = [
                          o("td", {
                            colspan: "7",
                            class: "empty-cell"
                          }, "暂无发送记录。", -1)
                        ])))
                      ])
                    ])
                  ])
                ])
              ])) : H.value === "users" ? (k(), M("div", Qu, [
                o("section", ec, [
                  o("div", tc, [
                    o("div", null, [
                      a[68] || (a[68] = o("h2", null, "订阅用户", -1)),
                      o("p", null, "共 " + C(nt.value.total) + " 位注册用户，" + C(nt.value.verified) + " 已验证，" + C(nt.value.pending) + " 待验证。", 1)
                    ]),
                    o("span", sc, "显示 " + C(Ee.value.length) + " / " + C(pe.value.length), 1)
                  ]),
                  o("div", nc, [
                    xe(o("input", {
                      "onUpdate:modelValue": a[6] || (a[6] = (v) => B.value = v),
                      type: "search",
                      placeholder: "按邮箱搜索…",
                      "aria-label": "搜索订阅用户"
                    }, null, 512), [
                      [
                        Ue,
                        B.value,
                        void 0,
                        { trim: !0 }
                      ]
                    ])
                  ]),
                  o("div", lc, [
                    o("table", ic, [
                      a[69] || (a[69] = o("thead", null, [
                        o("tr", null, [
                          o("th", null, "邮箱"),
                          o("th", null, "验证状态"),
                          o("th", null, "注册时间")
                        ])
                      ], -1)),
                      o("tbody", null, [
                        (k(!0), M(ue, null, He(Ee.value, (v) => (k(), M("tr", {
                          key: v.id
                        }, [
                          o("td", null, C(v.email), 1),
                          o("td", null, C(v.verified ? "已验证" : "待验证"), 1),
                          o("td", null, C(b(v.createdAt)), 1)
                        ]))), 128)),
                        Ee.value.length ? ne("", !0) : (k(), M("tr", oc, [
                          o("td", rc, "暂无订阅用户" + C(B.value ? "（无匹配结果）" : "") + "。", 1)
                        ]))
                      ])
                    ])
                  ]),
                  ye.value > 1 ? (k(), M("div", ac, [
                    o("button", {
                      type: "button",
                      disabled: re.value === 1,
                      onClick: a[7] || (a[7] = (v) => Et(re.value - 1))
                    }, "上一页", 8, uc),
                    (k(!0), M(ue, null, He(ye.value, (v) => (k(), M("button", {
                      key: v,
                      type: "button",
                      class: ie({ current: re.value === v }),
                      onClick: (Ct) => Et(v)
                    }, C(v), 11, cc))), 128)),
                    o("button", {
                      type: "button",
                      disabled: re.value === ye.value,
                      onClick: a[8] || (a[8] = (v) => Et(re.value + 1))
                    }, "下一页", 8, fc)
                  ])) : ne("", !0)
                ])
              ])) : H.value === "ai" ? (k(), M("div", dc, [
                o("section", pc, [
                  o("div", hc, [
                    a[70] || (a[70] = o("div", null, [
                      o("h2", null, "AI 设置"),
                      o("p", null, "配置用于把行情 Markdown 排版为精美 HTML 报告的 GPT 或 Claude 模型服务。AI 从零设计排版并提炼首页数据（温度、指数、广度、主线等）；未配置或调用失败时回退基础渲染。")
                    ], -1)),
                    o("span", {
                      class: ie(["status", { ready: (Kn = (Un = L.value) == null ? void 0 : Un.ai) == null ? void 0 : Kn.apiKeyMasked }])
                    }, C((Nn = (jn = L.value) == null ? void 0 : jn.ai) != null && Nn.apiKeyMasked ? "已配置" : "未配置"), 3)
                  ]),
                  o("div", gc, [
                    o("div", null, [
                      a[71] || (a[71] = o("small", null, "服务商", -1)),
                      o("strong", null, C(((Vn = ($n = L.value) == null ? void 0 : $n.ai) == null ? void 0 : Vn.provider) || "OpenAI Compatible"), 1)
                    ]),
                    o("div", null, [
                      a[72] || (a[72] = o("small", null, "当前模型", -1)),
                      o("strong", null, C(((Ln = (Hn = L.value) == null ? void 0 : Hn.ai) == null ? void 0 : Ln.model) || "未设置"), 1)
                    ]),
                    o("div", null, [
                      a[73] || (a[73] = o("small", null, "调用协议", -1)),
                      o("strong", null, C(((Wn = (Bn = L.value) == null ? void 0 : Bn.ai) == null ? void 0 : Wn.protocol) === "anthropic_messages" ? "Claude Messages API" : "GPT Responses API"), 1)
                    ])
                  ]),
                  o("form", {
                    class: "settings-form",
                    onSubmit: qt(Ni, ["prevent"])
                  }, [
                    o("div", vc, [
                      o("label", null, [
                        a[74] || (a[74] = ae("服务商名称", -1)),
                        xe(o("input", {
                          "onUpdate:modelValue": a[9] || (a[9] = (v) => Z.value.provider = v),
                          maxlength: "80",
                          required: ""
                        }, null, 512), [
                          [
                            Ue,
                            Z.value.provider,
                            void 0,
                            { trim: !0 }
                          ]
                        ])
                      ]),
                      o("label", null, [
                        a[76] || (a[76] = ae("接口格式", -1)),
                        xe(o("select", {
                          "onUpdate:modelValue": a[10] || (a[10] = (v) => Z.value.protocol = v)
                        }, a[75] || (a[75] = [
                          o("option", { value: "openai_responses" }, "GPT Responses API", -1),
                          o("option", { value: "anthropic_messages" }, "Claude Messages API", -1)
                        ]), 512), [
                          [Ki, Z.value.protocol]
                        ])
                      ]),
                      o("label", null, [
                        a[77] || (a[77] = ae("模型 ID", -1)),
                        xe(o("input", {
                          "onUpdate:modelValue": a[11] || (a[11] = (v) => Z.value.model = v),
                          maxlength: "200",
                          required: "",
                          placeholder: "例如 gpt-5.6-luna 或 claude-sonnet-4-5"
                        }, null, 512), [
                          [
                            Ue,
                            Z.value.model,
                            void 0,
                            { trim: !0 }
                          ]
                        ])
                      ]),
                      o("label", null, [
                        a[78] || (a[78] = ae("接口超时（秒）", -1)),
                        xe(o("input", {
                          "onUpdate:modelValue": a[12] || (a[12] = (v) => Z.value.timeoutSeconds = v),
                          type: "number",
                          min: "30",
                          max: "3600",
                          required: ""
                        }, null, 512), [
                          [
                            Ue,
                            Z.value.timeoutSeconds,
                            void 0,
                            { number: !0 }
                          ]
                        ])
                      ]),
                      o("label", mc, [
                        a[79] || (a[79] = ae("Base URL", -1)),
                        xe(o("input", {
                          "onUpdate:modelValue": a[13] || (a[13] = (v) => Z.value.baseUrl = v),
                          type: "url",
                          placeholder: "https://api.openai.com/v1 或 https://api.anthropic.com/v1"
                        }, null, 512), [
                          [
                            Ue,
                            Z.value.baseUrl,
                            void 0,
                            { trim: !0 }
                          ]
                        ])
                      ]),
                      o("label", yc, [
                        a[80] || (a[80] = ae("API Key", -1)),
                        o("span", bc, [
                          xe(o("input", {
                            "onUpdate:modelValue": a[14] || (a[14] = (v) => Z.value.apiKey = v),
                            type: Pe.value ? "text" : "password",
                            autocomplete: "new-password",
                            placeholder: "输入 API Key"
                          }, null, 8, _c), [
                            [
                              El,
                              Z.value.apiKey,
                              void 0,
                              { trim: !0 }
                            ]
                          ]),
                          o("button", {
                            type: "button",
                            class: "secret-toggle",
                            "aria-label": Pe.value ? "隐藏 AI API Key" : "显示 AI API Key",
                            "aria-pressed": Pe.value,
                            onClick: a[15] || (a[15] = (v) => Pe.value = !Pe.value)
                          }, C(Pe.value ? "隐藏" : "显示"), 9, xc)
                        ])
                      ])
                    ]),
                    o("div", wc, [
                      o("label", null, [
                        xe(o("input", {
                          "onUpdate:modelValue": a[16] || (a[16] = (v) => Z.value.enabled = v),
                          type: "checkbox"
                        }, null, 512), [
                          [fn, Z.value.enabled]
                        ]),
                        a[81] || (a[81] = ae(" 启用 AI 排版（未启用或调用失败时回退到默认渲染）", -1))
                      ])
                    ]),
                    o("div", Sc, [
                      o("button", {
                        type: "button",
                        disabled: et.value,
                        onClick: $i
                      }, C(et.value ? "检测中…" : "检测连接"), 9, Cc),
                      a[82] || (a[82] = o("button", {
                        class: "primary",
                        type: "submit"
                      }, "保存 AI 配置", -1)),
                      o("span", Tc, C(Ae.value), 1)
                    ])
                  ], 32)
                ])
              ])) : H.value === "email" ? (k(), M("div", Ac, [
                o("section", Pc, [
                  o("div", kc, [
                    a[83] || (a[83] = o("div", null, [
                      o("h2", null, "邮件设置"),
                      o("p", null, "配置日报、验证邮件和手动推送使用的 Resend 服务。")
                    ], -1)),
                    o("span", {
                      class: ie(["status", { ready: (qn = (zn = L.value) == null ? void 0 : zn.email) == null ? void 0 : qn.apiKeyMasked }])
                    }, C((Gn = (Jn = L.value) == null ? void 0 : Jn.email) != null && Gn.apiKeyMasked ? "已配置" : "未配置"), 3)
                  ]),
                  o("div", Oc, [
                    a[86] || (a[86] = o("div", null, [
                      o("small", null, "邮件服务"),
                      o("strong", null, "Resend")
                    ], -1)),
                    o("div", null, [
                      a[84] || (a[84] = o("small", null, "发件人", -1)),
                      o("strong", null, C(((Xn = (Yn = L.value) == null ? void 0 : Yn.email) == null ? void 0 : Xn.from) || "未设置"), 1)
                    ]),
                    o("div", null, [
                      a[85] || (a[85] = o("small", null, "密钥状态", -1)),
                      o("strong", null, C(((Qn = (Zn = L.value) == null ? void 0 : Zn.email) == null ? void 0 : Qn.apiKeyMasked) || "未设置"), 1)
                    ])
                  ]),
                  o("form", {
                    class: "settings-form",
                    onSubmit: qt(Vi, ["prevent"])
                  }, [
                    o("div", Mc, [
                      o("label", Ec, [
                        a[87] || (a[87] = ae("Resend API Key", -1)),
                        o("span", Ic, [
                          xe(o("input", {
                            "onUpdate:modelValue": a[17] || (a[17] = (v) => F.value.apiKey = v),
                            type: me.value ? "text" : "password",
                            autocomplete: "new-password",
                            placeholder: "输入 re_ 开头的密钥"
                          }, null, 8, Rc), [
                            [
                              El,
                              F.value.apiKey,
                              void 0,
                              { trim: !0 }
                            ]
                          ]),
                          o("button", {
                            type: "button",
                            class: "secret-toggle",
                            "aria-label": me.value ? "隐藏 Resend API Key" : "显示 Resend API Key",
                            "aria-pressed": me.value,
                            onClick: a[18] || (a[18] = (v) => me.value = !me.value)
                          }, C(me.value ? "隐藏" : "显示"), 9, Fc)
                        ])
                      ]),
                      o("label", Dc, [
                        a[88] || (a[88] = ae("发件人地址", -1)),
                        xe(o("input", {
                          "onUpdate:modelValue": a[19] || (a[19] = (v) => F.value.from = v),
                          type: "text",
                          maxlength: "200",
                          placeholder: "行情日报 <reports@example.com>"
                        }, null, 512), [
                          [
                            Ue,
                            F.value.from,
                            void 0,
                            { trim: !0 }
                          ]
                        ])
                      ])
                    ]),
                    o("div", Uc, [
                      o("label", null, [
                        xe(o("input", {
                          "onUpdate:modelValue": a[20] || (a[20] = (v) => F.value.enabled = v),
                          type: "checkbox"
                        }, null, 512), [
                          [fn, F.value.enabled]
                        ]),
                        a[89] || (a[89] = ae(" 启用真实邮件发送", -1))
                      ])
                    ]),
                    o("div", Kc, [
                      a[90] || (a[90] = o("button", {
                        class: "primary",
                        type: "submit"
                      }, "保存邮件配置", -1)),
                      o("span", jc, C(oe.value), 1)
                    ])
                  ], 32)
                ])
              ])) : H.value === "report-upload" ? (k(), M("div", Nc, [
                o("section", $c, [
                  o("div", Vc, [
                    a[91] || (a[91] = o("div", null, [
                      o("h2", null, "报告上传"),
                      o("p", null, "手动保存当日行情报告的 Markdown，与外部接口上传共用同一处理机制：渲染 HTML、标记为已分析、可推送订阅邮件。")
                    ], -1)),
                    o("span", {
                      class: ie(["status", { ready: m.value.today.analysisStatus === "analyzed" }])
                    }, C(m.value.today.analysisStatus === "analyzed" ? "今日报告已生成" : "今日报告未生成"), 3)
                  ]),
                  o("form", {
                    class: "settings-form",
                    onSubmit: qt(Hi, ["prevent"])
                  }, [
                    o("div", Hc, [
                      o("label", null, [
                        a[92] || (a[92] = ae("交易日", -1)),
                        xe(o("input", {
                          "onUpdate:modelValue": a[21] || (a[21] = (v) => Y.value.date = v),
                          type: "date",
                          required: ""
                        }, null, 512), [
                          [
                            Ue,
                            Y.value.date,
                            void 0,
                            { trim: !0 }
                          ]
                        ])
                      ])
                    ]),
                    o("div", Lc, [
                      o("div", Bc, [
                        a[93] || (a[93] = o("h3", null, "报告 Markdown", -1)),
                        o("span", Wc, C(Ve.value), 1)
                      ]),
                      xe(o("textarea", {
                        "onUpdate:modelValue": a[22] || (a[22] = (v) => Y.value.markdown = v),
                        spellcheck: "false",
                        placeholder: `# A股收盘复盘

正文…（支持 YAML frontmatter 的 title / summary）`,
                        "aria-label": "报告 Markdown 内容"
                      }, null, 512), [
                        [Ue, Y.value.markdown]
                      ]),
                      o("button", {
                        class: "primary",
                        disabled: q.value,
                        type: "submit"
                      }, C(q.value ? "保存中…" : "保存并生成报告"), 9, zc)
                    ])
                  ], 32)
                ])
              ])) : H.value === "api-manual" ? (k(), M("div", qc, [
                o("section", Jc, [
                  o("div", { class: "page-title" }, [
                    a[94] || (a[94] = o("div", null, [
                      o("h2", null, "API 对接手册"),
                      o("p", null, "上传每日行情（报告 MD）接口对接说明。下方为真实接入信息与完整对接文本，复制后可直接给外部分析服务或 AI 工具使用；上传密钥请妥善保管。")
                    ], -1)),
                    o("button", {
                      class: "ghost refresh-button",
                      type: "button",
                      onClick: En
                    }, "↻ 刷新")
                  ]),
                  o("div", Gc, [
                    o("div", null, [
                      a[95] || (a[95] = o("small", null, "Base URL", -1)),
                      o("strong", null, C(dt.value || "—"), 1),
                      o("button", {
                        class: "manual-copy",
                        type: "button",
                        onClick: a[23] || (a[23] = (v) => $s(dt.value, "base"))
                      }, C(We.value === "base" ? "已复制 ✓" : "复制"), 1)
                    ]),
                    o("div", null, [
                      a[96] || (a[96] = o("small", null, "上传密钥 · x-upload-key", -1)),
                      o("strong", null, [
                        o("span", Yc, [
                          o("input", {
                            type: Be.value ? "text" : "password",
                            value: pt.value || "—",
                            readonly: "",
                            "aria-label": "上传密钥"
                          }, null, 8, Xc),
                          o("button", {
                            type: "button",
                            class: "secret-toggle",
                            "aria-label": Be.value ? "隐藏上传密钥" : "显示上传密钥",
                            "aria-pressed": Be.value,
                            onClick: a[24] || (a[24] = (v) => Be.value = !Be.value)
                          }, C(Be.value ? "隐藏" : "显示"), 9, Zc)
                        ])
                      ]),
                      o("button", {
                        class: "manual-copy",
                        type: "button",
                        onClick: a[25] || (a[25] = (v) => $s(pt.value, "upload"))
                      }, C(We.value === "upload" ? "已复制 ✓" : "复制"), 1)
                    ])
                  ]),
                  o("div", Qc, [
                    o("span", ef, C(fe.value ? "正在加载对接文本…" : $e.value ? "已加载完整对接文本（含真实密钥）。" : ""), 1),
                    o("button", {
                      class: "primary",
                      type: "button",
                      disabled: fe.value,
                      onClick: a[26] || (a[26] = (v) => $s($e.value, "full"))
                    }, C(We.value === "full" ? "已复制全文 ✓" : "复制全文（含真实密钥）"), 9, tf)
                  ]),
                  $e.value ? (k(), M("pre", sf, C($e.value), 1)) : (k(), M("p", nf, "正在加载对接手册…"))
                ])
              ])) : ne("", !0)
            ])
          ], 64)) : (k(), M("section", tu, [
            a[47] || (a[47] = o("p", { class: "gate-mark" }, "SECURE ADMIN", -1)),
            a[48] || (a[48] = o("h1", null, "进入行情日报后台", -1)),
            a[49] || (a[49] = o("p", null, "请输入后台授权密码。", -1)),
            o("label", null, [
              a[46] || (a[46] = ae("授权密码", -1)),
              xe(o("input", {
                "onUpdate:modelValue": a[3] || (a[3] = (v) => E.value = v),
                type: "password",
                onKeyup: pa(Mn, ["enter"])
              }, null, 544), [
                [Ue, E.value]
              ])
            ]),
            o("button", {
              class: "primary",
              onClick: Mn
            }, "验证并进入"),
            o("p", su, C(V.value), 1)
          ]))
        ])
      ])) : (k(), M("div", ba, [
        o("header", _a, [
          a[29] || (a[29] = o("a", {
            class: "logo",
            href: "/"
          }, [
            ae("行情日报"),
            o("span", null, "DAILY MARKET NOTE")
          ], -1)),
          o("nav", null, [
            a[27] || (a[27] = o("a", { href: "#today" }, "今日复盘", -1)),
            a[28] || (a[28] = o("a", { href: "#how" }, "怎么工作", -1)),
            i.value ? (k(), M(ue, { key: 0 }, [
              o("span", xa, C(i.value.email), 1),
              r.value ? (k(), M("button", {
                key: 0,
                type: "button",
                class: "ghost small",
                onClick: Re
              }, "退阅")) : (k(), M("button", {
                key: 1,
                type: "button",
                class: "ghost small",
                onClick: Re
              }, "重新订阅"))
            ], 64)) : (k(), M("button", {
              key: 1,
              class: "primary small",
              onClick: Bt
            }, "免费订阅"))
          ])
        ]),
        o("main", null, [
          o("section", wa, [
            o("div", Sa, [
              a[30] || (a[30] = o("p", { class: "kicker" }, "每天 15:46 · 邮箱送达", -1)),
              a[31] || (a[31] = o("h1", null, [
                ae("把收盘后的"),
                o("br"),
                o("em", null, "市场脉搏"),
                ae(" 发到你手上。")
              ], -1)),
              a[32] || (a[32] = o("p", { class: "lede" }, "一封清晰、克制、可验证的 A 股复盘。看懂主线、情绪和明日观察点。", -1)),
              o("div", Ca, [
                o("button", {
                  class: "primary",
                  onClick: Bt
                }, "免费订阅每日行情 →"),
                o("a", Ta, C(js.value ? "先看今天的报告" : "先看最新报告"), 1)
              ])
            ]),
            o("div", Aa, [
              o("div", Pa, [
                o("span", null, C(Me.value.date), 1),
                o("span", ka, "● " + C(Lt.value ? "上一交易日" : ke.value ? "已更新" : "准备中"), 1)
              ]),
              o("div", Oa, [
                a[33] || (a[33] = o("small", null, "市场温度", -1)),
                o("strong", null, C(ce.value.temperature != null ? ce.value.temperature + "°" : "--"), 1),
                o("b", null, C(Lt.value ? "展示上一交易日报告" : ke.value ? "收盘分析已完成" : "等待外部分析报告上传"), 1)
              ]),
              o("div", Ma, [
                a[34] || (a[34] = o("span", null, "主线", -1)),
                o("strong", null, C(Me.value.analysisStatus === "analyzed" ? ce.value.title || "今日复盘" : "今日行情分析准备中"), 1),
                o("small", null, C(Me.value.analysisStatus === "analyzed" ? ce.value.summary : "报告上传后，首页将自动更新"), 1)
              ])
            ])
          ]),
          Me.value.analysisStatus === "analyzed" && c.value ? (k(), M("section", Ea, [
            ht.value.length ? (k(), M("div", Ia, [
              a[35] || (a[35] = o("p", { class: "band-label" }, "主要指数", -1)),
              o("div", Ra, [
                (k(!0), M(ue, null, He(ht.value, (v) => (k(), M("div", {
                  key: v.name,
                  class: "index-chip"
                }, [
                  o("span", null, C(v.name), 1),
                  o("b", {
                    class: ie(d(v.change))
                  }, C(v.change || "--"), 3),
                  v.value ? (k(), M("small", Fa, C(v.value), 1)) : ne("", !0)
                ]))), 128))
              ])
            ])) : ne("", !0),
            cs.value.length ? (k(), M("div", Da, [
              a[36] || (a[36] = o("p", { class: "band-label" }, "市场广度", -1)),
              o("div", Ua, [
                (k(!0), M(ue, null, He(cs.value, (v) => (k(), M("div", {
                  key: v.label,
                  class: "breadth-cell"
                }, [
                  o("small", null, C(v.label), 1),
                  o("b", {
                    class: ie(v.cls)
                  }, C(v.value), 3)
                ]))), 128))
              ])
            ])) : ne("", !0),
            St.value.length ? (k(), M("div", Ka, [
              a[37] || (a[37] = o("p", { class: "band-label" }, "主线方向", -1)),
              o("div", ja, [
                (k(!0), M(ue, null, He(St.value, (v) => (k(), M("span", {
                  key: v,
                  class: "chip"
                }, C(v), 1))), 128))
              ])
            ])) : ne("", !0),
            Mt.value.length ? (k(), M("div", Na, [
              a[38] || (a[38] = o("p", { class: "band-label" }, "连板梯队", -1)),
              o("div", $a, [
                (k(!0), M(ue, null, He(Mt.value, (v, Ct) => (k(), M("div", {
                  key: Ct,
                  class: ie(["ladder-card", { top: Ct === 0 }])
                }, [
                  o("b", null, C(v.level), 1),
                  o("strong", null, C(v.name), 1),
                  o("small", null, C(v.sector || ""), 1)
                ], 2))), 128))
              ])
            ])) : ne("", !0),
            st.value.length ? (k(), M("div", Va, [
              a[39] || (a[39] = o("p", { class: "band-label" }, "明日观察", -1)),
              o("ul", Ha, [
                (k(!0), M(ue, null, He(st.value, (v) => (k(), M("li", { key: v }, C(v), 1))), 128))
              ])
            ])) : ne("", !0)
          ])) : ne("", !0),
          o("section", La, [
            o("div", Ba, [
              a[40] || (a[40] = o("p", { class: "kicker" }, "TODAY'S NOTE", -1)),
              o("h2", null, C(Me.value.date) + "，市场在交易什么？", 1)
            ]),
            ke.value ? ne("", !0) : (k(), M("div", Wa, a[41] || (a[41] = [
              o("span", { class: "waiting-dot" }, null, -1),
              o("div", null, [
                o("strong", null, "今日行情报告生成中"),
                o("p", null, "外部分析服务正在排版当日收盘复盘，通常需要几分钟。报告完成后此处将自动展示，请耐心等待。")
              ], -1)
            ]))),
            Lt.value ? (k(), M("p", za, "今日报告尚未生成，先展示上一交易日（" + C(Me.value.date) + "）的复盘。", 1)) : ne("", !0),
            o("div", qa, [
              o("h3", null, C(Me.value.analysisStatus === "analyzed" ? ce.value.title || "市场主线观察" : "等待外部分析报告上传，自动生成今日复盘。"), 1),
              o("p", null, C(Me.value.analysisStatus === "analyzed" ? ce.value.summary : "每日行情由外部分析服务上传报告后自动更新。"), 1),
              o("a", {
                class: "report-link",
                href: Me.value.reportPath || "#"
              }, C(Me.value.analysisStatus === "analyzed" ? "阅读完整 HTML 报告 →" : "等待今日报告生成"), 9, Ja)
            ])
          ]),
          a[42] || (a[42] = Mr('<section id="how" class="how section"><div class="section-heading"><p class="kicker">HOW IT WORKS</p><h2>三步开始你的每日复盘</h2></div><div class="steps"><div><b>1</b><h3>邮箱注册</h3><p>验证邮箱，建立你的专属订阅。</p></div><div><b>2</b><h3>选择产品</h3><p>先从每日行情开始。</p></div><div><b>3</b><h3>每天收到</h3><p>固定时间打开市场简报。</p></div></div></section>', 1))
        ]),
        u.value ? (k(), M("div", {
          key: 0,
          class: "modal show",
          onClick: a[2] || (a[2] = qt((v) => u.value = !1, ["self"]))
        }, [
          o("div", Ga, [
            o("button", {
              class: "close",
              onClick: a[0] || (a[0] = (v) => u.value = !1)
            }, "×"),
            a[44] || (a[44] = o("h2", { class: "auth-title" }, "订阅每日行情", -1)),
            a[45] || (a[45] = o("p", { class: "auth-copy" }, "填写邮箱后，我们会发送验证邮件。完成验证即可开始接收日报。", -1)),
            g.value ? (k(), M("div", Ya, C(g.value), 1)) : ne("", !0),
            o("form", {
              class: "auth-form",
              onSubmit: qt(fs, ["prevent"])
            }, [
              o("label", null, [
                a[43] || (a[43] = ae("邮箱", -1)),
                xe(o("input", {
                  "onUpdate:modelValue": a[1] || (a[1] = (v) => f.value.email = v),
                  type: "email",
                  autocomplete: "email",
                  required: ""
                }, null, 512), [
                  [
                    Ue,
                    f.value.email,
                    void 0,
                    { trim: !0 }
                  ]
                ])
              ]),
              o("button", {
                class: "primary",
                disabled: p.value
              }, C(p.value ? "发送中…" : "发送验证邮件"), 9, Xa)
            ], 32)
          ])
        ])) : ne("", !0)
      ]));
    };
  }
};
va(lf).mount("#app");
