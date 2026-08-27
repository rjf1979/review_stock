/**
* @vue/shared v3.5.18
* (c) 2018-present Yuxi (Evan) You and Vue contributors
* @license MIT
**/
/*! #__NO_SIDE_EFFECTS__ */
// @__NO_SIDE_EFFECTS__
function ys(e) {
  const t = /* @__PURE__ */ Object.create(null);
  for (const s of e.split(",")) t[s] = 1;
  return (s) => s in t;
}
const U = {}, Ye = [], xe = () => {
}, xi = () => !1, Ut = (e) => e.charCodeAt(0) === 111 && e.charCodeAt(1) === 110 && // uppercase letter
(e.charCodeAt(2) > 122 || e.charCodeAt(2) < 97), ws = (e) => e.startsWith("onUpdate:"), se = Object.assign, Ss = (e, t) => {
  const s = e.indexOf(t);
  s > -1 && e.splice(s, 1);
}, yi = Object.prototype.hasOwnProperty, H = (e, t) => yi.call(e, t), P = Array.isArray, ct = (e) => Vt(e) === "[object Map]", wi = (e) => Vt(e) === "[object Set]", R = (e) => typeof e == "function", Y = (e) => typeof e == "string", et = (e) => typeof e == "symbol", G = (e) => e !== null && typeof e == "object", yn = (e) => (G(e) || R(e)) && R(e.then) && R(e.catch), Si = Object.prototype.toString, Vt = (e) => Si.call(e), Ti = (e) => Vt(e).slice(8, -1), Ei = (e) => Vt(e) === "[object Object]", Ts = (e) => Y(e) && e !== "NaN" && e[0] !== "-" && "" + parseInt(e, 10) === e, ft = /* @__PURE__ */ ys(
  // the leading comma is intentional so empty string "" is also included
  ",key,ref,ref_for,ref_key,onVnodeBeforeMount,onVnodeMounted,onVnodeBeforeUpdate,onVnodeUpdated,onVnodeBeforeUnmount,onVnodeUnmounted"
), Bt = (e) => {
  const t = /* @__PURE__ */ Object.create(null);
  return (s) => t[s] || (t[s] = e(s));
}, Ci = /-(\w)/g, je = Bt(
  (e) => e.replace(Ci, (t, s) => s ? s.toUpperCase() : "")
), Oi = /\B([A-Z])/g, qe = Bt(
  (e) => e.replace(Oi, "-$1").toLowerCase()
), wn = Bt((e) => e.charAt(0).toUpperCase() + e.slice(1)), kt = Bt(
  (e) => e ? `on${wn(e)}` : ""
), Ve = (e, t) => !Object.is(e, t), Qt = (e, ...t) => {
  for (let s = 0; s < e.length; s++)
    e[s](...t);
}, cs = (e, t, s, n = !1) => {
  Object.defineProperty(e, t, {
    configurable: !0,
    enumerable: !1,
    writable: n,
    value: s
  });
}, Ai = (e) => {
  const t = parseFloat(e);
  return isNaN(t) ? e : t;
};
let Js;
const qt = () => Js || (Js = typeof globalThis < "u" ? globalThis : typeof self < "u" ? self : typeof window < "u" ? window : typeof global < "u" ? global : {});
function Es(e) {
  if (P(e)) {
    const t = {};
    for (let s = 0; s < e.length; s++) {
      const n = e[s], i = Y(n) ? Mi(n) : Es(n);
      if (i)
        for (const r in i)
          t[r] = i[r];
    }
    return t;
  } else if (Y(e) || G(e))
    return e;
}
const Pi = /;(?![^(]*\))/g, Ri = /:([^]+)/, Ii = /\/\*[^]*?\*\//g;
function Mi(e) {
  const t = {};
  return e.replace(Ii, "").split(Pi).forEach((s) => {
    if (s) {
      const n = s.split(Ri);
      n.length > 1 && (t[n[0].trim()] = n[1].trim());
    }
  }), t;
}
function Cs(e) {
  let t = "";
  if (Y(e))
    t = e;
  else if (P(e))
    for (let s = 0; s < e.length; s++) {
      const n = Cs(e[s]);
      n && (t += n + " ");
    }
  else if (G(e))
    for (const s in e)
      e[s] && (t += s + " ");
  return t.trim();
}
const Fi = "itemscope,allowfullscreen,formnovalidate,ismap,nomodule,novalidate,readonly", Di = /* @__PURE__ */ ys(Fi);
function Sn(e) {
  return !!e || e === "";
}
/**
* @vue/reactivity v3.5.18
* (c) 2018-present Yuxi (Evan) You and Vue contributors
* @license MIT
**/
let re;
class Hi {
  constructor(t = !1) {
    this.detached = t, this._active = !0, this._on = 0, this.effects = [], this.cleanups = [], this._isPaused = !1, this.parent = re, !t && re && (this.index = (re.scopes || (re.scopes = [])).push(
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
      const s = re;
      try {
        return re = this, t();
      } finally {
        re = s;
      }
    }
  }
  /**
   * This should only be called on non-detached scopes
   * @internal
   */
  on() {
    ++this._on === 1 && (this.prevScope = re, re = this);
  }
  /**
   * This should only be called on non-detached scopes
   * @internal
   */
  off() {
    this._on > 0 && --this._on === 0 && (re = this.prevScope, this.prevScope = void 0);
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
function ji() {
  return re;
}
let W;
const es = /* @__PURE__ */ new WeakSet();
class Tn {
  constructor(t) {
    this.fn = t, this.deps = void 0, this.depsTail = void 0, this.flags = 5, this.next = void 0, this.cleanup = void 0, this.scheduler = void 0, re && re.active && re.effects.push(this);
  }
  pause() {
    this.flags |= 64;
  }
  resume() {
    this.flags & 64 && (this.flags &= -65, es.has(this) && (es.delete(this), this.trigger()));
  }
  /**
   * @internal
   */
  notify() {
    this.flags & 2 && !(this.flags & 32) || this.flags & 8 || Cn(this);
  }
  run() {
    if (!(this.flags & 1))
      return this.fn();
    this.flags |= 2, Ys(this), On(this);
    const t = W, s = ue;
    W = this, ue = !0;
    try {
      return this.fn();
    } finally {
      An(this), W = t, ue = s, this.flags &= -3;
    }
  }
  stop() {
    if (this.flags & 1) {
      for (let t = this.deps; t; t = t.nextDep)
        Ps(t);
      this.deps = this.depsTail = void 0, Ys(this), this.onStop && this.onStop(), this.flags &= -2;
    }
  }
  trigger() {
    this.flags & 64 ? es.add(this) : this.scheduler ? this.scheduler() : this.runIfDirty();
  }
  /**
   * @internal
   */
  runIfDirty() {
    fs(this) && this.run();
  }
  get dirty() {
    return fs(this);
  }
}
let En = 0, ut, at;
function Cn(e, t = !1) {
  if (e.flags |= 8, t) {
    e.next = at, at = e;
    return;
  }
  e.next = ut, ut = e;
}
function Os() {
  En++;
}
function As() {
  if (--En > 0)
    return;
  if (at) {
    let t = at;
    for (at = void 0; t; ) {
      const s = t.next;
      t.next = void 0, t.flags &= -9, t = s;
    }
  }
  let e;
  for (; ut; ) {
    let t = ut;
    for (ut = void 0; t; ) {
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
function On(e) {
  for (let t = e.deps; t; t = t.nextDep)
    t.version = -1, t.prevActiveLink = t.dep.activeLink, t.dep.activeLink = t;
}
function An(e) {
  let t, s = e.depsTail, n = s;
  for (; n; ) {
    const i = n.prevDep;
    n.version === -1 ? (n === s && (s = i), Ps(n), Ni(n)) : t = n, n.dep.activeLink = n.prevActiveLink, n.prevActiveLink = void 0, n = i;
  }
  e.deps = t, e.depsTail = s;
}
function fs(e) {
  for (let t = e.deps; t; t = t.nextDep)
    if (t.dep.version !== t.version || t.dep.computed && (Pn(t.dep.computed) || t.dep.version !== t.version))
      return !0;
  return !!e._dirty;
}
function Pn(e) {
  if (e.flags & 4 && !(e.flags & 16) || (e.flags &= -17, e.globalVersion === _t) || (e.globalVersion = _t, !e.isSSR && e.flags & 128 && (!e.deps && !e._dirty || !fs(e))))
    return;
  e.flags |= 2;
  const t = e.dep, s = W, n = ue;
  W = e, ue = !0;
  try {
    On(e);
    const i = e.fn(e._value);
    (t.version === 0 || Ve(i, e._value)) && (e.flags |= 128, e._value = i, t.version++);
  } catch (i) {
    throw t.version++, i;
  } finally {
    W = s, ue = n, An(e), e.flags &= -3;
  }
}
function Ps(e, t = !1) {
  const { dep: s, prevSub: n, nextSub: i } = e;
  if (n && (n.nextSub = i, e.prevSub = void 0), i && (i.prevSub = n, e.nextSub = void 0), s.subs === e && (s.subs = n, !n && s.computed)) {
    s.computed.flags &= -5;
    for (let r = s.computed.deps; r; r = r.nextDep)
      Ps(r, !0);
  }
  !t && !--s.sc && s.map && s.map.delete(s.key);
}
function Ni(e) {
  const { prevDep: t, nextDep: s } = e;
  t && (t.nextDep = s, e.prevDep = void 0), s && (s.prevDep = t, e.nextDep = void 0);
}
let ue = !0;
const Rn = [];
function Oe() {
  Rn.push(ue), ue = !1;
}
function Ae() {
  const e = Rn.pop();
  ue = e === void 0 ? !0 : e;
}
function Ys(e) {
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
let _t = 0;
class Li {
  constructor(t, s) {
    this.sub = t, this.dep = s, this.version = s.version, this.nextDep = this.prevDep = this.nextSub = this.prevSub = this.prevActiveLink = void 0;
  }
}
class In {
  // TODO isolatedDeclarations "__v_skip"
  constructor(t) {
    this.computed = t, this.version = 0, this.activeLink = void 0, this.subs = void 0, this.map = void 0, this.key = void 0, this.sc = 0, this.__v_skip = !0;
  }
  track(t) {
    if (!W || !ue || W === this.computed)
      return;
    let s = this.activeLink;
    if (s === void 0 || s.sub !== W)
      s = this.activeLink = new Li(W, this), W.deps ? (s.prevDep = W.depsTail, W.depsTail.nextDep = s, W.depsTail = s) : W.deps = W.depsTail = s, Mn(s);
    else if (s.version === -1 && (s.version = this.version, s.nextDep)) {
      const n = s.nextDep;
      n.prevDep = s.prevDep, s.prevDep && (s.prevDep.nextDep = n), s.prevDep = W.depsTail, s.nextDep = void 0, W.depsTail.nextDep = s, W.depsTail = s, W.deps === s && (W.deps = n);
    }
    return s;
  }
  trigger(t) {
    this.version++, _t++, this.notify(t);
  }
  notify(t) {
    Os();
    try {
      for (let s = this.subs; s; s = s.prevSub)
        s.sub.notify() && s.sub.dep.notify();
    } finally {
      As();
    }
  }
}
function Mn(e) {
  if (e.dep.sc++, e.sub.flags & 4) {
    const t = e.dep.computed;
    if (t && !e.dep.subs) {
      t.flags |= 20;
      for (let n = t.deps; n; n = n.nextDep)
        Mn(n);
    }
    const s = e.dep.subs;
    s !== e && (e.prevSub = s, s && (s.nextSub = e)), e.dep.subs = e;
  }
}
const us = /* @__PURE__ */ new WeakMap(), Be = Symbol(
  ""
), as = Symbol(
  ""
), bt = Symbol(
  ""
);
function X(e, t, s) {
  if (ue && W) {
    let n = us.get(e);
    n || us.set(e, n = /* @__PURE__ */ new Map());
    let i = n.get(s);
    i || (n.set(s, i = new In()), i.map = n, i.key = s), i.track();
  }
}
function Ce(e, t, s, n, i, r) {
  const o = us.get(e);
  if (!o) {
    _t++;
    return;
  }
  const c = (u) => {
    u && u.trigger();
  };
  if (Os(), t === "clear")
    o.forEach(c);
  else {
    const u = P(e), h = u && Ts(s);
    if (u && s === "length") {
      const a = Number(n);
      o.forEach((p, S) => {
        (S === "length" || S === bt || !et(S) && S >= a) && c(p);
      });
    } else
      switch ((s !== void 0 || o.has(void 0)) && c(o.get(s)), h && c(o.get(bt)), t) {
        case "add":
          u ? h && c(o.get("length")) : (c(o.get(Be)), ct(e) && c(o.get(as)));
          break;
        case "delete":
          u || (c(o.get(Be)), ct(e) && c(o.get(as)));
          break;
        case "set":
          ct(e) && c(o.get(Be));
          break;
      }
  }
  As();
}
function Ge(e) {
  const t = N(e);
  return t === e ? t : (X(t, "iterate", bt), ye(e) ? t : t.map(ce));
}
function Rs(e) {
  return X(e = N(e), "iterate", bt), e;
}
const $i = {
  __proto__: null,
  [Symbol.iterator]() {
    return ts(this, Symbol.iterator, ce);
  },
  concat(...e) {
    return Ge(this).concat(
      ...e.map((t) => P(t) ? Ge(t) : t)
    );
  },
  entries() {
    return ts(this, "entries", (e) => (e[1] = ce(e[1]), e));
  },
  every(e, t) {
    return Se(this, "every", e, t, void 0, arguments);
  },
  filter(e, t) {
    return Se(this, "filter", e, t, (s) => s.map(ce), arguments);
  },
  find(e, t) {
    return Se(this, "find", e, t, ce, arguments);
  },
  findIndex(e, t) {
    return Se(this, "findIndex", e, t, void 0, arguments);
  },
  findLast(e, t) {
    return Se(this, "findLast", e, t, ce, arguments);
  },
  findLastIndex(e, t) {
    return Se(this, "findLastIndex", e, t, void 0, arguments);
  },
  // flat, flatMap could benefit from ARRAY_ITERATE but are not straight-forward to implement
  forEach(e, t) {
    return Se(this, "forEach", e, t, void 0, arguments);
  },
  includes(...e) {
    return ss(this, "includes", e);
  },
  indexOf(...e) {
    return ss(this, "indexOf", e);
  },
  join(e) {
    return Ge(this).join(e);
  },
  // keys() iterator only reads `length`, no optimisation required
  lastIndexOf(...e) {
    return ss(this, "lastIndexOf", e);
  },
  map(e, t) {
    return Se(this, "map", e, t, void 0, arguments);
  },
  pop() {
    return rt(this, "pop");
  },
  push(...e) {
    return rt(this, "push", e);
  },
  reduce(e, ...t) {
    return zs(this, "reduce", e, t);
  },
  reduceRight(e, ...t) {
    return zs(this, "reduceRight", e, t);
  },
  shift() {
    return rt(this, "shift");
  },
  // slice could use ARRAY_ITERATE but also seems to beg for range tracking
  some(e, t) {
    return Se(this, "some", e, t, void 0, arguments);
  },
  splice(...e) {
    return rt(this, "splice", e);
  },
  toReversed() {
    return Ge(this).toReversed();
  },
  toSorted(e) {
    return Ge(this).toSorted(e);
  },
  toSpliced(...e) {
    return Ge(this).toSpliced(...e);
  },
  unshift(...e) {
    return rt(this, "unshift", e);
  },
  values() {
    return ts(this, "values", ce);
  }
};
function ts(e, t, s) {
  const n = Rs(e), i = n[t]();
  return n !== e && !ye(e) && (i._next = i.next, i.next = () => {
    const r = i._next();
    return r.value && (r.value = s(r.value)), r;
  }), i;
}
const Ki = Array.prototype;
function Se(e, t, s, n, i, r) {
  const o = Rs(e), c = o !== e && !ye(e), u = o[t];
  if (u !== Ki[t]) {
    const p = u.apply(e, r);
    return c ? ce(p) : p;
  }
  let h = s;
  o !== e && (c ? h = function(p, S) {
    return s.call(this, ce(p), S, e);
  } : s.length > 2 && (h = function(p, S) {
    return s.call(this, p, S, e);
  }));
  const a = u.call(o, h, n);
  return c && i ? i(a) : a;
}
function zs(e, t, s, n) {
  const i = Rs(e);
  let r = s;
  return i !== e && (ye(e) ? s.length > 3 && (r = function(o, c, u) {
    return s.call(this, o, c, u, e);
  }) : r = function(o, c, u) {
    return s.call(this, o, ce(c), u, e);
  }), i[t](r, ...n);
}
function ss(e, t, s) {
  const n = N(e);
  X(n, "iterate", bt);
  const i = n[t](...s);
  return (i === -1 || i === !1) && Ds(s[0]) ? (s[0] = N(s[0]), n[t](...s)) : i;
}
function rt(e, t, s = []) {
  Oe(), Os();
  const n = N(e)[t].apply(e, s);
  return As(), Ae(), n;
}
const Wi = /* @__PURE__ */ ys("__proto__,__v_isRef,__isVue"), Fn = new Set(
  /* @__PURE__ */ Object.getOwnPropertyNames(Symbol).filter((e) => e !== "arguments" && e !== "caller").map((e) => Symbol[e]).filter(et)
);
function Ui(e) {
  et(e) || (e = String(e));
  const t = N(this);
  return X(t, "has", e), t.hasOwnProperty(e);
}
class Dn {
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
      return n === (i ? r ? ki : Ln : r ? Nn : jn).get(t) || // receiver is not the reactive proxy, but has the same prototype
      // this means the receiver is a user proxy of the reactive proxy
      Object.getPrototypeOf(t) === Object.getPrototypeOf(n) ? t : void 0;
    const o = P(t);
    if (!i) {
      let u;
      if (o && (u = $i[s]))
        return u;
      if (s === "hasOwnProperty")
        return Ui;
    }
    const c = Reflect.get(
      t,
      s,
      // if this is a proxy wrapping a ref, return methods using the raw ref
      // as receiver so that we don't have to call `toRaw` on the ref in all
      // its class methods
      te(t) ? t : n
    );
    return (et(s) ? Fn.has(s) : Wi(s)) || (i || X(t, "get", s), r) ? c : te(c) ? o && Ts(s) ? c : c.value : G(c) ? i ? $n(c) : Ms(c) : c;
  }
}
class Hn extends Dn {
  constructor(t = !1) {
    super(!1, t);
  }
  set(t, s, n, i) {
    let r = t[s];
    if (!this._isShallow) {
      const u = Ze(r);
      if (!ye(n) && !Ze(n) && (r = N(r), n = N(n)), !P(t) && te(r) && !te(n))
        return u ? !1 : (r.value = n, !0);
    }
    const o = P(t) && Ts(s) ? Number(s) < t.length : H(t, s), c = Reflect.set(
      t,
      s,
      n,
      te(t) ? t : i
    );
    return t === N(i) && (o ? Ve(n, r) && Ce(t, "set", s, n) : Ce(t, "add", s, n)), c;
  }
  deleteProperty(t, s) {
    const n = H(t, s);
    t[s];
    const i = Reflect.deleteProperty(t, s);
    return i && n && Ce(t, "delete", s, void 0), i;
  }
  has(t, s) {
    const n = Reflect.has(t, s);
    return (!et(s) || !Fn.has(s)) && X(t, "has", s), n;
  }
  ownKeys(t) {
    return X(
      t,
      "iterate",
      P(t) ? "length" : Be
    ), Reflect.ownKeys(t);
  }
}
class Vi extends Dn {
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
const Bi = /* @__PURE__ */ new Hn(), qi = /* @__PURE__ */ new Vi(), Gi = /* @__PURE__ */ new Hn(!0);
const ds = (e) => e, Pt = (e) => Reflect.getPrototypeOf(e);
function Ji(e, t, s) {
  return function(...n) {
    const i = this.__v_raw, r = N(i), o = ct(r), c = e === "entries" || e === Symbol.iterator && o, u = e === "keys" && o, h = i[e](...n), a = s ? ds : t ? hs : ce;
    return !t && X(
      r,
      "iterate",
      u ? as : Be
    ), {
      // iterator protocol
      next() {
        const { value: p, done: S } = h.next();
        return S ? { value: p, done: S } : {
          value: c ? [a(p[0]), a(p[1])] : a(p),
          done: S
        };
      },
      // iterable protocol
      [Symbol.iterator]() {
        return this;
      }
    };
  };
}
function Rt(e) {
  return function(...t) {
    return e === "delete" ? !1 : e === "clear" ? void 0 : this;
  };
}
function Yi(e, t) {
  const s = {
    get(i) {
      const r = this.__v_raw, o = N(r), c = N(i);
      e || (Ve(i, c) && X(o, "get", i), X(o, "get", c));
      const { has: u } = Pt(o), h = t ? ds : e ? hs : ce;
      if (u.call(o, i))
        return h(r.get(i));
      if (u.call(o, c))
        return h(r.get(c));
      r !== o && r.get(i);
    },
    get size() {
      const i = this.__v_raw;
      return !e && X(N(i), "iterate", Be), Reflect.get(i, "size", i);
    },
    has(i) {
      const r = this.__v_raw, o = N(r), c = N(i);
      return e || (Ve(i, c) && X(o, "has", i), X(o, "has", c)), i === c ? r.has(i) : r.has(i) || r.has(c);
    },
    forEach(i, r) {
      const o = this, c = o.__v_raw, u = N(c), h = t ? ds : e ? hs : ce;
      return !e && X(u, "iterate", Be), c.forEach((a, p) => i.call(r, h(a), h(p), o));
    }
  };
  return se(
    s,
    e ? {
      add: Rt("add"),
      set: Rt("set"),
      delete: Rt("delete"),
      clear: Rt("clear")
    } : {
      add(i) {
        !t && !ye(i) && !Ze(i) && (i = N(i));
        const r = N(this);
        return Pt(r).has.call(r, i) || (r.add(i), Ce(r, "add", i, i)), this;
      },
      set(i, r) {
        !t && !ye(r) && !Ze(r) && (r = N(r));
        const o = N(this), { has: c, get: u } = Pt(o);
        let h = c.call(o, i);
        h || (i = N(i), h = c.call(o, i));
        const a = u.call(o, i);
        return o.set(i, r), h ? Ve(r, a) && Ce(o, "set", i, r) : Ce(o, "add", i, r), this;
      },
      delete(i) {
        const r = N(this), { has: o, get: c } = Pt(r);
        let u = o.call(r, i);
        u || (i = N(i), u = o.call(r, i)), c && c.call(r, i);
        const h = r.delete(i);
        return u && Ce(r, "delete", i, void 0), h;
      },
      clear() {
        const i = N(this), r = i.size !== 0, o = i.clear();
        return r && Ce(
          i,
          "clear",
          void 0,
          void 0
        ), o;
      }
    }
  ), [
    "keys",
    "values",
    "entries",
    Symbol.iterator
  ].forEach((i) => {
    s[i] = Ji(i, e, t);
  }), s;
}
function Is(e, t) {
  const s = Yi(e, t);
  return (n, i, r) => i === "__v_isReactive" ? !e : i === "__v_isReadonly" ? e : i === "__v_raw" ? n : Reflect.get(
    H(s, i) && i in n ? s : n,
    i,
    r
  );
}
const zi = {
  get: /* @__PURE__ */ Is(!1, !1)
}, Xi = {
  get: /* @__PURE__ */ Is(!1, !0)
}, Zi = {
  get: /* @__PURE__ */ Is(!0, !1)
};
const jn = /* @__PURE__ */ new WeakMap(), Nn = /* @__PURE__ */ new WeakMap(), Ln = /* @__PURE__ */ new WeakMap(), ki = /* @__PURE__ */ new WeakMap();
function Qi(e) {
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
function er(e) {
  return e.__v_skip || !Object.isExtensible(e) ? 0 : Qi(Ti(e));
}
function Ms(e) {
  return Ze(e) ? e : Fs(
    e,
    !1,
    Bi,
    zi,
    jn
  );
}
function tr(e) {
  return Fs(
    e,
    !1,
    Gi,
    Xi,
    Nn
  );
}
function $n(e) {
  return Fs(
    e,
    !0,
    qi,
    Zi,
    Ln
  );
}
function Fs(e, t, s, n, i) {
  if (!G(e) || e.__v_raw && !(t && e.__v_isReactive))
    return e;
  const r = er(e);
  if (r === 0)
    return e;
  const o = i.get(e);
  if (o)
    return o;
  const c = new Proxy(
    e,
    r === 2 ? n : s
  );
  return i.set(e, c), c;
}
function dt(e) {
  return Ze(e) ? dt(e.__v_raw) : !!(e && e.__v_isReactive);
}
function Ze(e) {
  return !!(e && e.__v_isReadonly);
}
function ye(e) {
  return !!(e && e.__v_isShallow);
}
function Ds(e) {
  return e ? !!e.__v_raw : !1;
}
function N(e) {
  const t = e && e.__v_raw;
  return t ? N(t) : e;
}
function sr(e) {
  return !H(e, "__v_skip") && Object.isExtensible(e) && cs(e, "__v_skip", !0), e;
}
const ce = (e) => G(e) ? Ms(e) : e, hs = (e) => G(e) ? $n(e) : e;
function te(e) {
  return e ? e.__v_isRef === !0 : !1;
}
function nr(e) {
  return te(e) ? e.value : e;
}
const ir = {
  get: (e, t, s) => t === "__v_raw" ? e : nr(Reflect.get(e, t, s)),
  set: (e, t, s, n) => {
    const i = e[t];
    return te(i) && !te(s) ? (i.value = s, !0) : Reflect.set(e, t, s, n);
  }
};
function Kn(e) {
  return dt(e) ? e : new Proxy(e, ir);
}
class rr {
  constructor(t, s, n) {
    this.fn = t, this.setter = s, this._value = void 0, this.dep = new In(this), this.__v_isRef = !0, this.deps = void 0, this.depsTail = void 0, this.flags = 16, this.globalVersion = _t - 1, this.next = void 0, this.effect = this, this.__v_isReadonly = !s, this.isSSR = n;
  }
  /**
   * @internal
   */
  notify() {
    if (this.flags |= 16, !(this.flags & 8) && // avoid infinite self recursion
    W !== this)
      return Cn(this, !0), !0;
  }
  get value() {
    const t = this.dep.track();
    return Pn(this), t && (t.version = this.dep.version), this._value;
  }
  set value(t) {
    this.setter && this.setter(t);
  }
}
function or(e, t, s = !1) {
  let n, i;
  return R(e) ? n = e : (n = e.get, i = e.set), new rr(n, i, s);
}
const It = {}, Nt = /* @__PURE__ */ new WeakMap();
let Ue;
function lr(e, t = !1, s = Ue) {
  if (s) {
    let n = Nt.get(s);
    n || Nt.set(s, n = []), n.push(e);
  }
}
function cr(e, t, s = U) {
  const { immediate: n, deep: i, once: r, scheduler: o, augmentJob: c, call: u } = s, h = (O) => i ? O : ye(O) || i === !1 || i === 0 ? De(O, 1) : De(O);
  let a, p, S, T, D = !1, F = !1;
  if (te(e) ? (p = () => e.value, D = ye(e)) : dt(e) ? (p = () => h(e), D = !0) : P(e) ? (F = !0, D = e.some((O) => dt(O) || ye(O)), p = () => e.map((O) => {
    if (te(O))
      return O.value;
    if (dt(O))
      return h(O);
    if (R(O))
      return u ? u(O, 2) : O();
  })) : R(e) ? t ? p = u ? () => u(e, 2) : e : p = () => {
    if (S) {
      Oe();
      try {
        S();
      } finally {
        Ae();
      }
    }
    const O = Ue;
    Ue = a;
    try {
      return u ? u(e, 3, [T]) : e(T);
    } finally {
      Ue = O;
    }
  } : p = xe, t && i) {
    const O = p, J = i === !0 ? 1 / 0 : i;
    p = () => De(O(), J);
  }
  const z = ji(), L = () => {
    a.stop(), z && z.active && Ss(z.effects, a);
  };
  if (r && t) {
    const O = t;
    t = (...J) => {
      O(...J), L();
    };
  }
  let B = F ? new Array(e.length).fill(It) : It;
  const q = (O) => {
    if (!(!(a.flags & 1) || !a.dirty && !O))
      if (t) {
        const J = a.run();
        if (i || D || (F ? J.some((Re, ae) => Ve(Re, B[ae])) : Ve(J, B))) {
          S && S();
          const Re = Ue;
          Ue = a;
          try {
            const ae = [
              J,
              // pass undefined as the old value when it's changed for the first time
              B === It ? void 0 : F && B[0] === It ? [] : B,
              T
            ];
            B = J, u ? u(t, 3, ae) : (
              // @ts-expect-error
              t(...ae)
            );
          } finally {
            Ue = Re;
          }
        }
      } else
        a.run();
  };
  return c && c(q), a = new Tn(p), a.scheduler = o ? () => o(q, !1) : q, T = (O) => lr(O, !1, a), S = a.onStop = () => {
    const O = Nt.get(a);
    if (O) {
      if (u)
        u(O, 4);
      else
        for (const J of O) J();
      Nt.delete(a);
    }
  }, t ? n ? q(!0) : B = a.run() : o ? o(q.bind(null, !0), !0) : a.run(), L.pause = a.pause.bind(a), L.resume = a.resume.bind(a), L.stop = L, L;
}
function De(e, t = 1 / 0, s) {
  if (t <= 0 || !G(e) || e.__v_skip || (s = s || /* @__PURE__ */ new Set(), s.has(e)))
    return e;
  if (s.add(e), t--, te(e))
    De(e.value, t, s);
  else if (P(e))
    for (let n = 0; n < e.length; n++)
      De(e[n], t, s);
  else if (wi(e) || ct(e))
    e.forEach((n) => {
      De(n, t, s);
    });
  else if (Ei(e)) {
    for (const n in e)
      De(e[n], t, s);
    for (const n of Object.getOwnPropertySymbols(e))
      Object.prototype.propertyIsEnumerable.call(e, n) && De(e[n], t, s);
  }
  return e;
}
/**
* @vue/runtime-core v3.5.18
* (c) 2018-present Yuxi (Evan) You and Vue contributors
* @license MIT
**/
function wt(e, t, s, n) {
  try {
    return n ? e(...n) : e();
  } catch (i) {
    Gt(i, t, s);
  }
}
function we(e, t, s, n) {
  if (R(e)) {
    const i = wt(e, t, s, n);
    return i && yn(i) && i.catch((r) => {
      Gt(r, t, s);
    }), i;
  }
  if (P(e)) {
    const i = [];
    for (let r = 0; r < e.length; r++)
      i.push(we(e[r], t, s, n));
    return i;
  }
}
function Gt(e, t, s, n = !0) {
  const i = t ? t.vnode : null, { errorHandler: r, throwUnhandledErrorInProduction: o } = t && t.appContext.config || U;
  if (t) {
    let c = t.parent;
    const u = t.proxy, h = `https://vuejs.org/error-reference/#runtime-${s}`;
    for (; c; ) {
      const a = c.ec;
      if (a) {
        for (let p = 0; p < a.length; p++)
          if (a[p](e, u, h) === !1)
            return;
      }
      c = c.parent;
    }
    if (r) {
      Oe(), wt(r, null, 10, [
        e,
        u,
        h
      ]), Ae();
      return;
    }
  }
  fr(e, s, i, n, o);
}
function fr(e, t, s, n = !0, i = !1) {
  if (i)
    throw e;
  console.error(e);
}
const Q = [];
let _e = -1;
const ze = [];
let Me = null, Je = 0;
const Wn = /* @__PURE__ */ Promise.resolve();
let Lt = null;
function ur(e) {
  const t = Lt || Wn;
  return e ? t.then(this ? e.bind(this) : e) : t;
}
function ar(e) {
  let t = _e + 1, s = Q.length;
  for (; t < s; ) {
    const n = t + s >>> 1, i = Q[n], r = vt(i);
    r < e || r === e && i.flags & 2 ? t = n + 1 : s = n;
  }
  return t;
}
function Hs(e) {
  if (!(e.flags & 1)) {
    const t = vt(e), s = Q[Q.length - 1];
    !s || // fast path when the job id is larger than the tail
    !(e.flags & 2) && t >= vt(s) ? Q.push(e) : Q.splice(ar(t), 0, e), e.flags |= 1, Un();
  }
}
function Un() {
  Lt || (Lt = Wn.then(Bn));
}
function dr(e) {
  P(e) ? ze.push(...e) : Me && e.id === -1 ? Me.splice(Je + 1, 0, e) : e.flags & 1 || (ze.push(e), e.flags |= 1), Un();
}
function Xs(e, t, s = _e + 1) {
  for (; s < Q.length; s++) {
    const n = Q[s];
    if (n && n.flags & 2) {
      if (e && n.id !== e.uid)
        continue;
      Q.splice(s, 1), s--, n.flags & 4 && (n.flags &= -2), n(), n.flags & 4 || (n.flags &= -2);
    }
  }
}
function Vn(e) {
  if (ze.length) {
    const t = [...new Set(ze)].sort(
      (s, n) => vt(s) - vt(n)
    );
    if (ze.length = 0, Me) {
      Me.push(...t);
      return;
    }
    for (Me = t, Je = 0; Je < Me.length; Je++) {
      const s = Me[Je];
      s.flags & 4 && (s.flags &= -2), s.flags & 8 || s(), s.flags &= -2;
    }
    Me = null, Je = 0;
  }
}
const vt = (e) => e.id == null ? e.flags & 2 ? -1 : 1 / 0 : e.id;
function Bn(e) {
  try {
    for (_e = 0; _e < Q.length; _e++) {
      const t = Q[_e];
      t && !(t.flags & 8) && (t.flags & 4 && (t.flags &= -2), wt(
        t,
        t.i,
        t.i ? 15 : 14
      ), t.flags & 4 || (t.flags &= -2));
    }
  } finally {
    for (; _e < Q.length; _e++) {
      const t = Q[_e];
      t && (t.flags &= -2);
    }
    _e = -1, Q.length = 0, Vn(), Lt = null, (Q.length || ze.length) && Bn();
  }
}
let ve = null, qn = null;
function $t(e) {
  const t = ve;
  return ve = e, qn = e && e.type.__scopeId || null, t;
}
function hr(e, t = ve, s) {
  if (!t || e._n)
    return e;
  const n = (...i) => {
    n._d && on(-1);
    const r = $t(t);
    let o;
    try {
      o = e(...i);
    } finally {
      $t(r), n._d && on(1);
    }
    return o;
  };
  return n._n = !0, n._c = !0, n._d = !0, n;
}
function Ke(e, t, s, n) {
  const i = e.dirs, r = t && t.dirs;
  for (let o = 0; o < i.length; o++) {
    const c = i[o];
    r && (c.oldValue = r[o].value);
    let u = c.dir[n];
    u && (Oe(), we(u, s, 8, [
      e.el,
      c,
      e,
      t
    ]), Ae());
  }
}
const pr = Symbol("_vte"), gr = (e) => e.__isTeleport;
function js(e, t) {
  e.shapeFlag & 6 && e.component ? (e.transition = t, js(e.component.subTree, t)) : e.shapeFlag & 128 ? (e.ssContent.transition = t.clone(e.ssContent), e.ssFallback.transition = t.clone(e.ssFallback)) : e.transition = t;
}
function Gn(e) {
  e.ids = [e.ids[0] + e.ids[2]++ + "-", 0, 0];
}
function ht(e, t, s, n, i = !1) {
  if (P(e)) {
    e.forEach(
      (D, F) => ht(
        D,
        t && (P(t) ? t[F] : t),
        s,
        n,
        i
      )
    );
    return;
  }
  if (pt(n) && !i) {
    n.shapeFlag & 512 && n.type.__asyncResolved && n.component.subTree.component && ht(e, t, s, n.component.subTree);
    return;
  }
  const r = n.shapeFlag & 4 ? Ks(n.component) : n.el, o = i ? null : r, { i: c, r: u } = e, h = t && t.r, a = c.refs === U ? c.refs = {} : c.refs, p = c.setupState, S = N(p), T = p === U ? () => !1 : (D) => H(S, D);
  if (h != null && h !== u && (Y(h) ? (a[h] = null, T(h) && (p[h] = null)) : te(h) && (h.value = null)), R(u))
    wt(u, c, 12, [o, a]);
  else {
    const D = Y(u), F = te(u);
    if (D || F) {
      const z = () => {
        if (e.f) {
          const L = D ? T(u) ? p[u] : a[u] : u.value;
          i ? P(L) && Ss(L, r) : P(L) ? L.includes(r) || L.push(r) : D ? (a[u] = [r], T(u) && (p[u] = a[u])) : (u.value = [r], e.k && (a[e.k] = u.value));
        } else D ? (a[u] = o, T(u) && (p[u] = o)) : F && (u.value = o, e.k && (a[e.k] = o));
      };
      o ? (z.id = -1, le(z, s)) : z();
    }
  }
}
qt().requestIdleCallback;
qt().cancelIdleCallback;
const pt = (e) => !!e.type.__asyncLoader, Jn = (e) => e.type.__isKeepAlive;
function mr(e, t) {
  Yn(e, "a", t);
}
function _r(e, t) {
  Yn(e, "da", t);
}
function Yn(e, t, s = ee) {
  const n = e.__wdc || (e.__wdc = () => {
    let i = s;
    for (; i; ) {
      if (i.isDeactivated)
        return;
      i = i.parent;
    }
    return e();
  });
  if (Jt(t, n, s), s) {
    let i = s.parent;
    for (; i && i.parent; )
      Jn(i.parent.vnode) && br(n, t, s, i), i = i.parent;
  }
}
function br(e, t, s, n) {
  const i = Jt(
    t,
    e,
    n,
    !0
    /* prepend */
  );
  zn(() => {
    Ss(n[t], i);
  }, s);
}
function Jt(e, t, s = ee, n = !1) {
  if (s) {
    const i = s[e] || (s[e] = []), r = t.__weh || (t.__weh = (...o) => {
      Oe();
      const c = St(s), u = we(t, s, e, o);
      return c(), Ae(), u;
    });
    return n ? i.unshift(r) : i.push(r), r;
  }
}
const Pe = (e) => (t, s = ee) => {
  (!yt || e === "sp") && Jt(e, (...n) => t(...n), s);
}, vr = Pe("bm"), xr = Pe("m"), yr = Pe(
  "bu"
), wr = Pe("u"), Sr = Pe(
  "bum"
), zn = Pe("um"), Tr = Pe(
  "sp"
), Er = Pe("rtg"), Cr = Pe("rtc");
function Or(e, t = ee) {
  Jt("ec", e, t);
}
const Ar = Symbol.for("v-ndc"), ps = (e) => e ? gi(e) ? Ks(e) : ps(e.parent) : null, gt = (
  // Move PURE marker to new line to workaround compiler discarding it
  // due to type annotation
  /* @__PURE__ */ se(/* @__PURE__ */ Object.create(null), {
    $: (e) => e,
    $el: (e) => e.vnode.el,
    $data: (e) => e.data,
    $props: (e) => e.props,
    $attrs: (e) => e.attrs,
    $slots: (e) => e.slots,
    $refs: (e) => e.refs,
    $parent: (e) => ps(e.parent),
    $root: (e) => ps(e.root),
    $host: (e) => e.ce,
    $emit: (e) => e.emit,
    $options: (e) => Zn(e),
    $forceUpdate: (e) => e.f || (e.f = () => {
      Hs(e.update);
    }),
    $nextTick: (e) => e.n || (e.n = ur.bind(e.proxy)),
    $watch: (e) => Xr.bind(e)
  })
), ns = (e, t) => e !== U && !e.__isScriptSetup && H(e, t), Pr = {
  get({ _: e }, t) {
    if (t === "__v_skip")
      return !0;
    const { ctx: s, setupState: n, data: i, props: r, accessCache: o, type: c, appContext: u } = e;
    let h;
    if (t[0] !== "$") {
      const T = o[t];
      if (T !== void 0)
        switch (T) {
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
        if (ns(n, t))
          return o[t] = 1, n[t];
        if (i !== U && H(i, t))
          return o[t] = 2, i[t];
        if (
          // only cache other properties when instance has declared (thus stable)
          // props
          (h = e.propsOptions[0]) && H(h, t)
        )
          return o[t] = 3, r[t];
        if (s !== U && H(s, t))
          return o[t] = 4, s[t];
        gs && (o[t] = 0);
      }
    }
    const a = gt[t];
    let p, S;
    if (a)
      return t === "$attrs" && X(e.attrs, "get", ""), a(e);
    if (
      // css module (injected by vue-loader)
      (p = c.__cssModules) && (p = p[t])
    )
      return p;
    if (s !== U && H(s, t))
      return o[t] = 4, s[t];
    if (
      // global properties
      S = u.config.globalProperties, H(S, t)
    )
      return S[t];
  },
  set({ _: e }, t, s) {
    const { data: n, setupState: i, ctx: r } = e;
    return ns(i, t) ? (i[t] = s, !0) : n !== U && H(n, t) ? (n[t] = s, !0) : H(e.props, t) || t[0] === "$" && t.slice(1) in e ? !1 : (r[t] = s, !0);
  },
  has({
    _: { data: e, setupState: t, accessCache: s, ctx: n, appContext: i, propsOptions: r }
  }, o) {
    let c;
    return !!s[o] || e !== U && H(e, o) || ns(t, o) || (c = r[0]) && H(c, o) || H(n, o) || H(gt, o) || H(i.config.globalProperties, o);
  },
  defineProperty(e, t, s) {
    return s.get != null ? e._.accessCache[t] = 0 : H(s, "value") && this.set(e, t, s.value, null), Reflect.defineProperty(e, t, s);
  }
};
function Zs(e) {
  return P(e) ? e.reduce(
    (t, s) => (t[s] = null, t),
    {}
  ) : e;
}
let gs = !0;
function Rr(e) {
  const t = Zn(e), s = e.proxy, n = e.ctx;
  gs = !1, t.beforeCreate && ks(t.beforeCreate, e, "bc");
  const {
    // state
    data: i,
    computed: r,
    methods: o,
    watch: c,
    provide: u,
    inject: h,
    // lifecycle
    created: a,
    beforeMount: p,
    mounted: S,
    beforeUpdate: T,
    updated: D,
    activated: F,
    deactivated: z,
    beforeDestroy: L,
    beforeUnmount: B,
    destroyed: q,
    unmounted: O,
    render: J,
    renderTracked: Re,
    renderTriggered: ae,
    errorCaptured: Ie,
    serverPrefetch: Tt,
    // public API
    expose: Ne,
    inheritAttrs: tt,
    // assets
    components: Et,
    directives: Ct,
    filters: Xt
  } = t;
  if (h && Ir(h, n, null), o)
    for (const V in o) {
      const $ = o[V];
      R($) && (n[V] = $.bind(s));
    }
  if (i) {
    const V = i.call(s, s);
    G(V) && (e.data = Ms(V));
  }
  if (gs = !0, r)
    for (const V in r) {
      const $ = r[V], Le = R($) ? $.bind(s, s) : R($.get) ? $.get.bind(s, s) : xe, Ot = !R($) && R($.set) ? $.set.bind(s) : xe, $e = yo({
        get: Le,
        set: Ot
      });
      Object.defineProperty(n, V, {
        enumerable: !0,
        configurable: !0,
        get: () => $e.value,
        set: (de) => $e.value = de
      });
    }
  if (c)
    for (const V in c)
      Xn(c[V], n, s, V);
  if (u) {
    const V = R(u) ? u.call(s) : u;
    Reflect.ownKeys(V).forEach(($) => {
      Nr($, V[$]);
    });
  }
  a && ks(a, e, "c");
  function Z(V, $) {
    P($) ? $.forEach((Le) => V(Le.bind(s))) : $ && V($.bind(s));
  }
  if (Z(vr, p), Z(xr, S), Z(yr, T), Z(wr, D), Z(mr, F), Z(_r, z), Z(Or, Ie), Z(Cr, Re), Z(Er, ae), Z(Sr, B), Z(zn, O), Z(Tr, Tt), P(Ne))
    if (Ne.length) {
      const V = e.exposed || (e.exposed = {});
      Ne.forEach(($) => {
        Object.defineProperty(V, $, {
          get: () => s[$],
          set: (Le) => s[$] = Le,
          enumerable: !0
        });
      });
    } else e.exposed || (e.exposed = {});
  J && e.render === xe && (e.render = J), tt != null && (e.inheritAttrs = tt), Et && (e.components = Et), Ct && (e.directives = Ct), Tt && Gn(e);
}
function Ir(e, t, s = xe) {
  P(e) && (e = ms(e));
  for (const n in e) {
    const i = e[n];
    let r;
    G(i) ? "default" in i ? r = Ft(
      i.from || n,
      i.default,
      !0
    ) : r = Ft(i.from || n) : r = Ft(i), te(r) ? Object.defineProperty(t, n, {
      enumerable: !0,
      configurable: !0,
      get: () => r.value,
      set: (o) => r.value = o
    }) : t[n] = r;
  }
}
function ks(e, t, s) {
  we(
    P(e) ? e.map((n) => n.bind(t.proxy)) : e.bind(t.proxy),
    t,
    s
  );
}
function Xn(e, t, s, n) {
  let i = n.includes(".") ? ui(s, n) : () => s[n];
  if (Y(e)) {
    const r = t[e];
    R(r) && rs(i, r);
  } else if (R(e))
    rs(i, e.bind(s));
  else if (G(e))
    if (P(e))
      e.forEach((r) => Xn(r, t, s, n));
    else {
      const r = R(e.handler) ? e.handler.bind(s) : t[e.handler];
      R(r) && rs(i, r, e);
    }
}
function Zn(e) {
  const t = e.type, { mixins: s, extends: n } = t, {
    mixins: i,
    optionsCache: r,
    config: { optionMergeStrategies: o }
  } = e.appContext, c = r.get(t);
  let u;
  return c ? u = c : !i.length && !s && !n ? u = t : (u = {}, i.length && i.forEach(
    (h) => Kt(u, h, o, !0)
  ), Kt(u, t, o)), G(t) && r.set(t, u), u;
}
function Kt(e, t, s, n = !1) {
  const { mixins: i, extends: r } = t;
  r && Kt(e, r, s, !0), i && i.forEach(
    (o) => Kt(e, o, s, !0)
  );
  for (const o in t)
    if (!(n && o === "expose")) {
      const c = Mr[o] || s && s[o];
      e[o] = c ? c(e[o], t[o]) : t[o];
    }
  return e;
}
const Mr = {
  data: Qs,
  props: en,
  emits: en,
  // objects
  methods: lt,
  computed: lt,
  // lifecycle
  beforeCreate: k,
  created: k,
  beforeMount: k,
  mounted: k,
  beforeUpdate: k,
  updated: k,
  beforeDestroy: k,
  beforeUnmount: k,
  destroyed: k,
  unmounted: k,
  activated: k,
  deactivated: k,
  errorCaptured: k,
  serverPrefetch: k,
  // assets
  components: lt,
  directives: lt,
  // watch
  watch: Dr,
  // provide / inject
  provide: Qs,
  inject: Fr
};
function Qs(e, t) {
  return t ? e ? function() {
    return se(
      R(e) ? e.call(this, this) : e,
      R(t) ? t.call(this, this) : t
    );
  } : t : e;
}
function Fr(e, t) {
  return lt(ms(e), ms(t));
}
function ms(e) {
  if (P(e)) {
    const t = {};
    for (let s = 0; s < e.length; s++)
      t[e[s]] = e[s];
    return t;
  }
  return e;
}
function k(e, t) {
  return e ? [...new Set([].concat(e, t))] : t;
}
function lt(e, t) {
  return e ? se(/* @__PURE__ */ Object.create(null), e, t) : t;
}
function en(e, t) {
  return e ? P(e) && P(t) ? [.../* @__PURE__ */ new Set([...e, ...t])] : se(
    /* @__PURE__ */ Object.create(null),
    Zs(e),
    Zs(t ?? {})
  ) : t;
}
function Dr(e, t) {
  if (!e) return t;
  if (!t) return e;
  const s = se(/* @__PURE__ */ Object.create(null), e);
  for (const n in t)
    s[n] = k(e[n], t[n]);
  return s;
}
function kn() {
  return {
    app: null,
    config: {
      isNativeTag: xi,
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
let Hr = 0;
function jr(e, t) {
  return function(n, i = null) {
    R(n) || (n = se({}, n)), i != null && !G(i) && (i = null);
    const r = kn(), o = /* @__PURE__ */ new WeakSet(), c = [];
    let u = !1;
    const h = r.app = {
      _uid: Hr++,
      _component: n,
      _props: i,
      _container: null,
      _context: r,
      _instance: null,
      version: wo,
      get config() {
        return r.config;
      },
      set config(a) {
      },
      use(a, ...p) {
        return o.has(a) || (a && R(a.install) ? (o.add(a), a.install(h, ...p)) : R(a) && (o.add(a), a(h, ...p))), h;
      },
      mixin(a) {
        return r.mixins.includes(a) || r.mixins.push(a), h;
      },
      component(a, p) {
        return p ? (r.components[a] = p, h) : r.components[a];
      },
      directive(a, p) {
        return p ? (r.directives[a] = p, h) : r.directives[a];
      },
      mount(a, p, S) {
        if (!u) {
          const T = h._ceVNode || He(n, i);
          return T.appContext = r, S === !0 ? S = "svg" : S === !1 && (S = void 0), e(T, a, S), u = !0, h._container = a, a.__vue_app__ = h, Ks(T.component);
        }
      },
      onUnmount(a) {
        c.push(a);
      },
      unmount() {
        u && (we(
          c,
          h._instance,
          16
        ), e(null, h._container), delete h._container.__vue_app__);
      },
      provide(a, p) {
        return r.provides[a] = p, h;
      },
      runWithContext(a) {
        const p = Xe;
        Xe = h;
        try {
          return a();
        } finally {
          Xe = p;
        }
      }
    };
    return h;
  };
}
let Xe = null;
function Nr(e, t) {
  if (ee) {
    let s = ee.provides;
    const n = ee.parent && ee.parent.provides;
    n === s && (s = ee.provides = Object.create(n)), s[e] = t;
  }
}
function Ft(e, t, s = !1) {
  const n = go();
  if (n || Xe) {
    let i = Xe ? Xe._context.provides : n ? n.parent == null || n.ce ? n.vnode.appContext && n.vnode.appContext.provides : n.parent.provides : void 0;
    if (i && e in i)
      return i[e];
    if (arguments.length > 1)
      return s && R(t) ? t.call(n && n.proxy) : t;
  }
}
const Qn = {}, ei = () => Object.create(Qn), ti = (e) => Object.getPrototypeOf(e) === Qn;
function Lr(e, t, s, n = !1) {
  const i = {}, r = ei();
  e.propsDefaults = /* @__PURE__ */ Object.create(null), si(e, t, i, r);
  for (const o in e.propsOptions[0])
    o in i || (i[o] = void 0);
  s ? e.props = n ? i : tr(i) : e.type.props ? e.props = i : e.props = r, e.attrs = r;
}
function $r(e, t, s, n) {
  const {
    props: i,
    attrs: r,
    vnode: { patchFlag: o }
  } = e, c = N(i), [u] = e.propsOptions;
  let h = !1;
  if (
    // always force full diff in dev
    // - #1942 if hmr is enabled with sfc component
    // - vite#872 non-sfc component used by sfc component
    (n || o > 0) && !(o & 16)
  ) {
    if (o & 8) {
      const a = e.vnode.dynamicProps;
      for (let p = 0; p < a.length; p++) {
        let S = a[p];
        if (Yt(e.emitsOptions, S))
          continue;
        const T = t[S];
        if (u)
          if (H(r, S))
            T !== r[S] && (r[S] = T, h = !0);
          else {
            const D = je(S);
            i[D] = _s(
              u,
              c,
              D,
              T,
              e,
              !1
            );
          }
        else
          T !== r[S] && (r[S] = T, h = !0);
      }
    }
  } else {
    si(e, t, i, r) && (h = !0);
    let a;
    for (const p in c)
      (!t || // for camelCase
      !H(t, p) && // it's possible the original props was passed in as kebab-case
      // and converted to camelCase (#955)
      ((a = qe(p)) === p || !H(t, a))) && (u ? s && // for camelCase
      (s[p] !== void 0 || // for kebab-case
      s[a] !== void 0) && (i[p] = _s(
        u,
        c,
        p,
        void 0,
        e,
        !0
      )) : delete i[p]);
    if (r !== c)
      for (const p in r)
        (!t || !H(t, p)) && (delete r[p], h = !0);
  }
  h && Ce(e.attrs, "set", "");
}
function si(e, t, s, n) {
  const [i, r] = e.propsOptions;
  let o = !1, c;
  if (t)
    for (let u in t) {
      if (ft(u))
        continue;
      const h = t[u];
      let a;
      i && H(i, a = je(u)) ? !r || !r.includes(a) ? s[a] = h : (c || (c = {}))[a] = h : Yt(e.emitsOptions, u) || (!(u in n) || h !== n[u]) && (n[u] = h, o = !0);
    }
  if (r) {
    const u = N(s), h = c || U;
    for (let a = 0; a < r.length; a++) {
      const p = r[a];
      s[p] = _s(
        i,
        u,
        p,
        h[p],
        e,
        !H(h, p)
      );
    }
  }
  return o;
}
function _s(e, t, s, n, i, r) {
  const o = e[s];
  if (o != null) {
    const c = H(o, "default");
    if (c && n === void 0) {
      const u = o.default;
      if (o.type !== Function && !o.skipFactory && R(u)) {
        const { propsDefaults: h } = i;
        if (s in h)
          n = h[s];
        else {
          const a = St(i);
          n = h[s] = u.call(
            null,
            t
          ), a();
        }
      } else
        n = u;
      i.ce && i.ce._setProp(s, n);
    }
    o[
      0
      /* shouldCast */
    ] && (r && !c ? n = !1 : o[
      1
      /* shouldCastTrue */
    ] && (n === "" || n === qe(s)) && (n = !0));
  }
  return n;
}
const Kr = /* @__PURE__ */ new WeakMap();
function ni(e, t, s = !1) {
  const n = s ? Kr : t.propsCache, i = n.get(e);
  if (i)
    return i;
  const r = e.props, o = {}, c = [];
  let u = !1;
  if (!R(e)) {
    const a = (p) => {
      u = !0;
      const [S, T] = ni(p, t, !0);
      se(o, S), T && c.push(...T);
    };
    !s && t.mixins.length && t.mixins.forEach(a), e.extends && a(e.extends), e.mixins && e.mixins.forEach(a);
  }
  if (!r && !u)
    return G(e) && n.set(e, Ye), Ye;
  if (P(r))
    for (let a = 0; a < r.length; a++) {
      const p = je(r[a]);
      tn(p) && (o[p] = U);
    }
  else if (r)
    for (const a in r) {
      const p = je(a);
      if (tn(p)) {
        const S = r[a], T = o[p] = P(S) || R(S) ? { type: S } : se({}, S), D = T.type;
        let F = !1, z = !0;
        if (P(D))
          for (let L = 0; L < D.length; ++L) {
            const B = D[L], q = R(B) && B.name;
            if (q === "Boolean") {
              F = !0;
              break;
            } else q === "String" && (z = !1);
          }
        else
          F = R(D) && D.name === "Boolean";
        T[
          0
          /* shouldCast */
        ] = F, T[
          1
          /* shouldCastTrue */
        ] = z, (F || H(T, "default")) && c.push(p);
      }
    }
  const h = [o, c];
  return G(e) && n.set(e, h), h;
}
function tn(e) {
  return e[0] !== "$" && !ft(e);
}
const Ns = (e) => e === "_" || e === "__" || e === "_ctx" || e === "$stable", Ls = (e) => P(e) ? e.map(be) : [be(e)], Wr = (e, t, s) => {
  if (t._n)
    return t;
  const n = hr((...i) => Ls(t(...i)), s);
  return n._c = !1, n;
}, ii = (e, t, s) => {
  const n = e._ctx;
  for (const i in e) {
    if (Ns(i)) continue;
    const r = e[i];
    if (R(r))
      t[i] = Wr(i, r, n);
    else if (r != null) {
      const o = Ls(r);
      t[i] = () => o;
    }
  }
}, ri = (e, t) => {
  const s = Ls(t);
  e.slots.default = () => s;
}, oi = (e, t, s) => {
  for (const n in t)
    (s || !Ns(n)) && (e[n] = t[n]);
}, Ur = (e, t, s) => {
  const n = e.slots = ei();
  if (e.vnode.shapeFlag & 32) {
    const i = t.__;
    i && cs(n, "__", i, !0);
    const r = t._;
    r ? (oi(n, t, s), s && cs(n, "_", r, !0)) : ii(t, n);
  } else t && ri(e, t);
}, Vr = (e, t, s) => {
  const { vnode: n, slots: i } = e;
  let r = !0, o = U;
  if (n.shapeFlag & 32) {
    const c = t._;
    c ? s && c === 1 ? r = !1 : oi(i, t, s) : (r = !t.$stable, ii(t, i)), o = t;
  } else t && (ri(e, t), o = { default: 1 });
  if (r)
    for (const c in i)
      !Ns(c) && o[c] == null && delete i[c];
}, le = no;
function Br(e) {
  return qr(e);
}
function qr(e, t) {
  const s = qt();
  s.__VUE__ = !0;
  const {
    insert: n,
    remove: i,
    patchProp: r,
    createElement: o,
    createText: c,
    createComment: u,
    setText: h,
    setElementText: a,
    parentNode: p,
    nextSibling: S,
    setScopeId: T = xe,
    insertStaticContent: D
  } = e, F = (l, f, d, _ = null, g = null, m = null, y = void 0, x = null, v = !!f.dynamicChildren) => {
    if (l === f)
      return;
    l && !ot(l, f) && (_ = At(l), de(l, g, m, !0), l = null), f.patchFlag === -2 && (v = !1, f.dynamicChildren = null);
    const { type: b, ref: C, shapeFlag: w } = f;
    switch (b) {
      case zt:
        z(l, f, d, _);
        break;
      case ke:
        L(l, f, d, _);
        break;
      case Dt:
        l == null && B(f, d, _, y);
        break;
      case Ee:
        Et(
          l,
          f,
          d,
          _,
          g,
          m,
          y,
          x,
          v
        );
        break;
      default:
        w & 1 ? J(
          l,
          f,
          d,
          _,
          g,
          m,
          y,
          x,
          v
        ) : w & 6 ? Ct(
          l,
          f,
          d,
          _,
          g,
          m,
          y,
          x,
          v
        ) : (w & 64 || w & 128) && b.process(
          l,
          f,
          d,
          _,
          g,
          m,
          y,
          x,
          v,
          nt
        );
    }
    C != null && g ? ht(C, l && l.ref, m, f || l, !f) : C == null && l && l.ref != null && ht(l.ref, null, m, l, !0);
  }, z = (l, f, d, _) => {
    if (l == null)
      n(
        f.el = c(f.children),
        d,
        _
      );
    else {
      const g = f.el = l.el;
      f.children !== l.children && h(g, f.children);
    }
  }, L = (l, f, d, _) => {
    l == null ? n(
      f.el = u(f.children || ""),
      d,
      _
    ) : f.el = l.el;
  }, B = (l, f, d, _) => {
    [l.el, l.anchor] = D(
      l.children,
      f,
      d,
      _,
      l.el,
      l.anchor
    );
  }, q = ({ el: l, anchor: f }, d, _) => {
    let g;
    for (; l && l !== f; )
      g = S(l), n(l, d, _), l = g;
    n(f, d, _);
  }, O = ({ el: l, anchor: f }) => {
    let d;
    for (; l && l !== f; )
      d = S(l), i(l), l = d;
    i(f);
  }, J = (l, f, d, _, g, m, y, x, v) => {
    f.type === "svg" ? y = "svg" : f.type === "math" && (y = "mathml"), l == null ? Re(
      f,
      d,
      _,
      g,
      m,
      y,
      x,
      v
    ) : Tt(
      l,
      f,
      g,
      m,
      y,
      x,
      v
    );
  }, Re = (l, f, d, _, g, m, y, x) => {
    let v, b;
    const { props: C, shapeFlag: w, transition: E, dirs: A } = l;
    if (v = l.el = o(
      l.type,
      m,
      C && C.is,
      C
    ), w & 8 ? a(v, l.children) : w & 16 && Ie(
      l.children,
      v,
      null,
      _,
      g,
      is(l, m),
      y,
      x
    ), A && Ke(l, null, _, "created"), ae(v, l, l.scopeId, y, _), C) {
      for (const K in C)
        K !== "value" && !ft(K) && r(v, K, null, C[K], m, _);
      "value" in C && r(v, "value", null, C.value, m), (b = C.onVnodeBeforeMount) && me(b, _, l);
    }
    A && Ke(l, null, _, "beforeMount");
    const M = Gr(g, E);
    M && E.beforeEnter(v), n(v, f, d), ((b = C && C.onVnodeMounted) || M || A) && le(() => {
      b && me(b, _, l), M && E.enter(v), A && Ke(l, null, _, "mounted");
    }, g);
  }, ae = (l, f, d, _, g) => {
    if (d && T(l, d), _)
      for (let m = 0; m < _.length; m++)
        T(l, _[m]);
    if (g) {
      let m = g.subTree;
      if (f === m || di(m.type) && (m.ssContent === f || m.ssFallback === f)) {
        const y = g.vnode;
        ae(
          l,
          y,
          y.scopeId,
          y.slotScopeIds,
          g.parent
        );
      }
    }
  }, Ie = (l, f, d, _, g, m, y, x, v = 0) => {
    for (let b = v; b < l.length; b++) {
      const C = l[b] = x ? Fe(l[b]) : be(l[b]);
      F(
        null,
        C,
        f,
        d,
        _,
        g,
        m,
        y,
        x
      );
    }
  }, Tt = (l, f, d, _, g, m, y) => {
    const x = f.el = l.el;
    let { patchFlag: v, dynamicChildren: b, dirs: C } = f;
    v |= l.patchFlag & 16;
    const w = l.props || U, E = f.props || U;
    let A;
    if (d && We(d, !1), (A = E.onVnodeBeforeUpdate) && me(A, d, f, l), C && Ke(f, l, d, "beforeUpdate"), d && We(d, !0), (w.innerHTML && E.innerHTML == null || w.textContent && E.textContent == null) && a(x, ""), b ? Ne(
      l.dynamicChildren,
      b,
      x,
      d,
      _,
      is(f, g),
      m
    ) : y || $(
      l,
      f,
      x,
      null,
      d,
      _,
      is(f, g),
      m,
      !1
    ), v > 0) {
      if (v & 16)
        tt(x, w, E, d, g);
      else if (v & 2 && w.class !== E.class && r(x, "class", null, E.class, g), v & 4 && r(x, "style", w.style, E.style, g), v & 8) {
        const M = f.dynamicProps;
        for (let K = 0; K < M.length; K++) {
          const j = M[K], ne = w[j], ie = E[j];
          (ie !== ne || j === "value") && r(x, j, ne, ie, g, d);
        }
      }
      v & 1 && l.children !== f.children && a(x, f.children);
    } else !y && b == null && tt(x, w, E, d, g);
    ((A = E.onVnodeUpdated) || C) && le(() => {
      A && me(A, d, f, l), C && Ke(f, l, d, "updated");
    }, _);
  }, Ne = (l, f, d, _, g, m, y) => {
    for (let x = 0; x < f.length; x++) {
      const v = l[x], b = f[x], C = (
        // oldVNode may be an errored async setup() component inside Suspense
        // which will not have a mounted element
        v.el && // - In the case of a Fragment, we need to provide the actual parent
        // of the Fragment itself so it can move its children.
        (v.type === Ee || // - In the case of different nodes, there is going to be a replacement
        // which also requires the correct parent container
        !ot(v, b) || // - In the case of a component, it could contain anything.
        v.shapeFlag & 198) ? p(v.el) : (
          // In other cases, the parent container is not actually used so we
          // just pass the block element here to avoid a DOM parentNode call.
          d
        )
      );
      F(
        v,
        b,
        C,
        null,
        _,
        g,
        m,
        y,
        !0
      );
    }
  }, tt = (l, f, d, _, g) => {
    if (f !== d) {
      if (f !== U)
        for (const m in f)
          !ft(m) && !(m in d) && r(
            l,
            m,
            f[m],
            null,
            g,
            _
          );
      for (const m in d) {
        if (ft(m)) continue;
        const y = d[m], x = f[m];
        y !== x && m !== "value" && r(l, m, x, y, g, _);
      }
      "value" in d && r(l, "value", f.value, d.value, g);
    }
  }, Et = (l, f, d, _, g, m, y, x, v) => {
    const b = f.el = l ? l.el : c(""), C = f.anchor = l ? l.anchor : c("");
    let { patchFlag: w, dynamicChildren: E, slotScopeIds: A } = f;
    A && (x = x ? x.concat(A) : A), l == null ? (n(b, d, _), n(C, d, _), Ie(
      // #10007
      // such fragment like `<></>` will be compiled into
      // a fragment which doesn't have a children.
      // In this case fallback to an empty array
      f.children || [],
      d,
      C,
      g,
      m,
      y,
      x,
      v
    )) : w > 0 && w & 64 && E && // #2715 the previous fragment could've been a BAILed one as a result
    // of renderSlot() with no valid children
    l.dynamicChildren ? (Ne(
      l.dynamicChildren,
      E,
      d,
      g,
      m,
      y,
      x
    ), // #2080 if the stable fragment has a key, it's a <template v-for> that may
    //  get moved around. Make sure all root level vnodes inherit el.
    // #2134 or if it's a component root, it may also get moved around
    // as the component is being moved.
    (f.key != null || g && f === g.subTree) && li(
      l,
      f,
      !0
      /* shallow */
    )) : $(
      l,
      f,
      d,
      C,
      g,
      m,
      y,
      x,
      v
    );
  }, Ct = (l, f, d, _, g, m, y, x, v) => {
    f.slotScopeIds = x, l == null ? f.shapeFlag & 512 ? g.ctx.activate(
      f,
      d,
      _,
      y,
      v
    ) : Xt(
      f,
      d,
      _,
      g,
      m,
      y,
      v
    ) : Ws(l, f, v);
  }, Xt = (l, f, d, _, g, m, y) => {
    const x = l.component = po(
      l,
      _,
      g
    );
    if (Jn(l) && (x.ctx.renderer = nt), mo(x, !1, y), x.asyncDep) {
      if (g && g.registerDep(x, Z, y), !l.el) {
        const v = x.subTree = He(ke);
        L(null, v, f, d), l.placeholder = v.el;
      }
    } else
      Z(
        x,
        l,
        f,
        d,
        g,
        m,
        y
      );
  }, Ws = (l, f, d) => {
    const _ = f.component = l.component;
    if (to(l, f, d))
      if (_.asyncDep && !_.asyncResolved) {
        V(_, f, d);
        return;
      } else
        _.next = f, _.update();
    else
      f.el = l.el, _.vnode = f;
  }, Z = (l, f, d, _, g, m, y) => {
    const x = () => {
      if (l.isMounted) {
        let { next: w, bu: E, u: A, parent: M, vnode: K } = l;
        {
          const pe = ci(l);
          if (pe) {
            w && (w.el = K.el, V(l, w, y)), pe.asyncDep.then(() => {
              l.isUnmounted || x();
            });
            return;
          }
        }
        let j = w, ne;
        We(l, !1), w ? (w.el = K.el, V(l, w, y)) : w = K, E && Qt(E), (ne = w.props && w.props.onVnodeBeforeUpdate) && me(ne, M, w, K), We(l, !0);
        const ie = nn(l), he = l.subTree;
        l.subTree = ie, F(
          he,
          ie,
          // parent may have changed if it's in a teleport
          p(he.el),
          // anchor may have changed if it's in a fragment
          At(he),
          l,
          g,
          m
        ), w.el = ie.el, j === null && so(l, ie.el), A && le(A, g), (ne = w.props && w.props.onVnodeUpdated) && le(
          () => me(ne, M, w, K),
          g
        );
      } else {
        let w;
        const { el: E, props: A } = f, { bm: M, m: K, parent: j, root: ne, type: ie } = l, he = pt(f);
        We(l, !1), M && Qt(M), !he && (w = A && A.onVnodeBeforeMount) && me(w, j, f), We(l, !0);
        {
          ne.ce && // @ts-expect-error _def is private
          ne.ce._def.shadowRoot !== !1 && ne.ce._injectChildStyle(ie);
          const pe = l.subTree = nn(l);
          F(
            null,
            pe,
            d,
            _,
            l,
            g,
            m
          ), f.el = pe.el;
        }
        if (K && le(K, g), !he && (w = A && A.onVnodeMounted)) {
          const pe = f;
          le(
            () => me(w, j, pe),
            g
          );
        }
        (f.shapeFlag & 256 || j && pt(j.vnode) && j.vnode.shapeFlag & 256) && l.a && le(l.a, g), l.isMounted = !0, f = d = _ = null;
      }
    };
    l.scope.on();
    const v = l.effect = new Tn(x);
    l.scope.off();
    const b = l.update = v.run.bind(v), C = l.job = v.runIfDirty.bind(v);
    C.i = l, C.id = l.uid, v.scheduler = () => Hs(C), We(l, !0), b();
  }, V = (l, f, d) => {
    f.component = l;
    const _ = l.vnode.props;
    l.vnode = f, l.next = null, $r(l, f.props, _, d), Vr(l, f.children, d), Oe(), Xs(l), Ae();
  }, $ = (l, f, d, _, g, m, y, x, v = !1) => {
    const b = l && l.children, C = l ? l.shapeFlag : 0, w = f.children, { patchFlag: E, shapeFlag: A } = f;
    if (E > 0) {
      if (E & 128) {
        Ot(
          b,
          w,
          d,
          _,
          g,
          m,
          y,
          x,
          v
        );
        return;
      } else if (E & 256) {
        Le(
          b,
          w,
          d,
          _,
          g,
          m,
          y,
          x,
          v
        );
        return;
      }
    }
    A & 8 ? (C & 16 && st(b, g, m), w !== b && a(d, w)) : C & 16 ? A & 16 ? Ot(
      b,
      w,
      d,
      _,
      g,
      m,
      y,
      x,
      v
    ) : st(b, g, m, !0) : (C & 8 && a(d, ""), A & 16 && Ie(
      w,
      d,
      _,
      g,
      m,
      y,
      x,
      v
    ));
  }, Le = (l, f, d, _, g, m, y, x, v) => {
    l = l || Ye, f = f || Ye;
    const b = l.length, C = f.length, w = Math.min(b, C);
    let E;
    for (E = 0; E < w; E++) {
      const A = f[E] = v ? Fe(f[E]) : be(f[E]);
      F(
        l[E],
        A,
        d,
        null,
        g,
        m,
        y,
        x,
        v
      );
    }
    b > C ? st(
      l,
      g,
      m,
      !0,
      !1,
      w
    ) : Ie(
      f,
      d,
      _,
      g,
      m,
      y,
      x,
      v,
      w
    );
  }, Ot = (l, f, d, _, g, m, y, x, v) => {
    let b = 0;
    const C = f.length;
    let w = l.length - 1, E = C - 1;
    for (; b <= w && b <= E; ) {
      const A = l[b], M = f[b] = v ? Fe(f[b]) : be(f[b]);
      if (ot(A, M))
        F(
          A,
          M,
          d,
          null,
          g,
          m,
          y,
          x,
          v
        );
      else
        break;
      b++;
    }
    for (; b <= w && b <= E; ) {
      const A = l[w], M = f[E] = v ? Fe(f[E]) : be(f[E]);
      if (ot(A, M))
        F(
          A,
          M,
          d,
          null,
          g,
          m,
          y,
          x,
          v
        );
      else
        break;
      w--, E--;
    }
    if (b > w) {
      if (b <= E) {
        const A = E + 1, M = A < C ? f[A].el : _;
        for (; b <= E; )
          F(
            null,
            f[b] = v ? Fe(f[b]) : be(f[b]),
            d,
            M,
            g,
            m,
            y,
            x,
            v
          ), b++;
      }
    } else if (b > E)
      for (; b <= w; )
        de(l[b], g, m, !0), b++;
    else {
      const A = b, M = b, K = /* @__PURE__ */ new Map();
      for (b = M; b <= E; b++) {
        const oe = f[b] = v ? Fe(f[b]) : be(f[b]);
        oe.key != null && K.set(oe.key, b);
      }
      let j, ne = 0;
      const ie = E - M + 1;
      let he = !1, pe = 0;
      const it = new Array(ie);
      for (b = 0; b < ie; b++) it[b] = 0;
      for (b = A; b <= w; b++) {
        const oe = l[b];
        if (ne >= ie) {
          de(oe, g, m, !0);
          continue;
        }
        let ge;
        if (oe.key != null)
          ge = K.get(oe.key);
        else
          for (j = M; j <= E; j++)
            if (it[j - M] === 0 && ot(oe, f[j])) {
              ge = j;
              break;
            }
        ge === void 0 ? de(oe, g, m, !0) : (it[ge - M] = b + 1, ge >= pe ? pe = ge : he = !0, F(
          oe,
          f[ge],
          d,
          null,
          g,
          m,
          y,
          x,
          v
        ), ne++);
      }
      const Bs = he ? Jr(it) : Ye;
      for (j = Bs.length - 1, b = ie - 1; b >= 0; b--) {
        const oe = M + b, ge = f[oe], qs = f[oe + 1], Gs = oe + 1 < C ? (
          // #13559, fallback to el placeholder for unresolved async component
          qs.el || qs.placeholder
        ) : _;
        it[b] === 0 ? F(
          null,
          ge,
          d,
          Gs,
          g,
          m,
          y,
          x,
          v
        ) : he && (j < 0 || b !== Bs[j] ? $e(ge, d, Gs, 2) : j--);
      }
    }
  }, $e = (l, f, d, _, g = null) => {
    const { el: m, type: y, transition: x, children: v, shapeFlag: b } = l;
    if (b & 6) {
      $e(l.component.subTree, f, d, _);
      return;
    }
    if (b & 128) {
      l.suspense.move(f, d, _);
      return;
    }
    if (b & 64) {
      y.move(l, f, d, nt);
      return;
    }
    if (y === Ee) {
      n(m, f, d);
      for (let w = 0; w < v.length; w++)
        $e(v[w], f, d, _);
      n(l.anchor, f, d);
      return;
    }
    if (y === Dt) {
      q(l, f, d);
      return;
    }
    if (_ !== 2 && b & 1 && x)
      if (_ === 0)
        x.beforeEnter(m), n(m, f, d), le(() => x.enter(m), g);
      else {
        const { leave: w, delayLeave: E, afterLeave: A } = x, M = () => {
          l.ctx.isUnmounted ? i(m) : n(m, f, d);
        }, K = () => {
          w(m, () => {
            M(), A && A();
          });
        };
        E ? E(m, M, K) : K();
      }
    else
      n(m, f, d);
  }, de = (l, f, d, _ = !1, g = !1) => {
    const {
      type: m,
      props: y,
      ref: x,
      children: v,
      dynamicChildren: b,
      shapeFlag: C,
      patchFlag: w,
      dirs: E,
      cacheIndex: A
    } = l;
    if (w === -2 && (g = !1), x != null && (Oe(), ht(x, null, d, l, !0), Ae()), A != null && (f.renderCache[A] = void 0), C & 256) {
      f.ctx.deactivate(l);
      return;
    }
    const M = C & 1 && E, K = !pt(l);
    let j;
    if (K && (j = y && y.onVnodeBeforeUnmount) && me(j, f, l), C & 6)
      vi(l.component, d, _);
    else {
      if (C & 128) {
        l.suspense.unmount(d, _);
        return;
      }
      M && Ke(l, null, f, "beforeUnmount"), C & 64 ? l.type.remove(
        l,
        f,
        d,
        nt,
        _
      ) : b && // #5154
      // when v-once is used inside a block, setBlockTracking(-1) marks the
      // parent block with hasOnce: true
      // so that it doesn't take the fast path during unmount - otherwise
      // components nested in v-once are never unmounted.
      !b.hasOnce && // #1153: fast path should not be taken for non-stable (v-for) fragments
      (m !== Ee || w > 0 && w & 64) ? st(
        b,
        f,
        d,
        !1,
        !0
      ) : (m === Ee && w & 384 || !g && C & 16) && st(v, f, d), _ && Us(l);
    }
    (K && (j = y && y.onVnodeUnmounted) || M) && le(() => {
      j && me(j, f, l), M && Ke(l, null, f, "unmounted");
    }, d);
  }, Us = (l) => {
    const { type: f, el: d, anchor: _, transition: g } = l;
    if (f === Ee) {
      bi(d, _);
      return;
    }
    if (f === Dt) {
      O(l);
      return;
    }
    const m = () => {
      i(d), g && !g.persisted && g.afterLeave && g.afterLeave();
    };
    if (l.shapeFlag & 1 && g && !g.persisted) {
      const { leave: y, delayLeave: x } = g, v = () => y(d, m);
      x ? x(l.el, m, v) : v();
    } else
      m();
  }, bi = (l, f) => {
    let d;
    for (; l !== f; )
      d = S(l), i(l), l = d;
    i(f);
  }, vi = (l, f, d) => {
    const {
      bum: _,
      scope: g,
      job: m,
      subTree: y,
      um: x,
      m: v,
      a: b,
      parent: C,
      slots: { __: w }
    } = l;
    sn(v), sn(b), _ && Qt(_), C && P(w) && w.forEach((E) => {
      C.renderCache[E] = void 0;
    }), g.stop(), m && (m.flags |= 8, de(y, l, f, d)), x && le(x, f), le(() => {
      l.isUnmounted = !0;
    }, f), f && f.pendingBranch && !f.isUnmounted && l.asyncDep && !l.asyncResolved && l.suspenseId === f.pendingId && (f.deps--, f.deps === 0 && f.resolve());
  }, st = (l, f, d, _ = !1, g = !1, m = 0) => {
    for (let y = m; y < l.length; y++)
      de(l[y], f, d, _, g);
  }, At = (l) => {
    if (l.shapeFlag & 6)
      return At(l.component.subTree);
    if (l.shapeFlag & 128)
      return l.suspense.next();
    const f = S(l.anchor || l.el), d = f && f[pr];
    return d ? S(d) : f;
  };
  let Zt = !1;
  const Vs = (l, f, d) => {
    l == null ? f._vnode && de(f._vnode, null, null, !0) : F(
      f._vnode || null,
      l,
      f,
      null,
      null,
      null,
      d
    ), f._vnode = l, Zt || (Zt = !0, Xs(), Vn(), Zt = !1);
  }, nt = {
    p: F,
    um: de,
    m: $e,
    r: Us,
    mt: Xt,
    mc: Ie,
    pc: $,
    pbc: Ne,
    n: At,
    o: e
  };
  return {
    render: Vs,
    hydrate: void 0,
    createApp: jr(Vs)
  };
}
function is({ type: e, props: t }, s) {
  return s === "svg" && e === "foreignObject" || s === "mathml" && e === "annotation-xml" && t && t.encoding && t.encoding.includes("html") ? void 0 : s;
}
function We({ effect: e, job: t }, s) {
  s ? (e.flags |= 32, t.flags |= 4) : (e.flags &= -33, t.flags &= -5);
}
function Gr(e, t) {
  return (!e || e && !e.pendingBranch) && t && !t.persisted;
}
function li(e, t, s = !1) {
  const n = e.children, i = t.children;
  if (P(n) && P(i))
    for (let r = 0; r < n.length; r++) {
      const o = n[r];
      let c = i[r];
      c.shapeFlag & 1 && !c.dynamicChildren && ((c.patchFlag <= 0 || c.patchFlag === 32) && (c = i[r] = Fe(i[r]), c.el = o.el), !s && c.patchFlag !== -2 && li(o, c)), c.type === zt && (c.el = o.el), c.type === ke && !c.el && (c.el = o.el);
    }
}
function Jr(e) {
  const t = e.slice(), s = [0];
  let n, i, r, o, c;
  const u = e.length;
  for (n = 0; n < u; n++) {
    const h = e[n];
    if (h !== 0) {
      if (i = s[s.length - 1], e[i] < h) {
        t[n] = i, s.push(n);
        continue;
      }
      for (r = 0, o = s.length - 1; r < o; )
        c = r + o >> 1, e[s[c]] < h ? r = c + 1 : o = c;
      h < e[s[r]] && (r > 0 && (t[n] = s[r - 1]), s[r] = n);
    }
  }
  for (r = s.length, o = s[r - 1]; r-- > 0; )
    s[r] = o, o = t[o];
  return s;
}
function ci(e) {
  const t = e.subTree.component;
  if (t)
    return t.asyncDep && !t.asyncResolved ? t : ci(t);
}
function sn(e) {
  if (e)
    for (let t = 0; t < e.length; t++)
      e[t].flags |= 8;
}
const Yr = Symbol.for("v-scx"), zr = () => Ft(Yr);
function rs(e, t, s) {
  return fi(e, t, s);
}
function fi(e, t, s = U) {
  const { immediate: n, deep: i, flush: r, once: o } = s, c = se({}, s), u = t && n || !t && r !== "post";
  let h;
  if (yt) {
    if (r === "sync") {
      const T = zr();
      h = T.__watcherHandles || (T.__watcherHandles = []);
    } else if (!u) {
      const T = () => {
      };
      return T.stop = xe, T.resume = xe, T.pause = xe, T;
    }
  }
  const a = ee;
  c.call = (T, D, F) => we(T, a, D, F);
  let p = !1;
  r === "post" ? c.scheduler = (T) => {
    le(T, a && a.suspense);
  } : r !== "sync" && (p = !0, c.scheduler = (T, D) => {
    D ? T() : Hs(T);
  }), c.augmentJob = (T) => {
    t && (T.flags |= 4), p && (T.flags |= 2, a && (T.id = a.uid, T.i = a));
  };
  const S = cr(e, t, c);
  return yt && (h ? h.push(S) : u && S()), S;
}
function Xr(e, t, s) {
  const n = this.proxy, i = Y(e) ? e.includes(".") ? ui(n, e) : () => n[e] : e.bind(n, n);
  let r;
  R(t) ? r = t : (r = t.handler, s = t);
  const o = St(this), c = fi(i, r.bind(n), s);
  return o(), c;
}
function ui(e, t) {
  const s = t.split(".");
  return () => {
    let n = e;
    for (let i = 0; i < s.length && n; i++)
      n = n[s[i]];
    return n;
  };
}
const Zr = (e, t) => t === "modelValue" || t === "model-value" ? e.modelModifiers : e[`${t}Modifiers`] || e[`${je(t)}Modifiers`] || e[`${qe(t)}Modifiers`];
function kr(e, t, ...s) {
  if (e.isUnmounted) return;
  const n = e.vnode.props || U;
  let i = s;
  const r = t.startsWith("update:"), o = r && Zr(n, t.slice(7));
  o && (o.trim && (i = s.map((a) => Y(a) ? a.trim() : a)), o.number && (i = s.map(Ai)));
  let c, u = n[c = kt(t)] || // also try camelCase event handler (#2249)
  n[c = kt(je(t))];
  !u && r && (u = n[c = kt(qe(t))]), u && we(
    u,
    e,
    6,
    i
  );
  const h = n[c + "Once"];
  if (h) {
    if (!e.emitted)
      e.emitted = {};
    else if (e.emitted[c])
      return;
    e.emitted[c] = !0, we(
      h,
      e,
      6,
      i
    );
  }
}
function ai(e, t, s = !1) {
  const n = t.emitsCache, i = n.get(e);
  if (i !== void 0)
    return i;
  const r = e.emits;
  let o = {}, c = !1;
  if (!R(e)) {
    const u = (h) => {
      const a = ai(h, t, !0);
      a && (c = !0, se(o, a));
    };
    !s && t.mixins.length && t.mixins.forEach(u), e.extends && u(e.extends), e.mixins && e.mixins.forEach(u);
  }
  return !r && !c ? (G(e) && n.set(e, null), null) : (P(r) ? r.forEach((u) => o[u] = null) : se(o, r), G(e) && n.set(e, o), o);
}
function Yt(e, t) {
  return !e || !Ut(t) ? !1 : (t = t.slice(2).replace(/Once$/, ""), H(e, t[0].toLowerCase() + t.slice(1)) || H(e, qe(t)) || H(e, t));
}
function nn(e) {
  const {
    type: t,
    vnode: s,
    proxy: n,
    withProxy: i,
    propsOptions: [r],
    slots: o,
    attrs: c,
    emit: u,
    render: h,
    renderCache: a,
    props: p,
    data: S,
    setupState: T,
    ctx: D,
    inheritAttrs: F
  } = e, z = $t(e);
  let L, B;
  try {
    if (s.shapeFlag & 4) {
      const O = i || n, J = O;
      L = be(
        h.call(
          J,
          O,
          a,
          p,
          T,
          S,
          D
        )
      ), B = c;
    } else {
      const O = t;
      L = be(
        O.length > 1 ? O(
          p,
          { attrs: c, slots: o, emit: u }
        ) : O(
          p,
          null
        )
      ), B = t.props ? c : Qr(c);
    }
  } catch (O) {
    mt.length = 0, Gt(O, e, 1), L = He(ke);
  }
  let q = L;
  if (B && F !== !1) {
    const O = Object.keys(B), { shapeFlag: J } = q;
    O.length && J & 7 && (r && O.some(ws) && (B = eo(
      B,
      r
    )), q = Qe(q, B, !1, !0));
  }
  return s.dirs && (q = Qe(q, null, !1, !0), q.dirs = q.dirs ? q.dirs.concat(s.dirs) : s.dirs), s.transition && js(q, s.transition), L = q, $t(z), L;
}
const Qr = (e) => {
  let t;
  for (const s in e)
    (s === "class" || s === "style" || Ut(s)) && ((t || (t = {}))[s] = e[s]);
  return t;
}, eo = (e, t) => {
  const s = {};
  for (const n in e)
    (!ws(n) || !(n.slice(9) in t)) && (s[n] = e[n]);
  return s;
};
function to(e, t, s) {
  const { props: n, children: i, component: r } = e, { props: o, children: c, patchFlag: u } = t, h = r.emitsOptions;
  if (t.dirs || t.transition)
    return !0;
  if (s && u >= 0) {
    if (u & 1024)
      return !0;
    if (u & 16)
      return n ? rn(n, o, h) : !!o;
    if (u & 8) {
      const a = t.dynamicProps;
      for (let p = 0; p < a.length; p++) {
        const S = a[p];
        if (o[S] !== n[S] && !Yt(h, S))
          return !0;
      }
    }
  } else
    return (i || c) && (!c || !c.$stable) ? !0 : n === o ? !1 : n ? o ? rn(n, o, h) : !0 : !!o;
  return !1;
}
function rn(e, t, s) {
  const n = Object.keys(t);
  if (n.length !== Object.keys(e).length)
    return !0;
  for (let i = 0; i < n.length; i++) {
    const r = n[i];
    if (t[r] !== e[r] && !Yt(s, r))
      return !0;
  }
  return !1;
}
function so({ vnode: e, parent: t }, s) {
  for (; t; ) {
    const n = t.subTree;
    if (n.suspense && n.suspense.activeBranch === e && (n.el = e.el), n === e)
      (e = t.vnode).el = s, t = t.parent;
    else
      break;
  }
}
const di = (e) => e.__isSuspense;
function no(e, t) {
  t && t.pendingBranch ? P(e) ? t.effects.push(...e) : t.effects.push(e) : dr(e);
}
const Ee = Symbol.for("v-fgt"), zt = Symbol.for("v-txt"), ke = Symbol.for("v-cmt"), Dt = Symbol.for("v-stc"), mt = [];
let fe = null;
function io(e = !1) {
  mt.push(fe = e ? null : []);
}
function ro() {
  mt.pop(), fe = mt[mt.length - 1] || null;
}
let xt = 1;
function on(e, t = !1) {
  xt += e, e < 0 && fe && t && (fe.hasOnce = !0);
}
function oo(e) {
  return e.dynamicChildren = xt > 0 ? fe || Ye : null, ro(), xt > 0 && fe && fe.push(e), e;
}
function lo(e, t, s, n, i, r) {
  return oo(
    I(
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
function hi(e) {
  return e ? e.__v_isVNode === !0 : !1;
}
function ot(e, t) {
  return e.type === t.type && e.key === t.key;
}
const pi = ({ key: e }) => e ?? null, Ht = ({
  ref: e,
  ref_key: t,
  ref_for: s
}) => (typeof e == "number" && (e = "" + e), e != null ? Y(e) || te(e) || R(e) ? { i: ve, r: e, k: t, f: !!s } : e : null);
function I(e, t = null, s = null, n = 0, i = null, r = e === Ee ? 0 : 1, o = !1, c = !1) {
  const u = {
    __v_isVNode: !0,
    __v_skip: !0,
    type: e,
    props: t,
    key: t && pi(t),
    ref: t && Ht(t),
    scopeId: qn,
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
    ctx: ve
  };
  return c ? ($s(u, s), r & 128 && e.normalize(u)) : s && (u.shapeFlag |= Y(s) ? 8 : 16), xt > 0 && // avoid a block node from tracking itself
  !o && // has current parent block
  fe && // presence of a patch flag indicates this node needs patching on updates.
  // component nodes also should always be patched, because even if the
  // component doesn't need to update, it needs to persist the instance on to
  // the next vnode so that it can be properly unmounted later.
  (u.patchFlag > 0 || r & 6) && // the EVENTS flag is only for hydration and if it is the only flag, the
  // vnode should not be considered dynamic due to handler caching.
  u.patchFlag !== 32 && fe.push(u), u;
}
const He = co;
function co(e, t = null, s = null, n = 0, i = null, r = !1) {
  if ((!e || e === Ar) && (e = ke), hi(e)) {
    const c = Qe(
      e,
      t,
      !0
      /* mergeRef: true */
    );
    return s && $s(c, s), xt > 0 && !r && fe && (c.shapeFlag & 6 ? fe[fe.indexOf(e)] = c : fe.push(c)), c.patchFlag = -2, c;
  }
  if (xo(e) && (e = e.__vccOpts), t) {
    t = fo(t);
    let { class: c, style: u } = t;
    c && !Y(c) && (t.class = Cs(c)), G(u) && (Ds(u) && !P(u) && (u = se({}, u)), t.style = Es(u));
  }
  const o = Y(e) ? 1 : di(e) ? 128 : gr(e) ? 64 : G(e) ? 4 : R(e) ? 2 : 0;
  return I(
    e,
    t,
    s,
    n,
    i,
    o,
    r,
    !0
  );
}
function fo(e) {
  return e ? Ds(e) || ti(e) ? se({}, e) : e : null;
}
function Qe(e, t, s = !1, n = !1) {
  const { props: i, ref: r, patchFlag: o, children: c, transition: u } = e, h = t ? uo(i || {}, t) : i, a = {
    __v_isVNode: !0,
    __v_skip: !0,
    type: e.type,
    props: h,
    key: h && pi(h),
    ref: t && t.ref ? (
      // #2078 in the case of <component :is="vnode" ref="extra"/>
      // if the vnode itself already has a ref, cloneVNode will need to merge
      // the refs so the single vnode can be set on multiple refs
      s && r ? P(r) ? r.concat(Ht(t)) : [r, Ht(t)] : Ht(t)
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
    patchFlag: t && e.type !== Ee ? o === -1 ? 16 : o | 16 : o,
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
    ssContent: e.ssContent && Qe(e.ssContent),
    ssFallback: e.ssFallback && Qe(e.ssFallback),
    placeholder: e.placeholder,
    el: e.el,
    anchor: e.anchor,
    ctx: e.ctx,
    ce: e.ce
  };
  return u && n && js(
    a,
    u.clone(a)
  ), a;
}
function bs(e = " ", t = 0) {
  return He(zt, null, e, t);
}
function Mt(e, t) {
  const s = He(Dt, null, e);
  return s.staticCount = t, s;
}
function be(e) {
  return e == null || typeof e == "boolean" ? He(ke) : P(e) ? He(
    Ee,
    null,
    // #3666, avoid reference pollution when reusing vnode
    e.slice()
  ) : hi(e) ? Fe(e) : He(zt, null, String(e));
}
function Fe(e) {
  return e.el === null && e.patchFlag !== -1 || e.memo ? e : Qe(e);
}
function $s(e, t) {
  let s = 0;
  const { shapeFlag: n } = e;
  if (t == null)
    t = null;
  else if (P(t))
    s = 16;
  else if (typeof t == "object")
    if (n & 65) {
      const i = t.default;
      i && (i._c && (i._d = !1), $s(e, i()), i._c && (i._d = !0));
      return;
    } else {
      s = 32;
      const i = t._;
      !i && !ti(t) ? t._ctx = ve : i === 3 && ve && (ve.slots._ === 1 ? t._ = 1 : (t._ = 2, e.patchFlag |= 1024));
    }
  else R(t) ? (t = { default: t, _ctx: ve }, s = 32) : (t = String(t), n & 64 ? (s = 16, t = [bs(t)]) : s = 8);
  e.children = t, e.shapeFlag |= s;
}
function uo(...e) {
  const t = {};
  for (let s = 0; s < e.length; s++) {
    const n = e[s];
    for (const i in n)
      if (i === "class")
        t.class !== n.class && (t.class = Cs([t.class, n.class]));
      else if (i === "style")
        t.style = Es([t.style, n.style]);
      else if (Ut(i)) {
        const r = t[i], o = n[i];
        o && r !== o && !(P(r) && r.includes(o)) && (t[i] = r ? [].concat(r, o) : o);
      } else i !== "" && (t[i] = n[i]);
  }
  return t;
}
function me(e, t, s, n = null) {
  we(e, t, 7, [
    s,
    n
  ]);
}
const ao = kn();
let ho = 0;
function po(e, t, s) {
  const n = e.type, i = (t ? t.appContext : e.appContext) || ao, r = {
    uid: ho++,
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
    scope: new Hi(
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
    propsOptions: ni(n, i),
    emitsOptions: ai(n, i),
    // emit
    emit: null,
    // to be set immediately
    emitted: null,
    // props default value
    propsDefaults: U,
    // inheritAttrs
    inheritAttrs: n.inheritAttrs,
    // state
    ctx: U,
    data: U,
    props: U,
    attrs: U,
    slots: U,
    refs: U,
    setupState: U,
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
  return r.ctx = { _: r }, r.root = t ? t.root : r, r.emit = kr.bind(null, r), e.ce && e.ce(r), r;
}
let ee = null;
const go = () => ee || ve;
let Wt, vs;
{
  const e = qt(), t = (s, n) => {
    let i;
    return (i = e[s]) || (i = e[s] = []), i.push(n), (r) => {
      i.length > 1 ? i.forEach((o) => o(r)) : i[0](r);
    };
  };
  Wt = t(
    "__VUE_INSTANCE_SETTERS__",
    (s) => ee = s
  ), vs = t(
    "__VUE_SSR_SETTERS__",
    (s) => yt = s
  );
}
const St = (e) => {
  const t = ee;
  return Wt(e), e.scope.on(), () => {
    e.scope.off(), Wt(t);
  };
}, ln = () => {
  ee && ee.scope.off(), Wt(null);
};
function gi(e) {
  return e.vnode.shapeFlag & 4;
}
let yt = !1;
function mo(e, t = !1, s = !1) {
  t && vs(t);
  const { props: n, children: i } = e.vnode, r = gi(e);
  Lr(e, n, r, t), Ur(e, i, s || t);
  const o = r ? _o(e, t) : void 0;
  return t && vs(!1), o;
}
function _o(e, t) {
  const s = e.type;
  e.accessCache = /* @__PURE__ */ Object.create(null), e.proxy = new Proxy(e.ctx, Pr);
  const { setup: n } = s;
  if (n) {
    Oe();
    const i = e.setupContext = n.length > 1 ? vo(e) : null, r = St(e), o = wt(
      n,
      e,
      0,
      [
        e.props,
        i
      ]
    ), c = yn(o);
    if (Ae(), r(), (c || e.sp) && !pt(e) && Gn(e), c) {
      if (o.then(ln, ln), t)
        return o.then((u) => {
          cn(e, u);
        }).catch((u) => {
          Gt(u, e, 0);
        });
      e.asyncDep = o;
    } else
      cn(e, o);
  } else
    mi(e);
}
function cn(e, t, s) {
  R(t) ? e.type.__ssrInlineRender ? e.ssrRender = t : e.render = t : G(t) && (e.setupState = Kn(t)), mi(e);
}
function mi(e, t, s) {
  const n = e.type;
  e.render || (e.render = n.render || xe);
  {
    const i = St(e);
    Oe();
    try {
      Rr(e);
    } finally {
      Ae(), i();
    }
  }
}
const bo = {
  get(e, t) {
    return X(e, "get", ""), e[t];
  }
};
function vo(e) {
  const t = (s) => {
    e.exposed = s || {};
  };
  return {
    attrs: new Proxy(e.attrs, bo),
    slots: e.slots,
    emit: e.emit,
    expose: t
  };
}
function Ks(e) {
  return e.exposed ? e.exposeProxy || (e.exposeProxy = new Proxy(Kn(sr(e.exposed)), {
    get(t, s) {
      if (s in t)
        return t[s];
      if (s in gt)
        return gt[s](e);
    },
    has(t, s) {
      return s in t || s in gt;
    }
  })) : e.proxy;
}
function xo(e) {
  return R(e) && "__vccOpts" in e;
}
const yo = (e, t) => or(e, t, yt), wo = "3.5.18";
/**
* @vue/runtime-dom v3.5.18
* (c) 2018-present Yuxi (Evan) You and Vue contributors
* @license MIT
**/
let xs;
const fn = typeof window < "u" && window.trustedTypes;
if (fn)
  try {
    xs = /* @__PURE__ */ fn.createPolicy("vue", {
      createHTML: (e) => e
    });
  } catch {
  }
const _i = xs ? (e) => xs.createHTML(e) : (e) => e, So = "http://www.w3.org/2000/svg", To = "http://www.w3.org/1998/Math/MathML", Te = typeof document < "u" ? document : null, un = Te && /* @__PURE__ */ Te.createElement("template"), Eo = {
  insert: (e, t, s) => {
    t.insertBefore(e, s || null);
  },
  remove: (e) => {
    const t = e.parentNode;
    t && t.removeChild(e);
  },
  createElement: (e, t, s, n) => {
    const i = t === "svg" ? Te.createElementNS(So, e) : t === "mathml" ? Te.createElementNS(To, e) : s ? Te.createElement(e, { is: s }) : Te.createElement(e);
    return e === "select" && n && n.multiple != null && i.setAttribute("multiple", n.multiple), i;
  },
  createText: (e) => Te.createTextNode(e),
  createComment: (e) => Te.createComment(e),
  setText: (e, t) => {
    e.nodeValue = t;
  },
  setElementText: (e, t) => {
    e.textContent = t;
  },
  parentNode: (e) => e.parentNode,
  nextSibling: (e) => e.nextSibling,
  querySelector: (e) => Te.querySelector(e),
  setScopeId(e, t) {
    e.setAttribute(t, "");
  },
  // __UNSAFE__
  // Reason: innerHTML.
  // Static content here can only come from compiled templates.
  // As long as the user only uses trusted templates, this is safe.
  insertStaticContent(e, t, s, n, i, r) {
    const o = s ? s.previousSibling : t.lastChild;
    if (i && (i === r || i.nextSibling))
      for (; t.insertBefore(i.cloneNode(!0), s), !(i === r || !(i = i.nextSibling)); )
        ;
    else {
      un.innerHTML = _i(
        n === "svg" ? `<svg>${e}</svg>` : n === "mathml" ? `<math>${e}</math>` : e
      );
      const c = un.content;
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
      o ? o.nextSibling : t.firstChild,
      // last
      s ? s.previousSibling : t.lastChild
    ];
  }
}, Co = Symbol("_vtc");
function Oo(e, t, s) {
  const n = e[Co];
  n && (t = (t ? [t, ...n] : [...n]).join(" ")), t == null ? e.removeAttribute("class") : s ? e.setAttribute("class", t) : e.className = t;
}
const an = Symbol("_vod"), Ao = Symbol("_vsh"), Po = Symbol(""), Ro = /(^|;)\s*display\s*:/;
function Io(e, t, s) {
  const n = e.style, i = Y(s);
  let r = !1;
  if (s && !i) {
    if (t)
      if (Y(t))
        for (const o of t.split(";")) {
          const c = o.slice(0, o.indexOf(":")).trim();
          s[c] == null && jt(n, c, "");
        }
      else
        for (const o in t)
          s[o] == null && jt(n, o, "");
    for (const o in s)
      o === "display" && (r = !0), jt(n, o, s[o]);
  } else if (i) {
    if (t !== s) {
      const o = n[Po];
      o && (s += ";" + o), n.cssText = s, r = Ro.test(s);
    }
  } else t && e.removeAttribute("style");
  an in e && (e[an] = r ? n.display : "", e[Ao] && (n.display = "none"));
}
const dn = /\s*!important$/;
function jt(e, t, s) {
  if (P(s))
    s.forEach((n) => jt(e, t, n));
  else if (s == null && (s = ""), t.startsWith("--"))
    e.setProperty(t, s);
  else {
    const n = Mo(e, t);
    dn.test(s) ? e.setProperty(
      qe(n),
      s.replace(dn, ""),
      "important"
    ) : e[n] = s;
  }
}
const hn = ["Webkit", "Moz", "ms"], os = {};
function Mo(e, t) {
  const s = os[t];
  if (s)
    return s;
  let n = je(t);
  if (n !== "filter" && n in e)
    return os[t] = n;
  n = wn(n);
  for (let i = 0; i < hn.length; i++) {
    const r = hn[i] + n;
    if (r in e)
      return os[t] = r;
  }
  return t;
}
const pn = "http://www.w3.org/1999/xlink";
function gn(e, t, s, n, i, r = Di(t)) {
  n && t.startsWith("xlink:") ? s == null ? e.removeAttributeNS(pn, t.slice(6, t.length)) : e.setAttributeNS(pn, t, s) : s == null || r && !Sn(s) ? e.removeAttribute(t) : e.setAttribute(
    t,
    r ? "" : et(s) ? String(s) : s
  );
}
function mn(e, t, s, n, i) {
  if (t === "innerHTML" || t === "textContent") {
    s != null && (e[t] = t === "innerHTML" ? _i(s) : s);
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
  let o = !1;
  if (s === "" || s == null) {
    const c = typeof e[t];
    c === "boolean" ? s = Sn(s) : s == null && c === "string" ? (s = "", o = !0) : c === "number" && (s = 0, o = !0);
  }
  try {
    e[t] = s;
  } catch {
  }
  o && e.removeAttribute(i || t);
}
function Fo(e, t, s, n) {
  e.addEventListener(t, s, n);
}
function Do(e, t, s, n) {
  e.removeEventListener(t, s, n);
}
const _n = Symbol("_vei");
function Ho(e, t, s, n, i = null) {
  const r = e[_n] || (e[_n] = {}), o = r[t];
  if (n && o)
    o.value = n;
  else {
    const [c, u] = jo(t);
    if (n) {
      const h = r[t] = $o(
        n,
        i
      );
      Fo(e, c, h, u);
    } else o && (Do(e, c, o, u), r[t] = void 0);
  }
}
const bn = /(?:Once|Passive|Capture)$/;
function jo(e) {
  let t;
  if (bn.test(e)) {
    t = {};
    let n;
    for (; n = e.match(bn); )
      e = e.slice(0, e.length - n[0].length), t[n[0].toLowerCase()] = !0;
  }
  return [e[2] === ":" ? e.slice(3) : qe(e.slice(2)), t];
}
let ls = 0;
const No = /* @__PURE__ */ Promise.resolve(), Lo = () => ls || (No.then(() => ls = 0), ls = Date.now());
function $o(e, t) {
  const s = (n) => {
    if (!n._vts)
      n._vts = Date.now();
    else if (n._vts <= s.attached)
      return;
    we(
      Ko(n, s.value),
      t,
      5,
      [n]
    );
  };
  return s.value = e, s.attached = Lo(), s;
}
function Ko(e, t) {
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
const vn = (e) => e.charCodeAt(0) === 111 && e.charCodeAt(1) === 110 && // lowercase letter
e.charCodeAt(2) > 96 && e.charCodeAt(2) < 123, Wo = (e, t, s, n, i, r) => {
  const o = i === "svg";
  t === "class" ? Oo(e, n, o) : t === "style" ? Io(e, s, n) : Ut(t) ? ws(t) || Ho(e, t, s, n, r) : (t[0] === "." ? (t = t.slice(1), !0) : t[0] === "^" ? (t = t.slice(1), !1) : Uo(e, t, n, o)) ? (mn(e, t, n), !e.tagName.includes("-") && (t === "value" || t === "checked" || t === "selected") && gn(e, t, n, o, r, t !== "value")) : /* #11081 force set props for possible async custom element */ e._isVueCE && (/[A-Z]/.test(t) || !Y(n)) ? mn(e, je(t), n, r, t) : (t === "true-value" ? e._trueValue = n : t === "false-value" && (e._falseValue = n), gn(e, t, n, o));
};
function Uo(e, t, s, n) {
  if (n)
    return !!(t === "innerHTML" || t === "textContent" || t in e && vn(t) && R(s));
  if (t === "spellcheck" || t === "draggable" || t === "translate" || t === "autocorrect" || t === "form" || t === "list" && e.tagName === "INPUT" || t === "type" && e.tagName === "TEXTAREA")
    return !1;
  if (t === "width" || t === "height") {
    const i = e.tagName;
    if (i === "IMG" || i === "VIDEO" || i === "CANVAS" || i === "SOURCE")
      return !1;
  }
  return vn(t) && Y(s) ? !1 : t in e;
}
const Vo = /* @__PURE__ */ se({ patchProp: Wo }, Eo);
let xn;
function Bo() {
  return xn || (xn = Br(Vo));
}
const qo = (...e) => {
  const t = Bo().createApp(...e), { mount: s } = t;
  return t.mount = (n) => {
    const i = Jo(n);
    if (!i) return;
    const r = t._component;
    !R(r) && !r.render && !r.template && (r.template = i.innerHTML), i.nodeType === 1 && (i.textContent = "");
    const o = s(i, !1, Go(i));
    return i instanceof Element && (i.removeAttribute("v-cloak"), i.setAttribute("data-v-app", "")), o;
  }, t;
};
function Go(e) {
  if (e instanceof SVGElement)
    return "svg";
  if (typeof MathMLElement == "function" && e instanceof MathMLElement)
    return "mathml";
}
function Jo(e) {
  return Y(e) ? document.querySelector(e) : e;
}
const Yo = { class: "app-shell" }, zo = {
  id: "top",
  class: "site-hero"
}, Xo = { class: "hero-copy" }, Zo = { class: "actions" }, ko = ["href"], Qo = {
  id: "download",
  class: "download-section"
}, el = { class: "download-options" }, tl = ["href"], sl = ["href"], nl = ["href"], il = {
  __name: "App",
  setup(e) {
    const t = {
      x64: "https://github.com/rjf1979/review_stock/releases/download/v0.2.5/hangqing-desktop-0.2.5-win-x64-setup.exe",
      ia32: "https://github.com/rjf1979/review_stock/releases/download/v0.2.5/hangqing-desktop-0.2.5-win-ia32-setup.exe",
      release: "https://github.com/rjf1979/review_stock/releases/tag/v0.2.5"
    };
    return (s, n) => (io(), lo("div", Yo, [
      n[12] || (n[12] = Mt('<header class="nav"><a class="logo" href="#top" aria-label="返回股市脉搏首页">股市脉搏<span>DESKTOP MARKET DESK</span></a><nav aria-label="主导航"><a href="#features">功能</a><a href="#how">工作方式</a><a href="#download">下载</a></nav></header>', 1)),
      I("main", null, [
        I("section", zo, [
          I("div", Xo, [
            n[1] || (n[1] = I("p", { class: "kicker" }, "LOCAL MARKET DESK · WINDOWS DESKTOP", -1)),
            n[2] || (n[2] = I("h1", null, [
              bs("股市脉搏，"),
              I("br"),
              I("em", null, "一屏看懂。")
            ], -1)),
            n[3] || (n[3] = I("p", { class: "lede" }, "实时行情、板块、龙虎榜和收盘复盘。数据在你的电脑本地整理，打开应用就能开始工作。", -1)),
            I("div", Zo, [
              I("a", {
                class: "primary",
                href: t.x64
              }, "下载 Windows 64 位版", 8, ko),
              n[0] || (n[0] = I("a", {
                class: "text-link",
                href: "#features"
              }, "查看功能", -1))
            ]),
            n[4] || (n[4] = I("p", { class: "fine" }, "Windows 10/11 · 提供 x64 与 x86 安装包 · macOS 暂未提供 · 免费 · 无需账号", -1))
          ]),
          n[5] || (n[5] = Mt('<div class="hero-console" aria-label="股市脉搏桌面版功能预览"><div class="console-bar"><span class="console-brand"><i aria-hidden="true"></i> 股市脉搏</span><span class="console-caption">DESKTOP APP</span><span class="console-status">本地运行</span></div><div class="console-content"><div class="console-heading"><div><small>MARKET DESK / FEATURES</small><strong>收盘后的工作台</strong></div><span class="console-refresh">无需登录</span></div><div class="console-indices"><div class="console-index"><small>实时行情</small><strong>本地更新</strong><span>指数与自选股</span></div><div class="console-index"><small>每日复盘</small><strong>16:00</strong><span>工作日整理</span></div><div class="console-index"><small>系统通知</small><strong>可选</strong><span>托盘运行</span></div></div><div class="console-table"><div><span>数据来源</span><b>腾讯行情 · 东方财富</b></div><div><span>运行方式</span><b>本地直连公开接口</b></div><div><span>数据保存</span><b>当前 Windows 用户本地</b></div></div></div></div>', 1))
        ]),
        n[10] || (n[10] = Mt('<section id="features" class="feature-section"><div class="section-heading"><p class="kicker">DESKTOP FEATURES</p><h2>为每天收盘后的十分钟设计</h2><p>把需要反复打开的行情入口，收拢成一张安静、可扫描的桌面工作台。</p></div><div class="feature-grid"><article><span class="feature-index">01</span><h3>实时行情</h3><p>A 股指数与自选股实时报价，刷新频率可调，涨跌语义清晰。</p></article><article><span class="feature-index">02</span><h3>每日复盘</h3><p>市场温度、大盘概览、资金流、海外市场和要闻集中呈现。</p></article><article><span class="feature-index">03</span><h3>板块与龙虎榜</h3><p>领涨板块、涨停连板梯队和龙虎榜净买入，收盘后一次看完。</p></article><article><span class="feature-index">04</span><h3>本地数据</h3><p>公开行情在本机整理，自选股、设置和复盘记录保存在本地。</p></article></div></section><section id="how" class="how section"><div class="section-heading"><p class="kicker">HOW IT WORKS</p><h2>从数据到桌面，只需三步</h2></div><div class="steps"><div><b>01</b><h3>安装桌面版</h3><p>下载对应架构的 Windows 安装包，按向导完成安装。</p></div><div><b>02</b><h3>本地抓取行情</h3><p>应用直接读取公开行情源，在本机整理实时数据。</p></div><div><b>03</b><h3>收盘后查看</h3><p>打开工作台查看盘面、异动、自选和每日复盘。</p></div></div></section>', 2)),
        I("section", Qo, [
          n[9] || (n[9] = I("div", null, [
            I("p", { class: "kicker" }, "DESKTOP RELEASE · V0.2.5"),
            I("h2", null, "把股市脉搏放在桌面上"),
            I("p", null, "提供 Windows 64 位与 32 位安装包；macOS 版本暂未提供。安装包未进行代码签名，请从 GitHub Release 页面下载并核对 SHA-256。")
          ], -1)),
          I("div", el, [
            I("a", {
              class: "download-option",
              href: t.x64
            }, n[6] || (n[6] = [
              I("span", null, "Windows 64 位 (x64)", -1),
              I("strong", null, "下载安装包", -1),
              I("small", null, "适用于绝大多数 Windows 10/11 电脑", -1)
            ]), 8, tl),
            I("a", {
              class: "download-option",
              href: t.ia32
            }, n[7] || (n[7] = [
              I("span", null, "Windows 32 位 (x86)", -1),
              I("strong", null, "下载安装包", -1),
              I("small", null, "仅用于 32 位 Windows", -1)
            ]), 8, sl),
            n[8] || (n[8] = I("div", {
              class: "download-option unavailable",
              role: "note"
            }, [
              I("span", null, "macOS"),
              I("strong", null, "暂未提供"),
              I("small", null, "当前仅支持 Windows")
            ], -1)),
            I("a", {
              class: "release-link",
              href: t.release
            }, "查看 Release 与校验值", 8, nl)
          ])
        ]),
        n[11] || (n[11] = Mt('<section id="future-app" class="future-section section"><div class="section-heading"><p class="kicker">FUTURE APP</p><h2>未来再延伸到移动端</h2><p>移动端目前只是工程占位，后续将单独设计数据访问、同步、离线和通知策略，不直接依赖 Electron 桌面端。</p></div></section><section id="data" class="compliance-section section"><div class="section-heading"><p class="kicker">DATA &amp; DISCLAIMER</p><h2>数据从哪里来？</h2></div><div class="compliance-grid"><div><h3>公开来源，本地整理</h3><p>股市脉搏使用腾讯行情、东方财富等公开免费数据源。桌面版在本地取数和整理，不采集你的交易信息，也不经过平台服务器中转。</p></div><div><h3>免责声明</h3><p>股市脉搏仅提供行情数据的展示与整理，所有数据来自公开来源，仅供参考，不构成任何投资建议。股市有风险，投资需谨慎。</p></div></div></section>', 2))
      ]),
      n[13] || (n[13] = I("footer", null, [
        I("span", null, "© 2026 股市脉搏 · Desktop Market Desk"),
        I("span", null, [
          I("a", { href: "#data" }, "数据来源与免责声明"),
          bs(" · "),
          I("a", { href: "#download" }, "下载")
        ])
      ], -1))
    ]));
  }
};
qo(il).mount("#app");
