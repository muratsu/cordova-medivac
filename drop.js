#!/usr/bin/env node

'use strict';

var fs   = require('fs');
var os   = require('os');
var path = require('path');

// dependencies
var shell   = require('shelljs');
var program = require('commander');

// constants
var INDENT            = '    ';
var ENCODING          = 'utf-8';
var MEDIVAC_DIR_NAME  = 'cordova-medivac';
var TEMPLATE_DIR_NAME = 'app-template';
var CLI_NAME          = 'cordova';
var PLACEHOLDER       = '<!-- {{ SPECS }} -->';
var CONFIG_VAR_NAME   = 'TEST_CONFIG';
var RESULT_TABLE_NAME = 'dblotsky_results';
var CRASH_TABLE_NAME  = 'dblotsky_crashes';

var DEFAULT_PLUGINS   = [
    'org.apache.cordova.device',
    'org.apache.cordova.console',
];

var CORE_PLUGINS = [
    'org.apache.cordova.battery-status',
    'org.apache.cordova.camera',
    'org.apache.cordova.console',
    'org.apache.cordova.contacts',
    'org.apache.cordova.device',
    'org.apache.cordova.device-motion',
    'org.apache.cordova.device-orientation',
    'org.apache.cordova.dialogs',
    'org.apache.cordova.file',
    'org.apache.cordova.file-transfer',
    'org.apache.cordova.geolocation',
    'org.apache.cordova.globalization',
    'org.apache.cordova.inappbrowser',
    'org.apache.cordova.media',
    'org.apache.cordova.media-capture',
    'org.apache.cordova.network-information',
    'org.apache.cordova.splashscreen',
    'org.apache.cordova.statusbar',
    'org.apache.cordova.vibration',
];

// globals
var cli = CLI_NAME;

// parse args
program

    // platforms
    // TODO:
    //      accept a variable that just takes a list
    .option('-z, --amazon',       'Add Amazon FireOS platform.')
    .option('-n, --android',      'Add Android platform.')
    .option('-q, --blackberry10', 'Add BlackBerry 10 platform.')
    .option('-i, --ios',          'Add iOS platform.')
    .option('-b, --browser',      'Add browser platform.')
    .option('-w, --windows',      'Add Windows (universal) platform.')
    .option('-m, --windows8',     'Add Windows 8 (desktop) platform.')
    .option('-k, --wp8',          'Add Windows Phone 8 platform.')

    // arguments
    .option('-c, --couchdb-host [host]', 'Hostname of the CouchDB server to record results (localhost by default).', 'localhost')
    .option('-p, --couchdb-port [port]', 'The port to the CouchDB host (5984 by default).', '5984')
    .option('-n, --name [name]',         'The name for the test app (marine by default)', 'marine')
    .option('-r, --result-id [string]',  'The string to identify the results (used for CouchDB; null by default)', null)

    // flags
    .option('-v, --verbose', 'Be verbose.')
    .option('-a, --core',    'Include all org.apache.cordova plugins.\n' +
                             '\t\t\t\t\tCannot be used while passing arguments on the command line.')
    .option('-u, --plugman', 'Use {platform}/bin/create and plugman directly instead of the CLI.')
    .option('-g, --global',  'Use the globally-installed `cordova` and the downloaded platforms/plugins from the registry instead of the local git repo.\n' +
                             '\t\t\t\t\tWill use the local git repo of medivac.\n' +
                             '\t\t\t\t\tGenerally used only to test RC or production releases.\n' +
                             '\t\t\t\t\tCannot be used with --plugman.')
    .parse(process.argv);

// helpers
function noisyRM(dir_name) {
    try {
        shell.rm('-rf', dir_name);
    } catch (e) {
        throw new Error('Failed to remove old app; Please remove ' + dir_name + ' manually.');
    }
}

function cordovaRun(command) {
    noisyRun([cli].concat(command));
}

function silentPopd() {
    var silentState = shell.config.silent;
    shell.config.silent = true;
    shell.popd();
    shell.config.silent = silentState;
}

function noisyRun(command) {

    var command_string = command.join(' ');

    if (program.verbose) {
        console.log(INDENT + 'RUNNING: ' + command_string);
    }

    shell.exec(command.join(' '));
}

