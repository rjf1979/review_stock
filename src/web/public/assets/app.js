/**
* @vue/shared v3.5.18
* (c) 2018-present Yuxi (Evan) You and Vue contributors
* @license MIT
**/
/*! #__NO_SIDE_EFFECTS__ */
// @__NO_SIDE_EFFECTS__
function Ss(e) {
  const t = /* @__PURE__ */ Object.create(null);
  for (const s of e.split(",")) t[s] = 1;
  return (s) => s in t;
}
const B = {}, Qe = [], we = () => {
}, Ai = () => !1, Vt = (e) => e.charCodeAt(0) === 111 && e.charCodeAt(1) === 110 && // uppercase letter
(e.charCodeAt(2) > 122 || e.charCodeAt(2) < 97), Ts = (e) => e.startsWith("onUpdate:"), ne = Object.assign, Es = (e, t) => {
  const s = e.indexOf(t);
  s > -1 && e.splice(s, 1);
}, Ii = Object.prototype.hasOwnProperty, K = (e, t) => Ii.call(e, t), P = Array.isArray, at = (e) => kt(e) === "[object Map]", Pi = (e) => kt(e) === "[object Set]", R = (e) => typeof e == "function", J = (e) => typeof e == "string", st = (e) => typeof e == "symbol", q = (e) => e !== null && typeof e == "object", In = (e) => (q(e) || R(e)) && R(e.then) && R(e.catch), Ri = Object.prototype.toString, kt = (e) => Ri.call(e), Mi = (e) => kt(e).slice(8, -1), Di = (e) => kt(e) === "[object Object]", Cs = (e) => J(e) && e !== "NaN" && e[0] !== "-" && "" + parseInt(e, 10) === e, dt = /* @__PURE__ */ Ss(
  // the leading comma is intentional so empty string "" is also included
  ",key,ref,ref_for,ref_key,onVnodeBeforeMount,onVnodeMounted,onVnodeBeforeUpdate,onVnodeUpdated,onVnodeBeforeUnmount,onVnodeUnmounted"
), qt = (e) => {
  const t = /* @__PURE__ */ Object.create(null);
  return (s) => t[s] || (t[s] = e(s));
}, Fi = /-(\w)/g, Ne = qt(
  (e) => e.replace(Fi, (t, s) => s ? s.toUpperCase() : "")
), Hi = /\B([A-Z])/g, We = qt(
  (e) => e.replace(Hi, "-$1").toLowerCase()
), Pn = qt((e) => e.charAt(0).toUpperCase() + e.slice(1)), es = qt(
  (e) => e ? `on${Pn(e)}` : ""
), Le = (e, t) => !Object.is(e, t), ts = (e, ...t) => {
  for (let s = 0; s < e.length; s++)
    e[s](...t);
}, us = (e, t, s, n = !1) => {
  Object.defineProperty(e, t, {
    configurable: !0,
    enumerable: !1,
    writable: n,
    value: s
  });
}, Ki = (e) => {
  const t = parseFloat(e);
  return isNaN(t) ? e : t;
};
let zs;
const Gt = () => zs || (zs = typeof globalThis < "u" ? globalThis : typeof self < "u" ? self : typeof window < "u" ? window : typeof global < "u" ? global : {});
function Os(e) {
  if (P(e)) {
    const t = {};
    for (let s = 0; s < e.length; s++) {
      const n = e[s], i = J(n) ? $i(n) : Os(n);
      if (i)
        for (const r in i)
          t[r] = i[r];
    }
    return t;
  } else if (J(e) || q(e))
    return e;
}
const ji = /;(?![^(]*\))/g, Li = /:([^]+)/, Ni = /\/\*[^]*?\*\//g;
function $i(e) {
  const t = {};
  return e.replace(Ni, "").split(ji).forEach((s) => {
    if (s) {
      const n = s.split(Li);
      n.length > 1 && (t[n[0].trim()] = n[1].trim());
    }
  }), t;
}
function As(e) {
  let t = "";
  if (J(e))
    t = e;
  else if (P(e))
    for (let s = 0; s < e.length; s++) {
      const n = As(e[s]);
      n && (t += n + " ");
    }
  else if (q(e))
    for (const s in e)
      e[s] && (t += s + " ");
  return t.trim();
}
const Wi = "itemscope,allowfullscreen,formnovalidate,ismap,nomodule,novalidate,readonly", Bi = /* @__PURE__ */ Ss(Wi);
function Rn(e) {
  return !!e || e === "";
}
/**
* @vue/reactivity v3.5.18
* (c) 2018-present Yuxi (Evan) You and Vue contributors
* @license MIT
**/
let le;
class Ui {
  constructor(t = !1) {
    this.detached = t, this._active = !0, this._on = 0, this.effects = [], this.cleanups = [], this._isPaused = !1, this.parent = le, !t && le && (this.index = (le.scopes || (le.scopes = [])).push(
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
      const s = le;
      try {
        return le = this, t();
      } finally {
        le = s;
      }
    }
  }
  /**
   * This should only be called on non-detached scopes
   * @internal
   */
  on() {
    ++this._on === 1 && (this.prevScope = le, le = this);
  }
  /**
   * This should only be called on non-detached scopes
   * @internal
   */
  off() {
    this._on > 0 && --this._on === 0 && (le = this.prevScope, this.prevScope = void 0);
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
        const i = this.parent.scopes.pop();
        i && i !== this && (this.parent.scopes[this.index] = i, i.index = this.index);
      }
      this.parent = void 0;
    }
  }
}
function Vi() {
  return le;
}
let W;
const ss = /* @__PURE__ */ new WeakSet();
class Mn {
  constructor(t) {
    this.fn = t, this.deps = void 0, this.depsTail = void 0, this.flags = 5, this.next = void 0, this.cleanup = void 0, this.scheduler = void 0, le && le.active && le.effects.push(this);
  }
  pause() {
    this.flags |= 64;
  }
  resume() {
    this.flags & 64 && (this.flags &= -65, ss.has(this) && (ss.delete(this), this.trigger()));
  }
  /**
   * @internal
   */
  notify() {
    this.flags & 2 && !(this.flags & 32) || this.flags & 8 || Fn(this);
  }
  run() {
    if (!(this.flags & 1))
      return this.fn();
    this.flags |= 2, Xs(this), Hn(this);
    const t = W, s = ue;
    W = this, ue = !0;
    try {
      return this.fn();
    } finally {
      Kn(this), W = t, ue = s, this.flags &= -3;
    }
  }
  stop() {
    if (this.flags & 1) {
      for (let t = this.deps; t; t = t.nextDep)
        Rs(t);
      this.deps = this.depsTail = void 0, Xs(this), this.onStop && this.onStop(), this.flags &= -2;
    }
  }
  trigger() {
    this.flags & 64 ? ss.add(this) : this.scheduler ? this.scheduler() : this.runIfDirty();
  }
  /**
   * @internal
   */
  runIfDirty() {
    as(this) && this.run();
  }
  get dirty() {
    return as(this);
  }
}
let Dn = 0, ht, pt;
function Fn(e, t = !1) {
  if (e.flags |= 8, t) {
    e.next = pt, pt = e;
    return;
  }
  e.next = ht, ht = e;
}
function Is() {
  Dn++;
}
function Ps() {
  if (--Dn > 0)
    return;
  if (pt) {
    let t = pt;
    for (pt = void 0; t; ) {
      const s = t.next;
      t.next = void 0, t.flags &= -9, t = s;
    }
  }
  let e;
  for (; ht; ) {
    let t = ht;
    for (ht = void 0; t; ) {
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
function Hn(e) {
  for (let t = e.deps; t; t = t.nextDep)
    t.version = -1, t.prevActiveLink = t.dep.activeLink, t.dep.activeLink = t;
}
function Kn(e) {
  let t, s = e.depsTail, n = s;
  for (; n; ) {
    const i = n.prevDep;
    n.version === -1 ? (n === s && (s = i), Rs(n), ki(n)) : t = n, n.dep.activeLink = n.prevActiveLink, n.prevActiveLink = void 0, n = i;
  }
  e.deps = t, e.depsTail = s;
}
function as(e) {
  for (let t = e.deps; t; t = t.nextDep)
    if (t.dep.version !== t.version || t.dep.computed && (jn(t.dep.computed) || t.dep.version !== t.version))
      return !0;
  return !!e._dirty;
}
function jn(e) {
  if (e.flags & 4 && !(e.flags & 16) || (e.flags &= -17, e.globalVersion === xt) || (e.globalVersion = xt, !e.isSSR && e.flags & 128 && (!e.deps && !e._dirty || !as(e))))
    return;
  e.flags |= 2;
  const t = e.dep, s = W, n = ue;
  W = e, ue = !0;
  try {
    Hn(e);
    const i = e.fn(e._value);
    (t.version === 0 || Le(i, e._value)) && (e.flags |= 128, e._value = i, t.version++);
  } catch (i) {
    throw t.version++, i;
  } finally {
    W = s, ue = n, Kn(e), e.flags &= -3;
  }
}
function Rs(e, t = !1) {
  const { dep: s, prevSub: n, nextSub: i } = e;
  if (n && (n.nextSub = i, e.prevSub = void 0), i && (i.prevSub = n, e.nextSub = void 0), s.subs === e && (s.subs = n, !n && s.computed)) {
    s.computed.flags &= -5;
    for (let r = s.computed.deps; r; r = r.nextDep)
      Rs(r, !0);
  }
  !t && !--s.sc && s.map && s.map.delete(s.key);
}
function ki(e) {
  const { prevDep: t, nextDep: s } = e;
  t && (t.nextDep = s, e.prevDep = void 0), s && (s.prevDep = t, e.nextDep = void 0);
}
let ue = !0;
const Ln = [];
function Pe() {
  Ln.push(ue), ue = !1;
}
function Re() {
  const e = Ln.pop();
  ue = e === void 0 ? !0 : e;
}
function Xs(e) {
  const { cleanup: t } = e;
  if (e.cleanup = void 0, t) {
    const s = W;
    W = void 0;
    try {
      t();
    } finally {
      W = s;
    }
  }
}
let xt = 0;
class qi {
  constructor(t, s) {
    this.sub = t, this.dep = s, this.version = s.version, this.nextDep = this.prevDep = this.nextSub = this.prevSub = this.prevActiveLink = void 0;
  }
}
class Ms {
  // TODO isolatedDeclarations "__v_skip"
  constructor(t) {
    this.computed = t, this.version = 0, this.activeLink = void 0, this.subs = void 0, this.map = void 0, this.key = void 0, this.sc = 0, this.__v_skip = !0;
  }
  track(t) {
    if (!W || !ue || W === this.computed)
      return;
    let s = this.activeLink;
    if (s === void 0 || s.sub !== W)
      s = this.activeLink = new qi(W, this), W.deps ? (s.prevDep = W.depsTail, W.depsTail.nextDep = s, W.depsTail = s) : W.deps = W.depsTail = s, Nn(s);
    else if (s.version === -1 && (s.version = this.version, s.nextDep)) {
      const n = s.nextDep;
      n.prevDep = s.prevDep, s.prevDep && (s.prevDep.nextDep = n), s.prevDep = W.depsTail, s.nextDep = void 0, W.depsTail.nextDep = s, W.depsTail = s, W.deps === s && (W.deps = n);
    }
    return s;
  }
  trigger(t) {
    this.version++, xt++, this.notify(t);
  }
  notify(t) {
    Is();
    try {
      for (let s = this.subs; s; s = s.prevSub)
        s.sub.notify() && s.sub.dep.notify();
    } finally {
      Ps();
    }
  }
}
function Nn(e) {
  if (e.dep.sc++, e.sub.flags & 4) {
    const t = e.dep.computed;
    if (t && !e.dep.subs) {
      t.flags |= 20;
      for (let n = t.deps; n; n = n.nextDep)
        Nn(n);
    }
    const s = e.dep.subs;
    s !== e && (e.prevSub = s, s && (s.nextSub = e)), e.dep.subs = e;
  }
}
const ds = /* @__PURE__ */ new WeakMap(), Je = Symbol(
  ""
), hs = Symbol(
  ""
), yt = Symbol(
  ""
);
function z(e, t, s) {
  if (ue && W) {
    let n = ds.get(e);
    n || ds.set(e, n = /* @__PURE__ */ new Map());
    let i = n.get(s);
    i || (n.set(s, i = new Ms()), i.map = n, i.key = s), i.track();
  }
}
function Ie(e, t, s, n, i, r) {
  const l = ds.get(e);
  if (!l) {
    xt++;
    return;
  }
  const c = (u) => {
    u && u.trigger();
  };
  if (Is(), t === "clear")
    l.forEach(c);
  else {
    const u = P(e), p = u && Cs(s);
    if (u && s === "length") {
      const a = Number(n);
      l.forEach((g, T) => {
        (T === "length" || T === yt || !st(T) && T >= a) && c(g);
      });
    } else
      switch ((s !== void 0 || l.has(void 0)) && c(l.get(s)), p && c(l.get(yt)), t) {
        case "add":
          u ? p && c(l.get("length")) : (c(l.get(Je)), at(e) && c(l.get(hs)));
          break;
        case "delete":
          u || (c(l.get(Je)), at(e) && c(l.get(hs)));
          break;
        case "set":
          at(e) && c(l.get(Je));
          break;
      }
  }
  Ps();
}
function ze(e) {
  const t = H(e);
  return t === e ? t : (z(t, "iterate", yt), ae(e) ? t : t.map(ee));
}
function Ds(e) {
  return z(e = H(e), "iterate", yt), e;
}
const Gi = {
  __proto__: null,
  [Symbol.iterator]() {
    return ns(this, Symbol.iterator, ee);
  },
  concat(...e) {
    return ze(this).concat(
      ...e.map((t) => P(t) ? ze(t) : t)
    );
  },
  entries() {
    return ns(this, "entries", (e) => (e[1] = ee(e[1]), e));
  },
  every(e, t) {
    return Ee(this, "every", e, t, void 0, arguments);
  },
  filter(e, t) {
    return Ee(this, "filter", e, t, (s) => s.map(ee), arguments);
  },
  find(e, t) {
    return Ee(this, "find", e, t, ee, arguments);
  },
  findIndex(e, t) {
    return Ee(this, "findIndex", e, t, void 0, arguments);
  },
  findLast(e, t) {
    return Ee(this, "findLast", e, t, ee, arguments);
  },
  findLastIndex(e, t) {
    return Ee(this, "findLastIndex", e, t, void 0, arguments);
  },
  // flat, flatMap could benefit from ARRAY_ITERATE but are not straight-forward to implement
  forEach(e, t) {
    return Ee(this, "forEach", e, t, void 0, arguments);
  },
  includes(...e) {
    return is(this, "includes", e);
  },
  indexOf(...e) {
    return is(this, "indexOf", e);
  },
  join(e) {
    return ze(this).join(e);
  },
  // keys() iterator only reads `length`, no optimisation required
  lastIndexOf(...e) {
    return is(this, "lastIndexOf", e);
  },
  map(e, t) {
    return Ee(this, "map", e, t, void 0, arguments);
  },
  pop() {
    return ot(this, "pop");
  },
  push(...e) {
    return ot(this, "push", e);
  },
  reduce(e, ...t) {
    return Qs(this, "reduce", e, t);
  },
  reduceRight(e, ...t) {
    return Qs(this, "reduceRight", e, t);
  },
  shift() {
    return ot(this, "shift");
  },
  // slice could use ARRAY_ITERATE but also seems to beg for range tracking
  some(e, t) {
    return Ee(this, "some", e, t, void 0, arguments);
  },
  splice(...e) {
    return ot(this, "splice", e);
  },
  toReversed() {
    return ze(this).toReversed();
  },
  toSorted(e) {
    return ze(this).toSorted(e);
  },
  toSpliced(...e) {
    return ze(this).toSpliced(...e);
  },
  unshift(...e) {
    return ot(this, "unshift", e);
  },
  values() {
    return ns(this, "values", ee);
  }
};
function ns(e, t, s) {
  const n = Ds(e), i = n[t]();
  return n !== e && !ae(e) && (i._next = i.next, i.next = () => {
    const r = i._next();
    return r.value && (r.value = s(r.value)), r;
  }), i;
}
const Ji = Array.prototype;
function Ee(e, t, s, n, i, r) {
  const l = Ds(e), c = l !== e && !ae(e), u = l[t];
  if (u !== Ji[t]) {
    const g = u.apply(e, r);
    return c ? ee(g) : g;
  }
  let p = s;
  l !== e && (c ? p = function(g, T) {
    return s.call(this, ee(g), T, e);
  } : s.length > 2 && (p = function(g, T) {
    return s.call(this, g, T, e);
  }));
  const a = u.call(l, p, n);
  return c && i ? i(a) : a;
}
function Qs(e, t, s, n) {
  const i = Ds(e);
  let r = s;
  return i !== e && (ae(e) ? s.length > 3 && (r = function(l, c, u) {
    return s.call(this, l, c, u, e);
  }) : r = function(l, c, u) {
    return s.call(this, l, ee(c), u, e);
  }), i[t](r, ...n);
}
function is(e, t, s) {
  const n = H(e);
  z(n, "iterate", yt);
  const i = n[t](...s);
  return (i === -1 || i === !1) && js(s[0]) ? (s[0] = H(s[0]), n[t](...s)) : i;
}
function ot(e, t, s = []) {
  Pe(), Is();
  const n = H(e)[t].apply(e, s);
  return Ps(), Re(), n;
}
const Yi = /* @__PURE__ */ Ss("__proto__,__v_isRef,__isVue"), $n = new Set(
  /* @__PURE__ */ Object.getOwnPropertyNames(Symbol).filter((e) => e !== "arguments" && e !== "caller").map((e) => Symbol[e]).filter(st)
);
function zi(e) {
  st(e) || (e = String(e));
  const t = H(this);
  return z(t, "has", e), t.hasOwnProperty(e);
}
class Wn {
  constructor(t = !1, s = !1) {
    this._isReadonly = t, this._isShallow = s;
  }
  get(t, s, n) {
    if (s === "__v_skip") return t.__v_skip;
    const i = this._isReadonly, r = this._isShallow;
    if (s === "__v_isReactive")
      return !i;
    if (s === "__v_isReadonly")
      return i;
    if (s === "__v_isShallow")
      return r;
    if (s === "__v_raw")
      return n === (i ? r ? lr : kn : r ? Vn : Un).get(t) || // receiver is not the reactive proxy, but has the same prototype
      // this means the receiver is a user proxy of the reactive proxy
      Object.getPrototypeOf(t) === Object.getPrototypeOf(n) ? t : void 0;
    const l = P(t);
    if (!i) {
      let u;
      if (l && (u = Gi[s]))
        return u;
      if (s === "hasOwnProperty")
        return zi;
    }
    const c = Reflect.get(
      t,
      s,
      // if this is a proxy wrapping a ref, return methods using the raw ref
      // as receiver so that we don't have to call `toRaw` on the ref in all
      // its class methods
      X(t) ? t : n
    );
    return (st(s) ? $n.has(s) : Yi(s)) || (i || z(t, "get", s), r) ? c : X(c) ? l && Cs(s) ? c : c.value : q(c) ? i ? qn(c) : Hs(c) : c;
  }
}
class Bn extends Wn {
  constructor(t = !1) {
    super(!1, t);
  }
  set(t, s, n, i) {
    let r = t[s];
    if (!this._isShallow) {
      const u = Ye(r);
      if (!ae(n) && !Ye(n) && (r = H(r), n = H(n)), !P(t) && X(r) && !X(n))
        return u ? !1 : (r.value = n, !0);
    }
    const l = P(t) && Cs(s) ? Number(s) < t.length : K(t, s), c = Reflect.set(
      t,
      s,
      n,
      X(t) ? t : i
    );
    return t === H(i) && (l ? Le(n, r) && Ie(t, "set", s, n) : Ie(t, "add", s, n)), c;
  }
  deleteProperty(t, s) {
    const n = K(t, s);
    t[s];
    const i = Reflect.deleteProperty(t, s);
    return i && n && Ie(t, "delete", s, void 0), i;
  }
  has(t, s) {
    const n = Reflect.has(t, s);
    return (!st(s) || !$n.has(s)) && z(t, "has", s), n;
  }
  ownKeys(t) {
    return z(
      t,
      "iterate",
      P(t) ? "length" : Je
    ), Reflect.ownKeys(t);
  }
}
class Xi extends Wn {
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
const Qi = /* @__PURE__ */ new Bn(), Zi = /* @__PURE__ */ new Xi(), er = /* @__PURE__ */ new Bn(!0);
const ps = (e) => e, Mt = (e) => Reflect.getPrototypeOf(e);
function tr(e, t, s) {
  return function(...n) {
    const i = this.__v_raw, r = H(i), l = at(r), c = e === "entries" || e === Symbol.iterator && l, u = e === "keys" && l, p = i[e](...n), a = s ? ps : t ? gs : ee;
    return !t && z(
      r,
      "iterate",
      u ? hs : Je
    ), {
      // iterator protocol
      next() {
        const { value: g, done: T } = p.next();
        return T ? { value: g, done: T } : {
          value: c ? [a(g[0]), a(g[1])] : a(g),
          done: T
        };
      },
      // iterable protocol
      [Symbol.iterator]() {
        return this;
      }
    };
  };
}
function Dt(e) {
  return function(...t) {
    return e === "delete" ? !1 : e === "clear" ? void 0 : this;
  };
}
function sr(e, t) {
  const s = {
    get(i) {
      const r = this.__v_raw, l = H(r), c = H(i);
      e || (Le(i, c) && z(l, "get", i), z(l, "get", c));
      const { has: u } = Mt(l), p = t ? ps : e ? gs : ee;
      if (u.call(l, i))
        return p(r.get(i));
      if (u.call(l, c))
        return p(r.get(c));
      r !== l && r.get(i);
    },
    get size() {
      const i = this.__v_raw;
      return !e && z(H(i), "iterate", Je), Reflect.get(i, "size", i);
    },
    has(i) {
      const r = this.__v_raw, l = H(r), c = H(i);
      return e || (Le(i, c) && z(l, "has", i), z(l, "has", c)), i === c ? r.has(i) : r.has(i) || r.has(c);
    },
    forEach(i, r) {
      const l = this, c = l.__v_raw, u = H(c), p = t ? ps : e ? gs : ee;
      return !e && z(u, "iterate", Je), c.forEach((a, g) => i.call(r, p(a), p(g), l));
    }
  };
  return ne(
    s,
    e ? {
      add: Dt("add"),
      set: Dt("set"),
      delete: Dt("delete"),
      clear: Dt("clear")
    } : {
      add(i) {
        !t && !ae(i) && !Ye(i) && (i = H(i));
        const r = H(this);
        return Mt(r).has.call(r, i) || (r.add(i), Ie(r, "add", i, i)), this;
      },
      set(i, r) {
        !t && !ae(r) && !Ye(r) && (r = H(r));
        const l = H(this), { has: c, get: u } = Mt(l);
        let p = c.call(l, i);
        p || (i = H(i), p = c.call(l, i));
        const a = u.call(l, i);
        return l.set(i, r), p ? Le(r, a) && Ie(l, "set", i, r) : Ie(l, "add", i, r), this;
      },
      delete(i) {
        const r = H(this), { has: l, get: c } = Mt(r);
        let u = l.call(r, i);
        u || (i = H(i), u = l.call(r, i)), c && c.call(r, i);
        const p = r.delete(i);
        return u && Ie(r, "delete", i, void 0), p;
      },
      clear() {
        const i = H(this), r = i.size !== 0, l = i.clear();
        return r && Ie(
          i,
          "clear",
          void 0,
          void 0
        ), l;
      }
    }
  ), [
    "keys",
    "values",
    "entries",
    Symbol.iterator
  ].forEach((i) => {
    s[i] = tr(i, e, t);
  }), s;
}
function Fs(e, t) {
  const s = sr(e, t);
  return (n, i, r) => i === "__v_isReactive" ? !e : i === "__v_isReadonly" ? e : i === "__v_raw" ? n : Reflect.get(
    K(s, i) && i in n ? s : n,
    i,
    r
  );
}
const nr = {
  get: /* @__PURE__ */ Fs(!1, !1)
}, ir = {
  get: /* @__PURE__ */ Fs(!1, !0)
}, rr = {
  get: /* @__PURE__ */ Fs(!0, !1)
};
const Un = /* @__PURE__ */ new WeakMap(), Vn = /* @__PURE__ */ new WeakMap(), kn = /* @__PURE__ */ new WeakMap(), lr = /* @__PURE__ */ new WeakMap();
function or(e) {
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
function cr(e) {
  return e.__v_skip || !Object.isExtensible(e) ? 0 : or(Mi(e));
}
function Hs(e) {
  return Ye(e) ? e : Ks(
    e,
    !1,
    Qi,
    nr,
    Un
  );
}
function fr(e) {
  return Ks(
    e,
    !1,
    er,
    ir,
    Vn
  );
}
function qn(e) {
  return Ks(
    e,
    !0,
    Zi,
    rr,
    kn
  );
}
function Ks(e, t, s, n, i) {
  if (!q(e) || e.__v_raw && !(t && e.__v_isReactive))
    return e;
  const r = cr(e);
  if (r === 0)
    return e;
  const l = i.get(e);
  if (l)
    return l;
  const c = new Proxy(
    e,
    r === 2 ? n : s
  );
  return i.set(e, c), c;
}
function gt(e) {
  return Ye(e) ? gt(e.__v_raw) : !!(e && e.__v_isReactive);
}
function Ye(e) {
  return !!(e && e.__v_isReadonly);
}
function ae(e) {
  return !!(e && e.__v_isShallow);
}
function js(e) {
  return e ? !!e.__v_raw : !1;
}
function H(e) {
  const t = e && e.__v_raw;
  return t ? H(t) : e;
}
function ur(e) {
  return !K(e, "__v_skip") && Object.isExtensible(e) && us(e, "__v_skip", !0), e;
}
const ee = (e) => q(e) ? Hs(e) : e, gs = (e) => q(e) ? qn(e) : e;
function X(e) {
  return e ? e.__v_isRef === !0 : !1;
}
function ar(e) {
  return dr(e, !1);
}
function dr(e, t) {
  return X(e) ? e : new hr(e, t);
}
class hr {
  constructor(t, s) {
    this.dep = new Ms(), this.__v_isRef = !0, this.__v_isShallow = !1, this._rawValue = s ? t : H(t), this._value = s ? t : ee(t), this.__v_isShallow = s;
  }
  get value() {
    return this.dep.track(), this._value;
  }
  set value(t) {
    const s = this._rawValue, n = this.__v_isShallow || ae(t) || Ye(t);
    t = n ? t : H(t), Le(t, s) && (this._rawValue = t, this._value = n ? t : ee(t), this.dep.trigger());
  }
}
function Ce(e) {
  return X(e) ? e.value : e;
}
const pr = {
  get: (e, t, s) => t === "__v_raw" ? e : Ce(Reflect.get(e, t, s)),
  set: (e, t, s, n) => {
    const i = e[t];
    return X(i) && !X(s) ? (i.value = s, !0) : Reflect.set(e, t, s, n);
  }
};
function Gn(e) {
  return gt(e) ? e : new Proxy(e, pr);
}
class gr {
  constructor(t, s, n) {
    this.fn = t, this.setter = s, this._value = void 0, this.dep = new Ms(this), this.__v_isRef = !0, this.deps = void 0, this.depsTail = void 0, this.flags = 16, this.globalVersion = xt - 1, this.next = void 0, this.effect = this, this.__v_isReadonly = !s, this.isSSR = n;
  }
  /**
   * @internal
   */
  notify() {
    if (this.flags |= 16, !(this.flags & 8) && // avoid infinite self recursion
    W !== this)
      return Fn(this, !0), !0;
  }
  get value() {
    const t = this.dep.track();
    return jn(this), t && (t.version = this.dep.version), this._value;
  }
  set value(t) {
    this.setter && this.setter(t);
  }
}
function mr(e, t, s = !1) {
  let n, i;
  return R(e) ? n = e : (n = e.get, i = e.set), new gr(n, i, s);
}
const Ft = {}, Nt = /* @__PURE__ */ new WeakMap();
let Ge;
function _r(e, t = !1, s = Ge) {
  if (s) {
    let n = Nt.get(s);
    n || Nt.set(s, n = []), n.push(e);
  }
}
function br(e, t, s = B) {
  const { immediate: n, deep: i, once: r, scheduler: l, augmentJob: c, call: u } = s, p = (A) => i ? A : ae(A) || i === !1 || i === 0 ? je(A, 1) : je(A);
  let a, g, T, E, F = !1, D = !1;
  if (X(e) ? (g = () => e.value, F = ae(e)) : gt(e) ? (g = () => p(e), F = !0) : P(e) ? (D = !0, F = e.some((A) => gt(A) || ae(A)), g = () => e.map((A) => {
    if (X(A))
      return A.value;
    if (gt(A))
      return p(A);
    if (R(A))
      return u ? u(A, 2) : A();
  })) : R(e) ? t ? g = u ? () => u(e, 2) : e : g = () => {
    if (T) {
      Pe();
      try {
        T();
      } finally {
        Re();
      }
    }
    const A = Ge;
    Ge = a;
    try {
      return u ? u(e, 3, [E]) : e(E);
    } finally {
      Ge = A;
    }
  } : g = we, t && i) {
    const A = g, G = i === !0 ? 1 / 0 : i;
    g = () => je(A(), G);
  }
  const Y = Vi(), L = () => {
    a.stop(), Y && Y.active && Es(Y.effects, a);
  };
  if (r && t) {
    const A = t;
    t = (...G) => {
      A(...G), L();
    };
  }
  let V = D ? new Array(e.length).fill(Ft) : Ft;
  const k = (A) => {
    if (!(!(a.flags & 1) || !a.dirty && !A))
      if (t) {
        const G = a.run();
        if (i || F || (D ? G.some((De, de) => Le(De, V[de])) : Le(G, V))) {
          T && T();
          const De = Ge;
          Ge = a;
          try {
            const de = [
              G,
              // pass undefined as the old value when it's changed for the first time
              V === Ft ? void 0 : D && V[0] === Ft ? [] : V,
              E
            ];
            V = G, u ? u(t, 3, de) : (
              // @ts-expect-error
              t(...de)
            );
          } finally {
            Ge = De;
          }
        }
      } else
        a.run();
  };
  return c && c(k), a = new Mn(g), a.scheduler = l ? () => l(k, !1) : k, E = (A) => _r(A, !1, a), T = a.onStop = () => {
    const A = Nt.get(a);
    if (A) {
      if (u)
        u(A, 4);
      else
        for (const G of A) G();
      Nt.delete(a);
    }
  }, t ? n ? k(!0) : V = a.run() : l ? l(k.bind(null, !0), !0) : a.run(), L.pause = a.pause.bind(a), L.resume = a.resume.bind(a), L.stop = L, L;
}
function je(e, t = 1 / 0, s) {
  if (t <= 0 || !q(e) || e.__v_skip || (s = s || /* @__PURE__ */ new Set(), s.has(e)))
    return e;
  if (s.add(e), t--, X(e))
    je(e.value, t, s);
  else if (P(e))
    for (let n = 0; n < e.length; n++)
      je(e[n], t, s);
  else if (Pi(e) || at(e))
    e.forEach((n) => {
      je(n, t, s);
    });
  else if (Di(e)) {
    for (const n in e)
      je(e[n], t, s);
    for (const n of Object.getOwnPropertySymbols(e))
      Object.prototype.propertyIsEnumerable.call(e, n) && je(e[n], t, s);
  }
  return e;
}
/**
* @vue/runtime-core v3.5.18
* (c) 2018-present Yuxi (Evan) You and Vue contributors
* @license MIT
**/
function Et(e, t, s, n) {
  try {
    return n ? e(...n) : e();
  } catch (i) {
    Jt(i, t, s);
  }
}
function Te(e, t, s, n) {
  if (R(e)) {
    const i = Et(e, t, s, n);
    return i && In(i) && i.catch((r) => {
      Jt(r, t, s);
    }), i;
  }
  if (P(e)) {
    const i = [];
    for (let r = 0; r < e.length; r++)
      i.push(Te(e[r], t, s, n));
    return i;
  }
}
function Jt(e, t, s, n = !0) {
  const i = t ? t.vnode : null, { errorHandler: r, throwUnhandledErrorInProduction: l } = t && t.appContext.config || B;
  if (t) {
    let c = t.parent;
    const u = t.proxy, p = `https://vuejs.org/error-reference/#runtime-${s}`;
    for (; c; ) {
      const a = c.ec;
      if (a) {
        for (let g = 0; g < a.length; g++)
          if (a[g](e, u, p) === !1)
            return;
      }
      c = c.parent;
    }
    if (r) {
      Pe(), Et(r, null, 10, [
        e,
        u,
        p
      ]), Re();
      return;
    }
  }
  vr(e, s, i, n, l);
}
function vr(e, t, s, n = !0, i = !1) {
  if (i)
    throw e;
  console.error(e);
}
const te = [];
let ve = -1;
const Ze = [];
let He = null, Xe = 0;
const Jn = /* @__PURE__ */ Promise.resolve();
let $t = null;
function xr(e) {
  const t = $t || Jn;
  return e ? t.then(this ? e.bind(this) : e) : t;
}
function yr(e) {
  let t = ve + 1, s = te.length;
  for (; t < s; ) {
    const n = t + s >>> 1, i = te[n], r = wt(i);
    r < e || r === e && i.flags & 2 ? t = n + 1 : s = n;
  }
  return t;
}
function Ls(e) {
  if (!(e.flags & 1)) {
    const t = wt(e), s = te[te.length - 1];
    !s || // fast path when the job id is larger than the tail
    !(e.flags & 2) && t >= wt(s) ? te.push(e) : te.splice(yr(t), 0, e), e.flags |= 1, Yn();
  }
}
function Yn() {
  $t || ($t = Jn.then(Xn));
}
function wr(e) {
  P(e) ? Ze.push(...e) : He && e.id === -1 ? He.splice(Xe + 1, 0, e) : e.flags & 1 || (Ze.push(e), e.flags |= 1), Yn();
}
function Zs(e, t, s = ve + 1) {
  for (; s < te.length; s++) {
    const n = te[s];
    if (n && n.flags & 2) {
      if (e && n.id !== e.uid)
        continue;
      te.splice(s, 1), s--, n.flags & 4 && (n.flags &= -2), n(), n.flags & 4 || (n.flags &= -2);
    }
  }
}
function zn(e) {
  if (Ze.length) {
    const t = [...new Set(Ze)].sort(
      (s, n) => wt(s) - wt(n)
    );
    if (Ze.length = 0, He) {
      He.push(...t);
      return;
    }
    for (He = t, Xe = 0; Xe < He.length; Xe++) {
      const s = He[Xe];
      s.flags & 4 && (s.flags &= -2), s.flags & 8 || s(), s.flags &= -2;
    }
    He = null, Xe = 0;
  }
}
const wt = (e) => e.id == null ? e.flags & 2 ? -1 : 1 / 0 : e.id;
function Xn(e) {
  try {
    for (ve = 0; ve < te.length; ve++) {
      const t = te[ve];
      t && !(t.flags & 8) && (t.flags & 4 && (t.flags &= -2), Et(
        t,
        t.i,
        t.i ? 15 : 14
      ), t.flags & 4 || (t.flags &= -2));
    }
  } finally {
    for (; ve < te.length; ve++) {
      const t = te[ve];
      t && (t.flags &= -2);
    }
    ve = -1, te.length = 0, zn(), $t = null, (te.length || Ze.length) && Xn();
  }
}
let ye = null, Qn = null;
function Wt(e) {
  const t = ye;
  return ye = e, Qn = e && e.type.__scopeId || null, t;
}
function Sr(e, t = ye, s) {
  if (!t || e._n)
    return e;
  const n = (...i) => {
    n._d && fn(-1);
    const r = Wt(t);
    let l;
    try {
      l = e(...i);
    } finally {
      Wt(r), n._d && fn(1);
    }
    return l;
  };
  return n._n = !0, n._c = !0, n._d = !0, n;
}
function ke(e, t, s, n) {
  const i = e.dirs, r = t && t.dirs;
  for (let l = 0; l < i.length; l++) {
    const c = i[l];
    r && (c.oldValue = r[l].value);
    let u = c.dir[n];
    u && (Pe(), Te(u, s, 8, [
      e.el,
      c,
      e,
      t
    ]), Re());
  }
}
const Tr = Symbol("_vte"), Er = (e) => e.__isTeleport;
function Ns(e, t) {
  e.shapeFlag & 6 && e.component ? (e.transition = t, Ns(e.component.subTree, t)) : e.shapeFlag & 128 ? (e.ssContent.transition = t.clone(e.ssContent), e.ssFallback.transition = t.clone(e.ssFallback)) : e.transition = t;
}
function Zn(e) {
  e.ids = [e.ids[0] + e.ids[2]++ + "-", 0, 0];
}
function mt(e, t, s, n, i = !1) {
  if (P(e)) {
    e.forEach(
      (F, D) => mt(
        F,
        t && (P(t) ? t[D] : t),
        s,
        n,
        i
      )
    );
    return;
  }
  if (_t(n) && !i) {
    n.shapeFlag & 512 && n.type.__asyncResolved && n.component.subTree.component && mt(e, t, s, n.component.subTree);
    return;
  }
  const r = n.shapeFlag & 4 ? Us(n.component) : n.el, l = i ? null : r, { i: c, r: u } = e, p = t && t.r, a = c.refs === B ? c.refs = {} : c.refs, g = c.setupState, T = H(g), E = g === B ? () => !1 : (F) => K(T, F);
  if (p != null && p !== u && (J(p) ? (a[p] = null, E(p) && (g[p] = null)) : X(p) && (p.value = null)), R(u))
    Et(u, c, 12, [l, a]);
  else {
    const F = J(u), D = X(u);
    if (F || D) {
      const Y = () => {
        if (e.f) {
          const L = F ? E(u) ? g[u] : a[u] : u.value;
          i ? P(L) && Es(L, r) : P(L) ? L.includes(r) || L.push(r) : F ? (a[u] = [r], E(u) && (g[u] = a[u])) : (u.value = [r], e.k && (a[e.k] = u.value));
        } else F ? (a[u] = l, E(u) && (g[u] = l)) : D && (u.value = l, e.k && (a[e.k] = l));
      };
      l ? (Y.id = -1, ce(Y, s)) : Y();
    }
  }
}
Gt().requestIdleCallback;
Gt().cancelIdleCallback;
const _t = (e) => !!e.type.__asyncLoader, ei = (e) => e.type.__isKeepAlive;
function Cr(e, t) {
  ti(e, "a", t);
}
function Or(e, t) {
  ti(e, "da", t);
}
function ti(e, t, s = se) {
  const n = e.__wdc || (e.__wdc = () => {
    let i = s;
    for (; i; ) {
      if (i.isDeactivated)
        return;
      i = i.parent;
    }
    return e();
  });
  if (Yt(t, n, s), s) {
    let i = s.parent;
    for (; i && i.parent; )
      ei(i.parent.vnode) && Ar(n, t, s, i), i = i.parent;
  }
}
function Ar(e, t, s, n) {
  const i = Yt(
    t,
    e,
    n,
    !0
    /* prepend */
  );
  si(() => {
    Es(n[t], i);
  }, s);
}
function Yt(e, t, s = se, n = !1) {
  if (s) {
    const i = s[e] || (s[e] = []), r = t.__weh || (t.__weh = (...l) => {
      Pe();
      const c = Ct(s), u = Te(t, s, e, l);
      return c(), Re(), u;
    });
    return n ? i.unshift(r) : i.push(r), r;
  }
}
const Me = (e) => (t, s = se) => {
  (!Tt || e === "sp") && Yt(e, (...n) => t(...n), s);
}, Ir = Me("bm"), Pr = Me("m"), Rr = Me(
  "bu"
), Mr = Me("u"), Dr = Me(
  "bum"
), si = Me("um"), Fr = Me(
  "sp"
), Hr = Me("rtg"), Kr = Me("rtc");
function jr(e, t = se) {
  Yt("ec", e, t);
}
const Lr = Symbol.for("v-ndc"), ms = (e) => e ? Si(e) ? Us(e) : ms(e.parent) : null, bt = (
  // Move PURE marker to new line to workaround compiler discarding it
  // due to type annotation
  /* @__PURE__ */ ne(/* @__PURE__ */ Object.create(null), {
    $: (e) => e,
    $el: (e) => e.vnode.el,
    $data: (e) => e.data,
    $props: (e) => e.props,
    $attrs: (e) => e.attrs,
    $slots: (e) => e.slots,
    $refs: (e) => e.refs,
    $parent: (e) => ms(e.parent),
    $root: (e) => ms(e.root),
    $host: (e) => e.ce,
    $emit: (e) => e.emit,
    $options: (e) => ii(e),
    $forceUpdate: (e) => e.f || (e.f = () => {
      Ls(e.update);
    }),
    $nextTick: (e) => e.n || (e.n = xr.bind(e.proxy)),
    $watch: (e) => ll.bind(e)
  })
), rs = (e, t) => e !== B && !e.__isScriptSetup && K(e, t), Nr = {
  get({ _: e }, t) {
    if (t === "__v_skip")
      return !0;
    const { ctx: s, setupState: n, data: i, props: r, accessCache: l, type: c, appContext: u } = e;
    let p;
    if (t[0] !== "$") {
      const E = l[t];
      if (E !== void 0)
        switch (E) {
          case 1:
            return n[t];
          case 2:
            return i[t];
          case 4:
            return s[t];
          case 3:
            return r[t];
        }
      else {
        if (rs(n, t))
          return l[t] = 1, n[t];
        if (i !== B && K(i, t))
          return l[t] = 2, i[t];
        if (
          // only cache other properties when instance has declared (thus stable)
          // props
          (p = e.propsOptions[0]) && K(p, t)
        )
          return l[t] = 3, r[t];
        if (s !== B && K(s, t))
          return l[t] = 4, s[t];
        _s && (l[t] = 0);
      }
    }
    const a = bt[t];
    let g, T;
    if (a)
      return t === "$attrs" && z(e.attrs, "get", ""), a(e);
    if (
      // css module (injected by vue-loader)
      (g = c.__cssModules) && (g = g[t])
    )
      return g;
    if (s !== B && K(s, t))
      return l[t] = 4, s[t];
    if (
      // global properties
      T = u.config.globalProperties, K(T, t)
    )
      return T[t];
  },
  set({ _: e }, t, s) {
    const { data: n, setupState: i, ctx: r } = e;
    return rs(i, t) ? (i[t] = s, !0) : n !== B && K(n, t) ? (n[t] = s, !0) : K(e.props, t) || t[0] === "$" && t.slice(1) in e ? !1 : (r[t] = s, !0);
  },
  has({
    _: { data: e, setupState: t, accessCache: s, ctx: n, appContext: i, propsOptions: r }
  }, l) {
    let c;
    return !!s[l] || e !== B && K(e, l) || rs(t, l) || (c = r[0]) && K(c, l) || K(n, l) || K(bt, l) || K(i.config.globalProperties, l);
  },
  defineProperty(e, t, s) {
    return s.get != null ? e._.accessCache[t] = 0 : K(s, "value") && this.set(e, t, s.value, null), Reflect.defineProperty(e, t, s);
  }
};
function en(e) {
  return P(e) ? e.reduce(
    (t, s) => (t[s] = null, t),
    {}
  ) : e;
}
let _s = !0;
function $r(e) {
  const t = ii(e), s = e.proxy, n = e.ctx;
  _s = !1, t.beforeCreate && tn(t.beforeCreate, e, "bc");
  const {
    // state
    data: i,
    computed: r,
    methods: l,
    watch: c,
    provide: u,
    inject: p,
    // lifecycle
    created: a,
    beforeMount: g,
    mounted: T,
    beforeUpdate: E,
    updated: F,
    activated: D,
    deactivated: Y,
    beforeDestroy: L,
    beforeUnmount: V,
    destroyed: k,
    unmounted: A,
    render: G,
    renderTracked: De,
    renderTriggered: de,
    errorCaptured: Fe,
    serverPrefetch: Ot,
    // public API
    expose: Be,
    inheritAttrs: nt,
    // assets
    components: At,
    directives: It,
    filters: Qt
  } = t;
  if (p && Wr(p, n, null), l)
    for (const U in l) {
      const N = l[U];
      R(N) && (n[U] = N.bind(s));
    }
  if (i) {
    const U = i.call(s, s);
    q(U) && (e.data = Hs(U));
  }
  if (_s = !0, r)
    for (const U in r) {
      const N = r[U], Ue = R(N) ? N.bind(s, s) : R(N.get) ? N.get.bind(s, s) : we, Pt = !R(N) && R(N.set) ? N.set.bind(s) : we, Ve = Il({
        get: Ue,
        set: Pt
      });
      Object.defineProperty(n, U, {
        enumerable: !0,
        configurable: !0,
        get: () => Ve.value,
        set: (he) => Ve.value = he
      });
    }
  if (c)
    for (const U in c)
      ni(c[U], n, s, U);
  if (u) {
    const U = R(u) ? u.call(s) : u;
    Reflect.ownKeys(U).forEach((N) => {
      Gr(N, U[N]);
    });
  }
  a && tn(a, e, "c");
  function Q(U, N) {
    P(N) ? N.forEach((Ue) => U(Ue.bind(s))) : N && U(N.bind(s));
  }
  if (Q(Ir, g), Q(Pr, T), Q(Rr, E), Q(Mr, F), Q(Cr, D), Q(Or, Y), Q(jr, Fe), Q(Kr, De), Q(Hr, de), Q(Dr, V), Q(si, A), Q(Fr, Ot), P(Be))
    if (Be.length) {
      const U = e.exposed || (e.exposed = {});
      Be.forEach((N) => {
        Object.defineProperty(U, N, {
          get: () => s[N],
          set: (Ue) => s[N] = Ue,
          enumerable: !0
        });
      });
    } else e.exposed || (e.exposed = {});
  G && e.render === we && (e.render = G), nt != null && (e.inheritAttrs = nt), At && (e.components = At), It && (e.directives = It), Ot && Zn(e);
}
function Wr(e, t, s = we) {
  P(e) && (e = bs(e));
  for (const n in e) {
    const i = e[n];
    let r;
    q(i) ? "default" in i ? r = Ht(
      i.from || n,
      i.default,
      !0
    ) : r = Ht(i.from || n) : r = Ht(i), X(r) ? Object.defineProperty(t, n, {
      enumerable: !0,
      configurable: !0,
      get: () => r.value,
      set: (l) => r.value = l
    }) : t[n] = r;
  }
}
function tn(e, t, s) {
  Te(
    P(e) ? e.map((n) => n.bind(t.proxy)) : e.bind(t.proxy),
    t,
    s
  );
}
function ni(e, t, s, n) {
  let i = n.includes(".") ? _i(s, n) : () => s[n];
  if (J(e)) {
    const r = t[e];
    R(r) && os(i, r);
  } else if (R(e))
    os(i, e.bind(s));
  else if (q(e))
    if (P(e))
      e.forEach((r) => ni(r, t, s, n));
    else {
      const r = R(e.handler) ? e.handler.bind(s) : t[e.handler];
      R(r) && os(i, r, e);
    }
}
function ii(e) {
  const t = e.type, { mixins: s, extends: n } = t, {
    mixins: i,
    optionsCache: r,
    config: { optionMergeStrategies: l }
  } = e.appContext, c = r.get(t);
  let u;
  return c ? u = c : !i.length && !s && !n ? u = t : (u = {}, i.length && i.forEach(
    (p) => Bt(u, p, l, !0)
  ), Bt(u, t, l)), q(t) && r.set(t, u), u;
}
function Bt(e, t, s, n = !1) {
  const { mixins: i, extends: r } = t;
  r && Bt(e, r, s, !0), i && i.forEach(
    (l) => Bt(e, l, s, !0)
  );
  for (const l in t)
    if (!(n && l === "expose")) {
      const c = Br[l] || s && s[l];
      e[l] = c ? c(e[l], t[l]) : t[l];
    }
  return e;
}
const Br = {
  data: sn,
  props: nn,
  emits: nn,
  // objects
  methods: ut,
  computed: ut,
  // lifecycle
  beforeCreate: Z,
  created: Z,
  beforeMount: Z,
  mounted: Z,
  beforeUpdate: Z,
  updated: Z,
  beforeDestroy: Z,
  beforeUnmount: Z,
  destroyed: Z,
  unmounted: Z,
  activated: Z,
  deactivated: Z,
  errorCaptured: Z,
  serverPrefetch: Z,
  // assets
  components: ut,
  directives: ut,
  // watch
  watch: Vr,
  // provide / inject
  provide: sn,
  inject: Ur
};
function sn(e, t) {
  return t ? e ? function() {
    return ne(
      R(e) ? e.call(this, this) : e,
      R(t) ? t.call(this, this) : t
    );
  } : t : e;
}
function Ur(e, t) {
  return ut(bs(e), bs(t));
}
function bs(e) {
  if (P(e)) {
    const t = {};
    for (let s = 0; s < e.length; s++)
      t[e[s]] = e[s];
    return t;
  }
  return e;
}
function Z(e, t) {
  return e ? [...new Set([].concat(e, t))] : t;
}
function ut(e, t) {
  return e ? ne(/* @__PURE__ */ Object.create(null), e, t) : t;
}
function nn(e, t) {
  return e ? P(e) && P(t) ? [.../* @__PURE__ */ new Set([...e, ...t])] : ne(
    /* @__PURE__ */ Object.create(null),
    en(e),
    en(t ?? {})
  ) : t;
}
function Vr(e, t) {
  if (!e) return t;
  if (!t) return e;
  const s = ne(/* @__PURE__ */ Object.create(null), e);
  for (const n in t)
    s[n] = Z(e[n], t[n]);
  return s;
}
function ri() {
  return {
    app: null,
    config: {
      isNativeTag: Ai,
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
let kr = 0;
function qr(e, t) {
  return function(n, i = null) {
    R(n) || (n = ne({}, n)), i != null && !q(i) && (i = null);
    const r = ri(), l = /* @__PURE__ */ new WeakSet(), c = [];
    let u = !1;
    const p = r.app = {
      _uid: kr++,
      _component: n,
      _props: i,
      _container: null,
      _context: r,
      _instance: null,
      version: Pl,
      get config() {
        return r.config;
      },
      set config(a) {
      },
      use(a, ...g) {
        return l.has(a) || (a && R(a.install) ? (l.add(a), a.install(p, ...g)) : R(a) && (l.add(a), a(p, ...g))), p;
      },
      mixin(a) {
        return r.mixins.includes(a) || r.mixins.push(a), p;
      },
      component(a, g) {
        return g ? (r.components[a] = g, p) : r.components[a];
      },
      directive(a, g) {
        return g ? (r.directives[a] = g, p) : r.directives[a];
      },
      mount(a, g, T) {
        if (!u) {
          const E = p._ceVNode || Se(n, i);
          return E.appContext = r, T === !0 ? T = "svg" : T === !1 && (T = void 0), e(E, a, T), u = !0, p._container = a, a.__vue_app__ = p, Us(E.component);
        }
      },
      onUnmount(a) {
        c.push(a);
      },
      unmount() {
        u && (Te(
          c,
          p._instance,
          16
        ), e(null, p._container), delete p._container.__vue_app__);
      },
      provide(a, g) {
        return r.provides[a] = g, p;
      },
      runWithContext(a) {
        const g = et;
        et = p;
        try {
          return a();
        } finally {
          et = g;
        }
      }
    };
    return p;
  };
}
let et = null;
function Gr(e, t) {
  if (se) {
    let s = se.provides;
    const n = se.parent && se.parent.provides;
    n === s && (s = se.provides = Object.create(n)), s[e] = t;
  }
}
function Ht(e, t, s = !1) {
  const n = Sl();
  if (n || et) {
    let i = et ? et._context.provides : n ? n.parent == null || n.ce ? n.vnode.appContext && n.vnode.appContext.provides : n.parent.provides : void 0;
    if (i && e in i)
      return i[e];
    if (arguments.length > 1)
      return s && R(t) ? t.call(n && n.proxy) : t;
  }
}
const li = {}, oi = () => Object.create(li), ci = (e) => Object.getPrototypeOf(e) === li;
function Jr(e, t, s, n = !1) {
  const i = {}, r = oi();
  e.propsDefaults = /* @__PURE__ */ Object.create(null), fi(e, t, i, r);
  for (const l in e.propsOptions[0])
    l in i || (i[l] = void 0);
  s ? e.props = n ? i : fr(i) : e.type.props ? e.props = i : e.props = r, e.attrs = r;
}
function Yr(e, t, s, n) {
  const {
    props: i,
    attrs: r,
    vnode: { patchFlag: l }
  } = e, c = H(i), [u] = e.propsOptions;
  let p = !1;
  if (
    // always force full diff in dev
    // - #1942 if hmr is enabled with sfc component
    // - vite#872 non-sfc component used by sfc component
    (n || l > 0) && !(l & 16)
  ) {
    if (l & 8) {
      const a = e.vnode.dynamicProps;
      for (let g = 0; g < a.length; g++) {
        let T = a[g];
        if (zt(e.emitsOptions, T))
          continue;
        const E = t[T];
        if (u)
          if (K(r, T))
            E !== r[T] && (r[T] = E, p = !0);
          else {
            const F = Ne(T);
            i[F] = vs(
              u,
              c,
              F,
              E,
              e,
              !1
            );
          }
        else
          E !== r[T] && (r[T] = E, p = !0);
      }
    }
  } else {
    fi(e, t, i, r) && (p = !0);
    let a;
    for (const g in c)
      (!t || // for camelCase
      !K(t, g) && // it's possible the original props was passed in as kebab-case
      // and converted to camelCase (#955)
      ((a = We(g)) === g || !K(t, a))) && (u ? s && // for camelCase
      (s[g] !== void 0 || // for kebab-case
      s[a] !== void 0) && (i[g] = vs(
        u,
        c,
        g,
        void 0,
        e,
        !0
      )) : delete i[g]);
    if (r !== c)
      for (const g in r)
        (!t || !K(t, g)) && (delete r[g], p = !0);
  }
  p && Ie(e.attrs, "set", "");
}
function fi(e, t, s, n) {
  const [i, r] = e.propsOptions;
  let l = !1, c;
  if (t)
    for (let u in t) {
      if (dt(u))
        continue;
      const p = t[u];
      let a;
      i && K(i, a = Ne(u)) ? !r || !r.includes(a) ? s[a] = p : (c || (c = {}))[a] = p : zt(e.emitsOptions, u) || (!(u in n) || p !== n[u]) && (n[u] = p, l = !0);
    }
  if (r) {
    const u = H(s), p = c || B;
    for (let a = 0; a < r.length; a++) {
      const g = r[a];
      s[g] = vs(
        i,
        u,
        g,
        p[g],
        e,
        !K(p, g)
      );
    }
  }
  return l;
}
function vs(e, t, s, n, i, r) {
  const l = e[s];
  if (l != null) {
    const c = K(l, "default");
    if (c && n === void 0) {
      const u = l.default;
      if (l.type !== Function && !l.skipFactory && R(u)) {
        const { propsDefaults: p } = i;
        if (s in p)
          n = p[s];
        else {
          const a = Ct(i);
          n = p[s] = u.call(
            null,
            t
          ), a();
        }
      } else
        n = u;
      i.ce && i.ce._setProp(s, n);
    }
    l[
      0
      /* shouldCast */
    ] && (r && !c ? n = !1 : l[
      1
      /* shouldCastTrue */
    ] && (n === "" || n === We(s)) && (n = !0));
  }
  return n;
}
const zr = /* @__PURE__ */ new WeakMap();
function ui(e, t, s = !1) {
  const n = s ? zr : t.propsCache, i = n.get(e);
  if (i)
    return i;
  const r = e.props, l = {}, c = [];
  let u = !1;
  if (!R(e)) {
    const a = (g) => {
      u = !0;
      const [T, E] = ui(g, t, !0);
      ne(l, T), E && c.push(...E);
    };
    !s && t.mixins.length && t.mixins.forEach(a), e.extends && a(e.extends), e.mixins && e.mixins.forEach(a);
  }
  if (!r && !u)
    return q(e) && n.set(e, Qe), Qe;
  if (P(r))
    for (let a = 0; a < r.length; a++) {
      const g = Ne(r[a]);
      rn(g) && (l[g] = B);
    }
  else if (r)
    for (const a in r) {
      const g = Ne(a);
      if (rn(g)) {
        const T = r[a], E = l[g] = P(T) || R(T) ? { type: T } : ne({}, T), F = E.type;
        let D = !1, Y = !0;
        if (P(F))
          for (let L = 0; L < F.length; ++L) {
            const V = F[L], k = R(V) && V.name;
            if (k === "Boolean") {
              D = !0;
              break;
            } else k === "String" && (Y = !1);
          }
        else
          D = R(F) && F.name === "Boolean";
        E[
          0
          /* shouldCast */
        ] = D, E[
          1
          /* shouldCastTrue */
        ] = Y, (D || K(E, "default")) && c.push(g);
      }
    }
  const p = [l, c];
  return q(e) && n.set(e, p), p;
}
function rn(e) {
  return e[0] !== "$" && !dt(e);
}
const $s = (e) => e === "_" || e === "__" || e === "_ctx" || e === "$stable", Ws = (e) => P(e) ? e.map(xe) : [xe(e)], Xr = (e, t, s) => {
  if (t._n)
    return t;
  const n = Sr((...i) => Ws(t(...i)), s);
  return n._c = !1, n;
}, ai = (e, t, s) => {
  const n = e._ctx;
  for (const i in e) {
    if ($s(i)) continue;
    const r = e[i];
    if (R(r))
      t[i] = Xr(i, r, n);
    else if (r != null) {
      const l = Ws(r);
      t[i] = () => l;
    }
  }
}, di = (e, t) => {
  const s = Ws(t);
  e.slots.default = () => s;
}, hi = (e, t, s) => {
  for (const n in t)
    (s || !$s(n)) && (e[n] = t[n]);
}, Qr = (e, t, s) => {
  const n = e.slots = oi();
  if (e.vnode.shapeFlag & 32) {
    const i = t.__;
    i && us(n, "__", i, !0);
    const r = t._;
    r ? (hi(n, t, s), s && us(n, "_", r, !0)) : ai(t, n);
  } else t && di(e, t);
}, Zr = (e, t, s) => {
  const { vnode: n, slots: i } = e;
  let r = !0, l = B;
  if (n.shapeFlag & 32) {
    const c = t._;
    c ? s && c === 1 ? r = !1 : hi(i, t, s) : (r = !t.$stable, ai(t, i)), l = t;
  } else t && (di(e, t), l = { default: 1 });
  if (r)
    for (const c in i)
      !$s(c) && l[c] == null && delete i[c];
}, ce = hl;
function el(e) {
  return tl(e);
}
function tl(e, t) {
  const s = Gt();
  s.__VUE__ = !0;
  const {
    insert: n,
    remove: i,
    patchProp: r,
    createElement: l,
    createText: c,
    createComment: u,
    setText: p,
    setElementText: a,
    parentNode: g,
    nextSibling: T,
    setScopeId: E = we,
    insertStaticContent: F
  } = e, D = (o, f, d, b = null, m = null, _ = null, w = void 0, y = null, x = !!f.dynamicChildren) => {
    if (o === f)
      return;
    o && !ct(o, f) && (b = Rt(o), he(o, m, _, !0), o = null), f.patchFlag === -2 && (x = !1, f.dynamicChildren = null);
    const { type: v, ref: O, shapeFlag: S } = f;
    switch (v) {
      case Xt:
        Y(o, f, d, b);
        break;
      case $e:
        L(o, f, d, b);
        break;
      case Kt:
        o == null && V(f, d, b, w);
        break;
      case Ae:
        At(
          o,
          f,
          d,
          b,
          m,
          _,
          w,
          y,
          x
        );
        break;
      default:
        S & 1 ? G(
          o,
          f,
          d,
          b,
          m,
          _,
          w,
          y,
          x
        ) : S & 6 ? It(
          o,
          f,
          d,
          b,
          m,
          _,
          w,
          y,
          x
        ) : (S & 64 || S & 128) && v.process(
          o,
          f,
          d,
          b,
          m,
          _,
          w,
          y,
          x,
          rt
        );
    }
    O != null && m ? mt(O, o && o.ref, _, f || o, !f) : O == null && o && o.ref != null && mt(o.ref, null, _, o, !0);
  }, Y = (o, f, d, b) => {
    if (o == null)
      n(
        f.el = c(f.children),
        d,
        b
      );
    else {
      const m = f.el = o.el;
      f.children !== o.children && p(m, f.children);
    }
  }, L = (o, f, d, b) => {
    o == null ? n(
      f.el = u(f.children || ""),
      d,
      b
    ) : f.el = o.el;
  }, V = (o, f, d, b) => {
    [o.el, o.anchor] = F(
      o.children,
      f,
      d,
      b,
      o.el,
      o.anchor
    );
  }, k = ({ el: o, anchor: f }, d, b) => {
    let m;
    for (; o && o !== f; )
      m = T(o), n(o, d, b), o = m;
    n(f, d, b);
  }, A = ({ el: o, anchor: f }) => {
    let d;
    for (; o && o !== f; )
      d = T(o), i(o), o = d;
    i(f);
  }, G = (o, f, d, b, m, _, w, y, x) => {
    f.type === "svg" ? w = "svg" : f.type === "math" && (w = "mathml"), o == null ? De(
      f,
      d,
      b,
      m,
      _,
      w,
      y,
      x
    ) : Ot(
      o,
      f,
      m,
      _,
      w,
      y,
      x
    );
  }, De = (o, f, d, b, m, _, w, y) => {
    let x, v;
    const { props: O, shapeFlag: S, transition: C, dirs: I } = o;
    if (x = o.el = l(
      o.type,
      _,
      O && O.is,
      O
    ), S & 8 ? a(x, o.children) : S & 16 && Fe(
      o.children,
      x,
      null,
      b,
      m,
      ls(o, _),
      w,
      y
    ), I && ke(o, null, b, "created"), de(x, o, o.scopeId, w, b), O) {
      for (const $ in O)
        $ !== "value" && !dt($) && r(x, $, null, O[$], _, b);
      "value" in O && r(x, "value", null, O.value, _), (v = O.onVnodeBeforeMount) && _e(v, b, o);
    }
    I && ke(o, null, b, "beforeMount");
    const M = sl(m, C);
    M && C.beforeEnter(x), n(x, f, d), ((v = O && O.onVnodeMounted) || M || I) && ce(() => {
      v && _e(v, b, o), M && C.enter(x), I && ke(o, null, b, "mounted");
    }, m);
  }, de = (o, f, d, b, m) => {
    if (d && E(o, d), b)
      for (let _ = 0; _ < b.length; _++)
        E(o, b[_]);
    if (m) {
      let _ = m.subTree;
      if (f === _ || vi(_.type) && (_.ssContent === f || _.ssFallback === f)) {
        const w = m.vnode;
        de(
          o,
          w,
          w.scopeId,
          w.slotScopeIds,
          m.parent
        );
      }
    }
  }, Fe = (o, f, d, b, m, _, w, y, x = 0) => {
    for (let v = x; v < o.length; v++) {
      const O = o[v] = y ? Ke(o[v]) : xe(o[v]);
      D(
        null,
        O,
        f,
        d,
        b,
        m,
        _,
        w,
        y
      );
    }
  }, Ot = (o, f, d, b, m, _, w) => {
    const y = f.el = o.el;
    let { patchFlag: x, dynamicChildren: v, dirs: O } = f;
    x |= o.patchFlag & 16;
    const S = o.props || B, C = f.props || B;
    let I;
    if (d && qe(d, !1), (I = C.onVnodeBeforeUpdate) && _e(I, d, f, o), O && ke(f, o, d, "beforeUpdate"), d && qe(d, !0), (S.innerHTML && C.innerHTML == null || S.textContent && C.textContent == null) && a(y, ""), v ? Be(
      o.dynamicChildren,
      v,
      y,
      d,
      b,
      ls(f, m),
      _
    ) : w || N(
      o,
      f,
      y,
      null,
      d,
      b,
      ls(f, m),
      _,
      !1
    ), x > 0) {
      if (x & 16)
        nt(y, S, C, d, m);
      else if (x & 2 && S.class !== C.class && r(y, "class", null, C.class, m), x & 4 && r(y, "style", S.style, C.style, m), x & 8) {
        const M = f.dynamicProps;
        for (let $ = 0; $ < M.length; $++) {
          const j = M[$], ie = S[j], re = C[j];
          (re !== ie || j === "value") && r(y, j, ie, re, m, d);
        }
      }
      x & 1 && o.children !== f.children && a(y, f.children);
    } else !w && v == null && nt(y, S, C, d, m);
    ((I = C.onVnodeUpdated) || O) && ce(() => {
      I && _e(I, d, f, o), O && ke(f, o, d, "updated");
    }, b);
  }, Be = (o, f, d, b, m, _, w) => {
    for (let y = 0; y < f.length; y++) {
      const x = o[y], v = f[y], O = (
        // oldVNode may be an errored async setup() component inside Suspense
        // which will not have a mounted element
        x.el && // - In the case of a Fragment, we need to provide the actual parent
        // of the Fragment itself so it can move its children.
        (x.type === Ae || // - In the case of different nodes, there is going to be a replacement
        // which also requires the correct parent container
        !ct(x, v) || // - In the case of a component, it could contain anything.
        x.shapeFlag & 198) ? g(x.el) : (
          // In other cases, the parent container is not actually used so we
          // just pass the block element here to avoid a DOM parentNode call.
          d
        )
      );
      D(
        x,
        v,
        O,
        null,
        b,
        m,
        _,
        w,
        !0
      );
    }
  }, nt = (o, f, d, b, m) => {
    if (f !== d) {
      if (f !== B)
        for (const _ in f)
          !dt(_) && !(_ in d) && r(
            o,
            _,
            f[_],
            null,
            m,
            b
          );
      for (const _ in d) {
        if (dt(_)) continue;
        const w = d[_], y = f[_];
        w !== y && _ !== "value" && r(o, _, y, w, m, b);
      }
      "value" in d && r(o, "value", f.value, d.value, m);
    }
  }, At = (o, f, d, b, m, _, w, y, x) => {
    const v = f.el = o ? o.el : c(""), O = f.anchor = o ? o.anchor : c("");
    let { patchFlag: S, dynamicChildren: C, slotScopeIds: I } = f;
    I && (y = y ? y.concat(I) : I), o == null ? (n(v, d, b), n(O, d, b), Fe(
      // #10007
      // such fragment like `<></>` will be compiled into
      // a fragment which doesn't have a children.
      // In this case fallback to an empty array
      f.children || [],
      d,
      O,
      m,
      _,
      w,
      y,
      x
    )) : S > 0 && S & 64 && C && // #2715 the previous fragment could've been a BAILed one as a result
    // of renderSlot() with no valid children
    o.dynamicChildren ? (Be(
      o.dynamicChildren,
      C,
      d,
      m,
      _,
      w,
      y
    ), // #2080 if the stable fragment has a key, it's a <template v-for> that may
    //  get moved around. Make sure all root level vnodes inherit el.
    // #2134 or if it's a component root, it may also get moved around
    // as the component is being moved.
    (f.key != null || m && f === m.subTree) && pi(
      o,
      f,
      !0
      /* shallow */
    )) : N(
      o,
      f,
      d,
      O,
      m,
      _,
      w,
      y,
      x
    );
  }, It = (o, f, d, b, m, _, w, y, x) => {
    f.slotScopeIds = y, o == null ? f.shapeFlag & 512 ? m.ctx.activate(
      f,
      d,
      b,
      w,
      x
    ) : Qt(
      f,
      d,
      b,
      m,
      _,
      w,
      x
    ) : Vs(o, f, x);
  }, Qt = (o, f, d, b, m, _, w) => {
    const y = o.component = wl(
      o,
      b,
      m
    );
    if (ei(o) && (y.ctx.renderer = rt), Tl(y, !1, w), y.asyncDep) {
      if (m && m.registerDep(y, Q, w), !o.el) {
        const x = y.subTree = Se($e);
        L(null, x, f, d), o.placeholder = x.el;
      }
    } else
      Q(
        y,
        o,
        f,
        d,
        m,
        _,
        w
      );
  }, Vs = (o, f, d) => {
    const b = f.component = o.component;
    if (al(o, f, d))
      if (b.asyncDep && !b.asyncResolved) {
        U(b, f, d);
        return;
      } else
        b.next = f, b.update();
    else
      f.el = o.el, b.vnode = f;
  }, Q = (o, f, d, b, m, _, w) => {
    const y = () => {
      if (o.isMounted) {
        let { next: S, bu: C, u: I, parent: M, vnode: $ } = o;
        {
          const ge = gi(o);
          if (ge) {
            S && (S.el = $.el, U(o, S, w)), ge.asyncDep.then(() => {
              o.isUnmounted || y();
            });
            return;
          }
        }
        let j = S, ie;
        qe(o, !1), S ? (S.el = $.el, U(o, S, w)) : S = $, C && ts(C), (ie = S.props && S.props.onVnodeBeforeUpdate) && _e(ie, M, S, $), qe(o, !0);
        const re = on(o), pe = o.subTree;
        o.subTree = re, D(
          pe,
          re,
          // parent may have changed if it's in a teleport
          g(pe.el),
          // anchor may have changed if it's in a fragment
          Rt(pe),
          o,
          m,
          _
        ), S.el = re.el, j === null && dl(o, re.el), I && ce(I, m), (ie = S.props && S.props.onVnodeUpdated) && ce(
          () => _e(ie, M, S, $),
          m
        );
      } else {
        let S;
        const { el: C, props: I } = f, { bm: M, m: $, parent: j, root: ie, type: re } = o, pe = _t(f);
        qe(o, !1), M && ts(M), !pe && (S = I && I.onVnodeBeforeMount) && _e(S, j, f), qe(o, !0);
        {
          ie.ce && // @ts-expect-error _def is private
          ie.ce._def.shadowRoot !== !1 && ie.ce._injectChildStyle(re);
          const ge = o.subTree = on(o);
          D(
            null,
            ge,
            d,
            b,
            o,
            m,
            _
          ), f.el = ge.el;
        }
        if ($ && ce($, m), !pe && (S = I && I.onVnodeMounted)) {
          const ge = f;
          ce(
            () => _e(S, j, ge),
            m
          );
        }
        (f.shapeFlag & 256 || j && _t(j.vnode) && j.vnode.shapeFlag & 256) && o.a && ce(o.a, m), o.isMounted = !0, f = d = b = null;
      }
    };
    o.scope.on();
    const x = o.effect = new Mn(y);
    o.scope.off();
    const v = o.update = x.run.bind(x), O = o.job = x.runIfDirty.bind(x);
    O.i = o, O.id = o.uid, x.scheduler = () => Ls(O), qe(o, !0), v();
  }, U = (o, f, d) => {
    f.component = o;
    const b = o.vnode.props;
    o.vnode = f, o.next = null, Yr(o, f.props, b, d), Zr(o, f.children, d), Pe(), Zs(o), Re();
  }, N = (o, f, d, b, m, _, w, y, x = !1) => {
    const v = o && o.children, O = o ? o.shapeFlag : 0, S = f.children, { patchFlag: C, shapeFlag: I } = f;
    if (C > 0) {
      if (C & 128) {
        Pt(
          v,
          S,
          d,
          b,
          m,
          _,
          w,
          y,
          x
        );
        return;
      } else if (C & 256) {
        Ue(
          v,
          S,
          d,
          b,
          m,
          _,
          w,
          y,
          x
        );
        return;
      }
    }
    I & 8 ? (O & 16 && it(v, m, _), S !== v && a(d, S)) : O & 16 ? I & 16 ? Pt(
      v,
      S,
      d,
      b,
      m,
      _,
      w,
      y,
      x
    ) : it(v, m, _, !0) : (O & 8 && a(d, ""), I & 16 && Fe(
      S,
      d,
      b,
      m,
      _,
      w,
      y,
      x
    ));
  }, Ue = (o, f, d, b, m, _, w, y, x) => {
    o = o || Qe, f = f || Qe;
    const v = o.length, O = f.length, S = Math.min(v, O);
    let C;
    for (C = 0; C < S; C++) {
      const I = f[C] = x ? Ke(f[C]) : xe(f[C]);
      D(
        o[C],
        I,
        d,
        null,
        m,
        _,
        w,
        y,
        x
      );
    }
    v > O ? it(
      o,
      m,
      _,
      !0,
      !1,
      S
    ) : Fe(
      f,
      d,
      b,
      m,
      _,
      w,
      y,
      x,
      S
    );
  }, Pt = (o, f, d, b, m, _, w, y, x) => {
    let v = 0;
    const O = f.length;
    let S = o.length - 1, C = O - 1;
    for (; v <= S && v <= C; ) {
      const I = o[v], M = f[v] = x ? Ke(f[v]) : xe(f[v]);
      if (ct(I, M))
        D(
          I,
          M,
          d,
          null,
          m,
          _,
          w,
          y,
          x
        );
      else
        break;
      v++;
    }
    for (; v <= S && v <= C; ) {
      const I = o[S], M = f[C] = x ? Ke(f[C]) : xe(f[C]);
      if (ct(I, M))
        D(
          I,
          M,
          d,
          null,
          m,
          _,
          w,
          y,
          x
        );
      else
        break;
      S--, C--;
    }
    if (v > S) {
      if (v <= C) {
        const I = C + 1, M = I < O ? f[I].el : b;
        for (; v <= C; )
          D(
            null,
            f[v] = x ? Ke(f[v]) : xe(f[v]),
            d,
            M,
            m,
            _,
            w,
            y,
            x
          ), v++;
      }
    } else if (v > C)
      for (; v <= S; )
        he(o[v], m, _, !0), v++;
    else {
      const I = v, M = v, $ = /* @__PURE__ */ new Map();
      for (v = M; v <= C; v++) {
        const oe = f[v] = x ? Ke(f[v]) : xe(f[v]);
        oe.key != null && $.set(oe.key, v);
      }
      let j, ie = 0;
      const re = C - M + 1;
      let pe = !1, ge = 0;
      const lt = new Array(re);
      for (v = 0; v < re; v++) lt[v] = 0;
      for (v = I; v <= S; v++) {
        const oe = o[v];
        if (ie >= re) {
          he(oe, m, _, !0);
          continue;
        }
        let me;
        if (oe.key != null)
          me = $.get(oe.key);
        else
          for (j = M; j <= C; j++)
            if (lt[j - M] === 0 && ct(oe, f[j])) {
              me = j;
              break;
            }
        me === void 0 ? he(oe, m, _, !0) : (lt[me - M] = v + 1, me >= ge ? ge = me : pe = !0, D(
          oe,
          f[me],
          d,
          null,
          m,
          _,
          w,
          y,
          x
        ), ie++);
      }
      const Gs = pe ? nl(lt) : Qe;
      for (j = Gs.length - 1, v = re - 1; v >= 0; v--) {
        const oe = M + v, me = f[oe], Js = f[oe + 1], Ys = oe + 1 < O ? (
          // #13559, fallback to el placeholder for unresolved async component
          Js.el || Js.placeholder
        ) : b;
        lt[v] === 0 ? D(
          null,
          me,
          d,
          Ys,
          m,
          _,
          w,
          y,
          x
        ) : pe && (j < 0 || v !== Gs[j] ? Ve(me, d, Ys, 2) : j--);
      }
    }
  }, Ve = (o, f, d, b, m = null) => {
    const { el: _, type: w, transition: y, children: x, shapeFlag: v } = o;
    if (v & 6) {
      Ve(o.component.subTree, f, d, b);
      return;
    }
    if (v & 128) {
      o.suspense.move(f, d, b);
      return;
    }
    if (v & 64) {
      w.move(o, f, d, rt);
      return;
    }
    if (w === Ae) {
      n(_, f, d);
      for (let S = 0; S < x.length; S++)
        Ve(x[S], f, d, b);
      n(o.anchor, f, d);
      return;
    }
    if (w === Kt) {
      k(o, f, d);
      return;
    }
    if (b !== 2 && v & 1 && y)
      if (b === 0)
        y.beforeEnter(_), n(_, f, d), ce(() => y.enter(_), m);
      else {
        const { leave: S, delayLeave: C, afterLeave: I } = y, M = () => {
          o.ctx.isUnmounted ? i(_) : n(_, f, d);
        }, $ = () => {
          S(_, () => {
            M(), I && I();
          });
        };
        C ? C(_, M, $) : $();
      }
    else
      n(_, f, d);
  }, he = (o, f, d, b = !1, m = !1) => {
    const {
      type: _,
      props: w,
      ref: y,
      children: x,
      dynamicChildren: v,
      shapeFlag: O,
      patchFlag: S,
      dirs: C,
      cacheIndex: I
    } = o;
    if (S === -2 && (m = !1), y != null && (Pe(), mt(y, null, d, o, !0), Re()), I != null && (f.renderCache[I] = void 0), O & 256) {
      f.ctx.deactivate(o);
      return;
    }
    const M = O & 1 && C, $ = !_t(o);
    let j;
    if ($ && (j = w && w.onVnodeBeforeUnmount) && _e(j, f, o), O & 6)
      Oi(o.component, d, b);
    else {
      if (O & 128) {
        o.suspense.unmount(d, b);
        return;
      }
      M && ke(o, null, f, "beforeUnmount"), O & 64 ? o.type.remove(
        o,
        f,
        d,
        rt,
        b
      ) : v && // #5154
      // when v-once is used inside a block, setBlockTracking(-1) marks the
      // parent block with hasOnce: true
      // so that it doesn't take the fast path during unmount - otherwise
      // components nested in v-once are never unmounted.
      !v.hasOnce && // #1153: fast path should not be taken for non-stable (v-for) fragments
      (_ !== Ae || S > 0 && S & 64) ? it(
        v,
        f,
        d,
        !1,
        !0
      ) : (_ === Ae && S & 384 || !m && O & 16) && it(x, f, d), b && ks(o);
    }
    ($ && (j = w && w.onVnodeUnmounted) || M) && ce(() => {
      j && _e(j, f, o), M && ke(o, null, f, "unmounted");
    }, d);
  }, ks = (o) => {
    const { type: f, el: d, anchor: b, transition: m } = o;
    if (f === Ae) {
      Ci(d, b);
      return;
    }
    if (f === Kt) {
      A(o);
      return;
    }
    const _ = () => {
      i(d), m && !m.persisted && m.afterLeave && m.afterLeave();
    };
    if (o.shapeFlag & 1 && m && !m.persisted) {
      const { leave: w, delayLeave: y } = m, x = () => w(d, _);
      y ? y(o.el, _, x) : x();
    } else
      _();
  }, Ci = (o, f) => {
    let d;
    for (; o !== f; )
      d = T(o), i(o), o = d;
    i(f);
  }, Oi = (o, f, d) => {
    const {
      bum: b,
      scope: m,
      job: _,
      subTree: w,
      um: y,
      m: x,
      a: v,
      parent: O,
      slots: { __: S }
    } = o;
    ln(x), ln(v), b && ts(b), O && P(S) && S.forEach((C) => {
      O.renderCache[C] = void 0;
    }), m.stop(), _ && (_.flags |= 8, he(w, o, f, d)), y && ce(y, f), ce(() => {
      o.isUnmounted = !0;
    }, f), f && f.pendingBranch && !f.isUnmounted && o.asyncDep && !o.asyncResolved && o.suspenseId === f.pendingId && (f.deps--, f.deps === 0 && f.resolve());
  }, it = (o, f, d, b = !1, m = !1, _ = 0) => {
    for (let w = _; w < o.length; w++)
      he(o[w], f, d, b, m);
  }, Rt = (o) => {
    if (o.shapeFlag & 6)
      return Rt(o.component.subTree);
    if (o.shapeFlag & 128)
      return o.suspense.next();
    const f = T(o.anchor || o.el), d = f && f[Tr];
    return d ? T(d) : f;
  };
  let Zt = !1;
  const qs = (o, f, d) => {
    o == null ? f._vnode && he(f._vnode, null, null, !0) : D(
      f._vnode || null,
      o,
      f,
      null,
      null,
      null,
      d
    ), f._vnode = o, Zt || (Zt = !0, Zs(), zn(), Zt = !1);
  }, rt = {
    p: D,
    um: he,
    m: Ve,
    r: ks,
    mt: Qt,
    mc: Fe,
    pc: N,
    pbc: Be,
    n: Rt,
    o: e
  };
  return {
    render: qs,
    hydrate: void 0,
    createApp: qr(qs)
  };
}
function ls({ type: e, props: t }, s) {
  return s === "svg" && e === "foreignObject" || s === "mathml" && e === "annotation-xml" && t && t.encoding && t.encoding.includes("html") ? void 0 : s;
}
function qe({ effect: e, job: t }, s) {
  s ? (e.flags |= 32, t.flags |= 4) : (e.flags &= -33, t.flags &= -5);
}
function sl(e, t) {
  return (!e || e && !e.pendingBranch) && t && !t.persisted;
}
function pi(e, t, s = !1) {
  const n = e.children, i = t.children;
  if (P(n) && P(i))
    for (let r = 0; r < n.length; r++) {
      const l = n[r];
      let c = i[r];
      c.shapeFlag & 1 && !c.dynamicChildren && ((c.patchFlag <= 0 || c.patchFlag === 32) && (c = i[r] = Ke(i[r]), c.el = l.el), !s && c.patchFlag !== -2 && pi(l, c)), c.type === Xt && (c.el = l.el), c.type === $e && !c.el && (c.el = l.el);
    }
}
function nl(e) {
  const t = e.slice(), s = [0];
  let n, i, r, l, c;
  const u = e.length;
  for (n = 0; n < u; n++) {
    const p = e[n];
    if (p !== 0) {
      if (i = s[s.length - 1], e[i] < p) {
        t[n] = i, s.push(n);
        continue;
      }
      for (r = 0, l = s.length - 1; r < l; )
        c = r + l >> 1, e[s[c]] < p ? r = c + 1 : l = c;
      p < e[s[r]] && (r > 0 && (t[n] = s[r - 1]), s[r] = n);
    }
  }
  for (r = s.length, l = s[r - 1]; r-- > 0; )
    s[r] = l, l = t[l];
  return s;
}
function gi(e) {
  const t = e.subTree.component;
  if (t)
    return t.asyncDep && !t.asyncResolved ? t : gi(t);
}
function ln(e) {
  if (e)
    for (let t = 0; t < e.length; t++)
      e[t].flags |= 8;
}
const il = Symbol.for("v-scx"), rl = () => Ht(il);
function os(e, t, s) {
  return mi(e, t, s);
}
function mi(e, t, s = B) {
  const { immediate: n, deep: i, flush: r, once: l } = s, c = ne({}, s), u = t && n || !t && r !== "post";
  let p;
  if (Tt) {
    if (r === "sync") {
      const E = rl();
      p = E.__watcherHandles || (E.__watcherHandles = []);
    } else if (!u) {
      const E = () => {
      };
      return E.stop = we, E.resume = we, E.pause = we, E;
    }
  }
  const a = se;
  c.call = (E, F, D) => Te(E, a, F, D);
  let g = !1;
  r === "post" ? c.scheduler = (E) => {
    ce(E, a && a.suspense);
  } : r !== "sync" && (g = !0, c.scheduler = (E, F) => {
    F ? E() : Ls(E);
  }), c.augmentJob = (E) => {
    t && (E.flags |= 4), g && (E.flags |= 2, a && (E.id = a.uid, E.i = a));
  };
  const T = br(e, t, c);
  return Tt && (p ? p.push(T) : u && T()), T;
}
function ll(e, t, s) {
  const n = this.proxy, i = J(e) ? e.includes(".") ? _i(n, e) : () => n[e] : e.bind(n, n);
  let r;
  R(t) ? r = t : (r = t.handler, s = t);
  const l = Ct(this), c = mi(i, r.bind(n), s);
  return l(), c;
}
function _i(e, t) {
  const s = t.split(".");
  return () => {
    let n = e;
    for (let i = 0; i < s.length && n; i++)
      n = n[s[i]];
    return n;
  };
}
const ol = (e, t) => t === "modelValue" || t === "model-value" ? e.modelModifiers : e[`${t}Modifiers`] || e[`${Ne(t)}Modifiers`] || e[`${We(t)}Modifiers`];
function cl(e, t, ...s) {
  if (e.isUnmounted) return;
  const n = e.vnode.props || B;
  let i = s;
  const r = t.startsWith("update:"), l = r && ol(n, t.slice(7));
  l && (l.trim && (i = s.map((a) => J(a) ? a.trim() : a)), l.number && (i = s.map(Ki)));
  let c, u = n[c = es(t)] || // also try camelCase event handler (#2249)
  n[c = es(Ne(t))];
  !u && r && (u = n[c = es(We(t))]), u && Te(
    u,
    e,
    6,
    i
  );
  const p = n[c + "Once"];
  if (p) {
    if (!e.emitted)
      e.emitted = {};
    else if (e.emitted[c])
      return;
    e.emitted[c] = !0, Te(
      p,
      e,
      6,
      i
    );
  }
}
function bi(e, t, s = !1) {
  const n = t.emitsCache, i = n.get(e);
  if (i !== void 0)
    return i;
  const r = e.emits;
  let l = {}, c = !1;
  if (!R(e)) {
    const u = (p) => {
      const a = bi(p, t, !0);
      a && (c = !0, ne(l, a));
    };
    !s && t.mixins.length && t.mixins.forEach(u), e.extends && u(e.extends), e.mixins && e.mixins.forEach(u);
  }
  return !r && !c ? (q(e) && n.set(e, null), null) : (P(r) ? r.forEach((u) => l[u] = null) : ne(l, r), q(e) && n.set(e, l), l);
}
function zt(e, t) {
  return !e || !Vt(t) ? !1 : (t = t.slice(2).replace(/Once$/, ""), K(e, t[0].toLowerCase() + t.slice(1)) || K(e, We(t)) || K(e, t));
}
function on(e) {
  const {
    type: t,
    vnode: s,
    proxy: n,
    withProxy: i,
    propsOptions: [r],
    slots: l,
    attrs: c,
    emit: u,
    render: p,
    renderCache: a,
    props: g,
    data: T,
    setupState: E,
    ctx: F,
    inheritAttrs: D
  } = e, Y = Wt(e);
  let L, V;
  try {
    if (s.shapeFlag & 4) {
      const A = i || n, G = A;
      L = xe(
        p.call(
          G,
          A,
          a,
          g,
          E,
          T,
          F
        )
      ), V = c;
    } else {
      const A = t;
      L = xe(
        A.length > 1 ? A(
          g,
          { attrs: c, slots: l, emit: u }
        ) : A(
          g,
          null
        )
      ), V = t.props ? c : fl(c);
    }
  } catch (A) {
    vt.length = 0, Jt(A, e, 1), L = Se($e);
  }
  let k = L;
  if (V && D !== !1) {
    const A = Object.keys(V), { shapeFlag: G } = k;
    A.length && G & 7 && (r && A.some(Ts) && (V = ul(
      V,
      r
    )), k = tt(k, V, !1, !0));
  }
  return s.dirs && (k = tt(k, null, !1, !0), k.dirs = k.dirs ? k.dirs.concat(s.dirs) : s.dirs), s.transition && Ns(k, s.transition), L = k, Wt(Y), L;
}
const fl = (e) => {
  let t;
  for (const s in e)
    (s === "class" || s === "style" || Vt(s)) && ((t || (t = {}))[s] = e[s]);
  return t;
}, ul = (e, t) => {
  const s = {};
  for (const n in e)
    (!Ts(n) || !(n.slice(9) in t)) && (s[n] = e[n]);
  return s;
};
function al(e, t, s) {
  const { props: n, children: i, component: r } = e, { props: l, children: c, patchFlag: u } = t, p = r.emitsOptions;
  if (t.dirs || t.transition)
    return !0;
  if (s && u >= 0) {
    if (u & 1024)
      return !0;
    if (u & 16)
      return n ? cn(n, l, p) : !!l;
    if (u & 8) {
      const a = t.dynamicProps;
      for (let g = 0; g < a.length; g++) {
        const T = a[g];
        if (l[T] !== n[T] && !zt(p, T))
          return !0;
      }
    }
  } else
    return (i || c) && (!c || !c.$stable) ? !0 : n === l ? !1 : n ? l ? cn(n, l, p) : !0 : !!l;
  return !1;
}
function cn(e, t, s) {
  const n = Object.keys(t);
  if (n.length !== Object.keys(e).length)
    return !0;
  for (let i = 0; i < n.length; i++) {
    const r = n[i];
    if (t[r] !== e[r] && !zt(s, r))
      return !0;
  }
  return !1;
}
function dl({ vnode: e, parent: t }, s) {
  for (; t; ) {
    const n = t.subTree;
    if (n.suspense && n.suspense.activeBranch === e && (n.el = e.el), n === e)
      (e = t.vnode).el = s, t = t.parent;
    else
      break;
  }
}
const vi = (e) => e.__isSuspense;
function hl(e, t) {
  t && t.pendingBranch ? P(e) ? t.effects.push(...e) : t.effects.push(e) : wr(e);
}
const Ae = Symbol.for("v-fgt"), Xt = Symbol.for("v-txt"), $e = Symbol.for("v-cmt"), Kt = Symbol.for("v-stc"), vt = [];
let fe = null;
function xs(e = !1) {
  vt.push(fe = e ? null : []);
}
function pl() {
  vt.pop(), fe = vt[vt.length - 1] || null;
}
let St = 1;
function fn(e, t = !1) {
  St += e, e < 0 && fe && t && (fe.hasOnce = !0);
}
function xi(e) {
  return e.dynamicChildren = St > 0 ? fe || Qe : null, pl(), St > 0 && fe && fe.push(e), e;
}
function un(e, t, s, n, i, r) {
  return xi(
    h(
      e,
      t,
      s,
      n,
      i,
      r,
      !0
    )
  );
}
function gl(e, t, s, n, i) {
  return xi(
    Se(
      e,
      t,
      s,
      n,
      i,
      !0
    )
  );
}
function yi(e) {
  return e ? e.__v_isVNode === !0 : !1;
}
function ct(e, t) {
  return e.type === t.type && e.key === t.key;
}
const wi = ({ key: e }) => e ?? null, jt = ({
  ref: e,
  ref_key: t,
  ref_for: s
}) => (typeof e == "number" && (e = "" + e), e != null ? J(e) || X(e) || R(e) ? { i: ye, r: e, k: t, f: !!s } : e : null);
function h(e, t = null, s = null, n = 0, i = null, r = e === Ae ? 0 : 1, l = !1, c = !1) {
  const u = {
    __v_isVNode: !0,
    __v_skip: !0,
    type: e,
    props: t,
    key: t && wi(t),
    ref: t && jt(t),
    scopeId: Qn,
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
    shapeFlag: r,
    patchFlag: n,
    dynamicProps: i,
    dynamicChildren: null,
    appContext: null,
    ctx: ye
  };
  return c ? (Bs(u, s), r & 128 && e.normalize(u)) : s && (u.shapeFlag |= J(s) ? 8 : 16), St > 0 && // avoid a block node from tracking itself
  !l && // has current parent block
  fe && // presence of a patch flag indicates this node needs patching on updates.
  // component nodes also should always be patched, because even if the
  // component doesn't need to update, it needs to persist the instance on to
  // the next vnode so that it can be properly unmounted later.
  (u.patchFlag > 0 || r & 6) && // the EVENTS flag is only for hydration and if it is the only flag, the
  // vnode should not be considered dynamic due to handler caching.
  u.patchFlag !== 32 && fe.push(u), u;
}
const Se = ml;
function ml(e, t = null, s = null, n = 0, i = null, r = !1) {
  if ((!e || e === Lr) && (e = $e), yi(e)) {
    const c = tt(
      e,
      t,
      !0
      /* mergeRef: true */
    );
    return s && Bs(c, s), St > 0 && !r && fe && (c.shapeFlag & 6 ? fe[fe.indexOf(e)] = c : fe.push(c)), c.patchFlag = -2, c;
  }
  if (Al(e) && (e = e.__vccOpts), t) {
    t = _l(t);
    let { class: c, style: u } = t;
    c && !J(c) && (t.class = As(c)), q(u) && (js(u) && !P(u) && (u = ne({}, u)), t.style = Os(u));
  }
  const l = J(e) ? 1 : vi(e) ? 128 : Er(e) ? 64 : q(e) ? 4 : R(e) ? 2 : 0;
  return h(
    e,
    t,
    s,
    n,
    i,
    l,
    r,
    !0
  );
}
function _l(e) {
  return e ? js(e) || ci(e) ? ne({}, e) : e : null;
}
function tt(e, t, s = !1, n = !1) {
  const { props: i, ref: r, patchFlag: l, children: c, transition: u } = e, p = t ? vl(i || {}, t) : i, a = {
    __v_isVNode: !0,
    __v_skip: !0,
    type: e.type,
    props: p,
    key: p && wi(p),
    ref: t && t.ref ? (
      // #2078 in the case of <component :is="vnode" ref="extra"/>
      // if the vnode itself already has a ref, cloneVNode will need to merge
      // the refs so the single vnode can be set on multiple refs
      s && r ? P(r) ? r.concat(jt(t)) : [r, jt(t)] : jt(t)
    ) : r,
    scopeId: e.scopeId,
    slotScopeIds: e.slotScopeIds,
    children: c,
    target: e.target,
    targetStart: e.targetStart,
    targetAnchor: e.targetAnchor,
    staticCount: e.staticCount,
    shapeFlag: e.shapeFlag,
    // if the vnode is cloned with extra props, we can no longer assume its
    // existing patch flag to be reliable and need to add the FULL_PROPS flag.
    // note: preserve flag for fragments since they use the flag for children
    // fast paths only.
    patchFlag: t && e.type !== Ae ? l === -1 ? 16 : l | 16 : l,
    dynamicProps: e.dynamicProps,
    dynamicChildren: e.dynamicChildren,
    appContext: e.appContext,
    dirs: e.dirs,
    transition: u,
    // These should technically only be non-null on mounted VNodes. However,
    // they *should* be copied for kept-alive vnodes. So we just always copy
    // them since them being non-null during a mount doesn't affect the logic as
    // they will simply be overwritten.
    component: e.component,
    suspense: e.suspense,
    ssContent: e.ssContent && tt(e.ssContent),
    ssFallback: e.ssFallback && tt(e.ssFallback),
    placeholder: e.placeholder,
    el: e.el,
    anchor: e.anchor,
    ctx: e.ctx,
    ce: e.ce
  };
  return u && n && Ns(
    a,
    u.clone(a)
  ), a;
}
function be(e = " ", t = 0) {
  return Se(Xt, null, e, t);
}
function ft(e, t) {
  const s = Se(Kt, null, e);
  return s.staticCount = t, s;
}
function bl(e = "", t = !1) {
  return t ? (xs(), gl($e, null, e)) : Se($e, null, e);
}
function xe(e) {
  return e == null || typeof e == "boolean" ? Se($e) : P(e) ? Se(
    Ae,
    null,
    // #3666, avoid reference pollution when reusing vnode
    e.slice()
  ) : yi(e) ? Ke(e) : Se(Xt, null, String(e));
}
function Ke(e) {
  return e.el === null && e.patchFlag !== -1 || e.memo ? e : tt(e);
}
function Bs(e, t) {
  let s = 0;
  const { shapeFlag: n } = e;
  if (t == null)
    t = null;
  else if (P(t))
    s = 16;
  else if (typeof t == "object")
    if (n & 65) {
      const i = t.default;
      i && (i._c && (i._d = !1), Bs(e, i()), i._c && (i._d = !0));
      return;
    } else {
      s = 32;
      const i = t._;
      !i && !ci(t) ? t._ctx = ye : i === 3 && ye && (ye.slots._ === 1 ? t._ = 1 : (t._ = 2, e.patchFlag |= 1024));
    }
  else R(t) ? (t = { default: t, _ctx: ye }, s = 32) : (t = String(t), n & 64 ? (s = 16, t = [be(t)]) : s = 8);
  e.children = t, e.shapeFlag |= s;
}
function vl(...e) {
  const t = {};
  for (let s = 0; s < e.length; s++) {
    const n = e[s];
    for (const i in n)
      if (i === "class")
        t.class !== n.class && (t.class = As([t.class, n.class]));
      else if (i === "style")
        t.style = Os([t.style, n.style]);
      else if (Vt(i)) {
        const r = t[i], l = n[i];
        l && r !== l && !(P(r) && r.includes(l)) && (t[i] = r ? [].concat(r, l) : l);
      } else i !== "" && (t[i] = n[i]);
  }
  return t;
}
function _e(e, t, s, n = null) {
  Te(e, t, 7, [
    s,
    n
  ]);
}
const xl = ri();
let yl = 0;
function wl(e, t, s) {
  const n = e.type, i = (t ? t.appContext : e.appContext) || xl, r = {
    uid: yl++,
    vnode: e,
    type: n,
    parent: t,
    appContext: i,
    root: null,
    // to be immediately set
    next: null,
    subTree: null,
    // will be set synchronously right after creation
    effect: null,
    update: null,
    // will be set synchronously right after creation
    job: null,
    scope: new Ui(
      !0
      /* detached */
    ),
    render: null,
    proxy: null,
    exposed: null,
    exposeProxy: null,
    withProxy: null,
    provides: t ? t.provides : Object.create(i.provides),
    ids: t ? t.ids : ["", 0, 0],
    accessCache: null,
    renderCache: [],
    // local resolved assets
    components: null,
    directives: null,
    // resolved props and emits options
    propsOptions: ui(n, i),
    emitsOptions: bi(n, i),
    // emit
    emit: null,
    // to be set immediately
    emitted: null,
    // props default value
    propsDefaults: B,
    // inheritAttrs
    inheritAttrs: n.inheritAttrs,
    // state
    ctx: B,
    data: B,
    props: B,
    attrs: B,
    slots: B,
    refs: B,
    setupState: B,
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
  return r.ctx = { _: r }, r.root = t ? t.root : r, r.emit = cl.bind(null, r), e.ce && e.ce(r), r;
}
let se = null;
const Sl = () => se || ye;
let Ut, ys;
{
  const e = Gt(), t = (s, n) => {
    let i;
    return (i = e[s]) || (i = e[s] = []), i.push(n), (r) => {
      i.length > 1 ? i.forEach((l) => l(r)) : i[0](r);
    };
  };
  Ut = t(
    "__VUE_INSTANCE_SETTERS__",
    (s) => se = s
  ), ys = t(
    "__VUE_SSR_SETTERS__",
    (s) => Tt = s
  );
}
const Ct = (e) => {
  const t = se;
  return Ut(e), e.scope.on(), () => {
    e.scope.off(), Ut(t);
  };
}, an = () => {
  se && se.scope.off(), Ut(null);
};
function Si(e) {
  return e.vnode.shapeFlag & 4;
}
let Tt = !1;
function Tl(e, t = !1, s = !1) {
  t && ys(t);
  const { props: n, children: i } = e.vnode, r = Si(e);
  Jr(e, n, r, t), Qr(e, i, s || t);
  const l = r ? El(e, t) : void 0;
  return t && ys(!1), l;
}
function El(e, t) {
  const s = e.type;
  e.accessCache = /* @__PURE__ */ Object.create(null), e.proxy = new Proxy(e.ctx, Nr);
  const { setup: n } = s;
  if (n) {
    Pe();
    const i = e.setupContext = n.length > 1 ? Ol(e) : null, r = Ct(e), l = Et(
      n,
      e,
      0,
      [
        e.props,
        i
      ]
    ), c = In(l);
    if (Re(), r(), (c || e.sp) && !_t(e) && Zn(e), c) {
      if (l.then(an, an), t)
        return l.then((u) => {
          dn(e, u);
        }).catch((u) => {
          Jt(u, e, 0);
        });
      e.asyncDep = l;
    } else
      dn(e, l);
  } else
    Ti(e);
}
function dn(e, t, s) {
  R(t) ? e.type.__ssrInlineRender ? e.ssrRender = t : e.render = t : q(t) && (e.setupState = Gn(t)), Ti(e);
}
function Ti(e, t, s) {
  const n = e.type;
  e.render || (e.render = n.render || we);
  {
    const i = Ct(e);
    Pe();
    try {
      $r(e);
    } finally {
      Re(), i();
    }
  }
}
const Cl = {
  get(e, t) {
    return z(e, "get", ""), e[t];
  }
};
function Ol(e) {
  const t = (s) => {
    e.exposed = s || {};
  };
  return {
    attrs: new Proxy(e.attrs, Cl),
    slots: e.slots,
    emit: e.emit,
    expose: t
  };
}
function Us(e) {
  return e.exposed ? e.exposeProxy || (e.exposeProxy = new Proxy(Gn(ur(e.exposed)), {
    get(t, s) {
      if (s in t)
        return t[s];
      if (s in bt)
        return bt[s](e);
    },
    has(t, s) {
      return s in t || s in bt;
    }
  })) : e.proxy;
}
function Al(e) {
  return R(e) && "__vccOpts" in e;
}
const Il = (e, t) => mr(e, t, Tt), Pl = "3.5.18";
/**
* @vue/runtime-dom v3.5.18
* (c) 2018-present Yuxi (Evan) You and Vue contributors
* @license MIT
**/
let ws;
const hn = typeof window < "u" && window.trustedTypes;
if (hn)
  try {
    ws = /* @__PURE__ */ hn.createPolicy("vue", {
      createHTML: (e) => e
    });
  } catch {
  }
const Ei = ws ? (e) => ws.createHTML(e) : (e) => e, Rl = "http://www.w3.org/2000/svg", Ml = "http://www.w3.org/1998/Math/MathML", Oe = typeof document < "u" ? document : null, pn = Oe && /* @__PURE__ */ Oe.createElement("template"), Dl = {
  insert: (e, t, s) => {
    t.insertBefore(e, s || null);
  },
  remove: (e) => {
    const t = e.parentNode;
    t && t.removeChild(e);
  },
  createElement: (e, t, s, n) => {
    const i = t === "svg" ? Oe.createElementNS(Rl, e) : t === "mathml" ? Oe.createElementNS(Ml, e) : s ? Oe.createElement(e, { is: s }) : Oe.createElement(e);
    return e === "select" && n && n.multiple != null && i.setAttribute("multiple", n.multiple), i;
  },
  createText: (e) => Oe.createTextNode(e),
  createComment: (e) => Oe.createComment(e),
  setText: (e, t) => {
    e.nodeValue = t;
  },
  setElementText: (e, t) => {
    e.textContent = t;
  },
  parentNode: (e) => e.parentNode,
  nextSibling: (e) => e.nextSibling,
  querySelector: (e) => Oe.querySelector(e),
  setScopeId(e, t) {
    e.setAttribute(t, "");
  },
  // __UNSAFE__
  // Reason: innerHTML.
  // Static content here can only come from compiled templates.
  // As long as the user only uses trusted templates, this is safe.
  insertStaticContent(e, t, s, n, i, r) {
    const l = s ? s.previousSibling : t.lastChild;
    if (i && (i === r || i.nextSibling))
      for (; t.insertBefore(i.cloneNode(!0), s), !(i === r || !(i = i.nextSibling)); )
        ;
    else {
      pn.innerHTML = Ei(
        n === "svg" ? `<svg>${e}</svg>` : n === "mathml" ? `<math>${e}</math>` : e
      );
      const c = pn.content;
      if (n === "svg" || n === "mathml") {
        const u = c.firstChild;
        for (; u.firstChild; )
          c.appendChild(u.firstChild);
        c.removeChild(u);
      }
      t.insertBefore(c, s);
    }
    return [
      // first
      l ? l.nextSibling : t.firstChild,
      // last
      s ? s.previousSibling : t.lastChild
    ];
  }
}, Fl = Symbol("_vtc");
function Hl(e, t, s) {
  const n = e[Fl];
  n && (t = (t ? [t, ...n] : [...n]).join(" ")), t == null ? e.removeAttribute("class") : s ? e.setAttribute("class", t) : e.className = t;
}
const gn = Symbol("_vod"), Kl = Symbol("_vsh"), jl = Symbol(""), Ll = /(^|;)\s*display\s*:/;
function Nl(e, t, s) {
  const n = e.style, i = J(s);
  let r = !1;
  if (s && !i) {
    if (t)
      if (J(t))
        for (const l of t.split(";")) {
          const c = l.slice(0, l.indexOf(":")).trim();
          s[c] == null && Lt(n, c, "");
        }
      else
        for (const l in t)
          s[l] == null && Lt(n, l, "");
    for (const l in s)
      l === "display" && (r = !0), Lt(n, l, s[l]);
  } else if (i) {
    if (t !== s) {
      const l = n[jl];
      l && (s += ";" + l), n.cssText = s, r = Ll.test(s);
    }
  } else t && e.removeAttribute("style");
  gn in e && (e[gn] = r ? n.display : "", e[Kl] && (n.display = "none"));
}
const mn = /\s*!important$/;
function Lt(e, t, s) {
  if (P(s))
    s.forEach((n) => Lt(e, t, n));
  else if (s == null && (s = ""), t.startsWith("--"))
    e.setProperty(t, s);
  else {
    const n = $l(e, t);
    mn.test(s) ? e.setProperty(
      We(n),
      s.replace(mn, ""),
      "important"
    ) : e[n] = s;
  }
}
const _n = ["Webkit", "Moz", "ms"], cs = {};
function $l(e, t) {
  const s = cs[t];
  if (s)
    return s;
  let n = Ne(t);
  if (n !== "filter" && n in e)
    return cs[t] = n;
  n = Pn(n);
  for (let i = 0; i < _n.length; i++) {
    const r = _n[i] + n;
    if (r in e)
      return cs[t] = r;
  }
  return t;
}
const bn = "http://www.w3.org/1999/xlink";
function vn(e, t, s, n, i, r = Bi(t)) {
  n && t.startsWith("xlink:") ? s == null ? e.removeAttributeNS(bn, t.slice(6, t.length)) : e.setAttributeNS(bn, t, s) : s == null || r && !Rn(s) ? e.removeAttribute(t) : e.setAttribute(
    t,
    r ? "" : st(s) ? String(s) : s
  );
}
function xn(e, t, s, n, i) {
  if (t === "innerHTML" || t === "textContent") {
    s != null && (e[t] = t === "innerHTML" ? Ei(s) : s);
    return;
  }
  const r = e.tagName;
  if (t === "value" && r !== "PROGRESS" && // custom elements may use _value internally
  !r.includes("-")) {
    const c = r === "OPTION" ? e.getAttribute("value") || "" : e.value, u = s == null ? (
      // #11647: value should be set as empty string for null and undefined,
      // but <input type="checkbox"> should be set as 'on'.
      e.type === "checkbox" ? "on" : ""
    ) : String(s);
    (c !== u || !("_value" in e)) && (e.value = u), s == null && e.removeAttribute(t), e._value = s;
    return;
  }
  let l = !1;
  if (s === "" || s == null) {
    const c = typeof e[t];
    c === "boolean" ? s = Rn(s) : s == null && c === "string" ? (s = "", l = !0) : c === "number" && (s = 0, l = !0);
  }
  try {
    e[t] = s;
  } catch {
  }
  l && e.removeAttribute(i || t);
}
function Wl(e, t, s, n) {
  e.addEventListener(t, s, n);
}
function Bl(e, t, s, n) {
  e.removeEventListener(t, s, n);
}
const yn = Symbol("_vei");
function Ul(e, t, s, n, i = null) {
  const r = e[yn] || (e[yn] = {}), l = r[t];
  if (n && l)
    l.value = n;
  else {
    const [c, u] = Vl(t);
    if (n) {
      const p = r[t] = Gl(
        n,
        i
      );
      Wl(e, c, p, u);
    } else l && (Bl(e, c, l, u), r[t] = void 0);
  }
}
const wn = /(?:Once|Passive|Capture)$/;
function Vl(e) {
  let t;
  if (wn.test(e)) {
    t = {};
    let n;
    for (; n = e.match(wn); )
      e = e.slice(0, e.length - n[0].length), t[n[0].toLowerCase()] = !0;
  }
  return [e[2] === ":" ? e.slice(3) : We(e.slice(2)), t];
}
let fs = 0;
const kl = /* @__PURE__ */ Promise.resolve(), ql = () => fs || (kl.then(() => fs = 0), fs = Date.now());
function Gl(e, t) {
  const s = (n) => {
    if (!n._vts)
      n._vts = Date.now();
    else if (n._vts <= s.attached)
      return;
    Te(
      Jl(n, s.value),
      t,
      5,
      [n]
    );
  };
  return s.value = e, s.attached = ql(), s;
}
function Jl(e, t) {
  if (P(t)) {
    const s = e.stopImmediatePropagation;
    return e.stopImmediatePropagation = () => {
      s.call(e), e._stopped = !0;
    }, t.map(
      (n) => (i) => !i._stopped && n && n(i)
    );
  } else
    return t;
}
const Sn = (e) => e.charCodeAt(0) === 111 && e.charCodeAt(1) === 110 && // lowercase letter
e.charCodeAt(2) > 96 && e.charCodeAt(2) < 123, Yl = (e, t, s, n, i, r) => {
  const l = i === "svg";
  t === "class" ? Hl(e, n, l) : t === "style" ? Nl(e, s, n) : Vt(t) ? Ts(t) || Ul(e, t, s, n, r) : (t[0] === "." ? (t = t.slice(1), !0) : t[0] === "^" ? (t = t.slice(1), !1) : zl(e, t, n, l)) ? (xn(e, t, n), !e.tagName.includes("-") && (t === "value" || t === "checked" || t === "selected") && vn(e, t, n, l, r, t !== "value")) : /* #11081 force set props for possible async custom element */ e._isVueCE && (/[A-Z]/.test(t) || !J(n)) ? xn(e, Ne(t), n, r, t) : (t === "true-value" ? e._trueValue = n : t === "false-value" && (e._falseValue = n), vn(e, t, n, l));
};
function zl(e, t, s, n) {
  if (n)
    return !!(t === "innerHTML" || t === "textContent" || t in e && Sn(t) && R(s));
  if (t === "spellcheck" || t === "draggable" || t === "translate" || t === "autocorrect" || t === "form" || t === "list" && e.tagName === "INPUT" || t === "type" && e.tagName === "TEXTAREA")
    return !1;
  if (t === "width" || t === "height") {
    const i = e.tagName;
    if (i === "IMG" || i === "VIDEO" || i === "CANVAS" || i === "SOURCE")
      return !1;
  }
  return Sn(t) && J(s) ? !1 : t in e;
}
const Xl = ["ctrl", "shift", "alt", "meta"], Ql = {
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
  exact: (e, t) => Xl.some((s) => e[`${s}Key`] && !t.includes(s))
}, Zl = (e, t) => {
  const s = e._withMods || (e._withMods = {}), n = t.join(".");
  return s[n] || (s[n] = (i, ...r) => {
    for (let l = 0; l < t.length; l++) {
      const c = Ql[t[l]];
      if (c && c(i, t)) return;
    }
    return e(i, ...r);
  });
}, eo = {
  esc: "escape",
  space: " ",
  up: "arrow-up",
  left: "arrow-left",
  right: "arrow-right",
  down: "arrow-down",
  delete: "backspace"
}, to = (e, t) => {
  const s = e._withKeys || (e._withKeys = {}), n = t.join(".");
  return s[n] || (s[n] = (i) => {
    if (!("key" in i))
      return;
    const r = We(i.key);
    if (t.some(
      (l) => l === r || eo[l] === r
    ))
      return e(i);
  });
}, so = /* @__PURE__ */ ne({ patchProp: Yl }, Dl);
let Tn;
function no() {
  return Tn || (Tn = el(so));
}
const io = (...e) => {
  const t = no().createApp(...e), { mount: s } = t;
  return t.mount = (n) => {
    const i = lo(n);
    if (!i) return;
    const r = t._component;
    !R(r) && !r.render && !r.template && (r.template = i.innerHTML), i.nodeType === 1 && (i.textContent = "");
    const l = s(i, !1, ro(i));
    return i instanceof Element && (i.removeAttribute("v-cloak"), i.setAttribute("data-v-app", "")), l;
  }, t;
};
function ro(e) {
  if (e instanceof SVGElement)
    return "svg";
  if (typeof MathMLElement == "function" && e instanceof MathMLElement)
    return "mathml";
}
function lo(e) {
  return J(e) ? document.querySelector(e) : e;
}
const En = "/assets/realtime-D76WnJv9.webp?no-inline", Cn = "/assets/watchlist-Bre7a5s5.webp?no-inline", On = "/assets/daily-review-DvSLLb1Q.webp?no-inline", An = "/assets/dragon-tiger-CISKXPpq.webp?no-inline", oo = { class: "app-shell" }, co = {
  id: "top",
  class: "site-hero"
}, fo = { class: "hero-copy" }, uo = { class: "actions" }, ao = ["href"], ho = {
  id: "pages",
  class: "product-pages section"
}, po = { class: "page-showcase" }, go = { class: "page-feature" }, mo = ["src"], _o = { class: "page-feature reverse" }, bo = ["src"], vo = { class: "page-feature" }, xo = ["src"], yo = { class: "page-feature reverse" }, wo = ["src"], So = {
  id: "download",
  class: "download-section"
}, To = { class: "download-options" }, Eo = ["href"], Co = ["href"], Oo = ["href"], Ao = { class: "download-note" }, Io = ["href"], Po = ["href"], Ro = ["href"], Mo = ["href"], Do = ["href"], Fo = ["href"], Ho = ["aria-label"], Ko = { class: "image-lightbox-content" }, jo = ["src", "alt"], Lo = {
  __name: "App",
  setup(e) {
    const t = {
      assistant: "https://oss.askcode.cn/files/hangqing-installer-0.3.9-win.exe",
      assistantBackup: "https://github.com/rjf1979/review_stock/releases/download/v0.3.9/hangqing-installer-0.3.9-win.exe",
      x64: "https://oss.askcode.cn/files/hangqing-desktop-0.3.9-win-x64-setup.exe",
      ia32: "https://oss.askcode.cn/files/hangqing-desktop-0.3.9-win-ia32-setup.exe",
      x64Backup: "https://github.com/rjf1979/review_stock/releases/download/v0.3.9/hangqing-desktop-0.3.9-win-x64-setup.exe",
      ia32Backup: "https://github.com/rjf1979/review_stock/releases/download/v0.3.9/hangqing-desktop-0.3.9-win-ia32-setup.exe",
      x64Backup2: "https://my-soft-2026.oss-cn-shanghai.aliyuncs.com/files/hangqing-desktop-0.3.9-win-x64-setup.exe",
      ia32Backup2: "https://my-soft-2026.oss-cn-shanghai.aliyuncs.com/files/hangqing-desktop-0.3.9-win-ia32-setup.exe",
      release: "https://github.com/rjf1979/review_stock/releases/tag/v0.3.9"
    }, s = ar(null);
    function n(i, r) {
      s.value = { src: i, alt: r };
    }
    return (i, r) => (xs(), un("div", oo, [
      r[37] || (r[37] = ft('<header class="nav"><a class="logo" href="#top" aria-label="返回股市脉搏首页">股市脉搏<span>DESKTOP MARKET DESK</span></a><nav aria-label="主导航"><a href="#features">功能</a><a href="#pages">页面</a><a href="#how">工作方式</a><a href="#download">下载</a></nav></header>', 1)),
      h("main", null, [
        h("section", co, [
          h("div", fo, [
            r[8] || (r[8] = h("p", { class: "kicker" }, "LOCAL MARKET DESK · WINDOWS DESKTOP", -1)),
            r[9] || (r[9] = h("h1", null, [
              be("股市脉搏，"),
              h("br"),
              h("em", null, "一屏看懂。")
            ], -1)),
            r[10] || (r[10] = h("p", { class: "lede" }, "实时行情、板块、龙虎榜和收盘复盘。数据在你的电脑本地整理，打开应用就能开始工作。", -1)),
            h("div", uo, [
              h("a", {
                class: "primary",
                href: t.assistant
              }, "一键安装 Windows 版", 8, ao),
              r[7] || (r[7] = h("a", {
                class: "text-link",
                href: "#features"
              }, "查看功能", -1))
            ]),
            r[11] || (r[11] = h("p", { class: "fine" }, "Windows 10/11 · 自动匹配 x64 / x86 · macOS 暂未提供 · 免费 · 无需账号", -1))
          ]),
          r[12] || (r[12] = ft('<div class="hero-console" aria-label="股市脉搏桌面版功能预览"><div class="console-bar"><span class="console-brand"><i aria-hidden="true"></i> 股市脉搏</span><span class="console-caption">DESKTOP APP</span><span class="console-status">本地运行</span></div><div class="console-content"><div class="console-heading"><div><small>MARKET DESK / FEATURES</small><strong>收盘后的工作台</strong></div><span class="console-refresh">无需登录</span></div><div class="console-indices"><div class="console-index"><small>实时行情</small><strong>本地更新</strong><span>指数与自选股</span></div><div class="console-index"><small>每日复盘</small><strong>16:00</strong><span>工作日整理</span></div><div class="console-index"><small>系统通知</small><strong>可选</strong><span>托盘运行</span></div></div><div class="console-table"><div><span>数据来源</span><b>腾讯行情 · 东方财富</b></div><div><span>运行方式</span><b>本地直连公开接口</b></div><div><span>数据保存</span><b>当前 Windows 用户本地</b></div></div></div></div>', 1))
        ]),
        r[34] || (r[34] = ft('<section id="features" class="feature-section"><div class="section-heading"><p class="kicker">DESKTOP FEATURES</p><h2>为每天收盘后的十分钟设计</h2><p>把需要反复打开的行情入口，收拢成一张安静、可扫描的桌面工作台。从盘中观察到收盘复盘，每个页面都围绕一个明确任务展开。</p></div><div class="feature-grid"><article><span class="feature-index">01</span><h3>实时行情</h3><p>A 股指数、市场宽度、涨跌停、行业资金、涨跌榜和盘口异动集中显示，交易时段自动刷新。</p></article><article><span class="feature-index">02</span><h3>自选股工作区</h3><p>保存常看股票，查看最新报价、涨跌幅与日 K 走势，还能把股票即时加入浮动监控。</p></article><article><span class="feature-index">03</span><h3>每日复盘</h3><p>用市场温度、情绪指标、指数结构、主线排序、连板高度和数据质量核对还原收盘状态。</p></article><article><span class="feature-index">04</span><h3>龙虎榜联动</h3><p>展开买卖前五席位，查看净买入与上榜原因，并将关注股票直接加入自选股。</p></article></div></section>', 1)),
        h("section", ho, [
          r[21] || (r[21] = h("div", { class: "section-heading" }, [
            h("p", { class: "kicker" }, "INSIDE THE DESK"),
            h("h2", null, "每个页面，解决一个观察问题"),
            h("p", null, "下面是桌面版的真实界面。数据来自应用实际页面，帮助你在下载安装前了解工作方式。")
          ], -1)),
          h("div", po, [
            h("article", go, [
              h("figure", null, [
                h("button", {
                  type: "button",
                  class: "page-shot",
                  "aria-label": "查看实时行情页面原图",
                  onClick: r[0] || (r[0] = (l) => n(Ce(En), "股市脉搏实时行情页面，展示指数、市场宽度、资金流和涨跌榜"))
                }, [
                  h("img", {
                    src: Ce(En),
                    alt: "股市脉搏实时行情页面，展示指数、市场宽度、资金流和涨跌榜",
                    loading: "lazy"
                  }, null, 8, mo)
                ]),
                r[13] || (r[13] = h("figcaption", null, "实时行情 · 点击查看原图", -1))
              ]),
              r[14] || (r[14] = h("div", { class: "page-copy" }, [
                h("span", { class: "feature-index" }, "01 / REALTIME"),
                h("h3", null, "先判断今天的市场状态"),
                h("p", null, "打开应用先看到市场雷达：主要指数、全市场涨跌家数、涨停跌停、行业主力资金、涨跌幅榜和盘口异动位于同一工作区。"),
                h("ul", null, [
                  h("li", null, "交易时段自动刷新，闭市后保留最近有效数据"),
                  h("li", null, "盘面异常与数据日期清晰标注"),
                  h("li", null, "顶部菜单固定，内容区域独立滚动")
                ])
              ], -1))
            ]),
            h("article", _o, [
              h("figure", null, [
                h("button", {
                  type: "button",
                  class: "page-shot",
                  "aria-label": "查看自选股页面原图",
                  onClick: r[1] || (r[1] = (l) => n(Ce(Cn), "股市脉搏自选股页面，展示自选股票报价和日 K 走势"))
                }, [
                  h("img", {
                    src: Ce(Cn),
                    alt: "股市脉搏自选股页面，展示自选股票报价和日 K 走势",
                    loading: "lazy"
                  }, null, 8, bo)
                ]),
                r[15] || (r[15] = h("figcaption", null, "自选股 · 点击查看原图", -1))
              ]),
              r[16] || (r[16] = h("div", { class: "page-copy" }, [
                h("span", { class: "feature-index" }, "02 / WATCHLIST"),
                h("h3", null, "把关注的股票放在一起"),
                h("p", null, "自选股页面把常看标的整理成可扫描的行情卡，报价、涨跌幅、数据时间和日 K 图一屏可见。"),
                h("ul", null, [
                  h("li", null, "支持添加、删除和从龙虎榜直接加入"),
                  h("li", null, "自选股卡片可直接开启浮窗监控"),
                  h("li", null, "本地保存，不需要注册账号")
                ])
              ], -1))
            ]),
            h("article", vo, [
              h("figure", null, [
                h("button", {
                  type: "button",
                  class: "page-shot",
                  "aria-label": "查看每日复盘页面原图",
                  onClick: r[2] || (r[2] = (l) => n(Ce(On), "股市脉搏每日复盘页面，展示市场温度、情绪指标和行业资金"))
                }, [
                  h("img", {
                    src: Ce(On),
                    alt: "股市脉搏每日复盘页面，展示市场温度、情绪指标和行业资金",
                    loading: "lazy"
                  }, null, 8, xo)
                ]),
                r[17] || (r[17] = h("figcaption", null, "每日复盘 · 点击查看原图", -1))
              ]),
              r[18] || (r[18] = h("div", { class: "page-copy" }, [
                h("span", { class: "feature-index" }, "03 / DAILY REVIEW"),
                h("h3", null, "把收盘后的信息整理成结论"),
                h("p", null, "每日复盘将分散的收盘数据放在固定结构中，先看温度与情绪，再看指数、行业资金、连板梯队和详细数据。"),
                h("ul", null, [
                  h("li", null, "市场温度与红盘率快速判断情绪"),
                  h("li", null, "行业涨幅和主力净流入分栏呈现"),
                  h("li", null, "数据质量核对，明确样本与统计口径")
                ])
              ], -1))
            ]),
            h("article", yo, [
              h("figure", null, [
                h("button", {
                  type: "button",
                  class: "page-shot",
                  "aria-label": "查看龙虎榜页面原图",
                  onClick: r[3] || (r[3] = (l) => n(Ce(An), "股市脉搏龙虎榜页面，展示买卖席位和净额"))
                }, [
                  h("img", {
                    src: Ce(An),
                    alt: "股市脉搏龙虎榜页面，展示买卖席位和净额",
                    loading: "lazy"
                  }, null, 8, wo)
                ]),
                r[19] || (r[19] = h("figcaption", null, "龙虎榜 · 点击查看原图", -1))
              ]),
              r[20] || (r[20] = h("div", { class: "page-copy" }, [
                h("span", { class: "feature-index" }, "04 / DRAGON TIGER"),
                h("h3", null, "从上榜股票看到资金席位"),
                h("p", null, "龙虎榜按股票展开买入、卖出和净额，进一步查看买卖前五席位；符合条件的股票可直接放入自选股。"),
                h("ul", null, [
                  h("li", null, "公开席位名称按机构或营业部展示"),
                  h("li", null, "买卖金额与净额使用统一单位"),
                  h("li", null, "支持展开与收起，减少页面干扰")
                ])
              ], -1))
            ])
          ])
        ]),
        r[35] || (r[35] = ft('<section id="how" class="how section"><div class="section-heading"><p class="kicker">HOW IT WORKS</p><h2>从数据到桌面，只需三步</h2><p>股市脉搏是本地优先的 Windows 工具，公开行情直接在电脑上整理。</p></div><div class="steps"><div><b>01</b><h3>安装桌面版</h3><p>运行安装助手，自动匹配架构并进入安装向导。</p></div><div><b>02</b><h3>本地抓取行情</h3><p>应用直接读取公开行情源，在本机整理实时数据。</p></div><div><b>03</b><h3>收盘后查看</h3><p>打开工作台查看盘面、异动、自选和每日复盘。</p></div></div></section>', 1)),
        h("section", So, [
          r[33] || (r[33] = h("div", null, [
            h("p", { class: "kicker" }, "DESKTOP RELEASE · V0.3.9"),
            h("h2", null, "把股市脉搏放在桌面上"),
            h("p", null, "推荐使用统一安装应用：自动检查环境、匹配 x64 / x86、显示下载进度、校验文件后启动安装向导。也可按架构手动下载。macOS 暂未提供，安装包未签名，请核对发布页 SHA-256。")
          ], -1)),
          h("div", To, [
            h("a", {
              class: "download-option assistant",
              href: t.assistant
            }, r[22] || (r[22] = [
              h("span", null, "推荐 · 统一安装应用", -1),
              h("strong", null, "自动安装", -1),
              h("small", null, "自动匹配架构并启动向导", -1)
            ]), 8, Eo),
            h("a", {
              class: "download-option",
              href: t.x64
            }, r[23] || (r[23] = [
              h("span", null, "Windows 64 位 (x64)", -1),
              h("strong", null, "下载安装包", -1),
              h("small", null, "适用于绝大多数 Windows 10/11 电脑", -1)
            ]), 8, Co),
            h("a", {
              class: "download-option",
              href: t.ia32
            }, r[24] || (r[24] = [
              h("span", null, "Windows 32 位 (x86)", -1),
              h("strong", null, "下载安装包", -1),
              h("small", null, "仅用于 32 位 Windows", -1)
            ]), 8, Oo),
            r[32] || (r[32] = h("div", {
              class: "download-option unavailable",
              role: "note"
            }, [
              h("span", null, "macOS"),
              h("strong", null, "暂未提供"),
              h("small", null, "当前仅支持 Windows")
            ], -1)),
            h("p", Ao, [
              r[25] || (r[25] = be("备用入口：", -1)),
              h("a", {
                href: t.assistantBackup
              }, "安装助手", 8, Io),
              r[26] || (r[26] = be(" · ", -1)),
              h("a", {
                href: t.x64Backup
              }, "GitHub x64", 8, Po),
              r[27] || (r[27] = be(" · ", -1)),
              h("a", {
                href: t.ia32Backup
              }, "GitHub x86", 8, Ro),
              r[28] || (r[28] = be(" · ", -1)),
              h("a", {
                href: t.x64Backup2
              }, "OSS x64", 8, Mo),
              r[29] || (r[29] = be(" · ", -1)),
              h("a", {
                href: t.ia32Backup2
              }, "OSS x86", 8, Do),
              r[30] || (r[30] = be(" · ", -1)),
              h("a", {
                href: t.release
              }, "全部版本", 8, Fo),
              r[31] || (r[31] = be("。", -1))
            ])
          ])
        ]),
        r[36] || (r[36] = ft('<section id="future-app" class="future-section section"><div class="section-heading"><p class="kicker">FUTURE APP</p><h2>未来再延伸到移动端</h2><p>移动端目前只是工程占位，后续将单独设计数据访问、同步、离线和通知策略，不直接依赖 Electron 桌面端。</p></div></section><section id="data" class="compliance-section section"><div class="section-heading"><p class="kicker">DATA &amp; DISCLAIMER</p><h2>数据从哪里来？</h2></div><div class="compliance-grid"><div><h3>公开来源，本地整理</h3><p>股市脉搏使用腾讯行情、东方财富等公开免费数据源。桌面版在本地取数和整理，不采集你的交易信息，也不经过平台服务器中转。</p></div><div><h3>免责声明</h3><p>股市脉搏仅提供行情数据的展示与整理，所有数据来自公开来源，仅供参考，不构成任何投资建议。股市有风险，投资需谨慎。</p></div></div></section>', 2))
      ]),
      s.value ? (xs(), un("div", {
        key: 0,
        class: "image-lightbox",
        role: "dialog",
        "aria-modal": "true",
        "aria-label": s.value.alt,
        onClick: r[5] || (r[5] = Zl((l) => s.value = null, ["self"])),
        onKeydown: r[6] || (r[6] = to((l) => s.value = null, ["esc", "window"]))
      }, [
        h("div", Ko, [
          h("button", {
            type: "button",
            class: "image-lightbox-close",
            "aria-label": "关闭原图",
            onClick: r[4] || (r[4] = (l) => s.value = null)
          }, "×"),
          h("img", {
            src: s.value.src,
            alt: s.value.alt
          }, null, 8, jo)
        ])
      ], 40, Ho)) : bl("", !0),
      r[38] || (r[38] = h("footer", null, [
        h("span", null, "© 2026 股市脉搏 · Desktop Market Desk"),
        h("span", null, [
          h("a", { href: "#data" }, "数据来源与免责声明"),
          be(" · "),
          h("a", { href: "#download" }, "下载")
        ])
      ], -1))
    ]));
  }
};
io(Lo).mount("#app");
