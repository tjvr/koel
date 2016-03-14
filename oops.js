var Oops = (function() {

  // how to undo events that koel emits

  var actions = {
    assign: function(newValue, oldValue) {
      this.assign(oldValue);
    },
    changed: function(newValue, oldValue) {
      this.assign(oldValue);
    },
    remove: function(index, item) {
      if (!this.insert) return;
      this.insert(index, item);
    },
    insert: function(index, item) {
      if (!this.remove) return;
      this.remove(index);
    },
  }


  // Operation -- a list of events

  var Operation = function(events, after) {
    this.events = events;
    this.after = after;
  };
  Operation.prototype.undoAndReverse = function() {
    var events = this.events.slice();
    events.reverse();

    var reversed = Oops._watch(function() {
      Oops.undoing = true;

      for (var i=0; i<events.length; i++) {
        var action = events[i];
        var func = actions[action.name];
        if (!func) throw action;
        func.apply(action.target, action.args);
      }

      Oops.undoing = false;
    });

    if (this.after) this.after();
    reversed.after = this.after;

    return reversed;
  };


  // CustomOperation -- for undoing non-ko events
  // used to integrate CodeMirror for example

  var CustomOperation = function(undo, redo) {
    this.undo = undo;
    this.redo = redo;
  };
  CustomOperation.prototype.reverse = function() {
    return new CustomOperation(this.redo, this.undo);
  };
  CustomOperation.prototype.undoAndReverse = function() {
    this.undo();
    return this.reverse();
  };


  // the undo manager

  var Oops = function(func) {
    // run the action and log all changes
    var op = Oops._watch(func);

    // push onto undo stack
    Oops.insert(op);
  };

  Oops.undoing = false;

  /* run a function and log each observable event */
  Oops._watch = function(func) {
    // don't call undo/redo() from inside an Oops() call
    assert(!Oops.undoing);

    // save active view observables
    var viewObservables = Oops._view();
    var observableValues = viewObservables.map(function(o) {
      return {
        observable: o,
        value: o(),
      };
    });
    var after = function() {
      observableValues.forEach(function(d) {
        d.observable.assign(d.value);
      });
    };

    // track observable changes
    var events = [];
    ko.watch(func, function(observable, operation, args) {
      // ignore computeds & UI scope
      if (ko.isComputed(observable)) return;
      if (viewObservables.indexOf(observable) > -1) {
        // if the view changes during the operation,
        // we can't meaningfully restore it after undo/redo
        after = null;
        // eg. a "replace project" operation in tosh
      }

      // save the event that was emitted
      events.push({
        target: observable,
        name: operation,
        args: args.map(copyForStore),
      });
    });

    if (!events.length) return;
    return new Operation(events, after);
  };

  // `view` returns a list of observables describing the current view state
  // so we can restore it after undo/redo
  //
  // eg. active sprite & active tab in tosh
  Oops._view = function() {
    return [];
  };
  Oops.setView = function(func) {
    Oops._view = func;
  };

  Oops.undoStack = [];
  Oops.redoStack = [];

  function copyForStore(value) {
    if (ko.isObservable(value)) value = value();
    if (value && value.constructor === Array) value = value.slice();
    return value;
  }

  Oops._reverse = function(operation) {
    var reversed = Oops._watch(Operation.undo);
    return reversed;
  };

  Oops.undo = function() {
    if (!Oops.undoStack.length) return;
    var op = Oops.undoStack.pop();
    var reversed = op.undoAndReverse();
    Oops.redoStack.push(reversed);

    // refresh undo/redo state
    Oops._emit('undo');
  };

  Oops.redo = function() {
    if (!Oops.redoStack.length) return;
    var op = Oops.redoStack.pop();
    var reversed = op.undoAndReverse();
    Oops.undoStack.push(reversed);

    // refresh undo/redo state
    Oops._emit('redo');
  };

  Oops.insert = function(op) {
    if (!op) return;

    // save so we can undo it
    Oops.undoStack.push(op);

    // clear redo stack
    Oops.redoStack = [];

    // refresh undo/redo state
    Oops._emit('done');
  };

  Oops.canUndo = function() {
    return Oops.undoStack.length;
  };
  Oops.canRedo = function() {
    return Oops.redoStack.length;
  };

  Oops.reset = function() {
    Oops.undoStack = [];
    Oops.redoStack = [];
    Oops._emit('reset');
  };


  // event emitter
  Oops._handlers = [];
  Oops.onOops = function(cb) {
    Oops._handlers.push(cb);
  };
  Oops._emit = function(name) {
    Oops._handlers.forEach(function(cb) {
      cb(name);
    });
  };


  Oops.CustomOperation = CustomOperation;
  return Oops;

})();
