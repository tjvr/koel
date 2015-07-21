var ko = (function() {

  function assertFunc(v) {
    if (typeof v !== 'function') throw "Not a function: " + v;
  }

  /* observable */

  var readCallback;

  var Observable = function(initial) {
    this._id = Observable.highestId++;
    this._value = initial;
    this._subscribers = [];
    this.listeners = {};
    // for computeds
    this._dependencies = [];

    var foo = function() {
      if (arguments.length) throw "No arguments allowed!";
      if (readCallback) readCallback(foo);
      return foo.peek();
    };

    delete foo.length;
    foo.__proto__ = this;
    for (key in this) {
      if (typeof this[key] === 'function' && this[key].bind) {
        foo[key] = this[key].bind(foo);
      } else if (foo[key] !== this[key]) {
        // extend, if setting proto doesn't work
        foo[key] = this[key];
      }
    }
    return foo;
  };
  Observable.highestId = 0;

  Observable.prototype.peek = function() {
    return this._value;
  };

  Observable.prototype.assign = function(newValue) {
    if (this._value === newValue) return;
    this._value = newValue;
    this.emit('assign', newValue);
    this.changed(newValue);
  };

  Observable.prototype.changed = function(newValue) {
    var newValue = newValue || this();
    this._subscribers.forEach(function(subscriber) {
      var cb = subscriber._notify || subscriber;
      callSubscriber(cb, newValue);
    });
  };

  Observable.prototype.subscribe = function(subscriber, callNow) {
    var callNow = (callNow === undefined) ? true : !!callNow;
    var cb = subscriber._notify || subscriber; // Observable or function
    assertFunc(cb);
    // TODO: what's Knockout's approach to callNow?
    this._subscribers.push(subscriber);
    if (callNow) {
      callSubscriber(cb, this._value);
    }
  };

  function callSubscriber(cb, value) {
    var tmp = readCallback;
    readCallback = null;

    cb.call(null, value);

    readCallback = tmp;
  }

  Observable.prototype.unsubscribe = function(cb) {
    var index = this._subscribers.indexOf(cb);
    this._subscribers.splice(index, 1); // remove
  };

  /*
   * remove all subscribers (& subscriptions, if a computed).
   */
  Observable.prototype.dispose = function(cb) {
    this._subscribers = [];
    this._dependencies.forEach(function(dep) {
      dep.unsubscribe();
    });
    this._dependencies = [];
  }

  Observable.prototype.on = function(name, cb) {
    this.listeners[name] = this.listeners[name] || [];
    this.listeners[name].push(cb);
  };

  Observable.prototype.emit = function(name /* args */) {
    var _this = this;
    var args = [].slice.call(arguments, 1);
    (this.listeners[name] || []).forEach(function(cb) {
      cb.apply(_this, args);
    });
  };

  Observable.prototype.compute = function(func) {
    assertFunc(func);
    var _this = this;
    return computed(function() {
      return func(_this());
    });
  };

  var observable = function(v) {
    if (v instanceof Observable) return v;
    return new Observable(v);
  };

  /* computed */

  var computed = function(func) {
    assertFunc(func);
    var args = [].slice.call(arguments, 1);

    var result = new Observable(undefined);
    var _assign = result.assign;
    delete result.assign;
    result._notify = function() {
      if (this._isComputing) return;
      _assign(recompute());
    }.bind(result);
    result._isComputing = false;

    function recompute() {
      try {
        var tmp = readCallback;
        readCallback = function(other) {
          if (result._dependencies.indexOf(other) !== -1) return;
          result._dependencies.push(other);
          other.subscribe(result, false);
        };

        var value = func.apply(null, args);
        return value;

      } finally {
        readCallback = tmp;
      }
    }

    _assign(recompute());
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

  ko.observable = observable;
  ko.computed = computed;

  ko.subscribe = function(v, cb) {
    if (v instanceof Observable) {
      v.subscribe(cb);
    } else {
      cb(v);
    }
  };

  ko.isObservable = function(v) {
    return (v instanceof Observable);
  };

  ko.plugin = function(cb) {
    var _super = func;
    func = function(v) {
      return cb(v, _super);
    };
  };
  return ko;

}());

/*****************************************************************************/

/*
 * Array plugin
 */
ko.plugin(function(value, _super) {
  var computed = ko.computed;

  var events = {
    insert: function(index, item)  { this.splice(index, 0, item); },
    replace: function(index, item) { return this.splice(index, 1, item); },
    remove: function(index)        { return this.splice(index, 1); },
  };

  var actions = {
    push: function(item) { return this.insert(this.length(), item); },
    pop: function()      { return this.remove(this.length() - 1, item); },
    shift: function()  { return this.remove(0); },
  };

  var deriveds = {
    map: function(cb) {
      var resultObservables;
      
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

      var derived = ko(initial(this()));

      this.on('assign', function(array) {
        derived.emit('assign', initial(array));
        derived.changed();
      });

      this.on('replace', function(index, inputItem) {
        resultObservables[index].dispose();
        var observable = computed(cb, inputItem);
        resultObservables[index] = observable;
        var outputItem = observable();
        derived._replace(index, outputItem);
        subscribeTo(observable);
      });

      function subscribeTo(observable) {
        observable.subscribe(function(outputItem) {
          // index of observable might change after we bind to it!
          var index = resultObservables.indexOf(observable);
          derived._replace(index, outputItem);
        }, false);
      }

      this.on('insert', function(index, inputItem) {
        var observable = computed(cb, inputItem);
        resultObservables.splice(index, 0, observable);
        subscribeTo(observable);
        var outputItem = observable();
        derived._insert(index, outputItem);
      });

      this.on('remove', function(index) {
        resultObservables[index].dispose();
        resultObservables.splice(index, 1);
        derived._remove(index);
      });

      return derived;
    },

    filter: function(cb) {
      var resultObservables;

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

      var derived = ko(initial(this()));

      this.on('assign', function(array) {
        derived.emit('assign', initial(array));
        derived.changed();
      });

      this.on('replace', function(inputIndex, item) {
        var previous = resultObservables[inputIndex]
        var wasIncluded = previous();
        previous.dispose();
        var observable = computed(cb, item);
        resultObservables[inputIndex] = observable;
        var include = observable();
        considerItem(wasIncluded, include, inputIndex, item);
        subscribeTo(observable);
      });

      function subscribeTo(observable) {
        observable.subscribe(function(include) {
          var inputIndex = resultObservables.indexOf(observable);
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

      this.on('insert', function(inputIndex, item) {
        var observable = computed(cb, item);
        resultObservables.splice(inputIndex, 0, observable);
        subscribeTo(observable);
        var outputIndex = getOutputIndex(inputIndex);
        derived._insert(outputIndex, item);
      });

      this.on('remove', function(inputIndex) {
        var previous = resultObservables[inputIndex];
        var wasIncluded = previous();
        previous.dispose();
        resultObservables.splice(inputIndex, 1);
        if (wasIncluded) {
          var outputIndex = getOutputIndex(inputIndex);
          derived._remove(outputIndex);
        }
      });

      return derived;
    },
  };

  function fixDerivedArray(derived) {
    for (key in events) { delete derived[key]; }
    for (key in actions) { delete derived[key]; }
    delete derived.replace;
    return derived;
  }

  function makeObservableArray(array) {
    delete array.length;
    array.length = computed(function() {
      return this().length;
    }.bind(array));

    Object.keys(events).forEach(function(key) {
      array['_'+key] = array[key] = (function() {
        var func = events[key];
        var value = this();
        var args = [].slice.call(arguments);
        var result = func.apply(value, args);
        this.emit.apply(this, [key].concat(args));
        this.changed();
        return result;
      }).bind(array);
    });

    Object.keys(actions).forEach(function(key) {
      array[key] = actions[key].bind(array);
    });

    Object.keys(deriveds).forEach(function(key) {
      array[key] = (function() {
        var func = deriveds[key];
        var derived = func.apply(this, arguments);
        return fixDerivedArray(derived);
      }).bind(array);
    });
  };

  var observable = _super(value);
  if (value instanceof Array) {
    makeObservableArray(observable);
  }
  return observable;
});

/*****************************************************************************/

var el = (function() {
  var directProperties = {
    'class': 'className',
    className: 'className',
    defaultValue: 'defaultValue',
    'for': 'htmlFor',
    html: 'innerHTML',
    text: 'textContent',
    value: 'value',
  };

  var booleanProperties = {
    checked: 1,
    defaultChecked: 1,
    disabled: 1,
    multiple: 1,
    selected: 1,
  };

  function setProperty(el, key, value) {
    var listener = null;
    ko.subscribe(value, function(value) {
      if (/^on_/.test(key)) {
        if (listener) el.removeEventListener(key.slice(3), value, false);
        el.addEventListener(key.slice(3), value, false);
        listener = value;
        return;
      }

      var prop = directProperties[key];
      if (prop) {
        if (prop === 'className' && value instanceof Array) {
          el.className = ''; // TODO class list properly
          value.forEach(function(v) {
            el.classList.add(v);
          });
          return;
        }
        el[prop] = (value == null ? '' : '' + value);
      } else if (booleanProperties[key]) {
        if (value) {
          el.setAttribute(key, '');
        } else {
          el.removeAttribute(key);
        }
      } else if (value == null) {
        el.removeAttribute(key);
      } else {
        el.setAttribute(key, '' + value);
      }
    });
  };

  return function(selectors, attrs, content) {
    if (ko.isObservable(attrs) ||
        attrs instanceof Array ||
        typeof attrs === "string" || (attrs && attrs.appendChild)
    ) {
      content = attrs;
      attrs = {};
    }
    attrs = attrs || {};
    var mayHaveContent = !(attrs.text || attrs.textContent || attrs.html ||
                           attrs.innerHTML || attrs.innerText);

    var topParent;
    var result;
    selectors.split(/ +/g).forEach(function(selector) {
      var parts = selector.split(/([#.])/g);
      var tagName = parts[0] || 'div';
      var el = document.createElement(tagName);

      for (i=1, j=2; j < parts.length; i+=2, j+=2) {
        var value = parts[j];
        if (parts[i] == '#') {
          el.id = value;
        } else { // parts[i] == '.'
          el.classList.add(value);
        }
      }

      if (!topParent) topParent = el;
      if (result) result.appendChild(el);
      result = el;
    });

    for (key in attrs) {
      setProperty(result, key, attrs[key]);
    }

    if (!content) {
      return topParent;
    }
    if (!mayHaveContent) {
      throw "Cannot use both attrs and children to set content";
    }
    content = ko.observable(content || []);

    function makeChild(c) {
      if (c.appendChild === undefined) {
        c = document.createTextNode(c);
      }
      return c;
    }

    function refresh(children) {
      if (children.appendChild) { // Element
        children = [children];
      } else if (!(children instanceof Array)) { // String
        result.textContent = children;
        return;
      }
      // Array
      while (result.firstChild) result.removeChild(result.lastChild);
      children.forEach(function(child) {
        result.appendChild(makeChild(child));
      });
    }

    content.on('assign', refresh);
    refresh(content());

    content.on('insert', function(index, newChild) {
      result.insertBefore(makeChild(newChild), result.children[index]);
    });

    content.on('remove', function(index) {
      result.removeChild(result.children[index]);
    });

    content.on('replace', function(index, newChild) {
      result.replaceChild(result.children[index], makeChild(newChild));
    });

    return topParent;
  };
}());

