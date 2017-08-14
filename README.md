`koel` is a javascript library in two parts.

- The first part is a tiny, efficient rewrite of
  [http://knockoutjs.com/](knockout.js).

- The second is a rewrite of [the `el()`
  function](http://blog.fastmail.com/2012/02/20/building-the-new-ajax-mail-ui-part-2-better-than-templates-building-highly-dynamic-web-pages/)
  used in FastMail.

## ko ##

**ko** is a tiny data binding library. It lets you make two things:

  - **Observables**, which wrap a value (such as a string or a number).

    ```js
    var fruitOfTheDay = ko('banana');
    ```

      - To **read** from an observable, call it like you would a function:

        ```js
        fruitOfTheDay(); // => 'banana'
        ```

      - To **write** to an observable, use `.assign()`.

        ```js
        fruitOfTheDay.assign('melon');
        ```

- **Computeds**, which wrap a function.

    ```js
    var lunch = ko(function() {
      return soupOfTheDay() + ' followed by ' + fruitOfTheDay();
    });
    ```

    ko does **dependency detection**: while the function is executing, it
    remembers every observable which the computed reads from. It sets up a
    subscription to each dependency, and will re-compute the function when any
    of them change.

    The return value of the function is used as the new value. Any subscribers
    to the computed will be notified of the change.

    The function should not return an Observable.

    Computeds are a kind of observable: you read from them in the same way. You
    may read from one computed inside another.

    You can't assign to a computed.

That's about it; observables and computeds make up the core of ko.


### Additional Methods ###

Observables also support the following:

  - <code>**.subscribe(**function() { … } _[_, callNow_]_**)**</code>

    Explicitly subscribe to the observable.

    ```js
    fruitOfTheDay.subscribe(function(fruit) {
      document.title = fruit;
    });
    ```

    Every time the observable's value changes, the callback will be invoked
    with the new value. This is useful when you want to run a function every
    time a value changes, but unlike a computed, the function doesn't produce a
    result.

    The return value of the function is ignored.

    subscribe() takes an optional second argument **callNow**, which
    defaults to true.  If it's true, it will run the callback immediately.

  - <code>**.compute(**function(value) { … }**)**</code>

    Convenience method. The following are identical:

    ```js
    observable.compute(f)
    ```

    ```js
    computed(function() {
      var value = observable();
      return f(value);
    });
    ```

  - <code>**.destroy()**</code>

    Remove all subscribers from the observable.

    If it's a computed, this will also remove the related subscriptions from
    each of our dependencies.

### Extensions ###

You can extend koel with new types of observable, if you need to send more
specific updates than assignment. This is the mechanism used [by
observableArray](#arrays).

  - <code>**.subscribe**({ name: function() { … }, … }**)**</code>

    Handle an event with the given name. It takes a dict, so you can pass
    multiple event handlers.

    emit() pops its name argument and calls each handler with the remaining
    arguments. Handlers are called in the order they were defined.

  - <code>**.emit**(name _[_, arguments… _]_**)**</code>

    Emit an event describing a change to this observable.

All events change the observable's value, so using `.subscribe()` will get you
all kinds of changes. If you want to handle only direct assignment events --
that is, calls to .assign() -- listen for the `'assign'` event.

### The ko object ###

There are also the following methods on `ko` itself:

  - **`ko.observable()`** -- in case you really want an observable function.

  - **`ko.computed()`** -- will fail if its argument *isn't* a function.

  - <code>**ko.subscribe(**v, function(value) { … }**)**</code> -- subscribe to
    v if its an observable, otherwise just pass it straight to the callback.

    More efficient than the equivalent
    `ko.observable(v).subscribe(function(value) { … })`, since it doesn't
    create an observable if it doesn't need to.

  - **`ko.isObservable(v)`** -- is v an observable?

  - **`ko.plugin()`** -- a simple way of extending the `ko()` function.


## el ##

**el** is a helper function for creating DOM elements.

For background, read the [blog post about Sugared DOM](http://blog.fastmail.com/2012/02/20/building-the-new-ajax-mail-ui-part-2-better-than-templates-building-highly-dynamic-web-pages/), which this function is based on.

el takes three arguments: `selector`, `attrs`, and `children`. Either or both
of the last two arguments may be omitted.

  - **`selector`** looks like a CSS selector. It consists of a tag name,
    followed by `#the-id` and then many `.class-names`. Any of them may
    be omitted; the default tag is `div`.

    Examples:

    ```js
    el('span');       // => <span />
    el('.hat-shop');  // => <div class="hat-shop" />
    el('');           // => <div />

    el('div#main.blue.very-big');
    // => <div id="main" class="blue very-big" />
    ```

  - **`attrs`** is a dictionary of attributes. These will be set as attributes
    on the resulting DOM element.

    Example:

    ```js
    el('a', {
      href: 'http://google.com',
      target: '_blank',
    }, "follow this link");
    ```

    The following property aliases are supported: `class` `className`
    `defaultValue` `for` `html` `text` `value`

    All escaping is handled by the browser.

    If a value is an observable, el will automatically **subscribe** to it,
    updating the attribute whenever the observable changes.

    If you give an observable to the **value** property, el will set up
    appropriate `change` event listeners. This is handy for elements like
    `input` and `select`. (This doesn't work for computeds, since they can't be
    assigned.)

    To bind **event handlers**, use special <code>on_*«event»*</code>
    attributes:

    ```js
    el('button', {
      on_click: function(event) {
        // do stuff
      },
    }, "click me");
    ```

  - **`children`** is a string or an array.

    If it's a string, it will be used instead of the `textContent` property.
    (You may not set the text both ways on the same element.)

    Otherwise, each element of the array is either a string or a DOM element.
    Strings will be converted into text nodes.

    children may be an observable.

    Examples:

    ```js
    el('h1', "Hi there!");  // => <h1>Hi there!</h1>

    var score = ko(6);
    el('p', ['You have ', el('span', score), ' new messages!']);
    // => <p>You have <span>6</span> new messages!</p>
    ```

    Final example, using [observable arrays](#arrays):

    ```js
    var cheeses = ko(['cheddar', 'stilton', 'brie']);
    el('ul', cheeses);

    cheeses.push('camembert');
    ```


## Arrays ##

koel has a bonus third part: **observable arrays**.

Plain observable arrays wouldn't be that useful, since you wouldn't be able to
tell what changed.

```js
var animals = ko([
  'cow',
  'sheep',
  'horse',
]);
function addPillow() {
  animals.assign(animals.concat(['pillow']));
}
animals.subscribe(function(newArray) {
  /*
   * we have the new array -- but what changed?!
   */
});
addPillow();
```

ko includes an array plugin which uses observable's event-emitter system to
give more useful updates. el uses it in order to do efficient DOM updates.

Observable arrays have the following wrapper interface:

  - <code>**insert(**index, item**)**</code> -- insert before item at index
  - <code>**replace(**index, item**)**</code> -- similar to `animals()[index] =
    item`
  - <code>**remove(**index**)**</code> -- remove item at index
  - <code>**push(**item**)**</code> -- add item to end of array
  - <code>**pop()**</code> → remove last item
  - <code>**shift()**</code> → remove first item

You can get more interesting updates by listening for the following events:

```js
animals.subscribe({
  assign: function(newArray) { … },
  replace: function(index, item) { … },
  insert: function(index, item) { … },
  remove: function(index) { … },
});
```

Using `animals.subscribe(function() { … })` would give you updates anytime the
array changes for any reason. The **assign** handler will only fire when the
entire array is replaced by calling .assign().

### Derived arrays

There's also a bonus third `ko` concept, in addition to observables and
computeds: **deriveds**.

It's useful to be able to call `map` or `filter` on an array, but recomputing it over the whole array wouldn't be terribly efficient:

```js
el('ul.favourite-animals', ko(function() {
  return animals().map(function(name) {
    return el('li', name);
  });
});
```

So the wrapped interface also includes the following methods, which return a
derived array.

  - <code>**map(**function() { … }**)**</code>
  - <code>**filter(**function() { … }**)**</code>

You can't modify a derived.

Example:

```js
el('ul.favourite-animals', animals.map(function(name) {
  return el('li', name);
});
```

Any replace/insert/remove changes are propogated to the derived, being careful
to only recompute items if their dependencies have changed. So you get
the minimal possible change to the derived array. Since el supports this too,
koel gives you efficient DOM updates for lists.

-------------------------------------------------------------------------------

Q&A
===

Here are some questions. No-one's asked them yet, because koel's just a quick
library I needed for a project. But the answers may be helpful.

What if an array element changes?
---------------------------------

This is considered an array update:

```js
array.replace(1, 'four');
```

This is not:

```js
array()[1].fooBar = 'six';
```

An array tracks the objects _in_ it, not their _state_. It's just a list of pointers, if you like.

If you want to track element properties, make them into observables.

Can I have an array of observables?
-----------------------------------

Don't do that; you'll get confused.

You could do this instead:

```js
array = ko(["cow", "sheep", "horse"]);
array.update(1, "elephant");

// -elsewhere in your code-

array.on('replace', function(index, item) {
  // . . .
});
```

Or you could have an array of objects, where some of the object's properties
might be observable.

But ES7 has Object.observe built-in!
------------------------------------

[Object.observe](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/observe)
does sound cool. But right now, [only Chrome supports
it](http://caniuse.com/#search=observe).

And I prefer observables, since they're an object in their own right
("first-class"). Object.observe only lets you subscribe to property
updates on an object.

Does it support IE8?
--------------------

Probably not.

Should I use this?
------------------

Nope. Use a proper framework instead, such as [Overture](http://overturejs.com/).

"I have a failing case!"
------------------------

```js
var A = ko(5);

var filter = ko(function(){
    var divisor = A();
    return function(element){
        return element % divisor === 0;
    };
});

var list = ko(function(){ return [A()]; });

var filteredList = ko(function(){ var l = list().filter(filter()); console.log(l); return l;});

A.assign(7)
```

Shut up, Dan.


License
=======

MIT. (It's small enough that you could always rewrite it yourself anyway.)


