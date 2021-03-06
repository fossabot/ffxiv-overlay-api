/*! ffxiv-overlay-plugin | DSRKafuU <amzrk2.cc> | Copyright (c) MIT License */

import { logInfo, logError } from './components/logger';
import defaultOptions from './components/options';
import extendData from './components/extend';

/**
 * OverlayAPI class
 * @class
 */
export default class OverlayAPI {
  // Settings
  #options = {};
  // Event subscribers
  // { event:string : cb:function[] }
  #subscribers = {};
  // Plugin init status
  #status = false;
  // Waiting queue before api init
  // { msg:object, cb:function }[] (normal) | msg[] (ws)
  #queue = [];
  // WebSocket
  #wsURL = /[?&]OVERLAY_WS=([^&]+)/.exec(window.location.href);
  #ws = null;
  #resCounter = 0;
  #resPromises = {};

  // Fake data interval
  #simulator = null;

  /**
   * Init API
   * @constructor
   * @param {Object} options Options
   */
  constructor(options = {}) {
    // Init options
    this.#options = Object.assign({}, defaultOptions, options);

    // Check mode
    if (this.#wsURL && this.#wsURL.length > 0) {
      // If in websocket mode
      !this.#options.silentMode && logInfo('Initializing API in WebSocket Mode...');
      this.#initWebSocketMode();
    } else {
      // Normal mode
      !this.#options.silentMode && logInfo('Initializing API in Callback Mode...');
      this.#initCallbackMode();
    }
    window.dispatchOverlayEvent = this.#triggerEvents.bind(this);
  }

