var el = (function() {

  var directProperties = {
    defaultValue: 'defaultValue',
    'for': 'htmlFor',
    html: 'innerHTML',
    text: 'textContent',
    unselectable: 'unselectable',
    value: 'value'
  };

  var booleanProperties = {
    autofocus: 1,
    checked: 1,
    defaultChecked: 1,
    disabled: 1,
    hidden: 1,
    multiple: 1,
    readOnly: 1,
    required: 1,
    selected: 1
  };

  var bindingProperties = {
    value: 1,
    selected: 1,
    checked: 1,
  };

  function bindClass(el, value, extraClasses) {
    ko.subscribe(value, function(value) {
      if (typeof value === "string") value = value.split(/ +/g);
      el.removeAttribute('class'); // TODO properly set class list
      extraClasses.concat(value || []).forEach(function(v) {
        if (!v) return;
        el.classList.add(v);
      });
    });
  }

  function setProperty(el, key, value) {
    var prop = directProperties[key];
    if (prop) {
      el[prop] = (value == null ? '' : '' + value);
    } else if (booleanProperties[key]) {
      el[key] = !!value;
    } else if (value == null) {
      el.removeAttribute(key);
    } else {
      el.setAttribute(key, '' + value);
    }
  }

  function getProperty(el, key) {
    var prop = directProperties[key];
    if (prop) {
      return el[prop];
    } else if (booleanProperties[key]) {
      return !!el[key];
    } else {
      return el.getAttribute(key);
    }
  }

  function bindProperty(el, key, value) {
    if (value === undefined) throw "undefined value";
    if (/^on_/.test(key)) {
      key = key.slice('on_'.length);
      el.addEventListener(key, value);
      return;
    }

    if (/^bind_/.test(key)) {
      key = key.slice('bind_'.length);
      if (!ko.isObservable(value)) {
        throw "Can only bind observable";
      } else if (!value.assign) {
        throw "This observable can't be assigned";
      } else if (!bindingProperties[key]) {
        throw "Can't bind property: " + key;
      } else {
        function update() {
          value._value = getProperty(el, key);
          value.emit('changed');
        }
        el.addEventListener('input', update);
        el.addEventListener('change', update);
      }
    }

    ko.subscribe(value, {
      assign: function(value) {
        setProperty(el, key, value);
      },
    });
  };

  var el;
  return el = function(selectors, value) {
    if (arguments.length > 2) throw "too many arguments";
    if (selectors === undefined) throw "undefined selectors";

    var content, attrs;
    if (ko.isObservable(value) ||
        value instanceof Array ||
        typeof value === 'string' || (value && value.appendChild)
    ) {
      content = value;
      attrs = {};
    } else {
      attrs = value || {};
      content = null;
      if (attrs.children) {
        content = attrs.children || [];
        delete attrs.children;
      }
    }

    var extraClasses = [];

    var topParent;
    var result;
    selectors.split(/ +/g).forEach(function(selector) {
      var parts = selector.split(/([#.])/g);
      var tagName = parts[0] || 'div';
      var el = document.createElement(tagName);

      for (i=1, j=2; j < parts.length; i+=2, j+=2) {
        var value = parts[j];
        if (parts[i] == '#') {
          if (attrs.id) throw "Can't specify id twice";
          el.id = value;
        } else if (parts[i] == '.') {
          extraClasses.push(value);
        }
      }

      if (!topParent) topParent = el;
      if (result) result.appendChild(el);
      result = el;
    });

    var classList = attrs.class;
    delete attrs.class;
    if (attrs.className) {
      if (classList) throw "Can't set class twice";
      classList = attrs.className;
      delete attrs.className;
    }
    if (attrs.classList) {
      throw "Use .class instead";
    }
    bindClass(result, classList, extraClasses);

    for (key in attrs) {
      bindProperty(result, key, attrs[key]);
    }

    if (!content) {
      return topParent;
    }

    if (!ko.isObservable(content)) {
      if (content === undefined) throw "undefined children";
      content = content || [];
      refresh(content);
      return topParent;
    }

    function makeChild(c) {
      if (c === undefined) throw "undefined child";
      return c && c.appendChild ? c : document.createTextNode(c);
    }

    function refresh(children) {
      if (!(children instanceof Array)) { // String or Element
        children = [children];
      }
      // Array
      while (result.firstChild) {
        result.removeChild(result.lastChild);
      }
      for (var i=0; i<children.length; i++) {
        var child = children[i];
        result.appendChild(makeChild(child));
      }
    }

    content.subscribe({
      assign: refresh,
      insert: function(index, newChild) {
        result.insertBefore(makeChild(newChild), result.children[index]);
      },
      remove: function(index) {
        result.removeChild(result.children[index]);
      },
      replace: function(index, newChild) {
        var oldChild = result.children[index];
        result.insertBefore(makeChild(newChild), oldChild);
        result.removeChild(oldChild);
        // result.replaceChild(makeChild(newChild), result.children[index]);
      },
    });

    return topParent;
  };

}());
