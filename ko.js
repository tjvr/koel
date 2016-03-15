var ko = (function() {
  'use strict';

  function assert(x, message) {
    if (!x) {
      throw new Error("Assertion failed: " + (message || ''));
    }
  }

  function assertFunction(v) { if (!isFunction(v)) throw "Not a function: " + v; }
  function isFunction(v) {
    return typeof v === 'function' && !(v instanceof Observable);
  }
  function isObservable(v) {
    return v instanceof Observable;
  }
  function isComputed(v) {
    return v instanceof Observable && !v.assign;
  }

  /* observable */

  var readCallback;
  var watchCallback;

  var Observable = function(initial) {
    this._id = Observable.highestId++;
    this._value = initial;
    this._subscribers = [];
    this._listeners = {};
    // for computeds
    this._dependencies = [];
    this._isChanging = false;

    var OK = function() {
      if (arguments.length) throw "No arguments allowed! Did you mean .assign()";
      if (readCallback) readCallback(OK);
      return OK.peek();
    };

    OK.__proto__ = this;

    var _this = OK;
    // assign is attached to the object itself, because then we can `delete` it
    OK.assign = function(newValue) {
      if (_this._value === newValue) return;
      var oldValue = _this._value;
      _this._value = newValue;

      if (_this._isChanging) return;
      _this._isChanging = true;
      _this.emit('assign', newValue, oldValue);
      _this._isChanging = false;
    };

    return OK;
  };
  Observable.highestId = 0;

  Observable.prototype.peek = function() {
    return this._value;
  };

  Observable.prototype.emit = function(name /* args */) {
    var _this = this;
    var args = [].slice.call(arguments, 1);
    var listeners = this._listeners[name] || [];
    for (var i=0; i<listeners.length; i++) {
      var cb = listeners[i];
      cb.apply(_this, args);
    }
    this._changed(this._value);
    if (watchCallback) watchCallback(this, name, args);
  };

  Observable.prototype._changed = function(newValue) {
    var tmp = readCallback;
    readCallback = null;

    var subscribers = this._subscribers.slice();
    for (var i=0; i<subscribers.length; i++) {
      var s = subscribers[i];
      var cb = s._notify || s;
      cb.call(undefined, newValue);
    }

    readCallback = tmp;
  };

  Observable.prototype.subscribe = function(subscriber, callNow) {
    if (subscriber === undefined) throw "undefined subscriber";
    var callNow = (callNow === undefined) ? true : !!callNow;
    var cb;
    if (typeof subscriber === 'object') {
      for (var name in subscriber) {
        assertFunction(subscriber[name]);
        this._listeners[name] = this._listeners[name] || [];
        this._listeners[name].push(subscriber[name]);
      }
      cb = subscriber.assign;
    } else {
      cb = subscriber._notify || subscriber; // Computed or function
      assertFunction(cb);
      this._subscribers.push(subscriber);
    }
    // TODO: what's Knockout's approach to callNow?
    if (callNow && cb) {
      var tmp = readCallback;
      readCallback = null;

      cb.call(undefined, this._value);

      readCallback = tmp;
    }
  };

  Observable.prototype.unsubscribe = function(cb) {
    var index = this._subscribers.indexOf(cb);
    this._subscribers.splice(index, 1); // remove
  };

  Observable.prototype.destroy = function(cb) {
    var _this = this;
    this._subscribers = [];
    this._dependencies.forEach(function(dep) {
      dep.unsubscribe(_this);
    });
    this._dependencies = [];
  }

  Observable.prototype.compute = function(func) {
    assertFunction(func);
    var _this = this;
    return computed(function() {
      return func(_this());
    });
  };

  var observable = function(v) {
    if (v instanceof Observable) return v;
    return new Observable(v);
  };

  var _test = observable();
  if (!_test.emit) throw "koel not supported";

  /* computed */

  var computed = function(func) {
    assertFunction(func);
    var args = [].slice.call(arguments, 1);

    var result;

    function recompute() {
      var newDependencies = [];
      var tmp = readCallback;
      readCallback = function(dep) {
        if (newDependencies.indexOf(dep) !== -1) return;
        newDependencies.push(dep);
      };

      var value;
      try {
        value = func.apply(undefined, args);
      } finally {
        readCallback = tmp;
      }

      if (result) {
        // Unsubscribe from old dependencies
        var oldDependencies = result._dependencies;
        for (var i=0; i<oldDependencies.length; i++) {
          oldDependencies[i].unsubscribe(result);
        }
      }

      if (!result) {
        // Make sure the observable is initialised with the initial value
        result = ko(value);
        result._isComputed = true;

        // This makes sure subscribe works. Should never actually be called!
        result._notify = function() { assert(false); }
      }

      // Subscribe new dependencies
      for (var i=0; i<newDependencies.length; i++) {
        newDependencies[i].subscribe(result, false);
      }
      result._dependencies = newDependencies;

      return value;
    }

    // Compute initial value & create observable
    recompute();

    // Computables can't be assigned
    var _assign = result.assign;
    delete result.assign;
    assert(!result.assign);

    result._isComputing = false;

    result._notify = function() {
      if (this._isComputing) return;
      _assign(recompute());
    }.bind(result);

    return result;
  };

  /* plugins */

  var func = function(v) {
    return (typeof v === 'function') ? computed(v) : observable(v);
  };

  var ko = function(v) {
    if (v instanceof Observable) return v;
    return func(v);
  };
  ko.Observable = Observable;

  ko.observable = observable;
  ko.computed = computed;

  ko.subscribe = function(v, obj) {
    if (v instanceof Observable) {
      v.subscribe(obj);
    } else {
      if (typeof obj === "function") {
        obj(v);
      } else {
        obj.assign(v);
      }
    }
  };

  ko.isObservable = isObservable;
  ko.isFunction = isFunction;
  ko.isComputed = isComputed;

  ko.plugin = function(cb) {
    var _super = func;
    func = function(v) {
      return cb(v, _super);
    };
  };

  ko.watch = function(func, cb) {
    var tmp = watchCallback;
    watchCallback = cb;

    func();

    watchCallback = tmp;
  };

  return ko;

}());

