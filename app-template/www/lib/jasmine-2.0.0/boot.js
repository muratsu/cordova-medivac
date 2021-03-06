/**
 Starting with version 2.0, this file "boots" Jasmine, performing all of the necessary initialization before executing the loaded environment and all of a project's specs. This file should be loaded after `jasmine.js`, but before any project source files or spec files are loaded. Thus this file can also be used to customize Jasmine for a project.

 If a project is using Jasmine via the standalone distribution, this file can be customized directly. If a project is using Jasmine via the [Ruby gem][jasmine-gem], this file can be copied into the support directory via `jasmine copy_boot_js`. Other environments (e.g., Python) will have different mechanisms.

 The location of `boot.js` can be specified and/or overridden in `jasmine.yml`.

 [jasmine-gem]: http://github.com/pivotal/jasmine-gem
 */

(function() {

  /**
   * Globals
   */
  var crashNumber = 0;

  /**
   * ## Require &amp; Instantiate
   *
   * Require Jasmine's core files. Specifically, this requires and attaches all of Jasmine's code to the `jasmine` reference.
   */
  window.jasmine = jasmineRequire.core(jasmineRequire);

  /**
   * Since this is being run in a browser and the results should populate to an HTML page, require the HTML-specific Jasmine code, injecting the same reference.
   */
  jasmineRequire.html(jasmine);

  /**
   * Create the Jasmine environment. This is used to run all specs in a project.
   */
  var env = jasmine.getEnv();

  /**
   * ## The Global Interface
   *
   * Build up the functions that will be exposed as the Jasmine public interface. A project can customize, rename or alias any of these functions as desired, provided the implementation remains unchanged.
   */
  var jasmineInterface = {
    describe: function(description, specDefinitions) {
      return env.describe(description, specDefinitions);
    },

    xdescribe: function(description, specDefinitions) {
      return env.xdescribe(description, specDefinitions);
    },

    it: function(desc, func) {
      return env.it(desc, func);
    },

    xit: function(desc, func) {
      return env.xit(desc, func);
    },

    beforeEach: function(beforeEachFunction) {
      return env.beforeEach(beforeEachFunction);
    },

    afterEach: function(afterEachFunction) {
      return env.afterEach(afterEachFunction);
    },

    expect: function(actual) {
      return env.expect(actual);
    },

    pending: function() {
      return env.pending();
    },

    spyOn: function(obj, methodName) {
      return env.spyOn(obj, methodName);
    },

    jsApiReporter: new jasmine.JsApiReporter({
      timer: new jasmine.Timer(),
      onJasmineDone: function (reporter) { reportResults(reporter); }
    })
  };

  /**
   * Add all of the Jasmine global/public interface to the proper global, so a project can use the public interface directly. For example, calling `describe` in specs instead of `jasmine.getEnv().describe`.
   */
  if (typeof window == 'undefined' && typeof exports == 'object') {
    extend(exports, jasmineInterface);
  } else {
    extend(window, jasmineInterface);
  }

  /**
   * Expose the interface for adding custom equality testers.
   */
  jasmine.addCustomEqualityTester = function(tester) {
    env.addCustomEqualityTester(tester);
  };

  /**
   * Expose the interface for adding custom expectation matchers
   */
  jasmine.addMatchers = function(matchers) {
    return env.addMatchers(matchers);
  };

  /**
   * Expose the mock interface for the JavaScript timeout functions
   */
  jasmine.clock = function() {
    return env.clock;
  };

  /**
   * ## Runner Parameters
   *
   * More browser specific code - wrap the query string in an object and to allow for getting/setting parameters from the runner user interface.
   */

  var queryString = new jasmine.QueryString({
    getWindowLocation: function() { return window.location; }
  });

  var catchingExceptions = queryString.getParam('catch');
  env.catchExceptions(typeof catchingExceptions === 'undefined' ? true : catchingExceptions);

  /**
   * ## Reporters
   * The `HtmlReporter` builds all of the HTML UI for the runner page. This reporter paints the dots, stars, and x's for specs, as well as all spec names and all failures (if any).
   */
  var htmlReporter = new jasmine.HtmlReporter({
    env: env,
    onRaiseExceptionsClick: function() { queryString.setParam('catch', !env.catchingExceptions()); },
    getContainer: function() { return document.body; },
    createElement: function() { return document.createElement.apply(document, arguments); },
    createTextNode: function() { return document.createTextNode.apply(document, arguments); },
    timer: new jasmine.Timer()
  });

  /**
   * The `ConsoleReporter` reports progress via console.log.
   */
  var consoleReporter = new jasmineRequire.ConsoleReporter()({
    showColors: true,
    timer: new jasmine.Timer(),
    print: function() { console.log.apply(console, arguments); }
  });

  /**
   * The `jsApiReporter` also receives spec results, and is used by any environment that needs to extract the results from JavaScript.
   */
  env.addReporter(jasmineInterface.jsApiReporter);
  env.addReporter(htmlReporter);
  env.addReporter(consoleReporter);

  /**
   * Filter which specs will be run by matching the start of the full name against the `spec` query param.
   */
  var specFilter = new jasmine.HtmlSpecFilter({
    filterString: function() { return queryString.getParam('spec'); }
  });

  env.specFilter = function(spec) {
    return specFilter.matches(spec.getFullName());
  };

  /**
   * Setting up timing functions to be able to be overridden. Certain browsers (Safari, IE 8, phantomjs) require this hack.
   */
  window.setTimeout = window.setTimeout;
  window.setInterval = window.setInterval;
  window.clearTimeout = window.clearTimeout;
  window.clearInterval = window.clearInterval;

  /**
   * Result-reporting functions.
   */
  var reportResults = function(reporter) {

    var testResults = {};

    // package test results
    testResults.timestamp     = new Date().getTime();
    testResults.status        = reporter.status();
    testResults.suites        = reporter.suites();
    testResults.specs         = reporter.specs();
    testResults.executionTime = reporter.executionTime();

    reportToCouchDB(testResults, TEST_CONFIG.result_table_name);
  }

  var reportCrash = function(exception) {

    // suffix the result id with the crash number if an id was given
    var idSuffix = '-crash-' + crashNumber;
    crashNumber += 1;

    reportToCouchDB(exception, TEST_CONFIG.crash_table_name, idSuffix);
  }

  /**
   * Reporting function to CouchDB.
   */
  var reportToCouchDB = function(resultObject, tableName, idSuffix) {

    if (!tableName) {
      throw 'Invalid CouchDB table name passed.';
    }

    // create request
    var request       = new XMLHttpRequest();
    var requestMethod = 'POST';
    var requestURI    = TEST_CONFIG.couchdb_uri + '/' + tableName + '/';

    // if an identifier was provided for the results, do a PUT
    // to a named document instead of a POST to an unnamed one
    if (TEST_CONFIG.result_id !== null) {
      requestMethod = 'PUT';
      requestURI   += TEST_CONFIG.result_id;

      if (idSuffix) {
        requestURI += idSuffix;
      }
    }

    // set up the request
    request.open(requestMethod, requestURI, true); // NOTE: last argument is "async"
    request.setRequestHeader('Content-type', 'application/json');
    request.onreadystatechange = function() {
      if (request.readyState == 4) {
        if (request.status >= 200 && request.status < 300) {
          console.log('HTTP SUCCESS');
          console.log('status:       ' + request.status);
          console.log('responseText: ' + request.responseText);
        } else {
          console.error('HTTP ERROR');
          console.error('status:       ' + request.status);
          console.error('statusText:   ' + request.statusText);
          console.error('responseText: ' + request.responseText);
        }
      }
    }

    // send the request
    console.log('sending ' + requestMethod + ' request to ' + requestURI);
    request.send(JSON.stringify(resultObject));
  }

  /**
   * ## Execution
   *
   * Unlike standard Jasmine, do not fire on the browser window's `onload`. Instead, listen to Cordova's deviceready event, and then run all of the loaded specs. This includes initializing the `HtmlReporter` instance and then executing the loaded Jasmine environment. All of this will happen after all of the specs are loaded.
   */
  document.addEventListener('deviceready', function() {

    htmlReporter.initialize();

    // add a special error handler in case an exception does not get caught
    window.addEventListener('error', function(err) {
      try {
        reportCrash(err);
      } catch (err) {
        console.error('FATAL: Crashed while reporting a crash!');
      }

      // WINDOWS ONLY:
      //    don't crash the app on unhandled errors
      return true;
    });

    env.execute();

  }, false);

  /**
   * Helper function for readability above.
   */
  function extend(destination, source) {
    for (var property in source) destination[property] = source[property];
    return destination;
  }

}());