function exists(path) {
    return shell.test('-e', path);
}

function progress(message) {
    console.log('\x1b[32m' + message + '\x1b[m');
}

function transformTest(code) {

    var transformed_code = '';

    // if the code is of the old-style tests, transform it
    if (code.match(/exports\.defineAutoTests/)) {

        // this transformation performs the following steps (necessarily in the order given):
        //     1. removes everything after the 'defineManualTests' declaration
        //     2. removes the 'defineAutoTests' line
        //     3. removes the last brace in the file and everything after it
        transformed_code = code
            .replace(/exports\.defineManualTests(.|[\r\n])*/gi, '')
            .replace(/exports\.defineAutoTests.*/, '')
            .replace(/\}[^}]*$/, '');

    } else {
        transformed_code = code;
    }

    return transformed_code;
}

// steps
function installPlugins(plugins, searchpath, argv) {

    progress('Installing platforms');

    // add plugins
    var command = ['plugin', 'add'].concat(plugins.join(' '));

    if (argv.global !== true) {
        command = command.concat(['--searchpath', searchpath]);
    }

    cordovaRun(command);
}

function installPlatforms(platforms, base_dir, argv) {

    progress('Installing plugins');

    platforms.forEach(function (platform) {

        // use local platform paths if --global was not specified
        if (!argv.global) {
            platform = path.join(base_dir, 'cordova-' + platform);
        }

        cordovaRun(['platform', 'add', platform]);
    });
}

function installTests(plugins, app_dir, argv) {

    progress('Installing tests');

    // get paths
    var app_plugins_dir = path.join(app_dir, 'plugins');
    var app_spec_dir    = path.join(app_dir, 'www', 'js', 'spec');
    var app_index       = path.join(app_dir, 'www', 'index.html');

    if (argv.verbose) {
        console.log('app_dir:         ' + app_dir);
        console.log('app_plugins_dir: ' + app_plugins_dir);
        console.log('app_spec_dir:    ' + app_spec_dir);
    }

    // copy the tests.js for each tested plugin into the app
    plugins.forEach(function (plugin) {

        var plugin_dir = path.join(app_plugins_dir, plugin);

        // only consider directories
        if (shell.test('-d', plugin_dir)) {

            var src_file  = path.join(plugin_dir, 'tests', 'tests.js');
            var dest_file = path.join(app_spec_dir, plugin + '-tests.js')

            if (!exists(app_spec_dir)) {
                shell.mkdir('-p', app_spec_dir);
            }

            // if the file exists, copy test file to spec dir
            if (exists(src_file)) {

                console.log('Installing tests for "' + plugin + '"');

                if (argv.verbose) {
                    console.log(src_file + ' -> ' + dest_file);
                }

                // read in the original test code and transform it if necessary
                var test_code             = fs.readFileSync(src_file, ENCODING);
                var transformed_test_code = transformTest(test_code);

                // write the transformed test code to the destination file
                fs.writeFileSync(dest_file, transformed_test_code, ENCODING);

            } else {
                console.log('No tests found for "' + plugin + '"');
            }
        }
    });

    progress('Modifying app\'s index.html');

    // make script tags from all the files in the app's spec dir
    var script_tags = shell.ls(app_spec_dir).map(function (spec) {
        return '<script type="text/javascript" src="js/spec/' + spec + '"></script>';
    });

    if (argv.verbose) {
        script_tags.forEach(function (script_tag) {
            console.log(script_tag);
        });
    }

    // replace the placeholder with script tags in the app's index.html
    shell
        .cat(app_index)
        .replace(PLACEHOLDER, script_tags.join('\n'))
        .to(app_index);
}