/*****************************************************************************/

/*
 * Boolean plugin
 */

ko.plugin(function(value, _super) {
  var observable = _super(value);

  if (typeof value === 'boolean') {
    observable.negate = function() {
      return this.compute(function(value) {
        return !value;
      });
    }.bind(observable);

    observable.toggle = function() {
      this.assign(!this());
    }.bind(observable);
  }

  return observable;
});

/*****************************************************************************/

/*
 * Array plugin
 */

ko.plugin(function(value, _super) {
  var computed = ko.computed;

  var events = {
    insert: function(index, item)  { this.splice(index, 0, item); },
    replace: function(index, item) {
      if (this[index] === item) return;
      return this.splice(index, 1, item)[0];
    },
    remove: function(index)        { return this.splice(index, 1)[0]; },
  };

  var actions = {
    push: function(item) { return this.insert(this().length, item); },
    pop: function()      { return this.remove(this().length - 1); },
    shift: function()  { return this.remove(0); },
  };

  var deriveds = {
    map: function(cb) {
      var resultObservables = [];

      function initial(array) {
        resultObservables = array.map(function(inputItem) {
          var observable = computed(cb, inputItem);
          subscribeTo(observable);
          return observable;
        });

        return resultObservables.map(function(observable) {
          return observable();
        });
      }

      var derived = derivedArray();

      function subscribeTo(observable) {
        observable.subscribe(function(outputItem) {
          // index of observable might change after we bind to it!
          var index = resultObservables.indexOf(observable);
          derived._replace(index, outputItem);
        }, false);
      }

      this.subscribe({
        assign: function(array) {
          resultObservables.forEach(function(observable) {
            observable.destroy();
          });
          derived._assign(initial(array));
        },
        replace: function(index, inputItem) {
          resultObservables[index].destroy();
          var observable = computed(cb, inputItem);
          resultObservables[index] = observable;
          var outputItem = observable();
          derived._replace(index, outputItem);
          subscribeTo(observable);
        },
        insert: function(index, inputItem) {
          var observable = computed(cb, inputItem);
          resultObservables.splice(index, 0, observable);
          subscribeTo(observable);
          var outputItem = observable();
          derived._insert(index, outputItem);
        },
        remove: function(index) {
          resultObservables[index].destroy();
          resultObservables.splice(index, 1);
          derived._remove(index);
        },
      });

      derived.destroy = function() {
        resultObservables.forEach(function(observable) {
          observable.destroy();
        });
        ko.g
      }

      return derived;
    },
    filter: function(cb) {
      var resultObservables = [];

      function initial(array) {
        resultObservables = array.map(function(item) {
          var observable = computed(cb, item);
          subscribeTo(observable);
          return observable;
        });

        return array.filter(function(item, inputIndex) {
          var observable = resultObservables[inputIndex];
          return observable();
        });
      }

      var derived = derivedArray();

      this.subscribe({
        assign: function(array) {
          resultObservables.forEach(function(observable) {
            observable.destroy();
          });
          derived.assign(initial(array));
        },
        replace: function(inputIndex, item) {
          var previous = resultObservables[inputIndex]
          var wasIncluded = previous();
          previous.destroy();
          var observable = computed(cb, item);
          resultObservables[inputIndex] = observable;
          var include = observable();
          considerItem(wasIncluded, include, inputIndex, item);
          subscribeTo(observable);
        },
        insert: function(inputIndex, item) {
          var observable = computed(cb, item);
          resultObservables.splice(inputIndex, 0, observable);
          subscribeTo(observable);
          var include = observable();
          if (include) {
            var outputIndex = getOutputIndex(inputIndex);
            derived._insert(outputIndex, item);
          }
        },
        remove: function(inputIndex) {
          var previous = resultObservables[inputIndex];
          var wasIncluded = previous();
          previous.destroy();
          resultObservables.splice(inputIndex, 1);
          if (wasIncluded) {
            var outputIndex = getOutputIndex(inputIndex);
            derived._remove(outputIndex);
          }
        },
      });

      var self = this;
      function subscribeTo(observable) {
        observable.subscribe(function(include) {
          var inputIndex = resultObservables.indexOf(observable);
          var array = self();
          var item = array[inputIndex];
          considerItem(!include, include, inputIndex, item);
        }, false);
      }

      function considerItem(wasIncluded, include, inputIndex, item) {
        // index of observable might change after we bind to it!
        var outputIndex = getOutputIndex(inputIndex);
        if (include && wasIncluded) {
          derived._replace(outputIndex, item);
        } else if (include && !wasIncluded) {
          derived._insert(outputIndex, item);
        } else if (!include && wasIncluded) {
          derived._remove(outputIndex);
        }
      }

      function getOutputIndex(inputIndex) {
        return resultObservables.slice(0, inputIndex).filter(function(x) {
          return x();
        }).length;
      }

      derived.destroy = function() {
        resultObservables.forEach(function(observable) {
          observable.destroy();
        });
      };
      return derived;
    },
  };

  function derivedArray() {
    var derived = ko([]);
    for (key in events) {
      derived['_'+key] = derived[key];
      delete derived[key];
    }
    for (key in actions) {
      delete derived[key];
    }
    derived._assign = derived.assign;
    delete derived.assign;
    return derived;
  }

  function makeObservableArray(array) {
    delete array.length;
    array.length = computed(function() {
      return this().length;
    }.bind(array));

    Object.keys(events).forEach(function(key) {
      array[key] = (function() {
        var func = events[key];
        var value = this();
        var args = [].slice.call(arguments);
        var result = func.apply(value, args);
        args.push(result);
        this.emit.apply(this, [key].concat(args));
        return result;
      }).bind(array);
    });

    Object.keys(actions).forEach(function(key) {
      array[key] = actions[key].bind(array);
    });

    Object.keys(deriveds).forEach(function(key) {
      array[key] = deriveds[key].bind(array);
    });
  };

  var observable = _super(value);
  if (value instanceof Array) {
    makeObservableArray(observable);
  }
  return observable;

});
