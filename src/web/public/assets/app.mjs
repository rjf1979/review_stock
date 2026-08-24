/**
* @vue/shared v3.5.18
* (c) 2018-present Yuxi (Evan) You and Vue contributors
* @license MIT
**/
/*! #__NO_SIDE_EFFECTS__ */
// @__NO_SIDE_EFFECTS__
function Ys(e) {
  const t = /* @__PURE__ */ Object.create(null);
  for (const s of e.split(",")) t[s] = 1;
  return (s) => s in t;
}
const z = {}, St = [], $e = () => {
}, nl = () => !1, ms = (e) => e.charCodeAt(0) === 111 && e.charCodeAt(1) === 110 && // uppercase letter
(e.charCodeAt(2) > 122 || e.charCodeAt(2) < 97), Xs = (e) => e.startsWith("onUpdate:"), ge = Object.assign, Zs = (e, t) => {
  const s = e.indexOf(t);
  s > -1 && e.splice(s, 1);
}, il = Object.prototype.hasOwnProperty, V = (e, t) => il.call(e, t), P = Array.isArray, Tt = (e) => Zt(e) === "[object Map]", Pt = (e) => Zt(e) === "[object Set]", yn = (e) => Zt(e) === "[object Date]", k = (e) => typeof e == "function", ee = (e) => typeof e == "string", Le = (e) => typeof e == "symbol", Z = (e) => e !== null && typeof e == "object", Yn = (e) => (Z(e) || k(e)) && k(e.then) && k(e.catch), Xn = Object.prototype.toString, Zt = (e) => Xn.call(e), ll = (e) => Zt(e).slice(8, -1), Zn = (e) => Zt(e) === "[object Object]", Qs = (e) => ee(e) && e !== "NaN" && e[0] !== "-" && "" + parseInt(e, 10) === e, $t = /* @__PURE__ */ Ys(
  // the leading comma is intentional so empty string "" is also included
  ",key,ref,ref_for,ref_key,onVnodeBeforeMount,onVnodeMounted,onVnodeBeforeUpdate,onVnodeUpdated,onVnodeBeforeUnmount,onVnodeUnmounted"
), ys = (e) => {
  const t = /* @__PURE__ */ Object.create(null);
  return (s) => t[s] || (t[s] = e(s));
}, ol = /-(\w)/g, at = ys(
  (e) => e.replace(ol, (t, s) => s ? s.toUpperCase() : "")
), rl = /\B([A-Z])/g, dt = ys(
  (e) => e.replace(rl, "-$1").toLowerCase()
), Qn = ys((e) => e.charAt(0).toUpperCase() + e.slice(1)), Es = ys(
  (e) => e ? `on${Qn(e)}` : ""
), rt = (e, t) => !Object.is(e, t), ls = (e, ...t) => {
  for (let s = 0; s < e.length; s++)
    e[s](...t);
}, js = (e, t, s, n = !1) => {
  Object.defineProperty(e, t, {
    configurable: !0,
    enumerable: !1,
    writable: n,
    value: s
  });
}, cs = (e) => {
  const t = parseFloat(e);
  return isNaN(t) ? e : t;
};
let bn;
const bs = () => bn || (bn = typeof globalThis < "u" ? globalThis : typeof self < "u" ? self : typeof window < "u" ? window : typeof global < "u" ? global : {});
function en(e) {
  if (P(e)) {
    const t = {};
    for (let s = 0; s < e.length; s++) {
      const n = e[s], i = ee(n) ? fl(n) : en(n);
      if (i)
        for (const l in i)
          t[l] = i[l];
    }
    return t;
  } else if (ee(e) || Z(e))
    return e;
}
const al = /;(?![^(]*\))/g, ul = /:([^]+)/, cl = /\/\*[^]*?\*\//g;
function fl(e) {
  const t = {};
  return e.replace(cl, "").split(al).forEach((s) => {
    if (s) {
      const n = s.split(ul);
      n.length > 1 && (t[n[0].trim()] = n[1].trim());
    }
  }), t;
}
function se(e) {
  let t = "";
  if (ee(e))
    t = e;
  else if (P(e))
    for (let s = 0; s < e.length; s++) {
      const n = se(e[s]);
      n && (t += n + " ");
    }
  else if (Z(e))
    for (const s in e)
      e[s] && (t += s + " ");
  return t.trim();
}
const dl = "itemscope,allowfullscreen,formnovalidate,ismap,nomodule,novalidate,readonly", pl = /* @__PURE__ */ Ys(dl);
function ei(e) {
  return !!e || e === "";
}
function hl(e, t) {
  if (e.length !== t.length) return !1;
  let s = !0;
  for (let n = 0; s && n < e.length; n++)
    s = bt(e[n], t[n]);
  return s;
}
function bt(e, t) {
  if (e === t) return !0;
  let s = yn(e), n = yn(t);
  if (s || n)
    return s && n ? e.getTime() === t.getTime() : !1;
  if (s = Le(e), n = Le(t), s || n)
    return e === t;
  if (s = P(e), n = P(t), s || n)
    return s && n ? hl(e, t) : !1;
  if (s = Z(e), n = Z(t), s || n) {
    if (!s || !n)
      return !1;
    const i = Object.keys(e).length, l = Object.keys(t).length;
    if (i !== l)
      return !1;
    for (const o in e) {
      const a = e.hasOwnProperty(o), f = t.hasOwnProperty(o);
      if (a && !f || !a && f || !bt(e[o], t[o]))
        return !1;
    }
  }
  return String(e) === String(t);
}
function tn(e, t) {
  return e.findIndex((s) => bt(s, t));
}
const ti = (e) => !!(e && e.__v_isRef === !0), R = (e) => ee(e) ? e : e == null ? "" : P(e) || Z(e) && (e.toString === Xn || !k(e.toString)) ? ti(e) ? R(e.value) : JSON.stringify(e, si, 2) : String(e), si = (e, t) => ti(t) ? si(e, t.value) : Tt(t) ? {
  [`Map(${t.size})`]: [...t.entries()].reduce(
    (s, [n, i], l) => (s[Os(n, l) + " =>"] = i, s),
    {}
  )
} : Pt(t) ? {
  [`Set(${t.size})`]: [...t.values()].map((s) => Os(s))
} : Le(t) ? Os(t) : Z(t) && !P(t) && !Zn(t) ? String(t) : t, Os = (e, t = "") => {
  var s;
  return (
    // Symbol.description in es2019+ so we need to cast here to pass
    // the lib: es2016 check
    Le(e) ? `Symbol(${(s = e.description) != null ? s : t})` : e
  );
};
/**
* @vue/reactivity v3.5.18
* (c) 2018-present Yuxi (Evan) You and Vue contributors
* @license MIT
**/
let me;
class gl {
  constructor(t = !1) {
    this.detached = t, this._active = !0, this._on = 0, this.effects = [], this.cleanups = [], this._isPaused = !1, this.parent = me, !t && me && (this.index = (me.scopes || (me.scopes = [])).push(
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
      const s = me;
      try {
        return me = this, t();
      } finally {
        me = s;
      }
    }
  }
  /**
   * This should only be called on non-detached scopes
   * @internal
   */
  on() {
    ++this._on === 1 && (this.prevScope = me, me = this);
  }
  /**
   * This should only be called on non-detached scopes
   * @internal
   */
  off() {
    this._on > 0 && --this._on === 0 && (me = this.prevScope, this.prevScope = void 0);
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
function vl() {
  return me;
}
let Y;
const Ms = /* @__PURE__ */ new WeakSet();
class ni {
  constructor(t) {
    this.fn = t, this.deps = void 0, this.depsTail = void 0, this.flags = 5, this.next = void 0, this.cleanup = void 0, this.scheduler = void 0, me && me.active && me.effects.push(this);
  }
  pause() {
    this.flags |= 64;
  }
  resume() {
    this.flags & 64 && (this.flags &= -65, Ms.has(this) && (Ms.delete(this), this.trigger()));
  }
  /**
   * @internal
   */
  notify() {
    this.flags & 2 && !(this.flags & 32) || this.flags & 8 || li(this);
  }
  run() {
    if (!(this.flags & 1))
      return this.fn();
    this.flags |= 2, _n(this), oi(this);
    const t = Y, s = Ie;
    Y = this, Ie = !0;
    try {
      return this.fn();
    } finally {
      ri(this), Y = t, Ie = s, this.flags &= -3;
    }
  }
  stop() {
    if (this.flags & 1) {
      for (let t = this.deps; t; t = t.nextDep)
        ln(t);
      this.deps = this.depsTail = void 0, _n(this), this.onStop && this.onStop(), this.flags &= -2;
    }
  }
  trigger() {
    this.flags & 64 ? Ms.add(this) : this.scheduler ? this.scheduler() : this.runIfDirty();
  }
  /**
   * @internal
   */
  runIfDirty() {
    $s(this) && this.run();
  }
  get dirty() {
    return $s(this);
  }
}
let ii = 0, Ht, Lt;
function li(e, t = !1) {
  if (e.flags |= 8, t) {
    e.next = Lt, Lt = e;
    return;
  }
  e.next = Ht, Ht = e;
}
function sn() {
  ii++;
}
function nn() {
  if (--ii > 0)
    return;
  if (Lt) {
    let t = Lt;
    for (Lt = void 0; t; ) {
      const s = t.next;
      t.next = void 0, t.flags &= -9, t = s;
    }
  }
  let e;
  for (; Ht; ) {
    let t = Ht;
    for (Ht = void 0; t; ) {
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
function oi(e) {
  for (let t = e.deps; t; t = t.nextDep)
    t.version = -1, t.prevActiveLink = t.dep.activeLink, t.dep.activeLink = t;
}
function ri(e) {
  let t, s = e.depsTail, n = s;
  for (; n; ) {
    const i = n.prevDep;
    n.version === -1 ? (n === s && (s = i), ln(n), ml(n)) : t = n, n.dep.activeLink = n.prevActiveLink, n.prevActiveLink = void 0, n = i;
  }
  e.deps = t, e.depsTail = s;
}
function $s(e) {
  for (let t = e.deps; t; t = t.nextDep)
    if (t.dep.version !== t.version || t.dep.computed && (ai(t.dep.computed) || t.dep.version !== t.version))
      return !0;
  return !!e._dirty;
}
function ai(e) {
  if (e.flags & 4 && !(e.flags & 16) || (e.flags &= -17, e.globalVersion === zt) || (e.globalVersion = zt, !e.isSSR && e.flags & 128 && (!e.deps && !e._dirty || !$s(e))))
    return;
  e.flags |= 2;
  const t = e.dep, s = Y, n = Ie;
  Y = e, Ie = !0;
  try {
    oi(e);
    const i = e.fn(e._value);
    (t.version === 0 || rt(i, e._value)) && (e.flags |= 128, e._value = i, t.version++);
  } catch (i) {
    throw t.version++, i;
  } finally {
    Y = s, Ie = n, ri(e), e.flags &= -3;
  }
}
function ln(e, t = !1) {
  const { dep: s, prevSub: n, nextSub: i } = e;
  if (n && (n.nextSub = i, e.prevSub = void 0), i && (i.prevSub = n, e.nextSub = void 0), s.subs === e && (s.subs = n, !n && s.computed)) {
    s.computed.flags &= -5;
    for (let l = s.computed.deps; l; l = l.nextDep)
      ln(l, !0);
  }
  !t && !--s.sc && s.map && s.map.delete(s.key);
}
function ml(e) {
  const { prevDep: t, nextDep: s } = e;
  t && (t.nextDep = s, e.prevDep = void 0), s && (s.prevDep = t, e.nextDep = void 0);
}
let Ie = !0;
const ui = [];
function Ze() {
  ui.push(Ie), Ie = !1;
}
function Qe() {
  const e = ui.pop();
  Ie = e === void 0 ? !0 : e;
}
function _n(e) {
  const { cleanup: t } = e;
  if (e.cleanup = void 0, t) {
    const s = Y;
    Y = void 0;
    try {
      t();
    } finally {
      Y = s;
    }
  }
}
let zt = 0;
class yl {
  constructor(t, s) {
    this.sub = t, this.dep = s, this.version = s.version, this.nextDep = this.prevDep = this.nextSub = this.prevSub = this.prevActiveLink = void 0;
  }
}
class on {
  // TODO isolatedDeclarations "__v_skip"
  constructor(t) {
    this.computed = t, this.version = 0, this.activeLink = void 0, this.subs = void 0, this.map = void 0, this.key = void 0, this.sc = 0, this.__v_skip = !0;
  }
  track(t) {
    if (!Y || !Ie || Y === this.computed)
      return;
    let s = this.activeLink;
    if (s === void 0 || s.sub !== Y)
      s = this.activeLink = new yl(Y, this), Y.deps ? (s.prevDep = Y.depsTail, Y.depsTail.nextDep = s, Y.depsTail = s) : Y.deps = Y.depsTail = s, ci(s);
    else if (s.version === -1 && (s.version = this.version, s.nextDep)) {
      const n = s.nextDep;
      n.prevDep = s.prevDep, s.prevDep && (s.prevDep.nextDep = n), s.prevDep = Y.depsTail, s.nextDep = void 0, Y.depsTail.nextDep = s, Y.depsTail = s, Y.deps === s && (Y.deps = n);
    }
    return s;
  }
  trigger(t) {
    this.version++, zt++, this.notify(t);
  }
  notify(t) {
    sn();
    try {
      for (let s = this.subs; s; s = s.prevSub)
        s.sub.notify() && s.sub.dep.notify();
    } finally {
      nn();
    }
  }
}
function ci(e) {
  if (e.dep.sc++, e.sub.flags & 4) {
    const t = e.dep.computed;
    if (t && !e.dep.subs) {
      t.flags |= 20;
      for (let n = t.deps; n; n = n.nextDep)
        ci(n);
    }
    const s = e.dep.subs;
    s !== e && (e.prevSub = s, s && (s.nextSub = e)), e.dep.subs = e;
  }
}
const Hs = /* @__PURE__ */ new WeakMap(), yt = Symbol(
  ""
), Ls = Symbol(
  ""
), Gt = Symbol(
  ""
);
function re(e, t, s) {
  if (Ie && Y) {
    let n = Hs.get(e);
    n || Hs.set(e, n = /* @__PURE__ */ new Map());
    let i = n.get(s);
    i || (n.set(s, i = new on()), i.map = n, i.key = s), i.track();
  }
}
function Je(e, t, s, n, i, l) {
  const o = Hs.get(e);
  if (!o) {
    zt++;
    return;
  }
  const a = (f) => {
    f && f.trigger();
  };
  if (sn(), t === "clear")
    o.forEach(a);
  else {
    const f = P(e), g = f && Qs(s);
    if (f && s === "length") {
      const p = Number(n);
      o.forEach((y, A) => {
        (A === "length" || A === Gt || !Le(A) && A >= p) && a(y);
      });
    } else
      switch ((s !== void 0 || o.has(void 0)) && a(o.get(s)), g && a(o.get(Gt)), t) {
        case "add":
          f ? g && a(o.get("length")) : (a(o.get(yt)), Tt(e) && a(o.get(Ls)));
          break;
        case "delete":
          f || (a(o.get(yt)), Tt(e) && a(o.get(Ls)));
          break;
        case "set":
          Tt(e) && a(o.get(yt));
          break;
      }
  }
  nn();
}
function xt(e) {
  const t = L(e);
  return t === e ? t : (re(t, "iterate", Gt), Ee(e) ? t : t.map(le));
}
function _s(e) {
  return re(e = L(e), "iterate", Gt), e;
}
const bl = {
  __proto__: null,
  [Symbol.iterator]() {
    return Ps(this, Symbol.iterator, le);
  },
  concat(...e) {
    return xt(this).concat(
      ...e.map((t) => P(t) ? xt(t) : t)
    );
  },
  entries() {
    return Ps(this, "entries", (e) => (e[1] = le(e[1]), e));
  },
  every(e, t) {
    return ze(this, "every", e, t, void 0, arguments);
  },
  filter(e, t) {
    return ze(this, "filter", e, t, (s) => s.map(le), arguments);
  },
  find(e, t) {
    return ze(this, "find", e, t, le, arguments);
  },
  findIndex(e, t) {
    return ze(this, "findIndex", e, t, void 0, arguments);
  },
  findLast(e, t) {
    return ze(this, "findLast", e, t, le, arguments);
  },
  findLastIndex(e, t) {
    return ze(this, "findLastIndex", e, t, void 0, arguments);
  },
  // flat, flatMap could benefit from ARRAY_ITERATE but are not straight-forward to implement
  forEach(e, t) {
    return ze(this, "forEach", e, t, void 0, arguments);
  },
  includes(...e) {
    return Is(this, "includes", e);
  },
  indexOf(...e) {
    return Is(this, "indexOf", e);
  },
  join(e) {
    return xt(this).join(e);
  },
  // keys() iterator only reads `length`, no optimisation required
  lastIndexOf(...e) {
    return Is(this, "lastIndexOf", e);
  },
  map(e, t) {
    return ze(this, "map", e, t, void 0, arguments);
  },
  pop() {
    return Kt(this, "pop");
  },
  push(...e) {
    return Kt(this, "push", e);
  },
  reduce(e, ...t) {
    return xn(this, "reduce", e, t);
  },
  reduceRight(e, ...t) {
    return xn(this, "reduceRight", e, t);
  },
  shift() {
    return Kt(this, "shift");
  },
  // slice could use ARRAY_ITERATE but also seems to beg for range tracking
  some(e, t) {
    return ze(this, "some", e, t, void 0, arguments);
  },
  splice(...e) {
    return Kt(this, "splice", e);
  },
  toReversed() {
    return xt(this).toReversed();
  },
  toSorted(e) {
    return xt(this).toSorted(e);
  },
  toSpliced(...e) {
    return xt(this).toSpliced(...e);
  },
  unshift(...e) {
    return Kt(this, "unshift", e);
  },
  values() {
    return Ps(this, "values", le);
  }
};
function Ps(e, t, s) {
  const n = _s(e), i = n[t]();
  return n !== e && !Ee(e) && (i._next = i.next, i.next = () => {
    const l = i._next();
    return l.value && (l.value = s(l.value)), l;
  }), i;
}
const _l = Array.prototype;
function ze(e, t, s, n, i, l) {
  const o = _s(e), a = o !== e && !Ee(e), f = o[t];
  if (f !== _l[t]) {
    const y = f.apply(e, l);
    return a ? le(y) : y;
  }
  let g = s;
  o !== e && (a ? g = function(y, A) {
    return s.call(this, le(y), A, e);
  } : s.length > 2 && (g = function(y, A) {
    return s.call(this, y, A, e);
  }));
  const p = f.call(o, g, n);
  return a && i ? i(p) : p;
}
function xn(e, t, s, n) {
  const i = _s(e);
  let l = s;
  return i !== e && (Ee(e) ? s.length > 3 && (l = function(o, a, f) {
    return s.call(this, o, a, f, e);
  }) : l = function(o, a, f) {
    return s.call(this, o, le(a), f, e);
  }), i[t](l, ...n);
}
function Is(e, t, s) {
  const n = L(e);
  re(n, "iterate", Gt);
  const i = n[t](...s);
  return (i === -1 || i === !1) && cn(s[0]) ? (s[0] = L(s[0]), n[t](...s)) : i;
}
function Kt(e, t, s = []) {
  Ze(), sn();
  const n = L(e)[t].apply(e, s);
  return nn(), Qe(), n;
}
const xl = /* @__PURE__ */ Ys("__proto__,__v_isRef,__isVue"), fi = new Set(
  /* @__PURE__ */ Object.getOwnPropertyNames(Symbol).filter((e) => e !== "arguments" && e !== "caller").map((e) => Symbol[e]).filter(Le)
);
function wl(e) {
  Le(e) || (e = String(e));
  const t = L(this);
  return re(t, "has", e), t.hasOwnProperty(e);
}
class di {
  constructor(t = !1, s = !1) {
    this._isReadonly = t, this._isShallow = s;
  }
  get(t, s, n) {
    if (s === "__v_skip") return t.__v_skip;
    const i = this._isReadonly, l = this._isShallow;
    if (s === "__v_isReactive")
      return !i;
    if (s === "__v_isReadonly")
      return i;
    if (s === "__v_isShallow")
      return l;
    if (s === "__v_raw")
      return n === (i ? l ? Rl : vi : l ? gi : hi).get(t) || // receiver is not the reactive proxy, but has the same prototype
      // this means the receiver is a user proxy of the reactive proxy
      Object.getPrototypeOf(t) === Object.getPrototypeOf(n) ? t : void 0;
    const o = P(t);
    if (!i) {
      let f;
      if (o && (f = bl[s]))
        return f;
      if (s === "hasOwnProperty")
        return wl;
    }
    const a = Reflect.get(
      t,
      s,
      // if this is a proxy wrapping a ref, return methods using the raw ref
      // as receiver so that we don't have to call `toRaw` on the ref in all
      // its class methods
      ae(t) ? t : n
    );
    return (Le(s) ? fi.has(s) : xl(s)) || (i || re(t, "get", s), l) ? a : ae(a) ? o && Qs(s) ? a : a.value : Z(a) ? i ? mi(a) : an(a) : a;
  }
}
class pi extends di {
  constructor(t = !1) {
    super(!1, t);
  }
  set(t, s, n, i) {
    let l = t[s];
    if (!this._isShallow) {
      const f = ut(l);
      if (!Ee(n) && !ut(n) && (l = L(l), n = L(n)), !P(t) && ae(l) && !ae(n))
        return f ? !1 : (l.value = n, !0);
    }
    const o = P(t) && Qs(s) ? Number(s) < t.length : V(t, s), a = Reflect.set(
      t,
      s,
      n,
      ae(t) ? t : i
    );
    return t === L(i) && (o ? rt(n, l) && Je(t, "set", s, n) : Je(t, "add", s, n)), a;
  }
  deleteProperty(t, s) {
    const n = V(t, s);
    t[s];
    const i = Reflect.deleteProperty(t, s);
    return i && n && Je(t, "delete", s, void 0), i;
  }
  has(t, s) {
    const n = Reflect.has(t, s);
    return (!Le(s) || !fi.has(s)) && re(t, "has", s), n;
  }
  ownKeys(t) {
    return re(
      t,
      "iterate",
      P(t) ? "length" : yt
    ), Reflect.ownKeys(t);
  }
}
class Sl extends di {
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
const Tl = /* @__PURE__ */ new pi(), Cl = /* @__PURE__ */ new Sl(), Al = /* @__PURE__ */ new pi(!0);
const Vs = (e) => e, ts = (e) => Reflect.getPrototypeOf(e);
function El(e, t, s) {
  return function(...n) {
    const i = this.__v_raw, l = L(i), o = Tt(l), a = e === "entries" || e === Symbol.iterator && o, f = e === "keys" && o, g = i[e](...n), p = s ? Vs : t ? fs : le;
    return !t && re(
      l,
      "iterate",
      f ? Ls : yt
    ), {
      // iterator protocol
      next() {
        const { value: y, done: A } = g.next();
        return A ? { value: y, done: A } : {
          value: a ? [p(y[0]), p(y[1])] : p(y),
          done: A
        };
      },
      // iterable protocol
      [Symbol.iterator]() {
        return this;
      }
    };
  };
}
function ss(e) {
  return function(...t) {
    return e === "delete" ? !1 : e === "clear" ? void 0 : this;
  };
}
function Ol(e, t) {
  const s = {
    get(i) {
      const l = this.__v_raw, o = L(l), a = L(i);
      e || (rt(i, a) && re(o, "get", i), re(o, "get", a));
      const { has: f } = ts(o), g = t ? Vs : e ? fs : le;
      if (f.call(o, i))
        return g(l.get(i));
      if (f.call(o, a))
        return g(l.get(a));
      l !== o && l.get(i);
    },
    get size() {
      const i = this.__v_raw;
      return !e && re(L(i), "iterate", yt), Reflect.get(i, "size", i);
    },
    has(i) {
      const l = this.__v_raw, o = L(l), a = L(i);
      return e || (rt(i, a) && re(o, "has", i), re(o, "has", a)), i === a ? l.has(i) : l.has(i) || l.has(a);
    },
    forEach(i, l) {
      const o = this, a = o.__v_raw, f = L(a), g = t ? Vs : e ? fs : le;
      return !e && re(f, "iterate", yt), a.forEach((p, y) => i.call(l, g(p), g(y), o));
    }
  };
  return ge(
    s,
    e ? {
      add: ss("add"),
      set: ss("set"),
      delete: ss("delete"),
      clear: ss("clear")
    } : {
      add(i) {
        !t && !Ee(i) && !ut(i) && (i = L(i));
        const l = L(this);
        return ts(l).has.call(l, i) || (l.add(i), Je(l, "add", i, i)), this;
      },
      set(i, l) {
        !t && !Ee(l) && !ut(l) && (l = L(l));
        const o = L(this), { has: a, get: f } = ts(o);
        let g = a.call(o, i);
        g || (i = L(i), g = a.call(o, i));
        const p = f.call(o, i);
        return o.set(i, l), g ? rt(l, p) && Je(o, "set", i, l) : Je(o, "add", i, l), this;
      },
      delete(i) {
        const l = L(this), { has: o, get: a } = ts(l);
        let f = o.call(l, i);
        f || (i = L(i), f = o.call(l, i)), a && a.call(l, i);
        const g = l.delete(i);
        return f && Je(l, "delete", i, void 0), g;
      },
      clear() {
        const i = L(this), l = i.size !== 0, o = i.clear();
        return l && Je(
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
    s[i] = El(i, e, t);
  }), s;
}
function rn(e, t) {
  const s = Ol(e, t);
  return (n, i, l) => i === "__v_isReactive" ? !e : i === "__v_isReadonly" ? e : i === "__v_raw" ? n : Reflect.get(
    V(s, i) && i in n ? s : n,
    i,
    l
  );
}
const Ml = {
  get: /* @__PURE__ */ rn(!1, !1)
}, Pl = {
  get: /* @__PURE__ */ rn(!1, !0)
}, Il = {
  get: /* @__PURE__ */ rn(!0, !1)
};
const hi = /* @__PURE__ */ new WeakMap(), gi = /* @__PURE__ */ new WeakMap(), vi = /* @__PURE__ */ new WeakMap(), Rl = /* @__PURE__ */ new WeakMap();
function kl(e) {
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
function Dl(e) {
  return e.__v_skip || !Object.isExtensible(e) ? 0 : kl(ll(e));
}
function an(e) {
  return ut(e) ? e : un(
    e,
    !1,
    Tl,
    Ml,
    hi
  );
}
function Fl(e) {
  return un(
    e,
    !1,
    Al,
    Pl,
    gi
  );
}
function mi(e) {
  return un(
    e,
    !0,
    Cl,
    Il,
    vi
  );
}
function un(e, t, s, n, i) {
  if (!Z(e) || e.__v_raw && !(t && e.__v_isReactive))
    return e;
  const l = Dl(e);
  if (l === 0)
    return e;
  const o = i.get(e);
  if (o)
    return o;
  const a = new Proxy(
    e,
    l === 2 ? n : s
  );
  return i.set(e, a), a;
}
function Ct(e) {
  return ut(e) ? Ct(e.__v_raw) : !!(e && e.__v_isReactive);
}
function ut(e) {
  return !!(e && e.__v_isReadonly);
}
function Ee(e) {
  return !!(e && e.__v_isShallow);
}
function cn(e) {
  return e ? !!e.__v_raw : !1;
}
function L(e) {
  const t = e && e.__v_raw;
  return t ? L(t) : e;
}
function Kl(e) {
  return !V(e, "__v_skip") && Object.isExtensible(e) && js(e, "__v_skip", !0), e;
}
const le = (e) => Z(e) ? an(e) : e, fs = (e) => Z(e) ? mi(e) : e;
function ae(e) {
  return e ? e.__v_isRef === !0 : !1;
}
function X(e) {
  return Ul(e, !1);
}
function Ul(e, t) {
  return ae(e) ? e : new Nl(e, t);
}
class Nl {
  constructor(t, s) {
    this.dep = new on(), this.__v_isRef = !0, this.__v_isShallow = !1, this._rawValue = s ? t : L(t), this._value = s ? t : le(t), this.__v_isShallow = s;
  }
  get value() {
    return this.dep.track(), this._value;
  }
  set value(t) {
    const s = this._rawValue, n = this.__v_isShallow || Ee(t) || ut(t);
    t = n ? t : L(t), rt(t, s) && (this._rawValue = t, this._value = n ? t : le(t), this.dep.trigger());
  }
}
function yi(e) {
  return ae(e) ? e.value : e;
}
const jl = {
  get: (e, t, s) => t === "__v_raw" ? e : yi(Reflect.get(e, t, s)),
  set: (e, t, s, n) => {
    const i = e[t];
    return ae(i) && !ae(s) ? (i.value = s, !0) : Reflect.set(e, t, s, n);
  }
};
function bi(e) {
  return Ct(e) ? e : new Proxy(e, jl);
}
class $l {
  constructor(t, s, n) {
    this.fn = t, this.setter = s, this._value = void 0, this.dep = new on(this), this.__v_isRef = !0, this.deps = void 0, this.depsTail = void 0, this.flags = 16, this.globalVersion = zt - 1, this.next = void 0, this.effect = this, this.__v_isReadonly = !s, this.isSSR = n;
  }
  /**
   * @internal
   */
  notify() {
    if (this.flags |= 16, !(this.flags & 8) && // avoid infinite self recursion
    Y !== this)
      return li(this, !0), !0;
  }
  get value() {
    const t = this.dep.track();
    return ai(this), t && (t.version = this.dep.version), this._value;
  }
  set value(t) {
    this.setter && this.setter(t);
  }
}
function Hl(e, t, s = !1) {
  let n, i;
  return k(e) ? n = e : (n = e.get, i = e.set), new $l(n, i, s);
}
const ns = {}, ds = /* @__PURE__ */ new WeakMap();
let mt;
function Ll(e, t = !1, s = mt) {
  if (s) {
    let n = ds.get(s);
    n || ds.set(s, n = []), n.push(e);
  }
}
function Vl(e, t, s = z) {
  const { immediate: n, deep: i, once: l, scheduler: o, augmentJob: a, call: f } = s, g = (M) => i ? M : Ee(M) || i === !1 || i === 0 ? Ye(M, 1) : Ye(M);
  let p, y, A, C, K = !1, U = !1;
  if (ae(e) ? (y = () => e.value, K = Ee(e)) : Ct(e) ? (y = () => g(e), K = !0) : P(e) ? (U = !0, K = e.some((M) => Ct(M) || Ee(M)), y = () => e.map((M) => {
    if (ae(M))
      return M.value;
    if (Ct(M))
      return g(M);
    if (k(M))
      return f ? f(M, 2) : M();
  })) : k(e) ? t ? y = f ? () => f(e, 2) : e : y = () => {
    if (A) {
      Ze();
      try {
        A();
      } finally {
        Qe();
      }
    }
    const M = mt;
    mt = p;
    try {
      return f ? f(e, 3, [C]) : e(C);
    } finally {
      mt = M;
    }
  } : y = $e, t && i) {
    const M = y, W = i === !0 ? 1 / 0 : i;
    y = () => Ye(M(), W);
  }
  const Q = vl(), j = () => {
    p.stop(), Q && Q.active && Zs(Q.effects, p);
  };
  if (l && t) {
    const M = t;
    t = (...W) => {
      M(...W), j();
    };
  }
  let G = U ? new Array(e.length).fill(ns) : ns;
  const J = (M) => {
    if (!(!(p.flags & 1) || !p.dirty && !M))
      if (t) {
        const W = p.run();
        if (i || K || (U ? W.some((ye, oe) => rt(ye, G[oe])) : rt(W, G))) {
          A && A();
          const ye = mt;
          mt = p;
          try {
            const oe = [
              W,
              // pass undefined as the old value when it's changed for the first time
              G === ns ? void 0 : U && G[0] === ns ? [] : G,
              C
            ];
            G = W, f ? f(t, 3, oe) : (
              // @ts-expect-error
              t(...oe)
            );
          } finally {
            mt = ye;
          }
        }
      } else
        p.run();
  };
  return a && a(J), p = new ni(y), p.scheduler = o ? () => o(J, !1) : J, C = (M) => Ll(M, !1, p), A = p.onStop = () => {
    const M = ds.get(p);
    if (M) {
      if (f)
        f(M, 4);
      else
        for (const W of M) W();
      ds.delete(p);
    }
  }, t ? n ? J(!0) : G = p.run() : o ? o(J.bind(null, !0), !0) : p.run(), j.pause = p.pause.bind(p), j.resume = p.resume.bind(p), j.stop = j, j;
}
function Ye(e, t = 1 / 0, s) {
  if (t <= 0 || !Z(e) || e.__v_skip || (s = s || /* @__PURE__ */ new Set(), s.has(e)))
    return e;
  if (s.add(e), t--, ae(e))
    Ye(e.value, t, s);
  else if (P(e))
    for (let n = 0; n < e.length; n++)
      Ye(e[n], t, s);
  else if (Pt(e) || Tt(e))
    e.forEach((n) => {
      Ye(n, t, s);
    });
  else if (Zn(e)) {
    for (const n in e)
      Ye(e[n], t, s);
    for (const n of Object.getOwnPropertySymbols(e))
      Object.prototype.propertyIsEnumerable.call(e, n) && Ye(e[n], t, s);
  }
  return e;
}
/**
* @vue/runtime-core v3.5.18
* (c) 2018-present Yuxi (Evan) You and Vue contributors
* @license MIT
**/
function Qt(e, t, s, n) {
  try {
    return n ? e(...n) : e();
  } catch (i) {
    xs(i, t, s);
  }
}
function Ve(e, t, s, n) {
  if (k(e)) {
    const i = Qt(e, t, s, n);
    return i && Yn(i) && i.catch((l) => {
      xs(l, t, s);
    }), i;
  }
  if (P(e)) {
    const i = [];
    for (let l = 0; l < e.length; l++)
      i.push(Ve(e[l], t, s, n));
    return i;
  }
}
function xs(e, t, s, n = !0) {
  const i = t ? t.vnode : null, { errorHandler: l, throwUnhandledErrorInProduction: o } = t && t.appContext.config || z;
  if (t) {
    let a = t.parent;
    const f = t.proxy, g = `https://vuejs.org/error-reference/#runtime-${s}`;
    for (; a; ) {
      const p = a.ec;
      if (p) {
        for (let y = 0; y < p.length; y++)
          if (p[y](e, f, g) === !1)
            return;
      }
      a = a.parent;
    }
    if (l) {
      Ze(), Qt(l, null, 10, [
        e,
        f,
        g
      ]), Qe();
      return;
    }
  }
  Bl(e, s, i, n, o);
}
function Bl(e, t, s, n = !0, i = !1) {
  if (i)
    throw e;
  console.error(e);
}
const de = [];
let Ue = -1;
const At = [];
let lt = null, wt = 0;
const _i = /* @__PURE__ */ Promise.resolve();
let ps = null;
function xi(e) {
  const t = ps || _i;
  return e ? t.then(this ? e.bind(this) : e) : t;
}
function Wl(e) {
  let t = Ue + 1, s = de.length;
  for (; t < s; ) {
    const n = t + s >>> 1, i = de[n], l = Jt(i);
    l < e || l === e && i.flags & 2 ? t = n + 1 : s = n;
  }
  return t;
}
function fn(e) {
  if (!(e.flags & 1)) {
    const t = Jt(e), s = de[de.length - 1];
    !s || // fast path when the job id is larger than the tail
    !(e.flags & 2) && t >= Jt(s) ? de.push(e) : de.splice(Wl(t), 0, e), e.flags |= 1, wi();
  }
}
function wi() {
  ps || (ps = _i.then(Ti));
}
function ql(e) {
  P(e) ? At.push(...e) : lt && e.id === -1 ? lt.splice(wt + 1, 0, e) : e.flags & 1 || (At.push(e), e.flags |= 1), wi();
}
function wn(e, t, s = Ue + 1) {
  for (; s < de.length; s++) {
    const n = de[s];
    if (n && n.flags & 2) {
      if (e && n.id !== e.uid)
        continue;
      de.splice(s, 1), s--, n.flags & 4 && (n.flags &= -2), n(), n.flags & 4 || (n.flags &= -2);
    }
  }
}
function Si(e) {
  if (At.length) {
    const t = [...new Set(At)].sort(
      (s, n) => Jt(s) - Jt(n)
    );
    if (At.length = 0, lt) {
      lt.push(...t);
      return;
    }
    for (lt = t, wt = 0; wt < lt.length; wt++) {
      const s = lt[wt];
      s.flags & 4 && (s.flags &= -2), s.flags & 8 || s(), s.flags &= -2;
    }
    lt = null, wt = 0;
  }
}
const Jt = (e) => e.id == null ? e.flags & 2 ? -1 : 1 / 0 : e.id;
function Ti(e) {
  try {
    for (Ue = 0; Ue < de.length; Ue++) {
      const t = de[Ue];
      t && !(t.flags & 8) && (t.flags & 4 && (t.flags &= -2), Qt(
        t,
        t.i,
        t.i ? 15 : 14
      ), t.flags & 4 || (t.flags &= -2));
    }
  } finally {
    for (; Ue < de.length; Ue++) {
      const t = de[Ue];
      t && (t.flags &= -2);
    }
    Ue = -1, de.length = 0, Si(), ps = null, (de.length || At.length) && Ti();
  }
}
let Ae = null, Ci = null;
function hs(e) {
  const t = Ae;
  return Ae = e, Ci = e && e.type.__scopeId || null, t;
}
function zl(e, t = Ae, s) {
  if (!t || e._n)
    return e;
  const n = (...i) => {
    n._d && In(-1);
    const l = hs(t);
    let o;
    try {
      o = e(...i);
    } finally {
      hs(l), n._d && In(1);
    }
    return o;
  };
  return n._n = !0, n._c = !0, n._d = !0, n;
}
function Me(e, t) {
  if (Ae === null)
    return e;
  const s = Cs(Ae), n = e.dirs || (e.dirs = []);
  for (let i = 0; i < t.length; i++) {
    let [l, o, a, f = z] = t[i];
    l && (k(l) && (l = {
      mounted: l,
      updated: l
    }), l.deep && Ye(o), n.push({
      dir: l,
      instance: s,
      value: o,
      oldValue: void 0,
      arg: a,
      modifiers: f
    }));
  }
  return e;
}
function gt(e, t, s, n) {
  const i = e.dirs, l = t && t.dirs;
  for (let o = 0; o < i.length; o++) {
    const a = i[o];
    l && (a.oldValue = l[o].value);
    let f = a.dir[n];
    f && (Ze(), Ve(f, s, 8, [
      e.el,
      a,
      e,
      t
    ]), Qe());
  }
}
const Gl = Symbol("_vte"), Jl = (e) => e.__isTeleport;
function dn(e, t) {
  e.shapeFlag & 6 && e.component ? (e.transition = t, dn(e.component.subTree, t)) : e.shapeFlag & 128 ? (e.ssContent.transition = t.clone(e.ssContent), e.ssFallback.transition = t.clone(e.ssFallback)) : e.transition = t;
}
function Ai(e) {
  e.ids = [e.ids[0] + e.ids[2]++ + "-", 0, 0];
}
function Vt(e, t, s, n, i = !1) {
  if (P(e)) {
    e.forEach(
      (K, U) => Vt(
        K,
        t && (P(t) ? t[U] : t),
        s,
        n,
        i
      )
    );
    return;
  }
  if (Bt(n) && !i) {
    n.shapeFlag & 512 && n.type.__asyncResolved && n.component.subTree.component && Vt(e, t, s, n.component.subTree);
    return;
  }
  const l = n.shapeFlag & 4 ? Cs(n.component) : n.el, o = i ? null : l, { i: a, r: f } = e, g = t && t.r, p = a.refs === z ? a.refs = {} : a.refs, y = a.setupState, A = L(y), C = y === z ? () => !1 : (K) => V(A, K);
  if (g != null && g !== f && (ee(g) ? (p[g] = null, C(g) && (y[g] = null)) : ae(g) && (g.value = null)), k(f))
    Qt(f, a, 12, [o, p]);
  else {
    const K = ee(f), U = ae(f);
    if (K || U) {
      const Q = () => {
        if (e.f) {
          const j = K ? C(f) ? y[f] : p[f] : f.value;
          i ? P(j) && Zs(j, l) : P(j) ? j.includes(l) || j.push(l) : K ? (p[f] = [l], C(f) && (y[f] = p[f])) : (f.value = [l], e.k && (p[e.k] = f.value));
        } else K ? (p[f] = o, C(f) && (y[f] = o)) : U && (f.value = o, e.k && (p[e.k] = o));
      };
      o ? (Q.id = -1, we(Q, s)) : Q();
    }
  }
}
bs().requestIdleCallback;
bs().cancelIdleCallback;
const Bt = (e) => !!e.type.__asyncLoader, Ei = (e) => e.type.__isKeepAlive;
function Yl(e, t) {
  Oi(e, "a", t);
}
function Xl(e, t) {
  Oi(e, "da", t);
}
function Oi(e, t, s = he) {
  const n = e.__wdc || (e.__wdc = () => {
    let i = s;
    for (; i; ) {
      if (i.isDeactivated)
        return;
      i = i.parent;
    }
    return e();
  });
  if (ws(t, n, s), s) {
    let i = s.parent;
    for (; i && i.parent; )
      Ei(i.parent.vnode) && Zl(n, t, s, i), i = i.parent;
  }
}
function Zl(e, t, s, n) {
  const i = ws(
    t,
    e,
    n,
    !0
    /* prepend */
  );
  Pi(() => {
    Zs(n[t], i);
  }, s);
}
function ws(e, t, s = he, n = !1) {
  if (s) {
    const i = s[e] || (s[e] = []), l = t.__weh || (t.__weh = (...o) => {
      Ze();
      const a = es(s), f = Ve(t, s, e, o);
      return a(), Qe(), f;
    });
    return n ? i.unshift(l) : i.push(l), l;
  }
}
const et = (e) => (t, s = he) => {
  (!Xt || e === "sp") && ws(e, (...n) => t(...n), s);
}, Ql = et("bm"), Mi = et("m"), eo = et(
  "bu"
), to = et("u"), so = et(
  "bum"
), Pi = et("um"), no = et(
  "sp"
), io = et("rtg"), lo = et("rtc");
function oo(e, t = he) {
  ws("ec", e, t);
}
const ro = Symbol.for("v-ndc");
function Ut(e, t, s, n) {
  let i;
  const l = s, o = P(e);
  if (o || ee(e)) {
    const a = o && Ct(e);
    let f = !1, g = !1;
    a && (f = !Ee(e), g = ut(e), e = _s(e)), i = new Array(e.length);
    for (let p = 0, y = e.length; p < y; p++)
      i[p] = t(
        f ? g ? fs(le(e[p])) : le(e[p]) : e[p],
        p,
        void 0,
        l
      );
  } else if (typeof e == "number") {
    i = new Array(e);
    for (let a = 0; a < e; a++)
      i[a] = t(a + 1, a, void 0, l);
  } else if (Z(e))
    if (e[Symbol.iterator])
      i = Array.from(
        e,
        (a, f) => t(a, f, void 0, l)
      );
    else {
      const a = Object.keys(e);
      i = new Array(a.length);
      for (let f = 0, g = a.length; f < g; f++) {
        const p = a[f];
        i[f] = t(e[p], p, f, l);
      }
    }
  else
    i = [];
  return i;
}
const Bs = (e) => e ? Xi(e) ? Cs(e) : Bs(e.parent) : null, Wt = (
  // Move PURE marker to new line to workaround compiler discarding it
  // due to type annotation
  /* @__PURE__ */ ge(/* @__PURE__ */ Object.create(null), {
    $: (e) => e,
    $el: (e) => e.vnode.el,
    $data: (e) => e.data,
    $props: (e) => e.props,
    $attrs: (e) => e.attrs,
    $slots: (e) => e.slots,
    $refs: (e) => e.refs,
    $parent: (e) => Bs(e.parent),
    $root: (e) => Bs(e.root),
    $host: (e) => e.ce,
    $emit: (e) => e.emit,
    $options: (e) => Ri(e),
    $forceUpdate: (e) => e.f || (e.f = () => {
      fn(e.update);
    }),
    $nextTick: (e) => e.n || (e.n = xi.bind(e.proxy)),
    $watch: (e) => Po.bind(e)
  })
), Rs = (e, t) => e !== z && !e.__isScriptSetup && V(e, t), ao = {
  get({ _: e }, t) {
    if (t === "__v_skip")
      return !0;
    const { ctx: s, setupState: n, data: i, props: l, accessCache: o, type: a, appContext: f } = e;
    let g;
    if (t[0] !== "$") {
      const C = o[t];
      if (C !== void 0)
        switch (C) {
          case 1:
            return n[t];
          case 2:
            return i[t];
          case 4:
            return s[t];
          case 3:
            return l[t];
        }
      else {
        if (Rs(n, t))
          return o[t] = 1, n[t];
        if (i !== z && V(i, t))
          return o[t] = 2, i[t];
        if (
          // only cache other properties when instance has declared (thus stable)
          // props
          (g = e.propsOptions[0]) && V(g, t)
        )
          return o[t] = 3, l[t];
        if (s !== z && V(s, t))
          return o[t] = 4, s[t];
        Ws && (o[t] = 0);
      }
    }
    const p = Wt[t];
    let y, A;
    if (p)
      return t === "$attrs" && re(e.attrs, "get", ""), p(e);
    if (
      // css module (injected by vue-loader)
      (y = a.__cssModules) && (y = y[t])
    )
      return y;
    if (s !== z && V(s, t))
      return o[t] = 4, s[t];
    if (
      // global properties
      A = f.config.globalProperties, V(A, t)
    )
      return A[t];
  },
  set({ _: e }, t, s) {
    const { data: n, setupState: i, ctx: l } = e;
    return Rs(i, t) ? (i[t] = s, !0) : n !== z && V(n, t) ? (n[t] = s, !0) : V(e.props, t) || t[0] === "$" && t.slice(1) in e ? !1 : (l[t] = s, !0);
  },
  has({
    _: { data: e, setupState: t, accessCache: s, ctx: n, appContext: i, propsOptions: l }
  }, o) {
    let a;
    return !!s[o] || e !== z && V(e, o) || Rs(t, o) || (a = l[0]) && V(a, o) || V(n, o) || V(Wt, o) || V(i.config.globalProperties, o);
  },
  defineProperty(e, t, s) {
    return s.get != null ? e._.accessCache[t] = 0 : V(s, "value") && this.set(e, t, s.value, null), Reflect.defineProperty(e, t, s);
  }
};
function Sn(e) {
  return P(e) ? e.reduce(
    (t, s) => (t[s] = null, t),
    {}
  ) : e;
}
let Ws = !0;
function uo(e) {
  const t = Ri(e), s = e.proxy, n = e.ctx;
  Ws = !1, t.beforeCreate && Tn(t.beforeCreate, e, "bc");
  const {
    // state
    data: i,
    computed: l,
    methods: o,
    watch: a,
    provide: f,
    inject: g,
    // lifecycle
    created: p,
    beforeMount: y,
    mounted: A,
    beforeUpdate: C,
    updated: K,
    activated: U,
    deactivated: Q,
    beforeDestroy: j,
    beforeUnmount: G,
    destroyed: J,
    unmounted: M,
    render: W,
    renderTracked: ye,
    renderTriggered: oe,
    errorCaptured: be,
    serverPrefetch: tt,
    // public API
    expose: Te,
    inheritAttrs: Be,
    // assets
    components: pt,
    directives: st,
    filters: It
  } = t;
  if (g && co(g, n, null), o)
    for (const q in o) {
      const H = o[q];
      k(H) && (n[q] = H.bind(s));
    }
  if (i) {
    const q = i.call(s, s);
    Z(q) && (e.data = an(q));
  }
  if (Ws = !0, l)
    for (const q in l) {
      const H = l[q], Re = k(H) ? H.bind(s, s) : k(H.get) ? H.get.bind(s, s) : $e, nt = !k(H) && k(H.set) ? H.set.bind(s) : $e, We = Pe({
        get: Re,
        set: nt
      });
      Object.defineProperty(n, q, {
        enumerable: !0,
        configurable: !0,
        get: () => We.value,
        set: (Ce) => We.value = Ce
      });
    }
  if (a)
    for (const q in a)
      Ii(a[q], n, s, q);
  if (f) {
    const q = k(f) ? f.call(s) : f;
    Reflect.ownKeys(q).forEach((H) => {
      mo(H, q[H]);
    });
  }
  p && Tn(p, e, "c");
  function te(q, H) {
    P(H) ? H.forEach((Re) => q(Re.bind(s))) : H && q(H.bind(s));
  }
  if (te(Ql, y), te(Mi, A), te(eo, C), te(to, K), te(Yl, U), te(Xl, Q), te(oo, be), te(lo, ye), te(io, oe), te(so, G), te(Pi, M), te(no, tt), P(Te))
    if (Te.length) {
      const q = e.exposed || (e.exposed = {});
      Te.forEach((H) => {
        Object.defineProperty(q, H, {
          get: () => s[H],
          set: (Re) => s[H] = Re,
          enumerable: !0
        });
      });
    } else e.exposed || (e.exposed = {});
  W && e.render === $e && (e.render = W), Be != null && (e.inheritAttrs = Be), pt && (e.components = pt), st && (e.directives = st), tt && Ai(e);
}
function co(e, t, s = $e) {
  P(e) && (e = qs(e));
  for (const n in e) {
    const i = e[n];
    let l;
    Z(i) ? "default" in i ? l = os(
      i.from || n,
      i.default,
      !0
    ) : l = os(i.from || n) : l = os(i), ae(l) ? Object.defineProperty(t, n, {
      enumerable: !0,
      configurable: !0,
      get: () => l.value,
      set: (o) => l.value = o
    }) : t[n] = l;
  }
}
function Tn(e, t, s) {
  Ve(
    P(e) ? e.map((n) => n.bind(t.proxy)) : e.bind(t.proxy),
    t,
    s
  );
}
function Ii(e, t, s, n) {
  let i = n.includes(".") ? Wi(s, n) : () => s[n];
  if (ee(e)) {
    const l = t[e];
    k(l) && Ds(i, l);
  } else if (k(e))
    Ds(i, e.bind(s));
  else if (Z(e))
    if (P(e))
      e.forEach((l) => Ii(l, t, s, n));
    else {
      const l = k(e.handler) ? e.handler.bind(s) : t[e.handler];
      k(l) && Ds(i, l, e);
    }
}
function Ri(e) {
  const t = e.type, { mixins: s, extends: n } = t, {
    mixins: i,
    optionsCache: l,
    config: { optionMergeStrategies: o }
  } = e.appContext, a = l.get(t);
  let f;
  return a ? f = a : !i.length && !s && !n ? f = t : (f = {}, i.length && i.forEach(
    (g) => gs(f, g, o, !0)
  ), gs(f, t, o)), Z(t) && l.set(t, f), f;
}
function gs(e, t, s, n = !1) {
  const { mixins: i, extends: l } = t;
  l && gs(e, l, s, !0), i && i.forEach(
    (o) => gs(e, o, s, !0)
  );
  for (const o in t)
    if (!(n && o === "expose")) {
      const a = fo[o] || s && s[o];
      e[o] = a ? a(e[o], t[o]) : t[o];
    }
  return e;
}
const fo = {
  data: Cn,
  props: An,
  emits: An,
  // objects
  methods: jt,
  computed: jt,
  // lifecycle
  beforeCreate: ce,
  created: ce,
  beforeMount: ce,
  mounted: ce,
  beforeUpdate: ce,
  updated: ce,
  beforeDestroy: ce,
  beforeUnmount: ce,
  destroyed: ce,
  unmounted: ce,
  activated: ce,
  deactivated: ce,
  errorCaptured: ce,
  serverPrefetch: ce,
  // assets
  components: jt,
  directives: jt,
  // watch
  watch: ho,
  // provide / inject
  provide: Cn,
  inject: po
};
function Cn(e, t) {
  return t ? e ? function() {
    return ge(
      k(e) ? e.call(this, this) : e,
      k(t) ? t.call(this, this) : t
    );
  } : t : e;
}
function po(e, t) {
  return jt(qs(e), qs(t));
}
function qs(e) {
  if (P(e)) {
    const t = {};
    for (let s = 0; s < e.length; s++)
      t[e[s]] = e[s];
    return t;
  }
  return e;
}
function ce(e, t) {
  return e ? [...new Set([].concat(e, t))] : t;
}
function jt(e, t) {
  return e ? ge(/* @__PURE__ */ Object.create(null), e, t) : t;
}
function An(e, t) {
  return e ? P(e) && P(t) ? [.../* @__PURE__ */ new Set([...e, ...t])] : ge(
    /* @__PURE__ */ Object.create(null),
    Sn(e),
    Sn(t ?? {})
  ) : t;
}
function ho(e, t) {
  if (!e) return t;
  if (!t) return e;
  const s = ge(/* @__PURE__ */ Object.create(null), e);
  for (const n in t)
    s[n] = ce(e[n], t[n]);
  return s;
}
function ki() {
  return {
    app: null,
    config: {
      isNativeTag: nl,
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
let go = 0;
function vo(e, t) {
  return function(n, i = null) {
    k(n) || (n = ge({}, n)), i != null && !Z(i) && (i = null);
    const l = ki(), o = /* @__PURE__ */ new WeakSet(), a = [];
    let f = !1;
    const g = l.app = {
      _uid: go++,
      _component: n,
      _props: i,
      _container: null,
      _context: l,
      _instance: null,
      version: Qo,
      get config() {
        return l.config;
      },
      set config(p) {
      },
      use(p, ...y) {
        return o.has(p) || (p && k(p.install) ? (o.add(p), p.install(g, ...y)) : k(p) && (o.add(p), p(g, ...y))), g;
      },
      mixin(p) {
        return l.mixins.includes(p) || l.mixins.push(p), g;
      },
      component(p, y) {
        return y ? (l.components[p] = y, g) : l.components[p];
      },
      directive(p, y) {
        return y ? (l.directives[p] = y, g) : l.directives[p];
      },
      mount(p, y, A) {
        if (!f) {
          const C = g._ceVNode || He(n, i);
          return C.appContext = l, A === !0 ? A = "svg" : A === !1 && (A = void 0), e(C, p, A), f = !0, g._container = p, p.__vue_app__ = g, Cs(C.component);
        }
      },
      onUnmount(p) {
        a.push(p);
      },
      unmount() {
        f && (Ve(
          a,
          g._instance,
          16
        ), e(null, g._container), delete g._container.__vue_app__);
      },
      provide(p, y) {
        return l.provides[p] = y, g;
      },
      runWithContext(p) {
        const y = Et;
        Et = g;
        try {
          return p();
        } finally {
          Et = y;
        }
      }
    };
    return g;
  };
}
let Et = null;
function mo(e, t) {
  if (he) {
    let s = he.provides;
    const n = he.parent && he.parent.provides;
    n === s && (s = he.provides = Object.create(n)), s[e] = t;
  }
}
function os(e, t, s = !1) {
  const n = zo();
  if (n || Et) {
    let i = Et ? Et._context.provides : n ? n.parent == null || n.ce ? n.vnode.appContext && n.vnode.appContext.provides : n.parent.provides : void 0;
    if (i && e in i)
      return i[e];
    if (arguments.length > 1)
      return s && k(t) ? t.call(n && n.proxy) : t;
  }
}
const Di = {}, Fi = () => Object.create(Di), Ki = (e) => Object.getPrototypeOf(e) === Di;
function yo(e, t, s, n = !1) {
  const i = {}, l = Fi();
  e.propsDefaults = /* @__PURE__ */ Object.create(null), Ui(e, t, i, l);
  for (const o in e.propsOptions[0])
    o in i || (i[o] = void 0);
  s ? e.props = n ? i : Fl(i) : e.type.props ? e.props = i : e.props = l, e.attrs = l;
}
function bo(e, t, s, n) {
  const {
    props: i,
    attrs: l,
    vnode: { patchFlag: o }
  } = e, a = L(i), [f] = e.propsOptions;
  let g = !1;
  if (
    // always force full diff in dev
    // - #1942 if hmr is enabled with sfc component
    // - vite#872 non-sfc component used by sfc component
    (n || o > 0) && !(o & 16)
  ) {
    if (o & 8) {
      const p = e.vnode.dynamicProps;
      for (let y = 0; y < p.length; y++) {
        let A = p[y];
        if (Ss(e.emitsOptions, A))
          continue;
        const C = t[A];
        if (f)
          if (V(l, A))
            C !== l[A] && (l[A] = C, g = !0);
          else {
            const K = at(A);
            i[K] = zs(
              f,
              a,
              K,
              C,
              e,
              !1
            );
          }
        else
          C !== l[A] && (l[A] = C, g = !0);
      }
    }
  } else {
    Ui(e, t, i, l) && (g = !0);
    let p;
    for (const y in a)
      (!t || // for camelCase
      !V(t, y) && // it's possible the original props was passed in as kebab-case
      // and converted to camelCase (#955)
      ((p = dt(y)) === y || !V(t, p))) && (f ? s && // for camelCase
      (s[y] !== void 0 || // for kebab-case
      s[p] !== void 0) && (i[y] = zs(
        f,
        a,
        y,
        void 0,
        e,
        !0
      )) : delete i[y]);
    if (l !== a)
      for (const y in l)
        (!t || !V(t, y)) && (delete l[y], g = !0);
  }
  g && Je(e.attrs, "set", "");
}
function Ui(e, t, s, n) {
  const [i, l] = e.propsOptions;
  let o = !1, a;
  if (t)
    for (let f in t) {
      if ($t(f))
        continue;
      const g = t[f];
      let p;
      i && V(i, p = at(f)) ? !l || !l.includes(p) ? s[p] = g : (a || (a = {}))[p] = g : Ss(e.emitsOptions, f) || (!(f in n) || g !== n[f]) && (n[f] = g, o = !0);
    }
  if (l) {
    const f = L(s), g = a || z;
    for (let p = 0; p < l.length; p++) {
      const y = l[p];
      s[y] = zs(
        i,
        f,
        y,
        g[y],
        e,
        !V(g, y)
      );
    }
  }
  return o;
}
function zs(e, t, s, n, i, l) {
  const o = e[s];
  if (o != null) {
    const a = V(o, "default");
    if (a && n === void 0) {
      const f = o.default;
      if (o.type !== Function && !o.skipFactory && k(f)) {
        const { propsDefaults: g } = i;
        if (s in g)
          n = g[s];
        else {
          const p = es(i);
          n = g[s] = f.call(
            null,
            t
          ), p();
        }
      } else
        n = f;
      i.ce && i.ce._setProp(s, n);
    }
    o[
      0
      /* shouldCast */
    ] && (l && !a ? n = !1 : o[
      1
      /* shouldCastTrue */
    ] && (n === "" || n === dt(s)) && (n = !0));
  }
  return n;
}
const _o = /* @__PURE__ */ new WeakMap();
function Ni(e, t, s = !1) {
  const n = s ? _o : t.propsCache, i = n.get(e);
  if (i)
    return i;
  const l = e.props, o = {}, a = [];
  let f = !1;
  if (!k(e)) {
    const p = (y) => {
      f = !0;
      const [A, C] = Ni(y, t, !0);
      ge(o, A), C && a.push(...C);
    };
    !s && t.mixins.length && t.mixins.forEach(p), e.extends && p(e.extends), e.mixins && e.mixins.forEach(p);
  }
  if (!l && !f)
    return Z(e) && n.set(e, St), St;
  if (P(l))
    for (let p = 0; p < l.length; p++) {
      const y = at(l[p]);
      En(y) && (o[y] = z);
    }
  else if (l)
    for (const p in l) {
      const y = at(p);
      if (En(y)) {
        const A = l[p], C = o[y] = P(A) || k(A) ? { type: A } : ge({}, A), K = C.type;
        let U = !1, Q = !0;
        if (P(K))
          for (let j = 0; j < K.length; ++j) {
            const G = K[j], J = k(G) && G.name;
            if (J === "Boolean") {
              U = !0;
              break;
            } else J === "String" && (Q = !1);
          }
        else
          U = k(K) && K.name === "Boolean";
        C[
          0
          /* shouldCast */
        ] = U, C[
          1
          /* shouldCastTrue */
        ] = Q, (U || V(C, "default")) && a.push(y);
      }
    }
  const g = [o, a];
  return Z(e) && n.set(e, g), g;
}
function En(e) {
  return e[0] !== "$" && !$t(e);
}
const pn = (e) => e === "_" || e === "__" || e === "_ctx" || e === "$stable", hn = (e) => P(e) ? e.map(je) : [je(e)], xo = (e, t, s) => {
  if (t._n)
    return t;
  const n = zl((...i) => hn(t(...i)), s);
  return n._c = !1, n;
}, ji = (e, t, s) => {
  const n = e._ctx;
  for (const i in e) {
    if (pn(i)) continue;
    const l = e[i];
    if (k(l))
      t[i] = xo(i, l, n);
    else if (l != null) {
      const o = hn(l);
      t[i] = () => o;
    }
  }
}, $i = (e, t) => {
  const s = hn(t);
  e.slots.default = () => s;
}, Hi = (e, t, s) => {
  for (const n in t)
    (s || !pn(n)) && (e[n] = t[n]);
}, wo = (e, t, s) => {
  const n = e.slots = Fi();
  if (e.vnode.shapeFlag & 32) {
    const i = t.__;
    i && js(n, "__", i, !0);
    const l = t._;
    l ? (Hi(n, t, s), s && js(n, "_", l, !0)) : ji(t, n);
  } else t && $i(e, t);
}, So = (e, t, s) => {
  const { vnode: n, slots: i } = e;
  let l = !0, o = z;
  if (n.shapeFlag & 32) {
    const a = t._;
    a ? s && a === 1 ? l = !1 : Hi(i, t, s) : (l = !t.$stable, ji(t, i)), o = t;
  } else t && ($i(e, t), o = { default: 1 });
  if (l)
    for (const a in i)
      !pn(a) && o[a] == null && delete i[a];
}, we = Uo;
function To(e) {
  return Co(e);
}
function Co(e, t) {
  const s = bs();
  s.__VUE__ = !0;
  const {
    insert: n,
    remove: i,
    patchProp: l,
    createElement: o,
    createText: a,
    createComment: f,
    setText: g,
    setElementText: p,
    parentNode: y,
    nextSibling: A,
    setScopeId: C = $e,
    insertStaticContent: K
  } = e, U = (u, d, v, x = null, b = null, _ = null, S = void 0, h = null, r = !!d.dynamicChildren) => {
    if (u === d)
      return;
    u && !Nt(u, d) && (x = it(u), Ce(u, b, _, !0), u = null), d.patchFlag === -2 && (r = !1, d.dynamicChildren = null);
    const { type: m, ref: E, shapeFlag: T } = d;
    switch (m) {
      case Ts:
        Q(u, d, v, x);
        break;
      case ct:
        j(u, d, v, x);
        break;
      case rs:
        u == null && G(d, v, x, S);
        break;
      case pe:
        pt(
          u,
          d,
          v,
          x,
          b,
          _,
          S,
          h,
          r
        );
        break;
      default:
        T & 1 ? W(
          u,
          d,
          v,
          x,
          b,
          _,
          S,
          h,
          r
        ) : T & 6 ? st(
          u,
          d,
          v,
          x,
          b,
          _,
          S,
          h,
          r
        ) : (T & 64 || T & 128) && m.process(
          u,
          d,
          v,
          x,
          b,
          _,
          S,
          h,
          r,
          ve
        );
    }
    E != null && b ? Vt(E, u && u.ref, _, d || u, !d) : E == null && u && u.ref != null && Vt(u.ref, null, _, u, !0);
  }, Q = (u, d, v, x) => {
    if (u == null)
      n(
        d.el = a(d.children),
        v,
        x
      );
    else {
      const b = d.el = u.el;
      d.children !== u.children && g(b, d.children);
    }
  }, j = (u, d, v, x) => {
    u == null ? n(
      d.el = f(d.children || ""),
      v,
      x
    ) : d.el = u.el;
  }, G = (u, d, v, x) => {
    [u.el, u.anchor] = K(
      u.children,
      d,
      v,
      x,
      u.el,
      u.anchor
    );
  }, J = ({ el: u, anchor: d }, v, x) => {
    let b;
    for (; u && u !== d; )
      b = A(u), n(u, v, x), u = b;
    n(d, v, x);
  }, M = ({ el: u, anchor: d }) => {
    let v;
    for (; u && u !== d; )
      v = A(u), i(u), u = v;
    i(d);
  }, W = (u, d, v, x, b, _, S, h, r) => {
    d.type === "svg" ? S = "svg" : d.type === "math" && (S = "mathml"), u == null ? ye(
      d,
      v,
      x,
      b,
      _,
      S,
      h,
      r
    ) : tt(
      u,
      d,
      b,
      _,
      S,
      h,
      r
    );
  }, ye = (u, d, v, x, b, _, S, h) => {
    let r, m;
    const { props: E, shapeFlag: T, transition: O, dirs: I } = u;
    if (r = u.el = o(
      u.type,
      _,
      E && E.is,
      E
    ), T & 8 ? p(r, u.children) : T & 16 && be(
      u.children,
      r,
      null,
      x,
      b,
      ks(u, _),
      S,
      h
    ), I && gt(u, null, x, "created"), oe(r, u, u.scopeId, S, x), E) {
      for (const B in E)
        B !== "value" && !$t(B) && l(r, B, null, E[B], _, x);
      "value" in E && l(r, "value", null, E.value, _), (m = E.onVnodeBeforeMount) && Ke(m, x, u);
    }
    I && gt(u, null, x, "beforeMount");
    const N = Ao(b, O);
    N && O.beforeEnter(r), n(r, d, v), ((m = E && E.onVnodeMounted) || N || I) && we(() => {
      m && Ke(m, x, u), N && O.enter(r), I && gt(u, null, x, "mounted");
    }, b);
  }, oe = (u, d, v, x, b) => {
    if (v && C(u, v), x)
      for (let _ = 0; _ < x.length; _++)
        C(u, x[_]);
    if (b) {
      let _ = b.subTree;
      if (d === _ || zi(_.type) && (_.ssContent === d || _.ssFallback === d)) {
        const S = b.vnode;
        oe(
          u,
          S,
          S.scopeId,
          S.slotScopeIds,
          b.parent
        );
      }
    }
  }, be = (u, d, v, x, b, _, S, h, r = 0) => {
    for (let m = r; m < u.length; m++) {
      const E = u[m] = h ? ot(u[m]) : je(u[m]);
      U(
        null,
        E,
        d,
        v,
        x,
        b,
        _,
        S,
        h
      );
    }
  }, tt = (u, d, v, x, b, _, S) => {
    const h = d.el = u.el;
    let { patchFlag: r, dynamicChildren: m, dirs: E } = d;
    r |= u.patchFlag & 16;
    const T = u.props || z, O = d.props || z;
    let I;
    if (v && vt(v, !1), (I = O.onVnodeBeforeUpdate) && Ke(I, v, d, u), E && gt(d, u, v, "beforeUpdate"), v && vt(v, !0), (T.innerHTML && O.innerHTML == null || T.textContent && O.textContent == null) && p(h, ""), m ? Te(
      u.dynamicChildren,
      m,
      h,
      v,
      x,
      ks(d, b),
      _
    ) : S || H(
      u,
      d,
      h,
      null,
      v,
      x,
      ks(d, b),
      _,
      !1
    ), r > 0) {
      if (r & 16)
        Be(h, T, O, v, b);
      else if (r & 2 && T.class !== O.class && l(h, "class", null, O.class, b), r & 4 && l(h, "style", T.style, O.style, b), r & 8) {
        const N = d.dynamicProps;
        for (let B = 0; B < N.length; B++) {
          const $ = N[B], ne = T[$], ie = O[$];
          (ie !== ne || $ === "value") && l(h, $, ne, ie, b, v);
        }
      }
      r & 1 && u.children !== d.children && p(h, d.children);
    } else !S && m == null && Be(h, T, O, v, b);
    ((I = O.onVnodeUpdated) || E) && we(() => {
      I && Ke(I, v, d, u), E && gt(d, u, v, "updated");
    }, x);
  }, Te = (u, d, v, x, b, _, S) => {
    for (let h = 0; h < d.length; h++) {
      const r = u[h], m = d[h], E = (
        // oldVNode may be an errored async setup() component inside Suspense
        // which will not have a mounted element
        r.el && // - In the case of a Fragment, we need to provide the actual parent
        // of the Fragment itself so it can move its children.
        (r.type === pe || // - In the case of different nodes, there is going to be a replacement
        // which also requires the correct parent container
        !Nt(r, m) || // - In the case of a component, it could contain anything.
        r.shapeFlag & 198) ? y(r.el) : (
          // In other cases, the parent container is not actually used so we
          // just pass the block element here to avoid a DOM parentNode call.
          v
        )
      );
      U(
        r,
        m,
        E,
        null,
        x,
        b,
        _,
        S,
        !0
      );
    }
  }, Be = (u, d, v, x, b) => {
    if (d !== v) {
      if (d !== z)
        for (const _ in d)
          !$t(_) && !(_ in v) && l(
            u,
            _,
            d[_],
            null,
            b,
            x
          );
      for (const _ in v) {
        if ($t(_)) continue;
        const S = v[_], h = d[_];
        S !== h && _ !== "value" && l(u, _, h, S, b, x);
      }
      "value" in v && l(u, "value", d.value, v.value, b);
    }
  }, pt = (u, d, v, x, b, _, S, h, r) => {
    const m = d.el = u ? u.el : a(""), E = d.anchor = u ? u.anchor : a("");
    let { patchFlag: T, dynamicChildren: O, slotScopeIds: I } = d;
    I && (h = h ? h.concat(I) : I), u == null ? (n(m, v, x), n(E, v, x), be(
      // #10007
      // such fragment like `<></>` will be compiled into
      // a fragment which doesn't have a children.
      // In this case fallback to an empty array
      d.children || [],
      v,
      E,
      b,
      _,
      S,
      h,
      r
    )) : T > 0 && T & 64 && O && // #2715 the previous fragment could've been a BAILed one as a result
    // of renderSlot() with no valid children
    u.dynamicChildren ? (Te(
      u.dynamicChildren,
      O,
      v,
      b,
      _,
      S,
      h
    ), // #2080 if the stable fragment has a key, it's a <template v-for> that may
    //  get moved around. Make sure all root level vnodes inherit el.
    // #2134 or if it's a component root, it may also get moved around
    // as the component is being moved.
    (d.key != null || b && d === b.subTree) && Li(
      u,
      d,
      !0
      /* shallow */
    )) : H(
      u,
      d,
      v,
      E,
      b,
      _,
      S,
      h,
      r
    );
  }, st = (u, d, v, x, b, _, S, h, r) => {
    d.slotScopeIds = h, u == null ? d.shapeFlag & 512 ? b.ctx.activate(
      d,
      v,
      x,
      S,
      r
    ) : It(
      d,
      v,
      x,
      b,
      _,
      S,
      r
    ) : Rt(u, d, r);
  }, It = (u, d, v, x, b, _, S) => {
    const h = u.component = qo(
      u,
      x,
      b
    );
    if (Ei(u) && (h.ctx.renderer = ve), Go(h, !1, S), h.asyncDep) {
      if (b && b.registerDep(h, te, S), !u.el) {
        const r = h.subTree = He(ct);
        j(null, r, d, v), u.placeholder = r.el;
      }
    } else
      te(
        h,
        u,
        d,
        v,
        b,
        _,
        S
      );
  }, Rt = (u, d, v) => {
    const x = d.component = u.component;
    if (Fo(u, d, v))
      if (x.asyncDep && !x.asyncResolved) {
        q(x, d, v);
        return;
      } else
        x.next = d, x.update();
    else
      d.el = u.el, x.vnode = d;
  }, te = (u, d, v, x, b, _, S) => {
    const h = () => {
      if (u.isMounted) {
        let { next: T, bu: O, u: I, parent: N, vnode: B } = u;
        {
          const w = Vi(u);
          if (w) {
            T && (T.el = B.el, q(u, T, S)), w.asyncDep.then(() => {
              u.isUnmounted || h();
            });
            return;
          }
        }
        let $ = T, ne;
        vt(u, !1), T ? (T.el = B.el, q(u, T, S)) : T = B, O && ls(O), (ne = T.props && T.props.onVnodeBeforeUpdate) && Ke(ne, N, T, B), vt(u, !0);
        const ie = Mn(u), _e = u.subTree;
        u.subTree = ie, U(
          _e,
          ie,
          // parent may have changed if it's in a teleport
          y(_e.el),
          // anchor may have changed if it's in a fragment
          it(_e),
          u,
          b,
          _
        ), T.el = ie.el, $ === null && Ko(u, ie.el), I && we(I, b), (ne = T.props && T.props.onVnodeUpdated) && we(
          () => Ke(ne, N, T, B),
          b
        );
      } else {
        let T;
        const { el: O, props: I } = d, { bm: N, m: B, parent: $, root: ne, type: ie } = u, _e = Bt(d);
        vt(u, !1), N && ls(N), !_e && (T = I && I.onVnodeBeforeMount) && Ke(T, $, d), vt(u, !0);
        {
          ne.ce && // @ts-expect-error _def is private
          ne.ce._def.shadowRoot !== !1 && ne.ce._injectChildStyle(ie);
          const w = u.subTree = Mn(u);
          U(
            null,
            w,
            v,
            x,
            u,
            b,
            _
          ), d.el = w.el;
        }
        if (B && we(B, b), !_e && (T = I && I.onVnodeMounted)) {
          const w = d;
          we(
            () => Ke(T, $, w),
            b
          );
        }
        (d.shapeFlag & 256 || $ && Bt($.vnode) && $.vnode.shapeFlag & 256) && u.a && we(u.a, b), u.isMounted = !0, d = v = x = null;
      }
    };
    u.scope.on();
    const r = u.effect = new ni(h);
    u.scope.off();
    const m = u.update = r.run.bind(r), E = u.job = r.runIfDirty.bind(r);
    E.i = u, E.id = u.uid, r.scheduler = () => fn(E), vt(u, !0), m();
  }, q = (u, d, v) => {
    d.component = u;
    const x = u.vnode.props;
    u.vnode = d, u.next = null, bo(u, d.props, x, v), So(u, d.children, v), Ze(), wn(u), Qe();
  }, H = (u, d, v, x, b, _, S, h, r = !1) => {
    const m = u && u.children, E = u ? u.shapeFlag : 0, T = d.children, { patchFlag: O, shapeFlag: I } = d;
    if (O > 0) {
      if (O & 128) {
        nt(
          m,
          T,
          v,
          x,
          b,
          _,
          S,
          h,
          r
        );
        return;
      } else if (O & 256) {
        Re(
          m,
          T,
          v,
          x,
          b,
          _,
          S,
          h,
          r
        );
        return;
      }
    }
    I & 8 ? (E & 16 && ke(m, b, _), T !== m && p(v, T)) : E & 16 ? I & 16 ? nt(
      m,
      T,
      v,
      x,
      b,
      _,
      S,
      h,
      r
    ) : ke(m, b, _, !0) : (E & 8 && p(v, ""), I & 16 && be(
      T,
      v,
      x,
      b,
      _,
      S,
      h,
      r
    ));
  }, Re = (u, d, v, x, b, _, S, h, r) => {
    u = u || St, d = d || St;
    const m = u.length, E = d.length, T = Math.min(m, E);
    let O;
    for (O = 0; O < T; O++) {
      const I = d[O] = r ? ot(d[O]) : je(d[O]);
      U(
        u[O],
        I,
        v,
        null,
        b,
        _,
        S,
        h,
        r
      );
    }
    m > E ? ke(
      u,
      b,
      _,
      !0,
      !1,
      T
    ) : be(
      d,
      v,
      x,
      b,
      _,
      S,
      h,
      r,
      T
    );
  }, nt = (u, d, v, x, b, _, S, h, r) => {
    let m = 0;
    const E = d.length;
    let T = u.length - 1, O = E - 1;
    for (; m <= T && m <= O; ) {
      const I = u[m], N = d[m] = r ? ot(d[m]) : je(d[m]);
      if (Nt(I, N))
        U(
          I,
          N,
          v,
          null,
          b,
          _,
          S,
          h,
          r
        );
      else
        break;
      m++;
    }
    for (; m <= T && m <= O; ) {
      const I = u[T], N = d[O] = r ? ot(d[O]) : je(d[O]);
      if (Nt(I, N))
        U(
          I,
          N,
          v,
          null,
          b,
          _,
          S,
          h,
          r
        );
      else
        break;
      T--, O--;
    }
    if (m > T) {
      if (m <= O) {
        const I = O + 1, N = I < E ? d[I].el : x;
        for (; m <= O; )
          U(
            null,
            d[m] = r ? ot(d[m]) : je(d[m]),
            v,
            N,
            b,
            _,
            S,
            h,
            r
          ), m++;
      }
    } else if (m > O)
      for (; m <= T; )
        Ce(u[m], b, _, !0), m++;
    else {
      const I = m, N = m, B = /* @__PURE__ */ new Map();
      for (m = N; m <= O; m++) {
        const ue = d[m] = r ? ot(d[m]) : je(d[m]);
        ue.key != null && B.set(ue.key, m);
      }
      let $, ne = 0;
      const ie = O - N + 1;
      let _e = !1, w = 0;
      const De = new Array(ie);
      for (m = 0; m < ie; m++) De[m] = 0;
      for (m = I; m <= T; m++) {
        const ue = u[m];
        if (ne >= ie) {
          Ce(ue, b, _, !0);
          continue;
        }
        let Fe;
        if (ue.key != null)
          Fe = B.get(ue.key);
        else
          for ($ = N; $ <= O; $++)
            if (De[$ - N] === 0 && Nt(ue, d[$])) {
              Fe = $;
              break;
            }
        Fe === void 0 ? Ce(ue, b, _, !0) : (De[Fe - N] = m + 1, Fe >= w ? w = Fe : _e = !0, U(
          ue,
          d[Fe],
          v,
          null,
          b,
          _,
          S,
          h,
          r
        ), ne++);
      }
      const Ft = _e ? Eo(De) : St;
      for ($ = Ft.length - 1, m = ie - 1; m >= 0; m--) {
        const ue = N + m, Fe = d[ue], vn = d[ue + 1], mn = ue + 1 < E ? (
          // #13559, fallback to el placeholder for unresolved async component
          vn.el || vn.placeholder
        ) : x;
        De[m] === 0 ? U(
          null,
          Fe,
          v,
          mn,
          b,
          _,
          S,
          h,
          r
        ) : _e && ($ < 0 || m !== Ft[$] ? We(Fe, v, mn, 2) : $--);
      }
    }
  }, We = (u, d, v, x, b = null) => {
    const { el: _, type: S, transition: h, children: r, shapeFlag: m } = u;
    if (m & 6) {
      We(u.component.subTree, d, v, x);
      return;
    }
    if (m & 128) {
      u.suspense.move(d, v, x);
      return;
    }
    if (m & 64) {
      S.move(u, d, v, ve);
      return;
    }
    if (S === pe) {
      n(_, d, v);
      for (let T = 0; T < r.length; T++)
        We(r[T], d, v, x);
      n(u.anchor, d, v);
      return;
    }
    if (S === rs) {
      J(u, d, v);
      return;
    }
    if (x !== 2 && m & 1 && h)
      if (x === 0)
        h.beforeEnter(_), n(_, d, v), we(() => h.enter(_), b);
      else {
        const { leave: T, delayLeave: O, afterLeave: I } = h, N = () => {
          u.ctx.isUnmounted ? i(_) : n(_, d, v);
        }, B = () => {
          T(_, () => {
            N(), I && I();
          });
        };
        O ? O(_, N, B) : B();
      }
    else
      n(_, d, v);
  }, Ce = (u, d, v, x = !1, b = !1) => {
    const {
      type: _,
      props: S,
      ref: h,
      children: r,
      dynamicChildren: m,
      shapeFlag: E,
      patchFlag: T,
      dirs: O,
      cacheIndex: I
    } = u;
    if (T === -2 && (b = !1), h != null && (Ze(), Vt(h, null, v, u, !0), Qe()), I != null && (d.renderCache[I] = void 0), E & 256) {
      d.ctx.deactivate(u);
      return;
    }
    const N = E & 1 && O, B = !Bt(u);
    let $;
    if (B && ($ = S && S.onVnodeBeforeUnmount) && Ke($, d, u), E & 6)
      kt(u.component, v, x);
    else {
      if (E & 128) {
        u.suspense.unmount(v, x);
        return;
      }
      N && gt(u, null, d, "beforeUnmount"), E & 64 ? u.type.remove(
        u,
        d,
        v,
        ve,
        x
      ) : m && // #5154
      // when v-once is used inside a block, setBlockTracking(-1) marks the
      // parent block with hasOnce: true
      // so that it doesn't take the fast path during unmount - otherwise
      // components nested in v-once are never unmounted.
      !m.hasOnce && // #1153: fast path should not be taken for non-stable (v-for) fragments
      (_ !== pe || T > 0 && T & 64) ? ke(
        m,
        d,
        v,
        !1,
        !0
      ) : (_ === pe && T & 384 || !b && E & 16) && ke(r, d, v), x && ht(u);
    }
    (B && ($ = S && S.onVnodeUnmounted) || N) && we(() => {
      $ && Ke($, d, u), N && gt(u, null, d, "unmounted");
    }, v);
  }, ht = (u) => {
    const { type: d, el: v, anchor: x, transition: b } = u;
    if (d === pe) {
      qe(v, x);
      return;
    }
    if (d === rs) {
      M(u);
      return;
    }
    const _ = () => {
      i(v), b && !b.persisted && b.afterLeave && b.afterLeave();
    };
    if (u.shapeFlag & 1 && b && !b.persisted) {
      const { leave: S, delayLeave: h } = b, r = () => S(v, _);
      h ? h(u.el, _, r) : r();
    } else
      _();
  }, qe = (u, d) => {
    let v;
    for (; u !== d; )
      v = A(u), i(u), u = v;
    i(d);
  }, kt = (u, d, v) => {
    const {
      bum: x,
      scope: b,
      job: _,
      subTree: S,
      um: h,
      m: r,
      a: m,
      parent: E,
      slots: { __: T }
    } = u;
    On(r), On(m), x && ls(x), E && P(T) && T.forEach((O) => {
      E.renderCache[O] = void 0;
    }), b.stop(), _ && (_.flags |= 8, Ce(S, u, d, v)), h && we(h, d), we(() => {
      u.isUnmounted = !0;
    }, d), d && d.pendingBranch && !d.isUnmounted && u.asyncDep && !u.asyncResolved && u.suspenseId === d.pendingId && (d.deps--, d.deps === 0 && d.resolve());
  }, ke = (u, d, v, x = !1, b = !1, _ = 0) => {
    for (let S = _; S < u.length; S++)
      Ce(u[S], d, v, x, b);
  }, it = (u) => {
    if (u.shapeFlag & 6)
      return it(u.component.subTree);
    if (u.shapeFlag & 128)
      return u.suspense.next();
    const d = A(u.anchor || u.el), v = d && d[Gl];
    return v ? A(v) : d;
  };
  let Dt = !1;
  const _t = (u, d, v) => {
    u == null ? d._vnode && Ce(d._vnode, null, null, !0) : U(
      d._vnode || null,
      u,
      d,
      null,
      null,
      null,
      v
    ), d._vnode = u, Dt || (Dt = !0, wn(), Si(), Dt = !1);
  }, ve = {
    p: U,
    um: Ce,
    m: We,
    r: ht,
    mt: It,
    mc: be,
    pc: H,
    pbc: Te,
    n: it,
    o: e
  };
  return {
    render: _t,
    hydrate: void 0,
    createApp: vo(_t)
  };
}
function ks({ type: e, props: t }, s) {
  return s === "svg" && e === "foreignObject" || s === "mathml" && e === "annotation-xml" && t && t.encoding && t.encoding.includes("html") ? void 0 : s;
}
function vt({ effect: e, job: t }, s) {
  s ? (e.flags |= 32, t.flags |= 4) : (e.flags &= -33, t.flags &= -5);
}
function Ao(e, t) {
  return (!e || e && !e.pendingBranch) && t && !t.persisted;
}
function Li(e, t, s = !1) {
  const n = e.children, i = t.children;
  if (P(n) && P(i))
    for (let l = 0; l < n.length; l++) {
      const o = n[l];
      let a = i[l];
      a.shapeFlag & 1 && !a.dynamicChildren && ((a.patchFlag <= 0 || a.patchFlag === 32) && (a = i[l] = ot(i[l]), a.el = o.el), !s && a.patchFlag !== -2 && Li(o, a)), a.type === Ts && (a.el = o.el), a.type === ct && !a.el && (a.el = o.el);
    }
}
function Eo(e) {
  const t = e.slice(), s = [0];
  let n, i, l, o, a;
  const f = e.length;
  for (n = 0; n < f; n++) {
    const g = e[n];
    if (g !== 0) {
      if (i = s[s.length - 1], e[i] < g) {
        t[n] = i, s.push(n);
        continue;
      }
      for (l = 0, o = s.length - 1; l < o; )
        a = l + o >> 1, e[s[a]] < g ? l = a + 1 : o = a;
      g < e[s[l]] && (l > 0 && (t[n] = s[l - 1]), s[l] = n);
    }
  }
  for (l = s.length, o = s[l - 1]; l-- > 0; )
    s[l] = o, o = t[o];
  return s;
}
function Vi(e) {
  const t = e.subTree.component;
  if (t)
    return t.asyncDep && !t.asyncResolved ? t : Vi(t);
}
function On(e) {
  if (e)
    for (let t = 0; t < e.length; t++)
      e[t].flags |= 8;
}
const Oo = Symbol.for("v-scx"), Mo = () => os(Oo);
function Ds(e, t, s) {
  return Bi(e, t, s);
}
function Bi(e, t, s = z) {
  const { immediate: n, deep: i, flush: l, once: o } = s, a = ge({}, s), f = t && n || !t && l !== "post";
  let g;
  if (Xt) {
    if (l === "sync") {
      const C = Mo();
      g = C.__watcherHandles || (C.__watcherHandles = []);
    } else if (!f) {
      const C = () => {
      };
      return C.stop = $e, C.resume = $e, C.pause = $e, C;
    }
  }
  const p = he;
  a.call = (C, K, U) => Ve(C, p, K, U);
  let y = !1;
  l === "post" ? a.scheduler = (C) => {
    we(C, p && p.suspense);
  } : l !== "sync" && (y = !0, a.scheduler = (C, K) => {
    K ? C() : fn(C);
  }), a.augmentJob = (C) => {
    t && (C.flags |= 4), y && (C.flags |= 2, p && (C.id = p.uid, C.i = p));
  };
  const A = Vl(e, t, a);
  return Xt && (g ? g.push(A) : f && A()), A;
}
function Po(e, t, s) {
  const n = this.proxy, i = ee(e) ? e.includes(".") ? Wi(n, e) : () => n[e] : e.bind(n, n);
  let l;
  k(t) ? l = t : (l = t.handler, s = t);
  const o = es(this), a = Bi(i, l.bind(n), s);
  return o(), a;
}
function Wi(e, t) {
  const s = t.split(".");
  return () => {
    let n = e;
    for (let i = 0; i < s.length && n; i++)
      n = n[s[i]];
    return n;
  };
}
const Io = (e, t) => t === "modelValue" || t === "model-value" ? e.modelModifiers : e[`${t}Modifiers`] || e[`${at(t)}Modifiers`] || e[`${dt(t)}Modifiers`];
function Ro(e, t, ...s) {
  if (e.isUnmounted) return;
  const n = e.vnode.props || z;
  let i = s;
  const l = t.startsWith("update:"), o = l && Io(n, t.slice(7));
  o && (o.trim && (i = s.map((p) => ee(p) ? p.trim() : p)), o.number && (i = s.map(cs)));
  let a, f = n[a = Es(t)] || // also try camelCase event handler (#2249)
  n[a = Es(at(t))];
  !f && l && (f = n[a = Es(dt(t))]), f && Ve(
    f,
    e,
    6,
    i
  );
  const g = n[a + "Once"];
  if (g) {
    if (!e.emitted)
      e.emitted = {};
    else if (e.emitted[a])
      return;
    e.emitted[a] = !0, Ve(
      g,
      e,
      6,
      i
    );
  }
}
function qi(e, t, s = !1) {
  const n = t.emitsCache, i = n.get(e);
  if (i !== void 0)
    return i;
  const l = e.emits;
  let o = {}, a = !1;
  if (!k(e)) {
    const f = (g) => {
      const p = qi(g, t, !0);
      p && (a = !0, ge(o, p));
    };
    !s && t.mixins.length && t.mixins.forEach(f), e.extends && f(e.extends), e.mixins && e.mixins.forEach(f);
  }
  return !l && !a ? (Z(e) && n.set(e, null), null) : (P(l) ? l.forEach((f) => o[f] = null) : ge(o, l), Z(e) && n.set(e, o), o);
}
function Ss(e, t) {
  return !e || !ms(t) ? !1 : (t = t.slice(2).replace(/Once$/, ""), V(e, t[0].toLowerCase() + t.slice(1)) || V(e, dt(t)) || V(e, t));
}
function Mn(e) {
  const {
    type: t,
    vnode: s,
    proxy: n,
    withProxy: i,
    propsOptions: [l],
    slots: o,
    attrs: a,
    emit: f,
    render: g,
    renderCache: p,
    props: y,
    data: A,
    setupState: C,
    ctx: K,
    inheritAttrs: U
  } = e, Q = hs(e);
  let j, G;
  try {
    if (s.shapeFlag & 4) {
      const M = i || n, W = M;
      j = je(
        g.call(
          W,
          M,
          p,
          y,
          C,
          A,
          K
        )
      ), G = a;
    } else {
      const M = t;
      j = je(
        M.length > 1 ? M(
          y,
          { attrs: a, slots: o, emit: f }
        ) : M(
          y,
          null
        )
      ), G = t.props ? a : ko(a);
    }
  } catch (M) {
    qt.length = 0, xs(M, e, 1), j = He(ct);
  }
  let J = j;
  if (G && U !== !1) {
    const M = Object.keys(G), { shapeFlag: W } = J;
    M.length && W & 7 && (l && M.some(Xs) && (G = Do(
      G,
      l
    )), J = Ot(J, G, !1, !0));
  }
  return s.dirs && (J = Ot(J, null, !1, !0), J.dirs = J.dirs ? J.dirs.concat(s.dirs) : s.dirs), s.transition && dn(J, s.transition), j = J, hs(Q), j;
}
const ko = (e) => {
  let t;
  for (const s in e)
    (s === "class" || s === "style" || ms(s)) && ((t || (t = {}))[s] = e[s]);
  return t;
}, Do = (e, t) => {
  const s = {};
  for (const n in e)
    (!Xs(n) || !(n.slice(9) in t)) && (s[n] = e[n]);
  return s;
};
function Fo(e, t, s) {
  const { props: n, children: i, component: l } = e, { props: o, children: a, patchFlag: f } = t, g = l.emitsOptions;
  if (t.dirs || t.transition)
    return !0;
  if (s && f >= 0) {
    if (f & 1024)
      return !0;
    if (f & 16)
      return n ? Pn(n, o, g) : !!o;
    if (f & 8) {
      const p = t.dynamicProps;
      for (let y = 0; y < p.length; y++) {
        const A = p[y];
        if (o[A] !== n[A] && !Ss(g, A))
          return !0;
      }
    }
  } else
    return (i || a) && (!a || !a.$stable) ? !0 : n === o ? !1 : n ? o ? Pn(n, o, g) : !0 : !!o;
  return !1;
}
function Pn(e, t, s) {
  const n = Object.keys(t);
  if (n.length !== Object.keys(e).length)
    return !0;
  for (let i = 0; i < n.length; i++) {
    const l = n[i];
    if (t[l] !== e[l] && !Ss(s, l))
      return !0;
  }
  return !1;
}
function Ko({ vnode: e, parent: t }, s) {
  for (; t; ) {
    const n = t.subTree;
    if (n.suspense && n.suspense.activeBranch === e && (n.el = e.el), n === e)
      (e = t.vnode).el = s, t = t.parent;
    else
      break;
  }
}
const zi = (e) => e.__isSuspense;
function Uo(e, t) {
  t && t.pendingBranch ? P(e) ? t.effects.push(...e) : t.effects.push(e) : ql(e);
}
const pe = Symbol.for("v-fgt"), Ts = Symbol.for("v-txt"), ct = Symbol.for("v-cmt"), rs = Symbol.for("v-stc"), qt = [];
let Se = null;
function D(e = !1) {
  qt.push(Se = e ? null : []);
}
function No() {
  qt.pop(), Se = qt[qt.length - 1] || null;
}
let Yt = 1;
function In(e, t = !1) {
  Yt += e, e < 0 && Se && t && (Se.hasOnce = !0);
}
function Gi(e) {
  return e.dynamicChildren = Yt > 0 ? Se || St : null, No(), Yt > 0 && Se && Se.push(e), e;
}
function F(e, t, s, n, i, l) {
  return Gi(
    c(
      e,
      t,
      s,
      n,
      i,
      l,
      !0
    )
  );
}
function jo(e, t, s, n, i) {
  return Gi(
    He(
      e,
      t,
      s,
      n,
      i,
      !0
    )
  );
}
function Ji(e) {
  return e ? e.__v_isVNode === !0 : !1;
}
function Nt(e, t) {
  return e.type === t.type && e.key === t.key;
}
const Yi = ({ key: e }) => e ?? null, as = ({
  ref: e,
  ref_key: t,
  ref_for: s
}) => (typeof e == "number" && (e = "" + e), e != null ? ee(e) || ae(e) || k(e) ? { i: Ae, r: e, k: t, f: !!s } : e : null);
function c(e, t = null, s = null, n = 0, i = null, l = e === pe ? 0 : 1, o = !1, a = !1) {
  const f = {
    __v_isVNode: !0,
    __v_skip: !0,
    type: e,
    props: t,
    key: t && Yi(t),
    ref: t && as(t),
    scopeId: Ci,
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
    shapeFlag: l,
    patchFlag: n,
    dynamicProps: i,
    dynamicChildren: null,
    appContext: null,
    ctx: Ae
  };
  return a ? (gn(f, s), l & 128 && e.normalize(f)) : s && (f.shapeFlag |= ee(s) ? 8 : 16), Yt > 0 && // avoid a block node from tracking itself
  !o && // has current parent block
  Se && // presence of a patch flag indicates this node needs patching on updates.
  // component nodes also should always be patched, because even if the
  // component doesn't need to update, it needs to persist the instance on to
  // the next vnode so that it can be properly unmounted later.
  (f.patchFlag > 0 || l & 6) && // the EVENTS flag is only for hydration and if it is the only flag, the
  // vnode should not be considered dynamic due to handler caching.
  f.patchFlag !== 32 && Se.push(f), f;
}
const He = $o;
function $o(e, t = null, s = null, n = 0, i = null, l = !1) {
  if ((!e || e === ro) && (e = ct), Ji(e)) {
    const a = Ot(
      e,
      t,
      !0
      /* mergeRef: true */
    );
    return s && gn(a, s), Yt > 0 && !l && Se && (a.shapeFlag & 6 ? Se[Se.indexOf(e)] = a : Se.push(a)), a.patchFlag = -2, a;
  }
  if (Zo(e) && (e = e.__vccOpts), t) {
    t = Ho(t);
    let { class: a, style: f } = t;
    a && !ee(a) && (t.class = se(a)), Z(f) && (cn(f) && !P(f) && (f = ge({}, f)), t.style = en(f));
  }
  const o = ee(e) ? 1 : zi(e) ? 128 : Jl(e) ? 64 : Z(e) ? 4 : k(e) ? 2 : 0;
  return c(
    e,
    t,
    s,
    n,
    i,
    o,
    l,
    !0
  );
}
function Ho(e) {
  return e ? cn(e) || Ki(e) ? ge({}, e) : e : null;
}
function Ot(e, t, s = !1, n = !1) {
  const { props: i, ref: l, patchFlag: o, children: a, transition: f } = e, g = t ? Vo(i || {}, t) : i, p = {
    __v_isVNode: !0,
    __v_skip: !0,
    type: e.type,
    props: g,
    key: g && Yi(g),
    ref: t && t.ref ? (
      // #2078 in the case of <component :is="vnode" ref="extra"/>
      // if the vnode itself already has a ref, cloneVNode will need to merge
      // the refs so the single vnode can be set on multiple refs
      s && l ? P(l) ? l.concat(as(t)) : [l, as(t)] : as(t)
    ) : l,
    scopeId: e.scopeId,
    slotScopeIds: e.slotScopeIds,
    children: a,
    target: e.target,
    targetStart: e.targetStart,
    targetAnchor: e.targetAnchor,
    staticCount: e.staticCount,
    shapeFlag: e.shapeFlag,
    // if the vnode is cloned with extra props, we can no longer assume its
    // existing patch flag to be reliable and need to add the FULL_PROPS flag.
    // note: preserve flag for fragments since they use the flag for children
    // fast paths only.
    patchFlag: t && e.type !== pe ? o === -1 ? 16 : o | 16 : o,
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
    ssContent: e.ssContent && Ot(e.ssContent),
    ssFallback: e.ssFallback && Ot(e.ssFallback),
    placeholder: e.placeholder,
    el: e.el,
    anchor: e.anchor,
    ctx: e.ctx,
    ce: e.ce
  };
  return f && n && dn(
    p,
    f.clone(p)
  ), p;
}
function fe(e = " ", t = 0) {
  return He(Ts, null, e, t);
}
function Lo(e, t) {
  const s = He(rs, null, e);
  return s.staticCount = t, s;
}
function xe(e = "", t = !1) {
  return t ? (D(), jo(ct, null, e)) : He(ct, null, e);
}
function je(e) {
  return e == null || typeof e == "boolean" ? He(ct) : P(e) ? He(
    pe,
    null,
    // #3666, avoid reference pollution when reusing vnode
    e.slice()
  ) : Ji(e) ? ot(e) : He(Ts, null, String(e));
}
function ot(e) {
  return e.el === null && e.patchFlag !== -1 || e.memo ? e : Ot(e);
}
function gn(e, t) {
  let s = 0;
  const { shapeFlag: n } = e;
  if (t == null)
    t = null;
  else if (P(t))
    s = 16;
  else if (typeof t == "object")
    if (n & 65) {
      const i = t.default;
      i && (i._c && (i._d = !1), gn(e, i()), i._c && (i._d = !0));
      return;
    } else {
      s = 32;
      const i = t._;
      !i && !Ki(t) ? t._ctx = Ae : i === 3 && Ae && (Ae.slots._ === 1 ? t._ = 1 : (t._ = 2, e.patchFlag |= 1024));
    }
  else k(t) ? (t = { default: t, _ctx: Ae }, s = 32) : (t = String(t), n & 64 ? (s = 16, t = [fe(t)]) : s = 8);
  e.children = t, e.shapeFlag |= s;
}
function Vo(...e) {
  const t = {};
  for (let s = 0; s < e.length; s++) {
    const n = e[s];
    for (const i in n)
      if (i === "class")
        t.class !== n.class && (t.class = se([t.class, n.class]));
      else if (i === "style")
        t.style = en([t.style, n.style]);
      else if (ms(i)) {
        const l = t[i], o = n[i];
        o && l !== o && !(P(l) && l.includes(o)) && (t[i] = l ? [].concat(l, o) : o);
      } else i !== "" && (t[i] = n[i]);
  }
  return t;
}
function Ke(e, t, s, n = null) {
  Ve(e, t, 7, [
    s,
    n
  ]);
}
const Bo = ki();
let Wo = 0;
function qo(e, t, s) {
  const n = e.type, i = (t ? t.appContext : e.appContext) || Bo, l = {
    uid: Wo++,
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
    scope: new gl(
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
    propsOptions: Ni(n, i),
    emitsOptions: qi(n, i),
    // emit
    emit: null,
    // to be set immediately
    emitted: null,
    // props default value
    propsDefaults: z,
    // inheritAttrs
    inheritAttrs: n.inheritAttrs,
    // state
    ctx: z,
    data: z,
    props: z,
    attrs: z,
    slots: z,
    refs: z,
    setupState: z,
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
  return l.ctx = { _: l }, l.root = t ? t.root : l, l.emit = Ro.bind(null, l), e.ce && e.ce(l), l;
}
let he = null;
const zo = () => he || Ae;
let vs, Gs;
{
  const e = bs(), t = (s, n) => {
    let i;
    return (i = e[s]) || (i = e[s] = []), i.push(n), (l) => {
      i.length > 1 ? i.forEach((o) => o(l)) : i[0](l);
    };
  };
  vs = t(
    "__VUE_INSTANCE_SETTERS__",
    (s) => he = s
  ), Gs = t(
    "__VUE_SSR_SETTERS__",
    (s) => Xt = s
  );
}
const es = (e) => {
  const t = he;
  return vs(e), e.scope.on(), () => {
    e.scope.off(), vs(t);
  };
}, Rn = () => {
  he && he.scope.off(), vs(null);
};
function Xi(e) {
  return e.vnode.shapeFlag & 4;
}
let Xt = !1;
function Go(e, t = !1, s = !1) {
  t && Gs(t);
  const { props: n, children: i } = e.vnode, l = Xi(e);
  yo(e, n, l, t), wo(e, i, s || t);
  const o = l ? Jo(e, t) : void 0;
  return t && Gs(!1), o;
}
function Jo(e, t) {
  const s = e.type;
  e.accessCache = /* @__PURE__ */ Object.create(null), e.proxy = new Proxy(e.ctx, ao);
  const { setup: n } = s;
  if (n) {
    Ze();
    const i = e.setupContext = n.length > 1 ? Xo(e) : null, l = es(e), o = Qt(
      n,
      e,
      0,
      [
        e.props,
        i
      ]
    ), a = Yn(o);
    if (Qe(), l(), (a || e.sp) && !Bt(e) && Ai(e), a) {
      if (o.then(Rn, Rn), t)
        return o.then((f) => {
          kn(e, f);
        }).catch((f) => {
          xs(f, e, 0);
        });
      e.asyncDep = o;
    } else
      kn(e, o);
  } else
    Zi(e);
}
function kn(e, t, s) {
  k(t) ? e.type.__ssrInlineRender ? e.ssrRender = t : e.render = t : Z(t) && (e.setupState = bi(t)), Zi(e);
}
function Zi(e, t, s) {
  const n = e.type;
  e.render || (e.render = n.render || $e);
  {
    const i = es(e);
    Ze();
    try {
      uo(e);
    } finally {
      Qe(), i();
    }
  }
}
const Yo = {
  get(e, t) {
    return re(e, "get", ""), e[t];
  }
};
function Xo(e) {
  const t = (s) => {
    e.exposed = s || {};
  };
  return {
    attrs: new Proxy(e.attrs, Yo),
    slots: e.slots,
    emit: e.emit,
    expose: t
  };
}
function Cs(e) {
  return e.exposed ? e.exposeProxy || (e.exposeProxy = new Proxy(bi(Kl(e.exposed)), {
    get(t, s) {
      if (s in t)
        return t[s];
      if (s in Wt)
        return Wt[s](e);
    },
    has(t, s) {
      return s in t || s in Wt;
    }
  })) : e.proxy;
}
function Zo(e) {
  return k(e) && "__vccOpts" in e;
}
const Pe = (e, t) => Hl(e, t, Xt), Qo = "3.5.18";
/**
* @vue/runtime-dom v3.5.18
* (c) 2018-present Yuxi (Evan) You and Vue contributors
* @license MIT
**/
let Js;
const Dn = typeof window < "u" && window.trustedTypes;
if (Dn)
  try {
    Js = /* @__PURE__ */ Dn.createPolicy("vue", {
      createHTML: (e) => e
    });
  } catch {
  }
const Qi = Js ? (e) => Js.createHTML(e) : (e) => e, er = "http://www.w3.org/2000/svg", tr = "http://www.w3.org/1998/Math/MathML", Ge = typeof document < "u" ? document : null, Fn = Ge && /* @__PURE__ */ Ge.createElement("template"), sr = {
  insert: (e, t, s) => {
    t.insertBefore(e, s || null);
  },
  remove: (e) => {
    const t = e.parentNode;
    t && t.removeChild(e);
  },
  createElement: (e, t, s, n) => {
    const i = t === "svg" ? Ge.createElementNS(er, e) : t === "mathml" ? Ge.createElementNS(tr, e) : s ? Ge.createElement(e, { is: s }) : Ge.createElement(e);
    return e === "select" && n && n.multiple != null && i.setAttribute("multiple", n.multiple), i;
  },
  createText: (e) => Ge.createTextNode(e),
  createComment: (e) => Ge.createComment(e),
  setText: (e, t) => {
    e.nodeValue = t;
  },
  setElementText: (e, t) => {
    e.textContent = t;
  },
  parentNode: (e) => e.parentNode,
  nextSibling: (e) => e.nextSibling,
  querySelector: (e) => Ge.querySelector(e),
  setScopeId(e, t) {
    e.setAttribute(t, "");
  },
  // __UNSAFE__
  // Reason: innerHTML.
  // Static content here can only come from compiled templates.
  // As long as the user only uses trusted templates, this is safe.
  insertStaticContent(e, t, s, n, i, l) {
    const o = s ? s.previousSibling : t.lastChild;
    if (i && (i === l || i.nextSibling))
      for (; t.insertBefore(i.cloneNode(!0), s), !(i === l || !(i = i.nextSibling)); )
        ;
    else {
      Fn.innerHTML = Qi(
        n === "svg" ? `<svg>${e}</svg>` : n === "mathml" ? `<math>${e}</math>` : e
      );
      const a = Fn.content;
      if (n === "svg" || n === "mathml") {
        const f = a.firstChild;
        for (; f.firstChild; )
          a.appendChild(f.firstChild);
        a.removeChild(f);
      }
      t.insertBefore(a, s);
    }
    return [
      // first
      o ? o.nextSibling : t.firstChild,
      // last
      s ? s.previousSibling : t.lastChild
    ];
  }
}, nr = Symbol("_vtc");
function ir(e, t, s) {
  const n = e[nr];
  n && (t = (t ? [t, ...n] : [...n]).join(" ")), t == null ? e.removeAttribute("class") : s ? e.setAttribute("class", t) : e.className = t;
}
const Kn = Symbol("_vod"), lr = Symbol("_vsh"), or = Symbol(""), rr = /(^|;)\s*display\s*:/;
function ar(e, t, s) {
  const n = e.style, i = ee(s);
  let l = !1;
  if (s && !i) {
    if (t)
      if (ee(t))
        for (const o of t.split(";")) {
          const a = o.slice(0, o.indexOf(":")).trim();
          s[a] == null && us(n, a, "");
        }
      else
        for (const o in t)
          s[o] == null && us(n, o, "");
    for (const o in s)
      o === "display" && (l = !0), us(n, o, s[o]);
  } else if (i) {
    if (t !== s) {
      const o = n[or];
      o && (s += ";" + o), n.cssText = s, l = rr.test(s);
    }
  } else t && e.removeAttribute("style");
  Kn in e && (e[Kn] = l ? n.display : "", e[lr] && (n.display = "none"));
}
const Un = /\s*!important$/;
function us(e, t, s) {
  if (P(s))
    s.forEach((n) => us(e, t, n));
  else if (s == null && (s = ""), t.startsWith("--"))
    e.setProperty(t, s);
  else {
    const n = ur(e, t);
    Un.test(s) ? e.setProperty(
      dt(n),
      s.replace(Un, ""),
      "important"
    ) : e[n] = s;
  }
}
const Nn = ["Webkit", "Moz", "ms"], Fs = {};
function ur(e, t) {
  const s = Fs[t];
  if (s)
    return s;
  let n = at(t);
  if (n !== "filter" && n in e)
    return Fs[t] = n;
  n = Qn(n);
  for (let i = 0; i < Nn.length; i++) {
    const l = Nn[i] + n;
    if (l in e)
      return Fs[t] = l;
  }
  return t;
}
const jn = "http://www.w3.org/1999/xlink";
function $n(e, t, s, n, i, l = pl(t)) {
  n && t.startsWith("xlink:") ? s == null ? e.removeAttributeNS(jn, t.slice(6, t.length)) : e.setAttributeNS(jn, t, s) : s == null || l && !ei(s) ? e.removeAttribute(t) : e.setAttribute(
    t,
    l ? "" : Le(s) ? String(s) : s
  );
}
function Hn(e, t, s, n, i) {
  if (t === "innerHTML" || t === "textContent") {
    s != null && (e[t] = t === "innerHTML" ? Qi(s) : s);
    return;
  }
  const l = e.tagName;
  if (t === "value" && l !== "PROGRESS" && // custom elements may use _value internally
  !l.includes("-")) {
    const a = l === "OPTION" ? e.getAttribute("value") || "" : e.value, f = s == null ? (
      // #11647: value should be set as empty string for null and undefined,
      // but <input type="checkbox"> should be set as 'on'.
      e.type === "checkbox" ? "on" : ""
    ) : String(s);
    (a !== f || !("_value" in e)) && (e.value = f), s == null && e.removeAttribute(t), e._value = s;
    return;
  }
  let o = !1;
  if (s === "" || s == null) {
    const a = typeof e[t];
    a === "boolean" ? s = ei(s) : s == null && a === "string" ? (s = "", o = !0) : a === "number" && (s = 0, o = !0);
  }
  try {
    e[t] = s;
  } catch {
  }
  o && e.removeAttribute(i || t);
}
function Xe(e, t, s, n) {
  e.addEventListener(t, s, n);
}
function cr(e, t, s, n) {
  e.removeEventListener(t, s, n);
}
const Ln = Symbol("_vei");
function fr(e, t, s, n, i = null) {
  const l = e[Ln] || (e[Ln] = {}), o = l[t];
  if (n && o)
    o.value = n;
  else {
    const [a, f] = dr(t);
    if (n) {
      const g = l[t] = gr(
        n,
        i
      );
      Xe(e, a, g, f);
    } else o && (cr(e, a, o, f), l[t] = void 0);
  }
}
const Vn = /(?:Once|Passive|Capture)$/;
function dr(e) {
  let t;
  if (Vn.test(e)) {
    t = {};
    let n;
    for (; n = e.match(Vn); )
      e = e.slice(0, e.length - n[0].length), t[n[0].toLowerCase()] = !0;
  }
  return [e[2] === ":" ? e.slice(3) : dt(e.slice(2)), t];
}
let Ks = 0;
const pr = /* @__PURE__ */ Promise.resolve(), hr = () => Ks || (pr.then(() => Ks = 0), Ks = Date.now());
function gr(e, t) {
  const s = (n) => {
    if (!n._vts)
      n._vts = Date.now();
    else if (n._vts <= s.attached)
      return;
    Ve(
      vr(n, s.value),
      t,
      5,
      [n]
    );
  };
  return s.value = e, s.attached = hr(), s;
}
function vr(e, t) {
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
const Bn = (e) => e.charCodeAt(0) === 111 && e.charCodeAt(1) === 110 && // lowercase letter
e.charCodeAt(2) > 96 && e.charCodeAt(2) < 123, mr = (e, t, s, n, i, l) => {
  const o = i === "svg";
  t === "class" ? ir(e, n, o) : t === "style" ? ar(e, s, n) : ms(t) ? Xs(t) || fr(e, t, s, n, l) : (t[0] === "." ? (t = t.slice(1), !0) : t[0] === "^" ? (t = t.slice(1), !1) : yr(e, t, n, o)) ? (Hn(e, t, n), !e.tagName.includes("-") && (t === "value" || t === "checked" || t === "selected") && $n(e, t, n, o, l, t !== "value")) : /* #11081 force set props for possible async custom element */ e._isVueCE && (/[A-Z]/.test(t) || !ee(n)) ? Hn(e, at(t), n, l, t) : (t === "true-value" ? e._trueValue = n : t === "false-value" && (e._falseValue = n), $n(e, t, n, o));
};
function yr(e, t, s, n) {
  if (n)
    return !!(t === "innerHTML" || t === "textContent" || t in e && Bn(t) && k(s));
  if (t === "spellcheck" || t === "draggable" || t === "translate" || t === "autocorrect" || t === "form" || t === "list" && e.tagName === "INPUT" || t === "type" && e.tagName === "TEXTAREA")
    return !1;
  if (t === "width" || t === "height") {
    const i = e.tagName;
    if (i === "IMG" || i === "VIDEO" || i === "CANVAS" || i === "SOURCE")
      return !1;
  }
  return Bn(t) && ee(s) ? !1 : t in e;
}
const ft = (e) => {
  const t = e.props["onUpdate:modelValue"] || !1;
  return P(t) ? (s) => ls(t, s) : t;
};
function br(e) {
  e.target.composing = !0;
}
function Wn(e) {
  const t = e.target;
  t.composing && (t.composing = !1, t.dispatchEvent(new Event("input")));
}
const Oe = Symbol("_assign"), Ne = {
  created(e, { modifiers: { lazy: t, trim: s, number: n } }, i) {
    e[Oe] = ft(i);
    const l = n || i.props && i.props.type === "number";
    Xe(e, t ? "change" : "input", (o) => {
      if (o.target.composing) return;
      let a = e.value;
      s && (a = a.trim()), l && (a = cs(a)), e[Oe](a);
    }), s && Xe(e, "change", () => {
      e.value = e.value.trim();
    }), t || (Xe(e, "compositionstart", br), Xe(e, "compositionend", Wn), Xe(e, "change", Wn));
  },
  // set value on mounted so it's after min/max for type="range"
  mounted(e, { value: t }) {
    e.value = t ?? "";
  },
  beforeUpdate(e, { value: t, oldValue: s, modifiers: { lazy: n, trim: i, number: l } }, o) {
    if (e[Oe] = ft(o), e.composing) return;
    const a = (l || e.type === "number") && !/^0\d/.test(e.value) ? cs(e.value) : e.value, f = t ?? "";
    a !== f && (document.activeElement === e && e.type !== "range" && (n && t === s || i && e.value.trim() === f) || (e.value = f));
  }
}, el = {
  // #4096 array checkboxes need to be deep traversed
  deep: !0,
  created(e, t, s) {
    e[Oe] = ft(s), Xe(e, "change", () => {
      const n = e._modelValue, i = Mt(e), l = e.checked, o = e[Oe];
      if (P(n)) {
        const a = tn(n, i), f = a !== -1;
        if (l && !f)
          o(n.concat(i));
        else if (!l && f) {
          const g = [...n];
          g.splice(a, 1), o(g);
        }
      } else if (Pt(n)) {
        const a = new Set(n);
        l ? a.add(i) : a.delete(i), o(a);
      } else
        o(sl(e, l));
    });
  },
  // set initial checked on mount to wait for true-value/false-value
  mounted: qn,
  beforeUpdate(e, t, s) {
    e[Oe] = ft(s), qn(e, t, s);
  }
};
function qn(e, { value: t, oldValue: s }, n) {
  e._modelValue = t;
  let i;
  if (P(t))
    i = tn(t, n.props.value) > -1;
  else if (Pt(t))
    i = t.has(n.props.value);
  else {
    if (t === s) return;
    i = bt(t, sl(e, !0));
  }
  e.checked !== i && (e.checked = i);
}
const _r = {
  created(e, { value: t }, s) {
    e.checked = bt(t, s.props.value), e[Oe] = ft(s), Xe(e, "change", () => {
      e[Oe](Mt(e));
    });
  },
  beforeUpdate(e, { value: t, oldValue: s }, n) {
    e[Oe] = ft(n), t !== s && (e.checked = bt(t, n.props.value));
  }
}, tl = {
  // <select multiple> value need to be deep traversed
  deep: !0,
  created(e, { value: t, modifiers: { number: s } }, n) {
    const i = Pt(t);
    Xe(e, "change", () => {
      const l = Array.prototype.filter.call(e.options, (o) => o.selected).map(
        (o) => s ? cs(Mt(o)) : Mt(o)
      );
      e[Oe](
        e.multiple ? i ? new Set(l) : l : l[0]
      ), e._assigning = !0, xi(() => {
        e._assigning = !1;
      });
    }), e[Oe] = ft(n);
  },
  // set value in mounted & updated because <select> relies on its children
  // <option>s.
  mounted(e, { value: t }) {
    zn(e, t);
  },
  beforeUpdate(e, t, s) {
    e[Oe] = ft(s);
  },
  updated(e, { value: t }) {
    e._assigning || zn(e, t);
  }
};
function zn(e, t) {
  const s = e.multiple, n = P(t);
  if (!(s && !n && !Pt(t))) {
    for (let i = 0, l = e.options.length; i < l; i++) {
      const o = e.options[i], a = Mt(o);
      if (s)
        if (n) {
          const f = typeof a;
          f === "string" || f === "number" ? o.selected = t.some((g) => String(g) === String(a)) : o.selected = tn(t, a) > -1;
        } else
          o.selected = t.has(a);
      else if (bt(Mt(o), t)) {
        e.selectedIndex !== i && (e.selectedIndex = i);
        return;
      }
    }
    !s && e.selectedIndex !== -1 && (e.selectedIndex = -1);
  }
}
function Mt(e) {
  return "_value" in e ? e._value : e.value;
}
function sl(e, t) {
  const s = t ? "_trueValue" : "_falseValue";
  return s in e ? e[s] : t;
}
const xr = {
  created(e, t, s) {
    is(e, t, s, null, "created");
  },
  mounted(e, t, s) {
    is(e, t, s, null, "mounted");
  },
  beforeUpdate(e, t, s, n) {
    is(e, t, s, n, "beforeUpdate");
  },
  updated(e, t, s, n) {
    is(e, t, s, n, "updated");
  }
};
function wr(e, t) {
  switch (e) {
    case "SELECT":
      return tl;
    case "TEXTAREA":
      return Ne;
    default:
      switch (t) {
        case "checkbox":
          return el;
        case "radio":
          return _r;
        default:
          return Ne;
      }
  }
}
function is(e, t, s, n, i) {
  const o = wr(
    e.tagName,
    s.props && s.props.type
  )[i];
  o && o(e, t, s, n);
}
const Sr = ["ctrl", "shift", "alt", "meta"], Tr = {
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
  exact: (e, t) => Sr.some((s) => e[`${s}Key`] && !t.includes(s))
}, Gn = (e, t) => {
  const s = e._withMods || (e._withMods = {}), n = t.join(".");
  return s[n] || (s[n] = (i, ...l) => {
    for (let o = 0; o < t.length; o++) {
      const a = Tr[t[o]];
      if (a && a(i, t)) return;
    }
    return e(i, ...l);
  });
}, Cr = {
  esc: "escape",
  space: " ",
  up: "arrow-up",
  left: "arrow-left",
  right: "arrow-right",
  down: "arrow-down",
  delete: "backspace"
}, Ar = (e, t) => {
  const s = e._withKeys || (e._withKeys = {}), n = t.join(".");
  return s[n] || (s[n] = (i) => {
    if (!("key" in i))
      return;
    const l = dt(i.key);
    if (t.some(
      (o) => o === l || Cr[o] === l
    ))
      return e(i);
  });
}, Er = /* @__PURE__ */ ge({ patchProp: mr }, sr);
let Jn;
function Or() {
  return Jn || (Jn = To(Er));
}
const Mr = (...e) => {
  const t = Or().createApp(...e), { mount: s } = t;
  return t.mount = (n) => {
    const i = Ir(n);
    if (!i) return;
    const l = t._component;
    !k(l) && !l.render && !l.template && (l.template = i.innerHTML), i.nodeType === 1 && (i.textContent = "");
    const o = s(i, !1, Pr(i));
    return i instanceof Element && (i.removeAttribute("v-cloak"), i.setAttribute("data-v-app", "")), o;
  }, t;
};
function Pr(e) {
  if (e instanceof SVGElement)
    return "svg";
  if (typeof MathMLElement == "function" && e instanceof MathMLElement)
    return "mathml";
}
function Ir(e) {
  return ee(e) ? document.querySelector(e) : e;
}
const Rr = {
  key: 0,
  class: "app-shell"
}, kr = {
  key: 1,
  class: "admin-body"
}, Dr = { class: "admin-shell" }, Fr = {
  key: 0,
  class: "admin-loading",
  role: "status",
  "aria-live": "polite"
}, Kr = {
  key: 1,
  class: "admin-gate"
}, Ur = { class: "gate-error" }, Nr = { class: "admin-sidebar" }, jr = { class: "admin-content" }, $r = {
  key: 0,
  class: "toast",
  role: "status",
  "aria-live": "polite"
}, Hr = {
  key: 1,
  class: "admin-page"
}, Lr = { class: "panel" }, Vr = { class: "page-title" }, Br = { class: "today-date" }, Wr = { class: "stats today-stats" }, qr = { class: "stat" }, zr = {
  key: 0,
  class: "task-spinner",
  "aria-hidden": "true"
}, Gr = { class: "stat" }, Jr = {
  key: 2,
  class: "admin-page report-page"
}, Yr = { class: "panel" }, Xr = { class: "page-title" }, Zr = { class: "page-count" }, Qr = { class: "report-grid" }, ea = { class: "report-card-head" }, ta = {
  key: 0,
  class: "report-temp"
}, sa = { class: "report-badges" }, na = {
  key: 0,
  class: "status"
}, ia = {
  key: 1,
  class: "status fail"
}, la = {
  key: 0,
  class: "report-row-summary"
}, oa = { class: "report-card-actions" }, ra = ["href"], aa = ["onClick"], ua = ["onClick"], ca = {
  key: 0,
  class: "notice"
}, fa = { class: "pagination" }, da = ["disabled"], pa = ["onClick"], ha = ["disabled"], ga = {
  key: 3,
  class: "admin-page"
}, va = { class: "panel" }, ma = { class: "table-wrap" }, ya = { class: "admin-table" }, ba = {
  key: 0,
  class: "task-spinner",
  "aria-hidden": "true"
}, _a = { key: 0 }, xa = {
  key: 4,
  class: "admin-page"
}, wa = {
  key: 5,
  class: "admin-page"
}, Sa = { class: "panel" }, Ta = { class: "page-title" }, Ca = { class: "page-count" }, Aa = { class: "table-toolbar" }, Ea = { class: "table-wrap" }, Oa = { class: "admin-table" }, Ma = { key: 0 }, Pa = {
  colspan: "3",
  class: "empty-cell"
}, Ia = {
  key: 0,
  class: "pagination"
}, Ra = ["disabled"], ka = ["onClick"], Da = ["disabled"], Fa = {
  key: 6,
  class: "admin-page settings-page"
}, Ka = { class: "panel" }, Ua = { class: "page-title" }, Na = { class: "settings-summary" }, ja = { class: "settings-grid" }, $a = { class: "settings-span-2" }, Ha = { class: "settings-span-2" }, La = { class: "secret-input" }, Va = ["type"], Ba = ["aria-label", "aria-pressed"], Wa = { class: "settings-switches" }, qa = { class: "settings-actions" }, za = ["disabled"], Ga = {
  role: "status",
  "aria-live": "polite"
}, Ja = {
  key: 7,
  class: "admin-page settings-page"
}, Ya = {
  key: 8,
  class: "admin-page settings-page"
}, Xa = { class: "panel" }, Za = { class: "page-title" }, Qa = { class: "settings-grid" }, eu = { class: "skill-editor" }, tu = { class: "editor-head" }, su = {
  role: "status",
  "aria-live": "polite"
}, nu = ["disabled"], iu = {
  key: 9,
  class: "admin-page settings-page"
}, lu = { class: "panel" }, ou = { class: "settings-summary api-cred" }, ru = { class: "secret-input" }, au = ["type", "value"], uu = ["aria-label", "aria-pressed"], cu = {
  class: "settings-actions",
  style: { "justify-content": "space-between" }
}, fu = {
  role: "status",
  "aria-live": "polite"
}, du = ["disabled"], pu = {
  key: 0,
  class: "manual-pre"
}, hu = {
  key: 1,
  class: "notice"
}, Us = 10, Ns = 10, gu = {
  __name: "App",
  setup(e) {
    const t = ["today", "report-upload", "reports", "analysis", "progress", "users", "ai", "email", "api-manual"], s = location.pathname.split("/")[2], n = location.pathname === "/admin" || location.pathname.startsWith("/admin/") && t.includes(s), i = X(null), l = X(n), o = X(""), a = X(""), f = X(""), g = X(t.includes(s) ? s : "today"), p = X(1), y = X(null), A = X(null), C = X({ provider: "OpenAI Compatible", protocol: "openai_responses", baseUrl: "", apiKey: "", model: "", timeoutSeconds: 300, enabled: !0 }), K = X(""), U = X(!1), Q = X(!1), j = X(""), G = X(""), J = X(""), M = X(!1), W = X(""), ye = X(!1), oe = X({ date: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(/* @__PURE__ */ new Date()), markdown: "" }), be = X(!1), tt = X(""), Te = X("");
    let Be = null;
    function pt(h) {
      Te.value = h, Be && clearTimeout(Be), Be = setTimeout(() => {
        Te.value = "";
      }, 4e3);
    }
    function st(h) {
      if (!h) return "-";
      const r = new Date(h);
      return Number.isNaN(r.getTime()) ? h : new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: !1 }).format(r);
    }
    function It(h) {
      return h === "running" ? "渲染中" : h === "failed" ? "渲染失败" : h === "completed" ? "已完成" : "-";
    }
    const Rt = Pe(() => {
      var h, r;
      return (r = (h = i.value) == null ? void 0 : h.analysisTasks) == null ? void 0 : r.find((m) => m.date === i.value.today.date);
    }), te = Pe(() => {
      var h;
      return ((h = Rt.value) == null ? void 0 : h.status) || null;
    });
    Pe(() => {
      const h = Rt.value;
      if (!(h != null && h.startedAt) || !(h != null && h.completedAt)) return "进行中";
      const r = Math.max(0, Math.round((new Date(h.completedAt) - new Date(h.startedAt)) / 1e3));
      return r < 60 ? r + " 秒" : Math.floor(r / 60) + " 分 " + r % 60 + " 秒";
    });
    const q = Pe(() => {
      var h;
      return (((h = i.value) == null ? void 0 : h.reportList) || []).slice(0, 60);
    }), H = Pe(() => Math.max(1, Math.ceil(q.value.length / Us))), Re = Pe(() => q.value.slice((p.value - 1) * Us, p.value * Us));
    function nt(h) {
      p.value = Math.min(H.value, Math.max(1, h)), y.value = null;
    }
    async function We(h) {
      const r = h.date;
      if (!confirm(`确定重置 ${r} 的报告？将删除该日已生成报告并允许重新上传。`)) return;
      const m = await ve("/api/admin/reports/reset", { method: "POST", body: JSON.stringify({ date: r }) }), E = await m.json();
      pt(m.ok ? `已重置 ${r} 的报告` : E.error || "重置失败"), m.ok && (y.value = null, await u());
    }
    async function Ce(h) {
      const r = h.date;
      if (!confirm(`确定重新生成 ${r} 的报告？将用当前 AI 配置重新排版该日报告，约 1-2 分钟完成。`)) return;
      const m = await ve("/api/admin/reports/regenerate", { method: "POST", body: JSON.stringify({ date: r }) }), E = await m.json();
      pt(m.ok ? `已触发 ${r} 报告重新生成，约 1-2 分钟后完成。` : E.error || "重新生成失败");
    }
    const ht = X(""), qe = X(1), kt = Pe(() => {
      var m;
      const h = ht.value.trim().toLowerCase(), r = ((m = i.value) == null ? void 0 : m.users) || [];
      return h ? r.filter((E) => String(E.email || "").toLowerCase().includes(h)) : r;
    }), ke = Pe(() => Math.max(1, Math.ceil(kt.value.length / Ns))), it = Pe(() => {
      const h = (qe.value - 1) * Ns;
      return kt.value.slice(h, h + Ns);
    }), Dt = Pe(() => {
      var r;
      const h = ((r = i.value) == null ? void 0 : r.users) || [];
      return { total: h.length, verified: h.filter((m) => m.verified).length, pending: h.filter((m) => !m.verified).length };
    });
    function _t(h) {
      qe.value = Math.min(ke.value, Math.max(1, h));
    }
    const ve = (h, r = {}) => fetch(h, { ...r, headers: { "Content-Type": "application/json", "x-admin-key": f.value || o.value, ...r.headers || {} } });
    async function As() {
      if (!(await fetch("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: o.value }) })).ok) {
        a.value = "授权密码不正确。";
        return;
      }
      f.value = o.value, o.value = "", await u();
    }
    async function u() {
      const h = await ve("/api/admin/overview");
      h.ok && (i.value = await h.json(), await d());
    }
    async function d() {
      const h = await ve("/api/admin/settings");
      if (!h.ok) return;
      A.value = await h.json();
      const r = A.value.ai;
      C.value = { provider: r.provider || "OpenAI Compatible", protocol: r.protocol || "openai_responses", baseUrl: r.baseUrl || "", apiKey: r.apiKey || "", model: r.model || "", timeoutSeconds: r.timeoutSeconds || 300, enabled: r.enabled !== !1 };
    }
    async function v() {
      K.value = "保存中…";
      const h = await ve("/api/admin/settings/ai", { method: "PUT", body: JSON.stringify(C.value) }), r = await h.json();
      K.value = h.ok ? "AI 配置已保存" : r.error || "保存失败", h.ok && await d();
    }
    async function x() {
      U.value = !0, K.value = "正在检测模型服务…";
      try {
        const h = await ve("/api/admin/settings/ai/test", { method: "POST", body: "{}" }), r = await h.json();
        K.value = h.ok ? r.message : r.error || "检测失败";
      } finally {
        U.value = !1;
      }
    }
    async function b() {
      be.value = !0, tt.value = "正在保存并生成报告…";
      try {
        const h = await ve("/api/admin/reports/upload", { method: "POST", body: JSON.stringify(oe.value) }), r = await h.json();
        tt.value = h.ok ? `已保存报告：${r.title}（${r.date}），AI 排版约 1-2 分钟完成。` : r.error || "保存失败", h.ok && await u();
      } finally {
        be.value = !1;
      }
    }
    async function _() {
      ye.value = !0;
      try {
        const h = await ve("/api/admin/api-manual");
        if (!h.ok) return;
        const r = await h.json();
        j.value = r.manual || "", G.value = r.baseUrl || "", J.value = r.uploadKey || "";
      } finally {
        ye.value = !1;
      }
    }
    async function S(h, r) {
      const m = () => {
        W.value = r, setTimeout(() => {
          W.value === r && (W.value = "");
        }, 2e3);
      };
      try {
        await navigator.clipboard.writeText(String(h || "")), m();
      } catch {
        const E = document.createElement("textarea");
        E.value = String(h || ""), E.style.position = "fixed", E.style.opacity = "0", document.body.appendChild(E), E.select();
        try {
          document.execCommand("copy"), m();
        } catch {
          W.value = "";
        }
        document.body.removeChild(E);
      }
    }
    return Mi(async () => {
      if (n)
        try {
          (await fetch("/api/admin/session").then((r) => r.json())).authenticated && await Promise.all([u(), _()]);
        } finally {
          l.value = !1;
        }
    }), (h, r) => {
      var m, E, T, O, I, N, B, $, ne, ie, _e;
      return yi(n) ? (D(), F("div", kr, [
        r[63] || (r[63] = c("header", { class: "nav" }, [
          c("a", {
            class: "logo",
            href: "/"
          }, [
            fe("行情日报"),
            c("span", null, "ADMIN CONSOLE")
          ]),
          c("nav", null, [
            c("a", { href: "/" }, "返回首页")
          ])
        ], -1)),
        c("main", Dr, [
          l.value ? (D(), F("section", Fr, "正在验证后台会话…")) : i.value ? (D(), F(pe, { key: 2 }, [
            c("aside", Nr, [
              r[25] || (r[25] = c("h2", null, "行情日报", -1)),
              r[26] || (r[26] = c("small", null, "OPERATIONS DESK", -1)),
              c("nav", null, [
                c("a", {
                  href: "/admin/today",
                  class: se({ active: g.value === "today" })
                }, "今日状态", 2),
                c("a", {
                  href: "/admin/report-upload",
                  class: se({ active: g.value === "report-upload" })
                }, "报告上传", 2),
                c("a", {
                  href: "/admin/reports",
                  class: se({ active: g.value === "reports" })
                }, "每日报告", 2),
                c("a", {
                  href: "/admin/analysis",
                  class: se({ active: g.value === "analysis" })
                }, "分析任务", 2),
                c("a", {
                  href: "/admin/progress",
                  class: se({ active: g.value === "progress" })
                }, "发送进度", 2),
                c("a", {
                  href: "/admin/users",
                  class: se({ active: g.value === "users" })
                }, "历史用户", 2),
                c("a", {
                  href: "/admin/ai",
                  class: se({ active: g.value === "ai" })
                }, "AI 设置", 2),
                c("a", {
                  href: "/admin/api-manual",
                  class: se({ active: g.value === "api-manual" })
                }, "API 对接手册", 2)
              ]),
              r[27] || (r[27] = c("div", { class: "side-status" }, [
                fe("授权状态"),
                c("br"),
                c("strong", null, "已验证会话")
              ], -1))
            ]),
            c("section", jr, [
              c("div", { class: "admin-head" }, [
                r[28] || (r[28] = c("div", null, [
                  c("p", { class: "kicker" }, "OPERATIONS"),
                  c("h1", null, "行情日报后台"),
                  c("p", null, "外部分析服务上传当日报告后，可在后台预览和管理报告。")
                ], -1)),
                c("button", {
                  class: "ghost",
                  onClick: u
                }, "↻ 刷新数据")
              ]),
              Te.value ? (D(), F("p", $r, R(Te.value), 1)) : xe("", !0),
              g.value === "today" ? (D(), F("div", Hr, [
                c("section", Lr, [
                  c("div", Vr, [
                    c("div", null, [
                      r[29] || (r[29] = c("h2", null, "今日行情分析", -1)),
                      c("p", Br, R(i.value.today.date), 1)
                    ]),
                    c("span", {
                      class: se(["status", i.value.today.analysisStatus === "analyzed" ? "ready" : ""])
                    }, R(i.value.today.analysisStatus === "analyzed" ? "报告已生成" : "报告未生成"), 3)
                  ]),
                  c("div", Wr, [
                    c("div", qr, [
                      r[30] || (r[30] = c("small", null, "AI 渲染", -1)),
                      c("b", null, [
                        te.value === "running" ? (D(), F("span", zr)) : xe("", !0),
                        fe(R(It(te.value)), 1)
                      ])
                    ]),
                    c("div", Gr, [
                      r[31] || (r[31] = c("small", null, "报告状态", -1)),
                      c("b", null, R(i.value.today.analysisStatus === "analyzed" ? "可查看" : "等待上传"), 1)
                    ])
                  ]),
                  r[32] || (r[32] = c("div", {
                    class: "notice notice-disabled",
                    role: "status",
                    "aria-live": "polite"
                  }, [
                    c("strong", null, "邮件订阅已停用"),
                    c("span", null, "报告仍会保存在平台并可从“每日报告”查看，不再注册用户、不再发送邮件。")
                  ], -1))
                ])
              ])) : g.value === "reports" ? (D(), F("div", Jr, [
                c("section", Yr, [
                  c("div", Xr, [
                    r[33] || (r[33] = c("div", null, [
                      c("h2", null, "每日报告"),
                      c("p", null, "最近 60 个交易日，按日期从新到旧排列。可对已生成报告重新生成，或重置后重新上传。")
                    ], -1)),
                    c("span", Zr, R(q.value.length) + " 个交易日", 1)
                  ]),
                  c("div", Qr, [
                    (D(!0), F(pe, null, Ut(Re.value, (w) => {
                      var De, Ft;
                      return D(), F("div", {
                        key: w.date,
                        class: "report-card"
                      }, [
                        c("div", ea, [
                          c("strong", null, R(w.date), 1),
                          ((De = w.analysis) == null ? void 0 : De.temperature) != null ? (D(), F("span", ta, R(w.analysis.temperature) + "°", 1)) : xe("", !0)
                        ]),
                        c("div", sa, [
                          c("span", {
                            class: se(["status", w.analysisStatus === "analyzed" ? "ready" : ""])
                          }, R(w.analysisStatus === "analyzed" ? "已生成" : "待生成"), 3),
                          r[35] || (r[35] = c("span", { class: "status" }, "邮件已停用", -1)),
                          w.renderStatus === "running" ? (D(), F("span", na, r[34] || (r[34] = [
                            c("span", {
                              class: "task-spinner",
                              "aria-hidden": "true"
                            }, null, -1),
                            fe("渲染中", -1)
                          ]))) : w.renderStatus === "failed" ? (D(), F("span", ia, "渲染失败")) : xe("", !0)
                        ]),
                        (Ft = w.analysis) != null && Ft.summary ? (D(), F("p", la, R(w.analysis.summary), 1)) : xe("", !0),
                        c("div", oa, [
                          w.reportPath ? (D(), F("a", {
                            key: 0,
                            href: w.reportPath,
                            target: "_blank",
                            rel: "noreferrer"
                          }, "查看报告 ↗", 8, ra)) : xe("", !0),
                          w.analysisStatus === "analyzed" ? (D(), F("button", {
                            key: 1,
                            type: "button",
                            class: "report-reset",
                            onClick: (ue) => Ce(w)
                          }, "重新生成", 8, aa)) : xe("", !0),
                          c("button", {
                            type: "button",
                            class: "report-reset",
                            onClick: (ue) => We(w)
                          }, "重置", 8, ua)
                        ])
                      ]);
                    }), 128))
                  ]),
                  Re.value.length ? xe("", !0) : (D(), F("p", ca, "暂无交易日报记录。")),
                  c("div", fa, [
                    c("button", {
                      type: "button",
                      disabled: p.value === 1,
                      onClick: r[1] || (r[1] = (w) => nt(p.value - 1))
                    }, "上一页", 8, da),
                    (D(!0), F(pe, null, Ut(H.value, (w) => (D(), F("button", {
                      key: w,
                      type: "button",
                      class: se({ current: p.value === w }),
                      onClick: (De) => nt(w)
                    }, R(w), 11, pa))), 128)),
                    c("button", {
                      type: "button",
                      disabled: p.value === H.value,
                      onClick: r[2] || (r[2] = (w) => nt(p.value + 1))
                    }, "下一页", 8, ha)
                  ])
                ])
              ])) : g.value === "analysis" ? (D(), F("div", ga, [
                c("section", va, [
                  r[38] || (r[38] = c("h2", null, "分析任务", -1)),
                  c("div", ma, [
                    c("table", ya, [
                      r[37] || (r[37] = c("thead", null, [
                        c("tr", null, [
                          c("th", null, "交易日"),
                          c("th", null, "触发方式"),
                          c("th", null, "状态"),
                          c("th", null, "开始时间"),
                          c("th", null, "完成时间")
                        ])
                      ], -1)),
                      c("tbody", null, [
                        (D(!0), F(pe, null, Ut(i.value.analysisTasks, (w) => (D(), F("tr", {
                          key: w.date
                        }, [
                          c("td", null, R(w.date), 1),
                          c("td", null, R(w.trigger === "upload" ? "外部分析上传" : w.trigger === "manual" ? "后台重新生成" : w.trigger || "-"), 1),
                          c("td", null, [
                            c("span", {
                              class: se(["task-status", w.status])
                            }, [
                              w.status === "running" ? (D(), F("span", ba)) : xe("", !0),
                              fe(R(w.status === "running" ? "生成中" : w.status === "completed" ? "已完成" : w.status === "failed" ? "失败" : "等待中"), 1)
                            ], 2)
                          ]),
                          c("td", null, R(st(w.startedAt)), 1),
                          c("td", null, R(st(w.completedAt)), 1)
                        ]))), 128)),
                        (m = i.value.analysisTasks) != null && m.length ? xe("", !0) : (D(), F("tr", _a, r[36] || (r[36] = [
                          c("td", {
                            colspan: "5",
                            class: "empty-cell"
                          }, "暂无分析任务。", -1)
                        ])))
                      ])
                    ])
                  ])
                ])
              ])) : g.value === "progress" ? (D(), F("div", xa, r[39] || (r[39] = [
                c("section", { class: "panel" }, [
                  c("div", { class: "page-title" }, [
                    c("div", null, [
                      c("h2", null, "发送进度"),
                      c("p", null, "该页面保留用于说明历史数据状态。")
                    ]),
                    c("span", { class: "status" }, "已停用")
                  ]),
                  c("div", {
                    class: "notice notice-disabled",
                    role: "status",
                    "aria-live": "polite"
                  }, [
                    c("strong", null, "邮件订阅已停用"),
                    c("span", null, "平台不再创建发送任务、记录发送进度或调用邮件服务。")
                  ])
                ], -1)
              ]))) : g.value === "users" ? (D(), F("div", wa, [
                c("section", Sa, [
                  c("div", Ta, [
                    c("div", null, [
                      r[40] || (r[40] = c("h2", null, "历史用户", -1)),
                      c("p", null, "历史注册数据仅为兼容保留，不再接受新注册或恢复邮件订阅。共 " + R(Dt.value.total) + " 条记录。", 1)
                    ]),
                    c("span", Ca, "显示 " + R(it.value.length) + " / " + R(kt.value.length), 1)
                  ]),
                  r[42] || (r[42] = c("div", {
                    class: "notice notice-disabled",
                    role: "status",
                    "aria-live": "polite"
                  }, [
                    c("strong", null, "邮件订阅已停用"),
                    c("span", null, "以下列表仅供历史数据核对，不包含任何注册、验证或订阅操作。")
                  ], -1)),
                  c("div", Aa, [
                    Me(c("input", {
                      "onUpdate:modelValue": r[3] || (r[3] = (w) => ht.value = w),
                      type: "search",
                      placeholder: "按邮箱搜索…",
                      "aria-label": "搜索历史用户"
                    }, null, 512), [
                      [
                        Ne,
                        ht.value,
                        void 0,
                        { trim: !0 }
                      ]
                    ])
                  ]),
                  c("div", Ea, [
                    c("table", Oa, [
                      r[41] || (r[41] = c("thead", null, [
                        c("tr", null, [
                          c("th", null, "邮箱"),
                          c("th", null, "历史验证状态"),
                          c("th", null, "注册时间")
                        ])
                      ], -1)),
                      c("tbody", null, [
                        (D(!0), F(pe, null, Ut(it.value, (w) => (D(), F("tr", {
                          key: w.id
                        }, [
                          c("td", null, R(w.email), 1),
                          c("td", null, R(w.verified ? "已验证" : "待验证"), 1),
                          c("td", null, R(st(w.createdAt)), 1)
                        ]))), 128)),
                        it.value.length ? xe("", !0) : (D(), F("tr", Ma, [
                          c("td", Pa, "暂无历史用户" + R(ht.value ? "（无匹配结果）" : "") + "。", 1)
                        ]))
                      ])
                    ])
                  ]),
                  ke.value > 1 ? (D(), F("div", Ia, [
                    c("button", {
                      type: "button",
                      disabled: qe.value === 1,
                      onClick: r[4] || (r[4] = (w) => _t(qe.value - 1))
                    }, "上一页", 8, Ra),
                    (D(!0), F(pe, null, Ut(ke.value, (w) => (D(), F("button", {
                      key: w,
                      type: "button",
                      class: se({ current: qe.value === w }),
                      onClick: (De) => _t(w)
                    }, R(w), 11, ka))), 128)),
                    c("button", {
                      type: "button",
                      disabled: qe.value === ke.value,
                      onClick: r[5] || (r[5] = (w) => _t(qe.value + 1))
                    }, "下一页", 8, Da)
                  ])) : xe("", !0)
                ])
              ])) : g.value === "ai" ? (D(), F("div", Fa, [
                c("section", Ka, [
                  c("div", Ua, [
                    r[43] || (r[43] = c("div", null, [
                      c("h2", null, "AI 设置"),
                      c("p", null, "配置用于把行情 Markdown 排版为精美 HTML 报告的 GPT 或 Claude 模型服务。AI 从零设计排版并提炼首页数据（温度、指数、广度、主线等）；未配置或调用失败时回退基础渲染。")
                    ], -1)),
                    c("span", {
                      class: se(["status", { ready: (T = (E = A.value) == null ? void 0 : E.ai) == null ? void 0 : T.apiKeyMasked }])
                    }, R((I = (O = A.value) == null ? void 0 : O.ai) != null && I.apiKeyMasked ? "已配置" : "未配置"), 3)
                  ]),
                  c("div", Na, [
                    c("div", null, [
                      r[44] || (r[44] = c("small", null, "服务商", -1)),
                      c("strong", null, R(((B = (N = A.value) == null ? void 0 : N.ai) == null ? void 0 : B.provider) || "OpenAI Compatible"), 1)
                    ]),
                    c("div", null, [
                      r[45] || (r[45] = c("small", null, "当前模型", -1)),
                      c("strong", null, R(((ne = ($ = A.value) == null ? void 0 : $.ai) == null ? void 0 : ne.model) || "未设置"), 1)
                    ]),
                    c("div", null, [
                      r[46] || (r[46] = c("small", null, "调用协议", -1)),
                      c("strong", null, R(((_e = (ie = A.value) == null ? void 0 : ie.ai) == null ? void 0 : _e.protocol) === "anthropic_messages" ? "Claude Messages API" : "GPT Responses API"), 1)
                    ])
                  ]),
                  c("form", {
                    class: "settings-form",
                    onSubmit: Gn(v, ["prevent"])
                  }, [
                    c("div", ja, [
                      c("label", null, [
                        r[47] || (r[47] = fe("服务商名称", -1)),
                        Me(c("input", {
                          "onUpdate:modelValue": r[6] || (r[6] = (w) => C.value.provider = w),
                          maxlength: "80",
                          required: ""
                        }, null, 512), [
                          [
                            Ne,
                            C.value.provider,
                            void 0,
                            { trim: !0 }
                          ]
                        ])
                      ]),
                      c("label", null, [
                        r[49] || (r[49] = fe("接口格式", -1)),
                        Me(c("select", {
                          "onUpdate:modelValue": r[7] || (r[7] = (w) => C.value.protocol = w)
                        }, r[48] || (r[48] = [
                          c("option", { value: "openai_responses" }, "GPT Responses API", -1),
                          c("option", { value: "anthropic_messages" }, "Claude Messages API", -1)
                        ]), 512), [
                          [tl, C.value.protocol]
                        ])
                      ]),
                      c("label", null, [
                        r[50] || (r[50] = fe("模型 ID", -1)),
                        Me(c("input", {
                          "onUpdate:modelValue": r[8] || (r[8] = (w) => C.value.model = w),
                          maxlength: "200",
                          required: "",
                          placeholder: "例如 gpt-5.6-luna 或 claude-sonnet-4-5"
                        }, null, 512), [
                          [
                            Ne,
                            C.value.model,
                            void 0,
                            { trim: !0 }
                          ]
                        ])
                      ]),
                      c("label", null, [
                        r[51] || (r[51] = fe("接口超时（秒）", -1)),
                        Me(c("input", {
                          "onUpdate:modelValue": r[9] || (r[9] = (w) => C.value.timeoutSeconds = w),
                          type: "number",
                          min: "30",
                          max: "3600",
                          required: ""
                        }, null, 512), [
                          [
                            Ne,
                            C.value.timeoutSeconds,
                            void 0,
                            { number: !0 }
                          ]
                        ])
                      ]),
                      c("label", $a, [
                        r[52] || (r[52] = fe("Base URL", -1)),
                        Me(c("input", {
                          "onUpdate:modelValue": r[10] || (r[10] = (w) => C.value.baseUrl = w),
                          type: "url",
                          placeholder: "https://api.openai.com/v1 或 https://api.anthropic.com/v1"
                        }, null, 512), [
                          [
                            Ne,
                            C.value.baseUrl,
                            void 0,
                            { trim: !0 }
                          ]
                        ])
                      ]),
                      c("label", Ha, [
                        r[53] || (r[53] = fe("API Key", -1)),
                        c("span", La, [
                          Me(c("input", {
                            "onUpdate:modelValue": r[11] || (r[11] = (w) => C.value.apiKey = w),
                            type: Q.value ? "text" : "password",
                            autocomplete: "new-password",
                            placeholder: "输入 API Key"
                          }, null, 8, Va), [
                            [
                              xr,
                              C.value.apiKey,
                              void 0,
                              { trim: !0 }
                            ]
                          ]),
                          c("button", {
                            type: "button",
                            class: "secret-toggle",
                            "aria-label": Q.value ? "隐藏 AI API Key" : "显示 AI API Key",
                            "aria-pressed": Q.value,
                            onClick: r[12] || (r[12] = (w) => Q.value = !Q.value)
                          }, R(Q.value ? "隐藏" : "显示"), 9, Ba)
                        ])
                      ])
                    ]),
                    c("div", Wa, [
                      c("label", null, [
                        Me(c("input", {
                          "onUpdate:modelValue": r[13] || (r[13] = (w) => C.value.enabled = w),
                          type: "checkbox"
                        }, null, 512), [
                          [el, C.value.enabled]
                        ]),
                        r[54] || (r[54] = fe(" 启用 AI 排版（未启用或调用失败时回退到默认渲染）", -1))
                      ])
                    ]),
                    c("div", qa, [
                      c("button", {
                        type: "button",
                        disabled: U.value,
                        onClick: x
                      }, R(U.value ? "检测中…" : "检测连接"), 9, za),
                      r[55] || (r[55] = c("button", {
                        class: "primary",
                        type: "submit"
                      }, "保存 AI 配置", -1)),
                      c("span", Ga, R(K.value), 1)
                    ])
                  ], 32)
                ])
              ])) : g.value === "email" ? (D(), F("div", Ja, r[56] || (r[56] = [
                c("section", { class: "panel" }, [
                  c("div", { class: "page-title" }, [
                    c("div", null, [
                      c("h2", null, "邮件设置"),
                      c("p", null, "该页面保留用于说明历史配置状态。")
                    ]),
                    c("span", { class: "status" }, "已停用")
                  ]),
                  c("div", {
                    class: "notice notice-disabled",
                    role: "status",
                    "aria-live": "polite"
                  }, [
                    c("strong", null, "邮件订阅已停用"),
                    c("span", null, "Resend 配置不再读取或修改，平台不会发送验证邮件、日报或其他订阅邮件。")
                  ])
                ], -1)
              ]))) : g.value === "report-upload" ? (D(), F("div", Ya, [
                c("section", Xa, [
                  c("div", Za, [
                    r[57] || (r[57] = c("div", null, [
                      c("h2", null, "报告上传"),
                      c("p", null, "手动保存当日行情报告的 Markdown，与外部接口上传共用同一处理机制：渲染 HTML、标记为已分析。")
                    ], -1)),
                    c("span", {
                      class: se(["status", { ready: i.value.today.analysisStatus === "analyzed" }])
                    }, R(i.value.today.analysisStatus === "analyzed" ? "今日报告已生成" : "今日报告未生成"), 3)
                  ]),
                  c("form", {
                    class: "settings-form",
                    onSubmit: Gn(b, ["prevent"])
                  }, [
                    c("div", Qa, [
                      c("label", null, [
                        r[58] || (r[58] = fe("交易日", -1)),
                        Me(c("input", {
                          "onUpdate:modelValue": r[14] || (r[14] = (w) => oe.value.date = w),
                          type: "date",
                          required: ""
                        }, null, 512), [
                          [
                            Ne,
                            oe.value.date,
                            void 0,
                            { trim: !0 }
                          ]
                        ])
                      ])
                    ]),
                    c("div", eu, [
                      c("div", tu, [
                        r[59] || (r[59] = c("h3", null, "报告 Markdown", -1)),
                        c("span", su, R(tt.value), 1)
                      ]),
                      Me(c("textarea", {
                        "onUpdate:modelValue": r[15] || (r[15] = (w) => oe.value.markdown = w),
                        spellcheck: "false",
                        placeholder: `# A股收盘复盘

正文…（支持 YAML frontmatter 的 title / summary）`,
                        "aria-label": "报告 Markdown 内容"
                      }, null, 512), [
                        [Ne, oe.value.markdown]
                      ]),
                      c("button", {
                        class: "primary",
                        disabled: be.value,
                        type: "submit"
                      }, R(be.value ? "保存中…" : "保存并生成报告"), 9, nu)
                    ])
                  ], 32)
                ])
              ])) : g.value === "api-manual" ? (D(), F("div", iu, [
                c("section", lu, [
                  c("div", { class: "page-title" }, [
                    r[60] || (r[60] = c("div", null, [
                      c("h2", null, "API 对接手册"),
                      c("p", null, "上传每日行情（报告 MD）接口对接说明。下方为真实接入信息与完整对接文本，复制后可直接给外部分析服务或 AI 工具使用；上传密钥请妥善保管。")
                    ], -1)),
                    c("button", {
                      class: "ghost refresh-button",
                      type: "button",
                      onClick: _
                    }, "↻ 刷新")
                  ]),
                  c("div", ou, [
                    c("div", null, [
                      r[61] || (r[61] = c("small", null, "Base URL", -1)),
                      c("strong", null, R(G.value || "—"), 1),
                      c("button", {
                        class: "manual-copy",
                        type: "button",
                        onClick: r[16] || (r[16] = (w) => S(G.value, "base"))
                      }, R(W.value === "base" ? "已复制 ✓" : "复制"), 1)
                    ]),
                    c("div", null, [
                      r[62] || (r[62] = c("small", null, "上传密钥 · x-upload-key", -1)),
                      c("strong", null, [
                        c("span", ru, [
                          c("input", {
                            type: M.value ? "text" : "password",
                            value: J.value || "—",
                            readonly: "",
                            "aria-label": "上传密钥"
                          }, null, 8, au),
                          c("button", {
                            type: "button",
                            class: "secret-toggle",
                            "aria-label": M.value ? "隐藏上传密钥" : "显示上传密钥",
                            "aria-pressed": M.value,
                            onClick: r[17] || (r[17] = (w) => M.value = !M.value)
                          }, R(M.value ? "隐藏" : "显示"), 9, uu)
                        ])
                      ]),
                      c("button", {
                        class: "manual-copy",
                        type: "button",
                        onClick: r[18] || (r[18] = (w) => S(J.value, "upload"))
                      }, R(W.value === "upload" ? "已复制 ✓" : "复制"), 1)
                    ])
                  ]),
                  c("div", cu, [
                    c("span", fu, R(ye.value ? "正在加载对接文本…" : j.value ? "已加载完整对接文本（含真实密钥）。" : ""), 1),
                    c("button", {
                      class: "primary",
                      type: "button",
                      disabled: ye.value,
                      onClick: r[19] || (r[19] = (w) => S(j.value, "full"))
                    }, R(W.value === "full" ? "已复制全文 ✓" : "复制全文（含真实密钥）"), 9, du)
                  ]),
                  j.value ? (D(), F("pre", pu, R(j.value), 1)) : (D(), F("p", hu, "正在加载对接手册…"))
                ])
              ])) : xe("", !0)
            ])
          ], 64)) : (D(), F("section", Kr, [
            r[22] || (r[22] = c("p", { class: "gate-mark" }, "SECURE ADMIN", -1)),
            r[23] || (r[23] = c("h1", null, "进入行情日报后台", -1)),
            r[24] || (r[24] = c("p", null, "请输入后台授权密码。", -1)),
            c("label", null, [
              r[21] || (r[21] = fe("授权密码", -1)),
              Me(c("input", {
                "onUpdate:modelValue": r[0] || (r[0] = (w) => o.value = w),
                type: "password",
                onKeyup: Ar(As, ["enter"])
              }, null, 544), [
                [Ne, o.value]
              ])
            ]),
            c("button", {
              class: "primary",
              onClick: As
            }, "验证并进入"),
            c("p", Ur, R(a.value), 1)
          ]))
        ])
      ])) : (D(), F("div", Rr, r[20] || (r[20] = [
        Lo('<header class="nav"><a class="logo" href="/">行情日报<span>DESKTOP MARKET DESK</span></a><nav><a href="#features">功能</a><a href="#how">工作方式</a><a href="#download">下载</a></nav></header><main><section class="site-hero"><div class="hero-copy"><p class="kicker">LOCAL MARKET DESK · 免费桌面版</p><h1>A 股行情，<br><em>一屏看懂。</em></h1><p class="lede">实时行情、板块、龙虎榜和收盘复盘。数据在你的电脑本地整理，打开应用就能开始工作。</p><div class="actions"><a class="primary" href="#download">下载桌面版</a><a class="text-link" href="#features">查看功能</a></div><p class="fine">Windows · macOS · 免费 · 不需要交易账户</p></div><div class="hero-console" aria-label="行情日报桌面版功能预览"><div class="console-bar"><span class="console-brand"><i></i> 行情日报</span><span class="console-caption">DESKTOP APP</span><span class="console-status">● 本地运行</span></div><div class="console-content"><div class="console-heading"><div><small>MARKET DESK / FEATURES</small><strong>收盘后的工作台</strong></div><span class="console-refresh">无账号也能使用</span></div><div class="console-indices"><div class="console-index"><small>实时行情</small><strong>--</strong><span>本地更新</span></div><div class="console-index"><small>每日复盘</small><strong>15:35</strong><span>工作日生成</span></div><div class="console-index"><small>系统通知</small><strong>可选</strong><span>托盘运行</span></div></div><div class="console-table"><div><span>数据来源</span><b>腾讯行情 · 东方财富</b></div><div><span>运行方式</span><b>本地直连公开接口</b></div><div><span>支持平台</span><b>Windows · macOS</b></div></div></div></div></section><section id="features" class="feature-section"><div class="section-heading"><p class="kicker">ONE SCREEN, EIGHT BLOCKS</p><h2>为每天收盘后的十分钟设计</h2><p>把需要反复打开的行情入口，收拢成一张安静、可扫描的桌面工作台。</p></div><div class="feature-grid"><article><span class="feature-index">01</span><h3>实时行情</h3><p>A 股指数与自选股实时报价，刷新频率可调，涨跌语义清晰。</p></article><article><span class="feature-index">02</span><h3>每日复盘</h3><p>市场温度、大盘概览、资金流、海外市场和要闻集中呈现。</p></article><article><span class="feature-index">03</span><h3>板块与龙虎榜</h3><p>领涨板块、涨停连板梯队和龙虎榜净买入，收盘后一次看完。</p></article><article><span class="feature-index">04</span><h3>本地直连公开数据</h3><p>腾讯行情与东方财富公开接口在本地整理，不经过平台服务器中转。</p></article></div></section><section id="how" class="how section"><div class="section-heading"><p class="kicker">HOW IT WORKS</p><h2>从数据到桌面，只需三步</h2></div><div class="steps"><div><b>01</b><h3>安装桌面版</h3><p>Windows 和 macOS 安装包发布后可直接下载使用。</p></div><div><b>02</b><h3>本地抓取行情</h3><p>应用直接读取公开行情源，在本机整理实时数据。</p></div><div><b>03</b><h3>收盘后查看</h3><p>工作日 15:35 后生成复盘，完成时可发送系统通知。</p></div></div></section><section id="download" class="download-section"><div><p class="kicker">DESKTOP RELEASE</p><h2>把行情日报放在桌面上</h2><p>正式安装包正在准备。当前网站先完成产品介绍与下载入口，版本发布后会在这里提供校验过的安装文件。</p></div><div class="download-options"><button class="download-option" type="button" disabled><span>Windows</span><strong>安装包准备中</strong><small>即将提供 · 免费</small></button><button class="download-option" type="button" disabled><span>macOS</span><strong>安装包准备中</strong><small>即将提供 · 免费</small></button></div></section><section id="data" class="compliance-section section"><div class="section-heading"><p class="kicker">DATA &amp; DISCLAIMER</p><h2>数据从哪里来？</h2></div><div class="compliance-grid"><div><h3>公开来源，本地整理</h3><p>行情日报使用腾讯行情、东方财富等公开免费数据源。桌面版在本地取数和整理，不采集你的交易信息，也不经过平台服务器中转。</p></div><div><h3>免责声明</h3><p>行情日报仅提供行情数据的展示与整理，所有数据来自公开来源，仅供参考，不构成任何投资建议。「市场温度」「情绪指标」等均为统计性描述，不代表未来走势，不构成买卖信号。股市有风险，投资需谨慎。</p></div></div></section></main><footer><span>© 2026 行情日报 · Desktop Market Desk</span><span><a href="#data">数据来源与免责声明</a> · <a href="#download">下载</a></span></footer>', 3)
      ])));
    };
  }
};
Mr(gu).mount("#app");
