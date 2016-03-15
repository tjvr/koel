var Router = function(routes, key) {

  var key = "pathname" || key; // "hash"

  RegExp.escape = function(s) {
      return s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  };
    
  function encodeParam(param) {
    return ("" + param).replace(/ /g, '+').replace(/\//g, '%2F');
  };

  function decodeParam(param) {
    return param.replace(/\+/g, ' ').replace(/%2F/g, '/');
  };


  // minimal Flask-like client-side router with History API support

  var Router = {
    pathname: ko(location[key]),
    page: ko("home"),
  };

  // for building encoders & decoders

  var routePat = /([<][_$a-zA-Z\xA0-\uFFFF][_$a-zA-Z0-9\xA0-\uFFFF]*(?:[:][a-z]+)?[>])/g;
  var argPat = /[<](.*)[:](.*)[>]/;

  function buildDecoder(name, spec, cb) {
    var parts = spec.split(routePat);
    var pat = [];
    var names = [];
    var types = [];
    for (var i = 0; i < parts.length; i += 2) {
      pat.push(RegExp.escape(parts[i]));
      var arg = parts[i + 1];
      if (arg === undefined) continue;
      var m = argPat.exec(arg);
      names.push(m[1]);
      types.push(m[2]);
      switch (m[2]) {
        case 'int': pat.push('([0-9]+)'); break;
        case 'str': pat.push('([^/]+)'); break;
        default:
          throw new Error("Unknown route spec type: " + m[2]);
      }
    }
    // trim trailing slash
    pat = pat.join("");
    pat = pat.replace(/\/$/, "");
    // return decoder
    return {
      name: name,
      argNames: names,
      argTypes: types,
      regexp: new RegExp("^" + pat + "\/?$"),
      func: cb,
    };
  }
  function buildEncoder(spec) {
    var parts = spec.split(routePat);
    return parts;
  }

  // compile the routes
  var decoders = [];
  var encoders = {};
  for (var spec in routes) {
    var cb = routes[spec];
    var name = cb.name;
    if (!name) {
      throw new Error("Route callback for " + JSON.stringify(spec) + " needs a name");
    }
    decoders.push(buildDecoder(name, spec, cb));
    if (encoders.hasOwnProperty(name)) {
      throw new Error("Duplicate route callback name " + JSON.stringify(name));
    }
    encoders[name] = buildEncoder(spec);
  }

  // for running decoders/encoders
  Router._decode = function(pathname) {
    for (var i = 0; i < decoders.length; i++) {
      var d = decoders[i];
      var m = d.regexp.exec(pathname);
      if (m) {
        var values = [];
        for (var i = 1; i < m.length; i++) {
          var value = m[i];
          switch (d.argTypes[i - 1]) {
            case 'int': value = parseInt(value); break;
            case 'str': value = decodeParam(value); break;
          }
          values.push(value);
        }

        return {
          name: d.name,
          args: values,
          func: d.func,
        };
      }
    }
    return null;
  };
  Router._encode = function(name, args) {
    var parts = encoders[name];
    if (!parts) {
      throw new Error("Unknown route: " + name);
    }
    var p = [];
    for (var i = 0; i < parts.length; i += 2) {
      p.push(parts[i]);
      var arg = parts[i + 1];
      if (arg === undefined) continue;
      var value = args.shift();
      if (value === undefined) {
        throw new Error("Not enough args for route: " + name);
      }
      var m = argPat.exec(arg);
      switch (m[2]) {
        case 'int': p.push("" + (+value)); break;
        case 'str': p.push(encodeParam(value)); break;
        default:
          throw new Error("Unknown route spec type: " + m[2]);
      }
    }
    return p.join("");
  };

  // poll pathname in case no History API
  function readPathname() {
    var pathname = location[key];
    if (key === 'hash') {
      pathname = pathname.replace(/^#!/, "");
    }
    Router.pathname.assign(pathname);
  }
  readPathname();
  setInterval(readPathname, 200);

  // respond to History events
  function stateChanged(event) {
    readPathname();
  }
  window.addEventListener("popstate", readPathname);
  window.addEventListener("pushstate", readPathname);

  // for following links
  Router.navigate = function(name/*, args */) {
    var args = [].slice.apply(arguments).slice(1);
    var pathname = Router._encode(name, args);
    var relative = pathname;
    if (key === 'hash') {
      relative = relative.replace(/^/, "#!");
    }
    if (history && history.pushState) {
      history.pushState({}, "", relative);
    } else {
      location[key] = relative;
    }
    Router.pathname.assign(pathname);
  };

  Router.page = Router.pathname.compute(function(pathname) {
    return Router._decode(pathname);
  });

  return Router;

};