  /**
   * Send message to OverlayPluginApi or push into queue before its init
   * @public
   * @param {Object} msg Object to send
   * @param {Function} cb Callback function
   */
  #sendMessage(msg, cb) {
    if (this.#ws) {
      // WS mode
      if (this.#status) {
        try {
          this.#ws.send(JSON.stringify(msg));
        } catch (e) {
          logError(e, msg);
          return;
        }
      } else {
        this.#queue.push(msg);
      }
    } else {
      // CB mode
      if (this.#status) {
        try {
          window.OverlayPluginApi.callHandler(JSON.stringify(msg), cb);
        } catch (e) {
          logError(e, msg);
          return;
        }
      } else {
        this.#queue.push({ msg, cb });
      }
    }
  }

  /**
   * Trigger event function, called by OverlayPluginApi, need `this` binding
   * @private
   * @param {Object} msg Data from OverlayPluginApi
   */
  #triggerEvents(msg) {
    // If this event type has subscribers
    if (this.#subscribers[msg.type]) {
      // Trigger all this event's callback
      for (let cb of this.#subscribers[msg.type]) {
        if (this.#options.extendData) {
          cb(extendData(msg));
        } else {
          cb(msg);
        }
      }
    }
  }

  /**
   * Init WebSocket connection
   * @private
   */
  #initWebSocketMode() {
    this.#ws = new WebSocket(this.#wsURL[1]);
    // Log error
    this.#ws.addEventListener('error', (e) => {
      logError(e);
    });
    // Successfully connected WebSocket
    this.#ws.addEventListener('open', () => {
      !this.#options.silentMode && logInfo('WebSocket connected');
      this.#status = true;
      // Send all messages in queue to OverlayPlugin
      while (this.#queue.length > 0) {
        let msg = this.#queue.shift();
        this.#sendMessage(msg);
      }
      !this.#options.silentMode && logInfo('API ready');
    });
    // On message loaded from WebSocket
    this.#ws.addEventListener('message', (msg) => {
      try {
        msg = JSON.parse(msg.data);
      } catch (e) {
        logError(e, msg);
        return;
      }
      if (msg.rseq !== undefined && this.#resPromises[msg.rseq]) {
        this.#resPromises[msg.rseq](msg);
        delete this.#resPromises[msg.rseq];
      } else {
        this.#triggerEvents(msg);
      }
    });
    // Connection failed
    this.#ws.addEventListener('close', () => {
      this.#status = false;
      !this.#options.silentMode && logInfo('WebSocket trying to reconnect...');
      // Don't spam the server with retries
      setTimeout(() => {
        this.#initWebSocketMode();
      }, 500);
    });
  }

  /**
   * Init OverlayPluginApi connection
   * @private
   */
  #initCallbackMode() {
    if (!window.OverlayPluginApi || !window.OverlayPluginApi.ready) {
      !this.#options.silentMode && logInfo('API not ready, trying to reconnect...');
      setTimeout(() => {
        this.#initCallbackMode();
      }, 500);
      return;
    }
    // API loadedpoint
    this.#status = true;
    // Bind `this` for callback function called by OverlayAPI
    window.__OverlayCallback = this.#triggerEvents.bind(this);
    // Send all messages in queue to OverlayPlugin
    while (this.#queue.length > 0) {
      let { msg, cb } = this.#queue.shift();
      this.#sendMessage(msg, cb);
    }
    !this.#options.silentMode && logInfo('API ready');
  }

  /**
   * Add an event listener
   * @public
   * @param {String} event Event to listen
   * @param {Function} cb Callback function
   */
  addListener(event, cb) {
    const eventListened = this.#subscribers.hasOwnProperty(event);
    // Init event array
    if (!eventListened) {
      this.#subscribers[event] = [];
    }
    // Push events
    if (typeof cb === 'function') {
      this.#subscribers[event].push(cb);
      !this.#options.silentMode && logInfo('Listener', cb, 'of event', event, 'added');
    } else {
      logError('Wrong params', cb);
      return;
    }
  }

  /**
   * Remove a listener
   * @public
   * @param {String} event Event type which listener belongs to
   * @param {Function} cb Function which listener to remove
   */
  removeListener(event, cb) {
    const eventListened = this.#subscribers.hasOwnProperty(event);
    if (eventListened) {
      if (typeof cb === 'function') {
        let cbPos = this.#subscribers[event].indexOf(cb);
        if (cbPos > -1) {
          this.#subscribers[event].splice(cbPos, 1);
          !this.#options.silentMode && logInfo('Listener', cb, 'of event', event, 'removed');
        }
      } else {
        logError('Wrong params', cb);
        return;
      }
    }
  }

  /**
   * Remove all listener of one event type
   * @public
   * @param {String} event Event type which listener belongs to
   */
  removeAllListener(event) {
    if (this.#subscribers[event] && this.#subscribers[event].length > 0) {
      this.#subscribers[event] = [];
      !this.#options.silentMode && logInfo('All listener of event', event, 'removed');
    }
  }

  /**
   * Get all listeners of a event
   * @public
   * @param {String} event Event type which listener belongs to
   */
  getAllListener(event) {
    return this.#subscribers[event] ? this.#subscribers[event] : [];
  }

  /**
   * Start listening event
   * @public
   */
  startEvent() {
    this.#sendMessage({
      call: 'subscribe',
      events: Object.keys(this.#subscribers),
    });
    !this.#options.silentMode && logInfo('Events', Object.keys(this.#subscribers), 'started');
  }

  /**
   * Ends current encounter and save it
   * Returns a Promise
   * @public
   */
  endEncounter() {
    if (this.#status) {
      return window.OverlayPluginApi.endEncounter();
    } else {
      logError('Plugin not ready yet');
    }
    !this.#options.silentMode && logInfo('Encounter ended');
  }

  /**
   * This function allows you to call an overlay handler
   * These handlers are declared by Event Sources (either built into OverlayPlugin or loaded through addons like Cactbot)
   * Returns a Promise
   * @public
   * @param {Object} msg Message send to OverlayPlugin
   */
  callHandler(msg) {
    let p;
    if (this.#ws) {
      msg.rseq = this.#resCounter++;
      p = new Promise((resolve) => {
        this.#resPromises[msg.rseq] = resolve;
      });
      this.#sendMessage(msg);
    } else {
      p = new Promise((resolve) => {
        this.#sendMessage(msg, (data) => {
          let rd;
          try {
            rd = data == null ? null : JSON.parse(data);
          } catch (e) {
            logError(e, data);
            return reject(e);
          }
          return resolve(rd);
        });
      });
    }
    return p;
  }

  /**
   * Switch data simulation
   * @param {Object} fakeData Simulation data
   */
  simulateData(fakeData) {
    if (typeof fakeData === 'object') {
      if (fakeData.hasOwnProperty('type') && fakeData.type === 'CombatData') {
        this.#simulator = setInterval(() => {
          this.#triggerEvents(fakeData);
          !this.#options.silentMode && logInfo('Data simulating triggered');
        }, 1000);
        !this.#options.silentMode && logInfo('Data simulating on with fake data', fakeData);
      } else {
        logError('You need to provide currect fake CombatData object to enable data simulation');
      }
    } else {
      if (this.#simulator) {
        clearInterval(this.#simulator);
      }
      !this.#options.silentMode && logInfo('Data simulating off');
    }
  }
}