function adjustConfig(app_dir, argv) {

    progress('Modifying app\'s config.xml');

    // get CouchDB data
    var couchdb_host = argv.couchdbHost;
    var couchdb_port = argv.couchdbPort;
    var couchdb_uri  = 'http://' + couchdb_host + ':' + couchdb_port;

    // find config files
    var config_xml = path.join(app_dir, 'config.xml');
    var config_js  = path.join(app_dir, 'www', 'js', 'test-config.js');

    // read them in
    var xml_content = fs.readFileSync(config_xml, ENCODING);
    var js_content  = fs.readFileSync(config_js, ENCODING);

    // add whitelist rule allow access to couch server
    var whitelist_rule = couchdb_uri + '*';

    console.log('Adding whitelist rule: ' + whitelist_rule);
    xml_content = xml_content.split('</widget>').join('') + '    <access origin="' + whitelist_rule + '" />\n</widget>';

    // write the changed XML file
    fs.writeFileSync(config_xml, xml_content, ENCODING);

    progress('Modifying app\'s test-config.js');

    // make an object of the relevant arguments
    var app_config = {
        'result_id':         argv.resultId,
        'couchdb_uri':       couchdb_uri,
        'result_table_name': RESULT_TABLE_NAME,
        'crash_table_name':  CRASH_TABLE_NAME,
    };

    // set the object as a constant
    // TODO:
    //      maybe instead mimic the previous medic.json file and HTTP GET it at run time?
    js_content += 'var ' + CONFIG_VAR_NAME + ' = ' + JSON.stringify(app_config) + ';';

    console.log('passing this config to the app:');
    console.log(INDENT + JSON.stringify(app_config));

    // write the changed JS file
    fs.writeFileSync(config_js, js_content, ENCODING);
}

function main() {

    // verify args
    if (program === true && program.args.length > 0) {
        console.log('Cannot specify plugins and --core at the same time.');
        shell.exit(1);
    }

    var platforms = [];
    var plugins   = [];

    // configure shell
    shell.config.fatal  = true;
    shell.config.silent = false;
    shell.config.async  = false;

    // get relevant paths
    var base_dir     = process.cwd();
    var template_dir = path.join(base_dir, MEDIVAC_DIR_NAME, TEMPLATE_DIR_NAME);
    var app_dir      = path.join(base_dir, program.name);
    var local_cli    = path.join(base_dir, 'cordova-cli', 'bin', CLI_NAME);

    // use local cli if --global was not specified
    if (!program.global) {
        cli = local_cli;
    }

    if (program.verbose) {
        console.log('global:       ' + program.global);
        console.log('template_dir: ' + template_dir);
        console.log('app_dir:      ' + app_dir);
        console.log('local_cli:    ' + local_cli);
        console.log('cli:          ' + cli);
    }

    // we should only be run from above the medivac dir
    if (!exists(MEDIVAC_DIR_NAME)) {
        console.log('Please run this script from ' + path.dirname(path.dirname(__dirname)));
        shell.exit(1);
    }

    // get platforms
    if (program.amazon)       { platforms.push('amazon-fireos'); }
    if (program.android)      { platforms.push('android'); }
    if (program.browser)      { platforms.push('browser'); }
    if (program.ios)          { platforms.push('ios'); }
    if (program.blackberry10) { platforms.push('blackberry10'); }
    if (program.wp8)          { platforms.push('wp8'); }
    if (program.windows8)     { platforms.push('windows8'); }
    if (program.windows)      { platforms.push('windows'); }

    // bail if there are no platforms specified
    if (platforms.length <= 0) {
        console.log('No platforms specfied.');
        process.exit(1);
    }

    // get plugins
    if (program.core === true) {
        plugins = CORE_PLUGINS;
    } else {
        plugins = program.args;
    }

    // bail if there are no plugins specified
    if (plugins.length <= 0) {
        console.log('No plugins specfied.');
        process.exit(1);
    }

    // if the app already exists, delete it
    if (exists(app_dir)) {
        noisyRM(app_dir);
    }

    // create a new app
    var command = ['create', app_dir, 'org.apache.cordova.' + program.name, program.name, '--copy-from=' + template_dir]
    cordovaRun(command);

    // do work inside the app directory
    shell.pushd(app_dir);

        installPlatforms(platforms, base_dir, program);

        installPlugins(DEFAULT_PLUGINS, base_dir, program);
        installPlugins(plugins, base_dir, program);

        installTests(plugins, app_dir, program);

        adjustConfig(app_dir, program);

    silentPopd();

    progress('Done');

    console.log('To run the tests, run: cd ' + program.name + ' && cordova run');
}

main();
