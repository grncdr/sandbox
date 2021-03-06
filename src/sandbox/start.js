let { existsSync: exists } = require('fs')
let { join } = require('path')
let chalk = require('chalk')
let hydrate = require('@architect/hydrate')
let series = require('run-series')
let create = require('@architect/create')
let { banner, chars } = require('@architect/utils')
let { env, maybeHydrate, readArc } = require('../helpers')
let startupScripts = require('./_startup-scripts')

module.exports = function _start (params, callback) {
  let start = Date.now()
  let {
    // Settings
    options,
    quiet = false,
    // Everything else
    update,
    events,
    http,
    tables,
  } = params

  // Set `all` to instruct service modules not to hydrate again, etc.
  params.all = true

  // Set up verbositude
  let verbose = false
  let findVerbose = option => [ '-v', '--verbose', 'verbose' ].includes(option)
  if (options && options.some(findVerbose)) {
    verbose = true
  }

  let { arc, filepath } = readArc()
  let deprecated = process.env.DEPRECATED

  series([
    // Set up Arc + userland env vars
    function _env (callback) {
      env(params, callback)
    },

    // Print the banner (which also loads AWS env vars / creds necessary for Dynamo)
    function _printBanner (callback) {
      banner(params)
      callback()
    },

    // Read the current Architect project (or use a default project)
    function _checkArc (callback) {
      if (!filepath) {
        update.warn('No Architect project manifest found, using default project')
      }
      else {
        update.done('Found Architect project manifest, starting up')
      }
      callback()
    },

    // Initialize any missing functions on startup
    function _init (callback) {
      if (!deprecated) {
        create({}, callback)
      }
      else callback()
    },

    // Loop through functions and see if any need dependency hydration
    function _maybeHydrate (callback) {
      maybeHydrate(callback)
    },

    // ... then hydrate Architect project files into functions
    function _hydrateShared (callback) {
      hydrate({ install: false }, function next (err) {
        if (err) callback(err)
        else {
          update.done('Project files hydrated into functions')
          callback()
        }
      })
    },

    // Start DynamoDB (@tables)
    function _tables (callback) {
      tables.start(params, callback)
    },

    // Start event bus (@events) listening for `arc.event.publish` events
    function _events (callback) {
      events.start(params, callback)
    },

    // Start HTTP + WebSocket (@http, @ws) server
    function _http (callback) {
      http.start(params, callback)
    },

    // Print startup time
    function _ready (callback) {
      let finish = Date.now()
      if (!quiet) {
        update.done(`Started in ${finish - start}ms`)
        let isWin = process.platform.startsWith('win')
        let ready = isWin
          ? chars.done
          : chalk.green.dim('✈︎')
        let readyMsg = chalk.white('Local environment ready!')
        console.log(`${ready} ${readyMsg}\n`)
      }
      callback()
    },

    // Run startup scripts (if present)
    function _runStartupScripts (callback) {
      let params = { arc, update }
      startupScripts(params, callback)
    },

    // Check aws-sdk installation status if installed globally
    function _checkAWS_SDK (callback) {
      let cwd = process.cwd()
      let dir = __dirname
      if (!dir.startsWith(cwd)) {
        let awsDir = join(dir.split('@architect')[0], 'aws-sdk', 'package.json')
        if (!exists(awsDir)) {
          update.warn(`Possibly found a global install of Architect without a global install of AWS-SDK, please run: npm i -g aws-sdk`)
        }
      }
      callback()
    }
  ],
  function _done (err) {
    if (err) callback(err)
    else {
      if (verbose && process.env.ARC_AWS_CREDS === 'dummy') {
        update.warn('Missing or invalid AWS credentials or credentials file, using dummy credentials (this is probably ok)')
      }
      callback(null, 'Sandbox successfully started')
    }
  })
}
